import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { getCapaApprovals } from '@/lib/capa-approval-service';
import { listCapaCorrectiveActions } from '@/lib/capa-corrective-action-service';
import { getCapaEffectivenessReview } from '@/lib/capa-effectiveness-service';
import { getCapaInvestigationByCapaId } from '@/lib/capa-investigation-service';
import { listCapaPreventiveActions } from '@/lib/capa-preventive-action-service';
import {
  CAPA_CLOSURE_MODULE,
  computeCapaClosureDashboardMetrics,
  computeCapaClosureReadiness,
  computeClosureDecision,
  type CapaClosureActor,
  type CapaClosureFormInput,
} from '@/lib/capa-closure-records';
import {
  CAPA_COLLECTIONS,
  requiresHeadQaApproval,
  type CapaClosure,
  type CapaClosureDashboardMetrics,
  type CapaRecord,
} from '@/lib/capa-types';
import { getCapaAttachments, getCapaById, listCapas, updateCapa } from '@/lib/capa-service';

export type { CapaClosureActor, CapaClosureFormInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

function buildClosureId(capaNumber: string) {
  return `CCL-${capaNumber.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function audit(actor: CapaClosureActor, actionType: string, capaId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: CAPA_CLOSURE_MODULE,
      collectionName: CAPA_COLLECTIONS.closure,
      recordId: capaId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa closure audit', e);
  }
}

async function notify(title: string, message: string, capaId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title, message, module: 'CAPA Closure', record_id: capaId, user_id: userId, read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa closure notify', e);
  }
}

async function notifyRole(title: string, message: string, capaId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
        title, message, module: 'CAPA Closure', record_id: capaId, target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('capa closure notify role', e);
    }
  }
}

async function saveEsignMetadata(
  capa: CapaRecord,
  esignId: string,
  actor: CapaClosureActor,
  actionType: string,
) {
  if (!isFirebaseConfigured() || !esignId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), 'esign_records'), {
      esign_record_id: esignId,
      module_name: CAPA_CLOSURE_MODULE,
      record_id: capa.id,
      document_number: capa.capa_number,
      action_type: actionType,
      user_id: actor.id,
      user_name: actor.name,
      user_email: actor.email || '',
      signed_date_time: nowIso(),
      authentication_status: 'Success',
      is_deleted: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa closure esign', e);
  }
}

async function loadClosureContext(capaId: string) {
  const capa = await getCapaById(capaId);
  if (!capa) return null;
  const [investigation, ca, pa, effectiveness, approvals, attachments] = await Promise.all([
    getCapaInvestigationByCapaId(capaId),
    listCapaCorrectiveActions(capaId),
    listCapaPreventiveActions(capaId),
    getCapaEffectivenessReview(capaId),
    getCapaApprovals(capaId),
    getCapaAttachments(capaId),
  ]);
  return { capa, investigation, correctiveActions: ca, preventiveActions: pa, effectiveness, approvals, attachments };
}

function buildClosurePayload(
  capa: CapaRecord,
  form: CapaClosureFormInput,
  actor: CapaClosureActor,
  readinessPercent: number,
  status: string,
  existing?: CapaClosure | null,
  decision?: ReturnType<typeof computeClosureDecision>,
): Omit<CapaClosure, 'id'> {
  const ts = nowIso();
  return {
    closure_id: existing?.closure_id || buildClosureId(capa.capa_number),
    capa_id: capa.id,
    capa_number: capa.capa_number,
    source_type: capa.capa_source,
    source_reference_number: capa.source_reference_number,
    closure_date: status === 'Closed' ? today() : null,
    closed_by: status === 'Closed' ? actor.id : existing?.closed_by || '',
    closed_by_name: status === 'Closed' ? actor.name : existing?.closed_by_name || '',
    department: capa.department,
    rca_approved: true,
    corrective_actions_completed: form.corrective_actions_completed,
    preventive_actions_completed: form.preventive_actions_completed,
    implementation_verified: form.implementation_verified,
    evidence_uploaded: form.evidence_uploaded,
    effectiveness_check_completed: form.effectiveness_check_completed,
    effectiveness_result: form.effectiveness_result,
    risk_reduced: form.risk_reduced,
    root_cause_eliminated: form.root_cause_eliminated,
    recurrence_prevented: form.recurrence_prevented,
    training_completed: form.training_completed,
    sop_updated: form.sop_updated,
    change_control_completed: form.change_control_completed,
    all_evidence_reviewed: form.all_evidence_reviewed,
    qa_approval_completed: true,
    qa_closure_comments: form.qa_closure_comments,
    head_qa_comments: form.head_qa_comments || '',
    final_closure_conclusion: form.final_closure_conclusion,
    closure_status: status,
    closure_recommendation: decision?.recommendation,
    new_capa_recommended: decision?.newCapaRecommended ?? false,
    additional_monitoring_recommended: decision?.additionalMonitoring ?? false,
    readiness_percent: readinessPercent,
    e_signature_required: true,
    e_signature: existing?.e_signature || '',
    e_signature_status: existing?.e_signature_status || 'Not Signed',
    signed_by: existing?.signed_by || '',
    signed_date: existing?.signed_date || null,
    created_at: existing?.created_at || ts,
    updated_at: ts,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    is_deleted: false,
  };
}

export async function getCapaClosure(capaId: string): Promise<CapaClosure | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.closure),
      where('capa_id', '==', capaId),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() } as CapaClosure;
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.closure),
      where('capa_id', '==', capaId),
      limit(1),
    ));
    if (snap.empty) return null;
    const d = snap.docs[0].data();
    if (d.is_deleted) return null;
    return { id: snap.docs[0].id, ...d } as CapaClosure;
  }
}

export async function listCapaClosures(max = 200): Promise<(CapaClosure & { capa?: CapaRecord | null })[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.closure),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const closures = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaClosure));
    return Promise.all(closures.map(async (c) => ({ ...c, capa: await getCapaById(c.capa_id) })));
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.closure));
    const closures = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CapaClosure)).filter((c) => !c.is_deleted);
    return Promise.all(closures.map(async (c) => ({ ...c, capa: await getCapaById(c.capa_id) })));
  }
}

export async function fetchCapaClosurePageData(capaId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const ctx = await loadClosureContext(capaId);
    if (!ctx) return { error: 'CAPA record not found.' };

    const closure = await getCapaClosure(capaId);
    const auditLogs = await getAuditLogsForCapaClosure(capaId);

    const defaultForm: CapaClosureFormInput = {
      corrective_actions_completed: closure?.corrective_actions_completed ?? false,
      preventive_actions_completed: closure?.preventive_actions_completed ?? false,
      implementation_verified: closure?.implementation_verified ?? Boolean(ctx.capa.actual_completion_date),
      evidence_uploaded: closure?.evidence_uploaded ?? ctx.attachments.length > 0,
      effectiveness_check_completed: closure?.effectiveness_check_completed ?? (
        !ctx.capa.effectiveness_check_required
        || ['Effective', 'Partially Effective'].includes(String(ctx.effectiveness?.effectiveness_result || ctx.effectiveness?.result || ctx.capa.effectiveness_result))
      ),
      effectiveness_result: closure?.effectiveness_result
        || String(ctx.effectiveness?.effectiveness_result || ctx.effectiveness?.result || ctx.capa.effectiveness_result || 'Pending'),
      risk_reduced: closure?.risk_reduced ?? ctx.effectiveness?.risk_reduced ?? false,
      root_cause_eliminated: closure?.root_cause_eliminated ?? ctx.effectiveness?.root_cause_eliminated ?? false,
      recurrence_prevented: closure?.recurrence_prevented ?? !(ctx.effectiveness?.repeat_issue_observed ?? false),
      training_completed: closure?.training_completed ?? true,
      sop_updated: closure?.sop_updated ?? true,
      change_control_completed: closure?.change_control_completed ?? true,
      all_evidence_reviewed: closure?.all_evidence_reviewed ?? ctx.attachments.length > 0,
      qa_closure_comments: closure?.qa_closure_comments || '',
      head_qa_comments: closure?.head_qa_comments || '',
      final_closure_conclusion: closure?.final_closure_conclusion || '',
    };

    const readiness = computeCapaClosureReadiness({
      capa: ctx.capa,
      investigationStatus: ctx.investigation?.status,
      correctiveActions: ctx.correctiveActions,
      preventiveActions: ctx.preventiveActions,
      effectiveness: ctx.effectiveness,
      approvals: ctx.approvals,
      attachmentCount: ctx.attachments.length,
      form: defaultForm,
    });

    return {
      capa: ctx.capa,
      closure,
      investigation: ctx.investigation,
      correctiveActions: ctx.correctiveActions,
      preventiveActions: ctx.preventiveActions,
      effectiveness: ctx.effectiveness,
      approvals: ctx.approvals,
      attachments: ctx.attachments,
      readiness,
      formDefaults: defaultForm,
      auditLogs,
      headQaRequired: requiresHeadQaApproval(ctx.capa.priority, ctx.capa),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load closure data' };
  }
}

async function getAuditLogsForCapaClosure(capaId: string) {
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

export async function saveCapaClosureDraft(
  capaId: string,
  form: CapaClosureFormInput,
  actor: CapaClosureActor,
): Promise<CapaClosure> {
  const ctx = await loadClosureContext(capaId);
  if (!ctx) throw new Error('CAPA not found');

  const readiness = computeCapaClosureReadiness({
    capa: ctx.capa,
    investigationStatus: ctx.investigation?.status,
    correctiveActions: ctx.correctiveActions,
    preventiveActions: ctx.preventiveActions,
    effectiveness: ctx.effectiveness,
    approvals: ctx.approvals,
    attachmentCount: ctx.attachments.length,
    form,
  });

  const decision = computeClosureDecision(form);
  const existing = await getCapaClosure(capaId);
  const status = existing?.closure_status === 'Closed' ? 'Closed' : (readiness.ready ? decision.status : 'Pending');
  const payload = buildClosurePayload(ctx.capa, form, actor, readiness.percent, status, existing, decision);

  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.closure, existing.id), payload);
    await audit(actor, 'CLOSURE_CHECKLIST_UPDATED', capaId, undefined);
    return { id: existing.id, ...payload };
  }

  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.closure), payload);
  await audit(actor, 'CLOSURE_INITIATED', capaId, payload.closure_id);
  await notify('Closure Initiated', `Closure checklist started for ${ctx.capa.capa_number}`, capaId, ctx.capa.action_owner);
  return { id: ref.id, ...payload };
}

export async function submitCapaClosureForQaReview(
  capaId: string,
  form: CapaClosureFormInput,
  actor: CapaClosureActor,
): Promise<CapaClosure> {
  const ctx = await loadClosureContext(capaId);
  if (!ctx) throw new Error('CAPA not found');

  const readiness = computeCapaClosureReadiness({
    capa: ctx.capa,
    investigationStatus: ctx.investigation?.status,
    correctiveActions: ctx.correctiveActions,
    preventiveActions: ctx.preventiveActions,
    effectiveness: ctx.effectiveness,
    approvals: ctx.approvals,
    attachmentCount: ctx.attachments.length,
    form,
  });

  if (!readiness.ready) {
    throw new Error(`Closure blocked: ${readiness.blockers.join('; ')}`);
  }
  if (form.effectiveness_result === 'Not Effective') {
    throw new Error('CAPA cannot close when effectiveness result is Not Effective');
  }
  if (!form.qa_closure_comments.trim()) throw new Error('QA closure comments are required');
  if (!form.final_closure_conclusion.trim()) throw new Error('Final closure conclusion is required');

  const decision = computeClosureDecision(form);
  const headQaRequired = requiresHeadQaApproval(ctx.capa.priority, ctx.capa);
  const status = headQaRequired ? 'Head QA Review' : 'QA Review';
  const existing = await getCapaClosure(capaId);
  const payload = buildClosurePayload(ctx.capa, form, actor, readiness.percent, status, existing, decision);

  let saved: CapaClosure;
  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.closure, existing.id), payload);
    saved = { id: existing.id, ...payload };
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.closure), payload);
    saved = { id: ref.id, ...payload };
  }

  await audit(actor, 'CLOSURE_QA_REVIEW_SUBMITTED', capaId, form.qa_closure_comments);
  await notify('CAPA Closure QA Review', `${ctx.capa.capa_number} submitted for closure review`, capaId, ctx.capa.qa_reviewer || ctx.capa.created_by);
  if (headQaRequired) await notifyRole('CAPA Closure Head QA', ctx.capa.capa_number, capaId, ['head_qa']);
  return saved;
}

export async function approveCapaClosure(
  capaId: string,
  form: CapaClosureFormInput,
  eSignature: string,
  actor: CapaClosureActor,
): Promise<CapaClosure> {
  const ctx = await loadClosureContext(capaId);
  if (!ctx) throw new Error('CAPA not found');
  const existing = await getCapaClosure(capaId);
  if (!existing) throw new Error('Closure record not found');

  if (requiresHeadQaApproval(ctx.capa.priority, ctx.capa) && !['head_qa', 'super_admin'].includes(actor.role || '')) {
    throw new Error('Head QA approval required for critical CAPA closure');
  }
  if (!eSignature.trim()) throw new Error('E-signature required for closure');

  const readiness = computeCapaClosureReadiness({
    capa: ctx.capa,
    investigationStatus: ctx.investigation?.status,
    correctiveActions: ctx.correctiveActions,
    preventiveActions: ctx.preventiveActions,
    effectiveness: ctx.effectiveness,
    approvals: ctx.approvals,
    attachmentCount: ctx.attachments.length,
    form,
  });
  if (!readiness.ready) throw new Error(`Closure blocked: ${readiness.blockers.join('; ')}`);

  const ts = nowIso();
  const payload = {
    ...buildClosurePayload(ctx.capa, form, actor, readiness.percent, 'Closed', existing, computeClosureDecision(form)),
    closure_date: today(),
    closed_by: actor.id,
    closed_by_name: actor.name,
    e_signature: eSignature,
    e_signature_status: 'Signed',
    signed_by: actor.name,
    signed_date: ts,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.closure, existing.id), payload);
  await saveEsignMetadata(ctx.capa, eSignature, actor, 'CAPA Closed');

  await updateCapa(capaId, {
    capa_status: 'closed',
    is_locked: true,
    qa_remarks: form.qa_closure_comments || ctx.capa.qa_remarks,
    actual_completion_date: ctx.capa.actual_completion_date || today(),
  }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true });

  await audit(actor, 'CAPA_CLOSED', capaId, form.final_closure_conclusion);
  await audit(actor, 'E-Sign Success', capaId, eSignature);
  await notify('CAPA Closed', `${ctx.capa.capa_number} has been closed`, capaId, ctx.capa.action_owner);
  await notifyRole('CAPA Closed', ctx.capa.capa_number, capaId, ['admin', 'qa_manager', 'head_qa']);
  await notify('CAPA Closed — Creator', ctx.capa.capa_number, capaId, ctx.capa.created_by);

  if (form.effectiveness_result === 'Not Effective' || payload.new_capa_recommended) {
    await audit(actor, 'NEW_CAPA_RECOMMENDED', capaId, 'Effectiveness not effective');
  }

  return { id: existing.id, ...payload };
}

export async function rejectCapaClosure(
  capaId: string,
  reason: string,
  actor: CapaClosureActor,
): Promise<CapaClosure> {
  const existing = await getCapaClosure(capaId);
  if (!existing) throw new Error('Closure record not found');

  const payload = {
    closure_status: 'Rejected',
    qa_closure_comments: reason,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.closure, existing.id), payload);
  await audit(actor, 'CLOSURE_REJECTED', capaId, reason);

  const capa = await getCapaById(capaId);
  if (capa) await notify('CAPA Closure Rejected', `${capa.capa_number}: ${reason}`, capaId, capa.action_owner);
  return { ...existing, ...payload };
}

export async function reopenCapaClosure(
  capaId: string,
  reason: string,
  actor: CapaClosureActor,
): Promise<CapaClosure> {
  if (!reason.trim()) throw new Error('Reopen reason is required');
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  if (capa.capa_status !== 'closed') throw new Error('Only closed CAPA can be reopened');

  const existing = await getCapaClosure(capaId);
  const ts = nowIso();

  await updateCapa(capaId, {
    capa_status: 'qa_review',
    is_locked: false,
  }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true, reopen: true });

  const payload = {
    closure_status: 'Reopened',
    closure_date: null,
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
    final_closure_conclusion: `${existing?.final_closure_conclusion || ''}\nReopened: ${reason}`.trim(),
  };

  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.closure, existing.id), payload);
  }

  await audit(actor, 'CAPA_REOPENED', capaId, reason);
  await notify('CAPA Reopened', `${capa.capa_number}: ${reason}`, capaId, capa.action_owner);
  await notify('CAPA Reopened — Creator', capa.capa_number, capaId, capa.created_by);

  return existing ? { ...existing, ...payload } : {
    id: '',
    closure_id: buildClosureId(capa.capa_number),
    capa_id: capaId,
    capa_number: capa.capa_number,
    closure_date: null,
    closed_by: '',
    department: capa.department,
    corrective_actions_completed: false,
    preventive_actions_completed: false,
    effectiveness_check_completed: false,
    effectiveness_result: capa.effectiveness_result,
    qa_closure_comments: reason,
    final_closure_conclusion: reason,
    closure_status: 'Reopened',
    created_at: ts,
    updated_at: ts,
    created_by: actor.id,
    updated_by: actor.id,
    is_deleted: false,
  };
}

export async function logCapaClosureEsignResult(
  capaId: string,
  success: boolean,
  actor: CapaClosureActor,
  detail?: string,
) {
  await audit(actor, success ? 'E-Sign Success' : 'E-Sign Failure', capaId, detail);
}

export async function fetchCapaClosureDashboard(): Promise<{
  closures: (CapaClosure & { capa?: CapaRecord | null })[];
  capas: CapaRecord[];
  metrics: CapaClosureDashboardMetrics;
  error?: string;
}> {
  if (!isFirebaseConfigured()) {
    return {
      closures: [],
      capas: [],
      metrics: computeCapaClosureDashboardMetrics([]),
      error: 'Firebase is not configured.',
    };
  }
  try {
    const [closures, capas] = await Promise.all([listCapaClosures(), listCapas()]);
    return {
      closures,
      capas,
      metrics: computeCapaClosureDashboardMetrics(closures, capas),
    };
  } catch (e) {
    return {
      closures: [],
      capas: [],
      metrics: computeCapaClosureDashboardMetrics([]),
      error: e instanceof Error ? e.message : 'Failed to load closure dashboard',
    };
  }
}

export async function closeCapaWithClosure(
  id: string,
  actor: CapaClosureActor,
  qaRemarks?: string,
): Promise<CapaRecord> {
  const page = await fetchCapaClosurePageData(id);
  if (page.error || !page.capa || !page.formDefaults) throw new Error(page.error || 'CAPA not found');

  const form: CapaClosureFormInput = {
    ...page.formDefaults,
    qa_closure_comments: qaRemarks || page.formDefaults.qa_closure_comments || 'Legacy closure',
    final_closure_conclusion: qaRemarks || page.formDefaults.final_closure_conclusion || 'CAPA closed via legacy API',
  };

  await saveCapaClosureDraft(id, form, actor);
  await approveCapaClosure(id, form, `LEGACY-${Date.now()}`, actor);
  const capa = await getCapaById(id);
  if (!capa) throw new Error('CAPA not found after closure');
  return capa;
}

export { computeCapaClosureDashboardMetrics, mapClosureAuditToTimeline } from '@/lib/capa-closure-records';
