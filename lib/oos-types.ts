export const OOS_COLLECTIONS = {
  records: 'oos_records',
  phase1: 'oos_phase1',
  phase2: 'oos_phase2',
  impactAssessments: 'oos_impact_assessment',
  capaLinks: 'oos_capa_link',
  approvals: 'oos_approvals',
  approvalHistory: 'oos_approval_history',
  closures: 'oos_closure',
  trends: 'oos_trends',
  reports: 'oos_reports',
  attachments: 'oos_attachments',
  auditLogs: 'audit_logs',
  notifications: 'notifications',
  batches: 'batches',
  capa: 'capa_records',
} as const;

export const OOS_STATUSES = [
  'draft', 'submitted', 'phase1_investigation', 'qa_review',
  'phase2_investigation', 'capa_required', 'final_qa_review',
  'approved', 'rejected', 'closed', 'overdue',
] as const;

export const OPEN_OOS_STATUSES = [
  'draft', 'submitted', 'phase1_investigation', 'qa_review',
  'phase2_investigation', 'capa_required', 'final_qa_review',
  'overdue', 'open', 'under_investigation', 'confirmed',
] as const;

export const PHASE1_OUTCOMES = [
  'Laboratory Error', 'No Laboratory Error', 'Inconclusive',
] as const;

export const PHASE1_STATUSES = [
  'Not Started',
  'In Progress',
  'QA Review',
  'Completed',
  'Rejected',
] as const;

export type Phase1Status = typeof PHASE1_STATUSES[number];

export const CRITICAL_TESTS = [
  'Assay', 'Sterility', 'Endotoxin', 'Particulate Matter',
  'Water Content', 'Related Substances', 'Microbial Limit',
  'Preservative Efficacy', 'pH', 'Osmolality',
] as const;

export const DEPARTMENTS = [
  'QC', 'QA', 'Production', 'Microbiology', 'Engineering', 'Warehouse',
] as const;

export type OosStatus = typeof OOS_STATUSES[number];
export type Phase1Outcome = typeof PHASE1_OUTCOMES[number];
export type ResultStatus = 'Pass' | 'OOS' | 'Under Review' | 'Confirmed OOS' | 'Invalid OOS';

export interface OosRecord {
  id: string;
  oos_number: string;
  oos_date: string;
  department: string;
  product_name: string;
  product_id: string | null;
  batch_number: string;
  batch_id: string | null;
  test_name: string;
  test_method: string;
  stp_number: string;
  specification_number: string;
  parameter_name: string;
  spec_lower_limit: number;
  spec_upper_limit: number;
  observed_result: number;
  unit: string;
  result_status: ResultStatus;
  /** Legacy PQR field */
  test_parameter: string;
  specification: string;
  obtained_result: string;
  is_critical_test: boolean;
  batch_release_blocked: boolean;
  status: OosStatus | string;
  phase: 'phase1' | 'phase2' | 'phase3';
  capa_required: boolean;
  linked_capa_number: string | null;
  linked_capa_id: string | null;
  target_closure_date: string | null;
  actual_closure_date: string | null;
  root_cause: string;
  source: 'manual' | 'cpv_cqa' | 'cpv_cpp' | 'batch';
  source_reference: string | null;
  cpv_record_id: string | null;
  pqr_id: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  sample_type?: string;
  analyst_name?: string;
  instrument_used?: string;
  initial_observation?: string;
  immediate_action?: string;
  remarks?: string;
  stability_record_id?: string | null;
  cqa_result_id?: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_by: string;
  updated_by_name: string;
  updated_at: string;
}

export interface OosPhase1 {
  id: string;
  phase1_id?: string;
  oos_id: string;
  oos_number?: string;
  investigation_start_date?: string;
  investigation_due_date?: string;
  qc_investigator?: string;
  qc_investigator_id?: string;
  analyst_name: string;
  test_name?: string;
  parameter_name?: string;
  instrument_used: string;
  instrument_id?: string;
  instrument_calibration_status: string;
  standard_used: string;
  standard_lot_number?: string;
  reagent_used: string;
  reagent_lot_number?: string;
  glassware_verified?: boolean;
  calculation_verified: boolean;
  method_followed_correctly?: boolean;
  sample_preparation_verified?: boolean;
  data_review_completed: boolean;
  chromatogram_attached: boolean;
  raw_data_attached: boolean;
  chromatogram_raw_data_reviewed?: boolean;
  analyst_interview_completed?: boolean;
  lab_error_observed?: boolean;
  assignable_cause_identified?: boolean;
  investigation_findings: string;
  root_cause_identified: string;
  root_cause?: string;
  corrective_action?: string;
  phase1_conclusion: string;
  phase1_outcome: Phase1Outcome | string;
  qa_review_comments?: string;
  qa_reviewer_id?: string;
  qa_reviewer_name?: string;
  qa_reviewed_at?: string;
  qa_decision?: 'approved' | 'rejected';
  status?: Phase1Status | string;
  phase2_recommended?: boolean;
  deviation_recommended?: boolean;
  investigator_id: string;
  investigator_name: string;
  started_at: string;
  completed_at: string | null;
  created_by?: string;
  created_by_name?: string;
  updated_by?: string;
  updated_by_name?: string;
  created_at: string;
  updated_at: string;
}

export const PHASE2_OUTCOMES = [
  'Manufacturing Root Cause Identified',
  'Material Root Cause Identified',
  'Equipment Root Cause Identified',
  'Process Root Cause Identified',
  'No Assignable Cause',
  'Inconclusive',
] as const;

export const PHASE2_STATUSES = [
  'Not Started',
  'In Progress',
  'QA Review',
  'CAPA Required',
  'Completed',
  'Rejected',
] as const;

export type Phase2Outcome = typeof PHASE2_OUTCOMES[number];
export type Phase2Status = typeof PHASE2_STATUSES[number];

export interface OosPhase2 {
  id: string;
  phase2_id?: string;
  oos_id: string;
  oos_number?: string;
  investigation_start_date?: string;
  investigation_due_date?: string;
  assigned_investigator?: string;
  assigned_investigator_id?: string;
  department?: string;
  product_name?: string;
  batch_number?: string;
  manufacturing_review?: string;
  batch_record_review: string;
  raw_material_review: string;
  packing_material_review?: string;
  equipment_review: string;
  cleaning_review?: string;
  utility_review?: string;
  environmental_review: string;
  operator_review: string;
  process_parameter_review?: string;
  process_review: string;
  deviation_review: string;
  change_control_review: string;
  previous_batch_trend_review?: string;
  other_batch_impact_review?: string;
  other_batches_impacted_list?: string;
  root_cause: string;
  contributing_factors?: string;
  impact_assessment: string;
  product_quality_impact?: string;
  corrective_action: string;
  preventive_action: string;
  capa_required?: boolean;
  linked_capa_number?: string | null;
  conclusion: string;
  final_investigation_conclusion?: string;
  phase2_outcome?: Phase2Outcome | string;
  qa_justification?: string;
  qa_review_comments?: string;
  qa_reviewer_id?: string;
  qa_reviewer_name?: string;
  qa_reviewed_at?: string;
  qa_decision?: 'approved' | 'rejected';
  status?: Phase2Status | string;
  investigator_id: string;
  investigator_name: string;
  started_at: string;
  completed_at: string | null;
  created_by?: string;
  created_by_name?: string;
  updated_by?: string;
  updated_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface OosImpactAssessment {
  id: string;
  impact_assessment_id?: string;
  oos_id: string;
  oos_number?: string;
  product?: string;
  batch_number?: string;
  test_name?: string;
  parameter_name?: string;
  assessment_date?: string;
  /** Legacy free-text field; maps to product_quality_impact */
  product_impact: string;
  batch_impact: string;
  market_impact: string;
  patient_safety_impact: string;
  regulatory_impact: string;
  other_batches_impacted: string;
  recall_required: boolean;
  product_quality_impact?: string;
  stability_impact?: string;
  validation_impact?: string;
  impacted_batch_numbers?: string;
  recall_evaluation_required?: boolean;
  recall_evaluation_reason?: string;
  capa_required?: boolean;
  deviation_required?: boolean;
  severity?: number;
  occurrence?: number;
  detection?: number;
  risk_score?: number;
  risk_level?: string;
  impact_description?: string;
  scientific_justification?: string;
  conclusion?: string;
  qa_comments?: string;
  status?: string;
  qa_decision?: 'approved' | 'rejected';
  qa_reviewer_id?: string;
  qa_reviewer_name?: string;
  qa_reviewed_at?: string;
  assessed_by: string;
  assessed_by_name: string;
  assessed_at: string;
  created_by?: string;
  created_by_name?: string;
  updated_by?: string;
  updated_by_name?: string;
  created_at: string;
  updated_at: string;
}

export const OOS_IMPACT_OPTIONS = ['Yes', 'No', 'Under Evaluation', 'Not Applicable'] as const;
export const OOS_IMPACT_STATUSES = ['Draft', 'In Progress', 'Submitted', 'QA Review', 'Approved', 'Rejected'] as const;
export type OosImpactOption = typeof OOS_IMPACT_OPTIONS[number];
export type OosImpactStatus = typeof OOS_IMPACT_STATUSES[number];

export interface OosCapaLink {
  id: string;
  oos_capa_link_id?: string;
  oos_id: string;
  oos_number?: string;
  capa_required: boolean;
  capa_number: string;
  capa_id: string | null;
  capa_title?: string;
  capa_source?: string;
  root_cause?: string;
  corrective_action?: string;
  preventive_action?: string;
  action_owner?: string;
  action_owner_name?: string;
  department?: string;
  target_completion_date?: string | null;
  /** @deprecated use target_completion_date */
  target_date: string | null;
  capa_status: string;
  implementation_date?: string | null;
  effectiveness_check_required?: boolean;
  effectiveness_check_date?: string | null;
  /** @deprecated use effectiveness_result */
  effectiveness_check: string;
  effectiveness_result?: string | null;
  capa_closure_date?: string | null;
  remarks?: string;
  is_active?: boolean;
  linked_by: string;
  linked_by_name: string;
  /** @deprecated use linked_at */
  linked_at: string;
  linked_date?: string;
  created_by?: string;
  created_by_name?: string;
  updated_by?: string;
  updated_by_name?: string;
  created_at: string;
  updated_at: string;
}

export const OOS_CAPA_DISPLAY_STATUSES = [
  'Draft',
  'Open',
  'Under Implementation',
  'Pending Verification',
  'Effectiveness Check Pending',
  'Closed',
  'Overdue',
] as const;

export const OOS_EFFECTIVENESS_RESULTS = [
  'Effective',
  'Partially Effective',
  'Not Effective',
  'Under Review',
] as const;

export type OosCapaDisplayStatus = typeof OOS_CAPA_DISPLAY_STATUSES[number];
export type OosEffectivenessResult = typeof OOS_EFFECTIVENESS_RESULTS[number];

export interface OosCapaDashboardMetrics {
  totalLinked: number;
  openCapa: number;
  closedCapa: number;
  overdueCapa: number;
  effectivenessPending: number;
  effectiveCapa: number;
  notEffectiveCapa: number;
  repeatOosCapa: number;
}

export interface OosApproval {
  id: string;
  oos_id: string;
  oos_number?: string;
  approval_id?: string;
  current_workflow_step?: string;
  current_approver?: string;
  current_approver_name?: string;
  current_approver_role?: string;
  current_role?: string;
  approval_level: number | string;
  approval_level_legacy?: 'qa_review' | 'head_qa' | 'final';
  approval_status?: string;
  approver_id: string;
  approver_name: string;
  approver_role: string;
  decision: 'approved' | 'rejected' | 'pending' | 'sent_back' | 'escalated';
  comments: string;
  rejection_reason?: string;
  send_back_reason?: string;
  e_signature_required?: boolean;
  e_signature: string;
  e_signature_status?: string;
  signed_at: string | null;
  signed_by?: string;
  signed_date?: string | null;
  due_date?: string | null;
  completed_date?: string | null;
  escalation_status?: string;
  created_by?: string;
  created_by_name?: string;
  updated_by?: string;
  updated_by_name?: string;
  created_at: string;
  updated_at?: string;
  is_deleted?: boolean;
}

export const OOS_APPROVAL_STATUSES = [
  'Pending', 'Approved', 'Rejected', 'Sent Back', 'Escalated', 'Completed', 'Waiting',
] as const;

export const OOS_WORKFLOW_STEPS = [
  'Draft', 'Submitted', 'Phase-I Review', 'QA Review', 'Phase-II Review',
  'Impact Assessment Review', 'CAPA Review', 'Final QA Review', 'Head QA Approval', 'Closed',
] as const;

export interface OosApprovalHistoryEntry {
  id?: string;
  oos_id: string;
  oos_number: string;
  approval_id: string;
  action: string;
  workflow_step: string;
  user_id: string;
  user_name: string;
  user_role: string;
  comments: string;
  rejection_reason?: string;
  send_back_reason?: string;
  e_signature_status?: string;
  created_at: string;
  created_by: string;
  is_deleted?: boolean;
}

export interface OosApprovalDashboardCounts {
  pendingApprovals: number;
  myPendingApprovals: number;
  approvedOos: number;
  rejectedOos: number;
  sentBackOos: number;
  criticalPending: number;
  overdueApprovals: number;
  headQaPending: number;
  closedOos: number;
}

export const OOS_CLOSURE_STATUSES = [
  'Pending', 'Ready For Closure', 'QA Review', 'Closed', 'Rejected', 'Reopened',
] as const;

export type OosClosureStatus = typeof OOS_CLOSURE_STATUSES[number];

export interface OosClosure {
  id: string;
  closure_id: string;
  oos_id: string;
  oos_number: string;
  closure_date: string | null;
  closed_by: string;
  closed_by_name?: string;
  department: string;
  phase1_completed: boolean;
  phase2_required: boolean;
  phase2_completed: boolean;
  impact_assessment_completed: boolean;
  root_cause_identified: boolean;
  capa_required: boolean;
  capa_linked: boolean;
  capa_completed: boolean;
  effectiveness_check_completed: boolean;
  batch_impact_resolved: boolean;
  product_quality_impact_resolved: boolean;
  patient_safety_impact_resolved: boolean;
  regulatory_impact_resolved: boolean;
  market_impact_resolved: boolean;
  all_attachments_reviewed: boolean;
  final_oos_conclusion: string;
  qa_closure_comments: string;
  closure_status: OosClosureStatus | string;
  e_signature_required?: boolean;
  signed_by?: string;
  signed_date?: string | null;
  reopen_reason?: string;
  readiness_percent?: number;
  batch_release_updated?: boolean;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name?: string;
  updated_by: string;
  updated_by_name?: string;
  is_deleted?: boolean;
}

export const OOS_REPORT_TYPES = [
  'OOS Register',
  'Open OOS Report',
  'Closed OOS Report',
  'Overdue OOS Report',
  'Critical OOS Report',
  'Product-wise OOS Report',
  'Test-wise OOS Report',
  'Phase-I Investigation Report',
  'Phase-II Investigation Report',
  'CAPA Linked OOS Report',
  'OOS Trend Report',
  'OOS Closure Report',
] as const;

export type OosReportType = typeof OOS_REPORT_TYPES[number];

export interface OosReportRecord {
  id: string;
  report_id: string;
  report_number: string;
  report_type: OosReportType | string;
  review_period_from: string;
  review_period_to: string;
  department: string;
  product: string;
  batch_number: string;
  test_name: string;
  root_cause_category: string;
  status_filter: string;
  generated_by: string;
  generated_by_name?: string;
  generated_date: string;
  total_records: number;
  export_type: string;
  file_url: string;
  file_name?: string;
  report_status: string;
  filters_applied?: Record<string, string>;
  preview_rows?: Record<string, unknown>[];
  chart_snapshot?: Record<string, unknown>;
  metrics_snapshot?: Record<string, unknown>;
  summary: string;
  investigation_summary?: string;
  capa_summary?: string;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
}

export interface OosAttachment {
  id: string;
  oos_id: string;
  file_name: string;
  file_url: string;
  file_type: string;
  file_size: number;
  category: 'pdf' | 'excel' | 'chromatogram' | 'image' | 'report' | 'other';
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: string;
}

export const ROOT_CAUSE_CATEGORIES = [
  'Laboratory Error',
  'Manufacturing Error',
  'Material Related',
  'Equipment Related',
  'Method Related',
  'Analyst Error',
  'Environmental Related',
  'No Assignable Cause',
  'Inconclusive',
] as const;

export interface OosFilters {
  search?: string;
  oos_number?: string;
  department?: string;
  product_name?: string;
  batch_number?: string;
  test_name?: string;
  root_cause?: string;
  status?: string;
  capa_linked?: boolean;
  capa_required?: boolean;
  assigned_to?: string;
  overdue_only?: boolean;
  date_from?: string;
  date_to?: string;
  kpi_filter?: string;
}

export interface OosChartPoint {
  name: string;
  count: number;
  month?: string;
  open?: number;
  closed?: number;
  phase1?: number;
  phase2?: number;
  linked?: number;
  notLinked?: number;
  avgDays?: number;
}

export interface OosActivityEntry {
  date: string;
  title: string;
  description: string;
  user?: string;
  oosId?: string;
  oosNumber?: string;
}

export interface OosDashboardMetrics {
  total: number;
  open: number;
  closed: number;
  draft: number;
  phase1: number;
  phase2: number;
  qaReviewPending: number;
  capaRequired: number;
  capaLinked: number;
  overdue: number;
  critical: number;
  laboratoryError: number;
  manufacturingRelated: number;
  inconclusive: number;
  batchBlocked: number;
  productQualityImpact: number;
  avgClosureDays: number;
  monthlyTrend: OosChartPoint[];
  byDepartment: OosChartPoint[];
  byProduct: OosChartPoint[];
  byTestName: OosChartPoint[];
  byRootCause: OosChartPoint[];
  phaseTrend: OosChartPoint[];
  openClosedTrend: OosChartPoint[];
  capaLinkageTrend: OosChartPoint[];
  closureTimeTrend: OosChartPoint[];
  batchImpactTrend: OosChartPoint[];
  /** @deprecated use byRootCause */
  rootCauseTrend: OosChartPoint[];
  /** @deprecated use openClosedTrend */
  closureTrend: OosChartPoint[];
  recentActivity: OosActivityEntry[];
}

export const OOS_TREND_STATUSES = [
  'Improving', 'Stable', 'Increasing', 'Critical', 'Insufficient Data',
] as const;

export type OosTrendStatus = typeof OOS_TREND_STATUSES[number];

export interface OosTrendRecord {
  id: string;
  trend_id: string;
  review_period_from: string;
  review_period_to: string;
  department: string;
  product: string;
  test_name: string;
  parameter_name: string;
  root_cause_category: string;
  total_oos: number;
  open_oos: number;
  closed_oos: number;
  phase1_oos: number;
  phase2_oos: number;
  capa_linked_oos: number;
  repeat_oos: number;
  average_closure_days: number;
  trend_status: OosTrendStatus | string;
  risk_level: string;
  conclusion: string;
  recommendation: string;
  generated_by: string;
  generated_by_name?: string;
  generated_date: string;
  approved_by?: string;
  approved_by_name?: string;
  approved_date?: string | null;
  alerts?: string[];
  chart_snapshot?: Record<string, unknown>;
  filters?: Record<string, string>;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
}

export interface OosActor {
  id: string;
  name: string;
  role: string;
}

export function computeResultStatus(
  observed: number,
  lower: number,
  upper: number,
): ResultStatus {
  if (![observed, lower, upper].every((value) => Number.isFinite(value))) return 'Under Review';
  if (observed >= lower && observed <= upper) return 'Pass';
  return 'OOS';
}

export function isOpenOosStatus(status: string): boolean {
  return OPEN_OOS_STATUSES.includes(status as typeof OPEN_OOS_STATUSES[number]);
}

export function isCriticalTest(testName: string): boolean {
  return CRITICAL_TESTS.some((t) =>
    String(testName || '').toLowerCase().includes(t.toLowerCase()),
  );
}

export function isCriticalOosTest(testName: string): boolean {
  const criticalNames = ['Sterility', 'Endotoxin', 'Assay'];
  return criticalNames.some((t) => String(testName || '').toLowerCase().includes(t.toLowerCase()))
    || isCriticalTest(testName);
}

export function getOosRiskLevel(record: OosRecord, impact?: OosImpactAssessment | null): string {
  if (impact?.risk_level) return impact.risk_level;
  if (isCriticalOosTest(record.test_name)) return 'Critical';
  if (record.is_critical_test && record.result_status === 'OOS') return 'Critical';
  if (impact?.patient_safety_impact === 'Yes' || impact?.patient_safety_impact?.toLowerCase().includes('yes')) return 'Critical';
  if (impact?.product_quality_impact === 'Yes' || impact?.product_impact?.toLowerCase().includes('yes')) return 'High';
  if (record.capa_required) return 'High';
  if (record.result_status === 'OOS') return 'Medium';
  return 'Low';
}

export function buildLegacySpecification(lower: number, upper: number, unit: string): string {
  return `${lower} - ${upper} ${unit}`;
}

export function getDaysOverdueOos(record: OosRecord): number {
  if (!record.target_closure_date || ['closed', 'rejected', 'approved'].includes(record.status)) return 0;
  const today = new Date().toISOString().split('T')[0];
  if (record.target_closure_date >= today) return 0;
  const a = new Date(record.target_closure_date);
  const b = new Date(today);
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 86400000));
}
