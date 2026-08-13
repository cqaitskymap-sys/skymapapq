/**
 * Approval Matrix — privileged Cloud Functions.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { type Firestore, type DocumentData, type WriteBatch,
} from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';


function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 500): string {
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
  const reason = requiredString(value, 'Change reason', 500);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

const MATRIX_EDITOR_ROLES = ['super_admin', 'admin'];
const MATRIX_ADMIN_ROLES = ['super_admin', 'admin'];

const APPROVAL_MATRIX_MODULES = [
  'PQR', 'CPV Annual Review', 'Deviation', 'OOS', 'CAPA', 'Change Control',
  'Stability', 'Complaint', 'Recall', 'DMS', 'Audit',
  'Vendor Qualification', 'Validation', 'CSV', 'Equipment', 'Monitoring',
  'Warehouse', 'eBMR', 'Admin Changes',
  'Risk Management', 'Qualification', 'Calibration', 'Maintenance',
  'Supplier Qualification', 'Employee Management', 'CPV',
] as const;

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical', 'All'] as const;
const APPROVAL_MODES = [
  'Sequential', 'Parallel', 'Conditional', 'Quorum', 'Majority', 'Consensus',
] as const;

const LINKED_MATRIX_COLLECTIONS = [
  'deviations', 'capa_records', 'change_controls', 'oos_records',
  'pqr_records', 'documents', 'audit_records',
  'complaints', 'validation_records', 'approval_requests',
] as const;

function buildMatrixId(code: string): string {
  return `AMX-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function assertMatrixEditor(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !MATRIX_EDITOR_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active approval matrix editor access required');
  }
}

function assertMatrixAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !MATRIX_ADMIN_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }
}

function validateEnum<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  const str = String(value ?? fallback);
  if (!allowed.includes(str as T)) {
    throw new HttpsError('invalid-argument', `Invalid ${field}`);
  }
  return str as T;
}

function matrixNotification(
  targetUid: string,
  recordId: string,
  eventName: string,
  title: string,
  message: string,
  now: string,
) {
  return {
    notificationId: `NTF-${Date.now().toString(36).toUpperCase()}-${recordId.slice(0, 6)}`,
    userId: targetUid,
    recipientUserId: targetUid,
    title,
    message,
    type: 'info',
    moduleName: 'Approval Matrix',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/approval-matrix/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeMatrixAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    action: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
    now: string;
  },
) {
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'Approval Matrix',
    recordId: input.recordId,
    action: input.action,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason,
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  batch.set(firestore.collection('audit_trail').doc(), {
    collectionName: 'approval_matrix',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Approval Matrix',
    reason: input.reason,
    timestamp: input.now,
  });
}

function parseMatrixPayload(data: Record<string, unknown>) {
  const matrixCode = requiredString(data.matrixCode, 'Matrix code', 80).toUpperCase();
  const matrixName = requiredString(data.matrixName, 'Matrix name', 200);
  const moduleName = validateEnum(data.moduleName, APPROVAL_MATRIX_MODULES, 'moduleName', 'PQR');
  const department = requiredString(data.department, 'Department', 120);
  const riskLevel = validateEnum(data.riskLevel, RISK_LEVELS, 'riskLevel', 'Medium');
  const approvalMode = validateEnum(data.approvalMode, APPROVAL_MODES, 'approvalMode', 'Sequential');

  const preparedByRole = optionalString(data.preparedByRole, 'preparedByRole', 500);
  const reviewedByRole = optionalString(data.reviewedByRole, 'reviewedByRole', 500);
  const verifiedByRole = optionalString(data.verifiedByRole, 'verifiedByRole', 500);
  const approvedByRole = optionalString(data.approvedByRole, 'approvedByRole', 500);
  const finalApproverRole = optionalString(data.finalApproverRole, 'finalApproverRole', 80);
  const escalationRole = optionalString(data.escalationRole, 'escalationRole', 80);

  const hasApprover = finalApproverRole || approvedByRole || reviewedByRole || verifiedByRole;
  if (!hasApprover) {
    throw new HttpsError('invalid-argument', 'At least one approver role is required');
  }
  if ((riskLevel === 'High' || riskLevel === 'Critical') && !finalApproverRole) {
    throw new HttpsError('invalid-argument', 'Final approver is required for High and Critical risk');
  }
  if (riskLevel === 'Critical' && finalApproverRole !== 'head_qa') {
    throw new HttpsError('invalid-argument', 'Critical risk requires Head QA as final approver');
  }

  const chainRoles = [preparedByRole, reviewedByRole, verifiedByRole, approvedByRole, finalApproverRole]
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  if (chainRoles.length >= 3 && new Set(chainRoles).size === 1) {
    throw new HttpsError('invalid-argument', 'Circular approval chain detected — all levels use the same role');
  }

  const quorumCount = data.quorumCount != null && data.quorumCount !== ''
    ? Math.max(0, Number(data.quorumCount) || 0)
    : null;
  if (approvalMode === 'Quorum' && (!quorumCount || quorumCount < 1)) {
    throw new HttpsError('invalid-argument', 'Quorum count is required for Quorum approval mode');
  }

  const parallelApprovalAllowed = Boolean(data.parallelApprovalAllowed)
    || approvalMode === 'Parallel';
  const sequentialApprovalRequired = data.sequentialApprovalRequired !== false
    && approvalMode !== 'Parallel';
  const conditionalApprovalEnabled = Boolean(data.conditionalApprovalEnabled)
    || approvalMode === 'Conditional';

  const matrixId = buildMatrixId(matrixCode);
  return {
    approvalMatrixId: matrixId,
    matrixId,
    matrixCode,
    matrixName,
    description: optionalString(data.description, 'description', 2000),
    moduleName,
    module: moduleName,
    subModule: optionalString(data.subModule, 'subModule', 120),
    department,
    siteLocation: optionalString(data.siteLocation, 'siteLocation', 120),
    businessUnit: optionalString(data.businessUnit, 'businessUnit', 120),
    workflowCode: optionalString(data.workflowCode, 'workflowCode', 80),
    documentType: optionalString(data.documentType, 'documentType', 120),
    category: optionalString(data.category, 'category', 80),
    priority: optionalString(data.priority, 'priority', 40) || 'Medium',
    productOptional: optionalString(data.productOptional, 'productOptional', 120),
    processOptional: optionalString(data.processOptional, 'processOptional', 120),
    riskLevel,
    approvalMode,
    matrixVersion: optionalString(data.matrixVersion, 'matrixVersion', 20) || '1.0',
    effectiveDate: optionalString(data.effectiveDate, 'effectiveDate', 40),
    reviewDate: optionalString(data.reviewDate, 'reviewDate', 40),
    preparedByRole,
    level1Reviewer: preparedByRole,
    reviewedByRole,
    level2Reviewer: reviewedByRole,
    verifiedByRole,
    approvedByRole,
    finalApproverRole,
    finalApprover: finalApproverRole,
    escalationRole,
    approvalGroup: optionalString(data.approvalGroup, 'approvalGroup', 200),
    quorumCount,
    minimumApprovalLevel: Math.max(1, Number(data.minimumApprovalLevel) || 1),
    slaHours: data.slaHours != null && data.slaHours !== '' ? Math.max(0, Number(data.slaHours) || 0) : null,
    reminderHours: data.reminderHours != null && data.reminderHours !== ''
      ? Math.max(0, Number(data.reminderHours) || 0) : null,
    autoEscalationEnabled: Boolean(data.autoEscalationEnabled),
    autoEscalationHours: data.autoEscalationHours != null && data.autoEscalationHours !== ''
      ? Math.max(0, Number(data.autoEscalationHours) || 0) : null,
    autoApproveEnabled: Boolean(data.autoApproveEnabled),
    allowReject: data.allowReject !== false,
    allowReturn: data.allowReturn !== false,
    allowRework: data.allowRework !== false,
    allowResubmit: data.allowResubmit !== false,
    allowCancel: Boolean(data.allowCancel),
    allowSkip: Boolean(data.allowSkip),
    eSignatureRequired: data.eSignatureRequired !== false,
    eSignRequired: data.eSignatureRequired !== false,
    digitalSignatureRequired: Boolean(data.digitalSignatureRequired),
    approvalCommentRequired: data.approvalCommentRequired !== false,
    mandatoryRemarks: data.approvalCommentRequired !== false,
    parallelApprovalAllowed,
    sequentialApprovalRequired,
    conditionalApprovalEnabled,
    conditionExpression: optionalString(data.conditionExpression, 'conditionExpression', 500),
    delegationAllowed: Boolean(data.delegationAllowed),
    remarks: optionalString(data.remarks, 'remarks', 2000),
  };
}

async function assertUniqueMatrix(
  firestore: Firestore,
  code: string,
  name: string,
  excludeId?: string,
) {
  const [codeSnap, nameSnap] = await Promise.all([
    firestore.collection('approval_matrix').where('matrixCode', '==', code).limit(5).get(),
    firestore.collection('approval_matrix').where('matrixName', '==', name).limit(5).get(),
  ]);
  const codeDup = codeSnap.docs.find((d) => d.id !== excludeId && d.data().isDeleted !== true);
  if (codeDup) throw new HttpsError('already-exists', 'Approval matrix code already exists');
  const nameDup = nameSnap.docs.find((d) => d.id !== excludeId && d.data().isDeleted !== true);
  if (nameDup) throw new HttpsError('already-exists', 'Approval matrix name already exists');
}

async function countLinkedUsage(firestore: Firestore, matrixCode: string, matrixId: string): Promise<number> {
  let total = 0;
  for (const name of LINKED_MATRIX_COLLECTIONS) {
    for (const field of ['matrixCode', 'approvalMatrixCode', 'approvalMatrixId', 'matrixId'] as const) {
      try {
        const value = field.includes('Id') ? matrixId : matrixCode;
        const snap = await firestore.collection(name).where(field, '==', value).limit(2).get();
        total += snap.docs.filter((d) => d.data().isDeleted !== true).length;
      } catch {
        // skip missing indexes/collections
      }
    }
  }
  return total;
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnap = await firestore.collection('users').doc(request.auth.uid).get();
  const actor = actorSnap.data();
  const actorRole = String(actor?.role || '');
  const actorName = String(actor?.full_name || actor?.fullName || actor?.email || 'Admin');
  return { firestore, actor, actorRole, actorName, actorUid: request.auth.uid };
}

export const createAdminApprovalMatrix = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const reason = optionalString(data.reason || data.changeReason, 'reason', 500)
    || 'Initial approval matrix registration';
  const payload = parseMatrixPayload(data);
  await assertUniqueMatrix(firestore, payload.matrixCode, payload.matrixName);

  const now = new Date().toISOString();
  const ref = firestore.collection('approval_matrix').doc();
  const batch = firestore.batch();
  const record = {
    ...payload,
    status: 'Active',
    isArchived: false,
    isDeleted: false,
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
  batch.set(ref, record);
  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, action: 'CREATE_APPROVAL_MATRIX',
    oldValue: null, newValue: record, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), matrixNotification(
    actorUid, ref.id, 'Approval Matrix Created', 'Approval Matrix Created',
    `Matrix ${payload.matrixName} (${payload.matrixCode}) was created.`, now,
  ));
  await batch.commit();
  return { id: ref.id, ...record };
});

export const updateAdminApprovalMatrix = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const matrixDocId = requiredString(data.matrixDocId, 'Matrix ID', 128);
  const reason = requiredReason(data.reason || data.changeReason);
  const existingSnap = await firestore.collection('approval_matrix').doc(matrixDocId).get();
  if (!existingSnap.exists) throw new HttpsError('not-found', 'Approval matrix not found');
  const existing = existingSnap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Cannot update a deleted matrix');

  const updates = (data.updates || data) as Record<string, unknown>;
  const payload = parseMatrixPayload({ ...existing, ...updates });
  await assertUniqueMatrix(firestore, payload.matrixCode, payload.matrixName, matrixDocId);

  const now = new Date().toISOString();
  const batch = firestore.batch();
  const next = {
    ...payload,
    status: existing.status || 'Active',
    isArchived: existing.isArchived ?? false,
    isDeleted: false,
    updatedAt: now,
    updatedBy: actorUid,
  };
  batch.update(existingSnap.ref, next);

  if (existing.riskLevel !== payload.riskLevel) {
    writeMatrixAudit(batch, firestore, {
      actorUid, actorName, recordId: matrixDocId, action: 'RISK_LEVEL_CHANGE',
      oldValue: existing.riskLevel, newValue: payload.riskLevel, reason, now,
    });
  }
  if (existing.eSignatureRequired !== payload.eSignatureRequired) {
    writeMatrixAudit(batch, firestore, {
      actorUid, actorName, recordId: matrixDocId, action: 'ESIGN_SETTING_CHANGE',
      oldValue: existing.eSignatureRequired, newValue: payload.eSignatureRequired, reason, now,
    });
  }
  if (
    existing.preparedByRole !== payload.preparedByRole
    || existing.reviewedByRole !== payload.reviewedByRole
    || existing.finalApproverRole !== payload.finalApproverRole
  ) {
    writeMatrixAudit(batch, firestore, {
      actorUid, actorName, recordId: matrixDocId, action: 'APPROVAL_LEVEL_UPDATED',
      oldValue: {
        prepared: existing.preparedByRole,
        reviewed: existing.reviewedByRole,
        final: existing.finalApproverRole,
      },
      newValue: {
        prepared: payload.preparedByRole,
        reviewed: payload.reviewedByRole,
        final: payload.finalApproverRole,
      },
      reason,
      now,
    });
  }

  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: matrixDocId, action: 'EDIT_APPROVAL_MATRIX',
    oldValue: existing, newValue: next, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), matrixNotification(
    actorUid, matrixDocId, 'Approval Matrix Updated', 'Approval Matrix Updated',
    `Matrix ${payload.matrixName} was updated.`, now,
  ));
  await batch.commit();
  return { matrix: { id: matrixDocId, ...existing, ...next } };
});

export const setAdminApprovalMatrixStatus = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const matrixDocId = requiredString(data.matrixDocId, 'Matrix ID', 128);
  const reason = requiredReason(data.reason);
  const status = validateEnum(data.matrixStatus || data.status, ['Active', 'Inactive'] as const, 'status', 'Active');
  const snap = await firestore.collection('approval_matrix').doc(matrixDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Approval matrix not found');
  const existing = snap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Matrix is deleted');

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, { status, updatedAt: now, updatedBy: actorUid });
  const action = status === 'Active' ? 'ACTIVATE_MATRIX' : 'DEACTIVATE_MATRIX';
  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: matrixDocId, action,
    oldValue: existing.status, newValue: status, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), matrixNotification(
    actorUid, matrixDocId,
    status === 'Active' ? 'Approval Matrix Activated' : 'Approval Matrix Deactivated',
    status === 'Active' ? 'Approval Matrix Activated' : 'Approval Matrix Deactivated',
    `Matrix ${existing.matrixName} is now ${status}.`, now,
  ));
  await batch.commit();
  return { success: true };
});

export const archiveAdminApprovalMatrix = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const matrixDocId = requiredString(data.matrixDocId, 'Matrix ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('approval_matrix').doc(matrixDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Approval matrix not found');
  const existing = snap.data()!;

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    isArchived: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
  });
  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: matrixDocId, action: 'ARCHIVE_MATRIX',
    oldValue: existing, newValue: { isArchived: true }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const softDeleteAdminApprovalMatrix = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const matrixDocId = requiredString(data.matrixDocId, 'Matrix ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('approval_matrix').doc(matrixDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Approval matrix not found');
  const existing = snap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Already deleted');
  if (existing.status === 'Active') {
    throw new HttpsError('failed-precondition', 'Deactivate matrix before deleting');
  }

  const linked = await countLinkedUsage(
    firestore,
    String(existing.matrixCode || ''),
    String(existing.matrixId || matrixDocId),
  );
  if (linked > 0) {
    throw new HttpsError('failed-precondition', `Cannot delete: ${linked} linked QMS record(s) reference this matrix`);
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    isDeleted: true,
    deletedAt: now,
    deletedBy: actorUid,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
  });
  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: matrixDocId, action: 'SOFT_DELETE_MATRIX',
    oldValue: existing, newValue: { isDeleted: true }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const restoreAdminApprovalMatrix = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const matrixDocId = requiredString(data.matrixDocId, 'Matrix ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('approval_matrix').doc(matrixDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Approval matrix not found');
  const existing = snap.data()!;
  if (existing.isDeleted !== true) throw new HttpsError('failed-precondition', 'Matrix is not deleted');

  await assertUniqueMatrix(
    firestore,
    String(existing.matrixCode || ''),
    String(existing.matrixName || ''),
    matrixDocId,
  );

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    isDeleted: false,
    deletedAt: null,
    deletedBy: null,
    updatedAt: now,
    updatedBy: actorUid,
  });
  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: matrixDocId, action: 'RESTORE_MATRIX',
    oldValue: { isDeleted: true }, newValue: { isDeleted: false }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const cloneAdminApprovalMatrix = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const sourceId = requiredString(data.sourceMatrixDocId || data.sourceId, 'Source matrix ID', 128);
  const newCode = requiredString(data.newCode, 'New matrix code', 80).toUpperCase();
  const newName = requiredString(data.newName, 'New matrix name', 200);
  const reason = optionalString(data.reason, 'reason', 500) || `Cloned from ${sourceId}`;

  const sourceSnap = await firestore.collection('approval_matrix').doc(sourceId).get();
  if (!sourceSnap.exists) throw new HttpsError('not-found', 'Source matrix not found');
  const source = sourceSnap.data()!;

  const payload = parseMatrixPayload({
    ...source,
    matrixCode: newCode,
    matrixName: newName,
    remarks: `Cloned from ${source.matrixName}`,
  });
  await assertUniqueMatrix(firestore, payload.matrixCode, payload.matrixName);

  const now = new Date().toISOString();
  const ref = firestore.collection('approval_matrix').doc();
  const batch = firestore.batch();
  const record = {
    ...payload,
    status: 'Inactive',
    isArchived: false,
    isDeleted: false,
    clonedFrom: sourceId,
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
  batch.set(ref, record);
  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, action: 'CLONE_MATRIX',
    oldValue: { sourceId }, newValue: record, reason, now,
  });
  await batch.commit();
  return { id: ref.id, ...record };
});

export const bulkUpdateAdminApprovalMatrices = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const ids = data.matrixDocIds as string[];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
    throw new HttpsError('invalid-argument', 'Select 1–50 matrices');
  }
  const action = validateEnum(
    data.action,
    ['activate', 'deactivate', 'archive'] as const,
    'action',
    'activate',
  );
  const reason = requiredReason(data.reason);
  const now = new Date().toISOString();
  let successCount = 0;

  for (const id of ids) {
    const snap = await firestore.collection('approval_matrix').doc(id).get();
    if (!snap.exists || snap.data()?.isDeleted === true) continue;
    const existing = snap.data()!;
    const batch = firestore.batch();
    if (action === 'archive') {
      batch.update(snap.ref, { isArchived: true, status: 'Inactive', updatedAt: now, updatedBy: actorUid });
    } else {
      const status = action === 'activate' ? 'Active' : 'Inactive';
      batch.update(snap.ref, { status, updatedAt: now, updatedBy: actorUid });
    }
    writeMatrixAudit(batch, firestore, {
      actorUid, actorName, recordId: id, action: `BULK_${action.toUpperCase()}_MATRIX`,
      oldValue: existing.status, newValue: action, reason, now,
    });
    await batch.commit();
    successCount += 1;
  }
  return { successCount };
});

export const bulkSoftDeleteAdminApprovalMatrices = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const ids = data.matrixDocIds as string[];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
    throw new HttpsError('invalid-argument', 'Select 1–50 matrices');
  }
  const reason = requiredReason(data.reason);
  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      const snap = await firestore.collection('approval_matrix').doc(id).get();
      if (!snap.exists) continue;
      const existing = snap.data()!;
      if (existing.isDeleted === true) continue;
      if (existing.status === 'Active') {
        errors.push(`${existing.matrixCode}: deactivate first`);
        continue;
      }
      const linked = await countLinkedUsage(
        firestore,
        String(existing.matrixCode || ''),
        String(existing.matrixId || id),
      );
      if (linked > 0) {
        errors.push(`${existing.matrixCode}: ${linked} linked records`);
        continue;
      }
      const batch = firestore.batch();
      batch.update(snap.ref, {
        isDeleted: true, deletedAt: now, deletedBy: actorUid,
        status: 'Inactive', updatedAt: now, updatedBy: actorUid,
      });
      writeMatrixAudit(batch, firestore, {
        actorUid, actorName, recordId: id, action: 'BULK_SOFT_DELETE_MATRIX',
        oldValue: existing, newValue: { isDeleted: true }, reason, now,
      });
      await batch.commit();
      successCount += 1;
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  return { successCount, errors };
});

export const importAdminApprovalMatrices = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const rows = data.rows as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length < 1) {
    throw new HttpsError('invalid-argument', 'No rows to import');
  }
  if (rows.length > 50) {
    throw new HttpsError('invalid-argument', 'Maximum 50 rows per import');
  }
  const reason = optionalString(data.reason, 'reason', 500) || 'CSV approval matrix import';
  let imported = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    try {
      const payload = parseMatrixPayload(rows[i]);
      await assertUniqueMatrix(firestore, payload.matrixCode, payload.matrixName);
      const ref = firestore.collection('approval_matrix').doc();
      const batch = firestore.batch();
      const record = {
        ...payload,
        status: 'Inactive',
        isArchived: false,
        isDeleted: false,
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      };
      batch.set(ref, record);
      writeMatrixAudit(batch, firestore, {
        actorUid, actorName, recordId: ref.id, action: 'IMPORT_MATRIX',
        oldValue: null, newValue: record, reason, now,
      });
      await batch.commit();
      imported += 1;
    } catch (e) {
      errors.push(`Row ${i + 1}: ${(e as Error).message}`);
    }
  }
  return { imported, errors };
});

export const logAdminApprovalMatrixExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const count = Number(data.count || 0);
  const reason = optionalString(data.reason, 'reason', 500) || 'Approval matrix list export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeMatrixAudit(batch, firestore, {
    actorUid, actorName, recordId: 'export', action: 'EXPORT_MATRIX_LIST',
    oldValue: null, newValue: { count }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const seedAdminDefaultApprovalMatrices = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertMatrixEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const presets = data.presets as Record<string, unknown>[];
  if (!Array.isArray(presets) || presets.length < 1) {
    throw new HttpsError('invalid-argument', 'No presets provided');
  }
  const reason = optionalString(data.reason, 'reason', 500) || 'Seed default approval matrices';
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const preset of presets) {
    try {
      const payload = parseMatrixPayload(preset);
      const existing = await firestore.collection('approval_matrix')
        .where('matrixCode', '==', payload.matrixCode)
        .limit(1)
        .get();
      if (existing.docs.some((d) => d.data().isDeleted !== true)) {
        skipped += 1;
        continue;
      }
      const ref = firestore.collection('approval_matrix').doc();
      const batch = firestore.batch();
      const record = {
        ...payload,
        status: 'Active',
        isArchived: false,
        isDeleted: false,
        createdAt: now,
        createdBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      };
      batch.set(ref, record);
      writeMatrixAudit(batch, firestore, {
        actorUid, actorName, recordId: ref.id, action: 'SEED_MATRIX',
        oldValue: null, newValue: record, reason, now,
      });
      await batch.commit();
      created += 1;
    } catch {
      skipped += 1;
    }
  }
  return { created, skipped };
});
