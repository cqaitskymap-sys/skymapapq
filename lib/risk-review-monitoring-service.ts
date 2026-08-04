import {
  addDoc, collection, doc, getDocs, limit, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { RISK_ASSESSMENT_COLLECTION } from '@/lib/cpv-risk-assessment-records';
import {
  fetchRiskAssessmentById,
  fetchRiskAssessmentRecords,
} from '@/lib/cpv-risk-assessment-service';
import { listCapas } from '@/lib/capa-service';
import { listComplaints } from '@/lib/complaint-service';
import { listDeviations } from '@/lib/deviation-service';
import { listOosRecords } from '@/lib/oos-service';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { updateRecord } from '@/lib/firestore';
import { polishRecommendationText } from '@/lib/ai/client';
import {
  RISK_MONITORING_COLLECTION,
  RISK_REVIEW_MODULE,
  RISK_REVIEWS_COLLECTION,
  buildDefaultReviewForm,
  buildReviewChartData,
  buildReviewMonitoringContext,
  calculateNextReviewDate,
  computeReviewDashboardMetrics,
  computeRiskTrend,
  generateReviewRecommendations,
  requiresHeadQaReview,
  type RiskMonitoringSnapshot,
  type RiskReviewActor,
  type RiskReviewFormInput,
  type RiskReviewRecord,
} from '@/lib/risk-review-monitoring-records';
import type { RiskAssessmentRecord } from '@/lib/cpv-risk-assessment-records';
import { inferRiskDepartment } from '@/lib/risk-reports-records';

export type { RiskReviewActor, RiskReviewFormInput };

const NOTIFICATIONS = 'notifications';
const AUDIT_TRAIL = 'audit_trail';

const nowIso = () => new Date().toISOString();

function buildReviewId(riskNumber: string) {
  return `RRV-${riskNumber.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function audit(actor: RiskReviewActor, actionType: string, recordId: string, detail?: string) {
  try {
    await createAuditLog({
      moduleName: RISK_REVIEW_MODULE,
      collectionName: RISK_REVIEWS_COLLECTION,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('risk review audit', e);
  }
}

async function notify(title: string, message: string, recordId: string, userId?: string) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), NOTIFICATIONS), {
      title, message, module: RISK_REVIEW_MODULE, record_id: recordId,
      user_id: userId || '', read: false, created_at: nowIso(),
    });
  } catch (e) {
    console.error('risk review notify', e);
  }
}

async function notifyRole(title: string, message: string, recordId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), NOTIFICATIONS), {
        title, message, module: RISK_REVIEW_MODULE, record_id: recordId,
        target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('risk review notify role', e);
    }
  }
}

async function countLinkedQualityEvents(risk: RiskAssessmentRecord) {
  let deviations = risk.linkedDeviationNumber ? 1 : 0;
  let oos = risk.linkedOosNumber ? 1 : 0;
  let complaints = 0;
  let capas = risk.linkedCapaNumber ? 1 : 0;

  if (!isFirebaseConfigured()) {
    return { deviations, oos, complaints, capas };
  }

  try {
    const [devs, oosList, complaintsList, capasList] = await Promise.all([
      listDeviations().catch(() => []),
      listOosRecords().catch(() => []),
      listComplaints().catch(() => []),
      listCapas().catch(() => []),
    ]);

    const product = (risk.productName || '').toLowerCase();
    const riskNo = risk.riskNumber.toLowerCase();

    const match = (text: string) => text.toLowerCase().includes(product) || text.toLowerCase().includes(riskNo);

    deviations += devs.filter((d) => match(`${d.product_name || ''} ${d.deviation_number || ''} ${d.title || ''}`)).length;
    oos += oosList.filter((o) => match(`${o.product_name || ''} ${o.oos_number || ''}`)).length;
    complaints += complaintsList.filter((c) => match(`${c.product_name || ''} ${c.complaint_number || ''}`)).length;
    capas += capasList.filter((c) => match(`${c.capa_number || ''} ${c.capa_title || ''} ${c.source_reference_number || ''}`)).length;
  } catch {
    /* use linked field counts */
  }

  return { deviations, oos, complaints, capas };
}

async function buildReviewPayload(
  risk: RiskAssessmentRecord,
  form: RiskReviewFormInput,
  ctx: ReturnType<typeof buildReviewMonitoringContext>,
  actor: RiskReviewActor,
  status: string,
  existing?: RiskReviewRecord | null,
): Promise<Omit<RiskReviewRecord, 'id'>> {
  const ts = nowIso();
  const residualRpn = ctx.residualRpn;
  const trend = computeRiskTrend(ctx.initialRpn, ctx.currentRpn, residualRpn, ctx.residualRiskLevel);
  const recs = generateReviewRecommendations({
    effectiveness: form.effectiveness_evaluation,
    deviationCount: ctx.deviationCount,
    oosCount: ctx.oosCount,
    complaintCount: ctx.complaintCount,
    residualRiskLevel: ctx.residualRiskLevel,
    riskTrend: trend,
    furtherMitigationRequired: form.further_mitigation_required,
    repeatEventsObserved: form.repeat_events_observed,
  });
  const recommendation = await polishRecommendationText(
    form.recommendation || recs.join(' '),
    {
      module: 'Risk Review Monitoring',
      riskNumber: risk.riskNumber,
      residualRiskLevel: ctx.residualRiskLevel,
      riskTrend: trend,
      effectiveness: form.effectiveness_evaluation,
    },
  );

  return {
    review_id: existing?.review_id || buildReviewId(risk.riskNumber),
    risk_assessment_id: risk.id,
    risk_number: risk.riskNumber,
    review_date: form.review_date,
    review_type: form.review_type,
    reviewer: form.reviewer,
    department: inferRiskDepartment(risk),
    review_frequency: form.review_frequency,
    initial_rpn: ctx.initialRpn,
    current_rpn: ctx.currentRpn,
    residual_rpn: residualRpn,
    risk_level: ctx.riskLevel,
    residual_risk_level: ctx.residualRiskLevel,
    mitigation_status: ctx.mitigationStatus,
    risk_trend: trend,
    new_risks_identified: form.new_risks_identified,
    repeat_events_observed: form.repeat_events_observed,
    deviation_count: ctx.deviationCount,
    oos_count: ctx.oosCount,
    complaint_count: ctx.complaintCount,
    capa_count: ctx.capaCount,
    effectiveness_evaluation: form.effectiveness_evaluation,
    risk_reduction_achieved: form.risk_reduction_achieved,
    further_mitigation_required: form.further_mitigation_required,
    review_conclusion: form.review_conclusion,
    recommendation,
    next_review_date: form.next_review_date || calculateNextReviewDate(form.review_date, form.review_frequency),
    qa_comments: form.qa_comments,
    status,
    capa_recommended: recs.some((r) => r.includes('CAPA')),
    head_qa_escalated: requiresHeadQaReview(risk, ctx.residualRiskLevel),
    created_at: existing?.created_at || ts,
    updated_at: ts,
    created_by: existing?.created_by || actor.id,
    created_by_name: existing?.created_by_name || actor.name,
    updated_by: actor.id,
    updated_by_name: actor.name,
    is_deleted: false,
  };
}

async function saveMonitoringSnapshot(risk: RiskAssessmentRecord, ctx: ReturnType<typeof buildReviewMonitoringContext>) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), RISK_MONITORING_COLLECTION), {
      risk_assessment_id: risk.id,
      risk_number: risk.riskNumber,
      snapshot_date: new Date().toISOString().split('T')[0],
      current_rpn: ctx.currentRpn,
      residual_rpn: ctx.residualRpn,
      risk_trend: ctx.riskTrend,
      deviation_count: ctx.deviationCount,
      oos_count: ctx.oosCount,
      complaint_count: ctx.complaintCount,
      capa_count: ctx.capaCount,
      created_at: nowIso(),
      is_deleted: false,
    } satisfies RiskMonitoringSnapshot);
  } catch (e) {
    console.error('monitoring snapshot', e);
  }
}

export async function getRiskReviews(riskAssessmentId: string): Promise<RiskReviewRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION),
      where('risk_assessment_id', '==', riskAssessmentId),
      where('is_deleted', '==', false),
      orderBy('review_date', 'desc'),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskReviewRecord));
  } catch {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION),
      where('risk_assessment_id', '==', riskAssessmentId),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskReviewRecord))
      .filter((r) => !r.is_deleted)
      .sort((a, b) => (b.review_date || '').localeCompare(a.review_date || ''));
  }
}

export async function listAllRiskReviews(max = 300): Promise<RiskReviewRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION),
      where('is_deleted', '==', false),
      orderBy('updated_at', 'desc'),
      limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskReviewRecord));
  } catch {
    const snap = await getDocs(collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskReviewRecord)).filter((r) => !r.is_deleted);
  }
}

export async function getRiskReviewById(reviewId: string): Promise<RiskReviewRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION),
      where('review_id', '==', reviewId),
      limit(1),
    ));
    if (snap.empty) {
      const docSnap = await getDocs(query(collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION), limit(500)));
      const found = docSnap.docs.find((d) => d.id === reviewId);
      if (!found) return null;
      const data = found.data();
      if (data.is_deleted) return null;
      return { id: found.id, ...data } as RiskReviewRecord;
    }
    const data = snap.docs[0].data();
    if (data.is_deleted) return null;
    return { id: snap.docs[0].id, ...data } as RiskReviewRecord;
  } catch {
    return null;
  }
}

export async function fetchRiskReviewPageData(riskAssessmentId: string, actorName: string) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const risk = await fetchRiskAssessmentById(riskAssessmentId);
    if (!risk) return { error: 'Risk assessment not found.' };

    const linkedCounts = await countLinkedQualityEvents(risk);
    const reviews = await getRiskReviews(riskAssessmentId);
    const ctx = buildReviewMonitoringContext(risk, linkedCounts, reviews);
    const latestReview = reviews[0] || null;
    const formDefaults = buildDefaultReviewForm(risk, ctx, actorName, latestReview?.status === 'Draft' ? latestReview : null);

    const monitoringSnap = await getMonitoringSnapshots(riskAssessmentId);
    const auditLogs = await getAuditLogs(riskAssessmentId);

    return { risk, reviews, ctx, formDefaults, latestReview, monitoringSnap, auditLogs, linkedCounts };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to load review data' };
  }
}

async function getMonitoringSnapshots(riskAssessmentId: string): Promise<RiskMonitoringSnapshot[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_MONITORING_COLLECTION),
      where('risk_assessment_id', '==', riskAssessmentId),
      orderBy('snapshot_date', 'desc'),
      limit(24),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RiskMonitoringSnapshot));
  } catch {
    return [];
  }
}

async function getAuditLogs(riskId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), AUDIT_TRAIL),
      where('recordId', '==', riskId),
      limit(100),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function fetchRiskReviewDashboard() {
  const [reviews, risks] = await Promise.all([
    listAllRiskReviews(),
    isFirebaseConfigured() ? fetchRiskAssessmentRecords() : Promise.resolve([]),
  ]);
  return {
    reviews,
    risks,
    metrics: computeReviewDashboardMetrics(reviews, risks),
    charts: buildReviewChartData(reviews),
  };
}

export async function saveRiskReviewDraft(
  riskAssessmentId: string,
  form: RiskReviewFormInput,
  actor: RiskReviewActor,
): Promise<RiskReviewRecord> {
  const risk = await fetchRiskAssessmentById(riskAssessmentId);
  if (!risk) throw new Error('Risk assessment not found');

  const linkedCounts = await countLinkedQualityEvents(risk);
  const reviews = await getRiskReviews(riskAssessmentId);
  const ctx = buildReviewMonitoringContext(risk, linkedCounts, reviews);
  const existing = reviews.find((r) => r.status === 'Draft') || null;
  const payload = await buildReviewPayload(risk, form, ctx, actor, 'Draft', existing);

  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION, existing.id), payload);
    await audit(actor, 'review started', riskAssessmentId);
    return { id: existing.id, ...payload };
  }

  const ref = await addDoc(collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION), payload);
  await audit(actor, 'review scheduled', riskAssessmentId, payload.review_id);
  await notify('Risk Review Scheduled', `${risk.riskNumber} review scheduled for ${form.review_date}`, riskAssessmentId, risk.createdBy);
  return { id: ref.id, ...payload };
}

export async function submitRiskReviewForQa(
  riskAssessmentId: string,
  form: RiskReviewFormInput,
  actor: RiskReviewActor,
): Promise<RiskReviewRecord> {
  if (!form.review_conclusion.trim()) throw new Error('Review conclusion is required');
  if (!form.next_review_date.trim()) throw new Error('Next review date is required');
  if (!form.effectiveness_evaluation) throw new Error('Effectiveness evaluation is required');

  const risk = await fetchRiskAssessmentById(riskAssessmentId);
  if (!risk) throw new Error('Risk assessment not found');

  const linkedCounts = await countLinkedQualityEvents(risk);
  const reviews = await getRiskReviews(riskAssessmentId);
  const ctx = buildReviewMonitoringContext(risk, linkedCounts, reviews);
  const existing = reviews.find((r) => ['Draft', 'Under Review'].includes(r.status)) || null;
  const payload = await buildReviewPayload(risk, form, ctx, actor, 'QA Review', existing);

  let saved: RiskReviewRecord;
  if (existing?.id) {
    await updateDoc(doc(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION, existing.id), payload);
    saved = { id: existing.id, ...payload };
  } else {
    const ref = await addDoc(collection(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION), payload);
    saved = { id: ref.id, ...payload };
  }

  await saveMonitoringSnapshot(risk, ctx);
  await audit(actor, 'monitoring updated', riskAssessmentId);
  await audit(actor, 'QA review completed', riskAssessmentId, form.review_conclusion);

  if (payload.risk_trend === 'Increasing') {
    await notifyRole('Risk Trend Increasing', risk.riskNumber, riskAssessmentId, ['qa_manager', 'risk_manager']);
  }
  if (payload.capa_recommended) {
    await notify('CAPA Recommended', `Review of ${risk.riskNumber} recommends CAPA`, riskAssessmentId);
    await notifyRole('CAPA Recommended', risk.riskNumber, riskAssessmentId, ['qa_manager']);
  }
  if (payload.head_qa_escalated) {
    await notifyRole('Critical Risk Review', risk.riskNumber, riskAssessmentId, ['head_qa']);
  }

  await updateRecord(RISK_ASSESSMENT_COLLECTION, riskAssessmentId, {
    effectivenessStatus: form.effectiveness_evaluation,
    reviewedBy: form.reviewer,
    reviewDate: form.review_date,
    updatedByName: actor.name,
  }, { moduleName: RISK_REVIEW_MODULE, actor: { id: actor.id, name: actor.name } });

  return saved;
}

export async function approveRiskReview(
  riskAssessmentId: string,
  reviewDocId: string,
  form: RiskReviewFormInput,
  actor: RiskReviewActor,
): Promise<RiskReviewRecord> {
  const risk = await fetchRiskAssessmentById(riskAssessmentId);
  if (!risk) throw new Error('Risk assessment not found');

  const linkedCounts = await countLinkedQualityEvents(risk);
  const reviews = await getRiskReviews(riskAssessmentId);
  const ctx = buildReviewMonitoringContext(risk, linkedCounts, reviews);
  const existing = reviews.find((r) => r.id === reviewDocId);
  if (!existing) throw new Error('Review record not found');

  const payload = await buildReviewPayload(risk, form, ctx, actor, 'Approved', existing);
  await updateDoc(doc(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION, reviewDocId), payload);

  await audit(actor, 'review approved', riskAssessmentId, form.review_conclusion);
  await audit(actor, 'next review scheduled', riskAssessmentId, form.next_review_date);
  await notify('Risk Review Approved', `${risk.riskNumber} review approved`, riskAssessmentId, risk.createdBy);
  await notifyRole('Risk Review Approved', risk.riskNumber, riskAssessmentId, ['risk_manager', 'qa_manager']);

  return { id: reviewDocId, ...payload };
}

export async function rejectRiskReview(
  riskAssessmentId: string,
  reviewDocId: string,
  reason: string,
  actor: RiskReviewActor,
): Promise<RiskReviewRecord> {
  const existing = await getRiskReviews(riskAssessmentId).then((r) => r.find((x) => x.id === reviewDocId));
  if (!existing) throw new Error('Review not found');

  const payload = { status: 'Rejected', qa_comments: reason, updated_at: nowIso(), updated_by: actor.id, updated_by_name: actor.name };
  await updateDoc(doc(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION, reviewDocId), payload);
  await audit(actor, 'review rejected', riskAssessmentId, reason);
  await notify('Risk Review Rejected', reason, riskAssessmentId);
  return { ...existing, ...payload };
}

export async function escalateOverdueReviews(actor: RiskReviewActor): Promise<number> {
  const reviews = await listAllRiskReviews();
  const today = new Date().toISOString().split('T')[0];
  let count = 0;

  for (const r of reviews) {
    if (r.status === 'Closed' || r.status === 'Approved') continue;
    if (!r.next_review_date || r.next_review_date >= today) continue;

    await notifyRole('Overdue Risk Review', `${r.risk_number} review overdue`, r.risk_assessment_id, ['admin', 'qa_manager', 'risk_manager']);
    await audit(actor, 'review escalated', r.risk_assessment_id, `Overdue since ${r.next_review_date}`);
    count += 1;
  }
  return count;
}

export async function softDeleteRiskReview(id: string, actor: RiskReviewActor) {
  if (!isFirebaseConfigured()) return;
  await updateDoc(doc(getFirebaseFirestore(), RISK_REVIEWS_COLLECTION, id), {
    is_deleted: true,
    updated_at: nowIso(),
    updated_by: actor.id,
    updated_by_name: actor.name,
  });
}

export async function schedulePeriodicReviews(actor: RiskReviewActor): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const risks = await fetchRiskAssessmentRecords();
  const today = new Date().toISOString().split('T')[0];
  let scheduled = 0;

  for (const risk of risks) {
    if (['Closed', 'Rejected'].includes(risk.riskStatus)) continue;
    if (!['High', 'Critical'].includes(risk.riskLevel) && risk.riskLevel !== 'Medium') continue;

    const reviews = await getRiskReviews(risk.id);
    const last = reviews.find((r) => r.status === 'Approved');
    const due = last?.next_review_date || risk.reviewDate;
    if (due && due > today) continue;
    if (reviews.some((r) => ['Draft', 'Under Review', 'QA Review'].includes(r.status))) continue;

    const linkedCounts = await countLinkedQualityEvents(risk);
    const ctx = buildReviewMonitoringContext(risk, linkedCounts, reviews);
    const form = buildDefaultReviewForm(risk, ctx, actor.name);
    await saveRiskReviewDraft(risk.id, form, actor);
    scheduled += 1;
  }
  return scheduled;
}
