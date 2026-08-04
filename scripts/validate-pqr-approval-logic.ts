/**
 * Pure-logic checks for PQR Approval hardening.
 * Run: npx tsx scripts/validate-pqr-approval-logic.ts
 */
import {
  canArchivePqrApproval,
  canReopenApprovedPqr,
  canSubmitPqrApproval,
  canViewPqrApproval,
  computeDashboardCounts,
  getActableStep,
  getCurrentPendingStep,
  matrixLabelToApprovalType,
  normalizeApproverRole,
  roleMatchesStep,
  signatureMeaningForAction,
  type PqrApprovalHistoryEntry,
  type PqrApprovalRecord,
} from '../lib/pqr-approval-records';
import { normalizeRole } from '../lib/permissions';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- normalizeRole permissions ---
assert(normalizeRole('qa') === 'qa_manager', 'qa maps to qa_manager');
assert(canViewPqrApproval('qa'), 'qa can view');
assert(canViewPqrApproval('QA Manager'), 'QA Manager can view');
assert(canSubmitPqrApproval('qa'), 'qa (→qa_manager) can submit');
assert(canSubmitPqrApproval('qa_executive'), 'qa_executive can submit');
assert(canSubmitPqrApproval('qa_manager'), 'qa_manager can submit');
assert(!canSubmitPqrApproval('viewer'), 'viewer cannot submit');
assert(!canSubmitPqrApproval('auditor'), 'auditor cannot submit');
assert(canReopenApprovedPqr('head_qa'), 'head_qa can reopen');
assert(!canReopenApprovedPqr('qa_manager'), 'qa_manager cannot reopen');
assert(canArchivePqrApproval('qa_manager'), 'qa_manager can archive');
assert(!canArchivePqrApproval('viewer'), 'viewer cannot archive');

// --- roleMatchesStep strictness ---
assert(roleMatchesStep('super_admin', 'head_qa'), 'super_admin always');
assert(roleMatchesStep('admin', 'qc_manager'), 'admin always');
assert(roleMatchesStep('head_qa', 'head_qa'), 'exact head_qa');
assert(roleMatchesStep('qa_manager', 'qa_manager'), 'exact qa_manager');
assert(roleMatchesStep('qa_manager', 'qa_executive'), 'qa_manager can act on qa_executive step');
assert(roleMatchesStep('head_qa', 'qa_executive'), 'head_qa can act on qa_executive step');
assert(!roleMatchesStep('qa_manager', 'head_qa'), 'qa_manager CANNOT match head_qa');
assert(!roleMatchesStep('qc_manager', 'head_qa'), 'qc_manager cannot match head_qa');
assert(roleMatchesStep('engineering', 'engineering_manager'), 'engineering ↔ engineering_manager');
assert(roleMatchesStep('engineering_manager', 'engineering'), 'engineering_manager ↔ engineering');
assert(normalizeApproverRole('QA Manager') === 'qa_manager', 'normalizeApproverRole');

// --- getActableStep vs Pending ---
const steps: PqrApprovalRecord[] = [
  {
    approvalId: 'a1', pqrId: 'p1', pqrNumber: 'PQR-1', product: 'X', productCode: 'X1',
    reviewPeriodFrom: '', reviewPeriodTo: '', currentWorkflowStep: 'Prepared', currentApproverRole: 'qa_executive',
    currentApproverUser: '', approvalLevel: 1, approvalType: 'Prepared By', approvalStatus: 'Approved',
    approvalComments: '', rejectionReason: '', sendBackReason: '', eSignatureRequired: true, eSignatureStatus: 'Signed',
    signedBy: '', signedDate: '', dueDate: '', completedDate: '', escalationStatus: 'None', priority: 'Normal',
    remarks: '', workflowStatus: 'Under Review', createdAt: '2025-01-01', updatedAt: '2025-01-01',
    createdBy: 'u', updatedBy: 'u', isDeleted: false, revision: 2,
  },
  {
    approvalId: 'a2', pqrId: 'p1', pqrNumber: 'PQR-1', product: 'X', productCode: 'X1',
    reviewPeriodFrom: '', reviewPeriodTo: '', currentWorkflowStep: 'QA Review', currentApproverRole: 'qa_manager',
    currentApproverUser: '', approvalLevel: 2, approvalType: 'Reviewed By', approvalStatus: 'Pending',
    approvalComments: '', rejectionReason: '', sendBackReason: '', eSignatureRequired: true, eSignatureStatus: 'Required',
    signedBy: '', signedDate: '', dueDate: '', completedDate: '', escalationStatus: 'None', priority: 'Normal',
    remarks: '', workflowStatus: 'Under Review', createdAt: '2025-01-01', updatedAt: '2025-01-01',
    createdBy: 'u', updatedBy: 'u', isDeleted: false, revision: 1,
  },
  {
    approvalId: 'a3', pqrId: 'p1', pqrNumber: 'PQR-1', product: 'X', productCode: 'X1',
    reviewPeriodFrom: '', reviewPeriodTo: '', currentWorkflowStep: 'Head QA', currentApproverRole: 'head_qa',
    currentApproverUser: '', approvalLevel: 3, approvalType: 'Final Approved By', approvalStatus: 'Pending',
    approvalComments: '', rejectionReason: '', sendBackReason: '', eSignatureRequired: true, eSignatureStatus: 'Required',
    signedBy: '', signedDate: '', dueDate: '', completedDate: '', escalationStatus: 'None', priority: 'High',
    remarks: '', workflowStatus: 'Under Review', createdAt: '2025-01-01', updatedAt: '2025-01-01',
    createdBy: 'u', updatedBy: 'u', isDeleted: false, revision: 1,
  },
];

assert(getCurrentPendingStep(steps)?.approvalId === 'a2', 'pending step is first Pending');
assert(getActableStep(steps) === null, 'no actable step when only Pending remains');

const inReview = steps.map((s) =>
  s.approvalId === 'a2' ? { ...s, approvalStatus: 'In Review' } : s,
);
assert(getActableStep(inReview)?.approvalId === 'a2', 'actable is In Review');
assert(getActableStep(inReview)?.approvalStatus === 'In Review', 'actable status In Review');

const escalated = steps.map((s) =>
  s.approvalId === 'a2' ? { ...s, approvalStatus: 'Escalated' } : s,
);
assert(getActableStep(escalated)?.approvalId === 'a2', 'actable includes Escalated');

// --- KPI action matching ---
const month = new Date().toISOString().slice(0, 7);
const history: PqrApprovalHistoryEntry[] = [
  {
    pqrId: 'p1', pqrNumber: 'PQR-1', approvalId: 'a1', action: 'approval completed', approvalType: 'Reviewed By',
    userId: 'u', userName: 'U', userRole: 'qa_manager', comments: '', eSignatureStatus: 'Signed',
    createdAt: `${month}-15T00:00:00.000Z`, createdBy: 'u', isDeleted: false,
  },
  {
    pqrId: 'p1', pqrNumber: 'PQR-1', approvalId: 'a1', action: 'final approval', approvalType: 'Final Approved By',
    userId: 'u', userName: 'U', userRole: 'head_qa', comments: '', eSignatureStatus: 'Signed',
    createdAt: `${month}-16T00:00:00.000Z`, createdBy: 'u', isDeleted: false,
  },
  {
    pqrId: 'p1', pqrNumber: 'PQR-1', approvalId: 'a1', action: 'PQR approved by Head QA', approvalType: 'Final Approved By',
    userId: 'u', userName: 'U', userRole: 'head_qa', comments: '', eSignatureStatus: 'Signed',
    createdAt: `${month}-17T00:00:00.000Z`, createdBy: 'u', isDeleted: false,
  },
  {
    pqrId: 'p1', pqrNumber: 'PQR-1', approvalId: 'a1', action: 'send back', approvalType: 'Sent Back By',
    userId: 'u', userName: 'U', userRole: 'qa_manager', comments: '', eSignatureStatus: 'N/A',
    createdAt: `${month}-18T00:00:00.000Z`, createdBy: 'u', isDeleted: false,
  },
];
const counts = computeDashboardCounts(
  [
    { ...steps[0], workflowStatus: 'Returned for Correction', approvalStatus: 'Sent Back' },
    { ...steps[1], isDeleted: true },
  ],
  history,
  'u',
  'qa_manager',
);
assert(counts.approvedThisMonth === 3, 'KPI matches approval completed / final approval / approved');
assert(counts.sentBackPqrs === 1, 'sentBack includes Returned for Correction');

// --- matrixLabelToApprovalType ---
assert(matrixLabelToApprovalType('Prepared By') === 'Prepared By', 'Prepared By');
assert(matrixLabelToApprovalType('Reviewed By') === 'Reviewed By', 'Reviewed By');
assert(matrixLabelToApprovalType('Verified By') === 'Verified By', 'Verified By');
assert(matrixLabelToApprovalType('Approved By') === 'Approved By', 'Approved By');
assert(matrixLabelToApprovalType('Final Approver') === 'Final Approved By', 'Final Approver');
assert(matrixLabelToApprovalType('Final Approved By') === 'Final Approved By', 'Final Approved By');

// --- signatureMeaningForAction return ---
assert(signatureMeaningForAction('return').toLowerCase().includes('return'), 'return meaning');
assert(signatureMeaningForAction('reject').toLowerCase().includes('reject'), 'reject meaning');

console.log('validate-pqr-approval-logic: all checks passed');
