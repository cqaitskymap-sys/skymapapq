/**
 * Workflow Configuration — privileged Cloud Functions.
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

const WORKFLOW_EDITOR_ROLES = ['super_admin', 'admin'];
const WORKFLOW_ADMIN_ROLES = ['super_admin', 'admin'];

const WORKFLOW_MODULE_OPTIONS = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Audit', 'Vendor', 'Validation',
  'CSV', 'Equipment', 'Monitoring', 'Warehouse', 'eBMR', 'Admin',
  'Risk Management', 'Qualification', 'Calibration', 'Maintenance',
  'Supplier Qualification', 'Employee Management',
] as const;

const WORKFLOW_TYPES = [
  'Single Level Approval', 'Multi Level Approval', 'Parallel Review', 'Sequential Review',
  'Conditional Routing', 'Review + Approval', 'Investigation + Approval',
  'Execution + Review + Approval',
] as const;

const WORKFLOW_STEP_TYPES = [
  'Prepare', 'Submit', 'Review', 'Investigate', 'Execute', 'Verify',
  'Approve', 'Final Approve', 'Close', 'Decision', 'Condition', 'Notification', 'Timer', 'End',
] as const;

const APPROVAL_WORKFLOW_TYPES = [
  'Single Level Approval', 'Multi Level Approval', 'Conditional Routing',
  'Review + Approval', 'Investigation + Approval', 'Execution + Review + Approval',
] as const;

const LINKED_WORKFLOW_COLLECTIONS = [
  'deviations', 'capa_records', 'change_controls', 'oos_records',
  'pqr_records', 'documents', 'audit_records',
  'complaints', 'validation_records',
] as const;

function buildWorkflowId(code: string): string {
  return `WF-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function assertWorkflowEditor(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !WORKFLOW_EDITOR_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active workflow editor access required');
  }
}

function assertWorkflowAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !WORKFLOW_ADMIN_ROLES.includes(actorRole)) {
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

function workflowNotification(
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
    moduleName: 'Workflow Configuration',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/workflows/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeWorkflowAudit(
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
    module: 'Workflow Configuration',
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
    collectionName: 'workflows',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Workflow Configuration',
    reason: input.reason,
    timestamp: input.now,
  });
}

type StepInput = {
  id?: string;
  stepNumber: number;
  stepName: string;
  stepType: string;
  department?: string;
  assignedRole: string;
  assignedUser?: string;
  isMandatory?: boolean;
  canApprove?: boolean;
  canReject?: boolean;
  canSendBack?: boolean;
  requireESignature?: boolean;
  requireComment?: boolean;
  dueDays?: number;
  escalationRole?: string;
  conditionExpression?: string;
  nextStepOnApprove?: string;
  nextStepOnReject?: string;
  isParallel?: boolean;
  status?: string;
};

function validateSteps(steps: unknown): StepInput[] {
  if (!Array.isArray(steps) || steps.length < 1) {
    throw new HttpsError('invalid-argument', 'At least one workflow step is required');
  }
  if (steps.length > 50) {
    throw new HttpsError('invalid-argument', 'Maximum 50 steps allowed');
  }

  const names = new Set<string>();
  const validated: StepInput[] = steps.map((raw, index) => {
    const step = raw as Record<string, unknown>;
    const stepName = requiredString(step.stepName, `Step ${index + 1} name`, 120);
    const key = stepName.toLowerCase();
    if (names.has(key)) {
      throw new HttpsError('invalid-argument', `Duplicate step name "${stepName}" is not allowed`);
    }
    names.add(key);
    const stepType = validateEnum(step.stepType, WORKFLOW_STEP_TYPES, 'stepType', 'Review');
    const assignedRole = requiredString(step.assignedRole, `Step ${index + 1} assigned role`, 80);
    return {
      id: typeof step.id === 'string' ? step.id : undefined,
      stepNumber: index + 1,
      stepName,
      stepType,
      department: optionalString(step.department, 'department', 120),
      assignedRole,
      assignedUser: optionalString(step.assignedUser, 'assignedUser', 120),
      isMandatory: Boolean(step.isMandatory ?? true),
      canApprove: Boolean(step.canApprove),
      canReject: Boolean(step.canReject),
      canSendBack: Boolean(step.canSendBack),
      requireESignature: Boolean(step.requireESignature),
      requireComment: Boolean(step.requireComment),
      dueDays: Math.max(0, Number(step.dueDays ?? 3) || 0),
      escalationRole: optionalString(step.escalationRole, 'escalationRole', 80),
      conditionExpression: optionalString(step.conditionExpression, 'conditionExpression', 500),
      nextStepOnApprove: optionalString(step.nextStepOnApprove, 'nextStepOnApprove', 120),
      nextStepOnReject: optionalString(step.nextStepOnReject, 'nextStepOnReject', 120),
      isParallel: Boolean(step.isParallel),
      status: String(step.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active',
    };
  });

  // Circular routing prevention: next-step references must exist and not form self-loops only
  const nameSet = new Set(validated.map((s) => s.stepName));
  for (const step of validated) {
    if (step.nextStepOnApprove && !nameSet.has(step.nextStepOnApprove)) {
      throw new HttpsError('invalid-argument', `Step "${step.stepName}" nextStepOnApprove references unknown step`);
    }
    if (step.nextStepOnReject && !nameSet.has(step.nextStepOnReject)) {
      throw new HttpsError('invalid-argument', `Step "${step.stepName}" nextStepOnReject references unknown step`);
    }
    if (step.nextStepOnApprove === step.stepName || step.nextStepOnReject === step.stepName) {
      throw new HttpsError('invalid-argument', `Step "${step.stepName}" cannot route to itself`);
    }
  }

  return validated;
}

function parseWorkflowPayload(data: Record<string, unknown>, steps: StepInput[]) {
  const workflowCode = requiredString(data.workflowCode, 'Workflow code', 80).toUpperCase();
  const workflowName = requiredString(data.workflowName, 'Workflow name', 200);
  const moduleName = validateEnum(data.moduleName, WORKFLOW_MODULE_OPTIONS, 'moduleName', 'PQR');
  const workflowType = validateEnum(data.workflowType, WORKFLOW_TYPES, 'workflowType', 'Multi Level Approval');
  const finalApproverRole = optionalString(data.finalApproverRole, 'finalApproverRole', 80);
  const isApproval = (APPROVAL_WORKFLOW_TYPES as readonly string[]).includes(workflowType);
  if (isApproval && !finalApproverRole && !steps.some((s) =>
    s.stepType === 'Final Approve' || s.stepType === 'Approve' || s.stepType === 'End')) {
    throw new HttpsError('invalid-argument', 'Final approver is required for approval workflows');
  }

  const chain = steps.map((s) => s.stepName).join(' → ');
  return {
    workflowId: buildWorkflowId(workflowCode),
    workflowCode,
    workflowName,
    moduleName,
    subModule: optionalString(data.subModule, 'subModule', 120),
    workflowCategory: optionalString(data.workflowCategory, 'workflowCategory', 80) || 'Approval',
    businessUnit: optionalString(data.businessUnit, 'businessUnit', 120),
    site: optionalString(data.site, 'site', 120),
    department: optionalString(data.department, 'department', 120),
    workflowType,
    triggerEvent: optionalString(data.triggerEvent, 'triggerEvent', 200),
    priority: optionalString(data.priority, 'priority', 40) || 'Medium',
    slaHours: data.slaHours != null && data.slaHours !== '' ? Math.max(0, Number(data.slaHours) || 0) : null,
    parallelApproval: Boolean(data.parallelApproval),
    sequentialApproval: data.sequentialApproval !== false,
    conditionalRouting: Boolean(data.conditionalRouting) || workflowType === 'Conditional Routing',
    workflowVersion: optionalString(data.workflowVersion, 'workflowVersion', 20) || '1.0',
    effectiveDate: optionalString(data.effectiveDate, 'effectiveDate', 40),
    reviewDate: optionalString(data.reviewDate, 'reviewDate', 40),
    expiryDate: optionalString(data.expiryDate, 'expiryDate', 40),
    initiatorRole: optionalString(data.initiatorRole, 'initiatorRole', 80),
    reviewerRoles: optionalString(data.reviewerRoles, 'reviewerRoles', 500),
    reviewerRole: optionalString(data.reviewerRoles, 'reviewerRoles', 500),
    approverRoles: optionalString(data.approverRoles, 'approverRoles', 500),
    finalApproverRole,
    approverRole: finalApproverRole,
    escalationRole: optionalString(data.escalationRole, 'escalationRole', 80),
    approvalLevels: Math.max(1, Number(data.approvalLevels) || steps.length),
    requireESignature: data.requireESignature !== false,
    requireRemarks: data.requireRemarks !== false,
    allowRejection: data.allowRejection !== false,
    allowResubmission: data.allowResubmission !== false,
    allowDelegation: Boolean(data.allowDelegation),
    autoEscalationEnabled: Boolean(data.autoEscalationEnabled),
    autoEscalationDays: Math.max(0, Number(data.escalationDays ?? data.autoEscalationDays ?? 3) || 0),
    escalationDays: Math.max(0, Number(data.escalationDays ?? 3) || 0),
    targetCompletionDays: Math.max(0, Number(data.targetCompletionDays ?? 30) || 0),
    description: optionalString(data.description, 'description', 2000),
    remarks: optionalString(data.remarks, 'remarks', 2000),
    workflowChain: chain,
  };
}

async function assertUniqueWorkflow(
  firestore: Firestore,
  code: string,
  name: string,
  excludeId?: string,
) {
  const [codeSnap, nameSnap] = await Promise.all([
    firestore.collection('workflows').where('workflowCode', '==', code).limit(5).get(),
    firestore.collection('workflows').where('workflowName', '==', name).limit(5).get(),
  ]);
  const codeDup = codeSnap.docs.find((d) => d.id !== excludeId && d.data().isDeleted !== true);
  if (codeDup) throw new HttpsError('already-exists', 'Workflow code already exists');
  const nameDup = nameSnap.docs.find((d) => d.id !== excludeId && d.data().isDeleted !== true);
  if (nameDup) throw new HttpsError('already-exists', 'Workflow name already exists');
}

async function syncSteps(
  firestore: Firestore,
  batch: WriteBatch,
  workflowDocId: string,
  steps: StepInput[],
  now: string,
  actorUid: string,
) {
  const existingSnap = await firestore.collection('workflow_steps')
    .where('workflowId', '==', workflowDocId)
    .get();
  const existingById = new Map(existingSnap.docs.map((d) => [d.id, d]));
  const keepIds = new Set(steps.map((s) => s.id).filter(Boolean) as string[]);

  for (const doc of existingSnap.docs) {
    if (!keepIds.has(doc.id) && doc.data().isDeleted !== true) {
      batch.update(doc.ref, {
        isDeleted: true,
        deletedAt: now,
        deletedBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      });
    }
  }

  for (const step of steps) {
    const payload = {
      ...step,
      workflowId: workflowDocId,
      isDeleted: false,
      updatedAt: now,
      updatedBy: actorUid,
    };
    if (step.id && existingById.has(step.id)) {
      batch.update(existingById.get(step.id)!.ref, payload);
    } else {
      const ref = firestore.collection('workflow_steps').doc();
      batch.set(ref, {
        ...payload,
        createdAt: now,
        createdBy: actorUid,
        status: step.status || 'Active',
      });
    }
  }
}

async function countLinkedUsage(firestore: Firestore, workflowCode: string, workflowId: string): Promise<number> {
  let total = 0;
  for (const name of LINKED_WORKFLOW_COLLECTIONS) {
    try {
      const snap = await firestore.collection(name)
        .where('workflowCode', '==', workflowCode)
        .limit(3)
        .get();
      total += snap.docs.filter((d) => d.data().isDeleted !== true).length;
    } catch {
      // skip missing indexes/collections
    }
    try {
      const snap = await firestore.collection(name)
        .where('workflowId', '==', workflowId)
        .limit(3)
        .get();
      total += snap.docs.filter((d) => d.data().isDeleted !== true).length;
    } catch {
      // skip
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

export const createAdminWorkflow = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const reason = optionalString(data.reason || data.changeReason, 'reason', 500)
    || 'Initial workflow registration';
  const steps = validateSteps(data.steps);
  const payload = parseWorkflowPayload(data, steps);
  await assertUniqueWorkflow(firestore, payload.workflowCode, payload.workflowName);

  const now = new Date().toISOString();
  const ref = firestore.collection('workflows').doc();
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
  await syncSteps(firestore, batch, ref.id, steps, now, actorUid);
  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, action: 'CREATE_WORKFLOW',
    oldValue: null, newValue: record, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), workflowNotification(
    actorUid, ref.id, 'Workflow Created', 'Workflow Created',
    `Workflow ${payload.workflowName} (${payload.workflowCode}) was created.`, now,
  ));
  await batch.commit();
  return { id: ref.id, ...record };
});

export const updateAdminWorkflow = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const workflowDocId = requiredString(data.workflowDocId, 'Workflow ID', 128);
  const reason = requiredReason(data.reason || data.changeReason);
  const existingSnap = await firestore.collection('workflows').doc(workflowDocId).get();
  if (!existingSnap.exists) throw new HttpsError('not-found', 'Workflow not found');
  const existing = existingSnap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Cannot update a deleted workflow');

  const updates = (data.updates || data) as Record<string, unknown>;
  const steps = validateSteps(updates.steps ?? data.steps);
  const payload = parseWorkflowPayload({ ...existing, ...updates }, steps);
  await assertUniqueWorkflow(firestore, payload.workflowCode, payload.workflowName, workflowDocId);

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
  await syncSteps(firestore, batch, workflowDocId, steps, now, actorUid);
  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: workflowDocId, action: 'EDIT_WORKFLOW',
    oldValue: existing, newValue: next, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), workflowNotification(
    actorUid, workflowDocId, 'Workflow Updated', 'Workflow Updated',
    `Workflow ${payload.workflowName} was updated.`, now,
  ));
  await batch.commit();
  return { workflow: { id: workflowDocId, ...existing, ...next } };
});

export const setAdminWorkflowStatus = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const workflowDocId = requiredString(data.workflowDocId, 'Workflow ID', 128);
  const reason = requiredReason(data.reason);
  const status = validateEnum(data.workflowStatus || data.status, ['Active', 'Inactive'] as const, 'status', 'Active');
  const snap = await firestore.collection('workflows').doc(workflowDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Workflow not found');
  const existing = snap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Workflow is deleted');

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, { status, updatedAt: now, updatedBy: actorUid });
  const action = status === 'Active' ? 'ACTIVATE_WORKFLOW' : 'DEACTIVATE_WORKFLOW';
  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: workflowDocId, action,
    oldValue: existing.status, newValue: status, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), workflowNotification(
    actorUid, workflowDocId, status === 'Active' ? 'Workflow Activated' : 'Workflow Deactivated',
    status === 'Active' ? 'Workflow Activated' : 'Workflow Deactivated',
    `Workflow ${existing.workflowName} is now ${status}.`, now,
  ));
  await batch.commit();
  return { success: true };
});

export const archiveAdminWorkflow = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const workflowDocId = requiredString(data.workflowDocId, 'Workflow ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('workflows').doc(workflowDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Workflow not found');
  const existing = snap.data()!;

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    isArchived: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
  });
  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: workflowDocId, action: 'ARCHIVE_WORKFLOW',
    oldValue: existing, newValue: { isArchived: true }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const softDeleteAdminWorkflow = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const workflowDocId = requiredString(data.workflowDocId, 'Workflow ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('workflows').doc(workflowDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Workflow not found');
  const existing = snap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Already deleted');
  if (existing.status === 'Active') {
    throw new HttpsError('failed-precondition', 'Deactivate workflow before deleting');
  }

  const linked = await countLinkedUsage(
    firestore,
    String(existing.workflowCode || ''),
    String(existing.workflowId || workflowDocId),
  );
  if (linked > 0) {
    throw new HttpsError('failed-precondition', `Cannot delete: ${linked} linked QMS record(s) reference this workflow`);
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

  const stepsSnap = await firestore.collection('workflow_steps')
    .where('workflowId', '==', workflowDocId)
    .get();
  for (const stepDoc of stepsSnap.docs) {
    if (stepDoc.data().isDeleted !== true) {
      batch.update(stepDoc.ref, {
        isDeleted: true,
        deletedAt: now,
        deletedBy: actorUid,
        updatedAt: now,
        updatedBy: actorUid,
      });
    }
  }

  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: workflowDocId, action: 'SOFT_DELETE_WORKFLOW',
    oldValue: existing, newValue: { isDeleted: true }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const restoreAdminWorkflow = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const workflowDocId = requiredString(data.workflowDocId, 'Workflow ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('workflows').doc(workflowDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Workflow not found');
  const existing = snap.data()!;
  if (existing.isDeleted !== true) throw new HttpsError('failed-precondition', 'Workflow is not deleted');

  await assertUniqueWorkflow(
    firestore,
    String(existing.workflowCode || ''),
    String(existing.workflowName || ''),
    workflowDocId,
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

  const stepsSnap = await firestore.collection('workflow_steps')
    .where('workflowId', '==', workflowDocId)
    .get();
  for (const stepDoc of stepsSnap.docs) {
    batch.update(stepDoc.ref, {
      isDeleted: false,
      deletedAt: null,
      deletedBy: null,
      updatedAt: now,
      updatedBy: actorUid,
    });
  }

  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: workflowDocId, action: 'RESTORE_WORKFLOW',
    oldValue: { isDeleted: true }, newValue: { isDeleted: false }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const cloneAdminWorkflow = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const sourceId = requiredString(data.sourceWorkflowDocId || data.sourceId, 'Source workflow ID', 128);
  const newCode = requiredString(data.newCode, 'New workflow code', 80).toUpperCase();
  const newName = requiredString(data.newName, 'New workflow name', 200);
  const reason = optionalString(data.reason, 'reason', 500) || `Cloned from ${sourceId}`;

  const sourceSnap = await firestore.collection('workflows').doc(sourceId).get();
  if (!sourceSnap.exists) throw new HttpsError('not-found', 'Source workflow not found');
  const source = sourceSnap.data()!;

  const stepsSnap = await firestore.collection('workflow_steps')
    .where('workflowId', '==', sourceId)
    .get();
  const steps = stepsSnap.docs
    .map((d) => d.data())
    .filter((s) => s.isDeleted !== true)
    .sort((a, b) => Number(a.stepNumber) - Number(b.stepNumber))
    .map((s, i) => ({
      stepNumber: i + 1,
      stepName: String(s.stepName),
      stepType: String(s.stepType),
      department: String(s.department || ''),
      assignedRole: String(s.assignedRole),
      assignedUser: String(s.assignedUser || ''),
      isMandatory: Boolean(s.isMandatory ?? true),
      canApprove: Boolean(s.canApprove),
      canReject: Boolean(s.canReject),
      canSendBack: Boolean(s.canSendBack),
      requireESignature: Boolean(s.requireESignature),
      requireComment: Boolean(s.requireComment),
      dueDays: Number(s.dueDays ?? 3),
      escalationRole: String(s.escalationRole || ''),
      conditionExpression: String(s.conditionExpression || ''),
      nextStepOnApprove: String(s.nextStepOnApprove || ''),
      nextStepOnReject: String(s.nextStepOnReject || ''),
      isParallel: Boolean(s.isParallel),
      status: 'Active',
    }));

  const validatedSteps = validateSteps(steps);
  const payload = parseWorkflowPayload({
    ...source,
    workflowCode: newCode,
    workflowName: newName,
    description: `Cloned from ${source.workflowName}`,
  }, validatedSteps);
  await assertUniqueWorkflow(firestore, payload.workflowCode, payload.workflowName);

  const now = new Date().toISOString();
  const ref = firestore.collection('workflows').doc();
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
  await syncSteps(firestore, batch, ref.id, validatedSteps, now, actorUid);
  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, action: 'CLONE_WORKFLOW',
    oldValue: { sourceId }, newValue: record, reason, now,
  });
  await batch.commit();
  return { id: ref.id, ...record };
});

export const bulkUpdateAdminWorkflows = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const ids = data.workflowDocIds as string[];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
    throw new HttpsError('invalid-argument', 'Select 1–50 workflows');
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
    const snap = await firestore.collection('workflows').doc(id).get();
    if (!snap.exists || snap.data()?.isDeleted === true) continue;
    const existing = snap.data()!;
    const batch = firestore.batch();
    if (action === 'archive') {
      batch.update(snap.ref, { isArchived: true, status: 'Inactive', updatedAt: now, updatedBy: actorUid });
    } else {
      const status = action === 'activate' ? 'Active' : 'Inactive';
      batch.update(snap.ref, { status, updatedAt: now, updatedBy: actorUid });
    }
    writeWorkflowAudit(batch, firestore, {
      actorUid, actorName, recordId: id, action: `BULK_${action.toUpperCase()}_WORKFLOW`,
      oldValue: existing.status, newValue: action, reason, now,
    });
    await batch.commit();
    successCount += 1;
  }
  return { successCount };
});

export const bulkSoftDeleteAdminWorkflows = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const ids = data.workflowDocIds as string[];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
    throw new HttpsError('invalid-argument', 'Select 1–50 workflows');
  }
  const reason = requiredReason(data.reason);
  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      const snap = await firestore.collection('workflows').doc(id).get();
      if (!snap.exists) continue;
      const existing = snap.data()!;
      if (existing.isDeleted === true) continue;
      if (existing.status === 'Active') {
        errors.push(`${existing.workflowCode}: deactivate first`);
        continue;
      }
      const linked = await countLinkedUsage(
        firestore,
        String(existing.workflowCode || ''),
        String(existing.workflowId || id),
      );
      if (linked > 0) {
        errors.push(`${existing.workflowCode}: ${linked} linked records`);
        continue;
      }
      const batch = firestore.batch();
      batch.update(snap.ref, {
        isDeleted: true, deletedAt: now, deletedBy: actorUid,
        status: 'Inactive', updatedAt: now, updatedBy: actorUid,
      });
      writeWorkflowAudit(batch, firestore, {
        actorUid, actorName, recordId: id, action: 'BULK_SOFT_DELETE_WORKFLOW',
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

export const importAdminWorkflows = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const rows = data.rows as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length < 1) {
    throw new HttpsError('invalid-argument', 'No rows to import');
  }
  if (rows.length > 50) {
    throw new HttpsError('invalid-argument', 'Maximum 50 rows per import');
  }
  const reason = optionalString(data.reason, 'reason', 500) || 'CSV workflow import';
  let imported = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const defaultStep: StepInput = {
        stepNumber: 1,
        stepName: 'Submit',
        stepType: 'Submit',
        assignedRole: String(row.initiatorRole || 'qa_executive'),
        isMandatory: true,
        canApprove: false,
        canReject: false,
        canSendBack: false,
        requireESignature: false,
        requireComment: true,
        dueDays: 3,
        status: 'Active',
      };
      const finalStep: StepInput = {
        stepNumber: 2,
        stepName: 'Final Approve',
        stepType: 'Final Approve',
        assignedRole: String(row.finalApproverRole || 'head_qa'),
        isMandatory: true,
        canApprove: true,
        canReject: true,
        canSendBack: true,
        requireESignature: true,
        requireComment: true,
        dueDays: 3,
        status: 'Active',
      };
      const steps = validateSteps([defaultStep, finalStep]);
      const payload = parseWorkflowPayload(row, steps);
      await assertUniqueWorkflow(firestore, payload.workflowCode, payload.workflowName);
      const ref = firestore.collection('workflows').doc();
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
      await syncSteps(firestore, batch, ref.id, steps, now, actorUid);
      writeWorkflowAudit(batch, firestore, {
        actorUid, actorName, recordId: ref.id, action: 'IMPORT_WORKFLOW',
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

export const logAdminWorkflowExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const count = Number(data.count || 0);
  const reason = optionalString(data.reason, 'reason', 500) || 'Workflow list export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeWorkflowAudit(batch, firestore, {
    actorUid, actorName, recordId: 'export', action: 'EXPORT_WORKFLOW_LIST',
    oldValue: null, newValue: { count }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const seedAdminDefaultWorkflows = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const presets = data.presets as Record<string, unknown>[];
  if (!Array.isArray(presets) || presets.length < 1) {
    throw new HttpsError('invalid-argument', 'No presets provided');
  }
  const reason = optionalString(data.reason, 'reason', 500) || 'Seed default workflows';
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const preset of presets) {
    try {
      const steps = validateSteps(preset.steps);
      const payload = parseWorkflowPayload(preset, steps);
      const existing = await firestore.collection('workflows')
        .where('workflowCode', '==', payload.workflowCode)
        .limit(1)
        .get();
      if (existing.docs.some((d) => d.data().isDeleted !== true)) {
        skipped += 1;
        continue;
      }
      const ref = firestore.collection('workflows').doc();
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
      await syncSteps(firestore, batch, ref.id, steps, now, actorUid);
      writeWorkflowAudit(batch, firestore, {
        actorUid, actorName, recordId: ref.id, action: 'SEED_WORKFLOW',
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

export const validateAdminWorkflowDesign = onCall({ cors: true }, async (request) => {
  const { actor, actorRole } = await resolveActor(request);
  assertWorkflowEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  try {
    const steps = validateSteps(data.steps);
    parseWorkflowPayload(data, steps);
    return {
      valid: true,
      errors: [] as string[],
      warnings: steps.length > 15 ? ['Large workflows may impact performance'] : [],
      stepCount: steps.length,
      chain: steps.map((s) => s.stepName).join(' → '),
    };
  } catch (e) {
    return {
      valid: false,
      errors: [(e as Error).message],
      warnings: [] as string[],
      stepCount: 0,
      chain: '',
    };
  }
});
