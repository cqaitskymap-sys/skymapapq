import {
  collection, doc, addDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getCapaById } from '@/lib/capa-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { getActiveOosCapaLink, checkRepeatOos } from '@/lib/oos-capa-service';
import {
  computeOosClosureReadiness,
  mapOosClosureHistory,
  mapReadinessToOosClosureFields,
  OOS_CLOSURE_MODULE,
  type OosClosureActor,
  type OosClosureFormInput,
} from '@/lib/oos-closure-records';
import { impactYes } from '@/lib/oos-approval-records';
import {
  OOS_COLLECTIONS,
  type OosClosure,
  type OosRecord,
} from '@/lib/oos-types';
import {
  getApprovals,
  getAttachments,
  getAuditLogsForOos,
  getImpactAssessment,
  getOosById,
  getPhase1,
  getPhase2,
  listOosRecords,
  setBatchReleaseEligibility,
  updateOosRecord,
} from '@/lib/oos-service';

export type { OosClosureActor, OosClosureFormInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function toOosActor(actor: OosClosureActor) {
  return { id: actor.id, name: actor.name, role: actor.role || 'qa' };
}

function buildClosureId(oosNumber: string) {
  return `OCL-${oosNumber.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function audit(actor: OosClosureActor, actionType: string, oosId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: OOS_CLOSURE_MODULE,
      collectionName: OOS_COLLECTIONS.closures,
      recordId: oosId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('oos closure audit', e);
  }
}

async function notifyRoles(title: string, message: string, oosId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.notifications), {
        title, message, module: 'OOS', record_id: oosId, target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('oos closure notify', e);
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
    console.error('oos closure notify user', e);
  }
}

export async function getOosClosure(oosId: string): Promise<OosClosure | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.closures),
      where('oos_id', '==', oosId),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as OosClosure;
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.closures),
      where('oos_id', '==', oosId),
      limit(1),
    ));
    if (snap.empty) return null;
    const docData = snap.docs[0].data();
    if (docData.is_deleted) return null;
    return { id: snap.docs[0].id, ...docData } as OosClosure;
  }
}

async function loadClosureContext(oosId: string) {
  const record = await getOosById(oosId);
  if (!record) return null;
  const [phase1, phase2, impact, approvals, attachments, capaLink] = await Promise.all([
    getPhase1(oosId),
    getPhase2(oosId),
    getImpactAssessment(oosId),
    getApprovals(oosId),
    getAttachments(oosId),
    getActiveOosCapaLink(oosId),
  ]);
  const capa = capaLink?.capa_id ? await getCapaById(capaLink.capa_id) : null;
  const isRepeatOos = await checkRepeatOos(record);
  return { record, phase1, phase2, impact, approvals, attachments, capaLink, capa, isRepeatOos };
}

function buildDefaultForm(
  ctx: NonNullable<Awaited<ReturnType<typeof loadClosureContext>>>,
  closure: OosClosure | null,
): OosClosureFormInput {
  const { record, impact, attachments } = ctx;
  return {
    batch_impact_resolved: closure?.batch_impact_resolved ?? !impactYes(impact?.batch_impact),
    product_quality_impact_resolved: closure?.product_quality_impact_resolved ?? !impactYes(impact?.product_quality_impact || impact?.product_impact),
    patient_safety_impact_resolved: closure?.patient_safety_impact_resolved ?? !impactYes(impact?.patient_safety_impact),
    regulatory_impact_resolved: closure?.regulatory_impact_resolved ?? !impactYes(impact?.regulatory_impact),
    market_impact_resolved: closure?.market_impact_resolved ?? !impactYes(impact?.market_impact),
    all_attachments_reviewed: closure?.all_attachments_reviewed ?? attachments.length > 0,
    qa_closure_comments: closure?.qa_closure_comments || '',
    final_oos_conclusion: closure?.final_oos_conclusion || record.root_cause || '',
  };
}

export async function fetchOosClosurePageData(oosId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const ctx = await loadClosureContext(oosId);
    if (!ctx) return { error: 'OOS record not found.' };
    const closure = await getOosClosure(oosId);
    const auditLogs = await getAuditLogsForOos(oosId);
    const formDefaults = buildDefaultForm(ctx, closure);
    const readiness = computeOosClosureReadiness({ ...ctx, form: formDefaults });
    return {
      record: ctx.record,
      closure,
      phase1: ctx.phase1,
      phase2: ctx.phase2,
      impact: ctx.impact,
      capa: ctx.capa,
      capaLink: ctx.capaLink,
      attachments: ctx.attachments,
      approvals: ctx.approvals,
      readiness,
      formDefaults,
      timeline: mapOosClosureHistory(auditLogs),
      auditLogs,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load closure data' };
  }
}

export async function listOosClosureRecords(max = 100) {
  if (!isFirebaseConfigured()) return [];
  try {
    const records = (await listOosRecords())
      .filter((r) => r.status !== 'draft' && !['rejected'].includes(r.status));
    const slice = records.slice(0, max);
    return Promise.all(slice.map(async (r) => ({
      ...r,
      closure: await getOosClosure(r.id),
    })));
  } catch (e) {
    console.error('listOosClosureRecords', e);
    return [];
  }
}

export async function saveOosClosureDraft(
  oosId: string,
  form: OosClosureFormInput,
  actor: OosClosureActor,
): Promise<{ closure?: OosClosure; error?: string }> {
  const ctx = await loadClosureContext(oosId);
  if (!ctx) return { error: 'OOS record not found' };

  const readiness = computeOosClosureReadiness({ ...ctx, form });
  const ts = nowIso();
  const payload = {
    ...mapReadinessToOosClosureFields(readiness, ctx.record, ctx.phase1, form),
    closure_id: buildClosureId(ctx.record.oos_number),
    readiness_percent: readiness.percent,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  try {
    const existing = await getOosClosure(oosId);
    let result: OosClosure;
    if (existing) {
      await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.closures, existing.id), payload);
      result = { ...existing, ...payload, id: existing.id };
      await audit(actor, 'Closure Readiness Checked', oosId, `${readiness.percent}% ready`);
    } else {
      const ref = await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.closures), {
        ...payload,
        created_at: ts,
        created_by: actor.id,
        created_by_name: actor.name,
        is_deleted: false,
      });
      result = { id: ref.id, ...payload, created_at: ts, created_by: actor.id, created_by_name: actor.name };
      await audit(actor, 'Closure Checklist Generated', oosId);
    }
    return { closure: result };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save closure draft' };
  }
}

export async function submitOosClosureForQaReview(
  oosId: string,
  form: OosClosureFormInput,
  actor: OosClosureActor,
): Promise<{ error?: string }> {
  if (!form.qa_closure_comments.trim()) return { error: 'QA closure comments are required' };
  if (!form.final_oos_conclusion.trim()) return { error: 'Final OOS conclusion is required' };

  const draft = await saveOosClosureDraft(oosId, form, actor);
  if (draft.error || !draft.closure) return { error: draft.error || 'Failed to save' };

  const ctx = await loadClosureContext(oosId);
  if (!ctx) return { error: 'OOS record not found' };
  const readiness = computeOosClosureReadiness({ ...ctx, form });
  if (!readiness.ready) return { error: `Not ready for closure: ${readiness.blockers.join('; ')}` };

  try {
    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.closures, draft.closure.id), {
      closure_status: 'QA Review',
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await audit(actor, 'Closure Submitted', oosId);
    await notifyRoles('OOS Closure QA Review', ctx.record.oos_number, oosId, ['qa_manager', 'head_qa']);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Submit failed' };
  }
}

export async function closeOosWithClosure(
  oosId: string,
  form: OosClosureFormInput,
  eSignature: string,
  actor: OosClosureActor,
): Promise<{ error?: string }> {
  if (!form.qa_closure_comments.trim()) return { error: 'QA closure comments are required' };
  if (!form.final_oos_conclusion.trim()) return { error: 'Final OOS conclusion is required' };

  const ctx = await loadClosureContext(oosId);
  if (!ctx) return { error: 'OOS record not found' };
  const readiness = computeOosClosureReadiness({ ...ctx, form });
  if (!readiness.ready) return { error: `Cannot close: ${readiness.blockers.join('; ')}` };

  if (ctx.record.status !== 'approved') {
    return { error: 'OOS must be final approved before closure' };
  }

  const closureRecord = await getOosClosure(oosId);
  const eSignRequired = closureRecord?.e_signature_required !== false;
  if (eSignRequired && !eSignature.trim()) return { error: 'E-signature is required for closure' };

  const ts = nowIso();
  try {
    const closurePayload = {
      ...mapReadinessToOosClosureFields(readiness, ctx.record, ctx.phase1, form),
      closure_date: today(),
      closed_by: actor.id,
      closed_by_name: actor.name,
      closure_status: 'Closed' as const,
      signed_by: eSignature || actor.name,
      signed_date: ts,
      readiness_percent: 100,
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    };

    if (closureRecord) {
      await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.closures, closureRecord.id), closurePayload);
    } else {
      await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.closures), {
        ...closurePayload,
        closure_id: buildClosureId(ctx.record.oos_number),
        created_at: ts,
        created_by: actor.id,
        created_by_name: actor.name,
        is_deleted: false,
      });
    }

    await updateOosRecord(oosId, {
      status: 'closed',
      actual_closure_date: today(),
      ...(ctx.record.batch_release_blocked ? { batch_release_blocked: false } : {}),
    }, toOosActor(actor), { workflow: true });

    let batchUpdated = false;
    if (ctx.record.batch_release_blocked && ctx.record.batch_id) {
      await setBatchReleaseEligibility(ctx.record.batch_id, false);
      batchUpdated = true;
      await audit(actor, 'Batch Release Eligibility Updated', oosId, 'Batch release unblocked after OOS closure');
    }

    if (batchUpdated && closureRecord) {
      await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.closures, closureRecord.id), { batch_release_updated: true });
    }

    await audit(actor, 'OOS Closed', oosId, form.final_oos_conclusion);
    if (eSignature) await audit(actor, 'E-Sign Success', oosId, eSignature);
    await notifyUser('OOS Closed', ctx.record.oos_number, oosId, ctx.record.created_by);
    await notifyRoles('OOS Closed', `${ctx.record.oos_number} closed`, oosId, ['qc_manager', 'qa_manager', 'production_manager', 'head_qa']);
    return {};
  } catch (e) {
    await audit(actor, 'E-Sign Failure', oosId, e instanceof Error ? e.message : 'Close failed');
    return { error: e instanceof Error ? e.message : 'Closure failed' };
  }
}

export async function rejectOosClosure(
  oosId: string,
  reason: string,
  actor: OosClosureActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Rejection reason required' };
  const closure = await getOosClosure(oosId);
  if (!closure) return { error: 'Closure record not found' };

  try {
    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.closures, closure.id), {
      closure_status: 'Rejected',
      qa_closure_comments: reason,
      updated_at: nowIso(),
      updated_by: actor.id,
      updated_by_name: actor.name,
    });
    await audit(actor, 'Closure Rejected', oosId, reason);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reject failed' };
  }
}

export async function reopenOosClosure(
  oosId: string,
  reason: string,
  eSignature: string,
  actor: OosClosureActor,
): Promise<{ error?: string }> {
  if (!reason.trim()) return { error: 'Reopen reason is required' };
  if (!eSignature.trim()) return { error: 'E-signature is required to reopen' };

  const record = await getOosById(oosId);
  if (!record) return { error: 'OOS record not found' };
  if (record.status !== 'closed') return { error: 'Only closed OOS records can be reopened' };

  try {
    const closure = await getOosClosure(oosId);
    if (closure) {
      await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.closures, closure.id), {
        closure_status: 'Reopened',
        reopen_reason: reason,
        updated_at: nowIso(),
        updated_by: actor.id,
        updated_by_name: actor.name,
      });
    }
    await updateOosRecord(oosId, {
      status: 'final_qa_review',
      actual_closure_date: null,
    }, toOosActor(actor), { workflow: true, reopen: true });
    await audit(actor, 'OOS Reopened', oosId, reason);
    await audit(actor, 'E-Sign Success', oosId, eSignature);
    await notifyUser('OOS Reopened', record.oos_number, oosId, record.created_by);
    await notifyRoles('OOS Reopened', `${record.oos_number} reopened`, oosId, ['qa_manager', 'head_qa']);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Reopen failed' };
  }
}

export async function logOosClosureEsignResult(
  oosId: string,
  success: boolean,
  actor: OosClosureActor,
  detail?: string,
) {
  await audit(actor, success ? 'E-Sign Success' : 'E-Sign Failure', oosId, detail);
}

export async function fetchOosClosureDashboardData() {
  const all = await listOosClosureRecords();
  const pending = all.filter((r) => r.status !== 'closed' && r.status !== 'draft');
  const ready = all.filter((r) => r.closure?.closure_status === 'Ready For Closure');
  const closed = all.filter((r) => r.status === 'closed');
  const qaReview = all.filter((r) => r.closure?.closure_status === 'QA Review');
  return { pending, ready, closed, qaReview, all };
}

export { computeOosClosureReadiness, mapOosClosureHistory };
