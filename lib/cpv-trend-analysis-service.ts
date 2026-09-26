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
import { fetchRawMaterialRecords } from '@/lib/cpv-raw-material-monitoring-service';
import { fetchPackingMaterialRecords } from '@/lib/cpv-packing-material-monitoring-service';
import { fetchUtilityRecords } from '@/lib/cpv-utility-monitoring-service';
import { fetchEnvironmentalRecords } from '@/lib/cpv-environmental-monitoring-service';
import { fetchHoldTimeRecords } from '@/lib/cpv-hold-time-monitoring-service';
import {
  TREND_ANALYSIS_COLLECTION,
  TREND_ANALYSIS_LEGACY,
  buildTrendId,
  calculateTrendAnalysis,
  dataSourceForParameterType,
  trendTypeForDataSource,
  parameterTypeForDataSource,
  type TrendAnalysisFormData,
  type TrendAnalysisRecord,
  type TrendCalculationResult,
  type TrendSourcePoint,
} from '@/lib/cpv-trend-records';
import { polishRecommendationText } from '@/lib/ai/client';

export interface TrendAnalysisActor {
  id: string;
  name: string;
  role?: string;
}

function cfErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    const msg = (e as { message: string }).message;
    if (msg.includes('FirebaseError:') || msg.includes('functions/')) {
      const cleaned = msg.replace(/^FirebaseError:\s*/i, '').replace(/^functions\/[\w-]+:\s*/i, '');
      return cleaned || fallback;
    }
    return msg || fallback;
  }
  return fallback;
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normalizeRecord(raw: Record<string, unknown>): TrendAnalysisRecord {
  const productCode = str(raw.productCode || raw.product_code);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  const workflowStatuses = ['Draft', 'Generated', 'Under Review', 'Approved', 'Rejected', 'Archived'];
  const rawStatus = str(raw.status);
  const chartData = Array.isArray(raw.chartData) ? raw.chartData as TrendAnalysisRecord['chartData'] : [];
  const sourcePreview = Array.isArray(raw.sourcePreview) ? raw.sourcePreview as TrendSourcePoint[] : [];
  const forecastSeries = Array.isArray(raw.forecastSeries)
    ? (raw.forecastSeries as unknown[]).map(Number).filter(Number.isFinite)
    : [];

  return {
    id: str(raw.id),
    trendId: str(raw.trendId || raw.trend_id, buildTrendId(productCode, parameterCode)),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode,
    trendType: (str(raw.trendType || raw.trend_type, 'CPP Trend') as TrendAnalysisRecord['trendType']),
    dataSource: (str(raw.dataSource || raw.data_source, 'CPP Results') as TrendAnalysisRecord['dataSource']),
    parameterType: (str(raw.parameterType || raw.parameter_type, 'CPP') as TrendAnalysisRecord['parameterType']),
    parameterCode,
    parameterName: str(raw.parameterName || raw.parameter_name || raw.parameter),
    reviewPeriodFrom: str(raw.reviewPeriodFrom || raw.review_period_from),
    reviewPeriodTo: str(raw.reviewPeriodTo || raw.review_period_to),
    batchCount: num(raw.batchCount ?? raw.batch_count),
    dataPointsCount: num(raw.dataPointsCount ?? raw.data_points_count ?? raw.count),
    mean: num(raw.mean),
    median: num(raw.median),
    mode: raw.mode == null || raw.mode === '' ? null : num(raw.mode),
    minimumValue: num(raw.minimumValue ?? raw.minimum_value ?? raw.min),
    maximumValue: num(raw.maximumValue ?? raw.maximum_value ?? raw.max),
    range: num(raw.range),
    variance: num(raw.variance),
    standardDeviation: num(raw.standardDeviation ?? raw.standard_deviation ?? raw.stdDev),
    movingAverage: num(raw.movingAverage),
    weightedAverage: num(raw.weightedAverage),
    rollingAverage: num(raw.rollingAverage),
    regressionSlope: num(raw.regressionSlope),
    regressionIntercept: num(raw.regressionIntercept),
    regressionR2: num(raw.regressionR2),
    correlation: num(raw.correlation),
    covariance: num(raw.covariance),
    zScoreMean: num(raw.zScoreMean),
    sigmaLevel: num(raw.sigmaLevel),
    cp: num(raw.cp),
    cpk: num(raw.cpk),
    pp: num(raw.pp),
    ppk: num(raw.ppk),
    ucl: num(raw.ucl),
    lcl: num(raw.lcl),
    ewmaLast: num(raw.ewmaLast),
    cusumHighLast: num(raw.cusumHighLast),
    cusumLowLast: num(raw.cusumLowLast),
    outlierCount: num(raw.outlierCount),
    forecastNext: num(raw.forecastNext),
    forecastSeries,
    processDriftDetected: Boolean(raw.processDriftDetected),
    qualityDegradation: Boolean(raw.qualityDegradation),
    healthScore: num(raw.healthScore),
    confidenceScore: num(raw.confidenceScore),
    aiRecommendation: str(raw.aiRecommendation),
    goldenBatchNumber: str(raw.goldenBatchNumber),
    goldenBatchDelta: num(raw.goldenBatchDelta),
    trendDirection: (str(raw.trendDirection || raw.trend_direction, 'No Data') as TrendAnalysisRecord['trendDirection']),
    trendStatus: (str(raw.trendStatus || raw.trend_status, 'Insufficient Data') as TrendAnalysisRecord['trendStatus']),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low') as TrendAnalysisRecord['riskLevel'],
    ootCount: num(raw.ootCount ?? raw.oot_count),
    oosCount: num(raw.oosCount ?? raw.oos_count),
    alertCount: num(raw.alertCount ?? raw.alert_count),
    actionCount: num(raw.actionCount ?? raw.action_count),
    capaSuggested: Boolean(raw.capaSuggested || raw.capa_suggested),
    deviationRequired: Boolean(raw.deviationRequired),
    conclusion: str(raw.conclusion),
    recommendation: str(raw.recommendation),
    changeReason: str(raw.changeReason),
    generatedBy: str(raw.generatedBy || raw.generated_by),
    generatedDate: str(raw.generatedDate || raw.generated_date || raw.createdAt),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    approvedBy: str(raw.approvedBy),
    approvalDate: str(raw.approvalDate),
    status: (workflowStatuses.includes(rawStatus)
      ? rawStatus
      : str(raw.workflowStatus || raw.workflow_status, 'Generated')) as TrendAnalysisRecord['status'],
    remarks: str(raw.remarks),
    linkedRiskId: str(raw.linkedRiskId || raw.linked_risk_id),
    linkedDeviationNumber: str(raw.linkedDeviationNumber),
    linkedCapaNumber: str(raw.linkedCapaNumber),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    chartData,
    sourcePreview,
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export async function fetchTrendAnalysisRecords(max = 500): Promise<TrendAnalysisRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: TrendAnalysisRecord[] = [];
    try {
      primary = await getRecords<TrendAnalysisRecord>(
        TREND_ANALYSIS_COLLECTION,
        [orderBy('generatedDate', 'desc'), limit(max)],
      );
    } catch {
      try {
        primary = await getRecords<TrendAnalysisRecord>(
          TREND_ANALYSIS_COLLECTION,
          [orderBy('createdAt', 'desc'), limit(max)],
        );
      } catch {
        primary = await getRecords<TrendAnalysisRecord>(TREND_ANALYSIS_COLLECTION, [limit(max)]);
      }
    }
    const normalized = primary.map((r) => normalizeRecord(r as unknown as Record<string, unknown>));
    if (normalized.length) return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const legacy of TREND_ANALYSIS_LEGACY) {
      const rows = await listCpvRecords<Record<string, unknown>>(legacy, max);
      if (rows.length) return rows.map((r) => normalizeRecord(r));
    }
    const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.trends, max);
    return cpvLegacy.map((r) => normalizeRecord(r));
  } catch (e) {
    console.error('fetchTrendAnalysisRecords failed', e);
    return [];
  }
}

export async function fetchTrendAnalysisById(id: string): Promise<TrendAnalysisRecord | null> {
  const record = await getRecord<TrendAnalysisRecord>(TREND_ANALYSIS_COLLECTION, id);
  if (record) return normalizeRecord(record as unknown as Record<string, unknown>);
  const all = await fetchTrendAnalysisRecords();
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

export async function fetchTrendSourceData(
  dataSource: string,
  productName: string,
  parameterName: string,
  from: string,
  to: string,
): Promise<TrendSourcePoint[]> {
  const points: TrendSourcePoint[] = [];
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
            lsl: r.lowerLimit,
            usl: r.upperLimit,
            target: r.targetValue,
            alertLow: r.alertLimitLow,
            alertHigh: r.alertLimitHigh,
            actionLow: r.actionLimitLow,
            actionHigh: r.actionLimitHigh,
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
            batchNumber: r.batchNumber,
            value: v,
            date: asDateString(r.testDate, r.createdAt),
            lsl: r.lowerLimit,
            usl: r.upperLimit,
            target: r.targetValue,
            alertLow: r.alertLimitLow,
            alertHigh: r.alertLimitHigh,
            actionLow: r.actionLimitLow,
            actionHigh: r.actionLimitHigh,
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
          batchNumber: r.batchNumber,
          value: r.yieldPercentage,
          date: asDateString(r.manufacturingDate, r.createdAt),
          lsl: r.lowerLimit,
          usl: r.upperLimit,
          target: r.targetYield,
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
            batchNumber: r.batchNumber,
            value: v,
            date: asDateString(r.testDate, r.createdAt),
            lsl: r.lowerLimit,
            usl: r.upperLimit,
            target: r.targetValue,
          });
        }
      });
    } else if (dataSource === 'Raw Material Monitoring') {
      const rows = await fetchRawMaterialRecords(1000);
      rows.filter((r) => {
        const date = asDateString(r.mfgDate, r.createdAt);
        return r.productName === productName
          && (r.testParameter === parameterName || r.materialName === parameterName)
          && inPeriod(date, from, to);
      }).forEach((r) => {
        const v = Number(r.observedResult);
        if (Number.isFinite(v)) {
          points.push({
            batchNumber: r.batchNumber,
            value: v,
            date: asDateString(r.mfgDate, r.createdAt),
            lsl: r.lowerLimit,
            usl: r.upperLimit,
          });
        }
      });
    } else if (dataSource === 'Packing Material Monitoring') {
      const rows = await fetchPackingMaterialRecords(1000);
      rows.filter((r) => {
        const date = asDateString(r.mfgDate, r.createdAt);
        return r.productName === productName && r.materialName === parameterName && inPeriod(date, from, to);
      }).forEach((r) => {
        points.push({
          batchNumber: r.batchNumber,
          value: r.usedQuantity,
          date: asDateString(r.mfgDate, r.createdAt),
        });
      });
    } else if (dataSource === 'Utility Monitoring') {
      const rows = await fetchUtilityRecords(1000);
      rows.filter((r) => {
        const date = asDateString(r.monitoringDate, r.createdAt);
        return r.productName === productName && r.parameterName === parameterName && inPeriod(date, from, to);
      }).forEach((r) => {
        const v = Number(r.observedValue);
        if (Number.isFinite(v)) {
          points.push({
            batchNumber: r.batchNumber,
            value: v,
            date: asDateString(r.monitoringDate, r.createdAt),
            lsl: r.lowerLimit,
            usl: r.upperLimit,
            target: r.targetValue,
            alertLow: r.alertLimitLow,
            alertHigh: r.alertLimitHigh,
            actionLow: r.actionLimitLow,
            actionHigh: r.actionLimitHigh,
          });
        }
      });
    } else if (dataSource === 'Environmental Monitoring') {
      const rows = await fetchEnvironmentalRecords(1000);
      rows.filter((r) => {
        const date = asDateString(r.monitoringDate, r.createdAt);
        return r.productName === productName && r.parameterName === parameterName && inPeriod(date, from, to);
      }).forEach((r) => {
        const v = Number(r.observedValue);
        if (Number.isFinite(v)) {
          points.push({
            batchNumber: r.batchNumber,
            value: v,
            date: asDateString(r.monitoringDate, r.createdAt),
            lsl: r.lowerLimit,
            usl: r.upperLimit,
            target: r.targetValue,
            alertLow: r.alertLimitLow,
            alertHigh: r.alertLimitHigh,
            actionLow: r.actionLimitLow,
            actionHigh: r.actionLimitHigh,
          });
        }
      });
    } else if (dataSource === 'Hold Time Monitoring') {
      const rows = await fetchHoldTimeRecords(1000);
      rows.filter((r) => {
        const date = asDateString(r.manufacturingDate, r.createdAt);
        return r.productName === productName
          && (r.holdStage === parameterName || parameterName.includes('Hold'))
          && inPeriod(date, from, to);
      }).forEach((r) => {
        points.push({
          batchNumber: r.batchNumber,
          value: r.actualHoldTime,
          date: asDateString(r.manufacturingDate, r.createdAt),
          lsl: 0,
          usl: r.allowedHoldTime,
        });
      });
    }
  } catch (e) {
    console.error('fetchTrendSourceData failed', e);
  }
  return points;
}

export function previewTrendCalculation(
  form: TrendAnalysisFormData,
  sourceData: TrendSourcePoint[],
): TrendCalculationResult {
  return calculateTrendAnalysis(sourceData, form.parameterName);
}

export async function createTrendAnalysis(
  form: TrendAnalysisFormData,
  sourceData: TrendSourcePoint[],
  _actor: TrendAnalysisActor,
): Promise<{ result: TrendAnalysisRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!form.changeReason || form.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(form.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational.' };
    }
    if (sourceData.length < 3) {
      return { result: null, error: 'At least 3 numeric data points required for trend analysis.' };
    }
    const preview = previewTrendCalculation(form, sourceData);
    const aiRecommendation = await polishRecommendationText(preview.aiRecommendation, {
      module: 'Trend Analysis',
      parameterName: form.parameterName,
      trendStatus: preview.trendStatus,
      trendDirection: preview.trendDirection,
    });
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminTrendAnalysis',
    );
    const result = await fn({
      ...form,
      points: sourceData,
      changeReason: form.changeReason,
      aiRecommendation,
    });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    console.error('createTrendAnalysis failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to save trend analysis.') };
  }
}

export async function regenerateTrendAnalysis(
  id: string,
  _actor: TrendAnalysisActor,
  existing: TrendAnalysisRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean; changeReason?: string; sourceData?: TrendSourcePoint[] },
): Promise<{ result: TrendAnalysisRecord | null; error: string | null }> {
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
      sourceData = await fetchTrendSourceData(
        existing.dataSource,
        existing.productName,
        existing.parameterName,
        existing.reviewPeriodFrom,
        existing.reviewPeriodTo,
      );
    }
    if ((sourceData?.length || 0) < 3 && existing.sourcePreview.length < 3) {
      return { result: null, error: 'Insufficient source data to regenerate.' };
    }
    const points = sourceData && sourceData.length >= 3 ? sourceData : existing.sourcePreview;
    const preview = previewTrendCalculation(
      { ...existing, changeReason } as TrendAnalysisFormData,
      points,
    );
    const aiRecommendation = await polishRecommendationText(preview.aiRecommendation, {
      module: 'Trend Analysis',
      parameterName: existing.parameterName,
      trendStatus: preview.trendStatus,
      trendDirection: preview.trendDirection,
    });
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'regenerateAdminTrendAnalysis',
    );
    const result = await fn({
      ...existing,
      id,
      points,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      aiRecommendation,
    });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    console.error('regenerateTrendAnalysis failed', e);
    return { result: null, error: cfErrorMessage(e, 'Regeneration failed.') };
  }
}

export async function reviewTrendAnalysis(
  id: string,
  _actor: TrendAnalysisActor,
  _existing: TrendAnalysisRecord,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminTrendAnalysis',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveTrendAnalysis(
  id: string,
  _actor: TrendAnalysisActor,
  _existing: TrendAnalysisRecord,
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
      'approveAdminTrendAnalysis',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to approve.') };
  }
}

export async function rejectTrendAnalysis(
  id: string,
  _actor: TrendAnalysisActor,
  _existing: TrendAnalysisRecord,
  changeReason = 'Rejected by QA',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'rejectAdminTrendAnalysis',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to reject.') };
  }
}

export async function softDeleteTrendAnalysis(
  id: string,
  _actor: TrendAnalysisActor,
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
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminTrendAnalysis');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    return { error: cfErrorMessage(e, 'Failed to archive.') };
  }
}

export async function fetchTrendAnalysisAuditTrail(recordId: string) {
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

export async function logTrendExport(actor: TrendAnalysisActor, type: string, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminTrendAnalysisExport');
    await fn({ count, format: type || 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logTrendExport CF failed (non-blocking)', e);
  }
}

export async function fetchParametersForTrend(
  dataSource: string,
  productName: string,
): Promise<string[]> {
  const names = new Set<string>();
  try {
    if (dataSource === 'CPP Results') {
      const rows = await fetchCppResults(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (dataSource === 'CQA Results') {
      const rows = await fetchCqaResults(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (dataSource === 'Yield Monitoring') {
      const rows = await fetchYieldRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.yieldStage));
    } else if (dataSource === 'Stability Monitoring') {
      const rows = await fetchStabilityResults(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (dataSource === 'Raw Material Monitoring') {
      const rows = await fetchRawMaterialRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => {
        if (r.testParameter) names.add(r.testParameter);
        names.add(r.materialName);
      });
    } else if (dataSource === 'Packing Material Monitoring') {
      const rows = await fetchPackingMaterialRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.materialName));
    } else if (dataSource === 'Utility Monitoring') {
      const rows = await fetchUtilityRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (dataSource === 'Environmental Monitoring') {
      const rows = await fetchEnvironmentalRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.parameterName));
    } else if (dataSource === 'Hold Time Monitoring') {
      const rows = await fetchHoldTimeRecords(500);
      rows.filter((r) => r.productName === productName).forEach((r) => names.add(r.holdStage));
    }
  } catch { /* optional */ }
  return Array.from(names).filter(Boolean).sort();
}

export async function previewTrendSourceData(
  form: TrendAnalysisFormData,
  _actor: TrendAnalysisActor,
): Promise<TrendSourcePoint[]> {
  return fetchTrendSourceData(
    form.dataSource,
    form.productName,
    form.parameterName,
    form.reviewPeriodFrom,
    form.reviewPeriodTo,
  );
}

export {
  dataSourceForParameterType,
  trendTypeForDataSource,
  parameterTypeForDataSource,
};
