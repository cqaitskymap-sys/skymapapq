import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { listCapaCorrectiveActions } from '@/lib/capa-corrective-action-service';
import { listCapaPreventiveActions } from '@/lib/capa-preventive-action-service';
import {
  canApproveCriticalCapaEffectiveness,
  canCapaCloseFromEffectiveness,
  CAPA_EFFECTIVENESS_MODULE,
  computeAutoEffectivenessResult,
  computeEffectivenessChartData,
  computeEffectivenessDashboardMetrics,
  computeEffectivenessScore,
  hasOpenCorrectiveOrPreventiveActions,
  type CapaEffectivenessActor,
  type CapaEffectivenessFormInput,
  type CapaEffectivenessQaReviewInput,
} from '@/lib/capa-effectiveness-records';
import { getCapaById, listCapas, updateCapa } from '@/lib/capa-service';
import {
  CAPA_COLLECTIONS,
  type CapaEffectiveness,
  type CapaEffectivenessChartData,
  type CapaEffectivenessDashboardMetrics,
  type CapaRecord,
  requiresHeadQaApproval,
} from '@/lib/capa-types';

export type { CapaEffectivenessActor, CapaEffectivenessFormInput, CapaEffectivenessQaReviewInput };

const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().split('T')[0];

async function audit(
  actor: CapaEffectivenessActor,
  actionType: string,
  capaId: string,
  detail?: string,
  recordId?: string,
) {
  try {
    await createAuditLog({
      moduleName: CAPA_EFFECTIVENESS_MODULE,
      collectionName: CAPA_COLLECTIONS.effectiveness,
      recordId: recordId || capaId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa effectiveness audit', e);
  }
}

async function notify(title: string, message: string, capaId: string, userId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title, message, module: 'CAPA Effectiveness', record_id: capaId, user_id: userId,
      read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa effectiveness notify', e);
  }
}

function normalizeReview(docId: string, data: Record<string, unknown>): CapaEffectiveness {
  const r = { id: docId, ...data } as CapaEffectiveness;
  return {
    ...r,
    check_date: r.check_date || r.effectiveness_review_date || '',
    criteria: r.criteria || (Array.isArray(r.evaluation_criteria) ? r.evaluation_criteria.join('; ') : ''),
    result: r.result || r.effectiveness_result || 'Pending',
    evidence: r.evidence || r.evidence_reviewed || '',
    checked_by: r.checked_by || r.reviewed_by || '',
    checked_by_name: r.checked_by_name || r.reviewed_by_name || '',
    follow_up_required: r.follow_up_required ?? r.effectiveness_result === 'Not Effective',
    follow_up_capa_id: r.follow_up_capa_id ?? null,
    remarks: r.remarks || r.final_conclusion || '',
  };
}

export async function assertCapaReadyForEffectiveness(capaId: string): Promise<CapaRecord> {
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  if (!capa.effectiveness_check_required) throw new Error('Effectiveness check not required for this CAPA');

  const implementedStatuses = ['implemented', 'effectiveness_pending', 'effectiveness_completed', 'approved', 'qa_review'];
  if (!implementedStatuses.includes(capa.capa_status)) {
    throw new Error('CAPA must be implemented before effectiveness check can start');
  }

  const [ca, pa] = await Promise.all([
    listCapaCorrectiveActions(capaId),
    listCapaPreventiveActions(capaId),
  ]);
  if (hasOpenCorrectiveOrPreventiveActions(ca, pa)) {
    throw new Error('All corrective and preventive actions must be closed before effectiveness check');
  }
  return capa;
}

export async function generateEffectivenessId(): Promise<string> {
  const year = new Date().getFullYear();
  if (!isFirebaseConfigured()) throw new Error('Firebase is not configured');
  try {
    const prefix = `EFF-CAPA/${year}/`;
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness),
      where('effectiveness_id', '>=', prefix),
      where('effectiveness_id', '<=', `${prefix}\uf8ff`),
      orderBy('effectiveness_id', 'desc'),
      limit(1),
    ));
    if (!snap.empty) {
      const last = String(snap.docs[0].data().effectiveness_id || '');
      return `EFF-CAPA/${year}/${String(parseInt(last.split('/').pop() || '0', 10) + 1).padStart(4, '0')}`;
    }
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness));
    return `EFF-CAPA/${year}/${String(snap.size + 1).padStart(4, '0')}`;
  }
  throw new Error('Unable to generate effectiveness ID from backend.');
}

export async function getCapaEffectivenessReview(capaId: string): Promise<CapaEffectiveness | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness),
      where('capa_id', '==', capaId),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) {
      const fallback = await getDocs(query(
        collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness),
        where('capa_id', '==', capaId),
        limit(1),
      ));
      if (fallback.empty) return null;
      const d = fallback.docs[0];
      if (d.data().is_deleted) return null;
      return normalizeReview(d.id, d.data() as Record<string, unknown>);
    }
    return normalizeReview(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness),
        where('capa_id', '==', capaId),
      ));
      if (snap.empty) return null;
      return normalizeReview(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
    } catch {
      return null;
    }
  }
}

export async function listCapaEffectivenessReviews(max = 200): Promise<(CapaEffectiveness & { capa?: CapaRecord | null })[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    const reviews = snap.docs
      .map((d) => normalizeReview(d.id, d.data() as Record<string, unknown>))
      .filter((r) => !r.is_deleted);
    return Promise.all(reviews.map(async (r) => ({ ...r, capa: await getCapaById(r.capa_id) })));
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness));
    const reviews = snap.docs
      .map((d) => normalizeReview(d.id, d.data() as Record<string, unknown>))
      .filter((r) => !r.is_deleted);
    return Promise.all(reviews.map(async (r) => ({ ...r, capa: await getCapaById(r.capa_id) })));
  }
}

export async function fetchCapaEffectivenessDashboard(): Promise<{
  reviews: (CapaEffectiveness & { capa?: CapaRecord | null })[];
  metrics: CapaEffectivenessDashboardMetrics;
  charts: CapaEffectivenessChartData;
  error?: string;
}> {
  if (!isFirebaseConfigured()) {
    const empty = computeEffectivenessDashboardMetrics([]);
    return { reviews: [], metrics: empty, charts: computeEffectivenessChartData([]), error: 'Firebase is not configured.' };
  }
  try {
    const reviews = await listCapaEffectivenessReviews();
    const capas = await listCapas();
    return {
      reviews,
      metrics: computeEffectivenessDashboardMetrics(reviews, capas),
      charts: computeEffectivenessChartData(reviews),
    };
  } catch (e) {
    return {
      reviews: [],
      metrics: computeEffectivenessDashboardMetrics([]),
      charts: computeEffectivenessChartData([]),
      error: e instanceof Error ? e.message : 'Failed to load effectiveness reviews',
    };
  }
}

export async function fetchCapaEffectivenessPageData(capaId: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const [capa, review, auditLogs, ca, pa] = await Promise.all([
      getCapaById(capaId),
      getCapaEffectivenessReview(capaId),
      getAuditLogsForEffectiveness(capaId),
      listCapaCorrectiveActions(capaId),
      listCapaPreventiveActions(capaId),
    ]);
    if (!capa) return { error: 'CAPA record not found.' };
    return { capa, review, auditLogs, correctiveActions: ca, preventiveActions: pa };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load effectiveness data' };
  }
}

export async function getAuditLogsForEffectiveness(capaId: string) {
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

function buildReviewPayload(
  capa: CapaRecord,
  input: CapaEffectivenessFormInput,
  actor: CapaEffectivenessActor,
  status: string,
  existing?: CapaEffectiveness | null,
  effectivenessId?: string,
): Omit<CapaEffectiveness, 'id'> {
  const ts = nowIso();
  const score = input.effectiveness_score ?? computeEffectivenessScore(input);
  const result = input.effectiveness_result || computeAutoEffectivenessResult({ ...input, effectiveness_score: score });

  return {
    effectiveness_id: existing?.effectiveness_id || effectivenessId || '',
    capa_id: capa.id,
    capa_number: capa.capa_number,
    source_type: capa.capa_source,
    source_reference_number: capa.source_reference_number,
    effectiveness_required: capa.effectiveness_check_required,
    effectiveness_due_date: input.effectiveness_due_date || capa.effectiveness_check_date || capa.target_completion_date,
    effectiveness_review_date: input.effectiveness_review_date,
    reviewed_by: input.reviewed_by,
    reviewed_by_name: input.reviewed_by_name || actor.name,
    department: input.department,
    review_period: input.review_period || '',
    evaluation_criteria: input.evaluation_criteria,
    evidence_reviewed: input.evidence_reviewed,
    data_reviewed: input.data_reviewed || '',
    repeat_issue_observed: input.repeat_issue_observed ?? false,
    issue_reoccurred: input.issue_reoccurred ?? false,
    risk_reduced: input.risk_reduced ?? false,
    root_cause_eliminated: input.root_cause_eliminated ?? false,
    corrective_action_effective: input.corrective_action_effective ?? true,
    preventive_action_effective: input.preventive_action_effective ?? true,
    effectiveness_result: result,
    effectiveness_score: score,
    qa_comments: input.qa_comments || '',
    head_qa_comments: existing?.head_qa_comments || '',
    final_conclusion: input.final_conclusion,
    status,
    follow_up_required: result === 'Not Effective',
    follow_up_capa_id: null,
    new_capa_recommended: result === 'Not Effective',
    capa_closure_recommended: result === 'Effective',
    is_deleted: false,
    check_date: input.effectiveness_review_date,
    criteria: input.evaluation_criteria.join('; '),
    result,
    evidence: input.evidence_reviewed,
    checked_by: input.reviewed_by,
    checked_by_name: input.reviewed_by_name || actor.name,
    remarks: input.final_conclusion,
    created_at: existing?.created_at || ts,
    updated_at: ts,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
}

export async function scheduleCapaEffectivenessReview(
  capaId: string,
  data: { effectiveness_due_date: string; review_period?: string },
  actor: CapaEffectivenessActor,
): Promise<CapaEffectiveness> {
  const capa = await assertCapaReadyForEffectiveness(capaId);
  const existing = await getCapaEffectivenessReview(capaId);
  const effectivenessId = existing?.effectiveness_id || await generateEffectivenessId();
  const ts = nowIso();

  const payload = existing
    ? {
      effectiveness_due_date: data.effectiveness_due_date,
      review_period: data.review_period || existing.review_period,
      status: 'scheduled',
      updated_at: ts,
      updated_by: actor.id,
      updated_by_name: actor.name,
    }
    : {
      ...buildReviewPayload(capa, {
        capa_id: capaId,
        effectiveness_due_date: data.effectiveness_due_date,
        effectiveness_review_date: data.effectiveness_due_date,
        reviewed_by: actor.id,
        reviewed_by_name: actor.name,
        department: capa.department,
        review_period: data.review_period || '',
        evaluation_criteria: [],
        evidence_reviewed: '',
        final_conclusion: 'Scheduled for effectiveness review',
      }, actor, 'scheduled', null, effectivenessId),
      effectiveness_due_date: data.effectiveness_due_date,
    };

  let saved: CapaEffectiveness;
  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness, existing.id), payload);
    saved = normalizeReview(existing.id, { ...existing, ...payload } as Record<string, unknown>);
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness), payload);
    saved = normalizeReview(ref.id, payload as Record<string, unknown>);
    await audit(actor, 'EFFECTIVENESS_REVIEW_CREATED', capaId, effectivenessId, ref.id);
  }

  await updateCapa(capaId, { capa_status: 'effectiveness_pending' }, {
    id: actor.id, name: actor.name, role: actor.role || '',
  }, { workflow: true });

  await audit(actor, 'EFFECTIVENESS_REVIEW_SCHEDULED', capaId, data.effectiveness_due_date, saved.id);
  await notify('Effectiveness Review Scheduled', `Effectiveness review scheduled for ${capa.capa_number}`, capaId, capa.action_owner);
  await notify('Effectiveness Review Scheduled', `Review scheduled — ${capa.capa_number}`, capaId, capa.qa_reviewer || capa.created_by);
  return saved;
}

export async function saveCapaEffectivenessDraft(
  input: CapaEffectivenessFormInput,
  actor: CapaEffectivenessActor,
): Promise<CapaEffectiveness> {
  const capa = await assertCapaReadyForEffectiveness(input.capa_id);
  const existing = await getCapaEffectivenessReview(input.capa_id);
  const effectivenessId = existing?.effectiveness_id || await generateEffectivenessId();
  const payload = buildReviewPayload(capa, input, actor, 'under_review', existing, effectivenessId);

  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness, existing.id), payload);
    await audit(actor, 'EFFECTIVENESS_EVALUATION_UPDATED', capa.id, undefined, existing.id);
    return normalizeReview(existing.id, payload as Record<string, unknown>);
  }
  const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness), payload);
  await audit(actor, 'EFFECTIVENESS_REVIEW_CREATED', capa.id, effectivenessId, ref.id);
  return normalizeReview(ref.id, payload as Record<string, unknown>);
}

export async function submitCapaEffectivenessForQaReview(
  input: CapaEffectivenessFormInput,
  actor: CapaEffectivenessActor,
): Promise<CapaEffectiveness> {
  const capa = await assertCapaReadyForEffectiveness(input.capa_id);
  const existing = await getCapaEffectivenessReview(input.capa_id);
  const effectivenessId = existing?.effectiveness_id || await generateEffectivenessId();
  const payload = buildReviewPayload(capa, input, actor, 'qa_review', existing, effectivenessId);

  let saved: CapaEffectiveness;
  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness, existing.id), payload);
    saved = normalizeReview(existing.id, payload as Record<string, unknown>);
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness), payload);
    saved = normalizeReview(ref.id, payload as Record<string, unknown>);
  }

  await updateCapa(capa.id, {
    effectiveness_check_date: input.effectiveness_review_date,
    effectiveness_criteria: input.evaluation_criteria.join('; '),
    effectiveness_result: payload.effectiveness_result,
    capa_status: 'effectiveness_completed',
  }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true });

  await audit(actor, 'EFFECTIVENESS_EVALUATION_COMPLETED', capa.id, payload.effectiveness_result, saved.id);
  await notify('Effectiveness QA Review', `Effectiveness review submitted for ${capa.capa_number}`, capa.id, capa.qa_reviewer || capa.created_by);
  await notify('Effectiveness Review', `Review pending QA — ${capa.capa_number}`, capa.id, capa.created_by);

  if (requiresHeadQaApproval(capa.priority)) {
    await notify('Critical CAPA Effectiveness', `Head QA review required for ${capa.capa_number}`, capa.id, 'head_qa');
  }
  return saved;
}

export async function reviewCapaEffectiveness(
  capaId: string,
  review: CapaEffectivenessQaReviewInput,
  actor: CapaEffectivenessActor,
): Promise<CapaEffectiveness> {
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  const existing = await getCapaEffectivenessReview(capaId);
  if (!existing) throw new Error('Effectiveness review not found');

  if (!canApproveCriticalCapaEffectiveness(actor.role, capa.priority)) {
    throw new Error('Head QA approval required for critical CAPA effectiveness reviews');
  }

  const approved = review.decision === 'approved';
  const ts = nowIso();
  const status = approved ? 'approved' : (existing.effectiveness_result === 'Not Effective' ? 'reassessment_required' : 'rejected');

  const payload = {
    status,
    qa_comments: review.qa_comments,
    head_qa_comments: review.head_qa_comments || '',
    updated_at: ts,
    updated_by: actor.id,
    updated_by_name: actor.name,
  };

  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness, existing.id), payload);
  const saved = normalizeReview(existing.id, { ...existing, ...payload } as Record<string, unknown>);

  if (approved) {
    await updateCapa(capaId, {
      effectiveness_result: existing.effectiveness_result || existing.result,
      capa_status: canCapaCloseFromEffectiveness(saved) ? 'approved' : 'qa_review',
    }, { id: actor.id, name: actor.name, role: actor.role || '' }, { workflow: true });
    await audit(actor, 'EFFECTIVENESS_APPROVED', capaId, review.qa_comments, existing.id);
    if (canCapaCloseFromEffectiveness(saved)) {
      await notify('CAPA Ready For Closure', `CAPA ${capa.capa_number} effectiveness approved — ready for closure`, capaId, capa.action_owner);
    }
  } else {
    await audit(actor, 'EFFECTIVENESS_REJECTED', capaId, review.qa_comments, existing.id);
    if (existing.new_capa_recommended) {
      await notify('New CAPA Recommended', `Effectiveness failed for ${capa.capa_number} — new CAPA recommended`, capaId, capa.created_by);
    }
  }

  await notify('Effectiveness Review Decision', `Effectiveness ${review.decision} for ${capa.capa_number}`, capaId, capa.action_owner);
  return saved;
}

export async function initiateCapaEffectivenessReassessment(
  capaId: string,
  actor: CapaEffectivenessActor,
): Promise<CapaEffectiveness> {
  const existing = await getCapaEffectivenessReview(capaId);
  if (!existing) throw new Error('Effectiveness review not found');

  const payload = {
    status: 'reassessment_required',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness, existing.id), payload);
  await audit(actor, 'EFFECTIVENESS_REASSESSMENT_INITIATED', capaId, undefined, existing.id);
  await notify('Effectiveness Reassessment', `Reassessment initiated for CAPA ${existing.capa_number}`, capaId, existing.reviewed_by || '');
  return normalizeReview(existing.id, { ...existing, ...payload } as Record<string, unknown>);
}

export async function closeCapaEffectivenessReview(
  capaId: string,
  actor: CapaEffectivenessActor,
): Promise<CapaEffectiveness> {
  const existing = await getCapaEffectivenessReview(capaId);
  if (!existing) throw new Error('Effectiveness review not found');
  if (existing.status !== 'approved') throw new Error('Effectiveness review must be approved before closure');

  const payload = { status: 'closed', updated_at: nowIso(), updated_by: actor.id, updated_by_name: actor.name };
  await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.effectiveness, existing.id), payload);
  await audit(actor, 'EFFECTIVENESS_REVIEW_CLOSED', capaId, undefined, existing.id);
  return normalizeReview(existing.id, { ...existing, ...payload } as Record<string, unknown>);
}

export async function uploadCapaEffectivenessEvidencePlaceholder(
  capaId: string,
  fileName: string,
  description: string,
  actor: CapaEffectivenessActor,
): Promise<void> {
  await audit(actor, 'EFFECTIVENESS_EVIDENCE_UPLOAD_BLOCKED', capaId, `${fileName}: ${description}`);
  throw new Error('CAPA effectiveness evidence upload backend is not implemented. Configure real file upload first.');
}

export async function assertEffectivenessApprovedForCapaClosure(capaId: string): Promise<void> {
  const capa = await getCapaById(capaId);
  if (!capa) throw new Error('CAPA not found');
  if (!capa.effectiveness_check_required) return;
  const review = await getCapaEffectivenessReview(capaId);
  if (!review || !canCapaCloseFromEffectiveness(review)) {
    throw new Error('Approved effective effectiveness review required before CAPA closure');
  }
}

export { computeEffectivenessDashboardMetrics, computeEffectivenessChartData };
