import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getCapaById } from '@/lib/capa-service';
import { getComplaintApprovals } from '@/lib/complaint-approval-service';
import { getActiveComplaintCapaLink } from '@/lib/complaint-capa-service';
import {
  COMPLAINT_CLOSURE_MODULE,
  computeComplaintClosureReadiness,
  defaultComplaintClosureForm,
  mapComplaintClosureHistory,
  mapReadinessToComplaintClosureFields,
  type ComplaintClosureActor,
  type ComplaintClosureFormInput,
} from '@/lib/complaint-closure-records';
import { getComplaintImpactAssessment } from '@/lib/complaint-impact-service';
import { getComplaintInvestigationRecord } from '@/lib/complaint-investigation-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { getRecallById } from '@/lib/recall-service';
import {
  COMPLAINT_COLLECTIONS,
  type ComplaintClosure,
  type ComplaintRecord,
} from '@/lib/complaint-types';
import {
  getAttachments,
  getAuditLogsForComplaint,
  getComplaintById,
  listComplaints,
  updateComplaint,
} from '@/lib/complaint-service';

export type { ComplaintClosureActor, ComplaintClosureFormInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function buildClosureId(complaintNumber: string) {
  return `CCL-${complaintNumber.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function audit(actor: ComplaintClosureActor, actionType: string, complaintId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: COMPLAINT_CLOSURE_MODULE,
      collectionName: COMPLAINT_COLLECTIONS.closures,
      recordId: complaintId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('complaint closure audit', e);
  }
}

async function notify(title: string, message: string, complaintId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.notifications), {
        title, message, module: 'Complaint', record_id: complaintId, target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('complaint closure notify', e);
    }
  }
}

async function recallEvaluationComplete(record: ComplaintRecord): Promise<boolean> {
  if (!record.recall_evaluation_required && !record.recall_required) return true;
  if (!record.linked_recall_id) return false;
  const recall = await getRecallById(record.linked_recall_id);
  if (!recall) return false;
  const status = (recall.recall_status || '').toLowerCase();
  return ['closed', 'completed', 'in_progress', 'recovery_in_progress', 'regulatory_notified'].includes(status);
}

export async function getComplaintClosure(complaintId: string): Promise<ComplaintClosure | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures),
      where('complaint_id', '==', complaintId),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as ComplaintClosure;
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures),
      where('complaint_id', '==', complaintId),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as ComplaintClosure;
  }
}

async function loadClosureContext(complaintId: string) {
  const record = await getComplaintById(complaintId);
  if (!record) return null;
  const [investigation, impact, approvals, attachments, capaLink, recallComplete] = await Promise.all([
    getComplaintInvestigationRecord(complaintId),
    getComplaintImpactAssessment(complaintId),
    getComplaintApprovals(complaintId),
    getAttachments(complaintId),
    getActiveComplaintCapaLink(complaintId),
    recallEvaluationComplete(record),
  ]);
  const capa = record.linked_capa_id
    ? await getCapaById(record.linked_capa_id)
    : (capaLink?.capa_id ? await getCapaById(capaLink.capa_id) : null);
  return { record, investigation, impact, approvals, attachments, capaLink, capa, recallComplete };
}

export async function fetchComplaintClosurePageData(complaintId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const ctx = await loadClosureContext(complaintId);
    if (!ctx) return { error: 'Complaint not found.' };
    const closure = await getComplaintClosure(complaintId);
    const auditLogs = await getAuditLogsForComplaint(complaintId);
    const formDefaults = defaultComplaintClosureForm(
      ctx.record,
      ctx.investigation,
      ctx.impact,
      ctx.capaLink,
      ctx.capa,
      ctx.attachments,
      ctx.recallComplete,
      closure,
    );
    const readiness = computeComplaintClosureReadiness({ ...ctx, form: formDefaults });
    return {
      record: ctx.record,
      closure,
      investigation: ctx.investigation,
      impact: ctx.impact,
      capa: ctx.capa,
      capaLink: ctx.capaLink,
      attachments: ctx.attachments,
      approvals: ctx.approvals,
      readiness,
      formDefaults,
      timeline: mapComplaintClosureHistory(auditLogs),
      auditLogs,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load closure data' };
  }
}

export async function listComplaintsForClosure(max = 100) {
  if (!isFirebaseConfigured()) return [];
  try {
    const records = (await listComplaints())
      .filter((r) => r.status !== 'draft')
      .slice(0, max);
    return Promise.all(records.map(async (r) => ({
      ...r,
      closure: await getComplaintClosure(r.id),
    })));
  } catch (e) {
    console.error('listComplaintsForClosure', e);
    return [];
  }
}

export async function saveComplaintClosureDraft(
  complaintId: string,
  form: ComplaintClosureFormInput,
  actor: ComplaintClosureActor,
): Promise<{ closure?: ComplaintClosure; error?: string }> {
  const ctx = await loadClosureContext(complaintId);
  if (!ctx) return { error: 'Complaint not found' };

  const readiness = computeComplaintClosureReadiness({ ...ctx, form });
  const ts = nowIso();
  const payload = {
    ...mapReadinessToComplaintClosureFields(readiness, ctx.record, ctx.impact, form),
    closure_id: buildClosureId(ctx.record.complaint_number),
    closure_status: readiness.ready ? 'Ready For Closure' : 'Pending',
    readiness_percent: readiness.percent,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  try {
    const existing = await getComplaintClosure(complaintId);
    let result: ComplaintClosure;
    if (existing) {
      await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures, existing.id), payload);
      result = { ...existing, ...payload, id: existing.id };
      await audit(actor, 'Closure Readiness Checked', complaintId, `${readiness.percent}% ready`);
    } else {
      const ref = await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures), {
        ...payload,
        created_at: ts,
        created_by: actor.id,
        created_by_name: actor.name,
      });
      result = { id: ref.id, ...payload, created_at: ts, created_by: actor.id, created_by_name: actor.name };
      await audit(actor, 'Closure Checklist Generated', complaintId);
    }
    return { closure: result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save closure draft' };
  }
}

export async function submitComplaintClosureForQaReview(
  complaintId: string,
  form: ComplaintClosureFormInput,
  actor: ComplaintClosureActor,
): Promise<{ error?: string }> {
  if (!form.qa_closure_comments.trim()) return { error: 'QA closure comments are required' };
  if (!form.final_complaint_conclusion.trim()) return { error: 'Final complaint conclusion is required' };

  const draft = await saveComplaintClosureDraft(complaintId, form, actor);
  if (draft.error || !draft.closure) return { error: draft.error || 'Failed to save' };

  const ctx = await loadClosureContext(complaintId);
  if (!ctx) return { error: 'Complaint not found' };
  const readiness = computeComplaintClosureReadiness({ ...ctx, form });
  if (!readiness.ready) return { error: `Not ready for closure: ${readiness.blockers.join('; ')}` };

  try {
    await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures, draft.closure.id), {
      closure_status: 'QA Review',
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await updateComplaint(complaintId, { status: 'qa_review' }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, true);
    await audit(actor, 'Closure Submitted for QA Review', complaintId);
    await notify('Complaint Closure QA Review', ctx.record.complaint_number, complaintId, ['qa_manager', 'head_qa']);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Submit failed' };
  }
}

async function completePendingClosedApprovalStep(complaintId: string, actor: ComplaintClosureActor, comments: string, eSignature: string) {
  const approvals = await getComplaintApprovals(complaintId);
  const closedPending = approvals.find(
    (a) => !a.is_deleted
      && a.current_workflow_step === 'Closed'
      && ['Pending', 'Escalated'].includes(a.approval_status || ''),
  );
  if (!closedPending) return;
  const ts = nowIso();
  await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.approvals, closedPending.id), {
    approval_status: 'Approved',
    decision: 'approved',
    approver_id: actor.id,
    approver_name: actor.name,
    comments,
    e_signature: eSignature,
    e_signature_status: eSignature ? 'Signed' : 'Not Signed',
    signed_at: ts,
    completed_date: today(),
    updated_at: ts,
  });
}

export async function closeComplaintWithClosure(
  complaintId: string,
  form: ComplaintClosureFormInput,
  eSignature: string,
  actor: ComplaintClosureActor,
): Promise<{ error?: string }> {
  if (!complaintId.trim()) return { error: 'Complaint ID is required' };
  if (!form.qa_closure_comments.trim()) return { error: 'QA closure comments are required' };
  if (!form.final_complaint_conclusion.trim()) return { error: 'Final complaint conclusion is required' };

  const ctx = await loadClosureContext(complaintId);
  if (!ctx) return { error: 'Complaint not found' };
  if (ctx.record.status === 'closed') return { error: 'Complaint is already closed' };

  const readiness = computeComplaintClosureReadiness({ ...ctx, form });
  if (!readiness.ready) return { error: `Cannot close: ${readiness.blockers.join('; ')}` };

  const closureRecord = await getComplaintClosure(complaintId);
  const eSignRequired = closureRecord?.e_signature_required !== false;
  if (eSignRequired && !eSignature.trim()) return { error: 'E-signature is required for closure' };

  const ts = nowIso();
  try {
    const closurePayload = {
      ...mapReadinessToComplaintClosureFields(readiness, ctx.record, ctx.impact, form),
      closure_date: today(),
      closed_by: actor.id,
      closed_by_name: actor.name,
      closure_status: 'Closed',
      signed_by: eSignature || actor.name,
      signed_date: ts,
      qa_closure_comments: form.qa_closure_comments,
      final_complaint_conclusion: form.final_complaint_conclusion,
      readiness_percent: 100,
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    };

    if (closureRecord) {
      await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures, closureRecord.id), closurePayload);
    } else {
      await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures), {
        ...closurePayload,
        closure_id: buildClosureId(ctx.record.complaint_number),
        created_at: ts,
        created_by: actor.id,
        created_by_name: actor.name,
      });
    }

    await completePendingClosedApprovalStep(complaintId, actor, form.qa_closure_comments, eSignature);

    await updateComplaint(complaintId, {
      status: 'closed',
      closure_date: today(),
      qa_remarks: form.qa_closure_comments,
    }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, true);

    if (eSignature) {
      try {
        await addDoc(collection(getFirebaseFirestore(), 'esign_records'), {
          module: COMPLAINT_CLOSURE_MODULE,
          record_id: complaintId,
          complaint_number: ctx.record.complaint_number,
          action: 'Close Complaint',
          signed_by: actor.id,
          signed_by_name: actor.name,
          signature: eSignature,
          signed_at: ts,
        });
      } catch (e) {
        console.error('complaint closure esign', e);
      }
    }

    await audit(actor, 'Complaint Closed', complaintId, form.final_complaint_conclusion);
    if (eSignature) await audit(actor, 'E-Sign Success', complaintId, eSignature);
    await notify('Complaint Closed', ctx.record.complaint_number, complaintId, ['qa_manager', 'head_qa', ctx.record.created_by]);
    return {};
  } catch (e) {
    await audit(actor, 'E-Sign Failure', complaintId, e instanceof Error ? e.message : 'Close failed');
    return { error: e instanceof Error ? e.message : 'Closure failed' };
  }
}

export async function rejectComplaintClosure(
  complaintId: string,
  reason: string,
  actor: ComplaintClosureActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Rejection reason required' };
  const closure = await getComplaintClosure(complaintId);
  if (!closure) return { error: 'Closure record not found' };

  try {
    await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures, closure.id), {
      closure_status: 'Rejected',
      qa_closure_comments: reason,
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await audit(actor, 'Closure Rejected', complaintId, reason);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reject failed' };
  }
}

export async function reopenComplaintClosure(
  complaintId: string,
  reason: string,
  eSignature: string,
  actor: ComplaintClosureActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Reopen reason is required' };
  if (!eSignature.trim()) return { error: 'E-signature is required to reopen' };

  const record = await getComplaintById(complaintId);
  if (!record) return { error: 'Complaint not found' };
  if (record.status !== 'closed') return { error: 'Only closed complaints can be reopened' };

  try {
    const closure = await getComplaintClosure(complaintId);
    const ts = nowIso();
    if (closure) {
      await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.closures, closure.id), {
        closure_status: 'Reopened',
        reopen_reason: reason,
        updated_at: ts,
        updated_by: actor.id,
        updated_by_name: actor.name,
      });
    }
    await updateComplaint(complaintId, {
      status: 'qa_review',
      closure_date: null,
      qa_remarks: reason,
    }, { id: actor.id, name: actor.name, role: actor.role || 'head_qa' }, true, { reopen: true });

    await addDoc(collection(getFirebaseFirestore(), 'esign_records'), {
      module: COMPLAINT_CLOSURE_MODULE,
      record_id: complaintId,
      complaint_number: record.complaint_number,
      action: 'Reopen Complaint',
      signed_by: actor.id,
      signed_by_name: actor.name,
      signature: eSignature,
      signed_at: ts,
    });

    await audit(actor, 'Complaint Reopened', complaintId, reason);
    await audit(actor, 'E-Sign Success', complaintId, eSignature);
    await notify('Complaint Reopened', record.complaint_number, complaintId, ['qa_manager', 'head_qa', record.created_by]);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reopen failed' };
  }
}

export async function fetchComplaintClosureDashboardData() {
  const withClosure = await listComplaintsForClosure();
  const pending = withClosure.filter((r) => r.status !== 'closed' && r.status !== 'rejected');
  const ready = withClosure.filter((r) => r.closure?.closure_status === 'Ready For Closure');
  const closed = withClosure.filter((r) => r.status === 'closed');
  const qaReview = withClosure.filter((r) => r.closure?.closure_status === 'QA Review');
  return { pending, ready, closed, qaReview, all: withClosure };
}

export { computeComplaintClosureReadiness, mapComplaintClosureHistory };
