import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';

export const PQR_DASHBOARD_MODULE = 'PQR Dashboard';

export const PQR_DASHBOARD_COLLECTIONS = {
  records: 'pqr_records',
  recordsLegacy: 'pqr_documents',
  reviews: 'pqr_reviews',
  approvals: 'pqr_approvals',
  sections: 'pqr_sections',
  batchReview: 'pqr_batch_review',
  materialReview: 'pqr_material_review',
  packagingReview: 'pqr_packaging_review',
  equipmentReview: 'pqr_equipment_review',
  utilityReview: 'pqr_utility_environmental_review',
  stabilityReview: 'pqr_stability_review',
  summaryConclusion: 'pqr_summary_conclusion',
  products: 'products',
  batches: 'batches',
  cpvBatches: 'cpv_batches',
  cppResults: 'cpp_results',
  cqaResults: 'cqa_results',
  yieldMonitoring: 'yield_monitoring',
  stabilityMonitoring: 'stability_monitoring',
  deviations: 'deviations',
  oosRecords: 'oos_records',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
  complaints: 'complaints',
  recalls: 'recalls',
  validationRecords: 'validation_records',
  riskAssessment: 'risk_assessment',
  processCapability: 'process_capability',
} as const;

/** Full PQR lifecycle statuses (display). */
export const PQR_STATUSES = [
  'Draft',
  'In Progress',
  'Data Collection',
  'Under Review',
  'QA Review',
  'Approval Pending',
  'Approved',
  'Closed',
  'Rejected',
  'Returned for Correction',
  'Cancelled',
  'Archived',
] as const;

export const PQR_FILTER_STATUSES = [
  'Draft',
  'In Progress',
  'Data Collection',
  'Under Review',
  'QA Review',
  'Approval Pending',
  'Approved',
  'Closed',
  'Rejected',
  'Returned for Correction',
  'Cancelled',
  'Archived',
] as const;

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export type PqrStatus = (typeof PQR_STATUSES)[number];

/** Valid forward (and corrective) status transitions. */
export const PQR_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  Draft: ['In Progress', 'Data Collection', 'Under Review', 'Cancelled'],
  'In Progress': ['Data Collection', 'Under Review', 'Returned for Correction', 'Cancelled'],
  'Data Collection': ['In Progress', 'Under Review', 'Cancelled'],
  'Under Review': ['QA Review', 'Approval Pending', 'Approved', 'Returned for Correction', 'Rejected', 'Cancelled', 'Draft'],
  'QA Review': ['Approval Pending', 'Approved', 'Returned for Correction', 'Rejected', 'Cancelled', 'Draft', 'Under Review'],
  'Approval Pending': ['Approved', 'Rejected', 'Returned for Correction', 'Cancelled', 'Under Review', 'Draft'],
  Approved: ['Closed', 'Archived', 'Under Review'],
  Closed: ['Archived', 'Under Review'],
  Rejected: ['Returned for Correction', 'Cancelled', 'Archived', 'Draft', 'Under Review'],
  'Returned for Correction': ['In Progress', 'Data Collection', 'Under Review', 'Draft', 'Cancelled'],
  Cancelled: ['Archived', 'Draft'],
  Archived: [],
};

export function canTransitionPqrStatus(from: string, to: string): boolean {
  const f = normalizePqrStatus(from);
  const t = normalizePqrStatus(to);
  if (f === t) return true;
  const allowed = PQR_STATUS_TRANSITIONS[f] || [];
  return allowed.includes(t);
}

export const COMPLETION_SECTIONS = [
  { key: 'batchReview', label: 'Batch Review', href: '/pqr/batches', retainPqrId: true },
  { key: 'materialReview', label: 'Material Review', href: '/pqr/materials', retainPqrId: true },
  { key: 'packagingReview', label: 'Packaging Review', href: '/pqr/packaging', retainPqrId: true },
  { key: 'equipmentReview', label: 'Equipment Review', href: '/pqr/equipment-review', retainPqrId: true },
  { key: 'utilityReview', label: 'Utility & Environmental Review', href: '/pqr/utility-review', retainPqrId: true },
  { key: 'stabilityReview', label: 'Stability Review', href: '/pqr/stability', retainPqrId: true },
  { key: 'deviationReview', label: 'Deviation Review', href: '/qms/deviation', retainPqrId: false },
  { key: 'oosReview', label: 'OOS/OOT Review', href: '/qms/oos', retainPqrId: false },
  { key: 'capaReview', label: 'CAPA Review', href: '/qms/capa', retainPqrId: false },
  { key: 'changeControlReview', label: 'Change Control Review', href: '/qms/change-control', retainPqrId: false },
  { key: 'complaintReview', label: 'Complaint Review', href: '/qms/complaints', retainPqrId: false },
  { key: 'cpvReview', label: 'CPV Review', href: '/cpv/dashboard', retainPqrId: false },
  { key: 'riskReview', label: 'Risk Review', href: '/qms/risk-management', retainPqrId: false },
  { key: 'summaryConclusion', label: 'Summary & Conclusion', href: '/pqr/summary', retainPqrId: true },
  { key: 'approval', label: 'Approval', href: '/pqr/approval', retainPqrId: true },
] as const;

export function completionSectionHref(href: string, pqrId?: string, retainPqrId = true): string {
  if (!pqrId || !retainPqrId) return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}pqrId=${encodeURIComponent(pqrId)}`;
}

export type CompletionSectionKey = (typeof COMPLETION_SECTIONS)[number]['key'];
export type CompletionSectionStatus = 'Completed' | 'Pending' | 'Not Applicable' | 'Overdue';

export interface PqrDashboardFilters {
  product?: string;
  productCode?: string;
  reviewYear?: string;
  reviewPeriod?: string;
  status?: string;
  preparedBy?: string;
  pendingWith?: string;
  site?: string;
  department?: string;
  riskLevel?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  overdueOnly?: boolean;
  pendingApprovalOnly?: boolean;
  batchNumber?: string;
}

export interface PqrDashboardKpis {
  totalPqrs: number;
  currentYearPqrs: number;
  previousYearPqrs: number;
  draftPqrs: number;
  inProgressPqrs: number;
  underReviewPqrs: number;
  approvalPendingPqrs: number;
  approvedPqrs: number;
  rejectedPqrs: number;
  closedPqrs: number;
  archivedPqrs: number;
  pqrsDueThisMonth: number;
  overduePqrs: number;
  completionPct: number;
  pendingReviews: number;
  pendingApprovals: number;
  criticalFindings: number;
  openActions: number;
  totalProductsReviewed: number;
  totalBatchesReviewed: number;
  releasedBatches: number;
  rejectedBatches: number;
  deviationCount: number;
  oosCount: number;
  ootCount: number;
  capaCount: number;
  changeControlCount: number;
  marketComplaintCount: number;
  recallCount: number;
  averageYieldPct: number;
  averageAssayPct: number;
  averageCpk: number;
  openRisks: number;
}

export interface PqrRecordRow {
  id: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  reviewPeriod: string;
  status: string;
  preparedBy: string;
  pendingWith: string;
  qaReviewer: string;
  qaApprover: string;
  createdDate: string;
  dueDate?: string;
  reviewYear?: number;
  site?: string;
  department?: string;
  riskLevel?: string;
  workflowStage?: string;
  completionPct?: number;
  version?: string;
}

export interface PqrDueRow {
  id: string;
  product: string;
  reviewYear: number;
  dueDate: string;
  daysOverdue: number;
  owner: string;
  status: string;
}

export interface PqrPendingApprovalRow {
  id: string;
  pqrNumber: string;
  product: string;
  currentStep: string;
  pendingWith: string;
  dueDate: string;
  priority: string;
  pqrId?: string;
}

export interface PqrCriticalAlertRow {
  id: string;
  product: string;
  batchNo: string;
  source: string;
  issue: string;
  riskLevel: string;
  status: string;
  href?: string;
}

export interface PqrActivityEntry {
  action: string;
  user: string;
  at: string;
  detail?: string;
}

export interface PqrCompletionSectionRow {
  key: string;
  label: string;
  href: string;
  status: CompletionSectionStatus;
  count: number;
}

export interface PqrCompletionRow {
  id: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  status: string;
  completionPct: number;
  sections: PqrCompletionSectionRow[];
}

export interface PqrProductAnalysisRow {
  id: string;
  product: string;
  productCode: string;
  pqrCount: number;
  batchCount: number;
  deviationCount: number;
  oosCount: number;
  ootCount: number;
  capaCount: number;
  complaintCount: number;
  changeControlCount: number;
  stabilityIssues: number;
  statuses: string;
}

export interface PqrActionItemRow {
  id: string;
  description: string;
  owner: string;
  dueDate: string;
  priority: string;
  status: string;
  source: string;
  href?: string;
}

export interface PqrFindingRow {
  id: string;
  severity: 'Critical' | 'Major' | 'Minor';
  category: string;
  description: string;
  product: string;
  count: number;
  href?: string;
}

export interface PqrDashboardCharts {
  statusDistribution: Array<{ name: string; value: number }>;
  monthlyCreationTrend: Array<{ month: string; value: number }>;
  productStatus: Array<{ product: string; draft: number; review: number; approved: number }>;
  batchReleaseTrend: Array<{ month: string; released: number; rejected: number }>;
  qualityTrend: Array<{ month: string; deviations: number; oos: number; capa: number }>;
  yieldTrend: Array<{ month: string; value: number }>;
  assayTrend: Array<{ month: string; value: number }>;
  stabilityTrend: Array<{ month: string; value: number }>;
  complaintRecallTrend: Array<{ month: string; complaints: number; recalls: number }>;
  approvalPendingTrend: Array<{ month: string; value: number }>;
  completionTrend: Array<{ month: string; value: number }>;
  overdueTrend: Array<{ month: string; value: number }>;
}

export interface PqrDashboardData {
  kpis: PqrDashboardKpis;
  charts: PqrDashboardCharts;
  recentPqrs: PqrRecordRow[];
  duePqrs: PqrDueRow[];
  pendingApprovals: PqrPendingApprovalRow[];
  criticalAlerts: PqrCriticalAlertRow[];
  activity: PqrActivityEntry[];
  completionRows: PqrCompletionRow[];
  productAnalysis: PqrProductAnalysisRow[];
  actionItems: PqrActionItemRow[];
  findings: PqrFindingRow[];
  filterOptions: {
    products: string[];
    years: string[];
    sites: string[];
    departments: string[];
    owners: string[];
  };
  generatedAt: string;
  error?: string;
}

export function normalizePqrStatus(raw?: string): PqrStatus | string {
  const s = String(raw || 'Draft').toLowerCase().replace(/_/g, ' ').trim();
  if (s === 'draft') return 'Draft';
  if (s === 'in progress' || s === 'inprogress' || s === 'generated') return 'In Progress';
  if (s === 'data collection' || s === 'datacollection') return 'Data Collection';
  if (s === 'under review' || s === 'in review') return 'Under Review';
  if (s === 'qa review' || s === 'qareview') return 'QA Review';
  if (s === 'approval pending' || s === 'pending approval' || s === 'pending') return 'Approval Pending';
  if (s === 'approved') return 'Approved';
  if (s === 'closed' || s === 'complete' || s === 'completed') return 'Closed';
  if (s === 'rejected') return 'Rejected';
  if (s === 'returned for correction' || s === 'returned' || s === 'rework') return 'Returned for Correction';
  if (s === 'cancelled' || s === 'canceled') return 'Cancelled';
  if (s === 'archived') return 'Archived';
  return raw || 'Draft';
}

export function isTerminalPqrStatus(status: string): boolean {
  return ['Approved', 'Closed', 'Cancelled', 'Archived'].includes(normalizePqrStatus(status));
}

export function isOpenPqrStatus(status: string): boolean {
  return !isTerminalPqrStatus(status) && normalizePqrStatus(status) !== 'Rejected';
}

export function statusColor(status: string): string {
  const s = normalizePqrStatus(status);
  if (s === 'Draft') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (s === 'In Progress' || s === 'Data Collection') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (s === 'Under Review' || s === 'QA Review') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (s === 'Approval Pending') return 'bg-orange-50 text-orange-800 border-orange-200';
  if (s === 'Approved' || s === 'Closed') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'Rejected' || s === 'Cancelled') return 'bg-red-50 text-red-700 border-red-200';
  if (s === 'Returned for Correction') return 'bg-purple-50 text-purple-700 border-purple-200';
  if (s === 'Archived') return 'bg-slate-50 text-slate-600 border-slate-300';
  if (s === 'Overdue') return 'bg-red-50 text-red-800 border-red-300';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export function riskColor(level: string): string {
  if (level === 'Critical') return 'bg-red-900/10 text-red-900 border-red-300';
  if (level === 'High') return 'bg-red-50 text-red-700 border-red-200';
  if (level === 'Medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-green-50 text-green-700 border-green-200';
}

export function completionStatusColor(status: CompletionSectionStatus): string {
  if (status === 'Completed') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Overdue') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Not Applicable') return 'bg-slate-50 text-slate-500 border-slate-200';
  return 'bg-amber-50 text-amber-800 border-amber-200';
}

const DASHBOARD_VIEW_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'qc_manager', 'qc_executive',
  'production_manager', 'production_executive',
  'warehouse_manager', 'warehouse_executive',
  'engineering_manager', 'engineering_executive',
  'regulatory_affairs', 'department_head', 'auditor', 'viewer', 'management',
]);

export function canViewPqrDashboard(role?: string): boolean {
  return DASHBOARD_VIEW_ROLES.has(normalizeRole(role));
}

export function canExportPqrDashboard(role?: string): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'auditor'].includes(normalizeRole(role));
}

export function isPqrDashboardViewOnly(role?: string): boolean {
  return ['auditor', 'viewer'].includes(normalizeRole(role));
}

export const emptyKpis = (): PqrDashboardKpis => ({
  totalPqrs: 0,
  currentYearPqrs: 0,
  previousYearPqrs: 0,
  draftPqrs: 0,
  inProgressPqrs: 0,
  underReviewPqrs: 0,
  approvalPendingPqrs: 0,
  approvedPqrs: 0,
  rejectedPqrs: 0,
  closedPqrs: 0,
  archivedPqrs: 0,
  pqrsDueThisMonth: 0,
  overduePqrs: 0,
  completionPct: 0,
  pendingReviews: 0,
  pendingApprovals: 0,
  criticalFindings: 0,
  openActions: 0,
  totalProductsReviewed: 0,
  totalBatchesReviewed: 0,
  releasedBatches: 0,
  rejectedBatches: 0,
  deviationCount: 0,
  oosCount: 0,
  ootCount: 0,
  capaCount: 0,
  changeControlCount: 0,
  marketComplaintCount: 0,
  recallCount: 0,
  averageYieldPct: 0,
  averageAssayPct: 0,
  averageCpk: 0,
  openRisks: 0,
});

export const emptyCharts = (): PqrDashboardCharts => ({
  statusDistribution: [],
  monthlyCreationTrend: [],
  productStatus: [],
  batchReleaseTrend: [],
  qualityTrend: [],
  yieldTrend: [],
  assayTrend: [],
  stabilityTrend: [],
  complaintRecallTrend: [],
  approvalPendingTrend: [],
  completionTrend: [],
  overdueTrend: [],
});

export const emptyDashboardData = (error?: string): PqrDashboardData => ({
  kpis: emptyKpis(),
  charts: emptyCharts(),
  recentPqrs: [],
  duePqrs: [],
  pendingApprovals: [],
  criticalAlerts: [],
  activity: [],
  completionRows: [],
  productAnalysis: [],
  actionItems: [],
  findings: [],
  filterOptions: { products: [], years: [], sites: [], departments: [], owners: [] },
  generatedAt: new Date().toISOString(),
  error,
});

export function exportPqrDashboardCsv(data: PqrDashboardData): { headers: string[]; rows: string[][] } {
  const headers = [
    'PQR Number', 'Product', 'Product Code', 'Review Period', 'Year', 'Status',
    'Prepared By', 'Pending With', 'Created', 'Due Date', 'Completion %', 'Site',
  ];
  const rows = data.recentPqrs.map((r) => [
    r.pqrNumber,
    r.product,
    r.productCode,
    r.reviewPeriod,
    String(r.reviewYear || ''),
    r.status,
    r.preparedBy,
    r.pendingWith,
    r.createdDate,
    r.dueDate || '',
    String(r.completionPct ?? ''),
    r.site || '',
  ]);
  return { headers, rows };
}

export const pqrDashboardFiltersSchema = z.object({
  product: z.string().optional(),
  productCode: z.string().optional(),
  reviewYear: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  overdueOnly: z.boolean().optional(),
  pendingApprovalOnly: z.boolean().optional(),
});
