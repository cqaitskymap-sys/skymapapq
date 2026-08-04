import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  COMPLAINT_TREND_MODULE,
  computeComplaintTrendAnalysis,
  mapComplaintTrendToRecord,
  type ComplaintTrendActor,
  type ComplaintTrendFilterInput,
  type ComplaintTrendSaveForm,
} from '@/lib/complaint-trend-records';
import { COMPLAINT_COLLECTIONS, type ComplaintTrendRecord } from '@/lib/complaint-types';
import { listComplaints } from '@/lib/complaint-service';
import { polishTrendDrafts } from '@/lib/ai/client';

export type { ComplaintTrendActor, ComplaintTrendFilterInput, ComplaintTrendSaveForm };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: ComplaintTrendActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: COMPLAINT_TREND_MODULE,
      collectionName: COMPLAINT_COLLECTIONS.trends,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      oldValue: oldVal,
      newValue: newVal,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: COMPLAINT_COLLECTIONS.trends,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: COMPLAINT_TREND_MODULE,
    });
  } catch (e) {
    console.error('complaint trend audit', e);
  }
}

async function notifyRole(title: string, message: string, recordId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.notifications), {
        title,
        message,
        module: 'Complaint Trend Analysis',
        record_id: recordId,
        target_role: role,
        read: false,
        created_at: nowIso(),
      });
    } catch (e) {
      console.error('complaint trend notify', e);
    }
  }
}

export async function generateComplaintTrend(filters: ComplaintTrendFilterInput) {
  const all = await listComplaints();
  const analysis = computeComplaintTrendAnalysis(all, filters);
  const polished = await polishTrendDrafts({
    module: 'Complaint',
    recommendation_draft: analysis.recommendation_draft,
    conclusion_draft: analysis.conclusion_draft,
    management_summary_draft: analysis.management_summary_draft,
    context: {
      metrics: analysis.metrics,
      alerts: analysis.alerts,
      trend_status: analysis.trend_status,
      risk_level: analysis.risk_level,
      filters,
    },
  });
  return {
    ...analysis,
    recommendation_draft: polished.recommendation_draft,
    conclusion_draft: polished.conclusion_draft || analysis.conclusion_draft,
    management_summary_draft:
      polished.management_summary_draft || analysis.management_summary_draft,
  };
}

export async function listSavedComplaintTrends(max = 100): Promise<ComplaintTrendRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.trends),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ComplaintTrendRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.trends),
        limit(max),
      ));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ComplaintTrendRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch (e) {
      console.error('listSavedComplaintTrends', e);
      return [];
    }
  }
}

export async function getComplaintTrendById(id: string): Promise<ComplaintTrendRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.trends, id));
    if (!snap.exists()) {
      const all = await listSavedComplaintTrends();
      return all.find((r) => r.id === id) ?? null;
    }
    return { id: snap.id, ...snap.data() } as ComplaintTrendRecord;
  } catch {
    const all = await listSavedComplaintTrends();
    return all.find((r) => r.id === id) ?? null;
  }
}

export async function saveComplaintTrend(
  filters: ComplaintTrendFilterInput,
  form: ComplaintTrendSaveForm,
  actor: ComplaintTrendActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) {
    return { error: 'Firebase is not configured' };
  }
  const analysis = await generateComplaintTrend(filters);
  if (analysis.filtered_count === 0) {
    return { error: 'At least one complaint is required for a meaningful trend record' };
  }
  const payload = mapComplaintTrendToRecord({ ...filters, ...form }, analysis, actor);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.trends), payload);
    await audit(actor, 'Complaint Trend Generated', ref.id, `Trend ${payload.trend_id} saved`, undefined, payload);
    await notifyRole(
      'Complaint Trend Saved',
      `Trend ${payload.trend_id} generated for ${filters.review_period_from} to ${filters.review_period_to}`,
      ref.id,
      ['qa_manager', 'head_qa'],
    );
    if (analysis.alerts.some((a) => /critical complaint/i.test(a))) {
      await notifyRole(
        'Critical Complaint Trend Alert',
        analysis.alerts.find((a) => /critical complaint/i.test(a)) || 'Critical complaints increasing',
        ref.id,
        ['head_qa'],
      );
    }
    return { id: ref.id };
  } catch (e) {
    console.error('saveComplaintTrend', e);
    return { error: 'Failed to save trend record' };
  }
}

export async function approveComplaintTrend(
  trendId: string,
  actor: ComplaintTrendActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const record = await getComplaintTrendById(trendId);
  if (!record) return { error: 'Trend record not found' };
  if (record.approved_by) return { error: 'Trend already approved' };
  const now = nowIso();
  try {
    await updateDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.trends, trendId), {
      approved_by: actor.id,
      approved_by_name: actor.name,
      approved_date: now.split('T')[0],
      updated_at: now,
    });
    await audit(actor, 'Complaint Trend Approved', trendId, `Trend ${record.trend_id} approved by Head QA`, record, {
      approved_by: actor.id,
      approved_date: now,
    });
    return {};
  } catch (e) {
    console.error('approveComplaintTrend', e);
    return { error: 'Failed to approve trend' };
  }
}

export async function logComplaintTrendFilterApplied(actor: ComplaintTrendActor, filters: ComplaintTrendFilterInput) {
  await audit(
    actor,
    'Complaint Trend Filter Applied',
    'workspace',
    `Filters: ${filters.review_period_from} to ${filters.review_period_to}`,
    undefined,
    filters,
  );
}

export async function logComplaintTrendRecommendationGenerated(actor: ComplaintTrendActor, trendId: string, text: string) {
  await audit(actor, 'Complaint Trend Recommendation Generated', trendId, text.slice(0, 200));
}

export async function logComplaintTrendExport(actor: ComplaintTrendActor, trendId: string, format = 'report') {
  await audit(actor, 'Export Complaint Trend Report', trendId, `Export placeholder (${format})`);
}

export async function fetchComplaintTrendProductOptions(): Promise<string[]> {
  const all = await listComplaints();
  const set = new Set<string>();
  for (const r of all) {
    if (r.product_name) set.add(r.product_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchComplaintTrendMarketOptions(): Promise<string[]> {
  const all = await listComplaints();
  const set = new Set<string>();
  for (const r of all) {
    if (r.market_region) set.add(r.market_region);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchComplaintTrendRootCauseOptions(): Promise<string[]> {
  const all = await listComplaints();
  const set = new Set<string>();
  for (const r of all) {
    set.add((r.root_cause || 'Not Documented').trim().slice(0, 50) || 'Not Documented');
  }
  return ['All', ...Array.from(set).sort()];
}

export { computeComplaintTrendAnalysis };
