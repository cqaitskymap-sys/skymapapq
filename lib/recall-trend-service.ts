import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { downloadCsv } from '@/lib/export-utils';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  computeRecallTrendAnalysis,
  extractRecallMarketOptions,
  extractRecallProductOptions,
  mapRecallTrendToRecord,
  RECALL_TREND_MODULE,
  type RecallTrendActor,
  type RecallTrendAnalysisResult,
  type RecallTrendFilterInput,
  type RecallTrendSaveForm,
} from '@/lib/recall-trend-records';
import { listRecalls } from '@/lib/recall-service';
import { RECALL_COLLECTIONS, type RecallClosure, type RecallTrendRecord } from '@/lib/recall-types';
import { polishTrendDrafts } from '@/lib/ai/client';

export type { RecallTrendActor, RecallTrendFilterInput, RecallTrendSaveForm };

const nowIso = () => new Date().toISOString();

async function audit(actor: RecallTrendActor, actionType: string, recordId: string, detail?: string, newVal?: unknown) {
  try {
    await createAuditLog({
      moduleName: RECALL_TREND_MODULE,
      collectionName: RECALL_COLLECTIONS.trends,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      newValue: newVal,
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('recall trend audit', e);
  }
}

async function notify(title: string, message: string, recordId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  try {
    for (const role of roles) {
      await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.notifications), {
        title, message, module: RECALL_TREND_MODULE, record_id: recordId, target_role: role, read: false, created_at: nowIso(),
      });
    }
  } catch (e) {
    console.error('recall trend notify', e);
  }
}

async function loadAllClosures(recallIds: string[]): Promise<RecallClosure[]> {
  if (!isFirebaseConfigured() || !recallIds.length) return [];
  try {
    const snap = await getDocs(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.closure));
    const idSet = new Set(recallIds);
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as RecallClosure))
      .filter((c) => idSet.has(c.recall_id));
  } catch {
    return [];
  }
}

export async function generateRecallTrend(filters: RecallTrendFilterInput) {
  const all = await listRecalls();
  const filtered = all.filter((r) => {
    const date = r.recall_date || r.created_at?.slice(0, 10);
    if (!date) return false;
    return date >= filters.review_period_from && date <= filters.review_period_to;
  });
  const closures = await loadAllClosures(filtered.map((r) => r.id));
  const analysis = computeRecallTrendAnalysis(all, filters, closures);

  if (analysis.alerts.some((a) => /recovery performance alert/i.test(a))) {
    await notify('Recall Recovery Trend Alert', analysis.alerts.find((a) => /recovery/i.test(a)) || 'Recovery trend decreasing', 'trend', ['qa', 'regulatory_affairs']);
  }

  const polished = await polishTrendDrafts({
    module: 'Recall',
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

export async function listSavedRecallTrends(max = 100): Promise<RecallTrendRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RECALL_COLLECTIONS.trends),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as RecallTrendRecord)).filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.trends));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RecallTrendRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, max);
    } catch {
      return [];
    }
  }
}

export async function getRecallTrendById(id: string): Promise<RecallTrendRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.trends, id));
    if (!snap.exists()) return null;
    const data = snap.data() as RecallTrendRecord;
    if (data.is_deleted) return null;
    return { id: snap.id, ...data };
  } catch {
    return null;
  }
}

export async function fetchRecallTrendProductOptions(): Promise<string[]> {
  const all = await listRecalls();
  return extractRecallProductOptions(all);
}

export async function fetchRecallTrendMarketOptions(): Promise<string[]> {
  const all = await listRecalls();
  return extractRecallMarketOptions(all);
}

export async function saveRecallTrend(
  filters: RecallTrendFilterInput,
  form: RecallTrendSaveForm,
  actor: RecallTrendActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const analysis = await generateRecallTrend(filters);
  if (analysis.filtered_count === 0) {
    return { error: 'At least one recall record is required to save a trend' };
  }
  const payload = mapRecallTrendToRecord({ ...filters, ...form }, analysis, actor);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.trends), payload);
    await audit(actor, 'trend generated', ref.id, `Trend ${payload.trend_id} saved`, payload);
    await notify('Recall Trend Saved', `Trend ${payload.trend_id} generated for PQR review`, ref.id, ['head_qa', 'qa']);
    return { id: ref.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to save trend record' };
  }
}

export async function approveRecallTrend(trendId: string, actor: RecallTrendActor): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const record = await getRecallTrendById(trendId);
  if (!record) return { error: 'Trend record not found' };
  if (record.approved_by) return { error: 'Trend already approved' };
  const now = nowIso();
  try {
    await updateDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.trends, trendId), {
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

export async function logRecallTrendExport(actor: RecallTrendActor, trendId?: string) {
  await audit(actor, 'export report', trendId || 'workspace', 'Recall trend report exported (placeholder)');
}

export async function logRecallTrendFilterApplied(actor: RecallTrendActor, filters: RecallTrendFilterInput) {
  await audit(actor, 'filter applied', 'workspace', 'Recall trend filters applied', filters);
}

export async function logRecallTrendRecommendationGenerated(actor: RecallTrendActor, recommendation: string) {
  await audit(actor, 'recommendation generated', 'workspace', 'Recommendation generated', { recommendation });
}

export function exportRecallTrendReportPlaceholder(
  analysis: RecallTrendAnalysisResult,
  filters: RecallTrendFilterInput,
) {
  if (!analysis || analysis.filtered_count === 0) return;
  downloadCsv(
    `recall-trend-${filters.review_period_from}-${filters.review_period_to}.csv`,
    ['Metric', 'Value'],
    [
      ['Review From', filters.review_period_from],
      ['Review To', filters.review_period_to],
      ['Total Recalls', String(analysis.metrics.total)],
      ['Open', String(analysis.metrics.open)],
      ['Closed', String(analysis.metrics.closed)],
      ['Class I', String(analysis.metrics.classI)],
      ['Avg Recovery %', String(analysis.metrics.avgRecoveryPercent)],
      ['CAPA Linked', String(analysis.metrics.capaLinkedCount)],
      ['Regulatory Notifications', String(analysis.metrics.regulatoryNotificationCount)],
      ['Avg Closure Days', String(analysis.metrics.avgClosureDays)],
      ['Trend Status', analysis.trend_status],
      ['Risk Level', analysis.risk_level],
    ],
  );
}

export async function getLatestRecallTrendForPqr(): Promise<RecallTrendRecord | null> {
  const trends = await listSavedRecallTrends(1);
  return trends[0] || null;
}

export async function getLatestRecallTrendSummary(): Promise<string> {
  const trends = await listSavedRecallTrends(1);
  if (!trends.length) return 'No saved recall trend analysis available.';
  const t = trends[0];
  return `Recall Trend (${t.review_period_from} to ${t.review_period_to}): ${t.trend_status} — ${t.conclusion.slice(0, 200)}`;
}
