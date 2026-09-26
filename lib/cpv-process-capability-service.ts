import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import { fetchCppResults } from '@/lib/cpv-cpp-monitoring-service';
import { fetchCqaResults } from '@/lib/cpv-cqa-monitoring-service';
import { fetchYieldRecords } from '@/lib/cpv-yield-monitoring-service';
import { fetchStabilityResults } from '@/lib/cpv-stability-monitoring-service';
import { fetchHoldTimeRecords } from '@/lib/cpv-hold-time-monitoring-service';
import {
  PROCESS_CAPABILITY_COLLECTION,
  PROCESS_CAPABILITY_LEGACY,
  buildCapabilityId,
  buildCapabilityCode,
  calculateProcessCapability,
  evaluateCapabilityRisk,
  dataSourceForType,
  type ProcessCapabilityFormData,
  type ProcessCapabilityRecord,
  type CapabilityCalculationResult,
} from '@/lib/cpv-process-capability';
import { polishRecommendationText } from '@/lib/ai/client';

export interface ProcessCapabilityActor {
  id: string;
  name: string;
  role?: string;
}

export interface SourceDataPoint {
  batchNumber: string;
  value: number;
  date: string;
  lsl?: number;
  usl?: number;
  target?: number;
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

function normalizeRecord(raw: Record<string, unknown>): ProcessCapabilityRecord {
  const productCode = str(raw.productCode || raw.product_code);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  const rawStatus = str(raw.status);
  const workflowStatuses = ['Draft', 'Calculated', 'Under Review', 'Approved', 'Rejected', 'Archived'];
  const capabilityStatus = str(raw.capabilityStatus || raw.capability_status)
    || (workflowStatuses.includes(rawStatus) ? 'Insufficient Data' : rawStatus || 'Insufficient Data');
  return {
    id: str(raw.id),
    capabilityId: str(raw.capabilityId || raw.capability_id, buildCapabilityId(productCode, parameterCode)),
    capabilityCode: str(raw.capabilityCode, buildCapabilityCode(productCode, parameterCode)),
    studyNumber: str(raw.studyNumber),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode,
    productVersion: str(raw.productVersion),
    batchNumber: str(raw.batchNumber),
    manufacturingOrder: str(raw.manufacturingOrder),
    process: str(raw.process),
    processStep: str(raw.processStep),
    equipmentId: str(raw.equipmentId),
    equipmentName: str(raw.equipmentName),
    machine: str(raw.machine),
    department: str(raw.department, 'Quality Control'),
    productionLine: str(raw.productionLine),
    site: str(raw.site),
    parameterType: (str(raw.parameterType || raw.parameter_type, 'CPP') as ProcessCapabilityRecord['parameterType']),
    parameterCode,
    parameterName: str(raw.parameterName || raw.parameter_name || raw.parameter),
    dataSource: (str(raw.dataSource || raw.data_source, 'CPP Results') as ProcessCapabilityRecord['dataSource']),
    reviewPeriodFrom: str(raw.reviewPeriodFrom || raw.review_period_from),
    reviewPeriodTo: str(raw.reviewPeriodTo || raw.review_period_to),
    batchCount: num(raw.batchCount ?? raw.batch_count),
    sampleCount: num(raw.sampleCount ?? raw.sample_count ?? raw.count),
    lowerSpecificationLimit: num(raw.lowerSpecificationLimit ?? raw.lower_specification_limit ?? raw.lsl),
    upperSpecificationLimit: num(raw.upperSpecificationLimit ?? raw.upper_specification_limit ?? raw.usl),
    targetValue: optionalNum(raw.targetValue ?? raw.target_value ?? raw.target),
    ucl: optionalNum(raw.ucl),
    lcl: optionalNum(raw.lcl),
    effectiveDate: str(raw.effectiveDate),
    description: str(raw.description),
    mean: num(raw.mean),
    median: num(raw.median),
    mode: raw.mode == null ? null : num(raw.mode),
    minimumValue: num(raw.minimumValue ?? raw.minimum_value ?? raw.min),
    maximumValue: num(raw.maximumValue ?? raw.maximum_value ?? raw.max),
    range: num(raw.range),
    variance: num(raw.variance),
    standardDeviation: num(raw.standardDeviation ?? raw.standard_deviation ?? raw.stdDev),
    movingRangeBar: num(raw.movingRangeBar),
    withinStandardDeviation: num(raw.withinStandardDeviation),
    cp: num(raw.cp),
    cpk: num(raw.cpk ?? raw.Cpk),
    cpu: num(raw.cpu),
    cpl: num(raw.cpl),
    pp: num(raw.pp),
    ppk: num(raw.ppk ?? raw.Ppk),
    ppu: num(raw.ppu),
    ppl: num(raw.ppl),
    sigmaLevel: num(raw.sigmaLevel ?? raw.sigma_level),
    zScoreLsl: num(raw.zScoreLsl),
    zScoreUsl: num(raw.zScoreUsl),
    confidenceIntervalLow: num(raw.confidenceIntervalLow),
    confidenceIntervalHigh: num(raw.confidenceIntervalHigh),
    skewness: num(raw.skewness),
    kurtosis: num(raw.kurtosis),
    normalityPValue: raw.normalityPValue == null ? null : num(raw.normalityPValue),
    outlierCount: num(raw.outlierCount),
    processPerformanceIndex: num(raw.processPerformanceIndex),
    capabilityStatus,
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    healthScore: num(raw.healthScore),
    aiRecommendation: str(raw.aiRecommendation),
    conclusion: str(raw.conclusion),
    recommendation: str(raw.recommendation),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    approvedBy: str(raw.approvedBy || raw.approved_by),
    approvalDate: str(raw.approvalDate || raw.approval_date),
    status: (workflowStatuses.includes(rawStatus)
      ? rawStatus
      : str(raw.workflowStatus || raw.workflow_status || raw.recordStatus, 'Calculated')) as ProcessCapabilityRecord['status'],
    remarks: str(raw.remarks),
    changeReason: str(raw.changeReason || raw.change_reason),
    capaRecommended: Boolean(raw.capaRecommended || raw.capa_recommended),
    deviationRequired: Boolean(raw.deviationRequired),
    linkedRiskId: str(raw.linkedRiskId || raw.linked_risk_id),
    linkedDeviationNumber: str(raw.linkedDeviationNumber),
    linkedCapaNumber: str(raw.linkedCapaNumber),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    sourcePreview: Array.isArray(raw.sourcePreview) ? raw.sourcePreview as number[] : [],
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export async function fetchProcessCapabilityRecords(max = 500): Promise<ProcessCapabilityRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: ProcessCapabilityRecord[] = [];
    try {
      primary = await getRecords<ProcessCapabilityRecord>(
        PROCESS_CAPABILITY_COLLECTION,
        [orderBy('createdAt', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<ProcessCapabilityRecord>(PROCESS_CAPABILITY_COLLECTION, [limit(max)]);
    }
    const normalized = primary
      .map((r) => normalizeRecord(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) {
      return normalized.sort((a, b) =>
        (b.reviewDate || b.reviewPeriodTo || b.createdAt).localeCompare(
          a.reviewDate || a.reviewPeriodTo || a.createdAt,
        ),
      );
    }
    for (const legacy of PROCESS_CAPABILITY_LEGACY) {
      const rows = await listCpvRecords<Record<string, unknown>>(legacy, max);
      if (rows.length) return rows.map((r) => normalizeRecord(r)).filter((r) => !r.isDeleted);
    }
    const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.capability, max);
    return cpvLegacy.map((r) => normalizeRecord(r)).filter((r) => !r.isDeleted);
  } catch (e) {
    console.error('fetchProcessCapabilityRecords failed', e);
    return [];
  }
}

export async function fetchProcessCapabilityById(id: string): Promise<ProcessCapabilityRecord | null> {
  const record = await getRecord<ProcessCapabilityRecord>(PROCESS_CAPABILITY_COLLECTION, id);
  if (record && !(record as ProcessCapabilityRecord).isDeleted) {
    return normalizeRecord(record as unknown as Record<string, unknown>);
  }
  const all = await fetchProcessCapabilityRecords();
  return all.find((r) => r.id === id) ?? null;
}

function inPeriod(dateStr: string, from: string, to: string): boolean {
  const d = new Date(dateStr);
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(d.getTime())) return false;
  return d >= f && d <= t;
}

function asDateString(value: unknown, fallback = ''): string {
  if (typeof value === 'string' && value.trim()) return value;
  return fallback;
}

export async function fetchCapabilitySourceData(
  dataSource: string,
  productName: string,
  parameterName: string,
  from: string,
  to: string,
): Promise<SourceDataPoint[]> {
  const points: SourceDataPoint[] = [];
  try {
    if (dataSource === 'CPP Results') {
      const rows = await fetchCppResults(1000);
      rows.filter((r) => {
        const date = asDateString(r.observationDateTime, asDateString(r.manufacturingDate, r.createdAt));
        return r.productName === productName && r.parameterName === parameterName && inPeriod(date, from, to);
      }).forEach((r) => {
        const v = Number(r.observedValue);
        if (Number.isFinite(v)) {
          points.push({
            batchNumber: r.batchNumber,
            value: v,
            date: asDateString(r.observationDateTime, asDateString(r.manufacturingDate, r.createdAt)),
            lsl: r.lowerLimit, usl: r.upperLimit, target: r.targetValue,
          });
        }
      });
    } else if (dataSource === 'CQA Results') {
      const rows = await fetchCqaResults(1000);
      rows.filter((r) => {
        const date = asDateString(r.testDate, r.createdAt);
        return r.productName === productName && r.parameterName === parameterName && inPeriod(date, from, to);
      }).forEach((r) => {
        const v = Number(r.observedResult);
        if (Number.isFinite(v)) {
          points.push({
            batchNumber: r.batchNumber, value: v, date: asDateString(r.testDate, r.createdAt),
            lsl: r.lowerLimit, usl: r.upperLimit, target: r.targetValue,
          });
        }
      });
    } else if (dataSource === 'Yield Monitoring') {
      const rows = await fetchYieldRecords(1000);
      rows.filter((r) => {
        const date = asDateString(r.manufacturingDate, r.createdAt);
        return r.productName === productName
          && (r.yieldStage === parameterName || parameterName.includes('Yield'))
          && inPeriod(date, from, to);
      }).forEach((r) => {
        points.push({
          batchNumber: r.batchNumber, value: r.yieldPercentage,
          date: asDateString(r.manufacturingDate, r.createdAt),
          lsl: r.lowerLimit, usl: r.upperLimit, target: r.targetYield,
        });
      });
    } else if (dataSource === 'Stability Monitoring') {
      const rows = await fetchStabilityResults(1000);
      rows.filter((r) => {
        const date = asDateString(r.testDate, r.createdAt);
        return r.productName === productName && r.parameterName === parameterName && inPeriod(date, from, to);
      }).forEach((r) => {
        const v = Number(r.observedResult);
        if (Number.isFinite(v)) {
          points.push({
            batchNumber: r.batchNumber, value: v, date: asDateString(r.testDate, r.createdAt),
            lsl: r.lowerLimit, usl: r.upperLimit, target: r.targetValue,
          });
        }
      });
    } else if (dataSource === 'Hold Time Monitoring') {
      const rows = await fetchHoldTimeRecords(1000);
      rows.filter((r) => {
        const date = asDateString(r.startDateTime, r.createdAt);
        return r.productName === productName
          && (r.holdStage === parameterName || r.processStage === parameterName)
          && inPeriod(date, from, to);
      }).forEach((r) => {
        points.push({
          batchNumber: r.batchNumber, value: r.actualHoldTime,
          date: asDateString(r.startDateTime, r.createdAt),
          lsl: 0, usl: r.allowedHoldTime, target: r.allowedHoldTime * 0.8,
        });
      });
    }
  } catch (e) {
    console.error('fetchCapabilitySourceData failed', e);
  }
  return points;
}

export function previewCapabilityCalculation(
  form: ProcessCapabilityFormData,
  sourceData: SourceDataPoint[],
): CapabilityCalculationResult & { lsl: number; usl: number } {
  const lsl = form.lowerSpecificationLimit;
  const usl = form.upperSpecificationLimit;
  const batches = sourceData.map((p) => p.batchNumber);
  const values = sourceData.map((p) => p.value);
  const calc = calculateProcessCapability(
    values, lsl, usl, batches, form.parameterType, form.parameterName, form.targetValue,
  );
  const riskLevel = evaluateCapabilityRisk(calc.capabilityStatus, form.parameterType, form.parameterName, calc.cpk);
  return { ...calc, riskLevel, lsl, usl };
}

export async function createProcessCapability(
  form: ProcessCapabilityFormData,
  sourceData: SourceDataPoint[],
  _actor: ProcessCapabilityActor,
): Promise<{ result: ProcessCapabilityRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!form.changeReason || form.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(form.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational.' };
    }
    if (sourceData.length < 5) {
      return { result: null, error: 'At least 5 numeric values required for calculation.' };
    }
    const preview = previewCapabilityCalculation(form, sourceData);
    const aiRecommendation = await polishRecommendationText(preview.aiRecommendation, {
      module: 'Process Capability',
      parameterName: form.parameterName,
      parameterType: form.parameterType,
      cpk: preview.cpk,
      ppk: preview.ppk,
      status: preview.capabilityStatus,
    });
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminProcessCapability',
    );
    const result = await fn({
      ...form,
      values: sourceData.map((p) => p.value),
      batchNumbers: sourceData.map((p) => p.batchNumber),
      changeReason: form.changeReason,
      aiRecommendation,
    });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    console.error('createProcessCapability failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to save capability calculation.') };
  }
}

export async function recalculateProcessCapability(
  id: string,
  _actor: ProcessCapabilityActor,
  existing: ProcessCapabilityRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean; changeReason?: string; sourceData?: SourceDataPoint[] },
): Promise<{ result: ProcessCapabilityRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = options?.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.status === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved record is locked. QA override required.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    let sourceData = options?.sourceData;
    if (!sourceData?.length) {
      sourceData = await fetchCapabilitySourceData(
        existing.dataSource, existing.productName, existing.parameterName,
        existing.reviewPeriodFrom, existing.reviewPeriodTo,
      );
    }
    if ((sourceData?.length || 0) < 5 && existing.sourcePreview.length < 5) {
      return { result: null, error: 'Insufficient source data to recalculate.' };
    }
    const values = sourceData && sourceData.length >= 5
      ? sourceData.map((p) => p.value)
      : existing.sourcePreview;
    const batches = sourceData && sourceData.length >= 5
      ? sourceData.map((p) => p.batchNumber)
      : values.map(() => existing.batchNumber || '');
    const preview = previewCapabilityCalculation(
      {
        ...existing,
        lowerSpecificationLimit: existing.lowerSpecificationLimit,
        upperSpecificationLimit: existing.upperSpecificationLimit,
        parameterType: existing.parameterType,
        parameterName: existing.parameterName,
        targetValue: existing.targetValue,
        changeReason,
      } as ProcessCapabilityFormData,
      (sourceData && sourceData.length >= 5
        ? sourceData
        : values.map((value, i) => ({ batchNumber: batches[i] || '', value, date: '' }))),
    );
    const aiRecommendation = await polishRecommendationText(preview.aiRecommendation, {
      module: 'Process Capability',
      parameterName: existing.parameterName,
      cpk: preview.cpk,
      ppk: preview.ppk,
      status: preview.capabilityStatus,
    });
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'recalculateAdminProcessCapability',
    );
    const result = await fn({
      ...existing,
      id,
      values,
      batchNumbers: batches,
      changeReason,
      aiRecommendation,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    console.error('recalculateProcessCapability failed', e);
    return { result: null, error: cfErrorMessage(e, 'Recalculation failed.') };
  }
}

export async function reviewProcessCapability(
  id: string,
  _actor: ProcessCapabilityActor,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminProcessCapability',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveProcessCapability(
  id: string,
  _actor: ProcessCapabilityActor,
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
      'approveAdminProcessCapability',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to approve.') };
  }
}

export async function rejectProcessCapability(
  id: string,
  _actor: ProcessCapabilityActor,
  changeReason = 'Rejected by QA',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'rejectAdminProcessCapability',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to reject.') };
  }
}

export async function softDeleteProcessCapability(
  id: string,
  _actor: ProcessCapabilityActor,
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
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminProcessCapability');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    return { error: cfErrorMessage(e, 'Failed to archive.') };
  }
}

export async function fetchProcessCapabilityAuditTrail(recordId: string) {
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

export async function logProcessCapabilityExport(actor: ProcessCapabilityActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminProcessCapabilityExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logProcessCapabilityExport CF failed (non-blocking)', e);
  }
}

export async function fetchParametersForProduct(
  parameterType: string,
  productName: string,
): Promise<string[]> {
  const names = new Set<string>();
  try {
    if (parameterType === 'CPP') {
      const rows = await fetchCppResults(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (parameterType === 'CQA') {
      const rows = await fetchCqaResults(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (parameterType === 'Yield') {
      const rows = await fetchYieldRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.yieldStage));
    } else if (parameterType === 'Stability') {
      const rows = await fetchStabilityResults(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (parameterType === 'Hold Time') {
      const rows = await fetchHoldTimeRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.holdStage));
    }
  } catch { /* optional */ }
  return Array.from(names).sort();
}

void dataSourceForType;
