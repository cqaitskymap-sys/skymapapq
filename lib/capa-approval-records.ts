import { normalizeRole } from '@/lib/permissions';
import {
  requiresHeadQaApproval,
  type CapaApproval,
  type CapaApprovalDashboardCounts,
  type CapaApprovalHistoryEntry,
  type CapaApprovalTimelineEntry,
  type CapaRecord,
} from '@/lib/capa-types';

export const CAPA_APPROVAL_MODULE = 'CAPA Approval Workflow';

export const CAPA_APPROVAL_MEANINGS = [
  'I have reviewed this CAPA.',
  'I approve this CAPA.',
  'I reject this CAPA.',
  'I provide final approval for this CAPA.',
] as const;

export interface CapaWorkflowStepDef {
  level: number;
  stepName: string;
  approverRole: string;
  dueDays: number;
  eSignatureRequired: boolean;
  commentRequired: boolean;
}

export interface CapaWorkflowContext {
  rcaApproved: boolean;
  correctiveActionCount: number;
  preventiveActionCount: number;
  effectivenessRequired: boolean;
  effectivenessCompleted: boolean;
  headQaRequired: boolean;
}

export function computeHeadQaRequiredForCapa(capa: CapaRecord): boolean {
  return requiresHeadQaApproval(capa.priority, capa);
}

export function buildCapaWorkflowContext(
  capa: CapaRecord,
  rcaApproved: boolean,
  correctiveCount: number,
  preventiveCount: number,
  effectivenessCompleted: boolean,
): CapaWorkflowContext {
  return {
    rcaApproved,
    correctiveActionCount: correctiveCount,
    preventiveActionCount: preventiveCount,
    effectivenessRequired: Boolean(capa.effectiveness_check_required),
    effectivenessCompleted,
    headQaRequired: computeHeadQaRequiredForCapa(capa),
  };
}

export function buildCapaWorkflowSteps(ctx: CapaWorkflowContext): CapaWorkflowStepDef[] {
  const steps: CapaWorkflowStepDef[] = [
    { level: 1, stepName: 'Submitted', approverRole: 'capa_owner', dueDays: 1, eSignatureRequired: false, commentRequired: false },
    { level: 2, stepName: 'Department Head Review', approverRole: 'department_head', dueDays: 5, eSignatureRequired: true, commentRequired: true },
    { level: 3, stepName: 'QA Review', approverRole: 'qa', dueDays: 7, eSignatureRequired: true, commentRequired: true },
    { level: 4, stepName: 'QA Manager Review', approverRole: 'qa_manager', dueDays: 7, eSignatureRequired: true, commentRequired: true },
  ];
  if (ctx.headQaRequired) {
    steps.push({ level: steps.length + 1, stepName: 'Head QA Review', approverRole: 'head_qa', dueDays: 5, eSignatureRequired: true, commentRequired: true });
  }
  steps.push({ level: steps.length + 1, stepName: 'Final Approval', approverRole: 'qa_manager', dueDays: 5, eSignatureRequired: true, commentRequired: true });
  if (ctx.effectivenessRequired) {
    steps.push({ level: steps.length + 1, stepName: 'Effectiveness Review', approverRole: 'qa', dueDays: 14, eSignatureRequired: true, commentRequired: true });
  }
  steps.push({
    level: steps.length + 1,
    stepName: 'Closure Approval',
    approverRole: ctx.headQaRequired ? 'head_qa' : 'qa_manager',
    dueDays: 5,
    eSignatureRequired: true,
    commentRequired: true,
  });
  return steps.map((s, i) => ({ ...s, level: i + 1 }));
}

export function roleMatchesCapaStep(userRole: string | undefined, stepRole: string, capaOwnerId?: string, userId?: string): boolean {
  if (!userRole) return false;
  const u = normalizeRole(userRole);
  if (['super_admin', 'admin'].includes(u)) return true;
  if (stepRole === 'capa_owner') {
    return userId === capaOwnerId || ['production_executive', 'qc_executive'].includes(u);
  }
  if (stepRole === 'department_head') {
    return ['production_manager', 'qc_manager', 'engineering_manager', 'department_head'].includes(u);
  }
  if (stepRole === 'qa') return ['qa', 'qa_executive', 'qa_manager'].includes(u);
  if (stepRole === 'qa_manager') return ['qa_manager', 'head_qa'].includes(u);
  if (stepRole === 'head_qa') return u === 'head_qa';
  return u === stepRole;
}

export function canActOnCapaApproval(
  role: string | undefined,
  stepRole: string | undefined,
  capaOwnerId?: string,
  userId?: string,
): boolean {
  if (!stepRole) return false;
  return roleMatchesCapaStep(role, stepRole, capaOwnerId, userId);
}

export function getCurrentPendingCapaApproval(approvals: CapaApproval[]): CapaApproval | null {
  return approvals
    .filter((a) => !a.is_deleted && ['Pending', 'Escalated'].includes(a.approval_status || ''))
    .sort((a, b) => Number(a.approval_level) - Number(b.approval_level))[0] || null;
}

export function mapCapaStatusForStep(stepName: string, action: string): string {
  if (action === 'reject') return 'rejected';
  if (action === 'send_back') return 'submitted';
  if (stepName === 'Submitted') return 'submitted';
  if (stepName === 'Department Head Review') return 'submitted';
  if (stepName === 'QA Review') return 'qa_review';
  if (stepName === 'QA Manager Review') return 'qa_review';
  if (stepName === 'Head QA Review') return 'qa_review';
  if (stepName === 'Final Approval' && action === 'approve') return 'approved';
  if (stepName === 'Effectiveness Review') return 'effectiveness_completed';
  if (stepName === 'Closure Approval' && action === 'approve') return 'closed';
  return 'qa_review';
}

export function validateCapaApprovalAction(
  stepName: string,
  ctx: CapaWorkflowContext,
): { ok: boolean; error?: string } {
  if (!ctx.rcaApproved) {
    return { ok: false, error: 'Approved RCA is required before CAPA approval workflow.' };
  }
  if (ctx.correctiveActionCount < 1) {
    return { ok: false, error: 'Corrective action plan must exist before approval.' };
  }
  if (ctx.preventiveActionCount < 1) {
    return { ok: false, error: 'Preventive action plan must exist before approval.' };
  }
  if (stepName === 'Effectiveness Review' && ctx.effectivenessRequired && !ctx.effectivenessCompleted) {
    return { ok: false, error: 'Effectiveness review must be completed before this step.' };
  }
  if (stepName === 'Closure Approval' && ctx.effectivenessRequired && !ctx.effectivenessCompleted) {
    return { ok: false, error: 'Effectiveness review must be completed before closure approval.' };
  }
  return { ok: true };
}

export function daysPendingCapaApproval(approval: CapaApproval): number {
  const start = approval.created_at || approval.signed_at;
  if (!start) return 0;
  const ms = Date.now() - new Date(String(start)).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

export function capaApprovalPriority(capa?: CapaRecord | null, daysPending = 0): string {
  if (capa?.priority === 'critical') return 'critical';
  if (daysPending > 7) return 'high';
  if (capa?.priority === 'high') return 'high';
  return capa?.priority || 'medium';
}

export function canViewCapaApproval(role?: string | null): boolean {
  const r = normalizeRole(role || '');
  if (['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'qa_executive', 'auditor', 'viewer'].includes(r)) return true;
  if (['qc_manager', 'qc', 'production_manager', 'production'].includes(r)) return true;
  return false;
}

export function isCapaApprovalReadOnly(role?: string | null): boolean {
  return ['auditor', 'viewer'].includes(normalizeRole(role || ''));
}

export function canReopenCapa(role?: string | null): boolean {
  return ['super_admin', 'head_qa'].includes(normalizeRole(role || ''));
}

export function isCapaRecordLocked(capa: CapaRecord): boolean {
  return Boolean(capa.is_locked) || capa.capa_status === 'closed';
}

export function approvalStatusLabel(status?: string): string {
  const map: Record<string, string> = {
    Pending: 'Pending', Approved: 'Approved', Rejected: 'Rejected',
    'Sent Back': 'Sent Back', Escalated: 'Escalated', Waiting: 'Waiting', Completed: 'Completed',
  };
  return map[status || ''] || status || 'Pending';
}

export function approvalStatusColor(status?: string): string {
  const map: Record<string, string> = {
    Pending: 'bg-amber-100 text-amber-800',
    Approved: 'bg-green-100 text-green-800',
    Rejected: 'bg-red-100 text-red-800',
    'Sent Back': 'bg-orange-100 text-orange-800',
    Escalated: 'bg-purple-100 text-purple-800',
    Waiting: 'bg-slate-100 text-slate-700',
    Completed: 'bg-emerald-100 text-emerald-800',
  };
  return map[status || ''] || map.Pending;
}

export function workflowStepColor(step?: string): string {
  const map: Record<string, string> = {
    Submitted: 'bg-blue-100 text-blue-800',
    'Department Head Review': 'bg-indigo-100 text-indigo-800',
    'QA Review': 'bg-purple-100 text-purple-800',
    'QA Manager Review': 'bg-violet-100 text-violet-800',
    'Head QA Review': 'bg-red-100 text-red-800',
    'Final Approval': 'bg-green-100 text-green-800',
    'Effectiveness Review': 'bg-teal-100 text-teal-800',
    'Closure Approval': 'bg-emerald-100 text-emerald-800',
  };
  return map[step || ''] || 'bg-slate-100 text-slate-700';
}

export function roleBadgeColor(role?: string): string {
  const map: Record<string, string> = {
    capa_owner: 'bg-slate-100 text-slate-700',
    department_head: 'bg-indigo-100 text-indigo-800',
    qa: 'bg-purple-100 text-purple-800',
    qa_manager: 'bg-violet-100 text-violet-800',
    head_qa: 'bg-red-100 text-red-800',
  };
  return map[role || ''] || 'bg-slate-100 text-slate-700';
}

export function computeCapaApprovalDashboardCounts(
  approvals: CapaApproval[],
  history: CapaApprovalHistoryEntry[],
  records: CapaRecord[],
  actorId: string,
  role?: string,
): CapaApprovalDashboardCounts {
  const today = new Date().toISOString().split('T')[0];
  const pending = approvals.filter((a) => !a.is_deleted && ['Pending', 'Escalated'].includes(a.approval_status || ''));
  const recordMap = new Map(records.map((r) => [r.id, r]));

  const myPending = pending.filter((a) => {
    const capa = recordMap.get(a.capa_id);
    return canActOnCapaApproval(role, a.current_role || a.current_approver_role, capa?.action_owner, actorId)
      || a.current_approver === actorId;
  });

  const capaIdsApproved = new Set(history.filter((h) => h.action === 'Approved' || h.action === 'Final Approval').map((h) => h.capa_id));
  const capaIdsRejected = new Set(history.filter((h) => h.action === 'Rejected').map((h) => h.capa_id));
  const capaIdsSentBack = new Set(history.filter((h) => h.action === 'Sent Back').map((h) => h.capa_id));

  return {
    pendingApprovals: pending.length,
    myPendingApprovals: myPending.length,
    approvedCapa: capaIdsApproved.size,
    rejectedCapa: capaIdsRejected.size,
    sentBackCapa: capaIdsSentBack.size,
    criticalPending: pending.filter((a) => recordMap.get(a.capa_id)?.priority === 'critical').length,
    overdueApprovals: pending.filter((a) => a.due_date && a.due_date < today).length,
    headQaPending: pending.filter((a) => (a.current_role || a.current_approver_role) === 'head_qa').length,
    readyForClosure: records.filter((r) => r.capa_status === 'approved' && !r.is_locked).length,
  };
}

export function mapHistoryToCapaApprovalTimeline(history: CapaApprovalHistoryEntry[]): CapaApprovalTimelineEntry[] {
  return history
    .filter((h) => !h.is_deleted)
    .map((h) => ({
      action: h.action,
      user: h.user_name,
      at: h.created_at,
      detail: h.comments || h.rejection_reason || h.send_back_reason || '',
      workflow_step: h.workflow_step,
    }))
    .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}

export function capaApprovalMeaning(step?: string, action: 'approve' | 'reject' = 'approve'): string {
  if (action === 'reject') return CAPA_APPROVAL_MEANINGS[2];
  if (step === 'Head QA Review' || step === 'Closure Approval') return CAPA_APPROVAL_MEANINGS[3];
  if (step === 'Final Approval') return CAPA_APPROVAL_MEANINGS[1];
  return CAPA_APPROVAL_MEANINGS[0];
}
