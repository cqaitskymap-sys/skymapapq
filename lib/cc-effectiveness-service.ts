import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { normalizeRole } from '@/lib/permissions';
import {
  buildEffectivenessReviewId,
  canApproveCcEffectiveness,
  CC_EFFECTIVENESS_MODULE,
  computeAutoCcEffectivenessResult,
  computeCcEffectivenessChartData,
  computeCcEffectivenessDashboardMetrics,
  computeCcEffectivenessScore,
  generateCapaRecommendation,
  isCapaRecommendationRequired,
  type CcEffectivenessActor,
  type CcEffectivenessFormInput,
  type CcEffectivenessQaReviewInput,
} from '@/lib/cc-effectiveness-records';
import { polishRecommendationText } from '@/lib/ai/client';
import {
  CC_COLLECTIONS,
  requiresHeadQaApproval,
  type CcEffectivenessChartData,
  type CcEffectivenessDashboardMetrics,
  type ChangeControlRecord,
  type ChangeEffectivenessReview,
} from '@/lib/change-control-types';
import {
  getAuditLogsForChange,
  getChangeById,
  listChanges,
  updateChange,
} from '@/lib/change-control-service';

export type { CcEffectivenessActor, CcEffectivenessFormInput, CcEffectivenessQaReviewInput };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: CcEffectivenessActor,
  actionType: string,
  changeId: string,
  detail?: string,
  recordId?: string,
) {
  try {
    await createAuditLog({
      moduleName: CC_EFFECTIVENESS_MODULE,
      collectionName: CC_COLLECTIONS.effectiveness,
      recordId: recordId || changeId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role, department: actor.department },
      status: 'Success',
    });
  } catch (e) {
    console.error('cc effectiveness audit', e);
  }
}

async function notify(
  title: string,
  message: string,
  changeId: string,
  opts?: { userId?: string; targetRole?: string },
) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.notifications), {
      title,
      message,
      module: CC_EFFECTIVENESS_MODULE,
      record_id: changeId,
      ...(opts?.userId ? { user_id: opts.userId } : {}),
      ...(opts?.targetRole ? { target_role: opts.targetRole } : {}),
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('cc effectiveness notify', e);
  }
}

function normalizeReview(docId: string, data: Record<string, unknown>): ChangeEffectivenessReview {
  const r = { id: docId, ...data } as ChangeEffectivenessReview;
  return {
    ...r,
    result: r.result || r.effectiveness_result || 'Pending Review',
    effectiveness_result: r.effectiveness_result || r.result || 'Pending Review',
    conclusion: r.conclusion || r.review_findings || '',
    effectiveness_criteria: r.effectiveness_criteria || r.review_findings || '',
    reviewed_by: r.reviewed_by || r.review_owner || '',
    reviewed_by_name: r.reviewed_by_name || r.review_owner_name || '',
    status: r.status || 'Draft',
    is_deleted: r.is_deleted ?? false,
  };
}

async function buildPayload(
  change: ChangeControlRecord,
  input: CcEffectivenessFormInput,
  actor: CcEffectivenessActor,
  existing?: ChangeEffectivenessReview | null,
): Promise<Partial<ChangeEffectivenessReview>> {
  const score = computeCcEffectivenessScore(input);
  const autoResult = computeAutoCcEffectivenessResult(score);
  const result = input.effectiveness_result || autoResult;
  const capaRecommended = isCapaRecommendationRequired(result) || input.additional_actions_required;
  const baseCapaNotes = generateCapaRecommendation(input, score, result);
  const capaNotes = await polishRecommendationText(baseCapaNotes, {
    module: 'Change Control Effectiveness',
    changeControlNumber: change.change_control_number,
    score,
    result,
    capaRecommended,
  });
  const timestamp = nowIso();
  return {
    change_id: change.id,
    change_control_number: change.change_control_number,
    effectiveness_review_id: existing?.effectiveness_review_id || buildEffectivenessReviewId(change.change_control_number),
    review_date: input.review_date,
    review_owner: input.review_owner,
    review_owner_name: input.review_owner_name || actor.name,
    reviewed_by: input.review_owner,
    reviewed_by_name: input.review_owner_name || actor.name,
    department: input.department,
    review_period_start: input.review_period_start,
    review_period_end: input.review_period_end,
    change_objective_achieved: input.change_objective_achieved,
    implementation_successful: input.implementation_successful,
    validation_successful: input.validation_successful,
    csv_requirements_met: input.csv_requirements_met,
    training_completed: input.training_completed,
    no_adverse_quality_impact: input.no_adverse_quality_impact,
    no_regulatory_impact: input.no_regulatory_impact,
    no_data_integrity_impact: input.no_data_integrity_impact,
    no_patient_safety_impact: input.no_patient_safety_impact,
    performance_improved: input.performance_improved,
    process_improved: input.process_improved,
    risk_reduced: input.risk_reduced,
    deviation_generated: input.deviation_generated,
    oos_generated: input.oos_generated,
    complaint_generated: input.complaint_generated,
    capa_generated: input.capa_generated,
    effectiveness_score: score,
    effectiveness_result: result,
    result,
    review_findings: input.review_findings,
    effectiveness_criteria: input.effectiveness_criteria || input.review_findings,
    conclusion: input.conclusion || input.review_findings,
    recommendations: input.recommendations || capaNotes,
    additional_actions_required: input.additional_actions_required || capaRecommended,
    capa_recommended: capaRecommended,
    capa_recommendation_notes: capaNotes,
    qa_comments: input.qa_comments || '',
    head_qa_comments: input.head_qa_comments || '',
    further_action_required: capaRecommended,
    status: existing?.status || 'Draft',
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    is_deleted: false,
  };
}

async function runAutoNotifications(
  change: ChangeControlRecord,
  review: ChangeEffectivenessReview,
  actor: CcEffectivenessActor,
) {
  if (review.oos_generated) {
    await notify(
      'OOS After Change Implementation',
      `OOS generated during effectiveness review for ${change.change_control_number}. QA review required.`,
      change.id,
      { targetRole: 'qa' },
    );
  }
  if (review.complaint_generated) {
    await notify(
      'Complaint After Change Implementation',
      `Complaint linked to change ${change.change_control_number}. QA and Head QA review required.`,
      change.id,
      { targetRole: 'qa' },
    );
    await notify(
      'Complaint After Change Implementation',
      `Complaint linked to change ${change.change_control_number}. Head QA awareness required.`,
      change.id,
      { targetRole: 'head_qa' },
    );
  }
  if (review.no_data_integrity_impact === false) {
    await notify(
      'Data Integrity Impact Found',
      `Data integrity impact identified for ${change.change_control_number}. CSV team review required.`,
      change.id,
      { targetRole: 'csv' },
    );
  }
  if (review.capa_recommended) {
    await notify(
      'CAPA Recommended',
      `CAPA recommended from effectiveness review for ${change.change_control_number}.`,
      change.id,
      { targetRole: 'qa' },
    );
    if (change.linked_capa_id) {
      await notify(
        'CAPA Action Required',
        `Effectiveness review for ${change.change_control_number} requires CAPA follow-up.`,
        change.id,
        { userId: change.linked_capa_id },
      );
    }
  }
  if (review.review_owner) {
    await notify(
      'Effectiveness Review Updated',
      `Effectiveness review updated for ${change.change_control_number}.`,
      change.id,
      { userId: review.review_owner },
    );
  }
}

export async function getCcEffectivenessReview(changeId: string): Promise<ChangeEffectivenessReview | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness),
      where('change_id', '==', changeId),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(1),
    ));
    if (snap.empty) return null;
    return normalizeReview(snap.docs[0].id, snap.docs[0].data() as Record<string, unknown>);
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness),
      where('change_id', '==', changeId),
      limit(1),
    ));
    if (snap.empty) return null;
    const data = snap.docs[0].data() as Record<string, unknown>;
    if (data.is_deleted) return null;
    return normalizeReview(snap.docs[0].id, data);
  }
}

export async function listCcEffectivenessReviews(max = 300): Promise<(ChangeEffectivenessReview & { change?: ChangeControlRecord | null })[]> {
  if (!isFirebaseConfigured()) return [];
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness),
    orderBy('updated_at', 'desc'),
    limit(max),
  ));
  const changes = await listChanges();
  const changeById = new Map(changes.map((c) => [c.id, c]));
  return snap.docs
    .map((d) => normalizeReview(d.id, d.data() as Record<string, unknown>))
    .filter((r) => !r.is_deleted)
    .map((r) => ({ ...r, change: changeById.get(r.change_id) || null }));
}

export async function fetchCcEffectivenessPageData(changeId: string) {
  try {
    const [change, review, auditLogs] = await Promise.all([
      getChangeById(changeId),
      getCcEffectivenessReview(changeId),
      getAuditLogsForChange(changeId),
    ]);
    if (!change) return { error: 'Change control not found' as const };
    return { change, review, auditLogs };
  } catch (e) {
    console.error('fetchCcEffectivenessPageData', e);
    return { error: e instanceof Error ? e.message : 'Failed to load effectiveness review' };
  }
}

export async function fetchCcEffectivenessListData() {
  try {
    const [reviews, changes] = await Promise.all([listCcEffectivenessReviews(), listChanges()]);
    const metrics = computeCcEffectivenessDashboardMetrics(reviews, changes);
    const charts = computeCcEffectivenessChartData(reviews, changes);
    return { reviews, changes, metrics, charts };
  } catch (e) {
    console.error('fetchCcEffectivenessListData', e);
    return {
      reviews: [] as (ChangeEffectivenessReview & { change?: ChangeControlRecord | null })[],
      changes: [] as ChangeControlRecord[],
      metrics: computeCcEffectivenessDashboardMetrics([], []),
      charts: computeCcEffectivenessChartData([], []),
      error: e instanceof Error ? e.message : 'Failed to load list',
    };
  }
}

export async function saveCcEffectivenessDraft(
  input: CcEffectivenessFormInput,
  actor: CcEffectivenessActor,
): Promise<{ review?: ChangeEffectivenessReview; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase not configured' };
  const change = await getChangeById(input.change_id);
  if (!change) return { error: 'Change control not found' };
  const existing = await getCcEffectivenessReview(input.change_id);
  const payload = await buildPayload(change, input, actor, existing);
  let refId = existing?.id;
  if (existing) {
    await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness, existing.id), payload);
    await audit(actor, 'effectiveness updated', change.id, `Score: ${payload.effectiveness_score}`, refId);
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness), payload);
    refId = ref.id;
    await audit(actor, 'review created', change.id, `Review created for ${change.change_control_number}`, refId);
  }
  await audit(actor, 'score calculated', change.id, `Score: ${payload.effectiveness_score} → ${payload.effectiveness_result}`, refId);
  if (payload.capa_recommendation_notes) {
    await audit(actor, 'recommendation generated', change.id, payload.capa_recommendation_notes.slice(0, 200), refId);
  }
  const review = { id: refId!, ...payload } as ChangeEffectivenessReview;
  return { review };
}

export async function submitCcEffectivenessForReview(
  input: CcEffectivenessFormInput,
  actor: CcEffectivenessActor,
): Promise<{ review?: ChangeEffectivenessReview; error?: string }> {
  const draft = await saveCcEffectivenessDraft(input, actor);
  if (draft.error || !draft.review) return draft;
  const change = await getChangeById(input.change_id);
  if (!change) return { error: 'Change control not found' };
  const updates = {
    status: 'QA Review' as const,
    effectiveness_score: draft.review.effectiveness_score ?? 0,
    effectiveness_result: draft.review.effectiveness_result || draft.review.result || 'Pending Review',
    result: draft.review.effectiveness_result || draft.review.result || 'Pending Review',
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness, draft.review.id), updates);
  await updateChange(change.id, { status: 'effectiveness_pending' }, { id: actor.id, name: actor.name, role: actor.role || '' }, true);
  await audit(actor, 'effectiveness updated', change.id, 'Submitted for QA review', draft.review.id);
  await runAutoNotifications(change, { ...draft.review, ...updates }, actor);
  await notify('Effectiveness Review Submitted', `Review submitted for ${change.change_control_number}.`, change.id, { targetRole: 'qa' });
  if (input.review_owner) {
    await notify('Effectiveness Review Submitted', `Your review for ${change.change_control_number} was submitted.`, change.id, { userId: input.review_owner });
  }
  if (requiresHeadQaApproval(change.change_category)) {
    await notify('Head QA Review Pending', `Critical change ${change.change_control_number} will require Head QA after QA review.`, change.id, { targetRole: 'head_qa' });
  }
  return { review: { ...draft.review, ...updates } };
}

export async function submitCcEffectivenessQaReview(
  changeId: string,
  input: CcEffectivenessQaReviewInput,
  actor: CcEffectivenessActor,
): Promise<{ review?: ChangeEffectivenessReview; error?: string }> {
  const [change, existing] = await Promise.all([getChangeById(changeId), getCcEffectivenessReview(changeId)]);
  if (!change || !existing) return { error: 'Review not found' };
  if (existing.status === 'Head QA Review') {
    return { error: 'Use Head QA review for this record' };
  }
  if (!canApproveCcEffectiveness(actor.role)) {
    return { error: 'QA approval permission required' };
  }
  const approved = input.decision === 'approved';
  const needsHeadQa = requiresHeadQaApproval(change.change_category)
    && existing.status !== 'Head QA Review'
    && approved;
  const status = !approved ? 'Rejected' : needsHeadQa ? 'Head QA Review' : 'Approved';
  const updates: Partial<ChangeEffectivenessReview> = {
    qa_comments: input.qa_comments,
    head_qa_comments: input.head_qa_comments || existing.head_qa_comments,
    status,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness, existing.id), updates);
  if (status === 'Approved') {
    await updateChange(changeId, { status: 'effectiveness_completed' }, { id: actor.id, name: actor.name, role: actor.role || '' }, true);
    await audit(actor, 'review approved', changeId, input.qa_comments, existing.id);
  } else if (status === 'Head QA Review') {
    await audit(actor, 'QA review completed', changeId, 'Forwarded to Head QA', existing.id);
    await notify('Head QA Review Required', `Critical change ${change.change_control_number} requires Head QA effectiveness approval.`, changeId, { targetRole: 'head_qa' });
  } else {
    await audit(actor, 'review rejected', changeId, input.qa_comments, existing.id);
  }
  return { review: { ...existing, ...updates } };
}

export async function submitCcEffectivenessHeadQaReview(
  changeId: string,
  input: CcEffectivenessQaReviewInput,
  actor: CcEffectivenessActor,
): Promise<{ review?: ChangeEffectivenessReview; error?: string }> {
  const [change, existing] = await Promise.all([getChangeById(changeId), getCcEffectivenessReview(changeId)]);
  if (!change || !existing) return { error: 'Review not found' };
  if (!['super_admin', 'head_qa'].includes(normalizeRole(actor.role || ''))) {
    return { error: 'Head QA approval required' };
  }
  const approved = input.decision === 'approved';
  const status = approved ? 'Approved' : 'Rejected';
  const updates: Partial<ChangeEffectivenessReview> = {
    head_qa_comments: input.head_qa_comments || input.qa_comments,
    status,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness, existing.id), updates);
  if (approved) {
    await updateChange(changeId, { status: 'effectiveness_completed' }, { id: actor.id, name: actor.name, role: actor.role || '' }, true);
    await audit(actor, 'Head QA review completed', changeId, updates.head_qa_comments, existing.id);
    await audit(actor, 'review approved', changeId, 'Head QA approved', existing.id);
  } else {
    await audit(actor, 'review rejected', changeId, updates.head_qa_comments, existing.id);
  }
  return { review: { ...existing, ...updates } };
}

export async function closeCcEffectivenessReview(
  changeId: string,
  actor: CcEffectivenessActor,
): Promise<{ review?: ChangeEffectivenessReview; error?: string }> {
  const existing = await getCcEffectivenessReview(changeId);
  if (!existing) return { error: 'Review not found' };
  if (existing.status !== 'Approved') return { error: 'Only approved reviews can be closed' };
  const updates = { status: 'Closed', updated_at: nowIso(), updated_by: actor.id, updated_by_name: actor.name };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness, existing.id), updates);
  await audit(actor, 'EFFECTIVENESS_REVIEW_CLOSED', changeId, 'Review closed', existing.id);
  return { review: { ...existing, ...updates } };
}

export async function softDeleteCcEffectivenessReview(changeId: string, actor: CcEffectivenessActor) {
  const existing = await getCcEffectivenessReview(changeId);
  if (!existing) return { error: 'Review not found' };
  await updateDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.effectiveness, existing.id), {
    is_deleted: true, updated_at: nowIso(), updated_by: actor.id,
  });
  await audit(actor, 'EFFECTIVENESS_REVIEW_DELETED', changeId, 'Soft deleted', existing.id);
  return { ok: true };
}

export {
  computeCcEffectivenessDashboardMetrics,
  computeCcEffectivenessChartData,
  computeCcEffectivenessScore,
  computeAutoCcEffectivenessResult,
};

export type { CcEffectivenessDashboardMetrics, CcEffectivenessChartData };
