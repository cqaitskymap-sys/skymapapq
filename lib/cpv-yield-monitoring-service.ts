/**
 * CPV Yield Monitoring — client service.
 * Reads: Firestore. Writes: Cloud Functions only.
 */
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchParameters, normalizeParameter } from '@/lib/admin/parameter-service';
import type { Parameter } from '@/lib/admin/schemas';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import {
  YIELD_MONITORING_COLLECTION,
  YIELD_LEGACY_COLLECTIONS,
  YIELD_STAGES,
  buildYieldMonitoringId,
  calculateLossQuantity,
  calculateYieldPercentage,
  calculateNetYieldPercentage,
  calculateVariancePercentage,
  evaluateYieldStatus,
  defaultLimitsForStage,
  type YieldMonitoringFormData,
  type YieldMonitoringRecord,
} from '@/lib/cpv-yield-monitoring';

export interface YieldActor {
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
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '').trim() || fallback;
  }
  return fallback;
}

export function normalizeYieldRecord(raw: Record<string, unknown>): YieldMonitoringRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const yieldStage = str(raw.yieldStage || raw.stage || raw.yield_stage, 'Bulk Yield');
  const theoretical = num(raw.theoreticalQuantity ?? raw.theoretical_quantity ?? raw.expectedYield);
  const actual = num(raw.actualQuantity ?? raw.actual_quantity ?? raw.actualYield);
  const rejectQuantity = num(raw.rejectQuantity ?? raw.reject_quantity);
  const scrapQuantity = num(raw.scrapQuantity ?? raw.scrap_quantity);
  const wasteQuantity = num(raw.wasteQuantity ?? raw.waste_quantity);
  const targetYield = num(raw.targetYield ?? raw.target_yield ?? raw.target);
  const yieldPct = num(
    raw.yieldPercentage ?? raw.yield_percent ?? raw.yieldPercent,
    calculateYieldPercentage(theoretical, actual),
  );
  const netYield = num(
    raw.netYieldPercentage ?? raw.net_yield_percentage,
    calculateNetYieldPercentage(theoretical, actual, rejectQuantity, scrapQuantity, wasteQuantity),
  );
  return {
    id: str(raw.id),
    yieldMonitoringId: str(raw.yieldMonitoringId || raw.yield_monitoring_id, buildYieldMonitoringId(batchNumber, yieldStage)),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    productVersion: str(raw.productVersion || raw.product_version),
    batchNumber,
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
    manufacturingOrder: str(raw.manufacturingOrder || raw.manufacturing_order),
    workOrder: str(raw.workOrder || raw.work_order),
    campaign: str(raw.campaign),
    batchSize: str(raw.batchSize || raw.batch_size),
    batchSizeUnit: str(raw.batchSizeUnit || raw.batch_size_unit),
    yieldStage: yieldStage as YieldMonitoringRecord['yieldStage'],
    processStep: str(raw.processStep || raw.process_step),
    department: str(raw.department),
    site: str(raw.site),
    productionLine: str(raw.productionLine || raw.production_line),
    equipmentId: str(raw.equipmentId || raw.equipment_id),
    equipmentName: str(raw.equipmentName || raw.equipment_name),
    operator: str(raw.operator),
    supervisor: str(raw.supervisor),
    shift: str(raw.shift),
    theoreticalQuantity: theoretical,
    actualQuantity: actual,
    rejectQuantity,
    reworkQuantity: num(raw.reworkQuantity ?? raw.rework_quantity),
    scrapQuantity,
    wasteQuantity,
    releasedQuantity: optionalNum(raw.releasedQuantity ?? raw.released_quantity),
    materialConsumed: optionalNum(raw.materialConsumed ?? raw.material_consumed),
    materialVariance: optionalNum(raw.materialVariance ?? raw.material_variance),
    lossQuantity: num(raw.lossQuantity ?? raw.loss_quantity, calculateLossQuantity(theoretical, actual)),
    yieldPercentage: yieldPct,
    netYieldPercentage: netYield,
    variancePercentage: num(raw.variancePercentage ?? raw.variance_percent, calculateVariancePercentage(targetYield, yieldPct)),
    lowerLimit: num(raw.lowerLimit ?? raw.lower_limit ?? raw.lsl),
    upperLimit: num(raw.upperLimit ?? raw.upper_limit ?? raw.usl),
    targetYield,
    unit: str(raw.unit, 'units'),
    alertLimitLow: optionalNum(raw.alertLimitLow ?? raw.alert_limit_low),
    alertLimitHigh: optionalNum(raw.alertLimitHigh ?? raw.alert_limit_high),
    actionLimitLow: optionalNum(raw.actionLimitLow ?? raw.action_limit_low),
    actionLimitHigh: optionalNum(raw.actionLimitHigh ?? raw.action_limit_high),
    recordedBy: str(raw.recordedBy || raw.recorded_by),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    remarks: str(raw.remarks),
    autoDeviationRequired: Boolean(raw.autoDeviationRequired ?? raw.auto_deviation_required ?? true),
    specificationNumber: str(raw.specificationNumber || raw.specification_number),
    version: str(raw.version, '1.0'),
    calculationVersion: str(raw.calculationVersion || raw.calculation_version, '1.0'),
    effectiveDate: str(raw.effectiveDate || raw.effective_date),
    description: str(raw.description),
    changeReason: str(raw.changeReason || raw.change_reason),
    status: str(raw.status, 'Complies'),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as YieldMonitoringRecord['reviewStatus']),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    oosRequired: Boolean(raw.oosRequired || raw.oos_required),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function buildYieldComputedFields(data: {
  theoreticalQuantity: number;
  actualQuantity: number;
  targetYield: number;
  lowerLimit: number;
  upperLimit: number;
  alertLimitLow?: number;
  alertLimitHigh?: number;
  actionLimitLow?: number;
  actionLimitHigh?: number;
  rejectQuantity?: number;
  scrapQuantity?: number;
  wasteQuantity?: number;
}) {
  const lossQuantity = calculateLossQuantity(data.theoreticalQuantity, data.actualQuantity);
  const yieldPercentage = calculateYieldPercentage(data.theoreticalQuantity, data.actualQuantity);
  const netYieldPercentage = calculateNetYieldPercentage(
    data.theoreticalQuantity,
    data.actualQuantity,
    Number(data.rejectQuantity || 0),
    Number(data.scrapQuantity || 0),
    Number(data.wasteQuantity || 0),
  );
  const variancePercentage = calculateVariancePercentage(data.targetYield, yieldPercentage);
  const status = evaluateYieldStatus(
    yieldPercentage,
    data.lowerLimit,
    data.upperLimit,
    data.alertLimitLow,
    data.alertLimitHigh,
    data.actionLimitLow,
    data.actionLimitHigh,
  );
  return { lossQuantity, yieldPercentage, netYieldPercentage, variancePercentage, status };
}

export async function fetchYieldRecords(max = 500): Promise<YieldMonitoringRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: YieldMonitoringRecord[] = [];
    try {
      primary = await getRecords<YieldMonitoringRecord>(
        YIELD_MONITORING_COLLECTION,
        [orderBy('createdAt', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<YieldMonitoringRecord>(YIELD_MONITORING_COLLECTION, [limit(max)]);
    }
    const normalized = primary
      .map((r) => normalizeYieldRecord(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const legacyName of YIELD_LEGACY_COLLECTIONS) {
      const legacy = await listCpvRecords<Record<string, unknown>>(legacyName, max);
      if (legacy.length) {
        return legacy
          .map((r) => normalizeYieldRecord(r))
          .filter((r) => !r.isDeleted);
      }
    }
    const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.yieldMonitoring, max);
    if (cpvLegacy.length) {
      return cpvLegacy
        .map((r) => normalizeYieldRecord(r))
        .filter((r) => !r.isDeleted);
    }
    return [];
  } catch (e) {
    console.error('fetchYieldRecords failed', e);
    return [];
  }
}

export async function fetchYieldRecordById(id: string): Promise<YieldMonitoringRecord | null> {
  const record = await getRecord<YieldMonitoringRecord>(YIELD_MONITORING_COLLECTION, id);
  if (record) {
    const normalized = normalizeYieldRecord(record as unknown as Record<string, unknown>);
    return normalized.isDeleted ? null : normalized;
  }
  const all = await fetchYieldRecords();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchYieldBatchesForProduct(productName: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) => b.productName === productName || b.productCode === productName);
}

export async function fetchYieldStageParameters(stage?: string): Promise<Parameter[]> {
  try {
    const all = await fetchParameters();
    let params = all.filter((p) => {
      const n = normalizeParameter(p);
      return n.parameterType === 'Yield Parameter' && n.status === 'Active';
    });
    if (stage) {
      const filtered = params.filter((p) => p.parameterName?.includes(stage.replace(' Yield', '')) || stage === 'Overall Yield');
      if (filtered.length) params = filtered;
    }
    return params;
  } catch {
    return [];
  }
}

export async function createYieldRecord(
  data: YieldMonitoringFormData,
  _actor: YieldActor,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: YieldMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for yield entry.' };
    }
    if (!qaOverride && data.actualQuantity > data.theoreticalQuantity) {
      return { result: null, error: 'Actual quantity cannot exceed theoretical quantity without QA override.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminYieldRecord',
    );
    const result = await fn({
      ...data,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      changeReason: data.changeReason,
    });
    return { result: normalizeYieldRecord(result.data), error: null };
  } catch (e) {
    console.error('createYieldRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create yield record.') };
  }
}

export async function updateYieldRecord(
  id: string,
  data: Partial<YieldMonitoringFormData>,
  _actor: YieldActor,
  existing: YieldMonitoringRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: YieldMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved yield record is locked. QA override required.' };
    }
    const mergedActual = data.actualQuantity ?? existing.actualQuantity;
    const mergedTheoretical = data.theoreticalQuantity ?? existing.theoreticalQuantity;
    if (!qaOverride && mergedActual > mergedTheoretical) {
      return { result: null, error: 'Actual quantity cannot exceed theoretical quantity without QA override.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminYieldRecord',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { result: normalizeYieldRecord(result.data), error: null };
  } catch (e) {
    console.error('updateYieldRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update yield record.') };
  }
}

export async function reviewYieldRecord(
  id: string,
  _actor: YieldActor,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminYieldRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeYieldRecord(result.data), error: null };
  } catch (e) {
    console.error('reviewYieldRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveYieldRecord(
  id: string,
  _actor: YieldActor,
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
      'approveAdminYieldRecord',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeYieldRecord(result.data), error: null };
  } catch (e) {
    console.error('approveYieldRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve yield record.') };
  }
}

export async function softDeleteYieldRecord(
  id: string,
  _actor: YieldActor,
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
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminYieldRecord');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    console.error('softDeleteYieldRecord failed', e);
    return { error: cfErrorMessage(e, 'Failed to soft-delete yield record.') };
  }
}

export async function bulkCreateYieldRecords(
  rows: YieldMonitoringFormData[],
  _actor: YieldActor,
  changeReason = 'Bulk yield entry',
  qaOverride = false,
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { created: 0, errors: ['Change reason (min 5 characters) is required.'] };
    }
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminYieldRecords',
    );
    const result = await fn({ rows, changeReason, qaOverride, esignConfirmed: qaOverride });
    return result.data;
  } catch (e) {
    console.error('bulkCreateYieldRecords failed', e);
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function fetchYieldAuditTrail(recordId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('documentId', '==', recordId), limit(50)));
    if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const snap2 = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('recordId', '==', recordId), limit(50)));
    return snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function logYieldExport(actor: YieldActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminYieldExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logYieldExport CF failed (non-blocking)', e);
  }
}

export function yieldStageTrendData(records: YieldMonitoringRecord[], stage: string) {
  return records
    .filter((r) => r.yieldStage === stage)
    .sort((a, b) => (a.manufacturingDate || a.createdAt).localeCompare(b.manufacturingDate || b.createdAt))
    .map((r) => ({
      label: r.batchNumber,
      yield: r.yieldPercentage,
      target: r.targetYield,
      lower: r.lowerLimit,
      upper: r.upperLimit,
    }));
}

export function stageDefaults(stage: string) {
  return defaultLimitsForStage(stage);
}

export const YIELD_STAGE_OPTIONS = YIELD_STAGES;
