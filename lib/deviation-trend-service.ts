import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  computeTrendAnalysis,
  mapTrendToRecord,
  TREND_MODULE,
  type TrendActor,
  type TrendFilterInput,
  type TrendSaveForm,
} from '@/lib/deviation-trend-records';
import { DEVIATION_COLLECTIONS, type DeviationTrendRecord } from '@/lib/deviation-types';
import { listDeviations } from '@/lib/deviation-service';
import { polishTrendDrafts } from '@/lib/ai/client';

export type { TrendActor, TrendFilterInput, TrendSaveForm };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: TrendActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: TREND_MODULE,
      collectionName: DEVIATION_COLLECTIONS.trends,
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
      collectionName: DEVIATION_COLLECTIONS.trends,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: TREND_MODULE,
    });
  } catch (e) {
    console.error('trend audit', e);
  }
}

async function notify(title: string, message: string, userId: string, recordId: string) {
  if (!isFirebaseConfigured() || !userId) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.notifications), {
      title,
      message,
      module: 'Deviation Trend Analysis',
      record_id: recordId,
      user_id: userId,
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('trend notify', e);
  }
}

export async function generateDeviationTrend(filters: TrendFilterInput) {
  const all = await listDeviations();
  const analysis = computeTrendAnalysis(all, filters);
  const polished = await polishTrendDrafts({
    module: 'Deviation',
    recommendation_draft: analysis.recommendation_draft,
    conclusion_draft: analysis.conclusion_draft,
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
  };
}

export async function listSavedTrends(max = 100): Promise<DeviationTrendRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.trends),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DeviationTrendRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.trends),
        limit(max),
      ));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as DeviationTrendRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch (e) {
      console.error('listSavedTrends', e);
      return [];
    }
  }
}

export async function getTrendById(id: string): Promise<DeviationTrendRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.trends, id));
    if (!snap.exists()) {
      const all = await listSavedTrends();
      return all.find((r) => r.id === id) ?? null;
    }
    return { id: snap.id, ...snap.data() } as DeviationTrendRecord;
  } catch {
    const all = await listSavedTrends();
    return all.find((r) => r.id === id) ?? null;
  }
}

export async function saveDeviationTrend(
  filters: TrendFilterInput,
  form: TrendSaveForm,
  actor: TrendActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) {
    return { error: 'Firebase is not configured' };
  }
  const analysis = await generateDeviationTrend(filters);
  if (analysis.filtered_count === 0) {
    return { error: 'At least one deviation is required for a meaningful trend' };
  }
  const payload = mapTrendToRecord({ ...filters, ...form }, analysis, actor);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.trends), payload);
    await audit(actor, 'trend generated', ref.id, `Trend ${payload.trend_id} saved`, undefined, payload);
    await notify(
      'Deviation Trend Saved',
      `Trend ${payload.trend_id} generated for ${filters.review_period_from} to ${filters.review_period_to}`,
      actor.id,
      ref.id,
    );
    return { id: ref.id };
  } catch (e) {
    console.error('saveDeviationTrend', e);
    return { error: 'Failed to save trend record' };
  }
}

export async function approveDeviationTrend(
  trendId: string,
  actor: TrendActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const record = await getTrendById(trendId);
  if (!record) return { error: 'Trend record not found' };
  if (record.approved_by) return { error: 'Trend already approved' };
  const now = nowIso();
  try {
    await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.trends, trendId), {
      approved_by: actor.id,
      approved_by_name: actor.name,
      approved_date: now.split('T')[0],
      updated_at: now,
    });
    await audit(actor, 'trend approved', trendId, `Trend ${record.trend_id} approved by Head QA`, record, {
      approved_by: actor.id,
      approved_date: now,
    });
    return {};
  } catch (e) {
    console.error('approveDeviationTrend', e);
    return { error: 'Failed to approve trend' };
  }
}

export async function logTrendFilterApplied(actor: TrendActor, filters: TrendFilterInput) {
  await audit(
    actor,
    'filter applied',
    'workspace',
    `Filters: ${filters.review_period_from} to ${filters.review_period_to}`,
    undefined,
    filters,
  );
}

export async function logTrendRecommendationGenerated(actor: TrendActor, trendId: string, text: string) {
  await audit(actor, 'recommendation generated', trendId, text.slice(0, 200));
}

export async function logTrendExport(actor: TrendActor, trendId: string, format = 'report') {
  await audit(actor, 'export trend report', trendId, `Export placeholder (${format})`);
}

export async function fetchTrendProductOptions(): Promise<string[]> {
  const all = await listDeviations();
  const set = new Set<string>();
  for (const r of all) {
    if (r.product_name) set.add(r.product_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchTrendRootCauseOptions(): Promise<string[]> {
  const all = await listDeviations();
  const set = new Set<string>();
  for (const r of all) {
    set.add((r.root_cause || 'Not Documented').slice(0, 40));
  }
  return ['All', ...Array.from(set).sort()];
}
