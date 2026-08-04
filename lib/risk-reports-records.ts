import { z } from 'zod';
import {
  REPORTS_MODULE,
  RISK_REPORT_TYPES,
  type RiskReportType,
  type RiskReportActor,
  canGenerateRiskReportsModule as canGenerateRiskReports,
  canExportRiskReportsModule as canExportRiskReports,
  canViewRegulatoryRiskReportsModule as canViewRegulatoryRiskReports,
  canViewCsvRiskReportsModule as canViewCsvRiskReports,
  canViewManagementReviewModule as canViewManagementReview,
  isRiskReportsReadOnlyModule as isRiskReportsReadOnly,
  canGenerateRiskReportTypeModule as canGenerateRiskReportType,
  canExportRiskReportTypeModule as canExportRiskReportType,
  canViewRiskReportsModule as canViewRiskReports,
} from '@/lib/risk-reports-types';

export {
  REPORTS_MODULE,
  RISK_REPORT_TYPES,
  type RiskReportType,
  type RiskReportActor,
  canGenerateRiskReports,
  canExportRiskReports,
  canViewRegulatoryRiskReports,
  canViewCsvRiskReports,
  canViewManagementReview,
  isRiskReportsReadOnly,
  canGenerateRiskReportType,
  canExportRiskReportType,
  canViewRiskReports,
};
import {
  RISK_CATEGORIES,
  RISK_LEVELS,
  RISK_STATUSES,
  EFFECTIVENESS_STATUSES,
  WORKFLOW_STATUSES,
  summarizeRiskAssessments,
  isOverdue,
  type RiskAssessmentRecord,
} from '@/lib/cpv-risk-assessment-records';
import { DMS_DEPARTMENTS } from '@/lib/dms-types';

export const RISK_REPORTS_COLLECTION = 'risk_reports';

export interface RiskReportFilterInput {
  report_type: RiskReportType;
  review_period_from: string;
  review_period_to: string;
  risk_number?: string;
  department?: string;
  product?: string;
  risk_category?: string;
  risk_level?: string;
  risk_owner?: string;
  status?: string;
  mitigation_status?: string;
  review_status?: string;
}

export interface RiskReportPreviewRow {
  risk_number: string;
  product: string;
  department: string;
  risk_category: string;
  risk_level: string;
  rpn_score: number;
  residual_rpn: number;
  risk_owner: string;
  status: string;
  mitigation_status: string;
  review_status: string;
  target_date: string;
  closure_date: string;
}

export interface RiskReportAnalyticsMetrics {
  totalRisks: number;
  openRisks: number;
  closedRisks: number;
  criticalRisks: number;
  highRisks: number;
  mediumRisks: number;
  lowRisks: number;
  residualHighRisks: number;
  mitigationPending: number;
  overdueRisks: number;
  averageRpn: number;
  riskClosureRate: number;
  mitigationCompletionRate: number;
  riskReductionPercent: number;
  criticalRiskRate: number;
}

export interface RiskReportChartData {
  riskLevelDistribution: { name: string; count: number }[];
  monthlyRiskTrend: { name: string; count: number }[];
  riskCategoryTrend: { name: string; count: number }[];
  departmentRiskTrend: { name: string; count: number }[];
  residualRiskTrend: { name: string; count: number }[];
  mitigationTrend: { name: string; count: number }[];
  riskClosureTrend: { name: string; closed: number; open: number }[];
  criticalRiskTrend: { name: string; count: number }[];
  fmeaTrend: { name: string; count: number }[];
  riskReductionTrend: { name: string; reduction: number }[];
}

export interface RiskManagementReviewSummary {
  totalRisksIdentified: number;
  totalRisksClosed: number;
  criticalRisks: number;
  residualHighRisks: number;
  topRiskCategories: { name: string; count: number }[];
  topDepartments: { name: string; count: number }[];
  riskReductionPercent: number;
  improvementOpportunities: string[];
  recommendedActions: string[];
  narrative: string;
}

export interface RiskReportAnalyticsResult {
  metrics: RiskReportAnalyticsMetrics;
  charts: RiskReportChartData;
  previewRows: RiskReportPreviewRow[];
  summary: string;
  recommendations: string;
  managementReview: RiskManagementReviewSummary;
  filtered_count: number;
}

export interface RiskReportRecord {
  id?: string;
  report_id: string;
  report_name: string;
  report_number: string;
  report_type: RiskReportType;
  review_period_from: string;
  review_period_to: string;
  department: string;
  product: string;
  risk_category: string;
  risk_level: string;
  risk_owner: string;
  status_filter: string;
  mitigation_status: string;
  review_status: string;
  risk_number: string;
  generated_by: string;
  generated_by_name: string;
  generated_at: string;
  total_records: number;
  export_type?: string;
  file_url?: string;
  file_name?: string;
  report_status: string;
  preview_rows: RiskReportPreviewRow[];
  chart_snapshot: RiskReportChartData;
  metrics_snapshot: RiskReportAnalyticsMetrics;
  summary: string;
  recommendations: string;
  management_review: RiskManagementReviewSummary;
  filters: RiskReportFilterInput;
  scheduled?: boolean;
  schedule_frequency?: string;
  schedule_next_run?: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

const requiredDate = z.string().trim().min(1, 'Date range is required');
const requiredType = z.enum(RISK_REPORT_TYPES, { required_error: 'Report type is required' });

export const riskReportFormSchema = z.object({
  report_type: requiredType,
  review_period_from: requiredDate,
  review_period_to: requiredDate,
  risk_number: z.string().default(''),
  department: z.string().default('All'),
  product: z.string().default('All'),
  risk_category: z.string().default('All'),
  risk_level: z.string().default('All'),
  risk_owner: z.string().default('All'),
  status: z.string().default('All'),
  mitigation_status: z.string().default('All'),
  review_status: z.string().default('All'),
}).refine((d) => {
  const from = new Date(d.review_period_from);
  const to = new Date(d.review_period_to);
  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to > from;
}, { message: 'Review period end must be after start', path: ['review_period_to'] });

export type RiskReportFormData = z.infer<typeof riskReportFormSchema>;

export const RISK_REPORT_FILTER_OPTIONS = {
  departments: ['All', ...DMS_DEPARTMENTS],
  categories: ['All', ...RISK_CATEGORIES],
  levels: ['All', ...RISK_LEVELS],
  statuses: ['All', ...RISK_STATUSES],
  mitigationStatuses: ['All', 'Pending', 'In Progress', 'Completed'],
  reviewStatuses: ['All', ...WORKFLOW_STATUSES],
  effectiveness: ['All', ...EFFECTIVENESS_STATUSES],
};

export const RISK_PREVIEW_COLUMNS = [
  { key: 'risk_number', header: 'Risk No' },
  { key: 'product', header: 'Product' },
  { key: 'department', header: 'Department' },
  { key: 'risk_category', header: 'Category' },
  { key: 'risk_level', header: 'Level' },
  { key: 'rpn_score', header: 'RPN' },
  { key: 'residual_rpn', header: 'Residual RPN' },
  { key: 'risk_owner', header: 'Owner' },
  { key: 'status', header: 'Status' },
  { key: 'mitigation_status', header: 'Mitigation' },
  { key: 'target_date', header: 'Target Date' },
] as const;

export function inferRiskDepartment(r: RiskAssessmentRecord): string {
  const cat = (r.riskCategory || '').toLowerCase();
  if (cat.includes('cpp') || cat.includes('process') || cat.includes('yield')) return 'Production';
  if (cat.includes('cqa') || cat.includes('raw material') || cat.includes('microbiology')) return 'QC';
  if (cat.includes('regulatory')) return 'Regulatory';
  if (cat.includes('environmental') || cat.includes('utility') || cat.includes('equipment')) return 'Engineering';
  if (cat.includes('vendor') || cat.includes('packing')) return 'Warehouse';
  if (cat.includes('stability')) return 'PQR';
  return 'QA';
}

export function estimateResidualRpn(r: RiskAssessmentRecord): number {
  const raw = r as Record<string, unknown>;
  const stored = raw.residualRpn ?? raw.residual_rpn;
  if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored;
  if (r.effectivenessStatus === 'Effective') return Math.max(1, Math.round(getSafeRpnFromRecord(r) * 0.25));
  if (r.effectivenessStatus === 'Partially Effective') return Math.max(1, Math.round(getSafeRpnFromRecord(r) * 0.5));
  if (['Closed', 'Accepted'].includes(r.riskStatus)) return Math.max(1, Math.round(getSafeRpnFromRecord(r) * 0.35));
  return getSafeRpnFromRecord(r);
}

function getSafeRpnFromRecord(r: RiskAssessmentRecord): number {
  const n = Number(r.rpnScore);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function getMitigationStatus(r: RiskAssessmentRecord): string {
  const controls = r.controls || [];
  if (!controls.length) {
    if (r.mitigationAction?.trim()) return 'In Progress';
    return 'Pending';
  }
  if (controls.every((c) => c.status === 'Completed' || c.status === 'Closed')) return 'Completed';
  if (controls.some((c) => c.status === 'In Progress')) return 'In Progress';
  return 'Pending';
}

export function getReviewStatus(r: RiskAssessmentRecord): string {
  return r.workflowStatus || r.riskStatus || 'Draft';
}

export function isPatientSafetyRisk(r: RiskAssessmentRecord): boolean {
  const text = `${r.riskDescription} ${r.potentialImpact} ${r.riskCategory}`.toLowerCase();
  return text.includes('patient') || text.includes('safety') || text.includes('sterility')
    || text.includes('endotoxin') || r.severityScore >= 9;
}

export function isRegulatoryRisk(r: RiskAssessmentRecord): boolean {
  return r.riskCategory === 'Regulatory Risk'
    || Boolean(r.linkedChangeControlNumber)
    || (r.riskSource || '').includes('Deviation');
}

export function isCsvDataIntegrityRisk(r: RiskAssessmentRecord): boolean {
  const cat = (r.riskCategory || '').toLowerCase();
  const src = (r.riskSource || '').toLowerCase();
  return cat.includes('csv') || src.includes('csv') || cat.includes('data integrity')
    || (r.parameterType || '').toLowerCase().includes('csv');
}

export function isFmeaRisk(r: RiskAssessmentRecord): boolean {
  return Boolean(r.potentialCause) && r.severityScore > 0 && r.occurrenceScore > 0;
}

function inPeriod(dateStr: string | undefined, from: string, to: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const f = new Date(from);
  const t = new Date(`${to}T23:59:59`);
  if (Number.isNaN(d.getTime())) return false;
  return d >= f && d <= t;
}

export function buildRiskReportId(reportType: string): string {
  const code = reportType.replace(/[^A-Z]/gi, '').slice(0, 6).toUpperCase() || 'RISK';
  return `RISK-RPT-${code}-${Date.now().toString(36).toUpperCase()}`;
}

export function generateRiskReportNumber(year: number, existingCount: number): string {
  return `RISK-RPT/${year}/${String(existingCount + 1).padStart(4, '0')}`;
}

export function filterByRiskReportType(records: RiskAssessmentRecord[], reportType: RiskReportType): RiskAssessmentRecord[] {
  switch (reportType) {
    case 'Open Risk Report':
      return records.filter((r) => !['Closed', 'Accepted', 'Rejected'].includes(r.riskStatus));
    case 'Closed Risk Report':
      return records.filter((r) => ['Closed', 'Accepted'].includes(r.riskStatus));
    case 'Critical Risk Report':
      return records.filter((r) => r.riskLevel === 'Critical');
    case 'Residual Risk Report':
      return records.filter((r) => estimateResidualRpn(r) >= 51 || r.effectivenessStatus !== 'Pending');
    case 'FMEA Report':
      return records.filter(isFmeaRisk);
    case 'Risk Mitigation Report':
      return records.filter((r) => getMitigationStatus(r) !== 'Pending' || Boolean(r.mitigationAction));
    case 'Overdue Risk Report':
      return records.filter(isOverdue);
    case 'Regulatory Risk Report':
      return records.filter(isRegulatoryRisk);
    case 'CSV/Data Integrity Risk Report':
      return records.filter(isCsvDataIntegrityRisk);
    case 'Patient Safety Risk Report':
      return records.filter(isPatientSafetyRisk);
    case 'Department-wise Risk Report':
    case 'Product-wise Risk Report':
    case 'Risk Trend Report':
    case 'Management Review Report':
    case 'Risk Register Report':
    default:
      return records.filter((r) => !r.isDeleted);
  }
}

export function applyRiskReportFilters(records: RiskAssessmentRecord[], filters: RiskReportFilterInput): RiskAssessmentRecord[] {
  let results = filterByRiskReportType(records, filters.report_type);
  results = results.filter((r) =>
    inPeriod(r.createdAt || r.updatedAt, filters.review_period_from, filters.review_period_to),
  );
  if (filters.risk_number?.trim()) {
    const q = filters.risk_number.trim().toLowerCase();
    results = results.filter((r) => r.riskNumber.toLowerCase().includes(q));
  }
  if (filters.department && filters.department !== 'All') {
    results = results.filter((r) => inferRiskDepartment(r) === filters.department);
  }
  if (filters.product && filters.product !== 'All') {
    results = results.filter((r) => r.productName === filters.product);
  }
  if (filters.risk_category && filters.risk_category !== 'All') {
    results = results.filter((r) => r.riskCategory === filters.risk_category);
  }
  if (filters.risk_level && filters.risk_level !== 'All') {
    results = results.filter((r) => r.riskLevel === filters.risk_level);
  }
  if (filters.risk_owner && filters.risk_owner !== 'All') {
    results = results.filter((r) => r.riskOwner === filters.risk_owner);
  }
  if (filters.status && filters.status !== 'All') {
    results = results.filter((r) => r.riskStatus === filters.status);
  }
  if (filters.mitigation_status && filters.mitigation_status !== 'All') {
    results = results.filter((r) => getMitigationStatus(r) === filters.mitigation_status);
  }
  if (filters.review_status && filters.review_status !== 'All') {
    results = results.filter((r) => getReviewStatus(r) === filters.review_status);
  }
  return results;
}

export function computeRiskReportMetrics(records: RiskAssessmentRecord[]): RiskReportAnalyticsMetrics {
  const summary = summarizeRiskAssessments(records);
  const total = summary.total || 0;
  const closed = summary.closed || 0;
  const mitigations = records.map(getMitigationStatus);
  const completedMit = mitigations.filter((s) => s === 'Completed').length;
  const residualHigh = records.filter((r) => {
    const residual = estimateResidualRpn(r);
    return residual >= 101;
  }).length;
  const avgRpn = total > 0
    ? Math.round(records.reduce((s, r) => s + getSafeRpnFromRecord(r), 0) / total)
    : 0;
  const reductions = records
    .filter((r) => r.rpnScore > 0)
    .map((r) => ((r.rpnScore - estimateResidualRpn(r)) / r.rpnScore) * 100);
  const riskReductionPercent = reductions.length
    ? Math.round(reductions.reduce((a, b) => a + b, 0) / reductions.length)
    : 0;

  return {
    totalRisks: total,
    openRisks: summary.open,
    closedRisks: closed,
    criticalRisks: summary.critical,
    highRisks: summary.high,
    mediumRisks: summary.medium,
    lowRisks: summary.low,
    residualHighRisks: residualHigh,
    mitigationPending: mitigations.filter((s) => s === 'Pending').length,
    overdueRisks: summary.overdue,
    averageRpn: avgRpn,
    riskClosureRate: total > 0 ? Math.round((closed / total) * 100) : 0,
    mitigationCompletionRate: mitigations.length > 0 ? Math.round((completedMit / mitigations.length) * 100) : 0,
    riskReductionPercent,
    criticalRiskRate: total > 0 ? Math.round((summary.critical / total) * 100) : 0,
  };
}

function countBy<T>(records: T[], keyFn: (r: T) => string, limit = 10) {
  const map = new Map<string, number>();
  for (const r of records) {
    const k = keyFn(r) || 'Unknown';
    map.set(k, (map.get(k) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function monthlyCount(records: RiskAssessmentRecord[], predicate?: (r: RiskAssessmentRecord) => boolean) {
  const map = new Map<string, number>();
  for (const r of records) {
    if (predicate && !predicate(r)) continue;
    const month = (r.createdAt || '').slice(0, 7);
    if (!month) continue;
    map.set(month, (map.get(month) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function buildRiskReportCharts(records: RiskAssessmentRecord[]): RiskReportChartData {
  const base = summarizeRiskAssessments(records);
  return {
    riskLevelDistribution: ['Critical', 'High', 'Medium', 'Low'].map((name) => ({
      name,
      count: name === 'Critical' ? base.critical
        : name === 'High' ? base.high
          : name === 'Medium' ? base.medium
            : base.low,
    })),
    monthlyRiskTrend: monthlyCount(records),
    riskCategoryTrend: countBy(records, (r) => r.riskCategory),
    departmentRiskTrend: countBy(records, inferRiskDepartment),
    residualRiskTrend: monthlyCount(records, (r) => estimateResidualRpn(r) < r.rpnScore),
    mitigationTrend: monthlyCount(records, (r) => getMitigationStatus(r) !== 'Pending'),
    riskClosureTrend: (() => {
      const map = new Map<string, { closed: number; open: number }>();
      for (const r of records) {
        const month = (r.createdAt || '').slice(0, 7);
        if (!month) continue;
        const cur = map.get(month) || { closed: 0, open: 0 };
        if (['Closed', 'Accepted'].includes(r.riskStatus)) cur.closed++;
        else cur.open++;
        map.set(month, cur);
      }
      return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, v]) => ({ name, ...v }));
    })(),
    criticalRiskTrend: monthlyCount(records, (r) => r.riskLevel === 'Critical'),
    fmeaTrend: monthlyCount(records, isFmeaRisk),
    riskReductionTrend: monthlyCount(records).map((m) => {
      const monthRecords = records.filter((r) => (r.createdAt || '').startsWith(m.name));
      const reductions = monthRecords
        .filter((r) => r.rpnScore > 0)
        .map((r) => Math.round(((r.rpnScore - estimateResidualRpn(r)) / r.rpnScore) * 100));
      return {
        name: m.name,
        reduction: reductions.length ? Math.round(reductions.reduce((a, b) => a + b, 0) / reductions.length) : 0,
      };
    }),
  };
}

export function toRiskPreviewRow(r: RiskAssessmentRecord): RiskReportPreviewRow {
  return {
    risk_number: r.riskNumber,
    product: r.productName || '—',
    department: inferRiskDepartment(r),
    risk_category: r.riskCategory,
    risk_level: r.riskLevel,
    rpn_score: r.rpnScore,
    residual_rpn: estimateResidualRpn(r),
    risk_owner: r.riskOwner || '—',
    status: r.riskStatus,
    mitigation_status: getMitigationStatus(r),
    review_status: getReviewStatus(r),
    target_date: r.targetCompletionDate || '—',
    closure_date: ['Closed', 'Accepted'].includes(r.riskStatus) ? (r.updatedAt?.split('T')[0] || '—') : '—',
  };
}

export function buildManagementReviewSummary(records: RiskAssessmentRecord[]): RiskManagementReviewSummary {
  const metrics = computeRiskReportMetrics(records);
  const topRiskCategories = countBy(records, (r) => r.riskCategory, 5);
  const topDepartments = countBy(records, inferRiskDepartment, 5);
  const improvementOpportunities: string[] = [];
  if (metrics.overdueRisks > 0) improvementOpportunities.push(`Address ${metrics.overdueRisks} overdue risk assessment(s).`);
  if (metrics.residualHighRisks > 0) improvementOpportunities.push(`Review ${metrics.residualHighRisks} residual high-risk item(s).`);
  if (metrics.mitigationPending > 0) improvementOpportunities.push(`Complete ${metrics.mitigationPending} pending mitigation(s).`);
  if (metrics.riskClosureRate < 80 && metrics.totalRisks > 0) {
    improvementOpportunities.push('Improve risk closure rate above 80%.');
  }
  if (!improvementOpportunities.length) improvementOpportunities.push('Maintain ICH Q9 risk management program effectiveness.');

  const recommendedActions = [
    ...improvementOpportunities,
    metrics.criticalRisks > 0 ? `Escalate ${metrics.criticalRisks} critical risk(s) to management review.` : '',
    metrics.riskReductionPercent < 30 ? 'Strengthen mitigation controls to improve risk reduction.' : '',
  ].filter(Boolean);

  return {
    totalRisksIdentified: metrics.totalRisks,
    totalRisksClosed: metrics.closedRisks,
    criticalRisks: metrics.criticalRisks,
    residualHighRisks: metrics.residualHighRisks,
    topRiskCategories,
    topDepartments,
    riskReductionPercent: metrics.riskReductionPercent,
    improvementOpportunities,
    recommendedActions,
    narrative: `Management review: ${metrics.totalRisks} risks identified, ${metrics.closedRisks} closed `
      + `(${metrics.riskClosureRate}% closure rate). Critical: ${metrics.criticalRisks} `
      + `(${metrics.criticalRiskRate}%). Average RPN: ${metrics.averageRpn}. Risk reduction: ${metrics.riskReductionPercent}%.`,
  };
}

export function buildRiskReportSummary(filters: RiskReportFilterInput, metrics: RiskReportAnalyticsMetrics, count: number): string {
  return `${filters.report_type} for ${filters.review_period_from} to ${filters.review_period_to}: `
    + `${count} risk record(s). Open: ${metrics.openRisks}, Closed: ${metrics.closedRisks}, `
    + `Critical: ${metrics.criticalRisks}, Overdue: ${metrics.overdueRisks}. `
    + `Closure rate: ${metrics.riskClosureRate}%, Avg RPN: ${metrics.averageRpn}, Risk reduction: ${metrics.riskReductionPercent}%.`;
}

export function buildRiskReportRecommendations(metrics: RiskReportAnalyticsMetrics, mgmt: RiskManagementReviewSummary): string {
  return mgmt.recommendedActions.map((t, i) => `${i + 1}. ${t}`).join('\n')
    || 'Continue routine ICH Q9 risk monitoring and periodic management review.';
}

export function computeRiskReportAnalytics(
  allRecords: RiskAssessmentRecord[],
  filters: RiskReportFilterInput,
): RiskReportAnalyticsResult {
  const filtered = applyRiskReportFilters(allRecords, filters);
  const metrics = computeRiskReportMetrics(filtered);
  const charts = buildRiskReportCharts(filtered);
  const previewRows = filtered.map(toRiskPreviewRow);
  const managementReview = buildManagementReviewSummary(filtered);
  return {
    metrics,
    charts,
    previewRows,
    summary: buildRiskReportSummary(filters, metrics, filtered.length),
    recommendations: buildRiskReportRecommendations(metrics, managementReview),
    managementReview,
    filtered_count: filtered.length,
  };
}

export function mapRiskReportToRecord(
  form: RiskReportFormData,
  analytics: RiskReportAnalyticsResult,
  actor: RiskReportActor,
  reportNumber: string,
): Omit<RiskReportRecord, 'id'> {
  const now = new Date().toISOString();
  const filters: RiskReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    risk_number: form.risk_number,
    department: form.department,
    product: form.product,
    risk_category: form.risk_category,
    risk_level: form.risk_level,
    risk_owner: form.risk_owner,
    status: form.status,
    mitigation_status: form.mitigation_status,
    review_status: form.review_status,
  };
  return {
    report_id: buildRiskReportId(form.report_type),
    report_name: form.report_type,
    report_number: reportNumber,
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    department: form.department || 'All',
    product: form.product || 'All',
    risk_category: form.risk_category || 'All',
    risk_level: form.risk_level || 'All',
    risk_owner: form.risk_owner || 'All',
    status_filter: form.status || 'All',
    mitigation_status: form.mitigation_status || 'All',
    review_status: form.review_status || 'All',
    risk_number: form.risk_number || '',
    generated_by: actor.id,
    generated_by_name: actor.name,
    generated_at: now,
    total_records: analytics.filtered_count,
    report_status: 'Generated',
    preview_rows: analytics.previewRows.slice(0, 100),
    chart_snapshot: analytics.charts,
    metrics_snapshot: analytics.metrics,
    summary: analytics.summary,
    recommendations: analytics.recommendations,
    management_review: analytics.managementReview,
    filters,
    created_at: now,
    updated_at: now,
    is_deleted: false,
  };
}

export function summarizeRiskReportsDashboard(records: RiskAssessmentRecord[]) {
  const metrics = computeRiskReportMetrics(records);
  const charts = buildRiskReportCharts(records);
  const managementReview = buildManagementReviewSummary(records);
  return { metrics, charts, managementReview };
}

export function extractRiskProductOptions(records: RiskAssessmentRecord[]): string[] {
  return ['All', ...Array.from(new Set(records.map((r) => r.productName).filter(Boolean))).sort()];
}

export function extractRiskOwnerOptions(records: RiskAssessmentRecord[]): string[] {
  return ['All', ...Array.from(new Set(records.map((r) => r.riskOwner).filter(Boolean))).sort()];
}

export function exportRiskReportCsv(rows: RiskReportPreviewRow[]): { headers: string[]; rows: string[][] } {
  const headers = RISK_PREVIEW_COLUMNS.map((c) => c.header);
  const data = rows.map((r) => RISK_PREVIEW_COLUMNS.map((c) => String(r[c.key as keyof RiskReportPreviewRow] ?? '')));
  return { headers, rows: data };
}

export function reportStatusColor(status: string): string {
  const map: Record<string, string> = {
    Generated: 'bg-blue-100 text-blue-800',
    Exported: 'bg-green-100 text-green-800',
    Scheduled: 'bg-amber-100 text-amber-800',
    Draft: 'bg-slate-100 text-slate-700',
  };
  return map[status] || 'bg-slate-100 text-slate-700';
}

