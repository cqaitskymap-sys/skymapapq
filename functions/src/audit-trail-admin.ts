/**
 * Audit Trail — privileged Cloud Functions.
 * Append-only, integrity-hashed, dual-collection writes for 21 CFR Part 11 / ALCOA+.
 */
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore, type Firestore, type DocumentData,
} from 'firebase-admin/firestore';

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
  initializeAdmin();
  const firestore = getFirestore();
  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = snap.data();
  const actorRole = String(actor?.role || '');
  const actorName = String(actor?.full_name || actor?.email || request.auth.uid);
  return { firestore, actor, actorRole, actorName, actorUid: request.auth.uid };
}

async function getPreviousIntegrityHash(firestore: Firestore): Promise<string> {
  const meta = await firestore.collection('system_settings').doc('audit_integrity_chain').get();
  return String(meta.data()?.lastIntegrityHash || 'GENESIS');
}

async function updateIntegrityChain(
  firestore: Firestore,
  hash: string,
  auditId: string,
  now: string,
) {
  await firestore.collection('system_settings').doc('audit_integrity_chain').set({
    lastIntegrityHash: hash,
    lastAuditId: auditId,
    updatedAt: now,
  }, { merge: true });
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

/**
 * Trusted append-only audit writer used by all SkyMap modules.
 */
export const appendAdminAuditTrail = onCall({ cors: true }, async (request) => {
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
  const previousHash = await getPreviousIntegrityHash(firestore);
  const integrityHash = computeIntegrityHash([
    previousHash, auditId, now, moduleName, actionType, recordId, actorUid, oldValue, newValue,
  ]);

  const entry = buildCanonicalEntry({
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
    actorName: optionalString(data.userName, 'userName', 200) || actorName,
    actorRole: optionalString(data.role || data.changedByRole, 'role', 80) || actorRole,
    employeeId: optionalString(data.employeeId, 'employeeId', 80)
      || String(actor?.employee_id || actor?.employeeId || ''),
    username: optionalString(data.username, 'username', 120)
      || String(actor?.email || actorName),
    department: optionalString(data.department, 'department', 120)
      || String(actor?.department || ''),
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
  });

  const trailRef = firestore.collection('audit_trail').doc();
  const logsRef = firestore.collection('audit_logs').doc();
  const batch = firestore.batch();
  batch.set(trailRef, entry);
  batch.set(logsRef, {
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

  if (CRITICAL_ACTIONS.has(actionType) || entry.status === 'Failed') {
    batch.set(firestore.collection('notifications').doc(), {
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

  await batch.commit();
  await updateIntegrityChain(firestore, integrityHash, auditId, now);
  await maybeSecurityAlert(firestore, actorUid, actionType, now).catch(() => undefined);

  return { id: trailRef.id, auditId, transactionId, integrityHash, previousHash };
});

export const logAdminAuditTrailExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const format = optionalString(data.format, 'format', 40) || 'Excel';
  const count = Number(data.count || 0);
  const reason = optionalString(data.reason, 'reason', 500) || `Audit trail exported as ${format}`;

  // Inline append to avoid nested callable
  const now = new Date().toISOString();
  const auditId = buildAuditId();
  const previousHash = await getPreviousIntegrityHash(firestore);
  const integrityHash = computeIntegrityHash([
    previousHash, auditId, now, 'Admin', 'Export', 'export', actorUid, '', JSON.stringify({ format, count }),
  ]);
  const entry = buildCanonicalEntry({
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
  });

  const batch = firestore.batch();
  const trailRef = firestore.collection('audit_trail').doc();
  batch.set(trailRef, entry);
  batch.set(firestore.collection('audit_exports').doc(), {
    exportedAt: now,
    exportedBy: actorUid,
    exportedByName: actorName,
    format,
    count,
    reason,
    auditId,
  });
  await batch.commit();
  await updateIntegrityChain(firestore, integrityHash, auditId, now);
  return { success: true, auditId };
});

/**
 * Copy aged records into audit_trail_archive (originals remain immutable).
 */
export const archiveAdminAuditTrail = onCall({ cors: true }, async (request) => {
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

  // Log the archive operation itself
  const auditId = buildAuditId();
  const previousHash = await getPreviousIntegrityHash(firestore);
  const integrityHash = computeIntegrityHash([
    previousHash, auditId, now, 'Admin', 'Archive', 'archive', actorUid, '', String(archived),
  ]);
  await firestore.collection('audit_trail').doc().set(buildCanonicalEntry({
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
  }));
  await updateIntegrityChain(firestore, integrityHash, auditId, now);

  return { archived, beforeDate };
});

export const verifyAdminAuditIntegrity = onCall({ cors: true }, async (request) => {
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

export const getAdminAuditIntegrityStatus = onCall({ cors: true }, async (request) => {
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
