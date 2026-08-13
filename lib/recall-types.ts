import { normalizeRole } from '@/lib/permissions';

export const RECALL_COLLECTIONS = {
  records: 'recalls',
  distribution: 'recall_distribution',
  recovery: 'recall_recovery',
  regulatoryNotifications: 'recall_regulatory_notifications',
  closure: 'recall_closure',
  trends: 'recall_trends',
  reports: 'recall_reports',
  approvals: 'recall_approvals',
  attachments: 'recall_attachments',
  auditLogs: 'audit_logs',
  notifications: 'notifications',
  batches: 'batches',
  complaints: 'complaints',
  deviations: 'deviations',
  oosRecords: 'oos_records',
  capaRecords: 'capa_records',
  products: 'products',
  customers: 'customers',
} as const;

export const RECALL_TYPES = ['Voluntary', 'Regulatory Directed', 'Mock Recall'] as const;
export const RECALL_CLASSIFICATIONS = ['Class I', 'Class II', 'Class III', 'Mock'] as const;

export const RECALL_SOURCES = [
  'Complaint',
  'Deviation',
  'OOS',
  'Regulatory Observation',
  'Internal Quality Review',
  'Market Surveillance',
  'Mock Recall',
  'Other',
] as const;

export const RECALL_STATUSES = [
  'draft', 'initiated', 'in_progress', 'regulatory_notified',
  'recovery_in_progress', 'completed', 'closed', 'cancelled', 'overdue',
] as const;

export type RecallType = typeof RECALL_TYPES[number];
export type RecallClassification = typeof RECALL_CLASSIFICATIONS[number];
export type RecallSource = typeof RECALL_SOURCES[number];
export type RecallStatus = typeof RECALL_STATUSES[number];

export const RECALL_RECOVERY_STATUSES = [
  'Pending',
  'Partially Recovered',
  'Recovered',
  'Not Recoverable',
  'Closed',
] as const;

export type RecallRecoveryStatus = typeof RECALL_RECOVERY_STATUSES[number];

export const RECALL_RECOVERY_TARGET_PERCENT = 100;

export const RECALL_REGULATORY_NOTIFICATION_STATUSES = [
  'Not Required',
  'Pending',
  'Submitted',
  'Acknowledged',
  'Response Received',
  'Follow Up Required',
  'Closed',
  'Overdue',
] as const;

export const RECALL_REGULATORY_APPROVAL_STATUSES = [
  'Draft',
  'Under QA Review',
  'Regulatory Review',
  'Head QA Approval',
  'Approved',
  'Rejected',
  'Closed',
] as const;

export type RecallRegulatoryNotificationStatus = typeof RECALL_REGULATORY_NOTIFICATION_STATUSES[number];
export type RecallRegulatoryApprovalStatus = typeof RECALL_REGULATORY_APPROVAL_STATUSES[number];

export const RECALL_CLOSURE_STATUSES = [
  'Pending',
  'Ready For Closure',
  'QA Review',
  'Head QA Review',
  'Closed',
  'Rejected',
  'Reopened',
] as const;

export type RecallClosureStatus = typeof RECALL_CLOSURE_STATUSES[number];

export const RECALL_TREND_STATUSES = [
  'Improving',
  'Stable',
  'Increasing',
  'Critical',
  'Insufficient Data',
] as const;

export type RecallTrendStatus = typeof RECALL_TREND_STATUSES[number];

export const RECALL_REPORT_TYPES = [
  'Recall Register',
  'Open Recall Report',
  'Closed Recall Report',
  'Class I Recall Report',
  'Class II Recall Report',
  'Class III Recall Report',
  'Mock Recall Report',
  'Recovery Status Report',
  'Market-wise Recall Report',
  'Product-wise Recall Report',
  'Regulatory Notification Report',
  'CAPA Linked Recall Report',
  'Recall Trend Report',
  'Recall Closure Report',
] as const;

export type RecallReportType = typeof RECALL_REPORT_TYPES[number];

export const RECALL_REGULATORY_REPORT_TYPES: RecallReportType[] = [
  'Regulatory Notification Report',
];

export const RECALL_RECOVERY_REPORT_TYPES: RecallReportType[] = [
  'Recovery Status Report',
];

export const RECALL_MANAGEMENT_REPORT_TYPES: RecallReportType[] = [
  'Market-wise Recall Report',
  'Product-wise Recall Report',
  'Recall Trend Report',
  'Recall Closure Report',
  'Recall Register',
];

export interface RecallActor {
  id: string;
  name: string;
  role: string;
}

export interface RecallRecord {
  id: string;
  recall_number: string;
  recall_date: string;
  recall_type: RecallType | string;
  recall_classification: RecallClassification | string;
  recall_source?: RecallSource | string;
  source_reference_number?: string;
  product_name: string;
  product_code?: string;
  batch_number: string;
  mfg_date?: string;
  exp_date?: string;
  market_region: string;
  customer_name?: string;
  reason_for_recall: string;
  recall_justification?: string;
  recall_initiated_by: string;
  recall_initiated_by_name: string;
  regulatory_notification_required: boolean;
  regulatory_authority?: string;
  notification_due_date?: string | null;
  regulatory_notified: boolean;
  notification_status?: string;
  due_date?: string | null;
  responsible_person?: string | null;
  responsible_person_name?: string | null;
  stock_quantity: number;
  distributed_quantity: number;
  recovered_quantity: number;
  recovery_percent: number;
  impact_assessment: string;
  risk_assessment: string;
  capa_required: boolean;
  linked_capa_id: string | null;
  linked_capa_number: string | null;
  linked_complaint_id: string | null;
  linked_complaint_number: string | null;
  linked_deviation_id: string | null;
  linked_oos_id: string | null;
  linked_oos_number?: string | null;
  assigned_owner?: string | null;
  assigned_owner_name?: string | null;
  include_in_pqr_review?: boolean;
  recall_status: RecallStatus | string;
  qa_remarks: string;
  batch_id: string | null;
  pqr_id: string | null;
  head_qa_approved: boolean;
  regulatory_approved: boolean;
  created_by: string;
  created_by_name: string;
  updated_by: string;
  updated_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface RecallDistribution {
  id: string;
  distribution_id?: string;
  recall_id: string;
  recall_number?: string;
  product_name?: string;
  batch_number?: string;
  customer_name: string;
  market_region: string;
  invoice_number?: string;
  dispatch_date?: string;
  distribution_date: string;
  quantity_distributed: number;
  unit?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_details: string;
  notification_sent?: boolean;
  notification_date?: string | null;
  recovery_required?: boolean;
  remarks?: string;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface RecallRecovery {
  id: string;
  recovery_id?: string;
  recall_id: string;
  recall_number?: string;
  distribution_id?: string | null;
  customer_name: string;
  market_region: string;
  distributed_quantity: number;
  quantity_recovered: number;
  pending_quantity: number;
  recovery_percent: number;
  recovery_date: string;
  recovered_by?: string;
  recovered_by_name?: string;
  recovery_status: RecallRecoveryStatus | string;
  reason_for_pending?: string;
  follow_up_required?: boolean;
  follow_up_date?: string | null;
  remarks: string;
  /** @deprecated use customer_name */
  recovered_from?: string;
  recorded_by: string;
  recorded_by_name: string;
  created_at: string;
  updated_at: string;
}

export interface RecallRecoveryDashboardMetrics {
  totalDistributed: number;
  totalRecovered: number;
  totalPending: number;
  averageRecoveryPercent: number;
  customersNotified: number;
  customersPendingResponse: number;
  followUpsDue: number;
  overdueFollowUps: number;
}

export interface RecallRecoveryTrendPoint {
  name: string;
  recovered: number;
  pending: number;
  percent: number;
}

export interface RecallCustomerRecoveryRow {
  customer_name: string;
  market_region: string;
  distributed_quantity: number;
  quantity_recovered: number;
  pending_quantity: number;
  recovery_percent: number;
  recovery_status: string;
  follow_up_required: boolean;
  follow_up_date?: string | null;
}

export interface RecallMarketRecoveryRow {
  market_region: string;
  distributed_quantity: number;
  quantity_recovered: number;
  pending_quantity: number;
  recovery_percent: number;
  customer_count: number;
}

export interface RecallRegulatoryNotification {
  id: string;
  regulatory_notification_id: string;
  recall_id: string;
  recall_number: string;
  product_name: string;
  batch_number: string;
  recall_classification: string;
  market_region: string;
  regulatory_authority: string;
  notification_required: boolean;
  notification_due_date: string | null;
  notification_date: string | null;
  notification_status: RecallRegulatoryNotificationStatus | string;
  submitted_by: string;
  submitted_by_name: string;
  submission_reference_number: string;
  submission_document: string;
  authority_response: string;
  response_date: string | null;
  follow_up_required: boolean;
  follow_up_due_date: string | null;
  regulatory_comments: string;
  qa_comments: string;
  head_qa_comments: string;
  approval_status: RecallRegulatoryApprovalStatus | string;
  e_signature_required: boolean;
  signed_by: string;
  signed_by_name: string;
  signed_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name: string;
  updated_by: string;
  updated_by_name: string;
}

export interface RecallRegulatoryApproval {
  id: string;
  recall_id: string;
  regulatory_notification_id: string;
  approval_type: 'qa_review' | 'regulatory_review' | 'head_qa';
  decision: 'approved' | 'rejected' | 'pending';
  comments: string;
  qa_comments?: string;
  head_qa_comments?: string;
  e_signature: string;
  e_signature_status: string;
  approved_by: string;
  approved_by_name: string;
  approved_at: string;
  created_at: string;
}

export interface RecallRegulatoryTimelineEntry {
  date: string;
  title: string;
  description: string;
  user: string;
  status?: string;
}

export interface RecallClosure {
  id: string;
  closure_id: string;
  recall_id: string;
  recall_number: string;
  closure_date: string | null;
  closed_by: string;
  closed_by_name: string;
  recovery_completed: boolean;
  final_recovery_percent: number;
  pending_quantity: number;
  pending_quantity_justification: string;
  regulatory_notification_completed: boolean;
  authority_response_completed: boolean;
  capa_required: boolean;
  capa_linked: boolean;
  capa_completed: boolean;
  effectiveness_review_completed: boolean;
  customer_communication_completed: boolean;
  product_disposal_completed: boolean;
  final_recall_conclusion: string;
  qa_closure_comments: string;
  head_qa_comments: string;
  closure_status: RecallClosureStatus | string;
  e_signature_required: boolean;
  signed_by: string;
  signed_by_name: string;
  signed_date: string | null;
  readiness_percent: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name: string;
  updated_by: string;
  updated_by_name: string;
}

export interface RecallClosureTimelineEntry {
  date: string;
  title: string;
  description: string;
  user: string;
}

export interface RecallTrendMetrics {
  total: number;
  open: number;
  closed: number;
  classI: number;
  classII: number;
  classIII: number;
  mockRecalls: number;
  avgRecoveryPercent: number;
  capaLinkedCount: number;
  regulatoryNotificationCount: number;
  complaintLinkedCount: number;
  avgClosureDays: number;
  monthlyTrend: { name: string; count: number }[];
  byProduct: { name: string; count: number }[];
  byMarket: { name: string; count: number }[];
  byClassification: { name: string; count: number }[];
  byType: { name: string; count: number }[];
  bySource: { name: string; count: number }[];
  recoveryTrend: { name: string; avgPercent: number }[];
  capaLinkedTrend: { name: string; count: number }[];
  regulatoryTrend: { name: string; count: number }[];
  closureTimeTrend: { name: string; avgDays: number }[];
}

export interface RecallTrendRecord {
  id?: string;
  trend_id: string;
  review_period_from: string;
  review_period_to: string;
  product: string;
  market_region: string;
  recall_type: string;
  recall_classification: string;
  recall_source: string;
  total_recalls: number;
  open_recalls: number;
  closed_recalls: number;
  class_i_recalls: number;
  class_ii_recalls: number;
  class_iii_recalls: number;
  mock_recalls: number;
  average_recovery_percent: number;
  capa_linked_count: number;
  regulatory_notification_count: number;
  average_closure_days: number;
  trend_status: RecallTrendStatus | string;
  risk_level: string;
  conclusion: string;
  recommendation: string;
  generated_by: string;
  generated_by_name: string;
  generated_date: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_date?: string;
  alerts?: string[];
  chart_snapshot?: Record<string, unknown>;
  filters?: Record<string, string>;
  include_in_pqr_review?: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  is_deleted?: boolean;
}

export interface RecallAttachment {
  id: string;
  recall_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: string;
}

export interface RecallFilters {
  recall_type?: string;
  recall_classification?: string;
  recall_status?: string;
  product?: string;
  batch_number?: string;
  market_region?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
  kpi_filter?: string;
}

export interface RecallDashboardMetrics {
  total: number;
  open: number;
  closed: number;
  mockRecalls: number;
  classI: number;
  classII: number;
  classIII: number;
  regulatoryPending: number;
  recoveryInProgress: number;
  avgRecoveryPercent: number;
  capaLinked: number;
  complaintLinked: number;
  critical: number;
  overdue: number;
}

export interface RecallDashboardChartData {
  monthlyTrend: { name: string; count: number }[];
  byClassification: { name: string; count: number; value: number }[];
  byProduct: { name: string; count: number; value: number }[];
  byMarket: { name: string; count: number; value: number }[];
  recoveryTrend: { name: string; avgPercent: number; percent?: number }[];
  openVsClosed: { name: string; count: number }[];
  complaintLinkedTrend: { name: string; count: number }[];
  capaLinkedTrend: { name: string; count: number }[];
}

export interface RecallReportAnalyticsMetrics extends RecallDashboardMetrics {
  avgClosureDays: number;
}

export interface RecallReportChartData {
  monthlyTrend: { name: string; count: number }[];
  byProduct: { name: string; count: number }[];
  byMarket: { name: string; count: number }[];
  byClassification: { name: string; count: number }[];
  byType: { name: string; count: number }[];
  recoveryTrend: { name: string; avgPercent: number }[];
  regulatoryTrend: { name: string; count: number }[];
  capaLinkageTrend: { name: string; count: number }[];
  closurePerformanceTrend: { name: string; avgDays: number }[];
}

export interface RecallReportPreviewRow {
  recall_number: string;
  recall_date: string;
  product_name: string;
  batch_number: string;
  market_region: string;
  recall_type: string;
  recall_classification: string;
  recall_status: string;
  recovery_percent: string;
  regulatory_status: string;
  capa_linked: string;
  closure_date: string;
}

export interface RecallManagementReviewSummary {
  totalRecalls: number;
  openRecalls: number;
  closedRecalls: number;
  classIRecalls: number;
  avgRecoveryPercent: number;
  avgClosureDays: number;
  topProducts: { name: string; count: number }[];
  topMarkets: { name: string; count: number }[];
  regulatoryPending: number;
  capaLinked: number;
  overdueRecalls: number;
  narrative: string;
  recommendations: string[];
}

export interface RecallReportRecord {
  id: string;
  report_id: string;
  report_name: string;
  report_number: string;
  report_type: RecallReportType | string;
  review_period_from: string;
  review_period_to: string;
  recall_number?: string;
  product?: string;
  batch_number?: string;
  market_region?: string;
  recall_type_filter?: string;
  recall_classification?: string;
  status_filter?: string;
  regulatory_notification_required?: string;
  capa_required?: string;
  generated_by: string;
  generated_by_name: string;
  generated_at: string;
  generated_date: string;
  total_records: number;
  export_type: string;
  file_url: string;
  file_name?: string;
  report_status: string;
  filters_applied: Record<string, unknown>;
  preview_rows?: Record<string, unknown>[];
  chart_snapshot?: Record<string, unknown>;
  metrics_snapshot?: Record<string, unknown>;
  management_summary?: RecallManagementReviewSummary;
  distribution_summary?: Record<string, unknown>;
  recovery_summary?: Record<string, unknown>;
  regulatory_summary?: Record<string, unknown>;
  capa_summary?: Record<string, unknown>;
  summary: string;
  recommendations?: string;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
  scheduled?: boolean;
  schedule_frequency?: string;
  schedule_next_run?: string;
}

export interface RecallOpenRecoveryRow {
  id: string;
  recall_number: string;
  product_name: string;
  batch_number: string;
  distributed_quantity: number;
  recovered_quantity: number;
  recovery_percent: number;
  responsible_person: string;
  due_date: string;
}

export interface RecallRegulatoryPendingRow {
  id: string;
  recall_number: string;
  market_region: string;
  recall_classification: string;
  notification_required: string;
  due_date: string;
  status: string;
}

export interface RecallActivityEntry {
  date: string;
  title: string;
  description: string;
  user: string;
  recall_number: string;
}

export function isRecallClosed(status: string): boolean {
  return ['closed', 'cancelled'].includes(status);
}

export function isRecallOpen(status: string): boolean {
  return !isRecallClosed(status);
}

export function isMockRecall(record: RecallRecord): boolean {
  return record.recall_type === 'Mock Recall' || record.recall_classification === 'Mock';
}

export function isRecallCapaLinked(record: RecallRecord): boolean {
  return Boolean(record.linked_capa_id || record.linked_capa_number);
}

export function isRecallComplaintLinked(record: RecallRecord): boolean {
  return Boolean(record.linked_complaint_id || record.linked_complaint_number);
}

export function isRecallCritical(record: RecallRecord): boolean {
  return record.recall_classification === 'Class I';
}

export function isRegulatoryPending(record: RecallRecord): boolean {
  if (!record.regulatory_notification_required) return false;
  const status = (record.notification_status || '').toLowerCase();
  if (status === 'completed') return false;
  return !record.regulatory_notified;
}

export function getRecallDueDate(record: RecallRecord): string {
  if (record.due_date) return record.due_date;
  const base = record.recall_date || record.created_at?.slice(0, 10) || new Date().toISOString().split('T')[0];
  const days = record.regulatory_notification_required ? 7 : 30;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return base;
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

export function isRecallOverdue(record: RecallRecord): boolean {
  if (isRecallClosed(record.recall_status)) return false;
  if (record.recall_status === 'overdue') return true;
  const due = getRecallDueDate(record);
  return due < new Date().toISOString().split('T')[0];
}

export function getRecallRecoveryPercent(record: RecallRecord): number {
  const distributed = record.distributed_quantity ?? 0;
  const recovered = record.recovered_quantity ?? 0;
  if (record.recovery_percent != null && !Number.isNaN(record.recovery_percent)) {
    return record.recovery_percent;
  }
  return calcRecoveryPercent(distributed, recovered);
}

export function isRecoveryInProgress(record: RecallRecord): boolean {
  return record.recall_status === 'recovery_in_progress'
    || (isRecallOpen(record.recall_status) && getRecallRecoveryPercent(record) > 0 && getRecallRecoveryPercent(record) < 100);
}

export function requiresClassIApproval(classification: string): boolean {
  return classification === 'Class I';
}

export function calcRecoveryPercent(distributed: number, recovered: number): number {
  if (!distributed || distributed <= 0) return 0;
  return Math.round((recovered / distributed) * 10000) / 100;
}

export function isRecallReadOnly(role: string): boolean {
  return ['auditor', 'viewer'].includes(role);
}

export function canViewRecallDashboard(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'regulatory_affairs', 'warehouse', 'warehouse_manager', 'auditor', 'viewer',
  ].includes(r);
}

export function canExportRecallDashboard(role?: string | null): boolean {
  return ['super_admin', 'admin', 'qa', 'qa_manager', 'head_qa', 'regulatory_affairs'].includes(normalizeRole(role));
}

export function isRecallDashboardReadOnly(role?: string | null): boolean {
  return normalizeRole(role) === 'auditor';
}

export function canCreateRecall(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(normalizeRole(role));
}

export function canApproveRecall(role: string): boolean {
  return ['super_admin', 'admin', 'qa_manager', 'head_qa', 'regulatory_affairs'].includes(normalizeRole(role));
}

export function canViewRecallRecovery(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'regulatory_affairs', 'warehouse', 'warehouse_manager', 'auditor', 'viewer',
  ].includes(r);
}

export function canAddRecallDistribution(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'warehouse', 'warehouse_manager', 'head_qa', 'qa_manager'].includes(r);
}

export function canUpdateRecallRecovery(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'warehouse', 'warehouse_manager', 'head_qa', 'qa_manager', 'qa'].includes(r);
}

export function canReviewRecallRecovery(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r);
}

export function canViewRegulatoryRecovery(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'regulatory_affairs', 'qa_manager', 'auditor', 'viewer'].includes(r);
}

export function isRecallRecoveryReadOnly(role?: string | null): boolean {
  return normalizeRole(role) === 'auditor';
}

export function deriveRecoveryStatus(
  distributed: number,
  recovered: number,
  current?: string,
): RecallRecoveryStatus | string {
  if (current === 'Not Recoverable' || current === 'Closed') return current;
  if (distributed <= 0) return 'Pending';
  if (recovered <= 0) return 'Pending';
  if (recovered >= distributed) return 'Recovered';
  return 'Partially Recovered';
}

export function calcPendingQuantity(distributed: number, recovered: number): number {
  return Math.max(0, distributed - recovered);
}

export function isFollowUpOverdue(followUpDate?: string | null): boolean {
  if (!followUpDate) return false;
  return followUpDate < new Date().toISOString().split('T')[0];
}

export function canAllowClosureReview(
  recall: RecallRecord,
  recoveries: RecallRecovery[],
  closureJustification?: string,
): boolean {
  const avg = getRecallRecoveryPercent(recall);
  if (avg >= RECALL_RECOVERY_TARGET_PERCENT) return true;
  if (closureJustification?.trim()) return true;
  return recoveries.every((r) => r.recovery_status === 'Not Recoverable' || r.recovery_status === 'Closed');
}

export function canViewRecallRegulatory(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'regulatory_affairs', 'auditor', 'viewer',
  ].includes(r);
}

export function canCreateReviewRecallRegulatory(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r);
}

export function canUpdateRegulatorySubmission(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'regulatory_affairs', 'head_qa'].includes(r);
}

export function canApproveRecallRegulatoryHeadQa(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa'].includes(r);
}

export function isRecallRegulatoryReadOnly(role?: string | null): boolean {
  return normalizeRole(role) === 'auditor';
}

export function isRegulatoryNotificationClosed(status: string): boolean {
  return status === 'Closed' || status === 'Not Required';
}

export function isRegulatoryMandatory(classification: string, notificationRequired?: boolean): boolean {
  return classification === 'Class I' || notificationRequired === true;
}

export function canViewRecallClosure(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'regulatory_affairs', 'warehouse', 'warehouse_manager', 'auditor', 'viewer',
  ].includes(r);
}

export function canReviewRecallClosure(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r);
}

export function canCloseRecallClosureRecord(role?: string | null, classification?: string): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin'].includes(r)) return true;
  if (classification === 'Class I' || classification === 'Critical') {
    return r === 'head_qa';
  }
  return ['head_qa', 'qa_manager', 'qa'].includes(r);
}

export function canReopenRecallClosure(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa'].includes(r);
}

export function canConfirmRecallDisposal(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'warehouse', 'warehouse_manager', 'head_qa'].includes(r);
}

export function isRecallClosureReadOnly(role?: string | null, closureStatus?: string): boolean {
  if (normalizeRole(role) === 'auditor') return true;
  return closureStatus === 'Closed';
}

export function canViewRecallTrend(role?: string | null): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'regulatory_affairs', 'auditor', 'viewer',
  ].includes(r);
}

export function canGenerateRecallTrend(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r);
}

export function canGenerateRecallTrendRegulatory(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'regulatory_affairs', 'head_qa'].includes(r);
}

export function canApproveRecallTrend(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa'].includes(normalizeRole(role));
}

export function canExportRecallTrend(role?: string | null): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'regulatory_affairs'].includes(r);
}

export function isRecallTrendReadOnly(role?: string | null): boolean {
  return normalizeRole(role) === 'auditor';
}

export function canViewRecallReports(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'regulatory_affairs', 'warehouse', 'warehouse_manager', 'auditor', 'viewer',
  ].includes(r);
}

export function canGenerateRecallReports(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(r);
}

export function canGenerateRecallReportType(role?: string | null, reportType?: RecallReportType): boolean {
  if (!reportType) return canGenerateRecallReports(role);
  const r = normalizeRole(role || '');
  if (RECALL_REGULATORY_REPORT_TYPES.includes(reportType)) {
    return ['super_admin', 'admin', 'head_qa', 'regulatory_affairs'].includes(r);
  }
  if (RECALL_RECOVERY_REPORT_TYPES.includes(reportType)) {
    return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'warehouse', 'warehouse_manager'].includes(r);
  }
  if (RECALL_MANAGEMENT_REPORT_TYPES.includes(reportType)) {
    return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(r);
  }
  return canGenerateRecallReports(role);
}

export function canExportRecallReports(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'regulatory_affairs', 'auditor'].includes(r);
}

export function canViewRecallManagementReview(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(r);
}

export function isRecallReportsReadOnly(role?: string | null): boolean {
  return normalizeRole(role || '') === 'auditor';
}
