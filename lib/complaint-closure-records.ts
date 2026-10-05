import { normalizeRole } from '@/lib/permissions';
import { getCurrentPendingComplaintApproval } from '@/lib/complaint-approval-records';
import {
  canCloseComplaintWithCapa,
  computeComplaintCapaMandatory,
  isComplaintCapaSatisfiedForClosure,
} from '@/lib/complaint-capa-records';
import type { CapaRecord } from '@/lib/capa-types';
import type {
  ComplaintApproval,
  ComplaintAttachment,
  ComplaintCapaLink,
  ComplaintClosure,
  ComplaintImpactAssessment,
  ComplaintInvestigation,
  ComplaintRecord,
} from '@/lib/complaint-types';

export const COMPLAINT_CLOSURE_MODULE = 'Complaint Closure';

export type ComplaintClosureActor = { id: string; name: string; role?: string; email?: string };

export interface ComplaintClosureChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
  warning?: string;
}

export interface ComplaintClosureReadiness {
  items: ComplaintClosureChecklistItem[];
  completeCount: number;
  totalRequired: number;
  percent: number;
  ready: boolean;
  blockers: string[];
}

export type ComplaintClosureFormInput = {
  investigation_completed: boolean;
  impact_assessment_completed: boolean;
  capa_required: boolean;
  capa_linked: boolean;
  capa_completed: boolean;
  recall_evaluation_required: boolean;
  recall_evaluation_completed: boolean;
  customer_response_required: boolean;
  customer_response_sent: boolean;
  product_quality_impact_resolved: boolean;
  patient_safety_impact_resolved: boolean;
  regulatory_impact_resolved: boolean;
  all_attachments_reviewed: boolean;
  qa_closure_comments: string;
  final_complaint_conclusion: string;
};

const INVESTIGATION_DONE = ['Completed', 'CAPA Required', 'Recall Evaluation'];

function impactYes(value?: string | boolean): boolean {
  if (typeof value === 'boolean') return value;
  return value === 'Yes';
}

export function investigationIsComplete(inv: ComplaintInvestigation | null): boolean {
  if (!inv) return false;
  return INVESTIGATION_DONE.includes(inv.investigation_status || '')
    || Boolean(inv.conclusion?.trim());
}

export function impactAssessmentIsComplete(impact: ComplaintImpactAssessment | null): boolean {
  if (!impact) return false;
  return impact.status === 'Approved';
}

export function recallEvaluationRequired(
  record: ComplaintRecord,
  impact?: ComplaintImpactAssessment | null,
): boolean {
  return Boolean(
    record.recall_evaluation_required
    || record.recall_required
    || impact?.recall_evaluation_required,
  );
}

export function customerResponseRequired(record: ComplaintRecord): boolean {
  return record.received_from !== 'Internal' && Boolean(record.customer_name?.trim());
}

export function capaDecisionComplete(
  record: ComplaintRecord,
  impact?: ComplaintImpactAssessment | null,
  inv?: ComplaintInvestigation | null,
): boolean {
  return record.capa_required !== undefined
    || impact?.capa_required !== undefined
    || inv?.capa_required !== undefined;
}

export function complaintApprovalWorkflowComplete(approvals: ComplaintApproval[]): boolean {
  const active = approvals.filter((a) => !a.is_deleted);
  if (active.length === 0) return false;

  const pending = getCurrentPendingComplaintApproval(approvals);
  if (pending?.current_workflow_step === 'Closed') {
    return active
      .filter((a) => a.current_workflow_step !== 'Closed')
      .every((a) => ['Approved', 'Completed'].includes(a.approval_status || ''));
  }
  if (pending) return false;

  const closedStep = active.find((a) => a.current_workflow_step === 'Closed');
  if (closedStep) return closedStep.approval_status === 'Approved';

  return active.every((a) => ['Approved', 'Completed'].includes(a.approval_status || ''));
}

export function computeComplaintClosureReadiness(input: {
  record: ComplaintRecord;
  investigation: ComplaintInvestigation | null;
  impact: ComplaintImpactAssessment | null;
  capa: CapaRecord | null;
  capaLink: ComplaintCapaLink | null;
  approvals: ComplaintApproval[];
  attachments: ComplaintAttachment[];
  recallComplete: boolean;
  form?: Partial<ComplaintClosureFormInput>;
}): ComplaintClosureReadiness {
  const { record, investigation, impact, capa, capaLink, approvals, attachments, recallComplete, form } = input;
  const capaMandatory = computeComplaintCapaMandatory(record, impact);
  const capaRequired = form?.capa_required ?? capaMandatory;
  const capaLinked = Boolean(record.linked_capa_number || capaLink?.capa_number || form?.capa_linked);
  const capaOk = isComplaintCapaSatisfiedForClosure(capa, capaRequired);
  const capaCheck = canCloseComplaintWithCapa(record, capaLink, capa, impact);
  const invComplete = form?.investigation_completed ?? investigationIsComplete(investigation);
  const impactComplete = form?.impact_assessment_completed ?? impactAssessmentIsComplete(impact);
  const capaDecisionDone = capaDecisionComplete(record, impact, investigation);
  const recallReq = form?.recall_evaluation_required ?? recallEvaluationRequired(record, impact);
  const recallDone = form?.recall_evaluation_completed ?? (recallComplete || !recallReq);
  const custReq = form?.customer_response_required ?? customerResponseRequired(record);
  const custSent = form?.customer_response_sent ?? false;
  const qaApprovalDone = complaintApprovalWorkflowComplete(approvals);
  const attachmentsOk = form?.all_attachments_reviewed ?? attachments.length > 0;

  const items: ComplaintClosureChecklistItem[] = [
    { key: 'investigation', label: 'Investigation completed', complete: invComplete, required: true },
    { key: 'impact', label: 'Impact assessment completed', complete: impactComplete, required: true },
    { key: 'capa_decision', label: 'CAPA decision completed', complete: capaDecisionDone, required: true },
    {
      key: 'capa_linked',
      label: 'Mandatory CAPA linked',
      complete: !capaRequired || capaLinked,
      required: capaRequired,
      warning: capaRequired && !capaLinked ? 'Link and close mandatory CAPA before complaint closure.' : undefined,
    },
    {
      key: 'capa_implemented',
      label: 'Mandatory CAPA closed',
      complete: !capaRequired || (capaOk && (form?.capa_completed ?? capaOk)),
      required: capaRequired,
      warning: capaCheck.reason,
    },
    {
      key: 'recall',
      label: 'Recall evaluation completed if required',
      complete: recallDone,
      required: recallReq,
      warning: recallReq && !recallDone ? 'Complete recall evaluation before closure.' : undefined,
    },
    {
      key: 'customer_response',
      label: 'Customer response completed if required',
      complete: !custReq || custSent,
      required: custReq,
      warning: custReq && !custSent ? 'Confirm customer response has been sent.' : undefined,
    },
    { key: 'qa_approval', label: 'QA approval completed', complete: qaApprovalDone, required: true },
    { key: 'attachments', label: 'All attachments reviewed', complete: attachmentsOk, required: true },
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

export function mapReadinessToComplaintClosureFields(
  readiness: ComplaintClosureReadiness,
  record: ComplaintRecord,
  impact: ComplaintImpactAssessment | null,
  form: ComplaintClosureFormInput,
): Omit<ComplaintClosure, 'id' | 'created_at' | 'updated_at'> {
  const get = (key: string) => readiness.items.find((i) => i.key === key)?.complete ?? false;
  const capaMandatory = computeComplaintCapaMandatory(record, impact);
  return {
    closure_id: '',
    complaint_id: record.id,
    complaint_number: record.complaint_number,
    closure_date: null,
    closed_by: '',
    closed_by_name: '',
    investigation_completed: get('investigation'),
    impact_assessment_completed: get('impact'),
    capa_required: capaMandatory,
    capa_linked: get('capa_linked'),
    capa_completed: get('capa_implemented'),
    recall_evaluation_required: form.recall_evaluation_required,
    recall_evaluation_completed: get('recall'),
    product_quality_impact_resolved: form.product_quality_impact_resolved,
    patient_safety_impact_resolved: form.patient_safety_impact_resolved,
    regulatory_impact_resolved: form.regulatory_impact_resolved,
    customer_response_required: form.customer_response_required,
    customer_response_sent: form.customer_response_sent,
    final_complaint_conclusion: form.final_complaint_conclusion,
    qa_closure_comments: form.qa_closure_comments,
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

export function defaultComplaintClosureForm(
  record: ComplaintRecord,
  investigation: ComplaintInvestigation | null,
  impact: ComplaintImpactAssessment | null,
  capaLink: ComplaintCapaLink | null,
  capa: CapaRecord | null,
  attachments: ComplaintAttachment[],
  recallComplete: boolean,
  closure?: ComplaintClosure | null,
): ComplaintClosureFormInput {
  const capaMandatory = computeComplaintCapaMandatory(record, impact);
  const recallReq = recallEvaluationRequired(record, impact);
  const custReq = customerResponseRequired(record);
  return {
    investigation_completed: investigationIsComplete(investigation),
    impact_assessment_completed: impactAssessmentIsComplete(impact),
    capa_required: capaMandatory,
    capa_linked: Boolean(record.linked_capa_number || capaLink?.capa_number),
    capa_completed: isComplaintCapaSatisfiedForClosure(capa, capaMandatory),
    recall_evaluation_required: recallReq,
    recall_evaluation_completed: recallComplete || !recallReq,
    customer_response_required: custReq,
    customer_response_sent: closure?.customer_response_sent ?? false,
    product_quality_impact_resolved: closure?.product_quality_impact_resolved
      ?? !impactYes(impact?.product_quality_impact ?? record.product_quality_impact),
    patient_safety_impact_resolved: closure?.patient_safety_impact_resolved
      ?? !(impactYes(impact?.patient_safety_impact) || record.product_safety_impact),
    regulatory_impact_resolved: closure?.regulatory_impact_resolved
      ?? !impactYes(impact?.regulatory_impact ?? record.regulatory_impact),
    all_attachments_reviewed: attachments.length > 0,
    qa_closure_comments: closure?.qa_closure_comments || '',
    final_complaint_conclusion: closure?.final_complaint_conclusion || '',
  };
}

export function canViewComplaintClosure(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'auditor', 'viewer'].includes(r)) return true;
  return ['regulatory_affairs', 'qc_manager', 'qc'].includes(r);
}

export function canReviewComplaintClosure(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa'].includes(normalizeRole(role || ''));
}

export function canReviewRegulatoryClosureImpact(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'regulatory_affairs'].includes(r);
}

export function canCloseComplaintRecord(role?: string | null, criticality?: string): boolean {
  const r = normalizeRole(role || '');
  if (['super_admin', 'admin'].includes(r)) return true;
  if (criticality === 'Critical') return r === 'head_qa';
  return ['head_qa', 'qa_manager', 'qa'].includes(r);
}

export function canReopenComplaintClosure(role?: string | null): boolean {
  return ['super_admin', 'head_qa'].includes(normalizeRole(role || ''));
}

export function isComplaintClosureReadOnly(role?: string | null, status?: string): boolean {
  if (normalizeRole(role || '') === 'auditor') return true;
  return status === 'closed';
}

export function complaintClosureStatusColor(status: string): string {
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

export function mapComplaintClosureHistory(auditLogs: Record<string, unknown>[]) {
  return auditLogs
    .filter((l) => /closure|close|reopen|e-sign|customer response/i.test(String(l.action || l.actionType || '')))
    .map((l) => ({
      date: String(l.dateTime || l.created_at || ''),
      title: String(l.action || l.actionType || 'Event'),
      description: String(l.reason || l.actionDescription || ''),
      user: String(l.userName || l.user_name || ''),
    }));
}
