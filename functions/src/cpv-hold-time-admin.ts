/**
 * CPV Hold Time Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, hold-time calculation engine.
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

const COLLECTION = 'hold_time_monitoring';
const MODULE = 'Hold Time Monitoring';

const ENTER_ROLES = [
  'super_admin', 'admin', 'production', 'production_manager',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES,
  ...REVIEW_ROLES,
  'qc', 'qc_manager', 'viewer', 'auditor',
];

const HOLD_STAGES = [
  'Dispensing to Mixing', 'Mixing to Filtration', 'Filtration to Sterilization',
  'Sterilization to Filling', 'Filling to Inspection', 'Inspection to Packing',
  'Bulk Hold Time', 'Sterile Bulk Hold Time', 'Intermediate Hold Time',
  'Finished Product Hold Time', 'Warehouse Hold Time',
  'Raw Material Hold', 'Packaging Material Hold', 'Equipment Hold',
  'Cleaning Hold', 'Stability Hold', 'Process Hold',
  'Dispensing', 'Mixing', 'Filtration', 'Sterilization', 'Filling', 'Inspection', 'Packing',
] as const;

const MATERIAL_CATEGORIES = [
  'Raw Material', 'Intermediate', 'Bulk Product', 'Finished Product',
  'Packaging Material', 'Equipment', 'Cleaning Hold', 'Process', 'Stability', 'N/A',
] as const;

const UNITS = ['Minutes', 'Hours', 'Days'] as const;
const TIMER_STATUSES = ['Not Started', 'Running', 'Paused', 'Completed', 'Expired'] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Hold Time Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Hold Time Monitoring entry access required');
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

function buildId(batchNumber: string, holdStage: string): string {
  return `HT-${batchNumber}-${holdStage}`.replace(/\s+/g, '-').toUpperCase();
}

function buildCode(batchNumber: string, holdStage: string): string {
  return `HTC-${new Date().getFullYear()}-${batchNumber}-${holdStage}`
    .replace(/\s+/g, '-')
    .toUpperCase()
    .slice(0, 80);
}

function unitToMinutes(unit: string): number {
  if (unit === 'Minutes') return 1;
  if (unit === 'Hours') return 60;
  if (unit === 'Days') return 1440;
  return 60;
}

function minutesToUnit(minutes: number, unit: string): number {
  return Math.round((minutes / unitToMinutes(unit)) * 100) / 100;
}

function calculateActual(startDateTime: string, endDateTime: string, unit: string, nowIso: string): number {
  const start = new Date(startDateTime);
  const end = endDateTime.trim() ? new Date(endDateTime) : new Date(nowIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  if (diffMinutes <= 0) return 0;
  return minutesToUnit(diffMinutes, unit);
}

function evaluateStatus(actual: number, allowed: number, endDateTime: string): string {
  if (!Number.isFinite(actual) || !Number.isFinite(allowed) || allowed <= 0) return 'Exceeded';
  const inProgress = !endDateTime.trim();
  if (actual > allowed) return inProgress ? 'Expired' : 'Exceeded';
  if (actual >= allowed * 0.95) return inProgress ? 'Near Expiry' : 'Action';
  if (actual >= allowed * 0.8) return 'Alert';
  return inProgress ? 'In Progress' : 'Complies';
}

function evaluateRisk(
  input: {
    holdStage: string;
    status: string;
    materialCategory: string;
    storageExcursion: boolean;
  },
  exceededCount: number,
): string {
  if (exceededCount >= 3) return 'Critical';
  if (input.storageExcursion && ['Exceeded', 'Expired'].includes(input.status)) return 'Critical';
  if (input.status === 'Exceeded' && input.holdStage === 'Sterile Bulk Hold Time') return 'Critical';
  if (input.status === 'Expired' && ['Equipment', 'Cleaning Hold'].includes(input.materialCategory)) return 'Critical';
  if (['Exceeded', 'Expired'].includes(input.status)) return 'High';
  if (input.status === 'Action' || input.status === 'Near Expiry') return 'Medium';
  if (input.status === 'Alert' || input.storageExcursion) return 'Low';
  return 'Low';
}

function writeHoldAudit(
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
    auditId: `AUD-HT-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-hold-time-admin',
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
    electronicSignature: input.esign === true,
    source: 'cpv-hold-time-admin',
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
    electronicSignature: input.esign === true,
    source: 'cpv-hold-time-admin',
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
    type: 'cpv_hold_time',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/hold-time-monitoring/${input.recordId}`,
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
  holdStage: string,
  excludeId?: string,
) {
  const snap = await firestore
    .collection(COLLECTION)
    .where('batchNumber', '==', batchNumber)
    .where('holdStage', '==', holdStage)
    .limit(10)
    .get();
  return snap.docs.find((d) => d.id !== excludeId && d.data()?.isDeleted !== true);
}

async function countExceededHoldTimes(firestore: Firestore, batchNumber: string): Promise<number> {
  try {
    const snap = await firestore
      .collection(COLLECTION)
      .where('batchNumber', '==', batchNumber)
      .limit(100)
      .get();
    return snap.docs.filter((d) => {
      const data = d.data() || {};
      return data.isDeleted !== true && ['Exceeded', 'Expired'].includes(String(data.status || ''));
    }).length;
  } catch {
    return 0;
  }
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const holdStage = requiredString(data.holdStage ?? existing?.holdStage, 'Hold stage', 120);
  if (!HOLD_STAGES.includes(holdStage as typeof HOLD_STAGES[number])) {
    throw new HttpsError('invalid-argument', `Invalid hold stage: ${holdStage}`);
  }
  const holdTimeUnit = optionalString(data.holdTimeUnit ?? existing?.holdTimeUnit, 'Hold time unit', 20) || 'Hours';
  if (!UNITS.includes(holdTimeUnit as typeof UNITS[number])) {
    throw new HttpsError('invalid-argument', `Invalid hold time unit: ${holdTimeUnit}`);
  }
  const materialCategory = optionalString(data.materialCategory ?? existing?.materialCategory, 'Material category', 80) || 'N/A';
  if (!MATERIAL_CATEGORIES.includes(materialCategory as typeof MATERIAL_CATEGORIES[number])) {
    throw new HttpsError('invalid-argument', `Invalid material category: ${materialCategory}`);
  }
  const timerStatus = optionalString(data.timerStatus ?? existing?.timerStatus, 'Timer status', 40) || 'Not Started';
  if (!TIMER_STATUSES.includes(timerStatus as typeof TIMER_STATUSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid timer status: ${timerStatus}`);
  }

  const allowedHoldTime = asFiniteNumber(data.allowedHoldTime ?? existing?.allowedHoldTime, 'Allowed hold time');
  if (allowedHoldTime <= 0) {
    throw new HttpsError('invalid-argument', 'Allowed hold time must be greater than 0');
  }

  const startDateTime = requiredString(data.startDateTime ?? existing?.startDateTime, 'Start date time', 40);
  const endDateTime = optionalString(data.endDateTime ?? existing?.endDateTime, 'End date time', 40);
  if (endDateTime) {
    const start = new Date(startDateTime);
    const end = new Date(endDateTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new HttpsError('invalid-argument', 'End date time must be after start date time');
    }
  }

  const batchNumber = requiredString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80);

  return {
    recordType: 'hold_time_monitoring',
    holdTimeCode: optionalString(data.holdTimeCode ?? existing?.holdTimeCode, 'Hold time code', 80) || buildCode(batchNumber, holdStage),
    studyNumber: optionalString(data.studyNumber ?? existing?.studyNumber, 'Study number', 80),
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),
    material: optionalString(data.material ?? existing?.material, 'Material', 200),
    materialCategory,
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment id', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    batchNumber,
    manufacturingOrder: optionalString(data.manufacturingOrder ?? existing?.manufacturingOrder, 'Manufacturing order', 80),
    manufacturingDate: requiredString(data.manufacturingDate ?? existing?.manufacturingDate, 'Manufacturing date', 40),
    processStage: optionalString(data.processStage ?? existing?.processStage, 'Process stage', 120) || holdStage,
    operation: optionalString(data.operation ?? existing?.operation, 'Operation', 120),
    holdStage,
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Production',
    productionLine: optionalString(data.productionLine ?? existing?.productionLine, 'Production line', 120),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    storageLocation: optionalString(data.storageLocation ?? existing?.storageLocation, 'Storage location', 120),
    storageCondition: optionalString(data.storageCondition ?? existing?.storageCondition, 'Storage condition', 120),
    temperature: optionalFiniteNumber(data.temperature ?? existing?.temperature) ?? null,
    humidity: optionalFiniteNumber(data.humidity ?? existing?.humidity) ?? null,
    temperatureLimitLow: optionalFiniteNumber(data.temperatureLimitLow ?? existing?.temperatureLimitLow) ?? null,
    temperatureLimitHigh: optionalFiniteNumber(data.temperatureLimitHigh ?? existing?.temperatureLimitHigh) ?? null,
    humidityLimitLow: optionalFiniteNumber(data.humidityLimitLow ?? existing?.humidityLimitLow) ?? null,
    humidityLimitHigh: optionalFiniteNumber(data.humidityLimitHigh ?? existing?.humidityLimitHigh) ?? null,
    startDateTime,
    endDateTime,
    allowedHoldTime,
    holdTimeUnit,
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    reviewDate: optionalString(data.reviewDate ?? existing?.reviewDate, 'Review date', 40),
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    reasonForHold: optionalString(data.reasonForHold ?? existing?.reasonForHold, 'Reason for hold', 2000),
    extensionApproved: data.extensionApproved === true || existing?.extensionApproved === true,
    extensionReason: optionalString(data.extensionReason ?? existing?.extensionReason, 'Extension reason', 2000),
    approvedBy: optionalString(data.approvedBy ?? existing?.approvedBy, 'Approved by', 120),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    autoDeviationRequired: data.autoDeviationRequired !== false && existing?.autoDeviationRequired !== false,
    timerStatus,
    holdTimeId: buildId(batchNumber, holdStage),
    batchNo: batchNumber,
  };
}

function computeFields(payload: ReturnType<typeof sanitizePayload>, nowIso: string) {
  const actualHoldTime = calculateActual(payload.startDateTime, payload.endDateTime, payload.holdTimeUnit, nowIso);
  const elapsedTime = actualHoldTime;
  const remainingTime = Math.max(0, Math.round((payload.allowedHoldTime - actualHoldTime) * 100) / 100);
  const exceededTime = Math.max(0, Math.round((actualHoldTime - payload.allowedHoldTime) * 100) / 100);
  const timeUtilizationPercent = payload.allowedHoldTime > 0
    ? Math.round((actualHoldTime / payload.allowedHoldTime) * 10000) / 100
    : 0;
  const difference = Math.round((payload.allowedHoldTime - actualHoldTime) * 100) / 100;
  const status = evaluateStatus(actualHoldTime, payload.allowedHoldTime, payload.endDateTime);
  const nearExpiry = remainingTime <= payload.allowedHoldTime * 0.2 && remainingTime > 0;

  const temp = payload.temperature;
  const humidity = payload.humidity;
  const temperatureExcursion = (
    (temp != null && payload.temperatureLimitLow != null && temp < payload.temperatureLimitLow)
    || (temp != null && payload.temperatureLimitHigh != null && temp > payload.temperatureLimitHigh)
  );
  const humidityExcursion = (
    (humidity != null && payload.humidityLimitLow != null && humidity < payload.humidityLimitLow)
    || (humidity != null && payload.humidityLimitHigh != null && humidity > payload.humidityLimitHigh)
  );
  const storageExcursion = Boolean(temperatureExcursion || humidityExcursion);

  let timerStatus = payload.timerStatus;
  if (!payload.endDateTime && status === 'Expired') timerStatus = 'Expired';
  else if (!payload.endDateTime && payload.startDateTime) timerStatus = timerStatus === 'Paused' ? 'Paused' : 'Running';
  else if (payload.endDateTime) timerStatus = 'Completed';

  return {
    actualHoldTime,
    elapsedTime,
    remainingTime,
    exceededTime,
    timeUtilizationPercent,
    difference,
    status,
    complianceStatus: status,
    nearExpiry,
    temperatureExcursion: Boolean(temperatureExcursion),
    humidityExcursion: Boolean(humidityExcursion),
    storageExcursion,
    timerStatus,
  };
}

function emitStatusNotifications(
  firestore: Firestore,
  batch: WriteBatch,
  actorUid: string,
  recordId: string,
  payload: ReturnType<typeof sanitizePayload>,
  computed: ReturnType<typeof computeFields>,
  now: string,
) {
  if (computed.status === 'Exceeded' || computed.status === 'Expired') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId,
      eventName: 'Hold Time Expired',
      title: `Hold Time ${computed.status}`,
      message: `${payload.batchNumber}: ${payload.holdStage} ${computed.actualHoldTime} ${payload.holdTimeUnit}`,
      now,
    });
  } else if (computed.status === 'Near Expiry' || computed.nearExpiry) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId,
      eventName: 'Hold Time Near Expiry',
      title: 'Hold Time Near Expiry',
      message: `${payload.batchNumber}: ${payload.holdStage} remaining ${computed.remainingTime} ${payload.holdTimeUnit}`,
      now,
    });
  } else if (computed.status === 'Alert' || computed.status === 'Action') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId,
      eventName: 'Hold Time Alert',
      title: `Hold Time ${computed.status}`,
      message: `${payload.batchNumber}: ${payload.holdStage} utilization ${computed.timeUtilizationPercent}%`,
      now,
    });
  } else if (computed.status === 'In Progress') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId,
      eventName: 'Hold Time Started',
      title: 'Hold Time Started',
      message: `${payload.batchNumber}: ${payload.holdStage} timer running`,
      now,
    });
  }
  if (computed.temperatureExcursion) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId,
      eventName: 'Temperature Excursion',
      title: 'Temperature Excursion',
      message: `${payload.batchNumber}: temp ${payload.temperature}`,
      now,
    });
  }
  if (computed.humidityExcursion) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId,
      eventName: 'Humidity Excursion',
      title: 'Humidity Excursion',
      message: `${payload.batchNumber}: RH ${payload.humidity}%`,
      now,
    });
  }
  if (computed.storageExcursion) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId,
      eventName: 'Storage Condition Alert',
      title: 'Storage Condition Excursion',
      message: `${payload.batchNumber}: ${payload.storageLocation || payload.storageCondition || 'storage'}`,
      now,
    });
  }
}

export const createAdminHoldTimeRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
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

  if (await findDuplicate(firestore, payload.batchNumber, payload.holdStage)) {
    throw new HttpsError('already-exists', 'Hold time record already exists for this batch and stage');
  }

  const now = new Date().toISOString();
  const computed = computeFields(payload, now);
  if (['Exceeded', 'Expired'].includes(computed.status) && !qaOverride && !payload.extensionApproved) {
    // Allow create but flag — no block; QA may need visibility. Exceeded records are valid.
  }

  const priorExceeded = await countExceededHoldTimes(firestore, payload.batchNumber);
  const exceededCount = priorExceeded + (['Exceeded', 'Expired'].includes(computed.status) ? 1 : 0);
  const riskLevel = evaluateRisk({
    holdStage: payload.holdStage,
    status: computed.status,
    materialCategory: payload.materialCategory,
    storageExcursion: computed.storageExcursion,
  }, exceededCount);

  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...payload,
    ...computed,
    id: ref.id,
    riskLevel,
    capaRequired: exceededCount >= 3,
    deviationRequired: payload.autoDeviationRequired && ['Exceeded', 'Expired', 'Action', 'Near Expiry'].includes(computed.status),
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
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.holdTimeId,
    actionType: 'Hold Time Created',
    description: `Recorded ${payload.holdStage} ${computed.actualHoldTime} ${payload.holdTimeUnit} → ${computed.status}`,
    newValue: { status: computed.status, actualHoldTime: computed.actualHoldTime, riskLevel },
    reason,
    now,
    esign: qaOverride,
  });
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.holdTimeId,
    actionType: 'Hold Time Calculated',
    description: `Elapsed ${computed.elapsedTime}, remaining ${computed.remainingTime}, utilization ${computed.timeUtilizationPercent}%`,
    newValue: computed,
    reason,
    now,
  });
  if (computed.timerStatus === 'Running') {
    writeHoldAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: ref.id,
      documentNumber: payload.holdTimeId,
      actionType: 'Timer Started',
      description: `Hold timer started at ${payload.startDateTime}`,
      reason,
      now,
    });
  }
  emitStatusNotifications(firestore, batch, actorUid, ref.id, payload, computed, now);
  if (record.deviationRequired) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Deviation Created',
      title: 'Hold Time Deviation Required',
      message: `${payload.batchNumber}: ${payload.holdStage} ${computed.status}`,
      now,
    });
  }
  if (record.capaRequired) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'CAPA Created',
      title: 'Hold Time CAPA Suggested',
      message: `${payload.batchNumber}: repeated exceedance (${exceededCount})`,
      now,
    });
  }
  await batch.commit();
  return record;
});

export const updateAdminHoldTimeRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Hold time record not found');
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
  if (await findDuplicate(firestore, payload.batchNumber, payload.holdStage, id)) {
    throw new HttpsError('already-exists', 'Duplicate hold time monitoring entry');
  }

  const now = new Date().toISOString();
  const computed = computeFields(payload, now);
  const priorExceeded = await countExceededHoldTimes(firestore, payload.batchNumber);
  const otherExceeded = existing.status === 'Exceeded' || existing.status === 'Expired'
    ? Math.max(0, priorExceeded - 1)
    : priorExceeded;
  const exceededCount = otherExceeded + (['Exceeded', 'Expired'].includes(computed.status) ? 1 : 0);
  const riskLevel = evaluateRisk({
    holdStage: payload.holdStage,
    status: computed.status,
    materialCategory: payload.materialCategory,
    storageExcursion: computed.storageExcursion,
  }, exceededCount);

  const prevTimer = String(existing.timerStatus || '');
  const updates = {
    ...payload,
    ...computed,
    riskLevel,
    capaRequired: exceededCount >= 3,
    deviationRequired: payload.autoDeviationRequired && ['Exceeded', 'Expired', 'Action', 'Near Expiry'].includes(computed.status),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.holdTimeId,
    actionType: qaOverride ? 'Hold Time QA Override' : 'Hold Time Updated',
    description: `Updated ${payload.holdStage} → ${computed.status}`,
    oldValue: { status: existing.status, actualHoldTime: existing.actualHoldTime },
    newValue: { status: computed.status, actualHoldTime: computed.actualHoldTime },
    reason,
    now,
    esign: qaOverride,
  });
  if (prevTimer !== computed.timerStatus) {
    let action = 'Timer Updated';
    if (computed.timerStatus === 'Paused') action = 'Timer Paused';
    else if (computed.timerStatus === 'Running' && prevTimer === 'Paused') action = 'Timer Resumed';
    else if (computed.timerStatus === 'Completed') action = 'Timer Completed';
    else if (computed.timerStatus === 'Expired') action = 'Timer Expired';
    writeHoldAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: id,
      documentNumber: payload.holdTimeId,
      actionType: action,
      description: `Timer ${prevTimer} → ${computed.timerStatus}`,
      reason,
      now,
    });
  }
  emitStatusNotifications(firestore, batch, actorUid, id, payload, computed, now);
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminHoldTimeRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Hold time record not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Approved records cannot be reopened via review');
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Under Review',
    reviewDate: now.slice(0, 10),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.holdTimeId || ''),
    actionType: 'Hold Time Review Submitted',
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
    title: 'Hold Time Review Pending',
    message: `${existing.holdStage} (${existing.batchNumber}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminHoldTimeRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Hold time record not found');
  }
  const existing = snap.data() || {};
  if (!['Draft', 'Under Review'].includes(String(existing.reviewStatus))) {
    throw new HttpsError('failed-precondition', `Cannot approve from status ${existing.reviewStatus}`);
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Approved',
    isLocked: true,
    approvedBy: actorName,
    reviewDate: now.slice(0, 10),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.holdTimeId || ''),
    actionType: 'Hold Time Approved',
    description: `Approved and locked ${existing.holdTimeId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.holdTimeId || ''),
    actionType: 'Electronic Signature',
    description: `E-sign by ${actorName}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminHoldTimeRecords = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk hold time entry');
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
      if (await findDuplicate(firestore, payload.batchNumber, payload.holdStage)) {
        errors.push(`${payload.holdStage}: duplicate`);
        continue;
      }
      const computed = computeFields(payload, now);
      const priorExceeded = await countExceededHoldTimes(firestore, payload.batchNumber);
      const exceededCount = priorExceeded + (['Exceeded', 'Expired'].includes(computed.status) ? 1 : 0);
      const riskLevel = evaluateRisk({
        holdStage: payload.holdStage,
        status: computed.status,
        materialCategory: payload.materialCategory,
        storageExcursion: computed.storageExcursion,
      }, exceededCount);
      const ref = firestore.collection(COLLECTION).doc();
      const record = {
        ...payload,
        ...computed,
        id: ref.id,
        riskLevel,
        capaRequired: exceededCount >= 3,
        deviationRequired: payload.autoDeviationRequired && ['Exceeded', 'Expired', 'Action', 'Near Expiry'].includes(computed.status),
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
      writeHoldAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.holdTimeId,
        actionType: 'Hold Time Bulk Created',
        description: `Bulk ${payload.holdStage} → ${computed.status}`,
        newValue: { status: computed.status },
        reason,
        now,
      });
      await batch.commit();
      created += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Unknown bulk error');
    }
  }
  return { created, errors };
});

export const softDeleteAdminHoldTimeRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Hold time record not found');
  }
  if (snap.data()?.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot delete approved hold time records');
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
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(snap.data()?.holdTimeId || ''),
    actionType: 'Hold Time Archived',
    description: 'Soft-deleted hold time record',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminHoldTimeExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeHoldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Hold Time Export',
    description: `Exported ${Number(data.count || 0)} records`,
    newValue: { count: Number(data.count || 0), format: optionalString(data.format, 'Format', 40) || 'CSV' },
    reason: optionalString(data.changeReason, 'Change reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
