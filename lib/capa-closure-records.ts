import { normalizeRole } from '@/lib/permissions';
import {
  requiresHeadQaApproval,
  type CapaApproval,
  type CapaClosure,
  type CapaClosureDashboardMetrics,
  type CapaClosureTimelineEntry,
  type CapaCorrectiveAction,
  type CapaEffectiveness,
  type CapaPreventiveAction,
  type CapaRecord,
} from '@/lib/capa-types';
import { getCurrentPendingCapaApproval } from '@/lib/capa-approval-records';
import { isInvestigationApproved } from '@/lib/capa-investigation-records';

export const CAPA_CLOSURE_MODULE = 'CAPA Closure';

const CLOSED_ACTION_STATUSES = ['closed', 'approved'];

export type CapaClosureActor = { id: string; name: string; role?: string; email?: string };

export interface CapaClosureChecklistItem {
  key: string;
  label: string;
  complete: boolean;
  required: boolean;
  warning?: string;
}

export interface CapaClosureReadiness {
  items: CapaClosureChecklistItem[];
  completeCount: number;
  totalRequired: number;
  percent: number;
  ready: boolean;
  blockers: string[];
}

export interface CapaClosureFormInput {
  corrective_actions_completed: boolean;
  preventive_actions_completed: boolean;
  implementation_verified: boolean;
  evidence_uploaded: boolean;
  effectiveness_check_completed: boolean;
  effectiveness_result: string;
  risk_reduced: boolean;
  root_cause_eliminated: boolean;
  recurrence_prevented: boolean;
  training_completed: boolean;
  sop_updated: boolean;
  change_control_completed: boolean;
  all_evidence_reviewed: boolean;
  qa_closure_comments: string;
  head_qa_comments?: string;
  final_closure_conclusion: string;
}

export function allCorrectiveActionsClosed(actions: CapaCorrectiveAction[]): boolean {
  const active = actions.filter((a) => !a.is_deleted);
  if (!active.length) return false;
  return active.every((a) => CLOSED_ACTION_STATUSES.includes(a.action_status));
}

export function allPreventiveActionsClosed(actions: CapaPreventiveAction[]): boolean {
  const active = actions.filter((a) => !a.is_deleted);
  if (!active.length) return false;
  return active.every((a) => CLOSED_ACTION_STATUSES.includes(a.action_status));
}

export function trainingRequirementsMet(actions: CapaPreventiveAction[]): boolean {
  const required = actions.filter((a) => !a.is_deleted && a.training_required);
  if (!required.length) return true;
  return required.every((a) => Boolean(a.training_record_id || a.training_reference?.trim()));
}

export function sopRequirementsMet(actions: CapaPreventiveAction[]): boolean {
  const required = actions.filter((a) => !a.is_deleted && a.sop_revision_required);
  if (!required.length) return true;
  return required.every((a) => Boolean(a.sop_record_id || a.sop_reference?.trim()));
}

export function changeControlRequirementsMet(actions: CapaPreventiveAction[]): boolean {
  const required = actions.filter((a) => !a.is_deleted && a.change_control_required);
  if (!required.length) return true;
  return required.every((a) => Boolean(a.change_control_id || a.change_control_reference?.trim()));
}

export function computeCapaClosureReadiness(input: {
  capa: CapaRecord;
  investigationStatus?: string | null;
  correctiveActions: CapaCorrectiveAction[];
  preventiveActions: CapaPreventiveAction[];
  effectiveness?: CapaEffectiveness | null;
  approvals: CapaApproval[];
  attachmentCount: number;
  form?: Partial<CapaClosureFormInput>;
}): CapaClosureReadiness {
  const { capa, investigationStatus, correctiveActions, preventiveActions, effectiveness, approvals, attachmentCount, form } = input;

  const rcaApproved = isInvestigationApproved(investigationStatus);
  const caComplete = allCorrectiveActionsClosed(correctiveActions);
  const paComplete = allPreventiveActionsClosed(preventiveActions);
  const evidenceOk = attachmentCount > 0 && form?.evidence_uploaded !== false;
  const effRequired = capa.effectiveness_check_required;
  const effResult = effectiveness?.effectiveness_result || effectiveness?.result || capa.effectiveness_result || 'Pending';
  const effComplete = !effRequired || effResult === 'Effective' || effResult === 'N/A';
  const effApproved = effComplete && effResult !== 'Not Effective' && effResult !== 'Partially Effective';
  const trainingOk = trainingRequirementsMet(preventiveActions);
  const sopOk = sopRequirementsMet(preventiveActions);
  const ccOk = changeControlRequirementsMet(preventiveActions);
  const qaApprovalDone = !getCurrentPendingCapaApproval(approvals);

  const trainingRequired = preventiveActions.some((a) => !a.is_deleted && a.training_required);
  const sopRequired = preventiveActions.some((a) => !a.is_deleted && a.sop_revision_required);
  const ccRequired = preventiveActions.some((a) => !a.is_deleted && a.change_control_required);

  const items: CapaClosureChecklistItem[] = [
    { key: 'rca', label: 'RCA Approved', complete: rcaApproved, required: true },
    { key: 'ca', label: 'Corrective Actions Completed', complete: caComplete, required: true, warning: 'All corrective actions must be closed' },
    { key: 'pa', label: 'Preventive Actions Completed', complete: paComplete, required: true, warning: 'All preventive actions must be closed' },
    { key: 'evidence', label: 'Evidence Uploaded', complete: evidenceOk, required: true },
    { key: 'effectiveness', label: 'Effectiveness Review Completed', complete: effComplete, required: effRequired, warning: effRequired ? 'Effectiveness check must be completed' : undefined },
    { key: 'eff_result', label: 'Effectiveness Result Approved', complete: effApproved && effResult !== 'Not Effective', required: effRequired, warning: effResult === 'Not Effective' ? 'Not Effective — new CAPA recommended' : undefined },
    { key: 'training', label: 'Training Completed (if required)', complete: trainingOk, required: trainingRequired },
    { key: 'sop', label: 'SOP Updated (if required)', complete: sopOk, required: sopRequired },
    { key: 'cc', label: 'Change Control Closed (if required)', complete: ccOk, required: ccRequired },
    { key: 'qa_approval', label: 'QA Approval Completed', complete: qaApprovalDone, required: true },
  ];

  const required = items.filter((i) => i.required);
  const completeCount = required.filter((i) => i.complete).length;
  const blockers = required.filter((i) => !i.complete).map((i) => i.label);
  const percent = required.length ? Math.round((completeCount / required.length) * 100) : 0;

  return { items, completeCount, totalRequired: required.length, percent, ready: blockers.length === 0, blockers };
}

export function computeClosureDecision(form: CapaClosureFormInput): {
  status: string;
  recommendation?: string;
  newCapaRecommended?: boolean;
  additionalMonitoring?: boolean;
} {
  if (form.effectiveness_result === 'Not Effective') {
    return { status: 'Rejected', recommendation: 'Recommend New CAPA Creation', newCapaRecommended: true };
  }
  if (form.effectiveness_result === 'Partially Effective') {
    if (form.corrective_actions_completed && form.preventive_actions_completed && form.risk_reduced) {
      return { status: 'Ready For Closure', recommendation: 'Recommend Additional Monitoring', additionalMonitoring: true };
    }
    return { status: 'Pending', recommendation: 'Recommend Additional Monitoring', additionalMonitoring: true };
  }
  if (
    form.corrective_actions_completed
    && form.preventive_actions_completed
    && form.effectiveness_result === 'Effective'
    && form.risk_reduced
    && form.recurrence_prevented
  ) {
    return { status: 'Ready For Closure' };
  }
  return { status: 'Pending' };
}

export function closureStatusColor(status?: string): string {
  const map: Record<string, string> = {
    Pending: 'bg-slate-100 text-slate-700',
    'Ready For Closure': 'bg-blue-100 text-blue-800',
    'QA Review': 'bg-amber-100 text-amber-800',
    'Head QA Review': 'bg-purple-100 text-purple-800',
    Closed: 'bg-green-100 text-green-800',
    Rejected: 'bg-red-100 text-red-800',
    Reopened: 'bg-orange-100 text-orange-800',
  };
  return map[status || ''] || map.Pending;
}

export function canViewCapaClosure(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'auditor', 'viewer'].includes(r)) return true;
  return ['qc_manager', 'qc', 'production_manager', 'production'].includes(r);
}

export function isCapaClosureReadOnly(role?: string | null): boolean {
  return ['auditor', 'viewer'].includes(normalizeRole(role || ''));
}

export function canReviewCapaClosure(role?: string | null): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive'].includes(normalizeRole(role || ''));
}

export function canApproveCapaClosure(role?: string | null, capa?: CapaRecord): boolean {
  if (requiresHeadQaApproval(capa?.priority || '', capa)) {
    return ['super_admin', 'head_qa'].includes(normalizeRole(role || ''));
  }
  return canReviewCapaClosure(role);
}

export function canReopenCapaClosure(role?: string | null): boolean {
  return ['super_admin', 'head_qa'].includes(normalizeRole(role || ''));
}

export function computeCapaClosureDashboardMetrics(
  closures: CapaClosure[],
  capas: CapaRecord[] = [],
): CapaClosureDashboardMetrics {
  const active = closures.filter((c) => !c.is_deleted);
  return {
    readyForClosure: active.filter((c) => c.closure_status === 'Ready For Closure').length
      + capas.filter((r) => ['approved', 'effectiveness_completed'].includes(r.capa_status) && r.capa_status !== 'closed').length,
    pendingReview: active.filter((c) => ['Pending', 'QA Review', 'Head QA Review'].includes(c.closure_status)).length,
    closed: active.filter((c) => c.closure_status === 'Closed').length + capas.filter((r) => r.capa_status === 'closed').length,
    rejected: active.filter((c) => c.closure_status === 'Rejected').length,
    reopened: active.filter((c) => c.closure_status === 'Reopened').length,
    effectiveClosures: active.filter((c) => c.effectiveness_result === 'Effective' && c.closure_status === 'Closed').length,
    partiallyEffective: active.filter((c) => c.effectiveness_result === 'Partially Effective').length,
    notEffective: active.filter((c) => c.effectiveness_result === 'Not Effective' || c.new_capa_recommended).length,
  };
}

export function mapClosureAuditToTimeline(logs: Record<string, unknown>[]): CapaClosureTimelineEntry[] {
  return logs
    .filter((log) => /closure|close|reopen|checklist|e-sign|esign|monitor|capa recommended/i.test(String(log.actionType || log.action || '')))
    .map((log) => ({
      action: String(log.actionType || log.action || 'Activity'),
      user: String(log.userName || log.user_name || 'System'),
      at: String(log.dateTime || log.timestamp || log.created_at || ''),
      detail: String(log.reason || log.actionDescription || '').slice(0, 240),
    }))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export function capaClosureMeaning(action: 'close' | 'reopen' = 'close'): string {
  return action === 'reopen'
    ? 'I authorize reopening this CAPA record.'
    : 'I provide final closure authorization for this CAPA.';
}
