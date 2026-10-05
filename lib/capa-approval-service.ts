import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { listCapaCorrectiveActions } from '@/lib/capa-corrective-action-service';
import { listCapaPreventiveActions } from '@/lib/capa-preventive-action-service';
import { canCapaCloseFromEffectiveness } from '@/lib/capa-effectiveness-records';
import { getCapaEffectivenessReview } from '@/lib/capa-effectiveness-service';
import { isInvestigationApproved } from '@/lib/capa-investigation-records';
import { getCapaInvestigationByCapaId } from '@/lib/capa-investigation-service';
import {
  buildCapaWorkflowContext,
  buildCapaWorkflowSteps,
  CAPA_APPROVAL_MODULE,
  getCurrentPendingCapaApproval,
  mapCapaStatusForStep,
  type CapaWorkflowStepDef,
  validateCapaApprovalAction,
} from '@/lib/capa-approval-records';
import {
  CAPA_COLLECTIONS,
  type CapaApproval,
  type CapaApprovalHistoryEntry,
  type CapaRecord,
} from '@/lib/capa-types';
import { getCapaById, listCapas, updateCapa } from '@/lib/capa-service';

export type CapaApprovalActor = { id: string; name: string; role?: string; email?: string };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildApprovalId(capaNumber: string, level: number) {
  return `CAP-AP-${capaNumber.replace(/\s+/g, '-')}-L${level}-${Date.now().toString(36).toUpperCase()}`;
}

async function audit(actor: CapaApprovalActor, actionType: string, capaId: string, detail?: unknown) {
  try {
    await createAuditLog({
      moduleName: CAPA_APPROVAL_MODULE,
      collectionName: CAPA_COLLECTIONS.approvals,
      recordId: capaId,
      actionType,
      actionDescription: typeof detail === 'string' ? detail : actionType,
      reason: typeof detail === 'string' ? detail : '',
      newValue: detail,
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa approval audit', e);
  }
}

async function saveHistory(entry: Omit<CapaApprovalHistoryEntry, 'id'>, actor: CapaApprovalActor) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvalHistory), {
      ...entry,
      created_by: actor.id,
      is_deleted: false,
    });
  } catch (e) {
    console.error('capa saveHistory', e);
  }
}

async function notifyRole(title: string, message: string, capaId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
        title, message, module: 'CAPA Approval', record_id: capaId, target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('capa approval notify', e);
    }
  }
}

async function notifyUser(title: string, message: string, capaId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title, message, module: 'CAPA Approval', record_id: capaId, user_id: userId, read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa approval notify user', e);
  }
}

async function saveEsignRecord(
  capa: CapaRecord,
  approval: CapaApproval,
  eSignature: string,
  actor: CapaApprovalActor,
) {
  if (!isFirebaseConfigured() || !eSignature.trim()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), 'esign_records'), {
      esign_record_id: eSignature,
      module_name: CAPA_APPROVAL_MODULE,
      record_id: capa.id,
      document_number: capa.capa_number,
      action_type: approval.current_workflow_step || 'Approval',
      signature_meaning: eSignature,
      user_id: actor.id,
      user_name: actor.name,
      user_email: actor.email || '',
      user_role: actor.role || '',
      signed_date_time: nowIso(),
      authentication_status: 'Success',
      is_test: false,
      is_deleted: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa esign record', e);
  }
}

async function loadWorkflowContext(capaId: string, capa: CapaRecord) {
  const [investigation, ca, pa, eff] = await Promise.all([
    getCapaInvestigationByCapaId(capaId),
    listCapaCorrectiveActions(capaId),
    listCapaPreventiveActions(capaId),
    getCapaEffectivenessReview(capaId),
  ]);
  const rcaApproved = isInvestigationApproved(investigation?.status);
  const effectivenessCompleted = canCapaCloseFromEffectiveness(eff)
    || ['Effective', 'Partially Effective'].includes(String(eff?.effectiveness_result || eff?.result || ''));
  return buildCapaWorkflowContext(
    capa,
    rcaApproved,
    ca.filter((a) => !a.is_deleted).length,
    pa.filter((a) => !a.is_deleted).length,
    effectivenessCompleted,
  );
}

function mapStepToApproval(capaId: string, capaNumber: string, step: CapaWorkflowStepDef): Omit<CapaApproval, 'id'> {
  const ts = nowIso();
  return {
    capa_id: capaId,
    capa_number: capaNumber,
    approval_id: buildApprovalId(capaNumber, step.level),
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

function normalizeApproval(docId: string, data: Record<string, unknown>): CapaApproval {
  const a = { id: docId, ...data } as CapaApproval;
  return {
    ...a,
    approval_status: a.approval_status || (a.decision === 'approved' ? 'Approved' : a.decision === 'rejected' ? 'Rejected' : 'Pending'),
    signed_at: a.signed_at ?? null,
  };
}

export async function getCapaApprovals(capaId: string): Promise<CapaApproval[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals),
      where('capa_id', '==', capaId),
      orderBy('created_at', 'asc'),
    ));
    return snap.docs.map((d) => normalizeApproval(d.id, d.data() as Record<string, unknown>));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals),
      where('capa_id', '==', capaId),
    ));
    return snap.docs.map((d) => normalizeApproval(d.id, d.data() as Record<string, unknown>))
      .filter((a) => !a.is_deleted)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
}

export async function getCapaApprovalHistory(capaId?: string): Promise<CapaApprovalHistoryEntry[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const q = capaId
      ? query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvalHistory), where('capa_id', '==', capaId), orderBy('created_at', 'desc'))
      : query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvalHistory), orderBy('created_at', 'desc'), limit(500));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaApprovalHistoryEntry));
  } catch {
    return [];
  }
}

export async function fetchAllCapaApprovalRecords(): Promise<CapaApproval[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals), limit(1000)));
    return snap.docs.map((d) => normalizeApproval(d.id, d.data() as Record<string, unknown>)).filter((a) => !a.is_deleted);
  } catch {
    return [];
  }
}

export async function initializeCapaApprovalWorkflow(capaId: string, actor: CapaApprovalActor): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const capa = await getCapaById(capaId);
    if (!capa) return { error: 'CAPA not found' };

    const existing = await getCapaApprovals(capaId);
    if (existing.some((a) => !a.is_deleted && ['Pending', 'Waiting', 'Escalated', 'Approved'].includes(a.approval_status || ''))) {
      return {};
    }

    const ctx = await loadWorkflowContext(capaId, capa);
    const gate = validateCapaApprovalAction('Submitted', ctx);
    if (!gate.ok) return { error: gate.error };

    const steps = buildCapaWorkflowSteps(ctx);
    const batch = steps.map((step) => mapStepToApproval(capaId, capa.capa_number, step));

    for (let i = 0; i < batch.length; i += 1) {
      const payload = { ...batch[i], approval_status: i === 0 ? 'Pending' : 'Waiting' };
      await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals), payload);
    }

    await updateCapa(capaId, { capa_status: 'submitted' }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true });
    await audit(actor, 'CAPA Submitted', capaId, 'Approval workflow initialized');
    await saveHistory({
      capa_id: capaId,
      capa_number: capa.capa_number,
      approval_id: batch[0]?.approval_id || '',
      action: 'CAPA Submitted',
      workflow_step: 'Submitted',
      user_id: actor.id,
      user_name: actor.name,
      user_role: actor.role || 'qa',
      comments: 'CAPA submitted for approval workflow',
      created_at: nowIso(),
      created_by: actor.id,
    }, actor);

    await notifyUser('CAPA Pending Approval', `${capa.capa_number} awaiting ${steps[1]?.stepName || 'Department Head Review'}`, capaId, capa.action_owner);
    await notifyRole('CAPA Pending Approval', `${capa.capa_number} — ${steps[1]?.stepName}`, capaId, ['production_manager', 'qa_manager']);
    if (ctx.headQaRequired) await notifyRole('Critical CAPA Submitted', capa.capa_number, capaId, ['head_qa']);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to initialize approval workflow' };
  }
}

async function completeCapaStepAndAdvance(
  approval: CapaApproval,
  capa: CapaRecord,
  action: 'approve' | 'reject' | 'send_back',
  payload: { comments?: string; rejection_reason?: string; send_back_reason?: string; e_signature?: string },
  actor: CapaApprovalActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase not configured' };
  const ts = nowIso();
  const stepName = approval.current_workflow_step || '';
  const ctx = await loadWorkflowContext(capa.id, capa);

  if (action === 'approve') {
    const validation = validateCapaApprovalAction(stepName, ctx);
    if (!validation.ok) return { error: validation.error };
    if (approval.e_signature_required && !payload.e_signature?.trim()) {
      return { error: 'E-signature required for this approval step.' };
    }
    const stepDef = buildCapaWorkflowSteps(ctx).find((s) => s.stepName === stepName);
    if (stepDef?.commentRequired && !payload.comments?.trim()) {
      return { error: 'Approval comment is required for this step.' };
    }
  }

  const statusMap = { approve: 'Approved', reject: 'Rejected', send_back: 'Sent Back' } as const;
  const decisionMap = { approve: 'approved', reject: 'rejected', send_back: 'sent_back' } as const;

  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals, approval.id), {
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

  if (payload.e_signature) await saveEsignRecord(capa, approval, payload.e_signature, actor);

  const actionLabel = action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Sent Back';
  await audit(actor, actionLabel, capa.id, payload.comments || payload.rejection_reason || payload.send_back_reason);
  await saveHistory({
    capa_id: capa.id,
    capa_number: capa.capa_number,
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

  let newStatus = mapCapaStatusForStep(stepName, action === 'approve' ? 'approve' : action);
  let lockCapa = false;

  if (action === 'approve') {
    const allApprovals = await getCapaApprovals(capa.id);
    const next = allApprovals
      .filter((a) => !a.is_deleted && a.approval_status === 'Waiting')
      .sort((a, b) => Number(a.approval_level) - Number(b.approval_level))[0];

    if (next) {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals, next.id), {
        approval_status: 'Pending',
        updated_at: ts,
      });
      newStatus = mapCapaStatusForStep(next.current_workflow_step || stepName, 'approve');
      await notifyRole('CAPA Pending Approval', `${capa.capa_number} — ${next.current_workflow_step}`, capa.id, [next.current_role || 'qa_manager']);
      await notifyUser('CAPA Approval Step', `${capa.capa_number} advanced to ${next.current_workflow_step}`, capa.id, capa.action_owner);
    } else if (stepName === 'Closure Approval') {
      newStatus = 'closed';
      lockCapa = true;
      await audit(actor, 'Final Approval', capa.id);
      await audit(actor, 'CAPA Locked', capa.id, 'Closure approval completed');
      await saveHistory({
        capa_id: capa.id,
        capa_number: capa.capa_number,
        approval_id: approval.approval_id || approval.id,
        action: 'CAPA Closed',
        workflow_step: 'Closed',
        user_id: actor.id,
        user_name: actor.name,
        user_role: actor.role || 'qa',
        comments: 'CAPA closure approved',
        created_at: ts,
        created_by: actor.id,
      }, actor);
      await notifyUser('CAPA Closed', capa.capa_number, capa.id, capa.action_owner);
      await notifyRole('CAPA Closed', capa.capa_number, capa.id, ['qa_manager', 'head_qa', 'admin']);
    } else if (stepName === 'Final Approval') {
      newStatus = 'approved';
      lockCapa = true;
      await audit(actor, 'Final Approval', capa.id);
      await audit(actor, 'CAPA Locked', capa.id, 'Final approval completed — record locked pending closure');
      await notifyUser('CAPA Final Approved', capa.capa_number, capa.id, capa.action_owner);
      await notifyRole('CAPA Final Approved', capa.capa_number, capa.id, ['qa_manager', 'head_qa']);
    }
  } else if (action === 'reject') {
    await notifyUser('CAPA Rejected', `${capa.capa_number}: ${payload.rejection_reason}`, capa.id, capa.action_owner);
    await notifyRole('CAPA Rejected', capa.capa_number, capa.id, ['qa_manager', 'head_qa']);
  } else if (action === 'send_back') {
    await notifyUser('CAPA Sent Back', `${capa.capa_number}: ${payload.send_back_reason}`, capa.id, capa.action_owner);
    await notifyRole('CAPA Sent Back', capa.capa_number, capa.id, ['production_manager', 'qa']);
  }

  await updateCapa(capa.id, {
    capa_status: newStatus,
    ...(lockCapa ? { is_locked: true } : {}),
    ...(newStatus === 'closed' ? { actual_completion_date: capa.actual_completion_date || today() } : {}),
  }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true });

  return {};
}

export async function approveCapaStep(
  capaId: string,
  approvalId: string,
  comments: string,
  eSignature: string,
  actor: CapaApprovalActor,
): Promise<{ error?: string }> {
  const capa = await getCapaById(capaId);
  if (!capa) return { error: 'CAPA not found' };
  if (capa.is_locked && capa.capa_status !== 'approved') return { error: 'CAPA record is locked' };
  const approvals = await getCapaApprovals(capaId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeCapaStepAndAdvance(approval, capa, 'approve', { comments, e_signature: eSignature }, actor);
}

export async function rejectCapaStep(
  capaId: string,
  approvalId: string,
  rejectionReason: string,
  comments: string,
  actor: CapaApprovalActor,
): Promise<{ error?: string }> {
  if (!rejectionReason.trim()) return { error: 'Rejection reason is mandatory' };
  const capa = await getCapaById(capaId);
  if (!capa) return { error: 'CAPA not found' };
  const approvals = await getCapaApprovals(capaId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeCapaStepAndAdvance(approval, capa, 'reject', { rejection_reason: rejectionReason, comments }, actor);
}

export async function sendBackCapaStep(
  capaId: string,
  approvalId: string,
  sendBackReason: string,
  comments: string,
  actor: CapaApprovalActor,
): Promise<{ error?: string }> {
  if (!sendBackReason.trim()) return { error: 'Send back reason is mandatory' };
  const capa = await getCapaById(capaId);
  if (!capa) return { error: 'CAPA not found' };
  const approvals = await getCapaApprovals(capaId);
  const approval = approvals.find((a) => a.id === approvalId || a.approval_id === approvalId);
  if (!approval) return { error: 'Approval step not found' };
  return completeCapaStepAndAdvance(approval, capa, 'send_back', { send_back_reason: sendBackReason, comments }, actor);
}

export async function escalateOverdueCapaApprovals(actor: CapaApprovalActor): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const all = await fetchAllCapaApprovalRecords();
  const todayStr = today();
  let count = 0;

  for (const a of all) {
    if (!['Pending', 'Escalated'].includes(a.approval_status || '')) continue;
    if (!a.due_date || a.due_date >= todayStr) continue;

    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.approvals, a.id), {
      approval_status: 'Escalated',
      escalation_status: 'Escalated',
      updated_at: nowIso(),
    });

    await audit(actor, 'Escalated', a.capa_id, `Overdue: ${a.current_workflow_step}`);
    await notifyRole('Overdue CAPA Approval', `${a.capa_number} — ${a.current_workflow_step}`, a.capa_id, ['admin', 'head_qa', 'qa_manager']);
    if (a.capa_number) {
      await saveHistory({
        capa_id: a.capa_id,
        capa_number: a.capa_number,
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

export async function reopenCapaRecord(
  capaId: string,
  reason: string,
  actor: CapaApprovalActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Reopen reason is required' };
  const capa = await getCapaById(capaId);
  if (!capa) return { error: 'CAPA not found' };
  if (!['closed', 'approved'].includes(capa.capa_status)) {
    return { error: 'Only closed or approved CAPA records can be reopened' };
  }

  try {
    await updateCapa(capaId, {
      capa_status: 'qa_review',
      is_locked: false,
    }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true, reopen: true });
    await audit(actor, 'CAPA Reopened', capaId, reason);
    await saveHistory({
      capa_id: capaId,
      capa_number: capa.capa_number,
      approval_id: '',
      action: 'CAPA Reopened',
      workflow_step: 'QA Review',
      user_id: actor.id,
      user_name: actor.name,
      user_role: actor.role || 'head_qa',
      comments: reason,
      created_at: nowIso(),
      created_by: actor.id,
    }, actor);
    await notifyUser('CAPA Reopened', `${capa.capa_number}: ${reason}`, capaId, capa.action_owner);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reopen failed' };
  }
}

export async function logCapaEsignResult(
  capaId: string,
  success: boolean,
  actor: CapaApprovalActor,
  detail?: string,
) {
  await audit(actor, success ? 'E-Sign Success' : 'E-Sign Failure', capaId, detail);
}

export async function fetchCapaApprovalPageData(capaId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const capa = await getCapaById(capaId);
    if (!capa) return { error: 'CAPA record not found.' };

    let [approvals, history, auditLogs] = await Promise.all([
      getCapaApprovals(capaId),
      getCapaApprovalHistory(capaId),
      getAuditLogsForCapaApproval(capaId),
    ]);

    const ctx = await loadWorkflowContext(capaId, capa);
    if (!approvals.length && ['implemented', 'effectiveness_completed', 'qa_review', 'submitted'].includes(capa.capa_status)) {
      const init = await initializeCapaApprovalWorkflow(capaId, { id: 'system', name: 'System', role: 'admin' });
      if (!init.error) {
        approvals = await getCapaApprovals(capaId);
        history = await getCapaApprovalHistory(capaId);
      }
    }

    const current = getCurrentPendingCapaApproval(approvals);
    return {
      capa,
      approvals,
      history,
      auditLogs,
      current,
      workflowSteps: buildCapaWorkflowSteps(ctx),
      workflowContext: ctx,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load approval data' };
  }
}

async function getAuditLogsForCapaApproval(capaId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.auditLogs),
      where('recordId', '==', capaId),
      limit(100),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function fetchCapaApprovalDashboardData(actor: CapaApprovalActor, role?: string) {
  const [approvals, history] = await Promise.all([
    fetchAllCapaApprovalRecords(),
    getCapaApprovalHistory(),
  ]);

  let records: CapaRecord[] = [];
  if (isFirebaseConfigured()) {
    try {
      records = await listCapas();
    } catch {
      records = [];
    }
  }

  const { computeCapaApprovalDashboardCounts } = await import('./capa-approval-records');
  return {
    approvals,
    history,
    records,
    counts: computeCapaApprovalDashboardCounts(approvals, history, records, actor.id, role),
  };
}

export {
  buildCapaWorkflowSteps,
  computeCapaApprovalDashboardCounts,
  getCurrentPendingCapaApproval,
  mapHistoryToCapaApprovalTimeline,
  capaApprovalMeaning,
} from '@/lib/capa-approval-records';
