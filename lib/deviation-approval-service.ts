import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  buildDeviationWorkflowSteps,
  DEVIATION_APPROVAL_MODULE,
  getCurrentPendingApproval,
  mapDeviationStatusForStep,
  validateApprovalAction,
  type DeviationWorkflowStepDef,
} from '@/lib/deviation-approval-records';
import { isCapaSatisfiedForClosure } from '@/lib/deviation-capa-records';
import { getActiveCapaLink } from '@/lib/deviation-capa-service';
import { getCapaById } from '@/lib/capa-service';
import {
  DEVIATION_COLLECTIONS,
  type DeviationApproval,
  type DeviationApprovalHistoryEntry,
  type DeviationRecord,
} from '@/lib/deviation-types';
import {
  applyOverdueCheck,
  getAuditLogsForDeviation,
  getDeviationById,
  getInvestigation,
  listDeviations,
  updateDeviation,
} from '@/lib/deviation-service';

export type DeviationApprovalActor = { id: string; name: string; role?: string; email?: string };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function buildApprovalId(deviationNumber: string, level: number) {
  return `DAP-${deviationNumber.replace(/\s+/g, '-')}-L${level}-${Date.now().toString(36).toUpperCase()}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function audit(actor: DeviationApprovalActor, actionType: string, deviationId: string, detail?: unknown) {
  try {
    await createAuditLog({
      moduleName: DEVIATION_APPROVAL_MODULE,
      collectionName: DEVIATION_COLLECTIONS.approvals,
      recordId: deviationId,
      actionType,
      actionDescription: typeof detail === 'string' ? detail : actionType,
      reason: typeof detail === 'string' ? detail : '',
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
  } catch (e) {
    console.error('deviation approval audit', e);
  }
}

async function saveHistory(entry: Omit<DeviationApprovalHistoryEntry, 'id'>, actor: DeviationApprovalActor) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvalHistory), {
      ...entry,
      created_by: actor.id,
      is_deleted: false,
    });
  } catch (e) {
    console.error('saveHistory', e);
  }
}

async function notify(userId: string, title: string, message: string, deviationId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.notifications), {
      title, message, module: 'Deviation', record_id: deviationId, user_id: userId, read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('notify', e);
  }
}

function mapStepToApproval(
  deviationId: string,
  deviationNumber: string,
  step: DeviationWorkflowStepDef,
  actor: DeviationApprovalActor,
): Omit<DeviationApproval, 'id'> {
  const ts = nowIso();
  return {
    deviation_id: deviationId,
    deviation_number: deviationNumber,
    approval_id: buildApprovalId(deviationNumber, step.level),
    current_workflow_step: step.stepName,
    current_approver: '',
    current_approver_name: '',
    current_role: step.approverRole,
    approval_level: step.level,
    approval_status: step.level === 1 ? 'Pending' : 'Pending',
    approver_id: '',
    approver_name: '',
    approver_role: step.approverRole,
    decision: 'pending',
    comments: '',
    e_signature_required: step.eSignatureRequired,
    e_signature: '',
    e_signature_status: 'Not Signed',
    signed_at: null,
    due_date: addDays(today(), step.dueDays),
    completed_date: null,
    escalation_status: 'None',
    created_at: ts,
    updated_at: ts,
    is_deleted: false,
  };
}

export async function getDeviationApprovals(deviationId: string): Promise<DeviationApproval[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals),
      where('deviation_id', '==', deviationId),
      orderBy('created_at', 'asc'),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationApproval));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals),
      where('deviation_id', '==', deviationId),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationApproval))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
}

export async function getDeviationApprovalHistory(deviationId?: string): Promise<DeviationApprovalHistoryEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const q = deviationId
      ? query(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvalHistory), where('deviation_id', '==', deviationId), orderBy('created_at', 'desc'))
      : query(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvalHistory), orderBy('created_at', 'desc'), limit(500));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationApprovalHistoryEntry));
  } catch {
    return [];
  }
}

export async function fetchAllDeviationApprovalRecords(): Promise<DeviationApproval[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals), limit(1000)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DeviationApproval)).filter((a) => !a.is_deleted);
  } catch {
    return [];
  }
}

async function investigationComplete(deviationId: string): Promise<boolean> {
  const inv = await getInvestigation(deviationId);
  if (!inv) return false;
  const status = inv.investigation_status || '';
  return ['Completed', 'Closed', 'QA Review'].includes(status);
}

async function capaSatisfied(record: DeviationRecord): Promise<boolean> {
  if (!record.capa_required) return true;
  const link = await getActiveCapaLink(record.id);
  const capa = record.linked_capa_id ? await getCapaById(record.linked_capa_id) : (link?.capa_id ? await getCapaById(link.capa_id) : null);
  return isCapaSatisfiedForClosure(capa, true);
}

export async function initializeApprovalWorkflow(deviationId: string, actor: DeviationApprovalActor): Promise<void> {
  const record = await getDeviationById(deviationId);
  if (!record) return;
  const existing = await getDeviationApprovals(deviationId);
  if (existing.some((a) => !a.is_deleted && ['Pending', 'Waiting', 'Escalated', 'Approved'].includes(a.approval_status || ''))) return;

  const steps = buildDeviationWorkflowSteps(record);
  const batch = steps.map((step) => mapStepToApproval(deviationId, record.deviation_number, step, actor));

  for (let i = 0; i < batch.length; i += 1) {
    const payload = { ...batch[i], approval_status: i === 0 ? 'Pending' : 'Waiting' };
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals), payload);
  }

  await updateDeviation(deviationId, { status: 'submitted' }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });
  await audit(actor, 'Submit Deviation', deviationId, 'Approval workflow initialized');
  await saveHistory({
    deviation_id: deviationId,
    deviation_number: record.deviation_number,
    approval_id: batch[0]?.approval_id || '',
    action: 'Submit Deviation',
    workflow_step: 'Submitted',
    user_id: actor.id,
    user_name: actor.name,
    user_role: actor.role || 'qa',
    comments: 'Deviation submitted for approval workflow',
    created_at: nowIso(),
    created_by: actor.id,
  }, actor);

  const firstStep = steps[0];
  await notify(firstStep.approverRole, 'Deviation Pending Approval', `${record.deviation_number} awaiting ${firstStep.stepName}`, deviationId);
  if (record.criticality === 'Critical') {
    await notify('head_qa', 'Critical Deviation Submitted', record.deviation_number, deviationId);
  }
}

export async function fetchApprovalPageData(deviationId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const record = await getDeviationById(deviationId);
    if (!record) return { error: 'Deviation not found.' };
    const [approvals, history, auditLogs, investigation] = await Promise.all([
      getDeviationApprovals(deviationId),
      getDeviationApprovalHistory(deviationId),
      getAuditLogsForDeviation(deviationId),
      getInvestigation(deviationId),
    ]);
    const current = getCurrentPendingApproval(approvals);
    const capaOk = await capaSatisfied(record);
    const invComplete = await investigationComplete(deviationId);
    return {
      record: applyOverdueCheck(record),
      approvals,
      history,
      auditLogs,
      current,
      workflowSteps: buildDeviationWorkflowSteps(record),
      investigationComplete: invComplete,
      capaSatisfied: capaOk,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load approval data' };
  }
}

async function completeStepAndAdvance(
  approval: DeviationApproval,
  record: DeviationRecord,
  action: 'approve' | 'reject' | 'send_back',
  payload: { comments?: string; rejection_reason?: string; send_back_reason?: string; e_signature?: string },
  actor: DeviationApprovalActor,
): Promise<{ error?: string }> {
  const ts = nowIso();
  const stepName = approval.current_workflow_step || '';

  if (action === 'approve') {
    const validation = validateApprovalAction(record, stepName, await investigationComplete(record.id), await capaSatisfied(record));
    if (!validation.ok) return { error: validation.error };
  }

  const statusMap = { approve: 'Approved', reject: 'Rejected', send_back: 'Sent Back' } as const;
  const decisionMap = { approve: 'approved', reject: 'rejected', send_back: 'sent_back' } as const;

  await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals, approval.id), {
    approval_status: statusMap[action],
    decision: decisionMap[action],
    approver_id: actor.id,
    approver_name: actor.name,
    approver_role: actor.role || 'qa',
    current_approver: actor.id,
    current_approver_name: actor.name,
    comments: payload.comments || '',
    rejection_reason: payload.rejection_reason || '',
    send_back_reason: payload.send_back_reason || '',
    e_signature: payload.e_signature || '',
    e_signature_status: payload.e_signature ? 'Signed' : 'Not Signed',
    signed_at: ts,
    completed_date: today(),
    updated_at: ts,
  });

  const actionLabel = action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Send Back';
  await audit(actor, actionLabel, record.id, payload.comments || payload.rejection_reason || payload.send_back_reason);
  await saveHistory({
    deviation_id: record.id,
    deviation_number: record.deviation_number,
    approval_id: approval.approval_id || approval.id,
    action: actionLabel,
    workflow_step: stepName,
    user_id: actor.id,
    user_name: actor.name,
    user_role: actor.role || 'qa',
    comments: payload.comments || '',
    rejection_reason: payload.rejection_reason,
    send_back_reason: payload.send_back_reason,
    e_signature_status: payload.e_signature ? 'Signed' : 'Not Signed',
    created_at: ts,
    created_by: actor.id,
  }, actor);

  let newStatus = mapDeviationStatusForStep(stepName, action === 'approve' ? 'approve' : action);
  let workflowStep = stepName;

  if (action === 'approve') {
    const allApprovals = await getDeviationApprovals(record.id);
    const next = allApprovals
      .filter((a) => !a.is_deleted && a.approval_status === 'Waiting')
      .sort((a, b) => Number(a.approval_level) - Number(b.approval_level))[0];

    if (next) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals, next.id), {
        approval_status: 'Pending',
        updated_at: ts,
      });
      workflowStep = next.current_workflow_step || workflowStep;
      newStatus = mapDeviationStatusForStep(workflowStep, 'approve');
      await notify(next.current_role || 'qa_manager', 'Deviation Pending Approval', `${record.deviation_number} — ${next.current_workflow_step}`, record.id);
    } else if (stepName === 'Final Approval') {
      newStatus = 'approved';
      workflowStep = 'Closed';
      await audit(actor, 'Final Approval', record.id);
      await notify(record.created_by, 'Deviation Final Approved', record.deviation_number, record.id);
    }
  } else if (action === 'reject') {
    await notify(record.created_by, 'Deviation Rejected', `${record.deviation_number}: ${payload.rejection_reason}`, record.id);
  } else if (action === 'send_back') {
    await notify(record.created_by, 'Deviation Sent Back', `${record.deviation_number}: ${payload.send_back_reason}`, record.id);
  }

  await updateDeviation(record.id, {
    status: newStatus,
    qa_remarks: payload.comments || record.qa_remarks,
  }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });

  return {};
}

export async function approveDeviationStep(
  deviationId: string,
  approvalId: string,
  comments: string,
  eSignature: string,
  actor: DeviationApprovalActor,
): Promise<{ error?: string }> {
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };
  const approvals = await getDeviationApprovals(deviationId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  if (approval.e_signature_required && !eSignature.trim()) return { error: 'E-signature required' };

  return completeStepAndAdvance(approval, record, 'approve', { comments, e_signature: eSignature }, actor);
}

export async function rejectDeviationStep(
  deviationId: string,
  approvalId: string,
  rejectionReason: string,
  comments: string,
  actor: DeviationApprovalActor,
): Promise<{ error?: string }> {
  if (!rejectionReason.trim()) return { error: 'Rejection reason is mandatory' };
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };
  const approvals = await getDeviationApprovals(deviationId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeStepAndAdvance(approval, record, 'reject', { rejection_reason: rejectionReason, comments }, actor);
}

export async function sendBackDeviationStep(
  deviationId: string,
  approvalId: string,
  sendBackReason: string,
  comments: string,
  actor: DeviationApprovalActor,
): Promise<{ error?: string }> {
  if (!sendBackReason.trim()) return { error: 'Send back reason is mandatory' };
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };
  const approvals = await getDeviationApprovals(deviationId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeStepAndAdvance(approval, record, 'send_back', { send_back_reason: sendBackReason, comments }, actor);
}

export async function escalateOverdueApprovals(actor: DeviationApprovalActor): Promise<number> {
  const all = await fetchAllDeviationApprovalRecords();
  const todayStr = today();
  let count = 0;
  for (const a of all) {
    if (!['Pending', 'Escalated'].includes(a.approval_status || '')) continue;
    if (!a.due_date || a.due_date >= todayStr) continue;
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.approvals, a.id), {
      approval_status: 'Escalated',
      escalation_status: 'Escalated',
      updated_at: nowIso(),
    });
    await audit(actor, 'Escalate', a.deviation_id, `Overdue: ${a.current_workflow_step}`);
    await notify('admin', 'Overdue Deviation Approval', `${a.deviation_number} — ${a.current_workflow_step}`, a.deviation_id);
    if (a.deviation_number) {
      await saveHistory({
        deviation_id: a.deviation_id,
        deviation_number: a.deviation_number,
        approval_id: a.approval_id || a.id,
        action: 'Escalate',
        workflow_step: a.current_workflow_step || '',
        user_id: actor.id,
        user_name: actor.name,
        user_role: actor.role || 'admin',
        comments: 'Auto-escalated due to overdue approval',
        created_at: nowIso(),
        created_by: actor.id,
      }, actor);
    }
    count += 1;
  }
  return count;
}

export async function closeApprovedDeviation(
  deviationId: string,
  actor: DeviationApprovalActor,
): Promise<{ error?: string }> {
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };
  if (record.status !== 'approved') return { error: 'Deviation must be final approved before closure' };

  const { fetchClosurePageData, closeDeviationWithClosure } = await import('./deviation-closure-service');
  const page = await fetchClosurePageData(deviationId);
  if (page.error || !page.formDefaults) return { error: page.error || 'Load closure data failed' };

  return closeDeviationWithClosure(
    deviationId,
    {
      ...page.formDefaults,
      qa_closure_comments: page.formDefaults.qa_closure_comments || 'Approved via workflow — pending closure review',
      final_closure_conclusion: page.formDefaults.final_closure_conclusion || 'Final approval completed. Proceeding to closure.',
    },
    actor.name,
    actor,
  );
}

export async function reopenDeviation(
  deviationId: string,
  reason: string,
  actor: DeviationApprovalActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Reopen reason is required' };
  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };
  if (!['closed', 'approved'].includes(record.status)) return { error: 'Only closed or approved deviations can be reopened' };

  try {
    await updateDeviation(deviationId, {
      status: 'qa_review',
      actual_closure_date: null,
      qa_remarks: reason,
    }, { id: actor.id, name: actor.name, role: actor.role || 'head_qa' }, { workflow: true, reopen: true });
    await audit(actor, 'Reopen Deviation', deviationId, reason);
    await saveHistory({
      deviation_id: deviationId,
      deviation_number: record.deviation_number,
      approval_id: '',
      action: 'Reopen Deviation',
      workflow_step: 'QA Review',
      user_id: actor.id,
      user_name: actor.name,
      user_role: actor.role || 'head_qa',
      comments: reason,
      created_at: nowIso(),
      created_by: actor.id,
    }, actor);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reopen failed' };
  }
}

export async function logEsignResult(
  deviationId: string,
  success: boolean,
  actor: DeviationApprovalActor,
  detail?: string,
) {
  await audit(actor, success ? 'E-Sign Success' : 'E-Sign Failure', deviationId, detail);
}

export async function fetchApprovalDashboardData(actor: DeviationApprovalActor, role?: string) {
  const [approvals, history, deviations] = await Promise.all([
    fetchAllDeviationApprovalRecords(),
    getDeviationApprovalHistory(),
    listDeviations(),
  ]);
  const { computeApprovalDashboardCounts } = await import('./deviation-approval-records');
  return {
    approvals,
    history,
    deviations,
    counts: computeApprovalDashboardCounts(approvals, history, deviations, actor.id, role),
  };
}

export {
  buildDeviationWorkflowSteps,
  computeApprovalDashboardCounts,
  getCurrentPendingApproval,
  mapAuditToApprovalTimeline,
} from '@/lib/deviation-approval-records';
