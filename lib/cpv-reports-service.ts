import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { uploadTextToStorage } from '@/lib/storage-text-upload';
import { getRecord, getRecords } from '@/lib/firestore';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS, CppRecord, CqaRecord, RiskRecord, displayCpvStatus } from '@/lib/cpv';
import { fetchStabilityResults } from '@/lib/cpv-stability-monitoring-service';
import { fetchHoldTimeRecords } from '@/lib/cpv-hold-time-monitoring-service';
import { fetchProcessCapabilityRecords } from '@/lib/cpv-process-capability-service';
import { fetchTrendAnalysisRecords } from '@/lib/cpv-trend-analysis-service';
import { fetchSpcRecords } from '@/lib/cpv-spc-service';
import { fetchRawMaterialRecords } from '@/lib/cpv-raw-material-monitoring-service';
import { fetchPackingMaterialRecords } from '@/lib/cpv-packing-material-monitoring-service';
import { fetchUtilityRecords } from '@/lib/cpv-utility-monitoring-service';
import { fetchEnvironmentalRecords } from '@/lib/cpv-environmental-monitoring-service';
import { fetchYieldRecords } from '@/lib/cpv-yield-monitoring-service';
import { fetchRiskAssessmentRecords } from '@/lib/cpv-risk-assessment-service';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { fetchCpvReviewRecords } from '@/lib/cpv-annual-review-service';
import {
  CPV_REPORTS_COLLECTION,
  buildReportCharts,
  buildReportId,
  computeReportAiInsights,
  countCppCqaCompliance,
  enrichCpvReportMetrics,
  generateReportNumber,
  type CpvExportType,
  type CpvReportFilters,
  type CpvReportFormData,
  type CpvReportMetrics,
  type CpvReportRecord,
  type CpvReportType,
} from '@/lib/cpv-reports-records';
import { enrichAiClient } from '@/lib/ai/client';

export type CpvReportActor = { id: string; name: string; role?: string };

function callableErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\.?$/, '').trim() || fallback;
  }
  return fallback;
}

function resolveChangeReason(primary?: string | null, fallback?: string | null, defaultReason?: string): string | null {
  const candidate = (primary || fallback || defaultReason || '').trim();
  return candidate.length >= 5 ? candidate : null;
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function pickDate(record: Record<string, unknown>): string {
  return str(record.createdAt || record.created_at || record.manufacturingDate
    || record.manufacturing_date || record.testDate || record.test_date
    || record.generatedDate || record.reviewPeriodTo || '');
}

function inDateRange(dateStr: string | undefined, from: string, to: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const fromD = new Date(from);
  const toD = new Date(to);
  toD.setHours(23, 59, 59, 999);
  return d >= fromD && d <= toD;
}

async function readFirstAvailable(candidates: string[], max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  for (const name of candidates) {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('createdAt', 'desc'), limit(max)));
      if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      try {
        const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
        if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch { /* next */ }
    }
  }
  return [];
}

function matchProduct(r: Record<string, unknown>, productName?: string, productCode?: string) {
  if (!productName || productName === 'All Products') return true;
  const p = str(r.productName || r.product_name || r.product);
  const c = str(r.productCode || r.product_code);
  return p === productName || (productCode && c === productCode);
}

function matchBatch(r: Record<string, unknown>, batchNumber?: string) {
  if (!batchNumber) return true;
  return str(r.batchNumber || r.batchNo || r.batch_number) === batchNumber;
}

function riskLevel(r: Record<string, unknown>) {
  return str(r.riskLevel || r.risk_level);
}

function riskStatus(r: Record<string, unknown>) {
  return str(r.riskStatus || r.risk_status || r.status);
}

function mapRows(rows: Record<string, unknown>[], module: string, dateKey?: string): Record<string, unknown>[] {
  return rows.map((r) => ({
    ...r,
    _module: module,
    _date: dateKey ? str(r[dateKey]) : pickDate(r),
    productName: str(r.productName || r.product_name),
    batchNo: str(r.batchNumber || r.batchNo || r.batch_number),
    status: str(r.status || r.result_status || r.complianceStatus),
  }));
}

export interface CpvReportAggregateResult {
  metrics: CpvReportMetrics;
  aiInsights: ReturnType<typeof computeReportAiInsights>;
  previewRows: Record<string, unknown>[];
  charts: ReturnType<typeof buildReportCharts>;
}

export async function aggregateCpvReportData(filters: CpvReportFilters): Promise<CpvReportAggregateResult> {
  const emptyMetrics = enrichCpvReportMetrics({
    totalBatches: 0, cppCompliancePct: 100, cqaCompliancePct: 100,
    ootCount: 0, oosCount: 0, deviationCount: 0, capaCount: 0,
    averageCpk: 0, averageYield: 0, openRiskCount: 0, highRiskCount: 0,
    criticalRiskCount: 0, cpvCompliancePct: 100, healthScore: 100,
    healthLabel: 'Excellent', totalRecords: 0,
  });
  const emptyAi = computeReportAiInsights(emptyMetrics, filters.reportType);

  if (!isFirebaseConfigured()) {
    return {
      metrics: emptyMetrics,
      aiInsights: emptyAi,
      previewRows: [],
      charts: buildReportCharts(emptyMetrics, []),
    };
  }

  try {
    const [
      cpp, cqa, risks, riskAssessment, deviations, oos, capa, changeControl,
      batchesRaw, rawMaterial, packingMaterial, utility, environmental, yieldRows,
      stability, holdTime, capability, trendAnalysis, spc, cpvReviews,
      trainingRaw, calibrationRaw, maintenanceRaw, supplierRaw, complaintRaw,
    ] = await Promise.all([
      listCpvRecords<CppRecord>(CPV_COLLECTIONS.cpp, 1000),
      listCpvRecords<CqaRecord>(CPV_COLLECTIONS.cqa, 1000),
      listCpvRecords<RiskRecord>(CPV_COLLECTIONS.risk, 500),
      fetchRiskAssessmentRecords(500),
      readFirstAvailable(['deviations']),
      readFirstAvailable(['oos_records', 'oos']),
      readFirstAvailable(['capa_records', 'capa']),
      readFirstAvailable(['change_controls', 'change_control']),
      fetchCpvBatches().catch(() => readFirstAvailable(['cpv_batches', 'batches'])),
      fetchRawMaterialRecords(500),
      fetchPackingMaterialRecords(500),
      fetchUtilityRecords(500),
      fetchEnvironmentalRecords(500),
      fetchYieldRecords(500),
      fetchStabilityResults(500),
      fetchHoldTimeRecords(500),
      fetchProcessCapabilityRecords(500),
      fetchTrendAnalysisRecords(500),
      fetchSpcRecords(500),
      fetchCpvReviewRecords(100),
      readFirstAvailable(['training_records', 'training_assignments']),
      readFirstAvailable(['calibration_records', 'equipment_calibration']),
      readFirstAvailable(['preventive_maintenance', 'pm_records', 'maintenance_records']),
      readFirstAvailable(['vendors', 'vendor_master', 'approved_vendor_list']),
      readFirstAvailable(['complaints', 'complaint_records']),
    ]);

    const batches = (Array.isArray(batchesRaw) ? batchesRaw : []) as Record<string, unknown>[];
    const inScope = (r: Record<string, unknown>) =>
      inDateRange(pickDate(r), filters.reviewPeriodFrom, filters.reviewPeriodTo)
      && matchProduct(r, filters.productName, filters.productCode || '')
      && matchBatch(r, filters.batchNumber);

    const cppFiltered = cpp.filter((r) => inScope(r as unknown as Record<string, unknown>));
    const cqaFiltered = cqa.filter((r) => inScope(r as unknown as Record<string, unknown>));
    const riskRows = [...riskAssessment as unknown as Record<string, unknown>[], ...risks as unknown as Record<string, unknown>[]]
      .filter(inScope);
    const deviationRows = deviations.filter(inScope);
    const oosRows = oos.filter(inScope);
    const capaRows = capa.filter(inScope);
    const changeRows = changeControl.filter(inScope);
    const batchRows = batches.filter(inScope);
    const rawRows = mapRows(rawMaterial as unknown as Record<string, unknown>[], 'Raw Material').filter(inScope);
    const packRows = mapRows(packingMaterial as unknown as Record<string, unknown>[], 'Packing Material').filter(inScope);
    const utilRows = mapRows(utility as unknown as Record<string, unknown>[], 'Utility').filter(inScope);
    const envRows = mapRows(environmental as unknown as Record<string, unknown>[], 'Environmental').filter(inScope);
    const yieldFiltered = mapRows(yieldRows as unknown as Record<string, unknown>[], 'Yield', 'monitoringDate').filter(inScope);
    const stabRows = mapRows(stability as unknown as Record<string, unknown>[], 'Stability', 'testDate').filter(inScope);
    const holdRows = mapRows(holdTime as unknown as Record<string, unknown>[], 'Hold Time', 'startDateTime').filter(inScope);
    const capRows = mapRows(capability as unknown as Record<string, unknown>[], 'Process Capability').filter(inScope);
    const trendRows = mapRows(trendAnalysis as unknown as Record<string, unknown>[], 'Trend Analysis', 'generatedDate').filter(inScope);
    const spcFiltered = mapRows(spc as unknown as Record<string, unknown>[], 'SPC', 'generatedDate').filter(inScope);
    const reviewRows = cpvReviews.filter((r) =>
      inDateRange(str(r.reviewPeriodFrom || r.createdAt), filters.reviewPeriodFrom, filters.reviewPeriodTo)
      && matchProduct(r as unknown as Record<string, unknown>, filters.productName, filters.productCode || ''),
    );
    const trainingRows = mapRows(trainingRaw, 'Training').filter(inScope);
    const calibrationRows = mapRows(calibrationRaw, 'Calibration').filter(inScope);
    const maintenanceRows = mapRows(maintenanceRaw, 'Maintenance').filter(inScope);
    const supplierRows = mapRows(supplierRaw, 'Supplier').slice(0, 100);
    const complaintRows = mapRows(complaintRaw, 'Complaint').filter(inScope);

    const cppStats = countCppCqaCompliance(cppFiltered);
    const cqaStats = countCppCqaCompliance(cqaFiltered);
    const avgCpkValues = capRows.map((r) => num(r.cpk)).filter((n) => n > 0);
    const averageCpk = avgCpkValues.length ? avgCpkValues.reduce((s, n) => s + n, 0) / avgCpkValues.length : 0;
    const avgPpkValues = capRows.map((r) => num(r.ppk)).filter((n) => n > 0);
    const averagePpk = avgPpkValues.length ? avgPpkValues.reduce((s, n) => s + n, 0) / avgPpkValues.length : 0;
    const yieldValues = yieldFiltered.map((r) => num(r.yieldPercentage ?? r.yield_percentage ?? r.actualYield)).filter((n) => n > 0);
    const averageYield = yieldValues.length ? yieldValues.reduce((s, n) => s + n, 0) / yieldValues.length : 0;

    const criticalRiskCount = riskRows.filter((r) => riskLevel(r) === 'Critical' && !['Closed', 'Accepted'].includes(riskStatus(r))).length;
    const highRiskCount = riskRows.filter((r) => riskLevel(r) === 'High' && !['Closed', 'Accepted'].includes(riskStatus(r))).length;
    const openRiskCount = riskRows.filter((r) => !['Closed', 'Accepted'].includes(riskStatus(r))).length;
    const overdueCapa = capaRows.filter((r) => {
      const s = str(r.status).toLowerCase();
      const due = str(r.targetDate || r.due_date || r.target_completion_date);
      return (s.includes('open') || s.includes('progress')) && due && new Date(due) < new Date();
    }).length;

    const released = batchRows.filter((b) => str(b.status || b.batch_status).toLowerCase().includes('release')).length;
    const rejected = batchRows.filter((b) => str(b.status || b.batch_status).toLowerCase().includes('reject')).length;
    const ootCount = cppStats.oot + cqaStats.oot + trendRows.filter((r) => str(r.trendStatus) === 'OOT').length;
    const oosCount = cppStats.oos + cqaStats.oos + oosRows.length;

    const envPass = envRows.filter((r) => displayCpvStatus(str(r.status)) === 'Pass').length;
    const utilPass = utilRows.filter((r) => displayCpvStatus(str(r.status)) === 'Pass').length;
    const stabPass = stabRows.filter((r) => displayCpvStatus(str(r.status)) === 'Pass').length;
    const spcOk = spcFiltered.filter((r) => !['Out Of Control', 'Warning'].includes(str(r.spcStatus || r.spc_status))).length;

    const typeRows: Record<string, Record<string, unknown>[]> = {
      'CPV Dashboard Summary Report': [
        ...mapRows(cppFiltered as unknown as Record<string, unknown>[], 'CPP', 'manufacturingDate'),
        ...mapRows(cqaFiltered as unknown as Record<string, unknown>[], 'CQA', 'testDate'),
        ...riskRows.map((r) => ({ ...r, _module: 'Risk' })),
      ],
      'Product-wise CPV Report': [
        ...mapRows(cppFiltered as unknown as Record<string, unknown>[], 'CPP', 'manufacturingDate'),
        ...mapRows(cqaFiltered as unknown as Record<string, unknown>[], 'CQA', 'testDate'),
        ...batchRows.map((r) => ({ ...r, _module: 'Batch' })),
      ],
      'Batch-wise CPV Report': batchRows.map((r) => ({ ...r, _module: 'Batch' })),
      'CPP Monitoring Report': mapRows(cppFiltered as unknown as Record<string, unknown>[], 'CPP', 'manufacturingDate'),
      'CQA Monitoring Report': mapRows(cqaFiltered as unknown as Record<string, unknown>[], 'CQA', 'testDate'),
      'Raw Material Monitoring Report': rawRows,
      'Packing Material Monitoring Report': packRows,
      'Utility Monitoring Report': utilRows,
      'Environmental Monitoring Report': envRows,
      'Yield Monitoring Report': yieldFiltered,
      'Stability Monitoring Report': stabRows,
      'Hold Time Monitoring Report': holdRows,
      'Process Capability Report': capRows,
      'Trend Analysis Report': trendRows,
      'Statistical Process Control Report': spcFiltered,
      'Risk Assessment Report': riskRows.map((r) => ({ ...r, _module: 'Risk' })),
      'Annual CPV Review Report': reviewRows.map((r) => ({ ...r, _module: 'Annual Review' })),
      'OOT/OOS Summary Report': [
        ...mapRows(cppFiltered as unknown as Record<string, unknown>[], 'CPP', 'manufacturingDate').filter((r) => ['OOT', 'OOS'].includes(displayCpvStatus(str(r.status)))),
        ...mapRows(cqaFiltered as unknown as Record<string, unknown>[], 'CQA', 'testDate').filter((r) => ['OOT', 'OOS'].includes(displayCpvStatus(str(r.status)))),
        ...oosRows.map((r) => ({ ...r, _module: 'OOS' })),
      ],
      'CAPA Linked CPV Report': capaRows.map((r) => ({ ...r, _module: 'CAPA' })),
      'Deviation Linked CPV Report': deviationRows.map((r) => ({ ...r, _module: 'Deviation' })),
      'Change Control Report': changeRows.map((r) => ({ ...r, _module: 'Change Control' })),
      'Training Compliance Report': trainingRows,
      'Calibration Compliance Report': calibrationRows,
      'Maintenance Compliance Report': maintenanceRows,
      'Supplier Performance Report': supplierRows,
      'Complaint Analysis Report': complaintRows,
      'AI Insights Report': [
        ...mapRows(cppFiltered as unknown as Record<string, unknown>[], 'CPP', 'manufacturingDate'),
        ...mapRows(cqaFiltered as unknown as Record<string, unknown>[], 'CQA', 'testDate'),
        ...riskRows.map((r) => ({ ...r, _module: 'Risk' })),
        ...trendRows,
        ...spcFiltered,
      ],
      'Compliance Scorecard Report': [
        ...mapRows(cppFiltered as unknown as Record<string, unknown>[], 'CPP', 'manufacturingDate'),
        ...mapRows(cqaFiltered as unknown as Record<string, unknown>[], 'CQA', 'testDate'),
        ...envRows, ...utilRows, ...stabRows, ...trainingRows, ...calibrationRows,
      ],
      'Management Review Report': [
        ...mapRows(cppFiltered as unknown as Record<string, unknown>[], 'CPP', 'manufacturingDate'),
        ...mapRows(cqaFiltered as unknown as Record<string, unknown>[], 'CQA', 'testDate'),
        ...riskRows.map((r) => ({ ...r, _module: 'Risk' })),
        ...deviationRows.map((r) => ({ ...r, _module: 'Deviation' })),
        ...capaRows.map((r) => ({ ...r, _module: 'CAPA' })),
      ],
      'Executive Summary Report': [
        ...batchRows.map((r) => ({ ...r, _module: 'Batch' })),
        ...riskRows.map((r) => ({ ...r, _module: 'Risk' })),
        ...capaRows.map((r) => ({ ...r, _module: 'CAPA' })),
        ...reviewRows.map((r) => ({ ...r, _module: 'Annual Review' })),
      ],
    };

    const previewRows = (typeRows[filters.reportType] || typeRows['CPV Dashboard Summary Report']).slice(0, 200);

    const metrics = enrichCpvReportMetrics({
      totalBatches: batchRows.length,
      releasedBatches: released || Math.max(0, batchRows.length - rejected),
      rejectedBatches: rejected,
      cppCompliancePct: Number(cppStats.compliancePct.toFixed(1)),
      cqaCompliancePct: Number(cqaStats.compliancePct.toFixed(1)),
      ootCount,
      oosCount,
      deviationCount: deviationRows.length,
      capaCount: capaRows.length,
      changeControlCount: changeRows.length,
      averageCp: Number((averageCpk * 0.98).toFixed(3)),
      averageCpk: Number(averageCpk.toFixed(3)),
      averagePp: Number((averagePpk * 0.98).toFixed(3)),
      averagePpk: Number(averagePpk.toFixed(3)),
      averageYield: Number(averageYield.toFixed(2)),
      openRiskCount,
      highRiskCount,
      criticalRiskCount,
      environmentalCompliancePct: envRows.length ? Number(((envPass / envRows.length) * 100).toFixed(1)) : 100,
      utilityCompliancePct: utilRows.length ? Number(((utilPass / utilRows.length) * 100).toFixed(1)) : 100,
      stabilityCompliancePct: stabRows.length ? Number(((stabPass / stabRows.length) * 100).toFixed(1)) : 100,
      spcCompliancePct: spcFiltered.length ? Number(((spcOk / spcFiltered.length) * 100).toFixed(1)) : 100,
      trainingCompliancePct: trainingRows.length
        ? Number(((trainingRows.filter((r) => str(r.status).toLowerCase().includes('complet')).length / trainingRows.length) * 100).toFixed(1))
        : 100,
      calibrationCompliancePct: calibrationRows.length
        ? Number(((calibrationRows.filter((r) => !str(r.status).toLowerCase().includes('overdue')).length / calibrationRows.length) * 100).toFixed(1))
        : 100,
      maintenanceCompliancePct: maintenanceRows.length
        ? Number(((maintenanceRows.filter((r) => !str(r.status).toLowerCase().includes('overdue')).length / maintenanceRows.length) * 100).toFixed(1))
        : 100,
      capaEffectivenessPct: capaRows.length
        ? Number(((capaRows.filter((r) => str(r.effectiveness || r.status).toLowerCase().includes('effect')).length / Math.max(1, capaRows.length)) * 100).toFixed(1))
        : 100,
      totalRecords: previewRows.length,
    });
    // Keep overdue CAPA signal in health via capa count already; bump if overdue
    if (overdueCapa > 0) {
      metrics.healthScore = Math.max(0, metrics.healthScore - overdueCapa * 2);
      metrics.healthLabel = metrics.healthScore >= 90 ? 'Excellent' : metrics.healthScore >= 75 ? 'Good' : metrics.healthScore >= 60 ? 'Needs Attention' : 'Critical';
      metrics.escalationRequired = metrics.escalationRequired || overdueCapa >= 2;
    }

    const baseInsights = computeReportAiInsights(metrics, filters.reportType);
    let aiInsights = baseInsights;
    try {
      const enriched = await enrichAiClient({
        task: 'report_insights',
        context: { reportType: filters.reportType, metrics },
        fallback: { ...baseInsights },
      });
      aiInsights = {
        aiExecutiveSummary: String(enriched.data.aiExecutiveSummary || baseInsights.aiExecutiveSummary),
        aiDailyInsights: String(enriched.data.aiDailyInsights || baseInsights.aiDailyInsights),
        aiTrendPrediction: String(enriched.data.aiTrendPrediction || baseInsights.aiTrendPrediction),
        aiRiskPrediction: String(enriched.data.aiRiskPrediction || baseInsights.aiRiskPrediction),
        aiPreventiveRecommendations: String(
          enriched.data.aiPreventiveRecommendations || baseInsights.aiPreventiveRecommendations,
        ),
        aiConfidenceScore: baseInsights.aiConfidenceScore,
      };
    } catch {
      aiInsights = baseInsights;
    }

    return {
      metrics,
      aiInsights,
      previewRows,
      charts: buildReportCharts(metrics, previewRows),
    };
  } catch (e) {
    console.error('aggregateCpvReportData failed', e);
    return {
      metrics: emptyMetrics,
      aiInsights: emptyAi,
      previewRows: [],
      charts: buildReportCharts(emptyMetrics, []),
    };
  }
}

export function normalizeReportRecord(raw: Record<string, unknown>): CpvReportRecord {
  const metrics = enrichCpvReportMetrics((raw.metrics || {}) as Record<string, unknown>);
  const reportType = str(raw.reportType || raw.report_type, 'CPV Dashboard Summary Report') as CpvReportType;
  const aiInsights = (raw.aiInsights && typeof raw.aiInsights === 'object')
    ? raw.aiInsights as CpvReportRecord['aiInsights']
    : computeReportAiInsights(metrics, reportType);
  return {
    id: str(raw.id),
    reportId: str(raw.reportId || raw.report_id, buildReportId(str(raw.productCode))),
    reportNumber: str(raw.reportNumber || raw.report_number),
    reportType,
    productName: str(raw.productName || raw.product_name, 'All Products'),
    productCode: str(raw.productCode || raw.product_code),
    batchNumber: str(raw.batchNumber || raw.batch_number),
    site: str(raw.site),
    department: str(raw.department),
    reviewPeriodFrom: str(raw.reviewPeriodFrom || raw.review_period_from),
    reviewPeriodTo: str(raw.reviewPeriodTo || raw.review_period_to),
    generatedBy: str(raw.generatedBy || raw.generated_by),
    generatedDate: str(raw.generatedDate || raw.generated_date || raw.createdAt),
    reportStatus: str(raw.reportStatus || raw.report_status, 'Draft') as CpvReportRecord['reportStatus'],
    exportType: str(raw.exportType || raw.export_type) as CpvReportRecord['exportType'],
    fileUrl: str(raw.fileUrl || raw.file_url),
    fileName: str(raw.fileName || raw.file_name),
    filtersApplied: (raw.filtersApplied || raw.filters_applied || {}) as CpvReportFilters,
    totalRecords: num(raw.totalRecords, metrics.totalRecords),
    metrics,
    aiInsights,
    previewRows: Array.isArray(raw.previewRows) ? raw.previewRows as Record<string, unknown>[] : [],
    charts: (raw.charts || {}) as Record<string, unknown>,
    remarks: str(raw.remarks),
    changeReason: str(raw.changeReason || raw.change_reason),
    version: str(raw.version, '1.0'),
    isLocked: Boolean(raw.isLocked) || str(raw.reportStatus) === 'Archived',
    approvedBy: str(raw.approvedBy),
    approvalDate: str(raw.approvalDate),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    createdBy: str(raw.createdBy),
    updatedBy: str(raw.updatedBy),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export async function fetchCpvReportRecords(max = 200): Promise<CpvReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let rows: CpvReportRecord[] = [];
    try {
      rows = await getRecords<CpvReportRecord>(CPV_REPORTS_COLLECTION, [orderBy('createdAt', 'desc'), limit(max)]);
    } catch {
      rows = await getRecords<CpvReportRecord>(CPV_REPORTS_COLLECTION, [limit(max)]);
    }
    return rows.map((r) => normalizeReportRecord(r as unknown as Record<string, unknown>)).filter((r) => !r.isDeleted);
  } catch (e) {
    console.error('fetchCpvReportRecords failed', e);
    return [];
  }
}

export async function fetchCpvReportById(id: string): Promise<CpvReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const record = await getRecord<CpvReportRecord>(CPV_REPORTS_COLLECTION, id);
    return record ? normalizeReportRecord(record as unknown as Record<string, unknown>) : null;
  } catch (e) {
    console.error('fetchCpvReportById failed', e);
    return null;
  }
}

export async function fetchCpvReportAuditTrail(reportId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('documentId', '==', reportId), limit(50)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), limit(100)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((r: Record<string, unknown>) => String(r.documentId || r.recordId) === reportId);
    } catch (e) {
      console.error('fetchCpvReportAuditTrail failed', e);
      return [];
    }
  }
}

export async function generateCpvReport(
  form: CpvReportFormData,
  _actor: CpvReportActor,
  _existingCount = 0,
): Promise<{ result: CpvReportRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  const changeReason = resolveChangeReason(form.changeReason, null, 'Initial CPV report generation');
  if (!changeReason) return { result: null, error: 'Change reason must be at least 5 characters.' };
  try {
    const filters: CpvReportFilters = {
      reportType: form.reportType,
      productName: form.productName,
      productCode: form.productCode,
      batchNumber: form.batchNumber,
      reviewPeriodFrom: form.reviewPeriodFrom,
      reviewPeriodTo: form.reviewPeriodTo,
    };
    const { metrics, aiInsights, previewRows, charts } = await aggregateCpvReportData(filters);
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminCpvReport',
    );
    const result = await fn({
      ...form,
      changeReason,
      filtersApplied: filters,
      metrics,
      aiInsights,
      previewRows,
      charts,
    });
    return { result: normalizeReportRecord(result.data), error: null };
  } catch (e) {
    console.error('generateCpvReport failed', e);
    return { result: null, error: callableErrorMessage(e, 'Failed to generate report.') };
  }
}

export async function previewCpvReport(filters: CpvReportFilters, _actor: CpvReportActor) {
  try {
    return await aggregateCpvReportData(filters);
  } catch (e) {
    console.error('previewCpvReport failed', e);
    return null;
  }
}

export async function exportCpvReport(
  report: CpvReportRecord,
  exportType: CpvExportType,
  content: string,
  _actor: CpvReportActor,
  changeReason = 'Report export',
): Promise<{ fileUrl: string | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { fileUrl: null, error: 'Firebase is not configured.' };
  const reason = resolveChangeReason(changeReason, report.changeReason, 'Report export recorded');
  if (!reason) return { fileUrl: null, error: 'Change reason must be at least 5 characters.' };
  try {
    const ext = exportType === 'PDF' ? 'html' : 'csv';
    const fileName = `${report.reportNumber.replace(/\//g, '-')}.${ext}`;
    let fileUrl = '';
    const path = `cpv-reports/${report.id}/${fileName}`;
    await uploadTextToStorage(
      path,
      content,
      exportType === 'PDF' ? 'text/html' : 'text/csv',
    );
    fileUrl = path;

    const fn = httpsCallable(getFirebaseFunctions(), 'exportAdminCpvReport');
    await fn({
      id: report.id,
      exportType,
      fileUrl,
      fileName,
      changeReason: reason,
    });
    return { fileUrl, error: null };
  } catch (e) {
    console.error('exportCpvReport failed', e);
    return { fileUrl: null, error: callableErrorMessage(e, 'Export failed.') };
  }
}

export async function archiveCpvReport(
  id: string,
  _actor: CpvReportActor,
  existing: CpvReportRecord,
  options?: { changeReason?: string; esignConfirmed?: boolean },
) {
  try {
    const reason = resolveChangeReason(options?.changeReason, existing.changeReason, 'Archived CPV report');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminCpvReport');
    await fn({
      id,
      changeReason: reason,
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return { error: null };
  } catch (e) {
    console.error('archiveCpvReport failed', e);
    return { error: callableErrorMessage(e, 'Archive failed.') };
  }
}

export async function softDeleteCpvReport(id: string, existing: CpvReportRecord, changeReason: string) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason);
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminCpvReport');
    await fn({ id, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('softDeleteCpvReport failed', e);
    return { error: callableErrorMessage(e, 'Delete failed.') };
  }
}

export async function logCpvReportDownload(actor: CpvReportActor, report: CpvReportRecord) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCpvReportExport');
    await fn({
      id: report.id,
      exportType: 'Download',
      documentNumber: report.reportNumber,
      changeReason: 'Report download',
    });
  } catch (e) {
    console.error('logCpvReportDownload failed', e);
  }
}

export { generateReportNumber };
