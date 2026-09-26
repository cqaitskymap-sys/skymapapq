/**
 * Audit Trail — privileged Cloud Functions.
 * Append-only, integrity-hashed, dual-collection writes for 21 CFR Part 11 / ALCOA+.
 */
import { createHash } from 'crypto';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type DocumentReference,
} from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { BROWSER_CALLABLE } from './callable-options';


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

function optionalString(value: unknown, field: string, maxLength = 2000): string {
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

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildAuditId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `AUD-${ts}-${rnd}`;
}

function buildTransactionId(): string {
  return `TXN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function computeIntegrityHash(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

const VIEWER_ROLES = [
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'qa',
  'regulatory_affairs', 'regulatory', 'auditor',
];
const ARCHIVER_ROLES = ['super_admin', 'admin'];
const CRITICAL_ACTIONS = new Set([
  'Delete', 'Soft Delete', 'Role Change', 'Permission Change', 'Password Reset',
  'Password Change', 'System Setting Change', 'Configuration Change',
  'Failed Login', 'E-Signature', 'Approve', 'Reject',
]);

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Audit trail access required');
  }
}

function assertArchiver(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ARCHIVER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Audit archive access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null; data?: unknown }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = snap.data();
  const actorRole = String(actor?.role || '');
  const actorName = String(actor?.full_name || actor?.email || request.auth.uid);
  return { firestore, actor, actorRole, actorName, actorUid: request.auth.uid };
}

function auditChainRef(firestore: Firestore) {
  return firestore.collection('system_settings').doc('audit_integrity_chain');
}

async function commitChainedAudit(
  firestore: Firestore,
  input: {
    hashParts: (previousHash: string) => string[];
    buildEntry: (previousHash: string, integrityHash: string) => ReturnType<typeof buildCanonicalEntry>;
    extraWrites?: Array<{ ref: DocumentReference; data: Record<string, unknown> }>;
    writeLogs?: boolean;
  },
) {
  const trailRef = firestore.collection('audit_trail').doc();
  const logsRef = firestore.collection('audit_logs').doc();
  const chainRef = auditChainRef(firestore);

  const result = await firestore.runTransaction(async (tx) => {
    const meta = await tx.get(chainRef);
    const previousHash = String(meta.data()?.lastIntegrityHash || 'GENESIS');
    const integrityHash = computeIntegrityHash(input.hashParts(previousHash));
    const entry = input.buildEntry(previousHash, integrityHash);
    tx.set(trailRef, entry);
    if (input.writeLogs !== false) {
      tx.set(logsRef, {
        dateTime: entry.dateTime,
        userId: entry.userId,
        userName: entry.userName,
        module: entry.moduleName,
        recordId: entry.recordId,
        action: entry.actionType,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        reason: entry.reason,
        ipAddress: entry.ipAddress,
        device: entry.deviceInfo,
        status: entry.status,
        auditId: entry.auditId,
        transactionId: entry.transactionId,
        integrityHash: entry.integrityHash,
        previousHash: entry.previousHash,
      });
    }
    tx.set(chainRef, {
      lastIntegrityHash: integrityHash,
      lastAuditId: entry.auditId,
      updatedAt: entry.dateTime,
    }, { merge: true });
    for (const extra of input.extraWrites || []) {
      tx.set(extra.ref, extra.data);
    }
    return { previousHash, integrityHash, entry };
  });

  return { trailRef, ...result };
}

function buildCanonicalEntry(input: {
  auditId: string;
  transactionId: string;
  now: string;
  timezone: string;
  moduleName: string;
  subModule: string;
  screen: string;
  collectionName: string;
  recordId: string;
  documentNumber: string;
  actionType: string;
  actionDescription: string;
  fieldName: string;
  oldValue: string;
  newValue: string;
  changedFields: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  employeeId: string;
  username: string;
  department: string;
  site: string;
  businessUnit: string;
  company: string;
  reason: string;
  remarks: string;
  ipAddress: string;
  deviceInfo: string;
  browserInfo: string;
  operatingSystem: string;
  sessionId: string;
  requestId: string;
  workflowId: string;
  approvalLevel: string;
  eSignatureRequired: boolean;
  eSignatureStatus: string;
  eSignatureId: string;
  status: string;
  previousHash: string;
  integrityHash: string;
}) {
  return {
    auditId: input.auditId,
    transactionId: input.transactionId,
    referenceId: input.recordId,
    dateTime: input.now,
    timestamp: input.now,
    timezone: input.timezone,
    moduleName: input.moduleName,
    module: input.moduleName,
    subModule: input.subModule,
    screen: input.screen,
    collectionName: input.collectionName,
    recordId: input.recordId,
    documentId: input.recordId,
    documentNumber: input.documentNumber,
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.actionDescription,
    fieldName: input.fieldName,
    oldValue: input.oldValue,
    newValue: input.newValue,
    changedFields: input.changedFields,
    changedByUserId: input.actorUid,
    changedByUserName: input.actorName,
    changedByRole: input.actorRole,
    userId: input.actorUid,
    userName: input.actorName,
    employeeId: input.employeeId,
    username: input.username || input.actorName,
    fullName: input.actorName,
    role: input.actorRole,
    department: input.department,
    site: input.site,
    businessUnit: input.businessUnit,
    company: input.company,
    reasonForChange: input.reason,
    reason: input.reason,
    remarks: input.remarks,
    ipAddress: input.ipAddress,
    deviceInfo: input.deviceInfo,
    device: input.deviceInfo,
    browserInfo: input.browserInfo,
    operatingSystem: input.operatingSystem,
    sessionId: input.sessionId,
    requestId: input.requestId,
    workflowId: input.workflowId,
    approvalLevel: input.approvalLevel,
    eSignatureRequired: input.eSignatureRequired,
    eSignatureStatus: input.eSignatureStatus,
    eSignatureId: input.eSignatureId,
    status: input.status,
    previousHash: input.previousHash,
    integrityHash: input.integrityHash,
    appendOnly: true,
    immutable: true,
    isArchived: false,
    source: 'cloud-function',
  };
}

async function maybeSecurityAlert(
  firestore: Firestore,
  actorUid: string,
  actionType: string,
  now: string,
) {
  if (actionType !== 'Failed Login') return;
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const snap = await firestore.collection('audit_trail')
    .where('actionType', '==', 'Failed Login')
    .where('dateTime', '>=', since)
    .limit(20)
    .get()
    .catch(() => null);
  const count = (snap?.size || 0) + 1;
  if (count < 5) return;

  await firestore.collection('notifications').doc().set({
    userId: actorUid,
    type: 'Security Alert',
    title: 'Multiple Failed Logins',
    message: `${count} failed login attempts detected in the last 15 minutes.`,
    module: 'Audit Trail',
    severity: 'High',
    isRead: false,
    createdAt: now,
  });
}

async function handleAppendAdminAuditTrail(request: CallableRequest) {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  if (!actor || actor.is_active !== true) {
    throw new HttpsError('permission-denied', 'Active user required to write audit events');
  }

  const data = (request.data || {}) as Record<string, unknown>;
  const moduleName = requiredString(data.moduleName || data.module, 'Module', 120);
  const actionType = requiredString(data.actionType || data.action, 'Action', 120);
  const recordId = requiredString(data.recordId || data.documentId || 'system', 'Record ID', 200);
  const collectionName = optionalString(data.collectionName, 'collectionName', 120) || 'audit_trail';
  const now = new Date().toISOString();
  const auditId = buildAuditId();
  const transactionId = optionalString(data.transactionId, 'transactionId', 80) || buildTransactionId();
  const oldValue = serializeValue(data.oldValue);
  const newValue = serializeValue(data.newValue);
  const notificationRef = firestore.collection('notifications').doc();
  const chained = await commitChainedAudit(firestore, {
    hashParts: (previousHash) => [
      previousHash, auditId, now, moduleName, actionType, recordId, actorUid, oldValue, newValue,
    ],
    buildEntry: (previousHash, integrityHash) => buildCanonicalEntry({
      auditId,
      transactionId,
      now,
      timezone: optionalString(data.timezone, 'timezone', 64) || 'UTC',
      moduleName,
      subModule: optionalString(data.subModule, 'subModule', 120),
      screen: optionalString(data.screen, 'screen', 120),
      collectionName,
      recordId,
      documentNumber: optionalString(data.documentNumber, 'documentNumber', 120),
      actionType,
      actionDescription: optionalString(data.actionDescription, 'actionDescription', 1000)
        || `${actionType} on ${moduleName}`,
      fieldName: optionalString(data.fieldName, 'fieldName', 120),
      oldValue,
      newValue,
      changedFields: optionalString(data.changedFields, 'changedFields', 2000),
      actorUid,
      actorName,
      actorRole,
      employeeId: String(actor?.employee_id || actor?.employeeId || ''),
      username: String(actor?.email || actorName),
      department: String(actor?.department || ''),
      site: optionalString(data.site, 'site', 120),
      businessUnit: optionalString(data.businessUnit, 'businessUnit', 120),
      company: optionalString(data.company, 'company', 120),
      reason: optionalString(data.reason || data.reasonForChange, 'reason', 2000),
      remarks: optionalString(data.remarks, 'remarks', 2000),
      ipAddress: optionalString(data.ipAddress, 'ipAddress', 120) || 'client',
      deviceInfo: optionalString(data.deviceInfo || data.device, 'deviceInfo', 1000) || 'browser',
      browserInfo: optionalString(data.browserInfo, 'browserInfo', 1000),
      operatingSystem: optionalString(data.operatingSystem, 'operatingSystem', 120),
      sessionId: optionalString(data.sessionId, 'sessionId', 128),
      requestId: optionalString(data.requestId, 'requestId', 128),
      workflowId: optionalString(data.workflowId, 'workflowId', 128),
      approvalLevel: optionalString(data.approvalLevel, 'approvalLevel', 40),
      eSignatureRequired: Boolean(data.eSignatureRequired),
      eSignatureStatus: optionalString(data.eSignatureStatus, 'eSignatureStatus', 80),
      eSignatureId: optionalString(data.eSignatureId, 'eSignatureId', 128),
      status: optionalString(data.status, 'status', 40) || 'Success',
      previousHash,
      integrityHash,
    }),
  });

  const { entry, trailRef, integrityHash, previousHash } = chained;
  if (CRITICAL_ACTIONS.has(actionType) || entry.status === 'Failed') {
    await firestore.collection('notifications').doc(notificationRef.id).set({
      userId: actorUid,
      type: entry.status === 'Failed' ? 'Audit Failure' : 'Security Alert',
      title: `${actionType} recorded`,
      message: `Audit ${auditId}: ${entry.actionDescription}`,
      module: 'Audit Trail',
      recordId: trailRef.id,
      isRead: false,
      createdAt: now,
    });
  }

  await maybeSecurityAlert(firestore, actorUid, actionType, now).catch(() => undefined);

  return { id: trailRef.id, auditId, transactionId, integrityHash, previousHash };
}

/**
 * Trusted append-only audit writer used by all SkyMap modules.
 */
export const appendAdminAuditTrail = onCall(BROWSER_CALLABLE, handleAppendAdminAuditTrail);

/**
 * New callable name so first-time deploy can grant public Cloud Run invoke.
 * Updating an existing Gen 2 callable often leaves invoker private, which makes
 * browser CORS preflight fail with no Access-Control-Allow-Origin header.
 */
export const recordAdminAuditTrail = onCall(BROWSER_CALLABLE, handleAppendAdminAuditTrail);

export const logAdminAuditTrailExport = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const format = optionalString(data.format, 'format', 40) || 'Excel';
  const count = Number(data.count || 0);
  const reason = optionalString(data.reason, 'reason', 500) || `Audit trail exported as ${format}`;

  const now = new Date().toISOString();
  const auditId = buildAuditId();
  const exportRef = firestore.collection('audit_exports').doc();
  await commitChainedAudit(firestore, {
    hashParts: (previousHash) => [
      previousHash, auditId, now, 'Admin', 'Export', 'export', actorUid, '', JSON.stringify({ format, count }),
    ],
    buildEntry: (previousHash, integrityHash) => buildCanonicalEntry({
      auditId,
      transactionId: buildTransactionId(),
      now,
      timezone: 'UTC',
      moduleName: 'Admin',
      subModule: 'Audit Trail',
      screen: 'Audit Trail Export',
      collectionName: 'audit_trail',
      recordId: 'export',
      documentNumber: '',
      actionType: 'Export',
      actionDescription: reason,
      fieldName: '',
      oldValue: '',
      newValue: serializeValue({ format, count }),
      changedFields: '',
      actorUid,
      actorName,
      actorRole,
      employeeId: String(actor?.employee_id || ''),
      username: String(actor?.email || actorName),
      department: String(actor?.department || ''),
      site: '',
      businessUnit: '',
      company: '',
      reason,
      remarks: '',
      ipAddress: 'client',
      deviceInfo: 'browser',
      browserInfo: '',
      operatingSystem: '',
      sessionId: '',
      requestId: '',
      workflowId: '',
      approvalLevel: '',
      eSignatureRequired: false,
      eSignatureStatus: '',
      eSignatureId: '',
      status: 'Success',
      previousHash,
      integrityHash,
    }),
    extraWrites: [{
      ref: exportRef,
      data: {
        exportedAt: now,
        exportedBy: actorUid,
        exportedByName: actorName,
        format,
        count,
        reason,
        auditId,
      },
    }],
  });
  return { success: true, auditId };
});

/**
 * Copy aged records into audit_trail_archive (originals remain immutable).
 */
export const archiveAdminAuditTrail = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertArchiver(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const beforeDate = requiredString(data.beforeDate, 'Before date', 40);
  const reason = requiredString(data.reason || data.changeReason, 'Change reason', 500);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');

  const snap = await firestore.collection('audit_trail')
    .where('dateTime', '<', beforeDate)
    .limit(200)
    .get();

  let archived = 0;
  const now = new Date().toISOString();
  for (const docSnap of snap.docs) {
    const payload = docSnap.data();
    const archiveRef = firestore.collection('audit_trail_archive').doc(docSnap.id);
    const existingArchive = await archiveRef.get();
    if (existingArchive.exists) continue;
    await archiveRef.set({
      ...payload,
      archivedAt: now,
      archivedBy: actorUid,
      archiveReason: reason,
      originalId: docSnap.id,
    });
    archived += 1;
  }

  const auditId = buildAuditId();
  await commitChainedAudit(firestore, {
    hashParts: (previousHash) => [
      previousHash, auditId, now, 'Admin', 'Archive', 'archive', actorUid, '', String(archived),
    ],
    buildEntry: (previousHash, integrityHash) => buildCanonicalEntry({
      auditId,
      transactionId: buildTransactionId(),
      now,
      timezone: 'UTC',
      moduleName: 'Admin',
      subModule: 'Audit Trail',
      screen: 'Audit Archive',
      collectionName: 'audit_trail_archive',
      recordId: 'archive',
      documentNumber: '',
      actionType: 'Archive',
      actionDescription: `Archived ${archived} audit records before ${beforeDate}`,
      fieldName: '',
      oldValue: '',
      newValue: serializeValue({ archived, beforeDate }),
      changedFields: '',
      actorUid,
      actorName,
      actorRole,
      employeeId: '',
      username: actorName,
      department: String(actor?.department || ''),
      site: '',
      businessUnit: '',
      company: '',
      reason,
      remarks: '',
      ipAddress: 'server',
      deviceInfo: 'cloud-function',
      browserInfo: '',
      operatingSystem: '',
      sessionId: '',
      requestId: '',
      workflowId: '',
      approvalLevel: '',
      eSignatureRequired: false,
      eSignatureStatus: '',
      eSignatureId: '',
      status: 'Success',
      previousHash,
      integrityHash,
    }),
  });

  return { archived, beforeDate };
});

export const verifyAdminAuditIntegrity = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const limit = Math.min(Math.max(Number(data.limit || 50), 1), 200);
  const snap = await firestore.collection('audit_trail')
    .orderBy('dateTime', 'desc')
    .limit(limit)
    .get();

  let verified = 0;
  let mismatches = 0;
  const issues: string[] = [];

  for (const doc of snap.docs) {
    const row = doc.data();
    if (!row.integrityHash || !row.previousHash) {
      issues.push(`${doc.id}: missing integrity fields (legacy record)`);
      continue;
    }
    const expected = computeIntegrityHash([
      String(row.previousHash),
      String(row.auditId),
      String(row.dateTime || row.timestamp),
      String(row.moduleName || row.module),
      String(row.actionType || row.action),
      String(row.recordId || row.documentId),
      String(row.changedByUserId || row.userId),
      serializeValue(row.oldValue),
      serializeValue(row.newValue),
    ]);
    if (expected === row.integrityHash) verified += 1;
    else {
      mismatches += 1;
      issues.push(`${row.auditId || doc.id}: integrity hash mismatch`);
    }
  }

  return { checked: snap.size, verified, mismatches, issues: issues.slice(0, 20) };
});

export const getAdminAuditIntegrityStatus = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const meta = await firestore.collection('system_settings').doc('audit_integrity_chain').get();
  return {
    lastIntegrityHash: meta.data()?.lastIntegrityHash || null,
    lastAuditId: meta.data()?.lastAuditId || null,
    updatedAt: meta.data()?.updatedAt || null,
    chainInitialized: meta.exists,
  };
});
