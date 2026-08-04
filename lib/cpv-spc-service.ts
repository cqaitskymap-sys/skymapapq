import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
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
import { fetchUtilityRecords } from '@/lib/cpv-utility-monitoring-service';
import { fetchEnvironmentalRecords } from '@/lib/cpv-environmental-monitoring-service';
import { fetchHoldTimeRecords } from '@/lib/cpv-hold-time-monitoring-service';
import {
  CONTROL_CHARTS_COLLECTION,
  CONTROL_CHARTS_LEGACY,
  buildSpcRecordId,
  calculateSpcAnalysis,
  dataSourceForParameterType,
  parameterTypeForDataSource,
  type SpcFormData,
  type SpcRecord,
  type SpcCalculationResult,
  type SpcSourcePoint,
  type SpcRuleViolationRecord,
  type SpcChartPoint,
} from '@/lib/cpv-spc-records';
import { polishRecommendationText } from '@/lib/ai/client';

export interface SpcActor {
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

function chartPoints(v: unknown): SpcChartPoint[] {
  return Array.isArray(v) ? v as SpcChartPoint[] : [];
}

function normalizeRecord(raw: Record<string, unknown>): SpcRecord {
  const productCode = str(raw.productCode || raw.product_code);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  const workflowStatuses = ['Draft', 'Generated', 'Under Review', 'Approved', 'Rejected', 'Archived'];
  const rawStatus = str(raw.status);

  return {
    id: str(raw.id),
    spcRecordId: str(raw.spcRecordId || raw.spc_record_id, buildSpcRecordId(productCode, parameterCode)),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode,
    spcCode: str(raw.spcCode || raw.spc_code),
    studyNumber: str(raw.studyNumber || raw.study_number),
    productVersion: str(raw.productVersion || raw.product_version),
    batchNumber: str(raw.batchNumber || raw.batch_number),
    manufacturingOrder: str(raw.manufacturingOrder || raw.manufacturing_order),
    process: str(raw.process),
    processStep: str(raw.processStep || raw.process_step),
    equipmentId: str(raw.equipmentId || raw.equipment_id),
    equipmentName: str(raw.equipmentName || raw.equipment_name),
    machine: str(raw.machine),
    department: str(raw.department),
    productionLine: str(raw.productionLine || raw.production_line),
    operator: str(raw.operator),
    shift: str(raw.shift),
    site: str(raw.site),
    chartType: (str(raw.chartType || raw.chart_type, 'Individuals Chart') as SpcRecord['chartType']),
    dataSource: (str(raw.dataSource || raw.data_source, 'CPP Results') as SpcRecord['dataSource']),
    parameterType: (str(raw.parameterType || raw.parameter_type, 'CPP') as SpcRecord['parameterType']),
    parameterCode,
    parameterName: str(raw.parameterName || raw.parameter_name),
    reviewPeriodFrom: str(raw.reviewPeriodFrom || raw.review_period_from),
    reviewPeriodTo: str(raw.reviewPeriodTo || raw.review_period_to),
    subgroupSize: num(raw.subgroupSize ?? raw.subgroup_size, 4),
    sampleSize: num(raw.sampleSize ?? raw.sample_size, 1),
    samplingFrequency: str(raw.samplingFrequency || raw.sampling_frequency),
    targetValue: raw.targetValue == null || raw.targetValue === '' ? undefined : num(raw.targetValue),
    effectiveDate: str(raw.effectiveDate || raw.effective_date),
    description: str(raw.description),
    batchCount: num(raw.batchCount ?? raw.batch_count),
    dataPointsCount: num(raw.dataPointsCount ?? raw.data_points_count),
    mean: num(raw.mean),
    median: num(raw.median),
    mode: raw.mode == null || raw.mode === '' ? null : num(raw.mode),
    range: num(raw.range),
    variance: num(raw.variance),
    centerLine: num(raw.centerLine ?? raw.center_line),
    upperControlLimit: num(raw.upperControlLimit ?? raw.upper_control_limit ?? raw.ucl),
    lowerControlLimit: num(raw.lowerControlLimit ?? raw.lower_control_limit ?? raw.lcl),
    upperSpecificationLimit: num(raw.upperSpecificationLimit ?? raw.upper_specification_limit ?? raw.usl),
    lowerSpecificationLimit: num(raw.lowerSpecificationLimit ?? raw.lower_specification_limit ?? raw.lsl),
    movingRangeAverage: num(raw.movingRangeAverage ?? raw.moving_range_average ?? raw.mrBar),
    averageRange: num(raw.averageRange ?? raw.average_range ?? raw.rBar),
    standardDeviation: num(raw.standardDeviation ?? raw.standard_deviation),
    cp: num(raw.cp),
    cpk: num(raw.cpk),
    cpu: num(raw.cpu),
    cpl: num(raw.cpl),
    pp: num(raw.pp),
    ppk: num(raw.ppk),
    sigmaLevel: num(raw.sigmaLevel ?? raw.sigma_level),
    zScoreMean: num(raw.zScoreMean ?? raw.z_score_mean),
    confidenceIntervalLow: num(raw.confidenceIntervalLow ?? raw.confidence_interval_low),
    confidenceIntervalHigh: num(raw.confidenceIntervalHigh ?? raw.confidence_interval_high),
    skewness: num(raw.skewness),
    kurtosis: num(raw.kurtosis),
    outlierCount: num(raw.outlierCount ?? raw.outlier_count),
    ewmaLast: num(raw.ewmaLast ?? raw.ewma_last),
    cusumHighLast: num(raw.cusumHighLast ?? raw.cusum_high_last),
    cusumLowLast: num(raw.cusumLowLast ?? raw.cusum_low_last),
    ewmaData: chartPoints(raw.ewmaData ?? raw.ewma_data),
    cusumHighData: chartPoints(raw.cusumHighData ?? raw.cusum_high_data),
    cusumLowData: chartPoints(raw.cusumLowData ?? raw.cusum_low_data),
    sChartData: chartPoints(raw.sChartData ?? raw.s_chart_data),
    processDriftDetected: Boolean(raw.processDriftDetected ?? raw.process_drift_detected),
    specialCauseVariation: Boolean(raw.specialCauseVariation ?? raw.special_cause_variation),
    commonCauseOnly: Boolean(raw.commonCauseOnly ?? raw.common_cause_only),
    healthScore: num(raw.healthScore ?? raw.health_score),
    confidenceScore: num(raw.confidenceScore ?? raw.confidence_score),
    aiRecommendation: str(raw.aiRecommendation ?? raw.ai_recommendation),
    goldenBatchNumber: str(raw.goldenBatchNumber ?? raw.golden_batch_number),
    goldenBatchDelta: num(raw.goldenBatchDelta ?? raw.golden_batch_delta),
    forecastNext: num(raw.forecastNext ?? raw.forecast_next),
    westernElectricCount: num(raw.westernElectricCount ?? raw.western_electric_count),
    nelsonRuleCount: num(raw.nelsonRuleCount ?? raw.nelson_rule_count),
    spcStatus: (str(raw.spcStatus || raw.spc_status, 'Insufficient Data') as SpcRecord['spcStatus']),
    ruleViolationsCount: num(raw.ruleViolationsCount ?? raw.rule_violations_count),
    outOfControlPoints: num(raw.outOfControlPoints ?? raw.out_of_control_points),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low') as SpcRecord['riskLevel'],
    capaSuggested: Boolean(raw.capaSuggested || raw.capa_suggested),
    deviationRequired: Boolean(raw.deviationRequired ?? raw.deviation_required),
    conclusion: str(raw.conclusion),
    recommendation: str(raw.recommendation),
    changeReason: str(raw.changeReason ?? raw.change_reason),
    generatedBy: str(raw.generatedBy || raw.generated_by),
    generatedDate: str(raw.generatedDate || raw.generated_date || raw.createdAt),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    approvedBy: str(raw.approvedBy ?? raw.approved_by),
    approvalDate: str(raw.approvalDate ?? raw.approval_date),
    status: (workflowStatuses.includes(rawStatus)
      ? rawStatus
      : str(raw.workflowStatus, 'Generated')) as SpcRecord['status'],
    remarks: str(raw.remarks),
    linkedRiskId: str(raw.linkedRiskId || raw.linked_risk_id),
    linkedDeviationNumber: str(raw.linkedDeviationNumber ?? raw.linked_deviation_number),
    linkedCapaNumber: str(raw.linkedCapaNumber ?? raw.linked_capa_number),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    chartData: chartPoints(raw.chartData ?? raw.chart_data),
    movingRangeData: chartPoints(raw.movingRangeData ?? raw.moving_range_data),
    xbarChartData: chartPoints(raw.xbarChartData ?? raw.xbar_chart_data),
    rChartData: chartPoints(raw.rChartData ?? raw.r_chart_data),
    violations: Array.isArray(raw.violations) ? raw.violations as SpcRuleViolationRecord[] : [],
    sourcePreview: Array.isArray(raw.sourcePreview) ? raw.sourcePreview as SpcSourcePoint[] : [],
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export async function fetchSpcRecords(max = 500): Promise<SpcRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: SpcRecord[] = [];
    try {
      primary = await getRecords<SpcRecord>(
        CONTROL_CHARTS_COLLECTION,
        [orderBy('generatedDate', 'desc'), limit(max)],
      );
    } catch {
      try {
        primary = await getRecords<SpcRecord>(
          CONTROL_CHARTS_COLLECTION,
          [orderBy('createdAt', 'desc'), limit(max)],
        );
      } catch {
        primary = await getRecords<SpcRecord>(CONTROL_CHARTS_COLLECTION, [limit(max)]);
      }
    }
    const normalized = primary.map((r) => normalizeRecord(r as unknown as Record<string, unknown>));
    if (normalized.length) return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const legacy of CONTROL_CHARTS_LEGACY) {
      const rows = await listCpvRecords<Record<string, unknown>>(legacy, max);
      if (rows.length) return rows.map((r) => normalizeRecord(r));
    }
    const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.controlCharts, max);
    return cpvLegacy.map((r) => normalizeRecord(r));
  } catch (e) {
    console.error('fetchSpcRecords failed', e);
    return [];
  }
}

export async function fetchSpcRecordById(id: string): Promise<SpcRecord | null> {
  const record = await getRecord<SpcRecord>(CONTROL_CHARTS_COLLECTION, id);
  if (record) return normalizeRecord(record as unknown as Record<string, unknown>);
  const all = await fetchSpcRecords();
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

export async function fetchSpcSourceData(
  dataSource: string,
  productName: string,
  parameterName: string,
  from: string,
  to: string,
): Promise<SpcSourcePoint[]> {
  const points: SpcSourcePoint[] = [];
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
    console.error('fetchSpcSourceData failed', e);
  }
  return points;
}

export function previewSpcCalculation(
  form: SpcFormData,
  sourceData: SpcSourcePoint[],
): SpcCalculationResult {
  const spcId = buildSpcRecordId(form.productCode, form.parameterCode);
  return calculateSpcAnalysis(sourceData, form, spcId);
}

export async function createSpcRecord(
  form: SpcFormData,
  sourceData: SpcSourcePoint[],
  _actor: SpcActor,
): Promise<{ result: SpcRecord | null; error: string | null }> {
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
      return { result: null, error: 'At least 5 numeric data points required for SPC.' };
    }
    const preview = previewSpcCalculation(form, sourceData);
    const aiRecommendation = await polishRecommendationText(preview.aiRecommendation, {
      module: 'SPC',
      parameterName: form.parameterName,
      productName: form.productName,
      spcStatus: preview.spcStatus,
      ruleViolations: preview.ruleViolationsCount,
    });
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminSpcRecord',
    );
    const result = await fn({
      ...form,
      points: sourceData,
      changeReason: form.changeReason,
      aiRecommendation,
    });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    console.error('createSpcRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to save SPC record.') };
  }
}

export async function regenerateSpcRecord(
  id: string,
  _actor: SpcActor,
  existing: SpcRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean; changeReason?: string; sourceData?: SpcSourcePoint[] },
): Promise<{ result: SpcRecord | null; error: string | null }> {
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
      sourceData = await fetchSpcSourceData(
        existing.dataSource,
        existing.productName,
        existing.parameterName,
        existing.reviewPeriodFrom,
        existing.reviewPeriodTo,
      );
    }
    if ((sourceData?.length || 0) < 5 && existing.sourcePreview.length < 5) {
      return { result: null, error: 'Insufficient source data to regenerate.' };
    }
    const points = sourceData && sourceData.length >= 5 ? sourceData : existing.sourcePreview;
    const preview = previewSpcCalculation(
      {
        ...existing,
        parameterName: existing.parameterName,
        productName: existing.productName,
        subgroupSize: existing.subgroupSize,
        changeReason,
      } as SpcFormData,
      points,
    );
    const aiRecommendation = await polishRecommendationText(preview.aiRecommendation, {
      module: 'SPC',
      parameterName: existing.parameterName,
      productName: existing.productName,
      spcStatus: preview.spcStatus,
      ruleViolations: preview.ruleViolationsCount,
    });
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'regenerateAdminSpcRecord',
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
    console.error('regenerateSpcRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Regeneration failed.') };
  }
}

export async function reviewSpcRecord(
  id: string,
  _actor: SpcActor,
  _existing: SpcRecord,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminSpcRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveSpcRecord(
  id: string,
  _actor: SpcActor,
  _existing: SpcRecord,
  changeReason?: string,
  options?: { esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const reason = changeReason || 'Approved by QA reviewer';
    if (!reason || reason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'approveAdminSpcRecord',
    );
    const result = await fn({ id, changeReason: reason, esignConfirmed: true });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to approve.') };
  }
}

export async function rejectSpcRecord(
  id: string,
  _actor: SpcActor,
  _existing: SpcRecord,
  changeReason = 'Rejected by QA',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'rejectAdminSpcRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeRecord(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to reject.') };
  }
}

export async function softDeleteSpcRecord(
  id: string,
  _actor: SpcActor,
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
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminSpcRecord');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    return { error: cfErrorMessage(e, 'Failed to archive.') };
  }
}

export async function fetchSpcAuditTrail(recordId: string) {
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

export async function logSpcExport(actor: SpcActor, type: string, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminSpcExport');
    await fn({ count, format: type || 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logSpcExport CF failed (non-blocking)', e);
  }
}

export async function fetchParametersForSpc(dataSource: string, productName: string): Promise<string[]> {
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

export async function previewSpcSourceData(
  form: SpcFormData,
  _actor: SpcActor,
): Promise<SpcSourcePoint[]> {
  return fetchSpcSourceData(
    form.dataSource,
    form.productName,
    form.parameterName,
    form.reviewPeriodFrom,
    form.reviewPeriodTo,
  );
}

export { dataSourceForParameterType, parameterTypeForDataSource };
