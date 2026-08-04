/**
 * Parameter Master — privileged Cloud Functions.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore, type Firestore, type DocumentData, type WriteBatch, FieldValue,
} from 'firebase-admin/firestore';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

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

const PARAMETER_EDITOR_ROLES = [
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'qc_manager', 'qc_executive', 'production_manager', 'production_executive',
  'engineering_manager', 'engineering_executive',
];

const PARAMETER_ADMIN_ROLES = ['super_admin', 'admin'];

const PARAMETER_TYPES = [
  'CPP', 'CQA', 'IPC', 'Finished Product Test', 'Stability Test',
  'Utility Parameter', 'Environmental Parameter', 'Raw Material Test',
  'Packing Material Test', 'Yield Parameter',
] as const;

const PARAMETER_CATEGORIES = [
  'Manufacturing', 'Quality Control', 'Microbiology', 'Stability',
  'Utility', 'Environmental', 'Packaging', 'Warehouse', 'Validation',
  'Quality Parameters', 'Manufacturing Parameters', 'Process Parameters',
  'Critical Process Parameters (CPP)', 'Critical Quality Attributes (CQA)',
  'Laboratory Parameters', 'Equipment Parameters', 'Calibration Parameters',
  'Maintenance Parameters', 'Environmental Monitoring', 'Water System', 'HVAC',
  'Utility Monitoring', 'Validation Parameters', 'Cleaning Validation',
  'Process Validation', 'Stability Parameters', 'Audit Parameters',
  'Risk Parameters', 'Custom Parameters',
] as const;

const PARAMETER_GROUPS = [
  'CPP Group', 'CQA Group', 'IPC Group', 'Utility Group', 'Environmental Group',
  'Stability Group', 'Validation Group', 'Equipment Group', 'General',
] as const;

const PARAMETER_MODULE_OPTIONS = [
  'CPV', 'APQR / PQR', 'Validation', 'LIMS', 'Equipment', 'Calibration',
  'Maintenance', 'Environmental Monitoring', 'Water System', 'HVAC',
  'Manufacturing', 'Quality Control', 'Quality Assurance', 'Risk Assessment',
  'CAPA', 'Deviation', 'Change Control', 'Document Management',
  'General',
] as const;

const PARAMETER_DATA_TYPES = [
  'Numeric', 'Text', 'Boolean', 'Dropdown', 'Multi Select', 'Formula',
] as const;

const PARAMETER_CALCULATION_TYPES = [
  'Manual', 'Formula Based', 'Auto Calculated', 'Derived',
] as const;

const PROCESS_STAGES = [
  'Dispensing', 'Mixing', 'pH Adjustment', 'Filtration', 'Sterilization',
  'Vial Washing', 'Depyrogenation', 'Filling', 'Sealing', 'Visual Inspection',
  'Packing', 'Finished Product Testing', 'Stability Testing',
  'Utility Monitoring', 'Environmental Monitoring',
] as const;

const CRITICALITY_OPTIONS = ['Critical', 'Major', 'Minor'] as const;
const FREQUENCY_OPTIONS = [
  'Per Batch', 'Hourly', 'Daily', 'Weekly', 'Monthly',
  'Quarterly', 'Yearly', 'As Required',
] as const;
const RESULT_TYPES = ['Numeric', 'Text', 'Pass/Fail', 'Complies/Does Not Comply'] as const;

const LINKED_PARAMETER_COLLECTIONS: Array<{ name: string; idField?: string; codeField: string }> = [
  { name: 'cpp_results', idField: 'parameterId', codeField: 'parameterCode' },
  { name: 'cqa_results', idField: 'parameterId', codeField: 'parameterCode' },
  { name: 'cpv_cpp', codeField: 'parameterCode' },
  { name: 'cpv_cqa', codeField: 'parameterCode' },
  { name: 'cpp_parameters', idField: 'parameterId', codeField: 'parameterCode' },
  { name: 'cqa_parameters', idField: 'parameterId', codeField: 'parameterCode' },
  { name: 'validation_records', codeField: 'parameter_code' },
  { name: 'capa_records', codeField: 'parameter_code' },
  { name: 'deviations', codeField: 'parameter_code' },
  { name: 'change_controls', codeField: 'parameter_code' },
];

function buildParameterId(code: string): string {
  return `PARAM-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function assertParameterEditor(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !PARAMETER_EDITOR_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active parameter editor access required');
  }
}

function assertParameterAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !PARAMETER_ADMIN_ROLES.includes(actorRole)) {
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

function parameterNotification(
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
    moduleName: 'Parameter Master',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/parameters/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeParameterAudit(
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
    module: 'Parameter Master',
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
    collectionName: 'parameters',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Parameter Master',
    reason: input.reason,
    timestamp: input.now,
  });
}

function validateNumericLimits(input: Record<string, unknown>) {
  const resultType = String(input.resultType || 'Numeric');
  if (resultType !== 'Numeric') return;
  const lower = Number(input.lowerLimit ?? input.lsl);
  const upper = Number(input.upperLimit ?? input.usl);
  if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
    throw new HttpsError('invalid-argument', 'Lower and upper limits are required for numeric parameters');
  }
  if (upper <= lower) {
    throw new HttpsError('invalid-argument', 'Upper limit must be greater than lower limit');
  }
  const checkWithin = (value: unknown, label: string) => {
    if (value == null || value === '') return;
    const num = Number(value);
    if (!Number.isFinite(num) || num < lower || num > upper) {
      throw new HttpsError('invalid-argument', `${label} must be within specification limits`);
    }
  };
  checkWithin(input.alertLimitLow, 'Alert limit low');
  checkWithin(input.alertLimitHigh, 'Alert limit high');
  checkWithin(input.actionLimitLow, 'Action limit low');
  checkWithin(input.actionLimitHigh, 'Action limit high');
  checkWithin(input.criticalLimit, 'Critical limit');
}

function parseParameterPayload(input: Record<string, unknown>, existing?: DocumentData) {
  const parameterCode = requiredString(input.parameterCode ?? existing?.parameterCode, 'parameterCode', 40).toUpperCase();
  const parameterName = requiredString(input.parameterName ?? existing?.parameterName, 'parameterName', 200);
  const parameterType = validateEnum(input.parameterType ?? existing?.parameterType, PARAMETER_TYPES, 'parameterType', 'CPP');
  const parameterCategory = validateEnum(
    input.parameterCategory ?? existing?.parameterCategory,
    PARAMETER_CATEGORIES,
    'parameterCategory',
    'Manufacturing',
  );
  const parameterGroup = validateEnum(
    input.parameterGroup ?? existing?.parameterGroup,
    PARAMETER_GROUPS,
    'parameterGroup',
    'General',
  );
  const moduleName = validateEnum(
    input.moduleName ?? existing?.moduleName,
    PARAMETER_MODULE_OPTIONS,
    'moduleName',
    'General',
  );
  const dataType = validateEnum(input.dataType ?? existing?.dataType, PARAMETER_DATA_TYPES, 'dataType', 'Numeric');
  const calculationType = validateEnum(
    input.calculationType ?? existing?.calculationType,
    PARAMETER_CALCULATION_TYPES,
    'calculationType',
    'Manual',
  );
  const resultType = validateEnum(input.resultType ?? existing?.resultType, RESULT_TYPES, 'resultType', 'Numeric');
  const processStage = validateEnum(input.processStage ?? existing?.processStage, PROCESS_STAGES, 'processStage', 'Mixing');
  const frequency = validateEnum(input.frequency ?? existing?.frequency, FREQUENCY_OPTIONS, 'frequency', 'Per Batch');
  const criticality = validateEnum(input.criticality ?? existing?.criticality, CRITICALITY_OPTIONS, 'criticality', 'Major');

  const productLink = optionalString(input.productLink ?? existing?.productLink ?? existing?.product, 'productLink', 80);
  const lowerLimit = optionalString(input.lowerLimit ?? existing?.lowerLimit ?? existing?.lsl, 'lowerLimit', 40);
  const upperLimit = optionalString(input.upperLimit ?? existing?.upperLimit ?? existing?.usl, 'upperLimit', 40);
  const targetValue = optionalString(input.targetValue ?? existing?.targetValue ?? existing?.target, 'targetValue', 40);

  validateNumericLimits({
    resultType,
    lowerLimit,
    upperLimit,
    alertLimitLow: input.alertLimitLow ?? existing?.alertLimitLow,
    alertLimitHigh: input.alertLimitHigh ?? existing?.alertLimitHigh,
    actionLimitLow: input.actionLimitLow ?? existing?.actionLimitLow,
    actionLimitHigh: input.actionLimitHigh ?? existing?.actionLimitHigh,
    criticalLimit: input.criticalLimit ?? existing?.criticalLimit,
  });

  if (resultType === 'Numeric' && !optionalString(input.unit ?? existing?.unit, 'unit', 40)) {
    throw new HttpsError('invalid-argument', 'Unit is required for numeric parameters');
  }

  const displayOrderRaw = input.displayOrder ?? existing?.displayOrder;
  const displayOrder = displayOrderRaw == null || displayOrderRaw === ''
    ? undefined
    : Number(displayOrderRaw);

  return {
    parameterId: buildParameterId(parameterCode),
    parameterCode,
    parameterName,
    shortName: optionalString(input.shortName ?? existing?.shortName, 'shortName', 80),
    description: optionalString(input.description ?? existing?.description, 'description', 2000),
    parameterType,
    parameterCategory,
    parameterGroup,
    moduleName,
    subModule: optionalString(input.subModule ?? existing?.subModule, 'subModule', 120),
    productLink,
    product: productLink,
    productCategory: optionalString(input.productCategory ?? existing?.productCategory, 'productCategory', 160),
    processStage,
    department: optionalString(input.department ?? existing?.department, 'department', 120),
    testMethodStp: optionalString(input.testMethodStp ?? existing?.testMethodStp, 'testMethodStp', 120),
    specificationNo: optionalString(input.specificationNo ?? existing?.specificationNo, 'specificationNo', 80),
    targetValue,
    target: targetValue,
    lowerLimit,
    lsl: lowerLimit,
    upperLimit,
    usl: upperLimit,
    alertLimitLow: optionalString(input.alertLimitLow ?? existing?.alertLimitLow, 'alertLimitLow', 40),
    alertLimitHigh: optionalString(input.alertLimitHigh ?? existing?.alertLimitHigh, 'alertLimitHigh', 40),
    actionLimitLow: optionalString(input.actionLimitLow ?? existing?.actionLimitLow, 'actionLimitLow', 40),
    actionLimitHigh: optionalString(input.actionLimitHigh ?? existing?.actionLimitHigh, 'actionLimitHigh', 40),
    criticalLimit: optionalString(input.criticalLimit ?? existing?.criticalLimit, 'criticalLimit', 40),
    defaultValue: optionalString(input.defaultValue ?? existing?.defaultValue, 'defaultValue', 120),
    precision: optionalString(input.precision ?? existing?.precision, 'precision', 20),
    formula: optionalString(input.formula ?? existing?.formula, 'formula', 500),
    dataType,
    calculationType,
    unit: optionalString(input.unit ?? existing?.unit, 'unit', 40),
    resultType,
    frequency,
    criticality,
    mandatory: Boolean(input.mandatory ?? existing?.mandatory ?? false),
    displayOrder: Number.isFinite(displayOrder) ? displayOrder : undefined,
    sequenceNumber: optionalString(input.sequenceNumber ?? existing?.sequenceNumber, 'sequenceNumber', 40),
    applicableSite: optionalString(input.applicableSite ?? existing?.applicableSite, 'applicableSite', 160),
    businessUnit: optionalString(input.businessUnit ?? existing?.businessUnit, 'businessUnit', 160),
    ootApplicable: Boolean(input.ootApplicable ?? existing?.ootApplicable ?? false),
    oosApplicable: Boolean(input.oosApplicable ?? existing?.oosApplicable ?? false),
    autoDeviationRequired: Boolean(input.autoDeviationRequired ?? existing?.autoDeviationRequired ?? false),
    autoCapaRequired: Boolean(input.autoCapaRequired ?? existing?.autoCapaRequired ?? false),
    remarks: optionalString(input.remarks ?? existing?.remarks, 'remarks', 2000),
    status: String(existing?.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active',
    isArchived: existing?.isArchived === true,
  };
}

async function assertUniqueParameter(
  firestore: Firestore,
  payload: ReturnType<typeof parseParameterPayload>,
  excludeDocId?: string,
) {
  const [codeSnap, nameSnap] = await Promise.all([
    firestore.collection('parameters').where('parameterCode', '==', payload.parameterCode).limit(10).get(),
    firestore.collection('parameters').where('parameterName', '==', payload.parameterName).limit(10).get(),
  ]);
  if (codeSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Parameter code already exists');
  }
  if (nameSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Parameter name already exists');
  }
}

async function countLinkedParameterReferences(
  firestore: Firestore,
  paramDocId: string,
  parameterCode: string,
): Promise<Array<{ module: string; count: number }>> {
  const results: Array<{ module: string; count: number }> = [];
  for (const link of LINKED_PARAMETER_COLLECTIONS) {
    try {
      let count = 0;
      if (link.idField) {
        const byId = await firestore.collection(link.name).where(link.idField, '==', paramDocId).limit(5).get();
        count += byId.docs.filter((doc) => doc.data().isDeleted !== true).length;
      }
      if (count === 0 && link.codeField && parameterCode) {
        const byCode = await firestore.collection(link.name).where(link.codeField, '==', parameterCode).limit(5).get();
        count += byCode.docs.filter((doc) => doc.data().isDeleted !== true).length;
      }
      if (count > 0) results.push({ module: link.name, count });
    } catch {
      // collection may not exist
    }
  }
  return results;
}

export const createAdminParameter = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterEditor(actor, String(actor?.role || ''));

  const input = (request.data || {}) as Record<string, unknown>;
  const reason = requiredString(input.reason ?? input.changeReason, 'reason', 500);
  const payload = parseParameterPayload(input);
  await assertUniqueParameter(firestore, payload);

  const now = new Date().toISOString();
  const ref = firestore.collection('parameters').doc();
  const batch = firestore.batch();
  batch.set(ref, {
    ...payload,
    isDeleted: false,
    isArchived: false,
    createdAt: now,
    createdBy: request.auth.uid,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeParameterAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: ref.id,
    action: 'CREATE_PARAMETER',
    oldValue: null,
    newValue: payload,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    parameterNotification(
      request.auth.uid,
      ref.id,
      'PARAMETER_CREATED',
      'Parameter created',
      `Parameter "${payload.parameterName}" (${payload.parameterCode}) was created.`,
      now,
    ),
  );
  await batch.commit();
  const created = await ref.get();
  return { id: ref.id, ...created.data() };
});

export const updateAdminParameter = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterEditor(actor, String(actor?.role || ''));

  const parameterDocId = requiredString(request.data?.parameterDocId, 'parameterDocId', 128);
  const updates = (request.data?.updates || request.data || {}) as Record<string, unknown>;
  const reason = requiredString(request.data?.reason ?? updates.changeReason, 'reason', 500);

  const ref = firestore.collection('parameters').doc(parameterDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Parameter not found');
  const existing = snap.data() || {};
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Cannot update deleted parameter');

  const payload = parseParameterPayload(updates, existing);
  await assertUniqueParameter(firestore, payload, parameterDocId);

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    ...payload,
    parameterId: buildParameterId(payload.parameterCode),
    updatedAt: now,
    updatedBy: request.auth.uid,
  });

  const limitChanged = existing.lowerLimit !== payload.lowerLimit
    || existing.upperLimit !== payload.upperLimit
    || existing.alertLimitLow !== payload.alertLimitLow
    || existing.alertLimitHigh !== payload.alertLimitHigh
    || existing.actionLimitLow !== payload.actionLimitLow
    || existing.actionLimitHigh !== payload.actionLimitHigh
    || existing.criticalLimit !== payload.criticalLimit;

  writeParameterAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: parameterDocId,
    action: 'EDIT_PARAMETER',
    oldValue: existing,
    newValue: payload,
    reason,
    now,
  });

  if (existing.parameterCategory !== payload.parameterCategory) {
    writeParameterAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: parameterDocId,
      action: 'CATEGORY_CHANGED',
      oldValue: existing.parameterCategory,
      newValue: payload.parameterCategory,
      reason,
      now,
    });
  }
  if (limitChanged) {
    writeParameterAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: parameterDocId,
      action: 'LIMIT_CHANGE',
      oldValue: {
        lower: existing.lowerLimit, upper: existing.upperLimit,
        alertLow: existing.alertLimitLow, alertHigh: existing.alertLimitHigh,
        actionLow: existing.actionLimitLow, actionHigh: existing.actionLimitHigh,
        critical: existing.criticalLimit,
      },
      newValue: {
        lower: payload.lowerLimit, upper: payload.upperLimit,
        alertLow: payload.alertLimitLow, alertHigh: payload.alertLimitHigh,
        actionLow: payload.actionLimitLow, actionHigh: payload.actionLimitHigh,
        critical: payload.criticalLimit,
      },
      reason,
      now,
    });
    batch.set(
      firestore.collection('notifications').doc(),
      parameterNotification(
        request.auth.uid,
        parameterDocId,
        'PARAMETER_TOLERANCE_CHANGED',
        'Parameter limits changed',
        `Limits updated for parameter "${payload.parameterName}".`,
        now,
      ),
    );
  }
  await batch.commit();
  const updated = await ref.get();
  return { parameter: { id: ref.id, ...updated.data() } };
});

export const setAdminParameterStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterAdmin(actor, String(actor?.role || ''));

  const parameterDocId = requiredString(request.data?.parameterDocId, 'parameterDocId', 128);
  const status = String(request.data?.parameterStatus || request.data?.status || '');
  if (status !== 'Active' && status !== 'Inactive') {
    throw new HttpsError('invalid-argument', 'Invalid parameter status');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);

  const ref = firestore.collection('parameters').doc(parameterDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Parameter not found');
  const existing = snap.data() || {};

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { status, updatedAt: now, updatedBy: request.auth.uid });
  const action = status === 'Active' ? 'ACTIVATE_PARAMETER' : 'DEACTIVATE_PARAMETER';
  writeParameterAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: parameterDocId,
    action,
    oldValue: { status: existing.status },
    newValue: { status },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    parameterNotification(
      request.auth.uid,
      parameterDocId,
      status === 'Active' ? 'PARAMETER_ACTIVATED' : 'PARAMETER_DEACTIVATED',
      status === 'Active' ? 'Parameter activated' : 'Parameter deactivated',
      `Parameter "${String(existing.parameterName || '')}" was ${status === 'Active' ? 'activated' : 'deactivated'}.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const archiveAdminParameter = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterAdmin(actor, String(actor?.role || ''));

  const parameterDocId = requiredString(request.data?.parameterDocId, 'parameterDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('parameters').doc(parameterDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Parameter not found');
  const existing = snap.data() || {};

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isArchived: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeParameterAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: parameterDocId,
    action: 'ARCHIVE_PARAMETER',
    oldValue: { isArchived: existing.isArchived, status: existing.status },
    newValue: { isArchived: true, status: 'Inactive' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    parameterNotification(
      request.auth.uid,
      parameterDocId,
      'PARAMETER_ARCHIVED',
      'Parameter archived',
      `Parameter "${String(existing.parameterName || '')}" was archived.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const softDeleteAdminParameter = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterAdmin(actor, String(actor?.role || ''));

  const parameterDocId = requiredString(request.data?.parameterDocId, 'parameterDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('parameters').doc(parameterDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Parameter not found');
  const existing = snap.data() || {};

  const links = await countLinkedParameterReferences(
    firestore,
    parameterDocId,
    String(existing.parameterCode || ''),
  );
  if (links.length > 0) {
    const summary = links.map((l) => `${l.module} (${l.count})`).join(', ');
    throw new HttpsError('failed-precondition', `Cannot delete parameter: linked records in ${summary}`);
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: true,
    status: 'Inactive',
    deletedAt: now,
    deletedBy: request.auth.uid,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeParameterAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: parameterDocId,
    action: 'DELETE_PARAMETER',
    oldValue: existing,
    newValue: { isDeleted: true, status: 'Inactive' },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const restoreAdminParameter = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterEditor(actor, String(actor?.role || ''));

  const parameterDocId = requiredString(request.data?.parameterDocId, 'parameterDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('parameters').doc(parameterDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Parameter not found');
  const existing = snap.data() || {};

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: false,
    isArchived: false,
    status: 'Active',
    deletedAt: FieldValue.delete(),
    deletedBy: FieldValue.delete(),
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeParameterAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: parameterDocId,
    action: 'RESTORE_PARAMETER',
    oldValue: { isDeleted: existing.isDeleted },
    newValue: { isDeleted: false, status: 'Active' },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const bulkUpdateAdminParameters = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterAdmin(actor, String(actor?.role || ''));

  const parameterDocIds = request.data?.parameterDocIds;
  if (!Array.isArray(parameterDocIds) || parameterDocIds.length === 0 || parameterDocIds.length > 50) {
    throw new HttpsError('invalid-argument', 'parameterDocIds must contain 1–50 IDs');
  }
  const action = requiredString(request.data?.action, 'action', 40);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const now = new Date().toISOString();
  let successCount = 0;

  for (const id of parameterDocIds) {
    const parameterDocId = String(id);
    const ref = firestore.collection('parameters').doc(parameterDocId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const existing = snap.data() || {};
    if (existing.isDeleted === true) continue;

    const updates: DocumentData = { updatedAt: now, updatedBy: request.auth.uid };
    if (action === 'activate') updates.status = 'Active';
    else if (action === 'deactivate') updates.status = 'Inactive';
    else if (action === 'archive') {
      updates.isArchived = true;
      updates.status = 'Inactive';
    } else continue;

    const batch = firestore.batch();
    batch.update(ref, updates);
    writeParameterAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: parameterDocId,
      action: `BULK_${action.toUpperCase()}`,
      oldValue: { status: existing.status, isArchived: existing.isArchived },
      newValue: updates,
      reason,
      now,
    });
    await batch.commit();
    successCount += 1;
  }
  return { successCount };
});

export const bulkSoftDeleteAdminParameters = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterAdmin(actor, String(actor?.role || ''));

  const parameterDocIds = request.data?.parameterDocIds;
  if (!Array.isArray(parameterDocIds) || parameterDocIds.length === 0 || parameterDocIds.length > 50) {
    throw new HttpsError('invalid-argument', 'parameterDocIds must contain 1–50 IDs');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const errors: string[] = [];
  let successCount = 0;

  for (const id of parameterDocIds) {
    try {
      const parameterDocId = String(id);
      const ref = firestore.collection('parameters').doc(parameterDocId);
      const snap = await ref.get();
      if (!snap.exists) {
        errors.push(`${parameterDocId}: not found`);
        continue;
      }
      const existing = snap.data() || {};
      const links = await countLinkedParameterReferences(
        firestore,
        parameterDocId,
        String(existing.parameterCode || ''),
      );
      if (links.length > 0) {
        errors.push(`${existing.parameterCode}: linked records exist`);
        continue;
      }
      const now = new Date().toISOString();
      const batch = firestore.batch();
      batch.update(ref, {
        isDeleted: true,
        status: 'Inactive',
        deletedAt: now,
        deletedBy: request.auth.uid,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      writeParameterAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: parameterDocId,
        action: 'DELETE_PARAMETER',
        oldValue: existing,
        newValue: { isDeleted: true },
        reason,
        now,
      });
      await batch.commit();
      successCount += 1;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { successCount, errors };
});

export const importAdminParameters = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterAdmin(actor, String(actor?.role || ''));

  const rows = request.data?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50) {
    throw new HttpsError('invalid-argument', 'rows must contain 1–50 import records');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  let imported = 0;
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    try {
      if (!row || typeof row !== 'object') throw new Error('Invalid row');
      const r = row as Record<string, unknown>;
      const payload = parseParameterPayload({
        ...r,
        parameterCode: r.parameterCode || r.code,
        parameterName: r.parameterName || r.name,
        parameterType: r.parameterType || r.type || 'CPP',
        parameterCategory: r.parameterCategory || r.category || 'Manufacturing',
        resultType: r.resultType || 'Numeric',
        lowerLimit: r.lowerLimit || r.lower || '0',
        upperLimit: r.upperLimit || r.upper || '1',
        unit: r.unit || 'units',
        remarks: r.remarks || 'Imported',
      });
      await assertUniqueParameter(firestore, payload);

      const now = new Date().toISOString();
      const ref = firestore.collection('parameters').doc();
      const batch = firestore.batch();
      batch.set(ref, {
        ...payload,
        isDeleted: false,
        isArchived: false,
        createdAt: now,
        createdBy: request.auth.uid,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      writeParameterAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: ref.id,
        action: 'IMPORT_PARAMETER',
        oldValue: null,
        newValue: { parameterCode: payload.parameterCode, parameterName: payload.parameterName },
        reason,
        now,
      });
      await batch.commit();
      imported += 1;
    } catch (e) {
      errors.push(`Row ${index + 1}: ${(e as Error).message}`);
    }
  }
  return { imported, errors };
});

export const logAdminParameterExport = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterEditor(actor, String(actor?.role || ''));

  const count = Number(request.data?.count || 0);
  const reason = optionalString(request.data?.reason, 'reason', 500) || 'Parameter list export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeParameterAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: 'export',
    action: 'EXPORT_PARAMETER_LIST',
    oldValue: null,
    newValue: { count },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const seedAdminDefaultParameters = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertParameterAdmin(actor, String(actor?.role || ''));

  const presets = request.data?.presets;
  if (!Array.isArray(presets) || presets.length === 0 || presets.length > 100) {
    throw new HttpsError('invalid-argument', 'presets must contain 1–100 records');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  let created = 0;
  let skipped = 0;

  for (const row of presets) {
    try {
      const r = row as Record<string, unknown>;
      const payload = parseParameterPayload(r);
      await assertUniqueParameter(firestore, payload);
      const now = new Date().toISOString();
      const ref = firestore.collection('parameters').doc();
      const batch = firestore.batch();
      batch.set(ref, {
        ...payload,
        isDeleted: false,
        isArchived: false,
        createdAt: now,
        createdBy: request.auth.uid,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      writeParameterAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: ref.id,
        action: 'SEED_PARAMETER',
        oldValue: null,
        newValue: { parameterCode: payload.parameterCode },
        reason,
        now,
      });
      await batch.commit();
      created += 1;
    } catch (e) {
      if ((e as { code?: string }).code === 'already-exists') skipped += 1;
      else skipped += 1;
    }
  }
  return { created, skipped };
});
