/**
 * CPV CPP Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, OOS/OOT evaluation.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';


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
  const reason = requiredString(value, 'Change reason', 2000);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

function asNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HttpsError('invalid-argument', `${field} must be a number`);
  }
  return n;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const COLLECTION = 'cpp_results';
const MODULE = 'CPP Monitoring';

const ENTER_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
  'production', 'production_manager', 'engineering', 'engineering_manager',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES,
  'qc', 'qc_manager', 'viewer', 'auditor',
];
const RESULT_TYPES = ['Numeric', 'Text', 'Pass/Fail', 'Complies/Does Not Comply'] as const;
const CRITICALITY = ['Critical', 'Major', 'Minor'] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPP Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPP Monitoring entry access required');
  }
}

function assertReviewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPP Monitoring review/approve access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
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

function buildCppResultId(batchNumber: string, parameterCode: string): string {
  return `CPP-${batchNumber}-${parameterCode}`.replace(/\s+/g, '-').toUpperCase();
}

/** Evaluate compliance using LSL/USL and optional alert/action bands. */
export function evaluateCppStatus(
  observed: number | string,
  lsl: number,
  usl: number,
  resultType: string,
  alertLow?: number,
  alertHigh?: number,
  actionLow?: number,
  actionHigh?: number,
): string {
  if (resultType === 'Pass/Fail') {
    const v = String(observed).toLowerCase();
    return v === 'pass' ? 'Complies' : 'Does Not Comply';
  }
  if (resultType === 'Complies/Does Not Comply') {
    const v = String(observed).toLowerCase();
    return v.includes('comply') && !v.includes('not') ? 'Complies' : 'Does Not Comply';
  }
  const num = Number(observed);
  if (!Number.isFinite(num)) return 'OOT/OOL';
  if (num < lsl || num > usl) return 'OOT/OOL';
  if (actionLow !== undefined && num < actionLow) return 'Action';
  if (actionHigh !== undefined && num > actionHigh) return 'Action';
  if (alertLow !== undefined && num < alertLow) return 'Alert';
  if (alertHigh !== undefined && num > alertHigh) return 'Alert';
  return 'Complies';
}

function evaluateCppRiskLevel(status: string, criticality: string, failureCount: number): string {
  if (failureCount >= 3) return 'Critical';
  const fail = ['OOT/OOL', 'Action', 'Does Not Comply', 'Fail', 'OOS', 'OOT'].includes(status);
  if (!fail) return 'Low';
  if (criticality === 'Critical') return 'High';
  if (criticality === 'Major') return 'Medium';
  return 'Low';
}

function writeCppAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    documentNumber?: string;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    now: string;
    esign?: boolean;
  },
) {
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-CPP-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'CPV',
    subModule: MODULE,
    collectionName: COLLECTION,
    recordId: input.recordId,
    documentId: input.recordId,
    documentNumber: input.documentNumber || '',
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason || '',
    performedBy: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    electronicSignature: input.esign === true,
    createdAt: input.now,
    source: 'cpv-cpp-admin',
    immutable: true,
    appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE,
    action: input.actionType,
    recordId: input.recordId,
    description: input.description,
    performedBy: input.actorName,
    userId: input.actorUid,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
    status: 'Success',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE,
    actionType: input.actionType,
    actionDescription: input.description,
    recordId: input.recordId,
    documentNumber: input.documentNumber || '',
    userId: input.actorUid,
    userName: input.actorName,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
    status: 'Success',
  });
}

function notify(
  firestore: Firestore,
  batch: WriteBatch,
  input: {
    targetUid: string;
    recordId: string;
    eventName: string;
    title: string;
    message: string;
    now: string;
  },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid,
    title: input.title,
    message: input.message,
    type: 'cpv_cpp',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/cpp/${input.recordId}`,
    read: false,
    createdAt: input.now,
  });
}

async function assertOperationalProduct(firestore: Firestore, productId: string) {
  const snap = await firestore.collection('cpv_products').doc(productId).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'CPV product not found');
  }
  const status = String(snap.data()?.cpvStatus || '');
  const operational = ['Active', 'Under Review', 'Approved'].includes(status);
  if (!operational) {
    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational for CPP entry');
  }
  return snap.data() || {};
}

async function findDuplicate(
  firestore: Firestore,
  batchNumber: string,
  parameterCode: string,
  excludeId?: string,
) {
  const snap = await firestore
    .collection(COLLECTION)
    .where('batchNumber', '==', batchNumber)
    .where('parameterCode', '==', parameterCode)
    .limit(10)
    .get();
  return snap.docs.find((d) => d.id !== excludeId && d.data()?.isDeleted !== true);
}

async function countParameterFailures(
  firestore: Firestore,
  batchNumber: string,
  parameterCode: string,
): Promise<number> {
  try {
    const snap = await firestore
      .collection(COLLECTION)
      .where('batchNumber', '==', batchNumber)
      .where('parameterCode', '==', parameterCode)
      .limit(100)
      .get();
    return snap.docs.filter((d) => {
      const status = String(d.data()?.status || '');
      return !['Complies', 'Pass'].includes(status) && d.data()?.isDeleted !== true;
    }).length;
  } catch {
    return 0;
  }
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const batchNumber = requiredString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80);
  const parameterCode = requiredString(data.parameterCode ?? existing?.parameterCode, 'Parameter code', 80);
  const resultType = optionalString(data.resultType ?? existing?.resultType, 'Result type', 40) || 'Numeric';
  if (!RESULT_TYPES.includes(resultType as typeof RESULT_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid result type: ${resultType}`);
  }
  const criticality = optionalString(data.criticality ?? existing?.criticality, 'Criticality', 40) || 'Major';
  if (!CRITICALITY.includes(criticality as typeof CRITICALITY[number])) {
    throw new HttpsError('invalid-argument', `Invalid criticality: ${criticality}`);
  }

  const lowerLimit = asNumber(data.lowerLimit ?? existing?.lowerLimit, 'LSL');
  const upperLimit = asNumber(data.upperLimit ?? existing?.upperLimit, 'USL');
  if (lowerLimit >= upperLimit) {
    throw new HttpsError('invalid-argument', 'Upper limit must be greater than lower limit');
  }

  const observedRaw = data.observedValue ?? existing?.observedValue;
  let observedValue: string | number;
  if (typeof observedRaw === 'number' && Number.isFinite(observedRaw)) {
    observedValue = observedRaw;
  } else {
    const s = requiredString(String(observedRaw ?? ''), 'Observed value', 200);
    const n = Number(s);
    observedValue = Number.isFinite(n) && resultType === 'Numeric' ? n : s;
  }

  const alertLimitLow = optionalFiniteNumber(data.alertLimitLow ?? existing?.alertLimitLow);
  const alertLimitHigh = optionalFiniteNumber(data.alertLimitHigh ?? existing?.alertLimitHigh);
  const actionLimitLow = optionalFiniteNumber(data.actionLimitLow ?? existing?.actionLimitLow);
  const actionLimitHigh = optionalFiniteNumber(data.actionLimitHigh ?? existing?.actionLimitHigh);

  const targetValue = optionalFiniteNumber(data.targetValue ?? existing?.targetValue) ?? 0;

  return {
    recordType: 'cpp_result',
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),
    batchNumber,
    manufacturingDate: requiredString(
      data.manufacturingDate ?? existing?.manufacturingDate,
      'Manufacturing date',
      40,
    ),
    processStage: requiredString(data.processStage ?? existing?.processStage, 'Process stage', 120),
    processArea: optionalString(data.processArea ?? existing?.processArea, 'Process area', 120),
    manufacturingStage: optionalString(
      data.manufacturingStage ?? existing?.manufacturingStage ?? data.processStage ?? existing?.processStage,
      'Manufacturing stage',
      120,
    ),
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    machineId: optionalString(data.machineId ?? existing?.machineId, 'Machine', 120),
    sensorId: optionalString(data.sensorId ?? existing?.sensorId, 'Sensor', 120),
    parameterId: optionalString(data.parameterId ?? existing?.parameterId, 'Parameter id', 120),
    parameterCode,
    parameterName: requiredString(data.parameterName ?? existing?.parameterName, 'Parameter name', 200),
    parameterCategory: optionalString(
      data.parameterCategory ?? existing?.parameterCategory,
      'Category',
      120,
    ),
    parameterType: optionalString(data.parameterType ?? existing?.parameterType, 'Parameter type', 40) || 'CPP',
    observedValue,
    targetValue,
    lowerLimit,
    upperLimit,
    alertLimitLow: alertLimitLow ?? null,
    alertLimitHigh: alertLimitHigh ?? null,
    actionLimitLow: actionLimitLow ?? null,
    actionLimitHigh: actionLimitHigh ?? null,
    ucl: optionalFiniteNumber(data.ucl ?? existing?.ucl) ?? null,
    lcl: optionalFiniteNumber(data.lcl ?? existing?.lcl) ?? null,
    unit: requiredString(data.unit ?? existing?.unit, 'Unit', 40),
    resultType,
    frequency: optionalString(data.frequency ?? existing?.frequency, 'Frequency', 80) || 'Per Batch',
    monitoringFrequency: optionalString(
      data.monitoringFrequency ?? existing?.monitoringFrequency,
      'Monitoring frequency',
      80,
    ),
    samplingFrequency: optionalString(
      data.samplingFrequency ?? existing?.samplingFrequency,
      'Sampling frequency',
      80,
    ),
    reviewFrequency: optionalString(
      data.reviewFrequency ?? existing?.reviewFrequency,
      'Review frequency',
      80,
    ),
    criticality,
    observationDateTime: requiredString(
      data.observationDateTime ?? existing?.observationDateTime,
      'Observation date/time',
      40,
    ),
    recordedBy: requiredString(data.recordedBy ?? existing?.recordedBy, 'Recorded by', 120),
    reviewedBy: optionalString(data.reviewedBy ?? existing?.reviewedBy, 'Reviewed by', 120),
    reviewDate: optionalString(data.reviewDate ?? existing?.reviewDate, 'Review date', 40),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120),
    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40),
    operatorId: optionalString(data.operatorId ?? existing?.operatorId, 'Operator', 120),
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    cppResultId: buildCppResultId(batchNumber, parameterCode),
    batchNo: batchNumber,
    product_name: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    lsl: lowerLimit,
    usl: upperLimit,
    target_value: targetValue,
  };
}

export const createAdminCppResult = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const autoDeviation = data.autoDeviation !== false;
  await assertOperationalProduct(firestore, requiredString(data.cpvProductId, 'CPV product', 120));

  const payload = sanitizePayload(data);
  if (await findDuplicate(firestore, payload.batchNumber, payload.parameterCode)) {
    throw new HttpsError('already-exists', 'CPP result already exists for this batch and parameter');
  }

  const status = evaluateCppStatus(
    payload.observedValue,
    payload.lowerLimit,
    payload.upperLimit,
    payload.resultType,
    payload.alertLimitLow ?? undefined,
    payload.alertLimitHigh ?? undefined,
    payload.actionLimitLow ?? undefined,
    payload.actionLimitHigh ?? undefined,
  );
  const failures = await countParameterFailures(firestore, payload.batchNumber, payload.parameterCode);
  const riskLevel = evaluateCppRiskLevel(status, payload.criticality, failures);
  const capaRequired = failures >= 3;
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...payload,
    id: ref.id,
    status,
    riskLevel,
    deviationRequired: autoDeviation && !['Complies', 'Pass'].includes(status),
    capaRequired,
    linkedDeviationNumber: '',
    linkedCapaNumber: '',
    reviewStatus: 'Draft' as const,
    isLocked: false,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdByName: actorName,
    updatedByName: actorName,
    isDeleted: false,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.set(ref, record);
  writeCppAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.cppResultId,
    actionType: 'CPP Result Created',
    description: `Recorded CPP ${payload.parameterName} for batch ${payload.batchNumber} → ${status}`,
    newValue: { status, observedValue: payload.observedValue, riskLevel },
    reason,
    now,
  });
  if (!['Complies', 'Pass'].includes(status)) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: status === 'OOT/OOL' ? 'CPP Out of Specification' : 'CPP Warning Limit Crossed',
      title: `CPP ${status}`,
      message: `${payload.parameterName} on batch ${payload.batchNumber}: ${status}`,
      now,
    });
  }
  if (capaRequired) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'CAPA Suggested',
      title: 'CPP CAPA Suggested',
      message: `Repeated failures for ${payload.parameterCode} on batch ${payload.batchNumber}`,
      now,
    });
  }
  await batch.commit();
  return record;
});

export const updateAdminCppResult = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Result id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPP result not found');
  }
  const existing = snap.data() || {};
  if (existing.isLocked === true && existing.reviewStatus === 'Approved') {
    if (!qaOverride) {
      throw new HttpsError('failed-precondition', 'Approved CPP result is locked. QA override required.');
    }
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  }

  const payload = sanitizePayload(data, existing);
  if (await findDuplicate(firestore, payload.batchNumber, payload.parameterCode, id)) {
    throw new HttpsError('already-exists', 'CPP result already exists for this batch and parameter');
  }

  const status = evaluateCppStatus(
    payload.observedValue,
    payload.lowerLimit,
    payload.upperLimit,
    payload.resultType,
    payload.alertLimitLow ?? undefined,
    payload.alertLimitHigh ?? undefined,
    payload.actionLimitLow ?? undefined,
    payload.actionLimitHigh ?? undefined,
  );
  const failures = await countParameterFailures(firestore, payload.batchNumber, payload.parameterCode);
  const riskLevel = evaluateCppRiskLevel(status, payload.criticality, failures);
  const now = new Date().toISOString();
  const updates = {
    ...payload,
    status,
    riskLevel,
    capaRequired: failures >= 3,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCppAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.cppResultId,
    actionType: qaOverride ? 'CPP QA Override' : 'CPP Result Updated',
    description: `Updated CPP ${payload.parameterName} → ${status}`,
    oldValue: { status: existing.status, observedValue: existing.observedValue },
    newValue: { status, observedValue: payload.observedValue },
    reason,
    now,
    esign: qaOverride,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminCppResult = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Result id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPP result not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Approved results cannot be reopened via review');
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Under Review',
    reviewedBy: actorName,
    reviewDate: now.split('T')[0],
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCppAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cppResultId || ''),
    actionType: 'CPP Review Submitted',
    description: `CPP result submitted for review`,
    oldValue: existing.reviewStatus,
    newValue: 'Under Review',
    reason,
    now,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: id,
    eventName: 'Workflow Pending',
    title: 'CPP Review Pending',
    message: `${existing.parameterName} (${existing.batchNumber}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminCppResult = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Result id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to approve');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPP result not found');
  }
  const existing = snap.data() || {};
  if (!['Draft', 'Under Review'].includes(String(existing.reviewStatus))) {
    throw new HttpsError('failed-precondition', `Cannot approve from status ${existing.reviewStatus}`);
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Approved',
    reviewedBy: actorName,
    reviewDate: now.split('T')[0],
    isLocked: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCppAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cppResultId || ''),
    actionType: 'CPP Result Approved',
    description: `Approved and locked CPP result ${existing.cppResultId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminCppResults = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk CPP entry');
  const rows = Array.isArray(data.rows) ? data.rows as Record<string, unknown>[] : [];
  if (!rows.length) throw new HttpsError('invalid-argument', 'No rows provided');
  if (rows.length > 100) throw new HttpsError('invalid-argument', 'Bulk limited to 100 rows');

  let created = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    try {
      await assertOperationalProduct(firestore, requiredString(row.cpvProductId, 'CPV product', 120));
      const payload = sanitizePayload(row);
      if (await findDuplicate(firestore, payload.batchNumber, payload.parameterCode)) {
        errors.push(`${payload.parameterName}: duplicate`);
        continue;
      }
      const status = evaluateCppStatus(
        payload.observedValue,
        payload.lowerLimit,
        payload.upperLimit,
        payload.resultType,
        payload.alertLimitLow ?? undefined,
        payload.alertLimitHigh ?? undefined,
        payload.actionLimitLow ?? undefined,
        payload.actionLimitHigh ?? undefined,
      );
      const failures = await countParameterFailures(firestore, payload.batchNumber, payload.parameterCode);
      const riskLevel = evaluateCppRiskLevel(status, payload.criticality, failures);
      const ref = firestore.collection(COLLECTION).doc();
      const record = {
        ...payload,
        id: ref.id,
        status,
        riskLevel,
        deviationRequired: !['Complies', 'Pass'].includes(status),
        capaRequired: failures >= 3,
        linkedDeviationNumber: '',
        linkedCapaNumber: '',
        reviewStatus: 'Draft' as const,
        isLocked: false,
        createdAt: now,
        updatedAt: now,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdByName: actorName,
        updatedByName: actorName,
        isDeleted: false,
        changeReason: reason,
      };
      const batch = firestore.batch();
      batch.set(ref, record);
      writeCppAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.cppResultId,
        actionType: 'CPP Result Created',
        description: `Bulk recorded CPP ${payload.parameterName}`,
        newValue: { status },
        reason,
        now,
      });
      await batch.commit();
      created += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Unknown bulk error');
    }
  }

  if (created > 0) {
    const batch = firestore.batch();
    writeCppAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: 'bulk',
      actionType: 'CPP Bulk Entry',
      description: `Bulk created ${created} CPP results`,
      newValue: { created, errors: errors.length },
      reason,
      now,
    });
    await batch.commit();
  }

  return { created, errors };
});

export const softDeleteAdminCppResult = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Result id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to archive');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPP result not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot delete approved CPP results. Use QA override to amend.');
  }
  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    deletedAt: now,
    deletedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCppAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cppResultId || ''),
    actionType: 'CPP Result Archived',
    description: `Soft-deleted CPP result ${existing.cppResultId}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminCppExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const batch = firestore.batch();
  writeCppAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'CPP Export',
    description: `Exported ${count} CPP results (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
