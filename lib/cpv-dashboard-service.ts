import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { areAuditCallablesUnavailable, createAuditLog, shouldSkipRemoteAuditInLocalDev } from '@/lib/audit-trail';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS, type CppRecord, type CqaRecord, type RiskRecord } from '@/lib/cpv';
import { computeCapabilityAverages } from '@/lib/cpv-dashboard';

/** Firestore collection names — CPV masters first, then QMS/legacy fallbacks */
export const CPV_DASHBOARD_COLLECTIONS = {
  products: ['cpv_products', 'products'],
  batches: ['cpv_batches', 'batches', 'pqr_batches'],
  cppParameters: ['cpp_parameters'],
  cppResults: ['cpp_results', 'cpv_cpp'],
  cqaParameters: ['cqa_parameters'],
  cqaResults: ['cqa_results', 'cpv_cqa'],
  rawMaterialMonitoring: ['raw_material_monitoring', 'cpv_raw_materials'],
  packingMaterialMonitoring: ['packing_material_monitoring', 'cpv_packing_materials'],
  utilityMonitoring: ['utility_monitoring', 'cpv_utility_monitoring', 'cpv_utility'],
  environmentalMonitoring: ['environmental_monitoring', 'cpv_environment_monitoring'],
  yieldMonitoring: ['yield_monitoring', 'cpv_yield_monitoring', 'cpv_yield'],
  cpvReviews: ['cpv_reviews', 'cpv_annual_review'],
  processCapability: ['process_capability', 'cpv_capability'],
  riskAssessment: ['risk_assessment', 'cpv_risk_assessment'],
  alerts: ['alerts', 'cpv_alerts'],
  auditTrail: ['audit_trail', 'cpv_audit_trail'],
  notifications: ['notifications'],
  stabilityResults: ['stability_results', 'stability_monitoring'],
  stabilityStudies: ['stability_studies', 'cpv_stability_studies'],
  holdTimeMonitoring: ['hold_time_monitoring', 'cpv_hold_time'],
  trendAnalysis: ['trend_analysis', 'cpv_trends'],
  controlCharts: ['control_charts', 'cpv_control_charts'],
} as const;

export interface CpvReviewRow {
  id?: string;
  reviewNo: string;
  productName: string;
  reviewPeriod: string;
  status: string;
  pendingWith: string;
  dueDate: string;
  createdAt?: string;
}

export interface CpvAlertRow {
  id?: string;
  type: 'CPP' | 'CQA';
  alertDate: string;
  productName: string;
  batchNo: string;
  parameter: string;
  observedValue: number;
  limit: string;
  status: string;
  riskLevel: string;
}

export interface CpvDashboardRawData {
  products: Record<string, unknown>[];
  batches: Record<string, unknown>[];
  cppParameters: Record<string, unknown>[];
  cqaParameters: Record<string, unknown>[];
  cpp: CppRecord[];
  cqa: CqaRecord[];
  risks: RiskRecord[];
  cpvReviews: CpvReviewRow[];
  processCapability: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
  auditTrail: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  stabilityResults: Record<string, unknown>[];
  stabilityStudies: Record<string, unknown>[];
  holdTimeRecords: Record<string, unknown>[];
  trendAnalysisRecords: Record<string, unknown>[];
  controlChartRecords: Record<string, unknown>[];
  rawMaterialRecords: Record<string, unknown>[];
  packingMaterialRecords: Record<string, unknown>[];
  utilityRecords: Record<string, unknown>[];
  environmentalRecords: Record<string, unknown>[];
  yieldRecords: Record<string, unknown>[];
  openCapaCount: number;
  openDeviationCount: number;
  openChangeControlCount: number;
  truncated?: boolean;
  fetchedAt?: string;
  error?: string;
}

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function notDeleted(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter((r) => r.isDeleted !== true && r.is_deleted !== true);
}

async function safeQueryCollection(
  name: string,
  max = 500,
  orderField = 'createdAt',
): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), name),
      orderBy(orderField, 'desc'),
      limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn(`CPV dashboard: unable to load ${name}`, e);
      return [];
    }
  }
}

async function loadFromAlternatives(
  names: readonly string[],
  max = 500,
): Promise<Record<string, unknown>[]> {
  // Prefer canonical collection; only fall back to legacy if primary is empty.
  // Merging both caused double-counting when both schemas were populated.
  for (const name of names) {
    const rows = await safeQueryCollection(name, max);
    if (rows.length > 0) return rows;
  }
  return [];
}

function normalizeCpp(raw: Record<string, unknown>): CppRecord {
  const status = str(raw.status, 'Complies') as CppRecord['status'];
  return {
    id: str(raw.id),
    productName: str(raw.productName || raw.product_name || raw.product),
    batchNo: str(raw.batchNo || raw.batch_no || raw.batch_number),
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date || raw.testDate),
    processStage: str(raw.processStage || raw.process_stage, 'Process'),
    parameterName: str(raw.parameterName || raw.parameter_name || raw.parameter),
    observedValue: num(raw.observedValue ?? raw.observed_value ?? raw.result),
    targetValue: num(raw.targetValue ?? raw.target_value ?? raw.target),
    lsl: num(raw.lsl ?? raw.lower_limit),
    usl: num(raw.usl ?? raw.upper_limit),
    unit: str(raw.unit, ''),
    recordedBy: str(raw.recordedBy || raw.recorded_by, 'System'),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    status,
    deviationPercent: num(raw.deviationPercent ?? raw.deviation_percent),
    createdAt: str(raw.createdAt || raw.created_at),
  };
}

function normalizeCqa(raw: Record<string, unknown>): CqaRecord {
  const status = str(raw.status, 'Complies') as CqaRecord['status'];
  return {
    id: str(raw.id),
    productName: str(raw.productName || raw.product_name || raw.product),
    batchNo: str(raw.batchNo || raw.batch_no || raw.batch_number),
    testDate: str(raw.testDate || raw.test_date || raw.createdAt),
    testParameter: str(raw.testParameter || raw.test_parameter || raw.parameter_name || raw.parameter),
    observedValue: num(raw.observedValue ?? raw.observed_value ?? raw.result),
    target: num(raw.target ?? raw.target_value),
    lsl: num(raw.lsl ?? raw.lower_limit),
    usl: num(raw.usl ?? raw.upper_limit),
    unit: str(raw.unit, ''),
    recordedBy: str(raw.recordedBy || raw.recorded_by, 'System'),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    status,
    deviationPercent: num(raw.deviationPercent ?? raw.deviation_percent),
    createdAt: str(raw.createdAt || raw.created_at),
  };
}

function normalizeRisk(raw: Record<string, unknown>): RiskRecord {
  const severity = num(raw.severity, 1);
  const occurrence = num(raw.occurrence ?? raw.likelihood, 1);
  const detectability = num(raw.detectability ?? raw.detection, 1);
  return {
    id: str(raw.id),
    productName: str(raw.productName || raw.product_name || raw.product),
    batchNo: str(raw.batchNo || raw.batch_no || ''),
    factor: str(raw.factor || raw.risk_factor, 'Process'),
    riskDescription: str(raw.riskDescription || raw.risk_description || raw.description),
    severity,
    occurrence,
    detectability,
    mitigation: str(raw.mitigation, ''),
    owner: str(raw.owner, 'Unassigned'),
    dueDate: str(raw.dueDate || raw.due_date, ''),
    rpn: num(raw.rpn, severity * occurrence * detectability),
    riskLevel: (str(raw.riskLevel || raw.risk_level, 'Low') as RiskRecord['riskLevel']),
    status: str(raw.status, 'Open'),
    createdAt: str(raw.createdAt || raw.created_at),
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
  };
}

function normalizeReview(raw: Record<string, unknown>): CpvReviewRow {
  return {
    id: str(raw.id),
    reviewNo: str(raw.reviewNo || raw.review_no || raw.reviewNumber || raw.id),
    productName: str(raw.productName || raw.product_name || raw.product),
    reviewPeriod: str(raw.reviewPeriod || raw.review_period || raw.period),
    status: str(raw.status, 'Draft'),
    pendingWith: str(raw.pendingWith || raw.pending_with || raw.assignedTo || raw.reviewer),
    dueDate: str(raw.dueDate || raw.due_date || raw.reviewDueDate),
    createdAt: str(raw.createdAt || raw.created_at),
  };
}

function toAlertRow(
  raw: Record<string, unknown>,
  type: 'CPP' | 'CQA',
  parameter: string,
): CpvAlertRow {
  const status = str(raw.status);
  return {
    id: str(raw.id),
    type,
    alertDate: str(raw.alertDate || raw.alert_date || raw.createdAt || raw.created_at),
    productName: str(raw.productName || raw.product_name || raw.product),
    batchNo: str(raw.batchNo || raw.batch_no || raw.batch_number),
    parameter,
    observedValue: num(raw.observedValue ?? raw.observed_value ?? raw.result),
    limit: type === 'CPP'
      ? `${num(raw.lsl)} – ${num(raw.usl)} ${str(raw.unit)}`
      : str(raw.specification || raw.usl || `${num(raw.lsl)} – ${num(raw.usl)}`),
    status,
    riskLevel: str(raw.riskLevel || raw.risk_level || (status === 'OOS' ? 'High' : 'Medium')),
  };
}

export async function fetchCpvDashboardData(): Promise<CpvDashboardRawData> {
  const empty: CpvDashboardRawData = {
    products: [], batches: [], cppParameters: [], cqaParameters: [],
    cpp: [], cqa: [], risks: [], cpvReviews: [], processCapability: [],
    alerts: [], auditTrail: [], notifications: [], stabilityResults: [], stabilityStudies: [],
    holdTimeRecords: [], trendAnalysisRecords: [], controlChartRecords: [],
    rawMaterialRecords: [], packingMaterialRecords: [], utilityRecords: [],
    environmentalRecords: [], yieldRecords: [],
    openCapaCount: 0, openDeviationCount: 0, openChangeControlCount: 0,
    fetchedAt: new Date().toISOString(),
  };

  if (!isFirebaseConfigured()) {
    return {
      ...empty,
      error: 'Firebase is not configured. Add credentials to .env.local.',
    };
  }

  try {
    const [
      products,
      batches,
      cppParameters,
      cqaParameters,
      cppRaw,
      cqaRaw,
      riskRaw,
      reviewRaw,
      capabilityRaw,
      alertsRaw,
      auditRaw,
      notifications,
      legacyCpp,
      legacyCqa,
      legacyRisks,
      stabilityResultsRaw,
      stabilityStudiesRaw,
      holdTimeRaw,
      trendAnalysisRaw,
      controlChartsRaw,
      rawMaterialRaw,
      packingMaterialRaw,
      utilityRaw,
      environmentalRaw,
      yieldRaw,
      capaRaw,
      deviationRaw,
      changeControlRaw,
    ] = await Promise.all([
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.products, 200),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.batches, 500),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.cppParameters, 500),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.cqaParameters, 500),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.cppResults, 500),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.cqaResults, 500),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.riskAssessment, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.cpvReviews, 100),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.processCapability, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.alerts, 100),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.auditTrail, 50),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.notifications, 30),
      listCpvRecords<CppRecord>(CPV_COLLECTIONS.cpp, 500),
      listCpvRecords<CqaRecord>(CPV_COLLECTIONS.cqa, 500),
      listCpvRecords<RiskRecord>(CPV_COLLECTIONS.risk, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.stabilityResults, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.stabilityStudies, 100),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.holdTimeMonitoring, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.trendAnalysis, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.controlCharts, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.rawMaterialMonitoring, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.packingMaterialMonitoring, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.utilityMonitoring, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.environmentalMonitoring, 300),
      loadFromAlternatives(CPV_DASHBOARD_COLLECTIONS.yieldMonitoring, 300),
      loadFromAlternatives(['capa', 'capa_records'], 200),
      safeQueryCollection('deviations', 200),
      loadFromAlternatives(['change_controls', 'change_control'], 200),
    ]);

    // Prefer canonical result collections; use legacy list only when canonical empty.
    const cpp = (cppRaw.length ? cppRaw.map(normalizeCpp) : legacyCpp);
    const cqa = (cqaRaw.length ? cqaRaw.map(normalizeCqa) : legacyCqa);
    const risks = (riskRaw.length ? riskRaw.map(normalizeRisk) : legacyRisks);

    const truncated = [
      cppRaw, cqaRaw, riskRaw, capabilityRaw, stabilityResultsRaw, holdTimeRaw,
      trendAnalysisRaw, controlChartsRaw, rawMaterialRaw, packingMaterialRaw,
      utilityRaw, environmentalRaw, yieldRaw, batches,
    ].some((rows) => rows.length >= 500);

    const isOpenStatus = (status: string) => {
      const s = status.toLowerCase();
      return s.includes('open') || s.includes('pending') || s.includes('in progress')
        || s.includes('investigation') || s.includes('implementation') || s === 'draft';
    };

    return {
      products: notDeleted(products),
      batches: notDeleted(batches),
      cppParameters,
      cqaParameters,
      cpp: cpp.filter((r) => (r as unknown as Record<string, unknown>).isDeleted !== true),
      cqa: cqa.filter((r) => (r as unknown as Record<string, unknown>).isDeleted !== true),
      risks: risks.filter((r) => (r as unknown as Record<string, unknown>).isDeleted !== true),
      cpvReviews: reviewRaw.map(normalizeReview),
      processCapability: notDeleted(capabilityRaw),
      alerts: notDeleted(alertsRaw),
      auditTrail: auditRaw,
      notifications,
      stabilityResults: notDeleted(stabilityResultsRaw),
      stabilityStudies: notDeleted(stabilityStudiesRaw),
      holdTimeRecords: notDeleted(holdTimeRaw),
      trendAnalysisRecords: notDeleted(trendAnalysisRaw),
      controlChartRecords: notDeleted(controlChartsRaw),
      rawMaterialRecords: notDeleted(rawMaterialRaw),
      packingMaterialRecords: notDeleted(packingMaterialRaw),
      utilityRecords: notDeleted(utilityRaw),
      environmentalRecords: notDeleted(environmentalRaw),
      yieldRecords: notDeleted(yieldRaw),
      openCapaCount: capaRaw.filter((r) => isOpenStatus(str(r.status))).length,
      openDeviationCount: deviationRaw.filter((r) => isOpenStatus(str(r.status))).length,
      openChangeControlCount: changeControlRaw.filter((r) => isOpenStatus(str(r.status))).length,
      truncated,
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    return {
      ...empty,
      error: (e as Error).message,
    };
  }
}

export function buildCppAlerts(cpp: CppRecord[], limit = 15): CpvAlertRow[] {
  return cpp
    .filter((r) => r.status === 'OOT' || r.status === 'OOS')
    .map((r) => toAlertRow(r as unknown as Record<string, unknown>, 'CPP', r.parameterName))
    .sort((a, b) => b.alertDate.localeCompare(a.alertDate))
    .slice(0, limit);
}

export function buildCqaAlerts(cqa: CqaRecord[], limit = 15): CpvAlertRow[] {
  return cqa
    .filter((r) => r.status === 'OOT' || r.status === 'OOS')
    .map((r) => toAlertRow(r as unknown as Record<string, unknown>, 'CQA', r.testParameter))
    .sort((a, b) => b.alertDate.localeCompare(a.alertDate))
    .slice(0, limit);
}

export function pendingCpvReviews(reviews: CpvReviewRow[]): CpvReviewRow[] {
  const pendingStatuses = ['Under Review', 'Pending Approval', 'Pending', 'In Review'];
  return reviews
    .filter((r) => pendingStatuses.some((s) => r.status.toLowerCase() === s.toLowerCase()))
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
    .slice(0, 20);
}

export function pendingApprovalCount(reviews: CpvReviewRow[]): number {
  return reviews.filter((r) =>
    ['Under Review', 'Pending Approval', 'Pending'].includes(r.status),
  ).length;
}

export function annualReviewCount(reviews: CpvReviewRow[]): number {
  return reviews.length;
}

export function averageCpkFromCapability(
  capability: Record<string, unknown>[],
  cpp: CppRecord[],
  cqa: CqaRecord[],
): { averageCp: number; averageCpk: number; averagePpk: number } {
  const cpkValues = capability
    .map((r) => num(r.cpk ?? r.Cpk))
    .filter((v) => v > 0);
  if (cpkValues.length) {
    const cpValues = capability.map((r) => num(r.cp ?? r.Cp)).filter((v) => v > 0);
    const ppkValues = capability.map((r) => num(r.ppk ?? r.Ppk)).filter((v) => v > 0);
    return {
      averageCp: cpValues.length
        ? cpValues.reduce((s, v) => s + v, 0) / cpValues.length
        : 0,
      averageCpk: cpkValues.reduce((s, v) => s + v, 0) / cpkValues.length,
      averagePpk: ppkValues.length
        ? ppkValues.reduce((s, v) => s + v, 0) / ppkValues.length
        : 0,
    };
  }
  const fallback = computeCapabilityAverages(cpp, cqa);
  return { averageCp: 0, ...fallback };
}

export function uniqueBatchNumbers(cpp: CppRecord[], cqa: CqaRecord[]): string[] {
  const set = new Set<string>();
  cpp.forEach((r) => r.batchNo && set.add(r.batchNo));
  cqa.forEach((r) => r.batchNo && set.add(r.batchNo));
  return Array.from(set).sort();
}

export async function logCpvDashboardAudit(
  actionType: 'Refresh' | 'Export' | 'Filter' | 'View' | 'Acknowledge',
  user: { id?: string; name?: string },
  detail?: string,
): Promise<void> {
  await createAuditLog({
    moduleName: 'CPV Dashboard',
    collectionName: 'cpv_dashboard',
    recordId: 'dashboard',
    actionType,
    actionDescription: `CPV Dashboard ${actionType}${detail ? ` — ${detail}` : ''}`,
    reason: detail || '',
    user: { id: user.id || 'system', name: user.name || 'User' },
    status: 'Success',
  });

  // Best-effort dual audit via same-origin proxy (avoids Cloud Run CORS preflight).
  if (shouldSkipRemoteAuditInLocalDev() || areAuditCallablesUnavailable()) return;
  if (!isFirebaseConfigured()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'recordAdminCpvDashboardAudit');
    await fn({
      actionType,
      description: `CPV Dashboard ${actionType}${detail ? ` — ${detail}` : ''}`,
      changeReason: detail || actionType,
    });
  } catch {
    // non-blocking when CF not deployed
  }
}

export function monitoringStatusStats(rows: Record<string, unknown>[]) {
  const total = rows.length;
  const oos = rows.filter((r) => ['OOS', 'Failed', 'Critical', 'Exceeded'].includes(String(r.status || ''))).length;
  const oot = rows.filter((r) => ['OOT', 'Warning', 'Alert'].includes(String(r.status || ''))).length;
  const complies = rows.filter((r) => ['Complies', 'Pass', 'Compliant', 'Within Limit', 'OK'].includes(String(r.status || ''))).length;
  return { total, oos, oot, complies };
}

export function averageYieldPercent(rows: Record<string, unknown>[]): number {
  const values = rows
    .map((r) => Number(r.yieldPercent ?? r.yield_percent ?? r.actualYield ?? r.actual_yield))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!values.length) return 0;
  return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 100) / 100;
}

export function batchStatusBreakdown(batches: Record<string, unknown>[]) {
  const norm = (s: string) => s.toLowerCase();
  return {
    total: batches.length,
    approved: batches.filter((b) => ['approved', 'released', 'closed'].includes(norm(String(b.status || b.batchStatus || '')))).length,
    rejected: batches.filter((b) => ['rejected', 'failed', 'cancelled'].includes(norm(String(b.status || b.batchStatus || '')))).length,
    running: batches.filter((b) => ['in progress', 'running', 'manufacturing', 'active'].includes(norm(String(b.status || b.batchStatus || '')))).length,
    onHold: batches.filter((b) => ['on hold', 'hold', 'quarantine'].includes(norm(String(b.status || b.batchStatus || '')))).length,
  };
}
