import { normalizeRole } from '@/lib/permissions';
import { isCapaSatisfiedForClosure } from '@/lib/deviation-capa-records';
import { getCurrentPendingApproval } from '@/lib/deviation-approval-records';
import type { CapaRecord } from '@/lib/capa-types';
import type {
  DeviationApproval,
  DeviationAttachment,
  DeviationCapaLink,
  DeviationClosure,
  DeviationImpactAssessment,
  DeviationInvestigation,
  DeviationRecord,
} from '@/lib/deviation-types';

export type ClosureActor = { id: string; name: string; role?: string; email?: string };

export interface ClosureChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
  warning?: string;
}

export interface ClosureReadiness {
  items: ClosureChecklistItem[];
  completeCount: number;
  totalRequired: number;
  percent: number;
  ready: boolean;
  blockers: string[];
}

export type ClosureFormInput = {
  investigation_completed: boolean;
  impact_assessment_completed: boolean;
  root_cause_identified: boolean;
  capa_required: boolean;
  capa_linked: boolean;
  capa_completed: boolean;
  effectiveness_check_completed: boolean;
  product_quality_impact_resolved: boolean;
  patient_safety_impact_resolved: boolean;
  regulatory_impact_resolved: boolean;
  all_attachments_reviewed: boolean;
  qa_closure_comments: string;
  final_closure_conclusion: string;
};

const INVESTIGATION_DONE = ['Completed', 'Closed', 'QA Review'];

export function investigationIsComplete(inv: DeviationInvestigation | null): boolean {
  if (!inv) return false;
  return INVESTIGATION_DONE.includes(inv.investigation_status || '')
    || Boolean(inv.final_investigation_conclusion?.trim());
}

export function impactAssessmentIsComplete(impact: DeviationImpactAssessment | null): boolean {
  if (!impact) return false;
  return ['Approved', 'Submitted', 'Completed'].includes(impact.status || '')
    || Boolean(impact.conclusion?.trim() && impact.impact_summary?.trim());
}

export function rootCauseIdentified(inv: DeviationInvestigation | null, record: DeviationRecord): boolean {
  return Boolean(
    inv?.root_cause_details?.trim()
    || inv?.root_cause?.trim()
    || record.root_cause?.trim(),
  );
}

export function approvalWorkflowComplete(approvals: DeviationApproval[]): boolean {
  const pending = getCurrentPendingApproval(approvals);
  return !pending;
}

export function hasCriticalRiskOpen(record: DeviationRecord, impact: DeviationImpactAssessment | null): boolean {
  if (record.criticality === 'Critical' && record.status !== 'approved') return true;
  if (impact?.risk_level === 'Critical' && impact.status !== 'Approved') return true;
  return false;
}

export function computeClosureReadiness(input: {
  record: DeviationRecord;
  investigation: DeviationInvestigation | null;
  impact: DeviationImpactAssessment | null;
  capa: CapaRecord | null;
  capaLink: DeviationCapaLink | null;
  approvals: DeviationApproval[];
  attachments: DeviationAttachment[];
  form?: Partial<ClosureFormInput>;
}): ClosureReadiness {
  const { record, investigation, impact, capa, capaLink, approvals, attachments, form } = input;
  const capaRequired = Boolean(record.capa_required || impact?.capa_required);
  const capaLinked = Boolean(record.linked_capa_number || capaLink?.capa_number);
  const capaOk = isCapaSatisfiedForClosure(capa, capaRequired);
  const invComplete = investigationIsComplete(investigation);
  const impactComplete = impactAssessmentIsComplete(impact);
  const rootCause = rootCauseIdentified(investigation, record);
  const capaDecisionDone = record.capa_required !== undefined || impact?.capa_required !== undefined;
  const effectivenessOk = !capa?.effectiveness_check_required
    || ['Effective', 'N/A'].includes(capa?.effectiveness_result || '');
  const qaApprovalDone = approvalWorkflowComplete(approvals);
  const attachmentsOk = attachments.length > 0 && form?.all_attachments_reviewed !== false;
  const noCriticalRisk = !hasCriticalRiskOpen(record, impact);

  const items: ClosureChecklistItem[] = [
    { key: 'investigation', label: 'Investigation completed', complete: invComplete, required: true },
    { key: 'root_cause', label: 'Root cause documented', complete: rootCause, required: true },
    { key: 'impact', label: 'Impact assessment completed', complete: impactComplete, required: true },
    { key: 'capa_decision', label: 'CAPA decision completed', complete: capaDecisionDone, required: true },
    { key: 'capa_linked', label: 'Mandatory CAPA linked', complete: !capaRequired || capaLinked, required: Boolean(capaRequired) },
    { key: 'capa_implemented', label: 'CAPA implemented if required', complete: !capaRequired || capaOk, required: Boolean(capaRequired) },
    { key: 'effectiveness', label: 'Effectiveness check completed if required', complete: effectivenessOk, required: Boolean(capa?.effectiveness_check_required) },
    { key: 'qa_approval', label: 'QA approval completed', complete: qaApprovalDone, required: true },
    { key: 'attachments', label: 'Required attachments uploaded', complete: attachmentsOk, required: true },
    { key: 'critical_risk', label: 'No open critical risk', complete: noCriticalRisk, required: true },
    { key: 'pending_approval', label: 'No pending approval', complete: qaApprovalDone, required: true },
  ];

  const required = items.filter((i) => i.required);
  const completeCount = required.filter((i) => i.complete).length;
  const blockers = required.filter((i) => !i.complete).map((i) => i.label);
  const percent = required.length ? Math.round((completeCount / required.length) * 100) : 0;

  return {
    items,
    completeCount,
    totalRequired: required.length,
    percent,
    ready: blockers.length === 0,
    blockers,
  };
}

export function mapReadinessToClosureFields(
  readiness: ClosureReadiness,
  record: DeviationRecord,
  investigation: DeviationInvestigation | null,
  impact: DeviationImpactAssessment | null,
  capa: CapaRecord | null,
  form: ClosureFormInput,
): Omit<DeviationClosure, 'id' | 'created_at' | 'updated_at'> {
  const get = (key: string) => readiness.items.find((i) => i.key === key)?.complete ?? false;
  return {
    closure_id: '',
    deviation_id: record.id,
    deviation_number: record.deviation_number,
    closure_date: null,
    closed_by: '',
    closed_by_name: '',
    department: record.department,
    investigation_completed: get('investigation'),
    impact_assessment_completed: get('impact'),
    root_cause_identified: get('root_cause'),
    capa_required: record.capa_required,
    capa_linked: get('capa_linked'),
    capa_completed: get('capa_implemented'),
    effectiveness_check_completed: get('effectiveness'),
    product_quality_impact_resolved: form.product_quality_impact_resolved,
    patient_safety_impact_resolved: form.patient_safety_impact_resolved,
    regulatory_impact_resolved: form.regulatory_impact_resolved,
    all_attachments_reviewed: form.all_attachments_reviewed,
    qa_closure_comments: form.qa_closure_comments,
    final_closure_conclusion: form.final_closure_conclusion,
    closure_status: readiness.ready ? 'Ready For Closure' : 'Pending',
    e_signature_required: true,
    signed_by: '',
    signed_date: null,
    readiness_percent: readiness.percent,
    created_by: '',
    created_by_name: '',
    updated_by: '',
    updated_by_name: '',
    is_deleted: false,
  };
}

export function canViewClosure(role?: string | null): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'auditor', 'viewer'].includes(r)) return true;
  return ['qc_manager', 'qc', 'production_manager', 'production', 'engineering_manager', 'engineering',
    'warehouse_manager', 'warehouse'].includes(r);
}

export function canReviewClosure(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(normalizeRole(role));
}

export function canCloseDeviationRecord(role?: string | null, criticality?: string): boolean {
  const r = normalizeRole(role);
  if (['super_admin', 'admin'].includes(r)) return true;
  if (criticality === 'Critical') return r === 'head_qa';
  return ['head_qa', 'qa_manager', 'qa'].includes(r);
}

export function canReopenClosure(role?: string | null): boolean {
  return ['super_admin', 'head_qa'].includes(normalizeRole(role));
}

export function closureStatusColor(status: string): string {
  const map: Record<string, string> = {
    Pending: 'bg-slate-100 text-slate-700',
    'Ready For Closure': 'bg-blue-100 text-blue-800',
    'QA Review': 'bg-purple-100 text-purple-800',
    Closed: 'bg-green-100 text-green-800',
    Rejected: 'bg-red-100 text-red-800',
    Reopened: 'bg-amber-100 text-amber-800',
  };
  return map[status] || map.Pending;
}

export function mapClosureHistory(auditLogs: Record<string, unknown>[]) {
  return auditLogs
    .filter((l) => /closure|close|reopen|e-sign/i.test(String(l.action || l.actionType || '')))
    .map((l) => ({
      date: String(l.dateTime || l.created_at || ''),
      title: String(l.action || l.actionType || 'Event'),
      description: String(l.reason || l.actionDescription || ''),
      user: String(l.userName || l.user_name || ''),
    }));
}
