import { normalizeRole } from '@/lib/permissions';
import type { RiskAssessmentRecord } from '@/lib/cpv-risk-assessment-records';

export const RISK_FMEA_MODULE = 'FMEA Risk Assessment';
export const RISK_FMEA_COLLECTION = 'risk_fmea';

export const FMEA_STATUSES = [
  'Draft',
  'Open',
  'Under Review',
  'Mitigation In Progress',
  'Approved',
  'Closed',
  'Rejected',
] as const;

export type RiskFmeaActor = { id: string; name: string; role?: string; email?: string };

export interface FmeaRow {
  failure_mode_id: string;
  process_step: string;
  failure_mode: string;
  potential_effect: string;
  potential_cause: string;
  existing_control: string;
  severity: number;
  occurrence: number;
  detection: number;
  rpn: number;
  risk_priority: string;
  mitigation_required: boolean;
  mitigation_action: string;
  action_owner: string;
  target_date: string;
  residual_severity: number;
  residual_occurrence: number;
  residual_detection: number;
  residual_rpn: number;
  residual_risk_priority: string;
  status: string;
}

export interface RiskFmeaRecord {
  id: string;
  fmea_id: string;
  risk_assessment_id: string;
  risk_number: string;
  fmea_title: string;
  department: string;
  product: string;
  process_area: string;
  assessment_date: string;
  facilitator: string;
  team_members: string[];
  review_date: string;
  status: string;
  rows: FmeaRow[];
  highest_rpn: number;
  highest_residual_rpn: number;
  created_at: string;
  updated_at: string;
  created_by: string;
  created_by_name?: string;
  updated_by: string;
  updated_by_name?: string;
  is_deleted: boolean;
}

export interface RiskFmeaHeaderInput {
  fmea_title: string;
  department: string;
  product: string;
  process_area: string;
  assessment_date: string;
  facilitator: string;
  team_members: string[];
  review_date: string;
  status: string;
}

export interface RiskFmeaDashboardMetrics {
  totalFailureModes: number;
  lowRisks: number;
  mediumRisks: number;
  highRisks: number;
  criticalRisks: number;
  mitigationPending: number;
  mitigationCompleted: number;
  residualHighRisks: number;
}

export interface RiskFmeaChartData {
  riskDistribution: { name: string; count: number }[];
  top10Risks: { name: string; rpn: number; residual_rpn: number }[];
  residualRiskTrend: { name: string; rpn: number }[];
  mitigationProgress: { name: string; pending: number; done: number }[];
}

export function clampScore(n: number): number {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.min(10, Math.round(value)));
}

export function riskPriorityFromRpn(rpn: number): 'Low' | 'Medium' | 'High' | 'Critical' {
  if (rpn >= 201) return 'Critical';
  if (rpn >= 101) return 'High';
  if (rpn >= 51) return 'Medium';
  return 'Low';
}

export function calculateRpn(severity: number, occurrence: number, detection: number): number {
  const scores = [clampScore(severity), clampScore(occurrence), clampScore(detection)];
  if (scores.some((score) => score <= 0)) return 0;
  return scores[0] * scores[1] * scores[2];
}

export function enrichFmeaRow(row: FmeaRow): FmeaRow {
  const sev = clampScore(row.severity);
  const occ = clampScore(row.occurrence);
  const det = clampScore(row.detection);
  const residualProvided = [row.residual_severity, row.residual_occurrence, row.residual_detection]
    .every((score) => Number.isFinite(Number(score)) && Number(score) > 0);
  const residualSev = residualProvided ? clampScore(row.residual_severity) : 0;
  const residualOcc = residualProvided ? clampScore(row.residual_occurrence) : 0;
  const residualDet = residualProvided ? clampScore(row.residual_detection) : 0;
  const rpn = calculateRpn(sev, occ, det);
  const residualRpn = residualProvided ? calculateRpn(residualSev, residualOcc, residualDet) : 0;
  return {
    ...row,
    severity: sev,
    occurrence: occ,
    detection: det,
    residual_severity: residualSev,
    residual_occurrence: residualOcc,
    residual_detection: residualDet,
    rpn,
    residual_rpn: residualRpn,
    risk_priority: rpn > 0 ? riskPriorityFromRpn(rpn) : 'Invalid',
    residual_risk_priority: residualProvided ? riskPriorityFromRpn(residualRpn) : 'Not Assessed',
    mitigation_required: row.mitigation_required || rpn >= 101,
  };
}

export function requiresHeadQaReview(rows: FmeaRow[]): boolean {
  return rows.some((r) => r.risk_priority === 'Critical' || r.rpn > 200);
}

export function hasResidualHighRisk(rows: FmeaRow[]): boolean {
  return rows.some((r) => ['High', 'Critical'].includes(r.residual_risk_priority));
}

export function requiresCsvReview(rows: FmeaRow[], risk?: RiskAssessmentRecord): boolean {
  const text = `${risk?.riskCategory || ''} ${risk?.riskDescription || ''}`.toLowerCase();
  return rows.some((r) => /csv|data integrity/i.test(r.failure_mode + r.potential_effect + r.potential_cause))
    || text.includes('csv')
    || text.includes('data integrity');
}

export function requiresRegulatoryReview(rows: FmeaRow[], risk?: RiskAssessmentRecord): boolean {
  const text = `${risk?.riskCategory || ''} ${risk?.riskDescription || ''}`.toLowerCase();
  return rows.some((r) => /regulatory/i.test(r.potential_effect + r.failure_mode))
    || text.includes('regulatory');
}

export function computeFmeaDashboardMetrics(records: RiskFmeaRecord[]): RiskFmeaDashboardMetrics {
  const rows = records.filter((r) => !r.is_deleted).flatMap((r) => r.rows || []);
  return {
    totalFailureModes: rows.length,
    lowRisks: rows.filter((r) => r.risk_priority === 'Low').length,
    mediumRisks: rows.filter((r) => r.risk_priority === 'Medium').length,
    highRisks: rows.filter((r) => r.risk_priority === 'High').length,
    criticalRisks: rows.filter((r) => r.risk_priority === 'Critical').length,
    mitigationPending: rows.filter((r) => r.mitigation_required && !['Approved', 'Closed'].includes(r.status)).length,
    mitigationCompleted: rows.filter((r) => r.mitigation_required && ['Approved', 'Closed'].includes(r.status)).length,
    residualHighRisks: rows.filter((r) => ['High', 'Critical'].includes(r.residual_risk_priority)).length,
  };
}

export function computeFmeaCharts(records: RiskFmeaRecord[]): RiskFmeaChartData {
  const rows = records.filter((r) => !r.is_deleted).flatMap((r) => r.rows || []).map(enrichFmeaRow);
  const riskDistribution = ['Low', 'Medium', 'High', 'Critical'].map((name) => ({
    name,
    count: rows.filter((r) => r.risk_priority === name).length,
  }));
  const top10Risks = [...rows]
    .sort((a, b) => b.rpn - a.rpn)
    .slice(0, 10)
    .map((r) => ({ name: r.failure_mode.slice(0, 24) || r.failure_mode_id, rpn: r.rpn, residual_rpn: r.residual_rpn }));
  const residualRiskTrend = top10Risks.map((t) => ({ name: t.name, rpn: t.residual_rpn }));
  const mitigationProgress = ['Mitigation Required', 'Mitigation Not Required'].map((name) => ({
    name,
    pending: name === 'Mitigation Required' ? rows.filter((r) => r.mitigation_required && !['Approved', 'Closed'].includes(r.status)).length : 0,
    done: name === 'Mitigation Required' ? rows.filter((r) => r.mitigation_required && ['Approved', 'Closed'].includes(r.status)).length : rows.filter((r) => !r.mitigation_required).length,
  }));
  return { riskDistribution, top10Risks, residualRiskTrend, mitigationProgress };
}

export function buildDefaultFmeaHeader(risk: RiskAssessmentRecord, actorName: string): RiskFmeaHeaderInput {
  return {
    fmea_title: `${risk.riskNumber} FMEA`,
    department: risk.riskCategory || 'QA',
    product: risk.productName || '',
    process_area: risk.processStage || risk.parameterName || 'Process',
    assessment_date: new Date().toISOString().slice(0, 10),
    facilitator: actorName,
    team_members: [actorName, risk.riskOwner].filter(Boolean),
    review_date: new Date().toISOString().slice(0, 10),
    status: 'Draft',
  };
}

export function buildSeedFmeaRow(risk: RiskAssessmentRecord): FmeaRow {
  const base: FmeaRow = {
    failure_mode_id: `FM-${Date.now().toString(36).toUpperCase()}`,
    process_step: risk.processStage || risk.parameterName || 'Process Step',
    failure_mode: risk.riskDescription || 'Potential failure mode',
    potential_effect: risk.potentialImpact || 'Quality impact',
    potential_cause: risk.potentialCause || 'Potential cause',
    existing_control: risk.existingControls || '',
    severity: risk.severityScore,
    occurrence: risk.occurrenceScore,
    detection: risk.detectionScore,
    rpn: 0,
    risk_priority: 'Low',
    mitigation_required: false,
    mitigation_action: risk.mitigationAction || '',
    action_owner: risk.riskOwner || '',
    target_date: risk.targetCompletionDate || '',
    residual_severity: Math.max(1, risk.severityScore - 1),
    residual_occurrence: Math.max(1, risk.occurrenceScore - 1),
    residual_detection: Math.max(1, risk.detectionScore - 1),
    residual_rpn: 0,
    residual_risk_priority: 'Low',
    status: 'Open',
  };
  return enrichFmeaRow(base);
}

export function canViewRiskFmea(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive',
    'risk_manager', 'department_head', 'validation_manager', 'csv_manager',
    'regulatory_affairs', 'auditor', 'viewer',
  ].includes(r);
}

export function canEditRiskFmea(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'risk_manager'].includes(normalizeRole(role || ''));
}

export function canApproveRiskFmea(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(normalizeRole(role || ''));
}

export function isRiskFmeaReadOnly(role?: string | null): boolean {
  return ['auditor', 'viewer'].includes(normalizeRole(role || ''));
}

export function fmeaStatusColor(status?: string): string {
  const map: Record<string, string> = {
    Draft: 'bg-slate-100 text-slate-700',
    Open: 'bg-blue-100 text-blue-800',
    'Under Review': 'bg-amber-100 text-amber-800',
    'Mitigation In Progress': 'bg-orange-100 text-orange-800',
    Approved: 'bg-green-100 text-green-800',
    Closed: 'bg-emerald-100 text-emerald-800',
    Rejected: 'bg-red-100 text-red-800',
  };
  return map[status || ''] || map.Draft;
}
