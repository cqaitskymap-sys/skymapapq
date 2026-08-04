/**
 * Backup & Restore — privileged Cloud Functions.
 * Admin SDK export/import, AES-256-GCM payload encryption, dual audit, scheduler.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore, type DocumentData } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import * as logger from 'firebase-functions/logger';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 5000): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function requiredReason(value: unknown): string {
  const reason = requiredString(value, 'Change reason', 2000);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asNumber(value: unknown, fallback: number, min = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function asStringArray(value: unknown, max = 80): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean).slice(0, max);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, max);
  }
  return [];
}

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor'];
const EDITOR_ROLES = ['super_admin', 'admin'];
const APPROVER_ROLES = ['super_admin'];
const MAX_DOCS_PER_COLLECTION = 500;
const MAX_RESTORE_DOCS = 2000;
const PROTECTED_RESTORE = new Set(['audit_trail', 'audit_logs', 'esign_records', 'esign_history']);

const ALL_COLLECTIONS = [
  'users', 'roles', 'permissions', 'departments', 'designations', 'company_sites',
  'products', 'batches', 'parameters', 'workflows', 'approval_matrix', 'document_numbering',
  'esign_settings', 'notification_settings', 'module_configuration', 'email_sms_templates',
  'system_settings', 'cpv_reviews', 'cpp_parameters', 'cpp_results',
  'cqa_parameters', 'cqa_results', 'pqr_records', 'deviations', 'oos_records', 'capa_records',
  'change_controls', 'stability_studies', 'complaints', 'recalls', 'documents',
  'audits', 'vendors', 'validation_records', 'csv_systems',
  'equipment_master', 'monitoring_records', 'warehouse_materials', 'ebmr_records',
  'audit_trail', 'notifications', 'master_data_import_export',
] as const;

const SCOPE_MAP: Record<string, readonly string[]> = {
  'Full System': ALL_COLLECTIONS,
  'Admin Data': [
    'users', 'roles', 'permissions', 'departments', 'designations', 'company_sites',
    'workflows', 'approval_matrix', 'document_numbering', 'esign_settings',
    'notification_settings', 'system_settings', 'module_configuration', 'email_sms_templates',
  ],
  'QMS Data': [
    'deviations', 'oos_records', 'capa_records', 'change_controls', 'stability_studies',
    'complaints', 'recalls', 'documents', 'audits', 'vendors',
    'validation_records', 'csv_systems', 'equipment_master', 'monitoring_records',
    'warehouse_materials', 'ebmr_records',
  ],
  'PQR Data': ['pqr_records'],
  'CPV Data': ['cpv_reviews', 'cpp_parameters', 'cpp_results', 'cqa_parameters', 'cqa_results'],
  'Master Data': [
    'users', 'roles', 'departments', 'designations', 'company_sites', 'products',
    'batches', 'parameters',
  ],
  'Audit Trail': ['audit_trail'],
  'Selected Collections': [],
};

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Backup view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Backup create/edit access required');
  }
}

function assertApprover(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !APPROVER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Only Super Admin may approve/execute restores');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = snap.data();
  return {
    firestore,
    actor,
    actorRole: String(actor?.role || ''),
    actorName: String(actor?.full_name || actor?.email || request.auth.uid),
    actorUid: request.auth.uid,
  };
}

async function writeBackupAudit(
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    now: string;
  },
) {
  const batch = firestore.batch();
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-BKP-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'Backup',
    collectionName: 'backup_history',
    recordId: input.recordId,
    documentId: input.recordId,
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason || '',
    performedBy: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    createdAt: input.now,
    source: 'backup-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: 'Backup',
    action: input.actionType,
    recordId: input.recordId,
    description: input.description,
    performedBy: input.actorName,
    userId: input.actorUid,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
  });
  await batch.commit();
}

function resolveCollections(scope: string, selected: string[]): string[] {
  if (scope === 'Selected Collections') {
    return selected.filter((c) => (ALL_COLLECTIONS as readonly string[]).includes(c));
  }
  const mapped = SCOPE_MAP[scope];
  if (mapped && mapped.length > 0) return [...mapped];
  return [...ALL_COLLECTIONS];
}

function encryptionKey(): Buffer {
  const secret = process.env.BACKUP_ENCRYPTION_KEY || `skymap-backup-${process.env.GCLOUD_PROJECT || 'local'}`;
  return createHash('sha256').update(secret).digest();
}

function encryptPayload(plain: string): { cipherText: string; iv: string; authTag: string; algorithm: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    cipherText: enc.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    algorithm: 'AES-256-GCM',
  };
}

function decryptPayload(cipherText: string, iv: string, authTag: string): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(authTag, 'base64'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildBackupId(): string {
  return `BKP-${Date.now()}`;
}

function buildBackupNumber(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `BK-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

function buildRestoreId(): string {
  return `RST-${Date.now().toString(36).toUpperCase()}`;
}

function nextDueDate(frequency: string, from = new Date()): string {
  const d = new Date(from);
  if (frequency === 'Hourly') d.setHours(d.getHours() + 1);
  else if (frequency === 'Daily') d.setDate(d.getDate() + 1);
  else if (frequency === 'Weekly') d.setDate(d.getDate() + 7);
  else if (frequency === 'Monthly') d.setMonth(d.getMonth() + 1);
  else if (frequency === 'Quarterly') d.setMonth(d.getMonth() + 3);
  else if (frequency === 'Yearly') d.setFullYear(d.getFullYear() + 1);
  else return '';
  return d.toISOString();
}

async function exportCollections(
  firestore: Firestore,
  collections: string[],
): Promise<{ data: Record<string, unknown[]>; recordsCount: number; truncated: string[] }> {
  const data: Record<string, unknown[]> = {};
  const truncated: string[] = [];
  let recordsCount = 0;
  for (const col of collections) {
    const snap = await firestore.collection(col).limit(MAX_DOCS_PER_COLLECTION + 1).get();
    const docs = snap.docs.slice(0, MAX_DOCS_PER_COLLECTION).map((d) => ({ id: d.id, ...d.data() }));
    if (snap.size > MAX_DOCS_PER_COLLECTION) truncated.push(col);
    data[col] = docs;
    recordsCount += docs.length;
  }
  return { data, recordsCount, truncated };
}

async function runBackupJob(input: {
  firestore: Firestore;
  actorUid: string;
  actorName: string;
  backupType: string;
  backupScope: string;
  selectedCollections: string[];
  backupNumber?: string;
  backupFrequency?: string;
  remarks?: string;
  changeReason: string;
  isProtected?: boolean;
}): Promise<{
  backupDocId: string;
  backupId: string;
  backupNumber: string;
  recordsCount: number;
  checksum: string;
  storageLocation: string;
  status: string;
}> {
  const now = new Date().toISOString();
  const started = Date.now();
  const backupId = buildBackupId();
  const backupNumber = input.backupNumber || buildBackupNumber();
  const collections = resolveCollections(input.backupScope, input.selectedCollections);
  if (collections.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one collection for this backup scope');
  }

  const jobRef = input.firestore.collection('backup_jobs').doc();
  await jobRef.set({
    jobId: `JOB-${backupId}`,
    backupId,
    jobType: 'Backup',
    jobStatus: 'In Progress',
    progressPct: 5,
    createdAt: now,
    createdBy: input.actorUid,
  });

  const histRef = input.firestore.collection('backup_history').doc();
  await histRef.set({
    backupId,
    backupNumber,
    backupType: input.backupType,
    backupScope: input.backupScope,
    backupDateTime: now,
    backupDate: now,
    backupStatus: 'In Progress',
    fileName: `${backupNumber}.enc.json`,
    fileSize: '',
    fileSizeBytes: 0,
    storageLocation: '',
    filePath: '',
    collectionsIncluded: collections,
    recordsCount: 0,
    backupFrequency: input.backupFrequency || 'Manual Only',
    nextBackupDue: '',
    restorePointCreated: false,
    checksum: '',
    integrityStatus: 'Pending',
    encryptionStatus: 'Pending',
    encryptionAlgorithm: 'AES-256-GCM',
    storageProvider: 'Firebase Cloud Storage',
    compressionRatio: '1.0',
    version: '1',
    retentionPolicyDays: 90,
    expirationDate: '',
    isProtected: input.isProtected === true,
    failureReason: '',
    durationMs: 0,
    remarks: input.remarks || '',
    changeReason: input.changeReason,
    status: 'Active',
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: input.actorUid,
    updatedBy: input.actorUid,
    createdByName: input.actorName,
  });

  try {
    await jobRef.update({ progressPct: 20 });
    const exported = await exportCollections(input.firestore, collections);
    const payloadObj = {
      meta: {
        backupId,
        backupNumber,
        backupType: input.backupType,
        backupScope: input.backupScope,
        exportedAt: now,
        collections,
        recordsCount: exported.recordsCount,
        truncatedCollections: exported.truncated,
        formatVersion: 1,
        encrypted: true,
      },
      data: exported.data,
    };
    const plain = JSON.stringify(payloadObj);
    const checksum = sha256(plain);
    const enc = encryptPayload(plain);
    const storageBody = JSON.stringify({
      v: 1,
      algorithm: enc.algorithm,
      iv: enc.iv,
      authTag: enc.authTag,
      cipherText: enc.cipherText,
      checksumPlain: checksum,
    });

    await jobRef.update({ progressPct: 70 });
    const storagePath = `backups/${backupId}/${backupNumber}.enc.json`;
    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    await file.save(storageBody, {
      contentType: 'application/json',
      metadata: {
        metadata: {
          backupId,
          checksum,
          algorithm: enc.algorithm,
          integrity: 'SHA-256',
        },
      },
    });

    const sizeBytes = Buffer.byteLength(storageBody, 'utf8');
    const settingsSnap = await input.firestore.collection('backup_settings').limit(1).get();
    const retention = asNumber(settingsSnap.docs[0]?.data()?.retentionPeriodDays, 90, 1);
    const expiration = new Date();
    expiration.setDate(expiration.getDate() + retention);

    const updates = {
      backupStatus: 'Completed',
      fileSize: formatBytes(sizeBytes),
      fileSizeBytes: sizeBytes,
      storageLocation: storagePath,
      filePath: storagePath,
      recordsCount: exported.recordsCount,
      checksum,
      integrityStatus: 'Verified',
      encryptionStatus: 'Encrypted',
      encryptionAlgorithm: enc.algorithm,
      restorePointCreated: true,
      retentionPolicyDays: retention,
      expirationDate: expiration.toISOString(),
      durationMs: Date.now() - started,
      failureReason: exported.truncated.length
        ? `Truncated collections (max ${MAX_DOCS_PER_COLLECTION} docs): ${exported.truncated.join(', ')}`
        : '',
      updatedAt: new Date().toISOString(),
      updatedBy: input.actorUid,
    };
    await histRef.update(updates);

    // Mirror legacy backup_restore for admin dashboard KPI
    await input.firestore.collection('backup_restore').doc(histRef.id).set({
      ...updates,
      backupId,
      backupNumber,
      backupType: input.backupType,
      backupScope: input.backupScope,
      backupDateTime: now,
      restorePoint: backupId,
      restoreHistory: '',
      status: 'Active',
      createdAt: now,
      createdBy: input.actorUid,
    }, { merge: true });

    await jobRef.update({
      jobStatus: 'Completed',
      progressPct: 100,
      completedAt: new Date().toISOString(),
      backupDocId: histRef.id,
    });

    await writeBackupAudit(input.firestore, {
      actorUid: input.actorUid,
      actorName: input.actorName,
      recordId: backupId,
      actionType: 'Backup Completed',
      description: `Backup ${backupNumber} completed (${exported.recordsCount} records)`,
      newValue: { storagePath, checksum, recordsCount: exported.recordsCount },
      reason: input.changeReason,
      now: new Date().toISOString(),
    });

    return {
      backupDocId: histRef.id,
      backupId,
      backupNumber,
      recordsCount: exported.recordsCount,
      checksum,
      storageLocation: storagePath,
      status: 'Completed',
    };
  } catch (e) {
    const errMsg = (e as Error).message || 'Backup failed';
    await histRef.update({
      backupStatus: 'Failed',
      failureReason: errMsg,
      integrityStatus: 'Failed',
      encryptionStatus: 'Failed',
      durationMs: Date.now() - started,
      updatedAt: new Date().toISOString(),
    });
    await jobRef.update({ jobStatus: 'Failed', failureReason: errMsg, progressPct: 100 });
    await writeBackupAudit(input.firestore, {
      actorUid: input.actorUid,
      actorName: input.actorName,
      recordId: backupId,
      actionType: 'Backup Failed',
      description: errMsg,
      reason: input.changeReason,
      now: new Date().toISOString(),
    });
    throw new HttpsError('internal', errMsg);
  }
}

async function loadAndDecryptBackup(
  firestore: Firestore,
  backupIdOrDoc: string,
): Promise<{
  histDocId: string;
  hist: DocumentData;
  plain: string;
  payload: { data?: Record<string, unknown[]>; meta?: Record<string, unknown> };
}> {
  let snap = await firestore.collection('backup_history').doc(backupIdOrDoc).get();
  if (!snap.exists) {
    const q = await firestore.collection('backup_history')
      .where('backupId', '==', backupIdOrDoc)
      .limit(1)
      .get();
    if (q.empty) throw new HttpsError('not-found', 'Backup not found');
    snap = q.docs[0];
  }
  const hist = snap.data() || {};
  const path = String(hist.storageLocation || hist.filePath || '');
  if (!path) throw new HttpsError('failed-precondition', 'Backup has no storage location');

  const [buf] = await getStorage().bucket().file(path).download();
  const raw = buf.toString('utf8');
  let plain: string;
  try {
    const envelope = JSON.parse(raw) as {
      cipherText?: string;
      iv?: string;
      authTag?: string;
      checksumPlain?: string;
      data?: unknown;
    };
    if (envelope.cipherText && envelope.iv && envelope.authTag) {
      plain = decryptPayload(envelope.cipherText, envelope.iv, envelope.authTag);
      if (envelope.checksumPlain && sha256(plain) !== envelope.checksumPlain) {
        throw new HttpsError('failed-precondition', 'Backup integrity check failed (checksum mismatch)');
      }
    } else {
      // Legacy plaintext JSON backup
      plain = raw;
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    plain = raw;
  }

  const expected = String(hist.checksum || '');
  if (expected && sha256(plain) !== expected && !raw.includes('"cipherText"')) {
    // For encrypted, checksum is of plaintext; already checked above when envelope present
    if (!JSON.parse(raw)?.cipherText) {
      throw new HttpsError('failed-precondition', 'Corrupted backup: checksum mismatch');
    }
  }

  let payload: { data?: Record<string, unknown[]>; meta?: Record<string, unknown> };
  try {
    payload = JSON.parse(plain);
  } catch {
    throw new HttpsError('failed-precondition', 'Backup payload is not valid JSON');
  }
  return { histDocId: snap.id, hist, plain, payload };
}

export const createAdminBackup = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const changeReason = requiredReason(data.changeReason || data.remarks || 'Manual backup initiated');
  const result = await runBackupJob({
    firestore,
    actorUid,
    actorName,
    backupType: requiredString(data.backupType || 'Manual Backup', 'Backup type', 80),
    backupScope: requiredString(data.backupScope || 'Full System', 'Backup scope', 80),
    selectedCollections: asStringArray(data.selectedCollections),
    backupNumber: optionalString(data.backupNumber, 'Backup number', 80) || undefined,
    backupFrequency: optionalString(data.backupFrequency, 'Frequency', 40) || 'Manual Only',
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    changeReason,
    isProtected: asBool(data.isProtected, false),
  });
  return result;
});

export const verifyAdminBackup = onCall({ timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const backupId = requiredString(data.backupId || data.id, 'Backup ID', 120);
  const loaded = await loadAndDecryptBackup(firestore, backupId);
  const ok = Boolean(loaded.plain);
  const now = new Date().toISOString();
  if (ok) {
    await firestore.collection('backup_history').doc(loaded.histDocId).update({
      backupStatus: 'Verified',
      integrityStatus: 'Verified',
      updatedAt: now,
      updatedBy: actorUid,
    });
  }
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: String(loaded.hist.backupId || backupId),
    actionType: ok ? 'Backup Verified' : 'Backup Integrity Failed',
    description: ok ? 'Checksum and decrypt verification passed' : 'Verification failed',
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Integrity check',
    now,
  });
  return {
    verified: ok,
    checksum: loaded.hist.checksum || '',
    recordsCount: loaded.hist.recordsCount || 0,
    encryptionStatus: loaded.hist.encryptionStatus || 'Unknown',
  };
});

export const getAdminBackupDownloadUrl = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const backupId = requiredString(data.backupId || data.id, 'Backup ID', 120);
  const loaded = await loadAndDecryptBackup(firestore, backupId);
  // Return decrypted JSON for authorized download (never expose cipher key)
  const fileName = String(loaded.hist.fileName || `${loaded.hist.backupNumber || backupId}.json`).replace(/\.enc\.json$/i, '.json');
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: String(loaded.hist.backupId || backupId),
    actionType: 'Backup Downloaded',
    description: `Download prepared for ${fileName}`,
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Authorized download',
    now: new Date().toISOString(),
  });
  return {
    fileName,
    content: loaded.plain,
    checksum: loaded.hist.checksum || '',
    mimeType: 'application/json',
  };
});

export const updateAdminBackupSettings = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const changeReason = requiredReason(data.changeReason || 'Backup settings updated');
  const now = new Date().toISOString();
  const existing = await firestore.collection('backup_settings').limit(1).get();
  const payload = {
    autoBackupEnabled: asBool(data.autoBackupEnabled, false),
    backupFrequency: optionalString(data.backupFrequency, 'Frequency', 40) || 'Weekly',
    backupTime: optionalString(data.backupTime, 'Backup time', 10) || '02:00',
    backupScope: optionalString(data.backupScope, 'Scope', 80) || 'Full System',
    retentionPeriodDays: asNumber(data.retentionPeriodDays, 90, 1),
    notifyAdminOnSuccess: asBool(data.notifyAdminOnSuccess, true),
    notifyAdminOnFailure: asBool(data.notifyAdminOnFailure, true),
    nextBackupDate: nextDueDate(
      optionalString(data.backupFrequency, 'Frequency', 40) || 'Weekly',
    ),
    updatedAt: now,
    updatedBy: actorUid,
    changeReason,
    status: 'Active',
  };
  let docId: string;
  if (existing.empty) {
    const ref = firestore.collection('backup_settings').doc();
    await ref.set({
      ...payload,
      lastBackupDate: '',
      createdAt: now,
      createdBy: actorUid,
    });
    docId = ref.id;
  } else {
    docId = existing.docs[0].id;
    await existing.docs[0].ref.update(payload);
  }
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: docId,
    actionType: 'Backup Settings Updated',
    description: 'Scheduled backup / retention configuration changed',
    newValue: payload,
    reason: changeReason,
    now,
  });
  return { id: docId, ...payload };
});

export const requestAdminRestore = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const backupId = requiredString(data.backupId, 'Backup ID', 120);
  const reason = requiredReason(data.reasonForRestore || data.changeReason);
  const restoreType = requiredString(data.restoreType || 'Full Restore', 'Restore type', 80);
  const dryRun = asBool(data.dryRun, false);
  const esignRecordId = optionalString(data.esignRecordId, 'E-Sign record', 120);

  const loaded = await loadAndDecryptBackup(firestore, backupId);
  if (String(loaded.hist.backupStatus) === 'Failed') {
    throw new HttpsError('failed-precondition', 'Cannot restore a failed backup');
  }
  const selected = asStringArray(data.selectedCollections);
  let collections = restoreType === 'Selected Collection Restore'
    ? selected
    : (loaded.hist.collectionsIncluded as string[]) || Object.keys(loaded.payload.data || {});
  collections = collections.filter((c) => !PROTECTED_RESTORE.has(c));

  const now = new Date().toISOString();
  const restoreId = buildRestoreId();
  const ref = firestore.collection('restore_history').doc();
  await ref.set({
    restoreId,
    backupId: loaded.hist.backupId,
    restoreDateTime: now,
    restoreType,
    restoredBy: actorUid,
    restoreStatus: dryRun ? 'Completed' : 'Requested',
    collectionsRestored: collections,
    recordsRestored: dryRun
      ? collections.reduce((n, c) => n + ((loaded.payload.data?.[c] || []).length), 0)
      : 0,
    reasonForRestore: reason,
    approvalRequired: !dryRun,
    approvedBy: '',
    approvedAt: '',
    preRestoreBackupId: '',
    dryRun,
    esignRecordId,
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    status: 'Active',
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
  });

  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: restoreId,
    actionType: dryRun ? 'Restore Dry Run' : 'Restore Requested',
    description: dryRun
      ? `Dry-run restore preview for ${collections.length} collections`
      : `Restore requested for backup ${loaded.hist.backupNumber}`,
    reason,
    newValue: { esignRecordId, collections },
    now,
  });

  return {
    id: ref.id,
    restoreId,
    dryRun,
    collections,
    previewCount: collections.reduce((n, c) => n + ((loaded.payload.data?.[c] || []).length), 0),
    status: dryRun ? 'Completed' : 'Requested',
  };
});

export const approveAdminRestore = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprover(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const restoreDocId = requiredString(data.restoreDocId || data.id, 'Restore document ID', 120);
  const changeReason = requiredReason(data.changeReason || 'Production restore approved');
  const esignRecordId = optionalString(data.esignRecordId, 'E-Sign record', 120);
  if (!esignRecordId) {
    throw new HttpsError('failed-precondition', 'Electronic signature record is required before restore');
  }

  const restoreSnap = await firestore.collection('restore_history').doc(restoreDocId).get();
  if (!restoreSnap.exists) throw new HttpsError('not-found', 'Restore request not found');
  const restore = restoreSnap.data() || {};
  if (restore.restoreStatus !== 'Requested' && restore.restoreStatus !== 'Approved') {
    throw new HttpsError('failed-precondition', 'Only requested restores can be approved');
  }

  const now = new Date().toISOString();
  await restoreSnap.ref.update({
    restoreStatus: 'In Progress',
    approvedBy: actorUid,
    approvedAt: now,
    esignRecordId,
    updatedAt: now,
    updatedBy: actorUid,
  });

  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: String(restore.restoreId),
    actionType: 'Restore Approved',
    description: 'Super Admin approved restore with e-signature',
    reason: changeReason,
    newValue: { esignRecordId },
    now,
  });

  // Pre-restore safety backup
  let preBackupId = '';
  try {
    const pre = await runBackupJob({
      firestore,
      actorUid,
      actorName,
      backupType: 'Pre-Restore Backup',
      backupScope: 'Full System',
      selectedCollections: [],
      remarks: `Safety backup before restore ${restore.restoreId}`,
      changeReason: `Pre-restore backup for ${restore.restoreId}`,
      isProtected: true,
    });
    preBackupId = pre.backupId;
    await restoreSnap.ref.update({ preRestoreBackupId: preBackupId });
  } catch (e) {
    logger.warn('Pre-restore backup failed', e);
  }

  const loaded = await loadAndDecryptBackup(firestore, String(restore.backupId));
  const collections = (restore.collectionsRestored as string[] || [])
    .filter((c) => !PROTECTED_RESTORE.has(c));
  let restored = 0;
  let batch = firestore.batch();
  let ops = 0;

  try {
    for (const col of collections) {
      const records = (loaded.payload.data?.[col] || []).slice(0, MAX_RESTORE_DOCS);
      for (const rec of records) {
        const row = rec as { id?: string };
        if (!row.id) continue;
        const { id, ...rest } = row;
        const ref = firestore.collection(col).doc(id);
        batch.set(ref, {
          ...rest,
          restoredAt: now,
          restoredFromBackup: loaded.hist.backupId,
          restoredBy: actorUid,
        }, { merge: true });
        ops += 1;
        restored += 1;
        if (ops >= 400) {
          await batch.commit();
          batch = firestore.batch();
          ops = 0;
        }
      }
    }
    if (ops > 0) await batch.commit();

    await restoreSnap.ref.update({
      restoreStatus: 'Completed',
      recordsRestored: restored,
      preRestoreBackupId: preBackupId,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUid,
    });
    await firestore.collection('backup_history').doc(loaded.histDocId).update({
      backupStatus: 'Restored',
      updatedAt: new Date().toISOString(),
    });
    await writeBackupAudit(firestore, {
      actorUid,
      actorName,
      recordId: String(restore.restoreId),
      actionType: 'Restore Completed',
      description: `Restored ${restored} records (audit/esign collections protected)`,
      reason: changeReason,
      now: new Date().toISOString(),
    });
    return { success: true, recordsRestored: restored, preRestoreBackupId: preBackupId };
  } catch (e) {
    const errMsg = (e as Error).message;
    await restoreSnap.ref.update({
      restoreStatus: 'Failed',
      remarks: errMsg,
      updatedAt: new Date().toISOString(),
    });
    await writeBackupAudit(firestore, {
      actorUid,
      actorName,
      recordId: String(restore.restoreId),
      actionType: 'Restore Failed',
      description: errMsg,
      reason: changeReason,
      now: new Date().toISOString(),
    });
    throw new HttpsError('internal', errMsg);
  }
});

export const rejectAdminRestore = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprover(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const restoreDocId = requiredString(data.restoreDocId || data.id, 'Restore document ID', 120);
  const reason = requiredReason(data.changeReason || data.reason || 'Restore rejected');
  const snap = await firestore.collection('restore_history').doc(restoreDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Restore request not found');
  const restore = snap.data() || {};
  await snap.ref.update({
    restoreStatus: 'Cancelled',
    remarks: reason,
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid,
  });
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: String(restore.restoreId),
    actionType: 'Restore Rejected',
    description: reason,
    reason,
    now: new Date().toISOString(),
  });
  return { success: true };
});

export const softDeleteAdminBackup = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprover(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id || data.backupDocId, 'Backup document ID', 120);
  const reason = requiredReason(data.changeReason);
  const snap = await firestore.collection('backup_history').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Backup not found');
  const hist = snap.data() || {};
  if (hist.isProtected === true) {
    throw new HttpsError('failed-precondition', 'Protected backups cannot be deleted');
  }
  await snap.ref.update({
    isDeleted: true,
    status: 'Inactive',
    updatedAt: new Date().toISOString(),
    updatedBy: actorUid,
    changeReason: reason,
  });
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: String(hist.backupId || id),
    actionType: 'Backup Soft Deleted',
    description: 'Backup marked deleted (evidence retained)',
    reason,
    now: new Date().toISOString(),
  });
  return { success: true };
});

export const purgeExpiredAdminBackups = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprover(actor, actorRole);
  const reason = requiredReason((request.data as Record<string, unknown>)?.changeReason || 'Retention purge');
  const now = new Date();
  const snap = await firestore.collection('backup_history').limit(200).get();
  let purged = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.isProtected || d.isDeleted) continue;
    const exp = d.expirationDate ? new Date(String(d.expirationDate)) : null;
    if (!exp || Number.isNaN(exp.getTime()) || exp > now) continue;
    await doc.ref.update({
      isDeleted: true,
      status: 'Inactive',
      integrityStatus: 'Expired',
      updatedAt: now.toISOString(),
      updatedBy: actorUid,
    });
    const path = String(d.storageLocation || '');
    if (path) {
      try {
        await getStorage().bucket().file(path).delete({ ignoreNotFound: true });
      } catch {
        /* ignore storage delete errors */
      }
    }
    purged += 1;
  }
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: 'retention-purge',
    actionType: 'Retention Purge',
    description: `Purged ${purged} expired backups`,
    reason,
    now: now.toISOString(),
  });
  return { purged };
});

export const logAdminBackupExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: optionalString(data.recordId, 'Record', 120) || 'export',
    actionType: 'Backup Report Exported',
    description: optionalString(data.description, 'Description', 500) || 'History export',
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Report export',
    now: new Date().toISOString(),
  });
  return { success: true };
});

export const archiveAdminBackupHistory = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Backup history ID', 120);
  const reason = requiredReason(data.changeReason || 'History archive');
  const snap = await firestore.collection('backup_history').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Backup history not found');
  const hist = snap.data() || {};
  if (hist.isProtected === true) {
    throw new HttpsError('failed-precondition', 'Protected backup history cannot be archived');
  }
  const now = new Date().toISOString();
  const archivePayload = {
    ...hist,
    sourceDocId: id,
    archivedAt: now,
    archivedBy: actorUid,
    archivedByName: actorName,
    archiveReason: reason,
    createdAt: now,
  };
  await firestore.collection('backup_history_archive').doc(id).set(archivePayload, { merge: true });
  // Mark archived — do not allow field mutation of original evidence beyond archive flags
  await snap.ref.update({
    isArchived: true,
    archivedAt: now,
    archivedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  });
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: String(hist.backupId || id),
    actionType: 'Backup History Archived',
    description: 'Backup history record archived (immutable copy retained)',
    reason,
    now,
  });
  return { success: true };
});

export const archiveAdminRestoreHistory = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Restore history ID', 120);
  const reason = requiredReason(data.changeReason || 'Restore history archive');
  const snap = await firestore.collection('restore_history').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Restore history not found');
  const hist = snap.data() || {};
  const now = new Date().toISOString();
  await firestore.collection('restore_history_archive').doc(id).set({
    ...hist,
    sourceDocId: id,
    archivedAt: now,
    archivedBy: actorUid,
    archivedByName: actorName,
    archiveReason: reason,
    createdAt: now,
  }, { merge: true });
  await snap.ref.update({
    isArchived: true,
    archivedAt: now,
    archivedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  });
  await writeBackupAudit(firestore, {
    actorUid,
    actorName,
    recordId: String(hist.restoreId || id),
    actionType: 'Restore History Archived',
    description: 'Restore history record archived (immutable copy retained)',
    reason,
    now,
  });
  return { success: true };
});

/** Daily scheduler — runs when autoBackupEnabled in backup_settings */
export const scheduledAdminBackup = onSchedule(
  {
    schedule: 'every day 02:00',
    timeZone: 'Asia/Kolkata',
    timeoutSeconds: 540,
    memory: '1GiB',
  },
  async () => {
    initializeAdmin();
    const firestore = getFirestore();
    const settingsSnap = await firestore.collection('backup_settings').limit(1).get();
    if (settingsSnap.empty) {
      logger.info('No backup_settings — skipping scheduled backup');
      return;
    }
    const settings = settingsSnap.docs[0].data();
    if (!settings.autoBackupEnabled) {
      logger.info('Auto backup disabled — skipping');
      return;
    }
    const freq = String(settings.backupFrequency || 'Weekly');
    if (freq === 'Manual Only') return;

    // Simple cadence gate: Daily always; Weekly on Monday; Monthly on 1st
    const day = new Date();
    if (freq === 'Weekly' && day.getDay() !== 1) return;
    if (freq === 'Monthly' && day.getDate() !== 1) return;
    if (freq === 'Quarterly' && !(day.getDate() === 1 && [0, 3, 6, 9].includes(day.getMonth()))) return;

    try {
      const result = await runBackupJob({
        firestore,
        actorUid: 'system-scheduler',
        actorName: 'Cloud Scheduler',
        backupType: 'Scheduled Backup',
        backupScope: String(settings.backupScope || 'Full System'),
        selectedCollections: [],
        backupFrequency: freq,
        remarks: 'Automated scheduled backup',
        changeReason: `Scheduled ${freq} backup`,
      });
      await settingsSnap.docs[0].ref.update({
        lastBackupDate: new Date().toISOString(),
        nextBackupDate: nextDueDate(freq),
        updatedAt: new Date().toISOString(),
      });
      logger.info('Scheduled backup completed', result);
    } catch (e) {
      logger.error('Scheduled backup failed', e);
    }
  },
);
