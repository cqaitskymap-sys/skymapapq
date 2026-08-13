/**
 * CPV Yield Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, yield calculation + OOS/OOT.
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

const COLLECTION = 'yield_monitoring';
const MODULE = 'Yield Monitoring';

const ENTER_ROLES = [
  'super_admin', 'admin', 'production', 'production_manager',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES,
  ...REVIEW_ROLES,
  'warehouse', 'warehouse_manager',
  'qc', 'qc_manager', 'viewer', 'auditor',
];

const YIELD_STAGES = [
  'Bulk Yield', 'Filling Yield', 'Packing Yield', 'Overall Yield',
  'Process Yield', 'Stage Yield', 'Recovery Yield', 'Packaging Yield',
] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Yield Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Yield Monitoring entry access required');
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

function buildId(batchNumber: string, yieldStage: string): string {
  return `YLD-${batchNumber}-${yieldStage}`.replace(/\s+/g, '-').toUpperCase();
}

function calculateLossQuantity(theoretical: number, actual: number): number {
  return Math.max(0, Math.round((theoretical - actual) * 10000) / 10000);
}

function calculateYieldPercentage(theoretical: number, actual: number): number {
  if (theoretical <= 0) return 0;
  return Math.round((actual / theoretical) * 10000) / 100;
}

function calculateNetYieldPercentage(
  theoretical: number,
  actual: number,
  reject: number,
  scrap: number,
  waste: number,
): number {
  if (theoretical <= 0) return 0;
  const net = Math.max(0, actual - reject - scrap - waste);
  return Math.round((net / theoretical) * 10000) / 100;
}

function calculateVariancePercentage(targetYield: number, yieldPercentage: number): number {
  return Math.round((targetYield - yieldPercentage) * 100) / 100;
}

function evaluateStatus(
  yieldPct: number,
  lowerLimit: number,
  upperLimit: number,
  alertLow?: number,
  alertHigh?: number,
  actionLow?: number,
  actionHigh?: number,
): string {
  if (!Number.isFinite(yieldPct)) return 'OOS';
  if (yieldPct < lowerLimit) return 'OOS';
  if (yieldPct > upperLimit) return 'High Yield';
  if (actionLow != null && yieldPct < actionLow) return 'Action';
  if (actionHigh != null && yieldPct > actionHigh) return 'Action';
  if (alertLow != null && yieldPct < alertLow) return 'Alert';
  if (alertHigh != null && yieldPct > alertHigh) return 'Alert';
  if (alertLow == null && alertHigh == null) {
    const range = upperLimit - lowerLimit;
    if (range > 0) {
      const bandLow = lowerLimit + range * 0.1;
      const bandHigh = upperLimit - range * 0.1;
      if (yieldPct < bandLow || yieldPct > bandHigh) return 'OOT';
    }
  }
  return 'Complies';
}

function evaluateRisk(
  input: {
    yieldStage: string;
    yieldPercentage: number;
    variancePercentage: number;
    status: string;
    scrapQuantity: number;
    wasteQuantity: number;
  },
  lowYieldBatchCount: number,
): string {
  if (lowYieldBatchCount >= 3) return 'Critical';
  if (input.scrapQuantity > 0 && input.status === 'OOS') return 'High';
  if (input.wasteQuantity > 0 && ['OOS', 'Action'].includes(input.status)) return 'High';
  const variance = Math.abs(input.variancePercentage);
  if (variance > 5) return 'High';
  if ((input.yieldStage === 'Packing Yield' || input.yieldStage === 'Packaging Yield') && input.yieldPercentage < 94) {
    return (94 - input.yieldPercentage) > 3 ? 'High' : 'Medium';
  }
  if (['Bulk Yield', 'Filling Yield', 'Process Yield'].includes(input.yieldStage) && ['OOS', 'Low Yield'].includes(input.status)) {
    return 'High';
  }
  if (['OOS', 'Low Yield', 'High Yield', 'Action'].includes(input.status)) return 'Medium';
  if (['Alert', 'OOT'].includes(input.status)) return 'Low';
  return 'Low';
}

function writeYieldAudit(
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
    auditId: `AUD-YLD-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-yield-admin',
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
    type: 'cpv_yield',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/yield-monitoring/${input.recordId}`,
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
  yieldStage: string,
  excludeId?: string,
) {
  const snap = await firestore
    .collection(COLLECTION)
    .where('batchNumber', '==', batchNumber)
    .where('yieldStage', '==', yieldStage)
    .limit(10)
    .get();
  return snap.docs.find((d) => d.id !== excludeId && d.data()?.isDeleted !== true);
}

async function countLowYieldBatches(
  firestore: Firestore,
  productName: string,
  yieldStage: string,
): Promise<number> {
  try {
    const snap = await firestore
      .collection(COLLECTION)
      .where('productName', '==', productName)
      .where('yieldStage', '==', yieldStage)
      .limit(100)
      .get();
    const batches = new Set(
      snap.docs
        .filter((d) => {
          const data = d.data() || {};
          return data.isDeleted !== true
            && ['OOS', 'Low Yield', 'Action', 'Alert'].includes(String(data.status || ''));
        })
        .map((d) => String(d.data()?.batchNumber || '')),
    );
    return batches.size;
  } catch {
    return 0;
  }
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const yieldStage = optionalString(data.yieldStage ?? existing?.yieldStage, 'Yield stage', 80) || 'Bulk Yield';
  if (!YIELD_STAGES.includes(yieldStage as typeof YIELD_STAGES[number])) {
    throw new HttpsError('invalid-argument', `Invalid yield stage: ${yieldStage}`);
  }

  const theoreticalQuantity = asFiniteNumber(data.theoreticalQuantity ?? existing?.theoreticalQuantity, 'Theoretical quantity');
  if (theoreticalQuantity <= 0) {
    throw new HttpsError('invalid-argument', 'Theoretical quantity must be greater than 0');
  }
  const actualQuantity = asFiniteNumber(data.actualQuantity ?? existing?.actualQuantity, 'Actual quantity');
  if (actualQuantity < 0) {
    throw new HttpsError('invalid-argument', 'Actual quantity cannot be negative');
  }

  const lowerLimit = asFiniteNumber(data.lowerLimit ?? existing?.lowerLimit, 'Lower limit');
  const upperLimit = asFiniteNumber(data.upperLimit ?? existing?.upperLimit, 'Upper limit');
  if (lowerLimit >= upperLimit) {
    throw new HttpsError('invalid-argument', 'Upper limit must be greater than lower limit');
  }
  const targetYield = asFiniteNumber(data.targetYield ?? existing?.targetYield, 'Target yield');

  const rejectQuantity = optionalFiniteNumber(data.rejectQuantity ?? existing?.rejectQuantity) ?? 0;
  const reworkQuantity = optionalFiniteNumber(data.reworkQuantity ?? existing?.reworkQuantity) ?? 0;
  const scrapQuantity = optionalFiniteNumber(data.scrapQuantity ?? existing?.scrapQuantity) ?? 0;
  const wasteQuantity = optionalFiniteNumber(data.wasteQuantity ?? existing?.wasteQuantity) ?? 0;
  if (rejectQuantity < 0 || reworkQuantity < 0 || scrapQuantity < 0 || wasteQuantity < 0) {
    throw new HttpsError('invalid-argument', 'Reject/rework/scrap/waste cannot be negative');
  }

  const alertLimitLow = optionalFiniteNumber(data.alertLimitLow ?? existing?.alertLimitLow);
  const alertLimitHigh = optionalFiniteNumber(data.alertLimitHigh ?? existing?.alertLimitHigh);
  const actionLimitLow = optionalFiniteNumber(data.actionLimitLow ?? existing?.actionLimitLow);
  const actionLimitHigh = optionalFiniteNumber(data.actionLimitHigh ?? existing?.actionLimitHigh);
  const releasedQuantity = optionalFiniteNumber(data.releasedQuantity ?? existing?.releasedQuantity);
  const materialConsumed = optionalFiniteNumber(data.materialConsumed ?? existing?.materialConsumed);
  const materialVariance = optionalFiniteNumber(data.materialVariance ?? existing?.materialVariance);

  const batchNumber = requiredString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80);

  return {
    recordType: 'yield_monitoring',
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),
    batchNumber,
    manufacturingDate: requiredString(data.manufacturingDate ?? existing?.manufacturingDate, 'Manufacturing date', 40),
    manufacturingOrder: optionalString(data.manufacturingOrder ?? existing?.manufacturingOrder, 'Manufacturing order', 80),
    workOrder: optionalString(data.workOrder ?? existing?.workOrder, 'Work order', 80),
    campaign: optionalString(data.campaign ?? existing?.campaign, 'Campaign', 80),
    batchSize: optionalString(data.batchSize ?? existing?.batchSize, 'Batch size', 80),
    batchSizeUnit: optionalString(data.batchSizeUnit ?? existing?.batchSizeUnit, 'Batch size unit', 40),
    yieldStage,
    processStep: optionalString(data.processStep ?? existing?.processStep, 'Process step', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Production',
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    productionLine: optionalString(data.productionLine ?? existing?.productionLine, 'Production line', 120),
    equipmentId: optionalString(data.equipmentId ?? existing?.equipmentId, 'Equipment id', 120),
    equipmentName: optionalString(data.equipmentName ?? existing?.equipmentName, 'Equipment name', 200),
    operator: optionalString(data.operator ?? existing?.operator, 'Operator', 120),
    supervisor: optionalString(data.supervisor ?? existing?.supervisor, 'Supervisor', 120),
    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40),
    theoreticalQuantity,
    actualQuantity,
    rejectQuantity,
    reworkQuantity,
    scrapQuantity,
    wasteQuantity,
    releasedQuantity: releasedQuantity ?? null,
    materialConsumed: materialConsumed ?? null,
    materialVariance: materialVariance ?? null,
    lowerLimit,
    upperLimit,
    targetYield,
    unit: optionalString(data.unit ?? existing?.unit, 'Unit', 40) || 'units',
    alertLimitLow: alertLimitLow ?? null,
    alertLimitHigh: alertLimitHigh ?? null,
    actionLimitLow: actionLimitLow ?? null,
    actionLimitHigh: actionLimitHigh ?? null,
    recordedBy: requiredString(data.recordedBy ?? existing?.recordedBy, 'Recorded by', 120),
    reviewedBy: optionalString(data.reviewedBy ?? existing?.reviewedBy, 'Reviewed by', 120),
    reviewDate: optionalString(data.reviewDate ?? existing?.reviewDate, 'Review date', 40),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    autoDeviationRequired: data.autoDeviationRequired !== false
      && existing?.autoDeviationRequired !== false,
    specificationNumber: optionalString(data.specificationNumber ?? existing?.specificationNumber, 'Specification', 80),
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    calculationVersion: optionalString(data.calculationVersion ?? existing?.calculationVersion, 'Calculation version', 40) || '1.0',
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    yieldMonitoringId: buildId(batchNumber, yieldStage),
    batchNo: batchNumber,
    lsl: lowerLimit,
    usl: upperLimit,
  };
}

function computeFields(payload: ReturnType<typeof sanitizePayload>) {
  const lossQuantity = calculateLossQuantity(payload.theoreticalQuantity, payload.actualQuantity);
  const yieldPercentage = calculateYieldPercentage(payload.theoreticalQuantity, payload.actualQuantity);
  const netYieldPercentage = calculateNetYieldPercentage(
    payload.theoreticalQuantity,
    payload.actualQuantity,
    payload.rejectQuantity,
    payload.scrapQuantity,
    payload.wasteQuantity,
  );
  const variancePercentage = calculateVariancePercentage(payload.targetYield, yieldPercentage);
  const status = evaluateStatus(
    yieldPercentage,
    payload.lowerLimit,
    payload.upperLimit,
    payload.alertLimitLow ?? undefined,
    payload.alertLimitHigh ?? undefined,
    payload.actionLimitLow ?? undefined,
    payload.actionLimitHigh ?? undefined,
  );
  return { lossQuantity, yieldPercentage, netYieldPercentage, variancePercentage, status };
}

export const createAdminYieldRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
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

  if (!qaOverride && payload.actualQuantity > payload.theoreticalQuantity) {
    throw new HttpsError('failed-precondition', 'Actual quantity cannot exceed theoretical quantity without QA override');
  }
  if (await findDuplicate(firestore, payload.batchNumber, payload.yieldStage)) {
    throw new HttpsError('already-exists', 'Yield record already exists for this batch and stage');
  }

  const computed = computeFields(payload);
  const lowYieldCount = await countLowYieldBatches(firestore, payload.productName, payload.yieldStage);
  const riskLevel = evaluateRisk({
    yieldStage: payload.yieldStage,
    yieldPercentage: computed.yieldPercentage,
    variancePercentage: computed.variancePercentage,
    status: computed.status,
    scrapQuantity: payload.scrapQuantity,
    wasteQuantity: payload.wasteQuantity,
  }, lowYieldCount);

  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...payload,
    ...computed,
    id: ref.id,
    riskLevel,
    capaRequired: lowYieldCount >= 3,
    deviationRequired: payload.autoDeviationRequired && computed.status !== 'Complies',
    oosRequired: computed.status === 'OOS' || computed.status === 'Low Yield',
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
  writeYieldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.yieldMonitoringId,
    actionType: 'Yield Created',
    description: `Recorded ${payload.yieldStage} ${computed.yieldPercentage}% → ${computed.status}`,
    newValue: { status: computed.status, yieldPercentage: computed.yieldPercentage, riskLevel },
    reason,
    now,
    esign: qaOverride,
  });
  writeYieldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.yieldMonitoringId,
    actionType: 'Yield Calculated',
    description: `Yield ${computed.yieldPercentage}% (net ${computed.netYieldPercentage}%), loss ${computed.lossQuantity}`,
    newValue: computed,
    reason,
    now,
  });

  if (computed.status === 'OOS' || computed.status === 'Low Yield') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Yield Below Target',
      title: 'Yield OOS / Low Yield',
      message: `${payload.batchNumber}: ${payload.yieldStage} ${computed.yieldPercentage}%`,
      now,
    });
  } else if (computed.status === 'High Yield') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Yield Above Target',
      title: 'High Yield',
      message: `${payload.batchNumber}: ${payload.yieldStage} ${computed.yieldPercentage}%`,
      now,
    });
  } else if (computed.status === 'OOT' || computed.status === 'Alert') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'OOT Detected',
      title: `Yield ${computed.status}`,
      message: `${payload.batchNumber}: ${payload.yieldStage} ${computed.yieldPercentage}%`,
      now,
    });
  }
  if (payload.scrapQuantity > 0 && computed.status !== 'Complies') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'High Scrap',
      title: 'Scrap Quantity Recorded',
      message: `${payload.batchNumber}: scrap ${payload.scrapQuantity} ${payload.unit}`,
      now,
    });
  }
  if (payload.wasteQuantity > 0 && computed.status !== 'Complies') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'High Waste',
      title: 'Waste Quantity Recorded',
      message: `${payload.batchNumber}: waste ${payload.wasteQuantity} ${payload.unit}`,
      now,
    });
  }
  await batch.commit();
  return record;
});

export const updateAdminYieldRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Yield record not found');
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
  if (!qaOverride && payload.actualQuantity > payload.theoreticalQuantity) {
    throw new HttpsError('failed-precondition', 'Actual quantity cannot exceed theoretical quantity without QA override');
  }
  if (await findDuplicate(firestore, payload.batchNumber, payload.yieldStage, id)) {
    throw new HttpsError('already-exists', 'Duplicate yield monitoring entry');
  }

  const computed = computeFields(payload);
  const lowYieldCount = await countLowYieldBatches(firestore, payload.productName, payload.yieldStage);
  const riskLevel = evaluateRisk({
    yieldStage: payload.yieldStage,
    yieldPercentage: computed.yieldPercentage,
    variancePercentage: computed.variancePercentage,
    status: computed.status,
    scrapQuantity: payload.scrapQuantity,
    wasteQuantity: payload.wasteQuantity,
  }, lowYieldCount);

  const now = new Date().toISOString();
  const updates = {
    ...payload,
    ...computed,
    riskLevel,
    capaRequired: lowYieldCount >= 3,
    deviationRequired: payload.autoDeviationRequired && computed.status !== 'Complies',
    oosRequired: computed.status === 'OOS' || computed.status === 'Low Yield',
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeYieldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.yieldMonitoringId,
    actionType: qaOverride ? 'Yield QA Override' : 'Yield Updated',
    description: `Updated ${payload.yieldStage} → ${computed.status} (${computed.yieldPercentage}%)`,
    oldValue: { status: existing.status, yieldPercentage: existing.yieldPercentage },
    newValue: { status: computed.status, yieldPercentage: computed.yieldPercentage },
    reason,
    now,
    esign: qaOverride,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminYieldRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Yield record not found');
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
  writeYieldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.yieldMonitoringId || ''),
    actionType: 'Yield Review Submitted',
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
    title: 'Yield Review Pending',
    message: `${existing.yieldStage} (${existing.batchNumber}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminYieldRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Yield record not found');
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
  writeYieldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.yieldMonitoringId || ''),
    actionType: 'Yield Approved',
    description: `Approved and locked ${existing.yieldMonitoringId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminYieldRecords = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk yield entry');
  const qaOverride = data.qaOverride === true;
  if (qaOverride) {
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  }
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
      if (!qaOverride && payload.actualQuantity > payload.theoreticalQuantity) {
        errors.push(`${payload.yieldStage}: actual exceeds theoretical (QA override required)`);
        continue;
      }
      if (await findDuplicate(firestore, payload.batchNumber, payload.yieldStage)) {
        errors.push(`${payload.yieldStage}: duplicate`);
        continue;
      }
      const computed = computeFields(payload);
      const lowYieldCount = await countLowYieldBatches(firestore, payload.productName, payload.yieldStage);
      const riskLevel = evaluateRisk({
        yieldStage: payload.yieldStage,
        yieldPercentage: computed.yieldPercentage,
        variancePercentage: computed.variancePercentage,
        status: computed.status,
        scrapQuantity: payload.scrapQuantity,
        wasteQuantity: payload.wasteQuantity,
      }, lowYieldCount);
      const ref = firestore.collection(COLLECTION).doc();
      const record = {
        ...payload,
        ...computed,
        id: ref.id,
        riskLevel,
        capaRequired: lowYieldCount >= 3,
        deviationRequired: payload.autoDeviationRequired && computed.status !== 'Complies',
        oosRequired: computed.status === 'OOS' || computed.status === 'Low Yield',
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
      writeYieldAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.yieldMonitoringId,
        actionType: 'Yield Created',
        description: `Bulk recorded ${payload.yieldStage}`,
        newValue: { status: computed.status, yieldPercentage: computed.yieldPercentage },
        reason,
        now,
        esign: qaOverride,
      });
      await batch.commit();
      created += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Unknown bulk error');
    }
  }

  if (created > 0) {
    const batch = firestore.batch();
    writeYieldAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: 'bulk',
      actionType: 'Yield Bulk Entry',
      description: `Bulk created ${created} yield records`,
      newValue: { created, errors: errors.length },
      reason,
      now,
    });
    await batch.commit();
  }

  return { created, errors };
});

export const softDeleteAdminYieldRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Yield record not found');
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
  writeYieldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.yieldMonitoringId || ''),
    actionType: 'Yield Archived',
    description: `Soft-deleted ${existing.yieldMonitoringId}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminYieldExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const batch = firestore.batch();
  writeYieldAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Yield Export',
    description: `Exported ${count} records (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
