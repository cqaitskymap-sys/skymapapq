import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { listCapas } from '@/lib/capa-service';
import {
  CAPA_TREND_MODULE,
  computeCapaTrendAnalysis,
  extractProductOptions,
  extractRootCauseOptions,
  mapCapaTrendToRecord,
  type CapaTrendActor,
  type CapaTrendFilterInput,
  type CapaTrendSaveForm,
} from '@/lib/capa-trend-records';
import { CAPA_COLLECTIONS, type CapaTrendRecord } from '@/lib/capa-types';
import { polishTrendDrafts } from '@/lib/ai/client';

export type { CapaTrendActor, CapaTrendFilterInput, CapaTrendSaveForm };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: CapaTrendActor,
  actionType: string,
  recordId: string,
  detail?: string,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: CAPA_TREND_MODULE,
      collectionName: CAPA_COLLECTIONS.trends,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      newValue: newVal,
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('capa trend audit', e);
  }
}

async function notify(title: string, message: string, recordId: string, userId?: string, role?: string) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title,
      message,
      module: 'CAPA Trend Analysis',
      record_id: recordId,
      ...(userId ? { user_id: userId } : {}),
      ...(role ? { target_role: role } : {}),
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa trend notify', e);
  }
}

export async function generateCapaTrend(filters: CapaTrendFilterInput) {
  const all = await listCapas();
  const analysis = computeCapaTrendAnalysis(all, filters);
  const polished = await polishTrendDrafts({
    module: 'CAPA',
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

export async function listSavedCapaTrends(max = 100): Promise<CapaTrendRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.trends),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as CapaTrendRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.trends));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as CapaTrendRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, max);
    } catch {
      return [];
    }
  }
}

export async function getCapaTrendById(id: string): Promise<CapaTrendRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.trends, id));
    if (!snap.exists()) return null;
    const data = snap.data();
    if ((data as CapaTrendRecord).is_deleted) return null;
    return { id: snap.id, ...data } as CapaTrendRecord;
  } catch {
    return null;
  }
}

export async function saveCapaTrend(
  filters: CapaTrendFilterInput,
  form: CapaTrendSaveForm,
  actor: CapaTrendActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const analysis = await generateCapaTrend(filters);
  if (analysis.filtered_count === 0) {
    return { error: 'At least one CAPA record is required to save a trend' };
  }
  const payload = mapCapaTrendToRecord({ ...filters, ...form }, analysis, actor);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.trends), payload);
    await audit(actor, 'trend generated', ref.id, `Trend ${payload.trend_id} saved`, payload);
    await notify('CAPA Trend Saved', `Trend ${payload.trend_id} generated`, ref.id, actor.id);
    return { id: ref.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save trend record' };
  }
}

export async function approveCapaTrend(
  trendId: string,
  actor: CapaTrendActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const record = await getCapaTrendById(trendId);
  if (!record) return { error: 'Trend record not found' };
  if (record.approved_by) return { error: 'Trend already approved' };
  const now = nowIso();
  try {
    await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.trends, trendId), {
      approved_by: actor.id,
      approved_by_name: actor.name,
      approved_date: now.split('T')[0],
      updated_at: now,
      updated_by: actor.id,
    });
    await audit(actor, 'trend approved', trendId, `Trend ${record.trend_id} approved by Head QA`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to approve trend' };
  }
}

export async function logCapaTrendFilterApplied(actor: CapaTrendActor, filters: CapaTrendFilterInput) {
  await audit(actor, 'filter applied', 'workspace', `Filters: ${filters.review_period_from} to ${filters.review_period_to}`, filters);
}

export async function logCapaTrendRecommendationGenerated(actor: CapaTrendActor, trendId: string, text: string) {
  await audit(actor, 'recommendation generated', trendId, text.slice(0, 200));
}

export async function logCapaTrendExport(actor: CapaTrendActor, trendId: string, format = 'report') {
  await audit(actor, 'export trend report', trendId, `Export placeholder (${format})`);
}

export async function fetchCapaTrendProductOptions(): Promise<string[]> {
  const all = await listCapas();
  return extractProductOptions(all);
}

export async function fetchCapaTrendRootCauseOptions(): Promise<string[]> {
  const all = await listCapas();
  return extractRootCauseOptions(all);
}

export async function processCapaTrendAlerts(
  analysis: Awaited<ReturnType<typeof generateCapaTrend>>,
  actor: CapaTrendActor,
) {
  for (const alert of analysis.alerts) {
    if (/overdue capa/i.test(alert)) {
      await notify('CAPA Overdue Trend Alert', alert, 'capa-trend-workspace', undefined, 'head_qa');
    }
    if (/high risk alert/i.test(alert)) {
      await notify('CAPA High Risk Trend Alert', alert, 'capa-trend-workspace', undefined, 'qa_manager');
    }
  }
  if (analysis.filtered_count > 0) {
    await audit(actor, 'trend generated', 'workspace', `${analysis.filtered_count} CAPA analyzed`, {
      trend_status: analysis.trend_status,
      alerts: analysis.alerts,
    });
  }
}

export async function getLatestCapaTrendSummary(): Promise<string> {
  const trends = await listSavedCapaTrends(1);
  if (!trends.length) return 'No saved CAPA trend analysis available.';
  const t = trends[0];
  return `CAPA Trend (${t.review_period_from} to ${t.review_period_to}): ${t.trend_status} — ${t.conclusion.slice(0, 200)}`;
}

export {
  computeCapaTrendAnalysis,
  getCapaTrendSummaryForDashboard,
} from '@/lib/capa-trend-records';
