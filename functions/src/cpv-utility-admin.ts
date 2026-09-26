/**
 * CPV Utility Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, OOS/OOT/Alert/Action evaluation.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { assertCpvBatchForProduct } from './cpv-batch-guard';


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

function asFiniteNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new HttpsError('invalid-argument', `${field} must be a finite number`);
  }
  return n;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const COLLECTION = 'utility_monitoring';
const MODULE = 'Utility Monitoring';

const ENTER_ROLES = [
  'super_admin', 'admin', 'engineering', 'engineering_manager',
  'qc', 'qc_manager', 'microbiology',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES,
  ...REVIEW_ROLES,
  'production', 'production_manager', 'viewer', 'auditor',
];

const UTILITY_TYPES = [
  'Purified Water', 'Water for Injection', 'Clean Steam', 'Compressed Air',
  'Nitrogen', 'HVAC', 'Chilled Water', 'Cooling Water', 'Vacuum',
  'Electricity', 'Gas', 'Temperature', 'Humidity', 'Differential Pressure',
  'Boiler Steam', 'Other',
] as const;

const RESULT_TYPES = ['Numeric', 'Pass/Fail', 'Complies/Does Not Comply', 'Text'] as const;
const DATA_SOURCES = ['Manual', 'IoT', 'PLC', 'SCADA', 'OPC-UA', 'MQTT'] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Utility Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Utility Monitoring entry access required');
  }
}

function assertReviewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QA review/approve access required');
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

function buildId(batchNumber: string, parameterCode: string, samplingPoint: string): string {
  return `UT-${batchNumber}-${parameterCode}-${samplingPoint}`.replace(/\s+/g, '-').toUpperCase();
}

function evaluateStatus(
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
  if (actionLow != null && num < actionLow) return 'Action';
  if (actionHigh != null && num > actionHigh) return 'Action';
  if (alertLow != null && num < alertLow) return 'Alert';
  if (alertHigh != null && num > alertHigh) return 'Alert';
  if (alertLow == null && alertHigh == null) {
    const range = usl - lsl;
    if (range > 0) {
      const bandLow = lsl + range * 0.1;
      const bandHigh = usl - range * 0.1;
      if (num < bandLow || num > bandHigh) return 'OOT';
    }
  }
  return 'Complies';
}

function isCriticalUtilityType(utilityType: string): boolean {
  return ['Water for Injection', 'Clean Steam', 'HVAC', 'Purified Water'].includes(utilityType);
}

function evaluateRisk(
  input: {
    utilityType: string;
    parameterName: string;
    status: string;
    samplingPoint: string;
    areaRoomNo: string;
    utilityCriticality: string;
    alarmStatus?: string;
    communicationStatus?: string;
  },
  failureCount: number,
): string {
  if (['Sensor Failure', 'Communication Failure', 'PLC Failure'].includes(String(input.alarmStatus || ''))) {
    return 'Critical';
  }
  if (input.communicationStatus === 'Disconnected' || input.communicationStatus === 'Failed') {
    return 'High';
  }
  if (failureCount >= 3) return 'High';

  const param = input.parameterName.toLowerCase();
  const wfiType = input.utilityType === 'Water for Injection' || input.utilityType.includes('WFI');
  if (wfiType && (param.includes('microbial') || param.includes('endotoxin')) && ['OOS', 'Excursion'].includes(input.status)) {
    return 'Critical';
  }
  if (input.utilityType === 'Compressed Air'
    && (param.includes('oil') || param.includes('particle'))
    && ['OOS', 'Excursion', 'Action', 'Alert', 'OOT'].includes(input.status)) {
    return 'High';
  }
  const sterileHint = /grade\s*[ab]/i.test(input.areaRoomNo || '') || /grade\s*[ab]/i.test(input.samplingPoint || '');
  if (input.utilityType === 'HVAC'
    && (param.includes('differential pressure') || param.includes('pressure'))
    && ['OOS', 'Excursion'].includes(input.status)
    && sterileHint) {
    return 'Critical';
  }
  const critical = input.utilityCriticality === 'Critical' || isCriticalUtilityType(input.utilityType);
  if (critical && ['OOS', 'Excursion'].includes(input.status)) return 'High';
  if (['OOS', 'Excursion', 'Action'].includes(input.status)) return 'Medium';
  if (['Alert', 'OOT'].includes(input.status)) return 'Low';
  return 'Low';
}

function writeUtilAudit(
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
    auditId: `AUD-UT-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-utility-admin',
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
    type: 'cpv_utility',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/utility-monitoring/${input.recordId}`,
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
    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational');
  }
  return snap.data() || {};
}

async function findDuplicate(
  firestore: Firestore,
  batchNumber: string,
  parameterCode: string,
  samplingPoint: string,
  monitoringDate: string,
  excludeId?: string,
) {
  const snap = await firestore
    .collection(COLLECTION)
    .where('batchNumber', '==', batchNumber)
    .where('parameterCode', '==', parameterCode)
    .limit(25)
    .get();
  return snap.docs.find((d) =>
    d.id !== excludeId
    && d.data()?.isDeleted !== true
    && String(d.data()?.samplingPoint || '') === samplingPoint
    && String(d.data()?.monitoringDate || '') === monitoringDate,
  );
}

async function countFailures(
  firestore: Firestore,
  batchNumber: string,
  parameterCode: string,
  samplingPoint: string,
): Promise<number> {
  try {
    const snap = await firestore
      .collection(COLLECTION)
      .where('batchNumber', '==', batchNumber)
      .where('parameterCode', '==', parameterCode)
      .limit(100)
      .get();
    return snap.docs.filter((d) => {
      const data = d.data() || {};
      return data.isDeleted !== true
        && String(data.samplingPoint || '') === samplingPoint
        && ['Alert', 'Action', 'Excursion', 'OOS', 'OOT'].includes(String(data.status || ''));
    }).length;
  } catch {
    return 0;
  }
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const utilityType = optionalString(data.utilityType ?? existing?.utilityType, 'Utility type', 80) || 'Other';
  if (!UTILITY_TYPES.includes(utilityType as typeof UTILITY_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid utility type: ${utilityType}`);
  }
  const resultType = optionalString(data.resultType ?? existing?.resultType, 'Result type', 40) || 'Numeric';
  if (!RESULT_TYPES.includes(resultType as typeof RESULT_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid result type: ${resultType}`);
  }
  const dataSource = optionalString(data.dataSource ?? existing?.dataSource, 'Data source', 40) || 'Manual';
  if (!DATA_SOURCES.includes(dataSource as typeof DATA_SOURCES[number])) {
    throw new HttpsError('invalid-argument', `Invalid data source: ${dataSource}`);
  }

  const lowerLimit = asFiniteNumber(data.lowerLimit ?? existing?.lowerLimit, 'Lower limit');
  const upperLimit = asFiniteNumber(data.upperLimit ?? existing?.upperLimit, 'Upper limit');
  if (lowerLimit >= upperLimit) {
    throw new HttpsError('invalid-argument', 'Upper limit must be greater than lower limit');
  }

  const alertLimitLow = optionalFiniteNumber(data.alertLimitLow ?? existing?.alertLimitLow);
  const alertLimitHigh = optionalFiniteNumber(data.alertLimitHigh ?? existing?.alertLimitHigh);
  const actionLimitLow = optionalFiniteNumber(data.actionLimitLow ?? existing?.actionLimitLow);
  const actionLimitHigh = optionalFiniteNumber(data.actionLimitHigh ?? existing?.actionLimitHigh);
  const targetValue = optionalFiniteNumber(data.targetValue ?? existing?.targetValue);

  let observedValue: string | number;
  const observedRaw = data.observedValue ?? existing?.observedValue;
  if (observedRaw === undefined || observedRaw === null || observedRaw === '') {
    throw new HttpsError('invalid-argument', 'Observed value is required');
  }
  if (typeof observedRaw === 'number' && Number.isFinite(observedRaw)) {
    observedValue = observedRaw;
  } else {
    const s = String(observedRaw).trim();
    const n = Number(s);
    observedValue = Number.isFinite(n) && resultType === 'Numeric' ? n : s;
  }

  const batchNumber = requiredString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80);
  const parameterCode = requiredString(data.parameterCode ?? existing?.parameterCode, 'Parameter code', 80);
  const samplingPoint = requiredString(data.samplingPoint ?? existing?.samplingPoint, 'Sampling point', 120);
  const monitoringDate = requiredString(data.monitoringDate ?? existing?.monitoringDate, 'Monitoring date', 40);

  return {
    recordType: 'utility_monitoring',
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    batchNumber,
    utilityType,
    utilitySystemName: requiredString(
      data.utilitySystemName ?? existing?.utilitySystemName,
      'Utility system name',
      200,
    ),
    utilitySystemCode: optionalString(
      data.utilitySystemCode ?? existing?.utilitySystemCode,
      'Utility system code',
      80,
    ),
    samplingPoint,
    areaRoomNo: optionalString(data.areaRoomNo ?? existing?.areaRoomNo, 'Area/Room', 120),
    building: optionalString(data.building ?? existing?.building, 'Building', 120),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Utilities',
    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40),
    productionLine: optionalString(data.productionLine ?? existing?.productionLine, 'Production line', 120),
    parameterId: optionalString(data.parameterId ?? existing?.parameterId, 'Parameter id', 120),
    parameterCode,
    parameterName: requiredString(data.parameterName ?? existing?.parameterName, 'Parameter name', 200),
    observedValue,
    targetValue: targetValue ?? null,
    lowerLimit,
    upperLimit,
    alertLimitLow: alertLimitLow ?? null,
    alertLimitHigh: alertLimitHigh ?? null,
    actionLimitLow: actionLimitLow ?? null,
    actionLimitHigh: actionLimitHigh ?? null,
    unit: requiredString(data.unit ?? existing?.unit, 'Unit', 40),
    resultType,
    monitoringDate,
    monitoringTime: requiredString(data.monitoringTime ?? existing?.monitoringTime, 'Monitoring time', 40),
    recordedBy: requiredString(data.recordedBy ?? existing?.recordedBy, 'Recorded by', 120),
    reviewedBy: optionalString(data.reviewedBy ?? existing?.reviewedBy, 'Reviewed by', 120),
    reviewDate: optionalString(data.reviewDate ?? existing?.reviewDate, 'Review date', 40),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    utilityCriticality: optionalString(
      data.utilityCriticality ?? existing?.utilityCriticality,
      'Criticality',
      40,
    ) || 'Major',
    autoDeviationRequired: data.autoDeviationRequired !== false
      && existing?.autoDeviationRequired !== false,
    dataSource,
    sensorId: optionalString(data.sensorId ?? existing?.sensorId, 'Sensor id', 120),
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment id', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    alarmStatus: optionalString(data.alarmStatus ?? existing?.alarmStatus, 'Alarm status', 80),
    communicationStatus: optionalString(
      data.communicationStatus ?? existing?.communicationStatus,
      'Communication status',
      80,
    ) || 'OK',
    specificationNumber: optionalString(
      data.specificationNumber ?? existing?.specificationNumber,
      'Specification',
      80,
    ),
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    utilityMonitoringId: buildId(batchNumber, parameterCode, samplingPoint),
    batchNo: batchNumber,
    lsl: lowerLimit,
    usl: upperLimit,
  };
}

export const createAdminUtilityRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  if (qaOverride) {
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  }
  const cpvProductId = requiredString(data.cpvProductId, 'CPV product', 120);
  await assertOperationalProduct(firestore, cpvProductId);
  const payload = sanitizePayload(data);
  await assertCpvBatchForProduct(firestore, cpvProductId, payload.batchNumber);
  if (await findDuplicate(
    firestore,
    payload.batchNumber,
    payload.parameterCode,
    payload.samplingPoint,
    payload.monitoringDate,
  )) {
    throw new HttpsError('already-exists', 'Utility record already exists for this batch, parameter, sampling point and date');
  }

  const status = evaluateStatus(
    payload.observedValue,
    payload.lowerLimit,
    payload.upperLimit,
    payload.resultType,
    payload.alertLimitLow ?? undefined,
    payload.alertLimitHigh ?? undefined,
    payload.actionLimitLow ?? undefined,
    payload.actionLimitHigh ?? undefined,
  );
  const failureCount = await countFailures(
    firestore,
    payload.batchNumber,
    payload.parameterCode,
    payload.samplingPoint,
  );
  const riskLevel = evaluateRisk({
    utilityType: payload.utilityType,
    parameterName: payload.parameterName,
    status,
    samplingPoint: payload.samplingPoint,
    areaRoomNo: payload.areaRoomNo,
    utilityCriticality: payload.utilityCriticality,
    alarmStatus: payload.alarmStatus,
    communicationStatus: payload.communicationStatus,
  }, failureCount);

  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...payload,
    id: ref.id,
    status,
    riskLevel,
    capaRequired: failureCount >= 3,
    deviationRequired: payload.autoDeviationRequired && status !== 'Complies',
    oosRequired: status === 'OOS' || status === 'Excursion',
    linkedDeviationNumber: '',
    linkedOosNumber: '',
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
  writeUtilAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.utilityMonitoringId,
    actionType: 'Utility Registered',
    description: `Registered ${payload.parameterName} at ${payload.samplingPoint} → ${status}`,
    newValue: { status, riskLevel, observedValue: payload.observedValue },
    reason,
    now,
    esign: qaOverride,
  });

  if (status === 'OOS' || status === 'Excursion') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'OOS Detected',
      title: 'Utility OOS',
      message: `${payload.utilitySystemName}: ${payload.parameterName} OOS at ${payload.samplingPoint}`,
      now,
    });
  } else if (status === 'OOT' || status === 'Alert') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: status === 'OOT' ? 'OOT Detected' : 'Utility Alert',
      title: `Utility ${status}`,
      message: `${payload.utilitySystemName}: ${payload.parameterName} ${status}`,
      now,
    });
  }
  if (payload.alarmStatus && payload.alarmStatus !== 'Normal' && payload.alarmStatus !== 'OK' && payload.alarmStatus !== '') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Utility Failure',
      title: 'Utility Alarm',
      message: `${payload.utilitySystemName} alarm: ${payload.alarmStatus}`,
      now,
    });
  }
  if (payload.communicationStatus === 'Disconnected' || payload.communicationStatus === 'Failed') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Sensor Failure',
      title: 'Sensor / Communication Failure',
      message: `${payload.sensorId || payload.utilitySystemName}: ${payload.communicationStatus}`,
      now,
    });
  }
  await batch.commit();
  return record;
});

export const updateAdminUtilityRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Utility record not found');
  }
  const existing = snap.data() || {};

  if (existing.isLocked === true && existing.reviewStatus === 'Approved') {
    if (!qaOverride) {
      throw new HttpsError('failed-precondition', 'Approved record is locked. QA override required.');
    }
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  } else {
    assertEnter(actor, actorRole);
  }

  const payload = sanitizePayload(data, existing);
  if (await findDuplicate(
    firestore,
    payload.batchNumber,
    payload.parameterCode,
    payload.samplingPoint,
    payload.monitoringDate,
    id,
  )) {
    throw new HttpsError('already-exists', 'Duplicate utility monitoring entry');
  }

  const status = evaluateStatus(
    payload.observedValue,
    payload.lowerLimit,
    payload.upperLimit,
    payload.resultType,
    payload.alertLimitLow ?? undefined,
    payload.alertLimitHigh ?? undefined,
    payload.actionLimitLow ?? undefined,
    payload.actionLimitHigh ?? undefined,
  );
  const failureCount = await countFailures(
    firestore,
    payload.batchNumber,
    payload.parameterCode,
    payload.samplingPoint,
  );
  const riskLevel = evaluateRisk({
    utilityType: payload.utilityType,
    parameterName: payload.parameterName,
    status,
    samplingPoint: payload.samplingPoint,
    areaRoomNo: payload.areaRoomNo,
    utilityCriticality: payload.utilityCriticality,
    alarmStatus: payload.alarmStatus,
    communicationStatus: payload.communicationStatus,
  }, failureCount);

  const now = new Date().toISOString();
  const updates = {
    ...payload,
    status,
    riskLevel,
    capaRequired: failureCount >= 3,
    deviationRequired: payload.autoDeviationRequired && status !== 'Complies',
    oosRequired: status === 'OOS' || status === 'Excursion',
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeUtilAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.utilityMonitoringId,
    actionType: qaOverride ? 'Utility QA Override' : 'Utility Updated',
    description: `Updated ${payload.parameterName} → ${status}`,
    oldValue: { status: existing.status, observedValue: existing.observedValue },
    newValue: { status, observedValue: payload.observedValue },
    reason,
    now,
    esign: qaOverride,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminUtilityRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Utility record not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Approved records cannot be reopened via review');
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Under Review',
    reviewedBy: actorName,
    reviewDate: now.slice(0, 10),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeUtilAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.utilityMonitoringId || ''),
    actionType: 'Utility Review Submitted',
    description: 'Submitted for QA review',
    oldValue: existing.reviewStatus,
    newValue: 'Under Review',
    reason,
    now,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: id,
    eventName: 'Workflow Pending',
    title: 'Utility Review Pending',
    message: `${existing.parameterName} (${existing.samplingPoint}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminUtilityRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to approve');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Utility record not found');
  }
  const existing = snap.data() || {};
  if (!['Draft', 'Under Review'].includes(String(existing.reviewStatus))) {
    throw new HttpsError('failed-precondition', `Cannot approve from status ${existing.reviewStatus}`);
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Approved',
    isLocked: true,
    reviewedBy: actorName,
    reviewDate: now.slice(0, 10),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeUtilAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.utilityMonitoringId || ''),
    actionType: 'Utility Approved',
    description: `Approved and locked ${existing.utilityMonitoringId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminUtilityRecords = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk utility entry');
  const rows = Array.isArray(data.rows) ? data.rows as Record<string, unknown>[] : [];
  if (!rows.length) throw new HttpsError('invalid-argument', 'No rows provided');
  if (rows.length > 100) throw new HttpsError('invalid-argument', 'Bulk limited to 100 rows');

  let created = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    try {
      const cpvProductId = requiredString(row.cpvProductId, 'CPV product', 120);
      await assertOperationalProduct(firestore, cpvProductId);
      const payload = sanitizePayload(row);
      await assertCpvBatchForProduct(firestore, cpvProductId, payload.batchNumber);
      if (await findDuplicate(
        firestore,
        payload.batchNumber,
        payload.parameterCode,
        payload.samplingPoint,
        payload.monitoringDate,
      )) {
        errors.push(`${payload.parameterName}: duplicate`);
        continue;
      }
      const status = evaluateStatus(
        payload.observedValue,
        payload.lowerLimit,
        payload.upperLimit,
        payload.resultType,
        payload.alertLimitLow ?? undefined,
        payload.alertLimitHigh ?? undefined,
        payload.actionLimitLow ?? undefined,
        payload.actionLimitHigh ?? undefined,
      );
      const failureCount = await countFailures(
        firestore,
        payload.batchNumber,
        payload.parameterCode,
        payload.samplingPoint,
      );
      const riskLevel = evaluateRisk({
        utilityType: payload.utilityType,
        parameterName: payload.parameterName,
        status,
        samplingPoint: payload.samplingPoint,
        areaRoomNo: payload.areaRoomNo,
        utilityCriticality: payload.utilityCriticality,
        alarmStatus: payload.alarmStatus,
        communicationStatus: payload.communicationStatus,
      }, failureCount);
      const ref = firestore.collection(COLLECTION).doc();
      const record = {
        ...payload,
        id: ref.id,
        status,
        riskLevel,
        capaRequired: failureCount >= 3,
        deviationRequired: payload.autoDeviationRequired && status !== 'Complies',
        oosRequired: status === 'OOS' || status === 'Excursion',
        linkedDeviationNumber: '',
        linkedOosNumber: '',
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
      writeUtilAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.utilityMonitoringId,
        actionType: 'Utility Registered',
        description: `Bulk registered ${payload.parameterName}`,
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
    writeUtilAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: 'bulk',
      actionType: 'Utility Bulk Entry',
      description: `Bulk created ${created} utility records`,
      newValue: { created, errors: errors.length },
      reason,
      now,
    });
    await batch.commit();
  }

  return { created, errors };
});

export const softDeleteAdminUtilityRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to archive');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Utility record not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot delete approved records. Use QA override to amend.');
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
  writeUtilAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.utilityMonitoringId || ''),
    actionType: 'Utility Archived',
    description: `Soft-deleted ${existing.utilityMonitoringId}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminUtilityExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const batch = firestore.batch();
  writeUtilAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Utility Export',
    description: `Exported ${count} records (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
