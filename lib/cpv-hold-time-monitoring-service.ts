import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import {
  HOLD_TIME_MONITORING_COLLECTION,
  HOLD_TIME_MASTER_COLLECTION,
  HOLD_TIME_LEGACY_COLLECTIONS,
  HOLD_TIME_MODULE_NAME,
  BULK_HOLD_STAGES,
  buildHoldTimeId,
  buildHoldTimeCode,
  buildHoldTimeComputedFields,
  calculateActualHoldTime,
  calculateHoldDifference,
  calculateRemainingTime,
  calculateExceededTime,
  calculateTimeUtilization,
  evaluateHoldTimeStatus,
  evaluateHoldTimeRisk,
  evaluateStorageExcursion,
  type HoldTimeMonitoringFormData,
  type HoldTimeMonitoringRecord,
} from '@/lib/cpv-hold-time-monitoring';

export interface HoldTimeActor {
  id: string;
  name: string;
  role?: string;
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function optionalNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function cfErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const message = String((e as { message?: string }).message || '');
    if (message) return message.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '').trim() || fallback;
  }
  return fallback;
}

function normalizeHoldTimeRecord(raw: Record<string, unknown>): HoldTimeMonitoringRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const holdStage = str(raw.holdStage || raw.hold_stage || raw.stage, 'Bulk Hold Time');
  const allowed = num(raw.allowedHoldTime ?? raw.allowed_hold_time ?? raw.allowedTime);
  const unit = str(raw.holdTimeUnit || raw.hold_time_unit || raw.unit, 'Hours');
  const start = str(raw.startDateTime || raw.start_date_time || raw.startTime);
  const end = str(raw.endDateTime || raw.end_date_time || raw.endTime);
  const actual = num(
    raw.actualHoldTime ?? raw.actual_hold_time ?? raw.actualTime,
    calculateActualHoldTime(start, end, unit),
  );
  const difference = num(raw.difference, calculateHoldDifference(allowed, actual));
  const remainingTime = num(raw.remainingTime, calculateRemainingTime(allowed, actual));
  const exceededTime = num(raw.exceededTime, calculateExceededTime(allowed, actual));
  const timeUtilizationPercent = num(
    raw.timeUtilizationPercent,
    calculateTimeUtilization(allowed, actual),
  );
  const status = str(
    raw.status || raw.complianceStatus || raw.compliance_status,
    evaluateHoldTimeStatus(actual, allowed, { endDateTime: end }),
  );
  const temperature = optionalNum(raw.temperature);
  const humidity = optionalNum(raw.humidity);
  const temperatureLimitLow = optionalNum(raw.temperatureLimitLow);
  const temperatureLimitHigh = optionalNum(raw.temperatureLimitHigh);
  const humidityLimitLow = optionalNum(raw.humidityLimitLow);
  const humidityLimitHigh = optionalNum(raw.humidityLimitHigh);
  const excursions = evaluateStorageExcursion({
    temperature, humidity, temperatureLimitLow, temperatureLimitHigh, humidityLimitLow, humidityLimitHigh,
  });

  return {
    id: str(raw.id),
    holdTimeId: str(raw.holdTimeId || raw.hold_time_id, buildHoldTimeId(batchNumber, holdStage)),
    holdTimeCode: str(raw.holdTimeCode, buildHoldTimeCode(batchNumber, holdStage)),
    studyNumber: str(raw.studyNumber),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    productVersion: str(raw.productVersion),
    material: str(raw.material),
    materialCategory: (str(raw.materialCategory, 'N/A') as HoldTimeMonitoringRecord['materialCategory']),
    equipmentId: str(raw.equipmentId),
    equipmentName: str(raw.equipmentName),
    batchNumber,
    manufacturingOrder: str(raw.manufacturingOrder),
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
    processStage: str(raw.processStage || raw.process_stage || holdStage),
    operation: str(raw.operation),
    holdStage,
    department: str(raw.department, 'Production'),
    productionLine: str(raw.productionLine),
    site: str(raw.site),
    storageLocation: str(raw.storageLocation),
    storageCondition: str(raw.storageCondition),
    temperature,
    humidity,
    temperatureLimitLow,
    temperatureLimitHigh,
    humidityLimitLow,
    humidityLimitHigh,
    startDateTime: start,
    endDateTime: end,
    actualHoldTime: actual,
    elapsedTime: num(raw.elapsedTime, actual),
    remainingTime,
    exceededTime,
    timeUtilizationPercent,
    allowedHoldTime: allowed,
    holdTimeUnit: (unit === 'Minutes' || unit === 'Days' ? unit : 'Hours') as HoldTimeMonitoringRecord['holdTimeUnit'],
    difference,
    complianceStatus: status,
    status,
    nearExpiry: Boolean(raw.nearExpiry) || (remainingTime <= allowed * 0.2 && remainingTime > 0),
    temperatureExcursion: Boolean(raw.temperatureExcursion) || excursions.temperatureExcursion,
    humidityExcursion: Boolean(raw.humidityExcursion) || excursions.humidityExcursion,
    storageExcursion: Boolean(raw.storageExcursion) || excursions.storageExcursion,
    effectiveDate: str(raw.effectiveDate),
    reviewDate: str(raw.reviewDate || raw.review_date),
    description: str(raw.description),
    reasonForHold: str(raw.reasonForHold || raw.reason_for_hold),
    extensionApproved: Boolean(raw.extensionApproved || raw.extension_approved),
    extensionReason: str(raw.extensionReason || raw.extension_reason),
    approvedBy: str(raw.approvedBy || raw.approved_by),
    remarks: str(raw.remarks),
    autoDeviationRequired: Boolean(raw.autoDeviationRequired ?? raw.auto_deviation_required ?? true),
    timerStatus: (str(raw.timerStatus, end ? 'Completed' : 'Not Started') as HoldTimeMonitoringRecord['timerStatus']),
    changeReason: str(raw.changeReason || raw.change_reason),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as HoldTimeMonitoringRecord['reviewStatus']),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export { buildHoldTimeComputedFields };

export async function fetchHoldTimeMaster(stage: string): Promise<{ allowed: number; unit: string } | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), HOLD_TIME_MASTER_COLLECTION),
      where('holdStage', '==', stage),
      limit(1),
    ));
    if (snap.empty) {
      const snap2 = await getDocs(query(
        collection(getFirebaseFirestore(), HOLD_TIME_MASTER_COLLECTION),
        where('stage', '==', stage),
        limit(1),
      ));
      if (snap2.empty) return null;
      const d = snap2.docs[0].data();
      return {
        allowed: num(d.allowedHoldTime ?? d.allowed_hold_time ?? d.allowedTime),
        unit: str(d.holdTimeUnit || d.unit, 'Hours'),
      };
    }
    const d = snap.docs[0].data();
    return {
      allowed: num(d.allowedHoldTime ?? d.allowed_hold_time ?? d.allowedTime),
      unit: str(d.holdTimeUnit || d.unit, 'Hours'),
    };
  } catch {
    return null;
  }
}

export async function fetchHoldTimeRecords(max = 500): Promise<HoldTimeMonitoringRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: HoldTimeMonitoringRecord[] = [];
    try {
      primary = await getRecords<HoldTimeMonitoringRecord>(
        HOLD_TIME_MONITORING_COLLECTION,
        [orderBy('createdAt', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<HoldTimeMonitoringRecord>(HOLD_TIME_MONITORING_COLLECTION, [limit(max)]);
    }
    const normalized = primary
      .map((r) => normalizeHoldTimeRecord(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const legacy of HOLD_TIME_LEGACY_COLLECTIONS) {
      const legacyRows = await listCpvRecords<Record<string, unknown>>(legacy, max);
      if (legacyRows.length) return legacyRows.map((r) => normalizeHoldTimeRecord(r)).filter((r) => !r.isDeleted);
    }
    const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.holdTime, max);
    return cpvLegacy.map((r) => normalizeHoldTimeRecord(r)).filter((r) => !r.isDeleted);
  } catch (e) {
    console.error('fetchHoldTimeRecords failed', e);
    return [];
  }
}

export async function fetchHoldTimeRecordById(id: string): Promise<HoldTimeMonitoringRecord | null> {
  const record = await getRecord<HoldTimeMonitoringRecord>(HOLD_TIME_MONITORING_COLLECTION, id);
  if (record && !(record as HoldTimeMonitoringRecord).isDeleted) {
    return normalizeHoldTimeRecord(record as unknown as Record<string, unknown>);
  }
  const all = await fetchHoldTimeRecords();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchHoldTimeBatchesForProduct(productName: string, productId?: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) =>
    b.productName === productName
    || b.productCode === productName
    || (productId && b.cpvProductId === productId),
  );
}

export async function createHoldTimeRecord(
  data: HoldTimeMonitoringFormData,
  _actor: HoldTimeActor,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: HoldTimeMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for hold time entry.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminHoldTimeRecord',
    );
    const result = await fn({
      ...data,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      changeReason: data.changeReason,
    });
    return { result: normalizeHoldTimeRecord(result.data), error: null };
  } catch (e) {
    console.error('createHoldTimeRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create hold time record.') };
  }
}

export async function updateHoldTimeRecord(
  id: string,
  data: Partial<HoldTimeMonitoringFormData>,
  _actor: HoldTimeActor,
  existing: HoldTimeMonitoringRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: HoldTimeMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved hold time record is locked. QA override required.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminHoldTimeRecord',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { result: normalizeHoldTimeRecord(result.data), error: null };
  } catch (e) {
    console.error('updateHoldTimeRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update hold time record.') };
  }
}

export async function reviewHoldTimeRecord(
  id: string,
  _actor: HoldTimeActor,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminHoldTimeRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeHoldTimeRecord(result.data), error: null };
  } catch (e) {
    console.error('reviewHoldTimeRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveHoldTimeRecord(
  id: string,
  _actor: HoldTimeActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'approveAdminHoldTimeRecord',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeHoldTimeRecord(result.data), error: null };
  } catch (e) {
    console.error('approveHoldTimeRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve hold time record.') };
  }
}

export async function softDeleteHoldTimeRecord(
  id: string,
  _actor: HoldTimeActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
): Promise<{ error: string | null }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminHoldTimeRecord');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    console.error('softDeleteHoldTimeRecord failed', e);
    return { error: cfErrorMessage(e, 'Failed to soft-delete hold time record.') };
  }
}

export async function bulkCreateHoldTimeRecords(
  rows: HoldTimeMonitoringFormData[],
  _actor: HoldTimeActor,
  changeReason = 'Bulk hold time entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { created: 0, errors: ['Change reason (min 5 characters) is required.'] };
    }
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminHoldTimeRecords',
    );
    const result = await fn({ rows, changeReason });
    return result.data;
  } catch (e) {
    console.error('bulkCreateHoldTimeRecords failed', e);
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function fetchHoldTimeAuditTrail(recordId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), 'audit_trail'),
      where('documentId', '==', recordId),
      limit(50),
    ));
    if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const snap2 = await getDocs(query(
      collection(getFirebaseFirestore(), 'audit_trail'),
      where('recordId', '==', recordId),
      limit(50),
    ));
    return snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function logHoldTimeExport(actor: HoldTimeActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminHoldTimeExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logHoldTimeExport CF failed (non-blocking)', e);
  }
}

export function holdTimeStageTrendData(records: HoldTimeMonitoringRecord[], stage: string) {
  return records
    .filter((r) => r.holdStage === stage || r.processStage === stage)
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
    .map((r) => ({
      label: r.batchNumber,
      observed: r.actualHoldTime,
      target: r.allowedHoldTime,
      lsl: 0,
      usl: r.allowedHoldTime,
    }));
}

export function refreshLiveHoldMetrics(record: HoldTimeMonitoringRecord, now = new Date()): HoldTimeMonitoringRecord {
  if (record.endDateTime?.trim()) return record;
  const computed = buildHoldTimeComputedFields(record, now);
  const riskLevel = evaluateHoldTimeRisk(
    { ...record, ...computed },
    record.status === 'Exceeded' || record.status === 'Expired' ? 1 : 0,
  );
  return { ...record, ...computed, riskLevel };
}

export const BULK_HOLD_STAGE_OPTIONS = BULK_HOLD_STAGES;

// Silence unused import warning for module name in tree-shaken builds
void HOLD_TIME_MODULE_NAME;
