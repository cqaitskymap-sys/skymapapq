import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { getActiveOosCapaLink, validateOosCanClose } from '@/lib/oos-capa-service';
import {
  buildOosWorkflowContext,
  buildOosWorkflowSteps,
  getCurrentPendingOosApproval,
  mapOosStatusForStep,
  OOS_APPROVAL_MODULE,
  validateOosApprovalAction,
  type OosWorkflowStepDef,
} from '@/lib/oos-approval-records';
import {
  OOS_COLLECTIONS,
  type OosApproval,
  type OosApprovalHistoryEntry,
  type OosRecord,
} from '@/lib/oos-types';
import {
  closeOos,
  getAuditLogsForOos,
  getImpactAssessment,
  getOosById,
  getPhase1,
  getPhase2,
  updateOosRecord,
} from '@/lib/oos-service';

export type OosApprovalActor = { id: string; name: string; role?: string; email?: string };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function toOosActor(actor: OosApprovalActor): import('@/lib/oos-types').OosActor {
  return { id: actor.id, name: actor.name, role: actor.role || 'system' };
}

function buildApprovalId(oosNumber: string, level: number) {
  return `OAP-${oosNumber.replace(/\s+/g, '-')}-L${level}-${Date.now().toString(36).toUpperCase()}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function audit(actor: OosApprovalActor, actionType: string, oosId: string, detail?: unknown) {
  try {
    await createAuditLog({
      moduleName: OOS_APPROVAL_MODULE,
      collectionName: OOS_COLLECTIONS.approvals,
      recordId: oosId,
      actionType,
      actionDescription: typeof detail === 'string' ? detail : actionType,
      reason: typeof detail === 'string' ? detail : '',
      newValue: detail,
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('oos approval audit', e);
  }
}

async function saveHistory(entry: Omit<OosApprovalHistoryEntry, 'id'>, actor: OosApprovalActor) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.approvalHistory), {
      ...entry,
      created_by: actor.id,
      is_deleted: false,
    });
  } catch (e) {
    console.error('oos saveHistory', e);
  }
}

async function notifyRole(title: string, message: string, oosId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.notifications), {
        title, message, module: 'OOS', record_id: oosId, target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('oos approval notify', e);
    }
  }
}

async function notifyUser(title: string, message: string, oosId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.notifications), {
      title, message, module: 'OOS', record_id: oosId, user_id: userId, read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('oos approval notify user', e);
  }
}

async function loadWorkflowContext(oosId: string, record: OosRecord) {
  const [phase1, phase2, impact, capaLink] = await Promise.all([
    getPhase1(oosId),
    getPhase2(oosId),
    getImpactAssessment(oosId),
    getActiveOosCapaLink(oosId),
  ]);
  const capaLinked = Boolean(capaLink?.capa_number || record.linked_capa_number);
  return buildOosWorkflowContext(record, phase1, phase2, impact, capaLinked);
}

function mapStepToApproval(
  oosId: string,
  oosNumber: string,
  step: OosWorkflowStepDef,
): Omit<OosApproval, 'id'> {
  const ts = nowIso();
  return {
    oos_id: oosId,
    oos_number: oosNumber,
    approval_id: buildApprovalId(oosNumber, step.level),
    current_workflow_step: step.stepName,
    current_approver: '',
    current_approver_name: '',
    current_approver_role: step.approverRole,
    current_role: step.approverRole,
    approval_level: step.level,
    approval_status: 'Waiting',
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

export async function getOosApprovals(oosId: string): Promise<OosApproval[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.approvals),
      where('oos_id', '==', oosId),
      orderBy('created_at', 'asc'),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OosApproval));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.approvals),
      where('oos_id', '==', oosId),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OosApproval))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
}

export async function getOosApprovalHistory(oosId?: string): Promise<OosApprovalHistoryEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const q = oosId
      ? query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.approvalHistory), where('oos_id', '==', oosId), orderBy('created_at', 'desc'))
      : query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.approvalHistory), orderBy('created_at', 'desc'), limit(500));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OosApprovalHistoryEntry));
  } catch {
    return [];
  }
}

export async function fetchAllOosApprovalRecords(): Promise<OosApproval[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.approvals), limit(1000)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as OosApproval)).filter((a) => !a.is_deleted);
  } catch {
    return [];
  }
}

export async function initializeOosApprovalWorkflow(oosId: string, actor: OosApprovalActor): Promise<void> {
  const record = await getOosById(oosId);
  if (!record) return;

  const existing = await getOosApprovals(oosId);
  if (existing.some((a) => !a.is_deleted && ['Pending', 'Waiting', 'Escalated', 'Approved'].includes(a.approval_status || ''))) {
    return;
  }

  const ctx = await loadWorkflowContext(oosId, record);
  const steps = buildOosWorkflowSteps(ctx);
  const batch = steps.map((step) => mapStepToApproval(oosId, record.oos_number, step));

  for (let i = 0; i < batch.length; i += 1) {
    const payload = { ...batch[i], approval_status: i === 0 ? 'Pending' : 'Waiting' };
    await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.approvals), payload);
  }

  await updateOosRecord(oosId, { status: 'submitted' }, toOosActor(actor), { workflow: true });
  await audit(actor, 'OOS Submitted', oosId, 'Approval workflow initialized');
  await saveHistory({
    oos_id: oosId,
    oos_number: record.oos_number,
    approval_id: batch[0]?.approval_id || '',
    action: 'OOS Submitted',
    workflow_step: 'Submitted',
    user_id: actor.id,
    user_name: actor.name,
    user_role: actor.role || 'qc',
    comments: 'OOS submitted for approval workflow',
    created_at: nowIso(),
    created_by: actor.id,
  }, actor);

  await notifyRole('OOS Pending Approval', `${record.oos_number} awaiting ${steps[0]?.stepName}`, oosId, ['qc_manager', 'qa_manager']);
  if (ctx.headQaRequired) await notifyRole('Critical OOS Submitted', record.oos_number, oosId, ['head_qa']);
}

export async function fetchOosApprovalPageData(oosId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const record = await getOosById(oosId);
    if (!record) return { error: 'OOS record not found.' };

    const [approvals, history, auditLogs] = await Promise.all([
      getOosApprovals(oosId),
      getOosApprovalHistory(oosId),
      getAuditLogsForOos(oosId),
    ]);

    const ctx = await loadWorkflowContext(oosId, record);
    const current = getCurrentPendingOosApproval(approvals);
    const closureCheck = await validateOosCanClose(oosId);

    return {
      record,
      approvals,
      history,
      auditLogs,
      current,
      workflowSteps: buildOosWorkflowSteps(ctx),
      workflowContext: ctx,
      closureCheck,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load approval data' };
  }
}

async function completeOosStepAndAdvance(
  approval: OosApproval,
  record: OosRecord,
  action: 'approve' | 'reject' | 'send_back',
  payload: { comments?: string; rejection_reason?: string; send_back_reason?: string; e_signature?: string },
  actor: OosApprovalActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase not configured' };
  const ts = nowIso();
  const stepName = approval.current_workflow_step || '';
  const ctx = await loadWorkflowContext(record.id, record);

  if (action === 'approve') {
    const validation = validateOosApprovalAction(stepName, ctx);
    if (!validation.ok) return { error: validation.error };
    if (approval.e_signature_required && !payload.e_signature?.trim()) {
      return { error: 'E-signature required for this approval step.' };
    }
    const stepDef = buildOosWorkflowSteps(ctx).find((s) => s.stepName === stepName);
    if (stepDef?.commentRequired && !payload.comments?.trim()) {
      return { error: 'Approval comment is required for this step.' };
    }
  }

  const statusMap = { approve: 'Approved', reject: 'Rejected', send_back: 'Sent Back' } as const;
  const decisionMap = { approve: 'approved', reject: 'rejected', send_back: 'sent_back' } as const;

  await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.approvals, approval.id), {
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
    signed_by: actor.name,
    signed_date: ts,
    signed_at: ts,
    completed_date: today(),
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  });

  const actionLabel = action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Sent Back';
  await audit(actor, actionLabel, record.id, payload.comments || payload.rejection_reason || payload.send_back_reason);
  await saveHistory({
    oos_id: record.id,
    oos_number: record.oos_number,
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

  let newStatus = mapOosStatusForStep(stepName, action === 'approve' ? 'approve' : action);

  if (action === 'approve') {
    const allApprovals = await getOosApprovals(record.id);
    const next = allApprovals
      .filter((a) => !a.is_deleted && a.approval_status === 'Waiting')
      .sort((a, b) => Number(a.approval_level) - Number(b.approval_level))[0];

    if (next) {
      await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.approvals, next.id), {
        approval_status: 'Pending',
        updated_at: ts,
      });
      newStatus = mapOosStatusForStep(next.current_workflow_step || stepName, 'approve');
      await notifyRole('OOS Pending Approval', `${record.oos_number} — ${next.current_workflow_step}`, record.id, [next.current_role || 'qa_manager']);
    } else {
      newStatus = 'approved';
      await audit(actor, 'Final Approval', record.id);
      await audit(actor, 'OOS Locked', record.id, 'Final approval completed');
      await notifyUser('OOS Final Approved', record.oos_number, record.id, record.created_by);
      await notifyRole('OOS Final Approved', record.oos_number, record.id, ['qa_manager', 'head_qa']);
    }
  } else if (action === 'reject') {
    await notifyUser('OOS Rejected', `${record.oos_number}: ${payload.rejection_reason}`, record.id, record.created_by);
    await notifyRole('OOS Rejected', record.oos_number, record.id, ['qc_manager', 'qa_manager']);
  } else if (action === 'send_back') {
    await notifyUser('OOS Sent Back', `${record.oos_number}: ${payload.send_back_reason}`, record.id, record.created_by);
    await notifyRole('OOS Sent Back', record.oos_number, record.id, ['qc_manager', 'qa']);
  }

  await updateOosRecord(record.id, { status: newStatus }, toOosActor(actor), { workflow: true });
  return {};
}

export async function approveOosStep(
  oosId: string,
  approvalId: string,
  comments: string,
  eSignature: string,
  actor: OosApprovalActor,
): Promise<{ error?: string }> {
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };
  const approvals = await getOosApprovals(oosId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeOosStepAndAdvance(approval, record, 'approve', { comments, e_signature: eSignature }, actor);
}

export async function rejectOosStep(
  oosId: string,
  approvalId: string,
  rejectionReason: string,
  comments: string,
  actor: OosApprovalActor,
): Promise<{ error?: string }> {
  if (!rejectionReason.trim()) return { error: 'Rejection reason is mandatory' };
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };
  const approvals = await getOosApprovals(oosId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeOosStepAndAdvance(approval, record, 'reject', { rejection_reason: rejectionReason, comments }, actor);
}

export async function sendBackOosStep(
  oosId: string,
  approvalId: string,
  sendBackReason: string,
  comments: string,
  actor: OosApprovalActor,
): Promise<{ error?: string }> {
  if (!sendBackReason.trim()) return { error: 'Send back reason is mandatory' };
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };
  const approvals = await getOosApprovals(oosId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeOosStepAndAdvance(approval, record, 'send_back', { send_back_reason: sendBackReason, comments }, actor);
}

export async function escalateOverdueOosApprovals(actor: OosApprovalActor): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const all = await fetchAllOosApprovalRecords();
  const todayStr = today();
  let count = 0;

  for (const a of all) {
    if (!['Pending', 'Escalated'].includes(a.approval_status || '')) continue;
    if (!a.due_date || a.due_date >= todayStr) continue;

    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.approvals, a.id), {
      approval_status: 'Escalated',
      escalation_status: 'Escalated',
      updated_at: nowIso(),
    });

    await audit(actor, 'Escalated', a.oos_id, `Overdue: ${a.current_workflow_step}`);
    await notifyRole('Overdue OOS Approval', `${a.oos_number} — ${a.current_workflow_step}`, a.oos_id, ['admin', 'head_qa', 'qa_manager']);
    if (a.oos_number) {
      await saveHistory({
        oos_id: a.oos_id,
        oos_number: a.oos_number,
        approval_id: a.approval_id || a.id,
        action: 'Escalated',
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

export async function closeApprovedOos(oosId: string, actor: OosApprovalActor): Promise<{ error?: string }> {
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };
  if (record.status !== 'approved') return { error: 'OOS must be final approved before closure' };

  const check = await validateOosCanClose(oosId);
  if (!check.canClose) return { error: check.reason };

  try {
    await closeOos(oosId, toOosActor(actor));
    await audit(actor, 'OOS Closed', oosId);
    await saveHistory({
      oos_id: oosId,
      oos_number: record.oos_number,
      approval_id: '',
      action: 'OOS Closed',
      workflow_step: 'Closed',
      user_id: actor.id,
      user_name: actor.name,
      user_role: actor.role || 'qa',
      comments: 'Final closure completed',
      created_at: nowIso(),
      created_by: actor.id,
    }, actor);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Closure failed' };
  }
}

export async function reopenOosRecord(
  oosId: string,
  reason: string,
  actor: OosApprovalActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Reopen reason is required' };
  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };
  if (!['closed', 'approved'].includes(record.status)) {
    return { error: 'Only closed or approved OOS records can be reopened' };
  }

  try {
    await updateOosRecord(oosId, {
      status: 'final_qa_review',
      actual_closure_date: null,
    }, toOosActor(actor), { workflow: true, reopen: true });
    await audit(actor, 'OOS Reopened', oosId, reason);
    await saveHistory({
      oos_id: oosId,
      oos_number: record.oos_number,
      approval_id: '',
      action: 'OOS Reopened',
      workflow_step: 'Final QA Review',
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

export async function logOosEsignResult(
  oosId: string,
  success: boolean,
  actor: OosApprovalActor,
  detail?: string,
) {
  await audit(actor, success ? 'E-Sign Success' : 'E-Sign Failure', oosId, detail);
}

export async function fetchOosApprovalDashboardData(actor: OosApprovalActor, role?: string) {
  const [approvals, history] = await Promise.all([
    fetchAllOosApprovalRecords(),
    getOosApprovalHistory(),
  ]);

  let records: OosRecord[] = [];
  if (isFirebaseConfigured()) {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), OOS_COLLECTIONS.records),
        orderBy('updated_at', 'desc'),
        limit(500),
      ));
      records = snap.docs.map((d) => ({ id: d.id, ...d.data() } as OosRecord));
    } catch {
      records = [];
    }
  }

  const { computeOosApprovalDashboardCounts } = await import('./oos-approval-records');
  return {
    approvals,
    history,
    records,
    counts: computeOosApprovalDashboardCounts(approvals, history, records, actor.id, role),
  };
}

export async function listOosRecordsForApproval() {
  const data = await fetchOosApprovalDashboardData({ id: 'system', name: 'System' });
  return data;
}

export {
  buildOosWorkflowSteps,
  computeOosApprovalDashboardCounts,
  getCurrentPendingOosApproval,
  mapHistoryToApprovalTimeline,
} from '@/lib/oos-approval-records';
