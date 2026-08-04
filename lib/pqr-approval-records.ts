import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';

export const PQR_APPROVAL_MODULE = 'PQR Approval';

export const PQR_APPROVAL_COLLECTIONS = {
  approvals: 'pqr_approvals',
  approvalHistory: 'pqr_approval_history',
  records: 'pqr_records',
  recordsLegacy: 'pqr_documents',
  sections: 'pqr_sections',
  summaryConclusion: 'pqr_summary_conclusion',
  approvalMatrix: 'approval_matrix',
  workflows: 'workflows',
  esignSettings: 'esign_settings',
  esignRecords: 'esign_records',
  notifications: 'notifications',
} as const;

export const PQR_APPROVAL_TYPES = [
  'Prepared By', 'Reviewed By', 'Verified By', 'Approved By', 'Final Approved By',
  'Rejected By', 'Sent Back By',
] as const;

export const PQR_APPROVAL_STATUSES = [
  'Pending', 'In Review', 'Approved', 'Rejected', 'Sent Back', 'Escalated', 'Completed', 'Cancelled',
] as const;

export const PQR_WORKFLOW_STATUSES = [
  'Draft', 'Submitted For Review', 'Under Review', 'QA Review', 'Department Review',
  'Head QA Approval', 'Approved', 'Rejected', 'Sent Back', 'Returned for Correction', 'Archived',
] as const;

export type PqrApprovalType = (typeof PQR_APPROVAL_TYPES)[number];
export type PqrApprovalStatus = (typeof PQR_APPROVAL_STATUSES)[number];
export type PqrWorkflowStatus = (typeof PQR_WORKFLOW_STATUSES)[number];

export interface PqrWorkflowStepDef {
  level: number;
  approvalType: PqrApprovalType;
  approverRole: string;
  stepName: string;
  designation: string;
  dueDays: number;
  eSignatureRequired: boolean;
  commentRequired: boolean;
}

export const DEFAULT_PQR_WORKFLOW_STEPS: PqrWorkflowStepDef[] = [
  { level: 1, approvalType: 'Prepared By', approverRole: 'qa_executive', stepName: 'Prepared By', designation: 'QA Executive', dueDays: 5, eSignatureRequired: true, commentRequired: false },
  { level: 2, approvalType: 'Reviewed By', approverRole: 'qa_manager', stepName: 'QA Review', designation: 'QA Manager', dueDays: 7, eSignatureRequired: true, commentRequired: true },
  { level: 3, approvalType: 'Reviewed By', approverRole: 'qc_manager', stepName: 'QC Review', designation: 'QC Manager', dueDays: 7, eSignatureRequired: true, commentRequired: true },
  { level: 4, approvalType: 'Reviewed By', approverRole: 'production_manager', stepName: 'Production Review', designation: 'Production Manager', dueDays: 7, eSignatureRequired: true, commentRequired: true },
  { level: 5, approvalType: 'Reviewed By', approverRole: 'warehouse_manager', stepName: 'Warehouse Review', designation: 'Warehouse Manager', dueDays: 7, eSignatureRequired: true, commentRequired: true },
  { level: 6, approvalType: 'Reviewed By', approverRole: 'engineering_manager', stepName: 'Engineering Review', designation: 'Engineering Manager', dueDays: 7, eSignatureRequired: true, commentRequired: true },
  { level: 7, approvalType: 'Final Approved By', approverRole: 'head_qa', stepName: 'Head QA Approval', designation: 'Head QA', dueDays: 10, eSignatureRequired: true, commentRequired: true },
];

export interface PqrApprovalRecord {
  id?: string;
  approvalId: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  currentWorkflowStep: string;
  currentApproverRole: string;
  currentApproverUser: string;
  approvalLevel: number;
  approvalType: string;
  approvalStatus: PqrApprovalStatus | string;
  approvalComments: string;
  rejectionReason: string;
  sendBackReason: string;
  eSignatureRequired: boolean;
  eSignatureStatus: string;
  signedBy: string;
  signedDate: string;
  dueDate: string;
  completedDate: string;
  escalationStatus: string;
  priority: string;
  remarks: string;
  workflowStatus: string;
  commentRequired?: boolean;
  revision?: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface PqrApprovalHistoryEntry {
  id?: string;
  pqrId: string;
  pqrNumber: string;
  approvalId: string;
  action: string;
  approvalType: string;
  userId: string;
  userName: string;
  userRole: string;
  comments: string;
  eSignatureStatus: string;
  createdAt: string;
  createdBy: string;
  isDeleted: boolean;
}

export interface PqrApprovalDashboardCounts {
  pendingApprovals: number;
  myPendingApprovals: number;
  approvedThisMonth: number;
  rejectedPqrs: number;
  sentBackPqrs: number;
  overdueApprovals: number;
  escalatedApprovals: number;
  finalApprovedPqrs: number;
}

export const approvalActionSchema = z.object({
  approvalId: z.string().min(1, 'Approval record required'),
  pqrId: z.string().min(1, 'PQR required'),
  comments: z.string().default(''),
  rejectionReason: z.string().default(''),
  sendBackReason: z.string().default(''),
  expectedRevision: z.number().optional(),
});

export const rejectActionSchema = z.object({
  approvalId: z.string().min(1),
  pqrId: z.string().min(1),
  rejectionReason: z.string().min(1, 'Rejection reason is required'),
  comments: z.string().default(''),
});

export const sendBackActionSchema = z.object({
  approvalId: z.string().min(1),
  pqrId: z.string().min(1),
  sendBackReason: z.string().min(1, 'Send back reason is required'),
  comments: z.string().default(''),
});

export const reopenActionSchema = z.object({
  pqrId: z.string().min(1),
  reason: z.string().min(1, 'Reason is required for reopening approved PQR'),
});

export type ApprovalActionFormData = z.infer<typeof approvalActionSchema>;

/** Normalize an approver / step role string via shared permission helpers. */
export function normalizeApproverRole(role?: string | null): string {
  return normalizeRole(role);
}

/** Map approval-matrix flow labels to PQR approval types. */
export function matrixLabelToApprovalType(label: string): PqrApprovalType {
  const l = (label || '').toLowerCase();
  if (l.includes('final')) return 'Final Approved By';
  if (l.includes('prepared')) return 'Prepared By';
  if (l.includes('verified')) return 'Verified By';
  if (l.includes('approved by') || l === 'approved by' || l.includes('approver')) return 'Approved By';
  if (l.includes('reviewed')) return 'Reviewed By';
  if (l.includes('reject')) return 'Rejected By';
  if (l.includes('sent back') || l.includes('return')) return 'Sent Back By';
  if (l.includes('approved')) return 'Approved By';
  return 'Reviewed By';
}

/**
 * Strict role ↔ step matching. No fuzzy includes.
 * - admin / super_admin always match
 * - exact match after normalizeRole
 * - qa_executive steps: qa_executive, qa_manager, head_qa
 * - engineering ↔ engineering_manager
 * - qa_manager does NOT match head_qa
 */
export function roleMatchesStep(userRole: string | undefined, stepRole: string): boolean {
  if (!userRole || !stepRole) return false;
  const u = normalizeRole(userRole);
  const s = normalizeApproverRole(stepRole);
  if (u === 'super_admin' || u === 'admin') return true;
  if (u === s) return true;
  if (s === 'qa_executive' && ['qa_executive', 'qa_manager', 'head_qa'].includes(u)) return true;
  if (
    (s === 'engineering' || s === 'engineering_manager')
    && (u === 'engineering' || u === 'engineering_manager')
  ) {
    return true;
  }
  return false;
}

function isApprovalCompletedAction(action: string): boolean {
  const a = (action || '').toLowerCase();
  return a.includes('approval completed') || a.includes('final approval') || a.includes('approved');
}

function isSentBackWorkflow(status: string): boolean {
  return status === 'Sent Back' || status === 'Returned for Correction';
}

export function computeDashboardCounts(
  approvals: PqrApprovalRecord[],
  history: PqrApprovalHistoryEntry[],
  actorId: string,
  actorRole?: string,
): PqrApprovalDashboardCounts {
  const active = approvals.filter((a) => !a.isDeleted);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const pending = active.filter((a) => ['Pending', 'In Review', 'Escalated'].includes(a.approvalStatus));
  const isOverdue = (a: PqrApprovalRecord) => {
    if (!a.dueDate) return false;
    return a.dueDate < now.toISOString().slice(0, 10) && !['Approved', 'Completed', 'Cancelled'].includes(a.approvalStatus);
  };

  const pqrWorkflowMap = new Map<string, string>();
  active.forEach((a) => pqrWorkflowMap.set(a.pqrId, a.workflowStatus));

  return {
    pendingApprovals: pending.length,
    myPendingApprovals: pending.filter((a) => roleMatchesStep(actorRole, a.currentApproverRole) || a.currentApproverUser === actorId).length,
    approvedThisMonth: history.filter((h) => isApprovalCompletedAction(h.action) && h.createdAt >= monthStart).length,
    rejectedPqrs: Array.from(pqrWorkflowMap.values()).filter((s) => s === 'Rejected').length,
    sentBackPqrs: Array.from(pqrWorkflowMap.values()).filter(isSentBackWorkflow).length,
    overdueApprovals: pending.filter(isOverdue).length,
    escalatedApprovals: active.filter((a) => a.approvalStatus === 'Escalated' || a.escalationStatus === 'Escalated').length,
    finalApprovedPqrs: Array.from(pqrWorkflowMap.values()).filter((s) => s === 'Approved' || s === 'Archived').length,
  };
}

export function daysPending(record: PqrApprovalRecord): number {
  const start = new Date(record.createdAt || record.updatedAt);
  if (Number.isNaN(start.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24)));
}

/** First Pending / In Review / Escalated step (for timeline / queue display). */
export function getCurrentPendingStep(approvals: PqrApprovalRecord[]): PqrApprovalRecord | null {
  const active = approvals.filter((a) => !a.isDeleted).sort((a, b) => a.approvalLevel - b.approvalLevel);
  return active.find((a) => ['Pending', 'In Review', 'Escalated'].includes(a.approvalStatus)) || null;
}

/** First In Review / Escalated step — only these are actionable (not Pending). */
export function getActableStep(approvals: PqrApprovalRecord[]): PqrApprovalRecord | null {
  const active = approvals.filter((a) => !a.isDeleted).sort((a, b) => a.approvalLevel - b.approvalLevel);
  return active.find((a) => ['In Review', 'Escalated'].includes(a.approvalStatus)) || null;
}

export function canViewPqrApproval(role?: string): boolean {
  const r = normalizeRole(role);
  return [
    'super_admin', 'admin', 'qa_manager', 'head_qa', 'qa_executive',
    'qc_manager', 'qc_executive', 'production_manager', 'production_executive',
    'warehouse_manager', 'warehouse_executive', 'engineering_manager', 'engineering_executive',
    'maintenance', 'management', 'auditor', 'viewer',
  ].includes(r);
}

export function canSubmitPqrApproval(role?: string): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'qa_manager', 'qa_executive'].includes(r);
}

export function canActOnApproval(role?: string, stepRole?: string): boolean {
  const r = normalizeRole(role);
  if (r === 'auditor' || r === 'viewer') return false;
  if (r === 'super_admin' || r === 'admin') return true;
  return roleMatchesStep(role, stepRole || '');
}

export function canReopenApprovedPqr(role?: string): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'head_qa'].includes(r);
}

export function canReassignApproval(role?: string): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa'].includes(r);
}

export function canArchivePqrApproval(role?: string): boolean {
  const r = normalizeRole(role);
  return ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(r);
}

export function approvalStatusColor(status: string): string {
  if (status === 'Approved' || status === 'Completed') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Pending' || status === 'In Review') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'Escalated') return 'bg-orange-50 text-orange-800 border-orange-200';
  if (status === 'Sent Back') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Rejected' || status === 'Cancelled') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function workflowStatusColor(status: string): string {
  if (status === 'Approved' || status === 'Archived') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Under Review' || status === 'QA Review' || status === 'Department Review') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'Head QA Approval') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (status === 'Sent Back' || status === 'Returned for Correction') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Rejected') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function roleBadgeColor(): string {
  return 'bg-blue-50 text-blue-800 border-blue-200';
}

export function overdueBadgeColor(overdue: boolean): string {
  return overdue ? 'bg-red-50 text-red-700 border-red-200' : 'bg-green-50 text-green-700 border-green-200';
}

export function esignStatusColor(status: string): string {
  if (status === 'Signed' || status === 'Completed') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Required') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Failed') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function mapWorkflowStatusForStep(step: PqrWorkflowStepDef): string {
  if (step.approvalType === 'Prepared By') return 'Submitted For Review';
  if (step.approverRole === 'head_qa' || step.approvalType === 'Final Approved By') return 'Head QA Approval';
  if (step.approverRole === 'qa_manager') return 'QA Review';
  return 'Department Review';
}

export function signatureMeaningForAction(action: 'approve' | 'reject' | 'final' | 'return'): string {
  if (action === 'reject') return 'I reject this Product Quality Review.';
  if (action === 'final') return 'I final approve this Product Quality Review.';
  if (action === 'return') return 'I return this Product Quality Review for correction.';
  return 'I have reviewed this Product Quality Review.';
}
