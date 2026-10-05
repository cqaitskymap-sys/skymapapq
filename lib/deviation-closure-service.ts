import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getCapaById } from '@/lib/capa-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { getActiveCapaLink } from '@/lib/deviation-capa-service';
import {
  computeClosureReadiness,
  mapClosureHistory,
  mapReadinessToClosureFields,
  type ClosureActor,
  type ClosureFormInput,
} from '@/lib/deviation-closure-records';
import {
  DEVIATION_COLLECTIONS,
  type DeviationClosure,
  type DeviationRecord,
} from '@/lib/deviation-types';
import {
  applyOverdueCheck,
  getApprovals,
  getAttachments,
  getAuditLogsForDeviation,
  getDeviationById,
  getImpactAssessment,
  getInvestigation,
  listDeviations,
  updateDeviation,
} from '@/lib/deviation-service';

export type { ClosureActor, ClosureFormInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function buildClosureId(deviationNumber: string) {
  return `DCL-${deviationNumber.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function audit(actor: ClosureActor, actionType: string, deviationId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: 'Deviation Closure',
      collectionName: DEVIATION_COLLECTIONS.closures,
      recordId: deviationId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
  } catch (e) {
    console.error('closure audit', e);
  }
}

async function notify(title: string, message: string, deviationId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.notifications), {
      title, message, module: 'Deviation', record_id: deviationId, user_id: userId, read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('closure notify', e);
  }
}

export async function getDeviationClosure(deviationId: string): Promise<DeviationClosure | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures),
      where('deviation_id', '==', deviationId),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as DeviationClosure;
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures),
      where('deviation_id', '==', deviationId),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as DeviationClosure;
  }
}

async function loadClosureContext(deviationId: string) {
  const record = await getDeviationById(deviationId);
  if (!record) return null;
  const [investigation, impact, approvals, attachments, capaLink] = await Promise.all([
    getInvestigation(deviationId),
    getImpactAssessment(deviationId),
    getApprovals(deviationId),
    getAttachments(deviationId),
    getActiveCapaLink(deviationId),
  ]);
  const capa = record.linked_capa_id
    ? await getCapaById(record.linked_capa_id)
    : (capaLink?.capa_id ? await getCapaById(capaLink.capa_id) : null);
  return { record, investigation, impact, approvals, attachments, capaLink, capa };
}

export async function fetchClosurePageData(deviationId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const ctx = await loadClosureContext(deviationId);
    if (!ctx) return { error: 'Deviation not found.' };
    const closure = await getDeviationClosure(deviationId);
    const auditLogs = await getAuditLogsForDeviation(deviationId);
    const defaultForm: ClosureFormInput = {
      investigation_completed: ctx.investigation?.investigation_status === 'Completed' || ctx.investigation?.investigation_status === 'Closed',
      impact_assessment_completed: ['Approved', 'Submitted'].includes(ctx.impact?.status || ''),
      root_cause_identified: Boolean(ctx.investigation?.root_cause_details || ctx.record.root_cause),
      capa_required: ctx.record.capa_required,
      capa_linked: Boolean(ctx.record.linked_capa_number || ctx.capaLink),
      capa_completed: Boolean(ctx.capa && ['closed', 'approved'].includes(ctx.capa.capa_status)),
      effectiveness_check_completed: !ctx.capa?.effectiveness_check_required || ['Effective', 'N/A'].includes(ctx.capa?.effectiveness_result || ''),
      product_quality_impact_resolved: !ctx.record.product_quality_impacted,
      patient_safety_impact_resolved: !ctx.record.patient_safety_impacted,
      regulatory_impact_resolved: !ctx.record.regulatory_impact,
      all_attachments_reviewed: ctx.attachments.length > 0,
      qa_closure_comments: closure?.qa_closure_comments || '',
      final_closure_conclusion: closure?.final_closure_conclusion || '',
    };
    const readiness = computeClosureReadiness({ ...ctx, form: defaultForm });
    return {
      record: applyOverdueCheck(ctx.record),
      closure,
      investigation: ctx.investigation,
      impact: ctx.impact,
      capa: ctx.capa,
      capaLink: ctx.capaLink,
      attachments: ctx.attachments,
      approvals: ctx.approvals,
      readiness,
      formDefaults: defaultForm,
      timeline: mapClosureHistory(auditLogs),
      auditLogs,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load closure data' };
  }
}

export async function listClosureDeviations(max = 100) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.deviations),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const records = snap.docs
      .map((d) => applyOverdueCheck({ id: d.id, ...d.data() } as DeviationRecord))
      .filter((r) => !r.is_deleted && r.status !== 'draft');

    return Promise.all(records.map(async (r) => ({
      ...r,
      closure: await getDeviationClosure(r.id),
    })));
  } catch (e) {
    console.error('listClosureDeviations', e);
    return [];
  }
}

export async function saveClosureDraft(
  deviationId: string,
  form: ClosureFormInput,
  actor: ClosureActor,
): Promise<{ closure?: DeviationClosure; error?: string }> {
  const ctx = await loadClosureContext(deviationId);
  if (!ctx) return { error: 'Deviation not found' };

  const readiness = computeClosureReadiness({ ...ctx, form });
  const ts = nowIso();
  const payload = {
    ...mapReadinessToClosureFields(readiness, ctx.record, ctx.investigation, ctx.impact, ctx.capa, form),
    closure_id: buildClosureId(ctx.record.deviation_number),
    closure_status: readiness.ready ? 'Ready For Closure' : 'Pending',
    readiness_percent: readiness.percent,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  try {
    const existing = await getDeviationClosure(deviationId);
    let result: DeviationClosure;
    if (existing) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures, existing.id), payload);
      result = { ...existing, ...payload, id: existing.id };
      await audit(actor, 'Closure Readiness Checked', deviationId, `${readiness.percent}% ready`);
    } else {
      const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures), {
        ...payload,
        created_at: ts,
        created_by: actor.id,
        created_by_name: actor.name,
      });
      result = { id: ref.id, ...payload, created_at: ts, created_by: actor.id, created_by_name: actor.name };
      await audit(actor, 'Closure Checklist Generated', deviationId);
    }
    return { closure: result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save closure draft' };
  }
}

export async function submitClosureForQaReview(
  deviationId: string,
  form: ClosureFormInput,
  actor: ClosureActor,
): Promise<{ error?: string }> {
  if (!form.qa_closure_comments.trim()) return { error: 'QA closure comments are required' };
  if (!form.final_closure_conclusion.trim()) return { error: 'Final closure conclusion is required' };

  const draft = await saveClosureDraft(deviationId, form, actor);
  if (draft.error || !draft.closure) return { error: draft.error || 'Failed to save' };

  const ctx = await loadClosureContext(deviationId);
  if (!ctx) return { error: 'Deviation not found' };
  const readiness = computeClosureReadiness({ ...ctx, form });
  if (!readiness.ready) return { error: `Not ready for closure: ${readiness.blockers.join('; ')}` };

  try {
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures, draft.closure.id), {
      closure_status: 'QA Review',
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await updateDeviation(deviationId, { status: 'qa_review' }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });
    await audit(actor, 'Closure Submitted', deviationId);
    await notify('qa_manager', 'Deviation Closure QA Review', ctx.record.deviation_number, deviationId);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Submit failed' };
  }
}

export async function closeDeviationWithClosure(
  deviationId: string,
  form: ClosureFormInput,
  eSignature: string,
  actor: ClosureActor,
): Promise<{ error?: string }> {
  if (!form.qa_closure_comments.trim()) return { error: 'QA closure comments are required' };
  if (!form.final_closure_conclusion.trim()) return { error: 'Final closure conclusion is required' };

  const ctx = await loadClosureContext(deviationId);
  if (!ctx) return { error: 'Deviation not found' };
  const readiness = computeClosureReadiness({ ...ctx, form });
  if (!readiness.ready) return { error: `Cannot close: ${readiness.blockers.join('; ')}` };

  const closureRecord = await getDeviationClosure(deviationId);
  const eSignRequired = closureRecord?.e_signature_required !== false;
  if (eSignRequired && !eSignature.trim()) return { error: 'E-signature is required for closure' };

  if (ctx.record.status !== 'approved' && ctx.record.status !== 'qa_review') {
    return { error: 'Deviation must be approved or in QA review before closure' };
  }

  const ts = nowIso();
  try {
    const closurePayload = {
      ...mapReadinessToClosureFields(readiness, ctx.record, ctx.investigation, ctx.impact, ctx.capa, form),
      closure_date: today(),
      closed_by: actor.id,
      closed_by_name: actor.name,
      closure_status: 'Closed',
      signed_by: eSignature || actor.name,
      signed_date: ts,
      qa_closure_comments: form.qa_closure_comments,
      final_closure_conclusion: form.final_closure_conclusion,
      readiness_percent: 100,
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    };

    if (closureRecord) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures, closureRecord.id), closurePayload);
    } else {
      await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures), {
        ...closurePayload,
        closure_id: buildClosureId(ctx.record.deviation_number),
        created_at: ts,
        created_by: actor.id,
        created_by_name: actor.name,
      });
    }

    await updateDeviation(deviationId, {
      status: 'closed',
      actual_closure_date: today(),
      qa_remarks: form.qa_closure_comments,
    }, { id: actor.id, name: actor.name, role: actor.role || 'qa' }, { workflow: true });

    await audit(actor, 'Deviation Closed', deviationId, form.final_closure_conclusion);
    if (eSignature) await audit(actor, 'E-Sign Success', deviationId, eSignature);
    await notify(ctx.record.created_by, 'Deviation Closed', ctx.record.deviation_number, deviationId);
    await notify('production_manager', 'Deviation Closed', `${ctx.record.deviation_number} closed`, deviationId);
    return {};
  } catch (e) {
    await audit(actor, 'E-Sign Failure', deviationId, e instanceof Error ? e.message : 'Close failed');
    return { error: e instanceof Error ? e.message : 'Closure failed' };
  }
}

export async function rejectClosure(
  deviationId: string,
  reason: string,
  actor: ClosureActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Rejection reason required' };
  const closure = await getDeviationClosure(deviationId);
  if (!closure) return { error: 'Closure record not found' };

  try {
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures, closure.id), {
      closure_status: 'Rejected',
      qa_closure_comments: reason,
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await audit(actor, 'Closure Rejected', deviationId, reason);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reject failed' };
  }
}

export async function reopenDeviationClosure(
  deviationId: string,
  reason: string,
  eSignature: string,
  actor: ClosureActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Reopen reason is required' };
  if (!eSignature.trim()) return { error: 'E-signature is required to reopen' };

  const record = await getDeviationById(deviationId);
  if (!record) return { error: 'Deviation not found' };
  if (record.status !== 'closed') return { error: 'Only closed deviations can be reopened' };

  try {
    const closure = await getDeviationClosure(deviationId);
    if (closure) {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.closures, closure.id), {
        closure_status: 'Reopened',
        reopen_reason: reason,
        updated_at: nowIso(),
        updated_by: actor.id,
        updated_by_name: actor.name,
      });
    }
    await updateDeviation(deviationId, {
      status: 'qa_review',
      actual_closure_date: null,
      qa_remarks: reason,
    }, { id: actor.id, name: actor.name, role: actor.role || 'head_qa' }, { workflow: true, reopen: true });
    await audit(actor, 'Deviation Reopened', deviationId, reason);
    await audit(actor, 'E-Sign Success', deviationId, eSignature);
    await notify(record.created_by, 'Deviation Reopened', record.deviation_number, deviationId);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reopen failed' };
  }
}

export async function fetchClosureDashboardData() {
  const deviations = await listDeviations();
  const withClosure = await listClosureDeviations();
  const pending = withClosure.filter((r) => r.status !== 'closed' && r.status !== 'draft');
  const ready = withClosure.filter((r) => r.closure?.closure_status === 'Ready For Closure');
  const closed = withClosure.filter((r) => r.status === 'closed');
  const qaReview = withClosure.filter((r) => r.closure?.closure_status === 'QA Review');
  return { pending, ready, closed, qaReview, all: withClosure };
}

export { computeClosureReadiness, mapClosureHistory };
