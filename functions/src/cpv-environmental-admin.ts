/**
 * CPV Environmental Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, OOS/OOT/Alert/Action evaluation.
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

const COLLECTION = 'environmental_monitoring';
const MODULE = 'Environmental Monitoring';

const ENTER_ROLES = [
  'super_admin', 'admin', 'qc', 'qc_manager', 'microbiology',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES,
  ...REVIEW_ROLES,
  'engineering', 'engineering_manager',
  'production', 'production_manager', 'viewer', 'auditor',
];

const CLEANROOM_GRADES = [
  'Grade A', 'Grade B', 'Grade C', 'Grade D', 'Controlled Area', 'Unclassified',
] as const;
const ISO_CLASSES = ['ISO 5', 'ISO 6', 'ISO 7', 'ISO 8', 'ISO 9', 'N/A'] as const;
const MONITORING_TYPES = [
  'Temperature', 'Relative Humidity', 'Differential Pressure',
  'Non-Viable Particle Count', 'Viable Particle Count', 'Settle Plate',
  'Active Air Sampling', 'Surface Monitoring', 'Personnel Monitoring', 'Contact Plate',
  'Air Velocity', 'Air Changes Per Hour', 'Compressed Gas', 'Water Monitoring',
  'CO2', 'O2', 'Other',
] as const;
const PROCESS_STAGES = [
  'Dispensing', 'Mixing', 'Filtration', 'Sterilization', 'Vial Washing', 'Depyrogenation',
  'Filling', 'Sealing', 'Visual Inspection', 'Packing', 'General Monitoring',
] as const;
const RESULT_TYPES = ['Numeric', 'Pass/Fail', 'Complies/Does Not Comply', 'Text'] as const;
const DATA_SOURCES = ['Manual', 'IoT', 'PLC', 'SCADA', 'BMS', 'MQTT', 'OPC-UA'] as const;
const MICROBIAL_TYPES = [
  'Viable Particle Count', 'Settle Plate', 'Active Air Sampling',
  'Surface Monitoring', 'Personnel Monitoring', 'Contact Plate', 'Water Monitoring',
];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Environmental Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Environmental Monitoring entry access required');
  }
}

function assertReviewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QA review/approve access required');
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

function buildId(batchNumber: string, parameterCode: string, areaName: string): string {
  return `EM-${batchNumber}-${parameterCode}-${areaName}`.replace(/\s+/g, '-').toUpperCase();
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

function isMicrobial(monitoringType: string, parameterName: string): boolean {
  if (MICROBIAL_TYPES.includes(monitoringType as typeof MICROBIAL_TYPES[number])) return true;
  const p = parameterName.toLowerCase();
  return p.includes('viable') || p.includes('microbial') || p.includes('settle')
    || p.includes('surface') || p.includes('personnel') || p.includes('contact');
}

function evaluateRisk(
  input: {
    cleanroomGrade: string;
    processStage: string;
    monitoringType: string;
    parameterName: string;
    status: string;
    alarmStatus?: string;
    communicationStatus?: string;
  },
  failureCount: number,
): string {
  if (['Sensor Failure', 'Communication Failure', 'HVAC Failure', 'AHU Failure', 'Power Failure'].includes(String(input.alarmStatus || ''))) {
    return 'Critical';
  }
  if (input.communicationStatus === 'Disconnected' || input.communicationStatus === 'Failed') {
    return 'High';
  }
  if (failureCount >= 3) return 'High';
  const nonCompliant = ['Excursion', 'OOS', 'Action', 'Alert', 'OOT'].includes(input.status);
  if (!nonCompliant) return 'Low';
  if (isMicrobial(input.monitoringType, input.parameterName) && ['OOS', 'Excursion'].includes(input.status)) {
    return 'Critical';
  }
  if (input.cleanroomGrade === 'Grade A' && ['OOS', 'Excursion'].includes(input.status)) return 'Critical';
  if (input.cleanroomGrade === 'Grade B' && ['OOS', 'Excursion'].includes(input.status)) return 'High';
  if (input.processStage === 'Filling'
    && ['Grade A', 'Grade B'].includes(input.cleanroomGrade)
    && ['OOS', 'Excursion'].includes(input.status)) {
    return 'Critical';
  }
  if (['OOS', 'Excursion'].includes(input.status)) return 'High';
  if (input.status === 'Action') return 'Medium';
  if (['Alert', 'OOT'].includes(input.status)) return 'Low';
  return 'Low';
}

function writeEmAudit(
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
    auditId: `AUD-EM-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-environmental-admin',
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
    type: 'cpv_environmental',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/environmental-monitoring/${input.recordId}`,
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
  areaName: string,
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
    && String(d.data()?.areaName || '') === areaName
    && String(d.data()?.monitoringDate || '') === monitoringDate,
  );
}

async function countFailures(
  firestore: Firestore,
  batchNumber: string,
  parameterCode: string,
  areaName: string,
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
        && String(data.areaName || '') === areaName
        && ['Alert', 'Action', 'Excursion', 'OOS', 'OOT'].includes(String(data.status || ''));
    }).length;
  } catch {
    return 0;
  }
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const cleanroomGrade = optionalString(data.cleanroomGrade ?? existing?.cleanroomGrade, 'Cleanroom grade', 40) || 'Unclassified';
  if (!CLEANROOM_GRADES.includes(cleanroomGrade as typeof CLEANROOM_GRADES[number])) {
    throw new HttpsError('invalid-argument', `Invalid cleanroom grade: ${cleanroomGrade}`);
  }
  const isoClass = optionalString(data.isoClass ?? existing?.isoClass, 'ISO class', 40) || 'N/A';
  if (!ISO_CLASSES.includes(isoClass as typeof ISO_CLASSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid ISO class: ${isoClass}`);
  }
  const monitoringType = optionalString(data.monitoringType ?? existing?.monitoringType, 'Monitoring type', 80) || 'Temperature';
  if (!MONITORING_TYPES.includes(monitoringType as typeof MONITORING_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid monitoring type: ${monitoringType}`);
  }
  const processStage = optionalString(data.processStage ?? existing?.processStage, 'Process stage', 80) || 'General Monitoring';
  if (!PROCESS_STAGES.includes(processStage as typeof PROCESS_STAGES[number])) {
    throw new HttpsError('invalid-argument', `Invalid process stage: ${processStage}`);
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
  const areaName = requiredString(data.areaName ?? existing?.areaName, 'Area name', 200);
  const monitoringDate = requiredString(data.monitoringDate ?? existing?.monitoringDate, 'Monitoring date', 40);

  return {
    recordType: 'environmental_monitoring',
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    batchNumber,
    areaName,
    areaId: optionalString(data.areaId ?? existing?.areaId, 'Area id', 120),
    roomNumber: requiredString(data.roomNumber ?? existing?.roomNumber, 'Room number', 80),
    cleanroomGrade,
    isoClass,
    processStage,
    monitoringType,
    samplingLocation: optionalString(data.samplingLocation ?? existing?.samplingLocation, 'Sampling location', 200),
    monitoringPointCode: optionalString(data.monitoringPointCode ?? existing?.monitoringPointCode, 'Monitoring point code', 80),
    monitoringPointName: optionalString(data.monitoringPointName ?? existing?.monitoringPointName, 'Monitoring point name', 200),
    building: optionalString(data.building ?? existing?.building, 'Building', 120),
    block: optionalString(data.block ?? existing?.block, 'Block', 80),
    floor: optionalString(data.floor ?? existing?.floor, 'Floor', 80),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Microbiology',
    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40),
    zone: optionalString(data.zone ?? existing?.zone, 'Zone', 80),
    ahuId: optionalString(data.ahuId ?? existing?.ahuId, 'AHU id', 80),
    ahuName: optionalString(data.ahuName ?? existing?.ahuName, 'AHU name', 200),
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment id', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    dataSource,
    sensorId: optionalString(data.sensorId ?? existing?.sensorId, 'Sensor id', 120),
    alarmStatus: optionalString(data.alarmStatus ?? existing?.alarmStatus, 'Alarm status', 80),
    communicationStatus: optionalString(
      data.communicationStatus ?? existing?.communicationStatus,
      'Communication status',
      80,
    ) || 'OK',
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
    autoDeviationRequired: data.autoDeviationRequired !== false
      && existing?.autoDeviationRequired !== false,
    specificationNumber: optionalString(data.specificationNumber ?? existing?.specificationNumber, 'Specification', 80),
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    environmentalMonitoringId: buildId(batchNumber, parameterCode, areaName),
    batchNo: batchNumber,
    lsl: lowerLimit,
    usl: upperLimit,
  };
}

export const createAdminEnvironmentalRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
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
  await assertOperationalProduct(firestore, requiredString(data.cpvProductId, 'CPV product', 120));
  const payload = sanitizePayload(data);
  if (await findDuplicate(
    firestore,
    payload.batchNumber,
    payload.parameterCode,
    payload.areaName,
    payload.monitoringDate,
  )) {
    throw new HttpsError('already-exists', 'Environmental record already exists for this batch, area, parameter and date');
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
    payload.areaName,
  );
  const riskLevel = evaluateRisk({
    cleanroomGrade: payload.cleanroomGrade,
    processStage: payload.processStage,
    monitoringType: payload.monitoringType,
    parameterName: payload.parameterName,
    status,
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
  writeEmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.environmentalMonitoringId,
    actionType: 'Environmental Data Recorded',
    description: `Recorded ${payload.parameterName} in ${payload.areaName} → ${status}`,
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
      title: 'Environmental OOS',
      message: `${payload.areaName}: ${payload.parameterName} OOS (${payload.cleanroomGrade})`,
      now,
    });
  } else if (status === 'OOT' || status === 'Alert') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: status === 'OOT' ? 'OOT Detected' : 'Environmental Alert',
      title: `Environmental ${status}`,
      message: `${payload.areaName}: ${payload.parameterName} ${status}`,
      now,
    });
  }
  if (payload.alarmStatus && !['Normal', 'OK', ''].includes(payload.alarmStatus)) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'HVAC Failure',
      title: 'Environmental Alarm',
      message: `${payload.areaName} alarm: ${payload.alarmStatus}`,
      now,
    });
  }
  if (payload.communicationStatus === 'Disconnected' || payload.communicationStatus === 'Failed') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Sensor Failure',
      title: 'Sensor / Communication Failure',
      message: `${payload.sensorId || payload.areaName}: ${payload.communicationStatus}`,
      now,
    });
  }
  await batch.commit();
  return record;
});

export const updateAdminEnvironmentalRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Environmental record not found');
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
    payload.areaName,
    payload.monitoringDate,
    id,
  )) {
    throw new HttpsError('already-exists', 'Duplicate environmental monitoring entry');
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
    payload.areaName,
  );
  const riskLevel = evaluateRisk({
    cleanroomGrade: payload.cleanroomGrade,
    processStage: payload.processStage,
    monitoringType: payload.monitoringType,
    parameterName: payload.parameterName,
    status,
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
  writeEmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.environmentalMonitoringId,
    actionType: qaOverride ? 'Environmental QA Override' : 'Environmental Updated',
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

export const reviewAdminEnvironmentalRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Environmental record not found');
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
  writeEmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.environmentalMonitoringId || ''),
    actionType: 'Environmental Review Submitted',
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
    title: 'Environmental Review Pending',
    message: `${existing.parameterName} (${existing.areaName}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminEnvironmentalRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Environmental record not found');
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
  writeEmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.environmentalMonitoringId || ''),
    actionType: 'Environmental Approved',
    description: `Approved and locked ${existing.environmentalMonitoringId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminEnvironmentalRecords = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk environmental entry');
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
      if (await findDuplicate(
        firestore,
        payload.batchNumber,
        payload.parameterCode,
        payload.areaName,
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
        payload.areaName,
      );
      const riskLevel = evaluateRisk({
        cleanroomGrade: payload.cleanroomGrade,
        processStage: payload.processStage,
        monitoringType: payload.monitoringType,
        parameterName: payload.parameterName,
        status,
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
      writeEmAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.environmentalMonitoringId,
        actionType: 'Environmental Data Recorded',
        description: `Bulk recorded ${payload.parameterName}`,
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
    writeEmAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: 'bulk',
      actionType: 'Environmental Bulk Entry',
      description: `Bulk created ${created} environmental records`,
      newValue: { created, errors: errors.length },
      reason,
      now,
    });
    await batch.commit();
  }

  return { created, errors };
});

export const softDeleteAdminEnvironmentalRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Environmental record not found');
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
  writeEmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.environmentalMonitoringId || ''),
    actionType: 'Environmental Archived',
    description: `Soft-deleted ${existing.environmentalMonitoringId}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminEnvironmentalExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const batch = firestore.batch();
  writeEmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Environmental Export',
    description: `Exported ${count} records (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
