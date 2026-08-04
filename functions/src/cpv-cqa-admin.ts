/**
 * CPV CQA Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, OOS/OOT evaluation.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';

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

const COLLECTION = 'cqa_results';
const MODULE = 'CQA Monitoring';

const ENTER_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'qc', 'qc_manager', 'microbiology',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES,
  'production', 'production_manager', 'viewer', 'auditor',
];
const RESULT_TYPES = ['Numeric', 'Text', 'Pass/Fail', 'Complies/Does Not Comply'] as const;
const CRITICALITY = ['Critical', 'Major', 'Minor'] as const;
const MICRO_PARAMS = ['Sterility', 'Bacterial Endotoxin Test'];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CQA Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string, parameterName?: string) {
  if (!actor || actor.is_active !== true) {
    throw new HttpsError('permission-denied', 'CQA Monitoring entry access required');
  }
  if (role === 'microbiology') {
    if (parameterName && !MICRO_PARAMS.some((p) => parameterName.toLowerCase().includes(p.toLowerCase()))) {
      throw new HttpsError('permission-denied', 'Microbiology may only enter Sterility / BET results');
    }
    return;
  }
  if (!ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CQA Monitoring entry access required');
  }
}

function assertReviewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CQA Monitoring review/approve access required');
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

function buildCqaResultId(batchNumber: string, parameterCode: string): string {
  return `CQA-${batchNumber}-${parameterCode}`.replace(/\s+/g, '-').toUpperCase();
}

/** Evaluate CQA compliance: OOS → Action → Alert/OOT → Complies. */
export function evaluateCqaStatus(
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
    return v === 'pass' ? 'Complies' : 'OOS';
  }
  if (resultType === 'Complies/Does Not Comply') {
    const v = String(observed).toLowerCase();
    return v.includes('comply') && !v.includes('not') ? 'Complies' : 'OOS';
  }
  const num = Number(observed);
  if (!Number.isFinite(num)) return 'OOS';
  if (num < lsl || num > usl) return 'OOS';
  if (actionLow !== undefined && num < actionLow) return 'Action';
  if (actionHigh !== undefined && num > actionHigh) return 'Action';
  if (alertLow !== undefined && num < alertLow) return 'Alert';
  if (alertHigh !== undefined && num > alertHigh) return 'Alert';
  // Legacy OOT band (outer 10% of specification range) when alert limits unset
  if (alertLow === undefined && alertHigh === undefined && usl > lsl) {
    const band = 0.1 * (usl - lsl);
    if (num < lsl + band || num > usl - band) return 'OOT';
  }
  return 'Complies';
}

function evaluateCqaRiskLevel(status: string, criticality: string, oosCount: number, alertCount: number): string {
  if (oosCount >= 2) return 'Critical';
  if (alertCount >= 3) return 'Medium';
  if (['OOS', 'Fail', 'Does Not Comply'].includes(status)) {
    if (criticality === 'Critical') return 'Critical';
    if (criticality === 'Major') return 'High';
    return 'Medium';
  }
  if (['Action', 'Alert', 'OOT'].includes(status)) return 'Medium';
  return 'Low';
}

function writeCqaAudit(
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
    auditId: `AUD-CQA-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-cqa-admin',
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
    type: 'cpv_cqa',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/cqa/${input.recordId}`,
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
  if (!['Active', 'Under Review', 'Approved'].includes(status)) {
    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational for CQA entry');
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

async function countStatus(
  firestore: Firestore,
  batchNumber: string,
  parameterCode: string,
  status: string,
): Promise<number> {
  try {
    const snap = await firestore
      .collection(COLLECTION)
      .where('batchNumber', '==', batchNumber)
      .where('parameterCode', '==', parameterCode)
      .limit(100)
      .get();
    return snap.docs.filter((d) =>
      String(d.data()?.status || '') === status && d.data()?.isDeleted !== true,
    ).length;
  } catch {
    return 0;
  }
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const batchNumber = requiredString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80);
  const parameterCode = requiredString(data.parameterCode ?? existing?.parameterCode, 'Parameter code', 80);
  const parameterName = requiredString(data.parameterName ?? existing?.parameterName, 'Parameter name', 200);
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

  const observedRaw = data.observedResult ?? existing?.observedResult;
  let observedResult: string | number;
  if (typeof observedRaw === 'number' && Number.isFinite(observedRaw)) {
    observedResult = observedRaw;
  } else {
    const s = requiredString(String(observedRaw ?? ''), 'Observed result', 200);
    const n = Number(s);
    observedResult = Number.isFinite(n) && resultType === 'Numeric' ? n : s;
  }

  const alertLimitLow = optionalFiniteNumber(data.alertLimitLow ?? existing?.alertLimitLow);
  const alertLimitHigh = optionalFiniteNumber(data.alertLimitHigh ?? existing?.alertLimitHigh);
  const actionLimitLow = optionalFiniteNumber(data.actionLimitLow ?? existing?.actionLimitLow);
  const actionLimitHigh = optionalFiniteNumber(data.actionLimitHigh ?? existing?.actionLimitHigh);
  const targetValue = optionalFiniteNumber(data.targetValue ?? existing?.targetValue) ?? 0;

  return {
    recordType: 'cqa_result',
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
    expiryDate: optionalString(data.expiryDate ?? existing?.expiryDate, 'Expiry date', 40),
    testStage: requiredString(data.testStage ?? existing?.testStage, 'Test stage', 120),
    processStage: optionalString(
      data.processStage ?? existing?.processStage ?? data.testStage ?? existing?.testStage,
      'Process stage',
      120,
    ),
    manufacturingStep: optionalString(
      data.manufacturingStep ?? existing?.manufacturingStep,
      'Manufacturing step',
      120,
    ),
    qualityCategory: optionalString(
      data.qualityCategory ?? existing?.qualityCategory ?? data.parameterCategory ?? existing?.parameterCategory,
      'Quality category',
      120,
    ),
    parameterId: optionalString(data.parameterId ?? existing?.parameterId, 'Parameter id', 120),
    parameterCode,
    parameterName,
    subParameter: optionalString(data.subParameter ?? existing?.subParameter, 'Sub-parameter', 120),
    parameterCategory: optionalString(
      data.parameterCategory ?? existing?.parameterCategory,
      'Category',
      120,
    ),
    parameterType: optionalString(data.parameterType ?? existing?.parameterType, 'Parameter type', 40) || 'CQA',
    responsibility: optionalString(data.responsibility ?? existing?.responsibility, 'Responsibility', 80),
    specificationText: optionalString(
      data.specificationText ?? existing?.specificationText,
      'Specification text',
      2000,
    ),
    specificationNumber: optionalString(
      data.specificationNumber ?? existing?.specificationNumber,
      'Specification number',
      80,
    ),
    specificationVersion: optionalString(
      data.specificationVersion ?? existing?.specificationVersion,
      'Specification version',
      40,
    ),
    stpNumber: optionalString(data.stpNumber ?? existing?.stpNumber, 'STP', 80),
    testMethod: optionalString(data.testMethod ?? existing?.testMethod, 'Test method', 200),
    observedResult,
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
    criticality,
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
    testDate: requiredString(data.testDate ?? existing?.testDate, 'Test date', 40),
    analyst: requiredString(data.analyst ?? existing?.analyst, 'Analyst', 120),
    reviewedBy: optionalString(data.reviewedBy ?? existing?.reviewedBy, 'Reviewed by', 120),
    reviewDate: optionalString(data.reviewDate ?? existing?.reviewDate, 'Review date', 40),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'QC',
    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40),
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    cqaResultId: buildCqaResultId(batchNumber, parameterCode),
    batchNo: batchNumber,
    product_name: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    testParameter: parameterName,
    lsl: lowerLimit,
    usl: upperLimit,
    target: targetValue,
    observedValue: observedResult,
    recordedBy: requiredString(data.analyst ?? existing?.analyst, 'Analyst', 120),
  };
}

export const createAdminCqaResult = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const autoOos = data.autoOos !== false;
  await assertOperationalProduct(firestore, requiredString(data.cpvProductId, 'CPV product', 120));

  const payload = sanitizePayload(data);
  assertEnter(actor, actorRole, payload.parameterName);
  if (await findDuplicate(firestore, payload.batchNumber, payload.parameterCode)) {
    throw new HttpsError('already-exists', 'CQA result already exists for this batch and parameter');
  }

  const status = evaluateCqaStatus(
    payload.observedResult,
    payload.lowerLimit,
    payload.upperLimit,
    payload.resultType,
    payload.alertLimitLow ?? undefined,
    payload.alertLimitHigh ?? undefined,
    payload.actionLimitLow ?? undefined,
    payload.actionLimitHigh ?? undefined,
  );
  const oosCount = await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'OOS');
  const alertCount = (await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'Alert'))
    + (await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'OOT'));
  const riskLevel = evaluateCqaRiskLevel(status, payload.criticality, oosCount, alertCount);
  const capaRequired = oosCount >= 2 || alertCount >= 3;
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...payload,
    id: ref.id,
    status,
    riskLevel,
    oosRequired: autoOos && status === 'OOS',
    deviationRequired: !['Complies', 'Pass'].includes(status),
    capaRequired,
    linkedOosNumber: '',
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
  writeCqaAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.cqaResultId,
    actionType: 'CQA Result Created',
    description: `Recorded CQA ${payload.parameterName} for batch ${payload.batchNumber} → ${status}`,
    newValue: { status, observedResult: payload.observedResult, riskLevel },
    reason,
    now,
  });
  if (status === 'OOS') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'OOS Detected',
      title: 'CQA OOS Detected',
      message: `${payload.parameterName} on batch ${payload.batchNumber}: OOS`,
      now,
    });
  } else if (['OOT', 'Alert', 'Action'].includes(status)) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: status === 'OOT' ? 'OOT Detected' : 'Warning Limit Crossed',
      title: `CQA ${status}`,
      message: `${payload.parameterName} on batch ${payload.batchNumber}: ${status}`,
      now,
    });
  }
  if (capaRequired) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'CAPA Suggested',
      title: 'CQA CAPA Suggested',
      message: `Repeated quality failures for ${payload.parameterCode} on batch ${payload.batchNumber}`,
      now,
    });
  }
  await batch.commit();
  return record;
});

export const updateAdminCqaResult = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Result id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CQA result not found');
  }
  const existing = snap.data() || {};
  if (existing.isLocked === true && existing.reviewStatus === 'Approved') {
    if (!qaOverride) {
      throw new HttpsError('failed-precondition', 'Approved CQA result is locked. QA override required.');
    }
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  } else {
    assertEnter(actor, actorRole, String(data.parameterName || existing.parameterName || ''));
  }

  const payload = sanitizePayload(data, existing);
  if (await findDuplicate(firestore, payload.batchNumber, payload.parameterCode, id)) {
    throw new HttpsError('already-exists', 'CQA result already exists for this batch and parameter');
  }

  const status = evaluateCqaStatus(
    payload.observedResult,
    payload.lowerLimit,
    payload.upperLimit,
    payload.resultType,
    payload.alertLimitLow ?? undefined,
    payload.alertLimitHigh ?? undefined,
    payload.actionLimitLow ?? undefined,
    payload.actionLimitHigh ?? undefined,
  );
  const oosCount = await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'OOS');
  const alertCount = (await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'Alert'))
    + (await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'OOT'));
  const riskLevel = evaluateCqaRiskLevel(status, payload.criticality, oosCount, alertCount);
  const now = new Date().toISOString();
  const updates = {
    ...payload,
    status,
    riskLevel,
    capaRequired: oosCount >= 2 || alertCount >= 3,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCqaAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.cqaResultId,
    actionType: qaOverride ? 'CQA QA Override' : 'CQA Result Updated',
    description: `Updated CQA ${payload.parameterName} → ${status}`,
    oldValue: { status: existing.status, observedResult: existing.observedResult },
    newValue: { status, observedResult: payload.observedResult },
    reason,
    now,
    esign: qaOverride,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminCqaResult = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Result id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CQA result not found');
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
  writeCqaAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cqaResultId || ''),
    actionType: 'CQA Review Submitted',
    description: 'CQA result submitted for review',
    oldValue: existing.reviewStatus,
    newValue: 'Under Review',
    reason,
    now,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: id,
    eventName: 'Workflow Pending',
    title: 'CQA Review Pending',
    message: `${existing.parameterName} (${existing.batchNumber}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminCqaResult = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'CQA result not found');
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
  writeCqaAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cqaResultId || ''),
    actionType: 'CQA Result Approved',
    description: `Approved and locked CQA result ${existing.cqaResultId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminCqaResults = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk CQA entry');
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
      assertEnter(actor, actorRole, payload.parameterName);
      if (await findDuplicate(firestore, payload.batchNumber, payload.parameterCode)) {
        errors.push(`${payload.parameterName}: duplicate`);
        continue;
      }
      const status = evaluateCqaStatus(
        payload.observedResult,
        payload.lowerLimit,
        payload.upperLimit,
        payload.resultType,
        payload.alertLimitLow ?? undefined,
        payload.alertLimitHigh ?? undefined,
        payload.actionLimitLow ?? undefined,
        payload.actionLimitHigh ?? undefined,
      );
      const oosCount = await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'OOS');
      const alertCount = (await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'Alert'))
        + (await countStatus(firestore, payload.batchNumber, payload.parameterCode, 'OOT'));
      const riskLevel = evaluateCqaRiskLevel(status, payload.criticality, oosCount, alertCount);
      const ref = firestore.collection(COLLECTION).doc();
      const record = {
        ...payload,
        id: ref.id,
        status,
        riskLevel,
        oosRequired: status === 'OOS',
        deviationRequired: !['Complies', 'Pass'].includes(status),
        capaRequired: oosCount >= 2 || alertCount >= 3,
        linkedOosNumber: '',
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
      writeCqaAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.cqaResultId,
        actionType: 'CQA Result Created',
        description: `Bulk recorded CQA ${payload.parameterName}`,
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
    writeCqaAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: 'bulk',
      actionType: 'CQA Bulk Entry',
      description: `Bulk created ${created} CQA results`,
      newValue: { created, errors: errors.length },
      reason,
      now,
    });
    await batch.commit();
  }

  return { created, errors };
});

export const softDeleteAdminCqaResult = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'CQA result not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot delete approved CQA results. Use QA override to amend.');
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
  writeCqaAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cqaResultId || ''),
    actionType: 'CQA Result Archived',
    description: `Soft-deleted CQA result ${existing.cqaResultId}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminCqaExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const batch = firestore.batch();
  writeCqaAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'CQA Export',
    description: `Exported ${count} CQA results (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
