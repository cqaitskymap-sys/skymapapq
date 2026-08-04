import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  computeOosTrendAnalysis,
  mapOosTrendToRecord,
  TREND_MODULE,
  type OosTrendActor,
  type OosTrendFilterInput,
  type OosTrendSaveForm,
} from '@/lib/oos-trend-records';
import {
  OOS_COLLECTIONS,
  type OosImpactAssessment,
  type OosPhase1,
  type OosPhase2,
  type OosTrendRecord,
} from '@/lib/oos-types';
import { polishTrendDrafts } from '@/lib/ai/client';
import { listOosRecords } from '@/lib/oos-service';

export type { OosTrendActor, OosTrendFilterInput, OosTrendSaveForm };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: OosTrendActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: TREND_MODULE,
      collectionName: OOS_COLLECTIONS.trends,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      oldValue: oldVal,
      newValue: newVal,
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: OOS_COLLECTIONS.trends,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: TREND_MODULE,
    });
  } catch (e) {
    console.error('oos trend audit', e);
  }
}

async function notifyRole(title: string, message: string, recordId: string, roles: string[]) {
  if (!isFirebaseConfigured()) return;
  for (const role of roles) {
    try {
      await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.notifications), {
        title, message, module: 'OOS Trend Analysis', record_id: recordId, target_role: role, read: false, created_at: nowIso(),
      });
    } catch (e) {
      console.error('oos trend notify', e);
    }
  }
}

async function fetchCollectionAll<T>(collectionName: string, max = 500): Promise<T[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), collectionName), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
  } catch (e) {
    console.error(`fetchCollectionAll ${collectionName}`, e);
    return [];
  }
}

async function loadTrendContext() {
  const [records, phase1List, phase2List, impactList] = await Promise.all([
    listOosRecords(),
    fetchCollectionAll<OosPhase1>(OOS_COLLECTIONS.phase1),
    fetchCollectionAll<OosPhase2>(OOS_COLLECTIONS.phase2),
    fetchCollectionAll<OosImpactAssessment>(OOS_COLLECTIONS.impactAssessments),
  ]);
  return { records, phase1List, phase2List, impactList };
}

export async function generateOosTrend(filters: OosTrendFilterInput) {
  const ctx = await loadTrendContext();
  const analysis = computeOosTrendAnalysis(ctx.records, ctx.phase1List, ctx.phase2List, ctx.impactList, filters);
  const polished = await polishTrendDrafts({
    module: 'OOS',
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

export async function listSavedOosTrends(max = 100): Promise<OosTrendRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.trends),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as OosTrendRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.trends), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as OosTrendRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch (e) {
      console.error('listSavedOosTrends', e);
      return [];
    }
  }
}

export async function getOosTrendById(id: string): Promise<OosTrendRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.trends, id));
    if (!snap.exists()) {
      const all = await listSavedOosTrends();
      return all.find((r) => r.id === id) ?? null;
    }
    return { id: snap.id, ...snap.data() } as OosTrendRecord;
  } catch {
    const all = await listSavedOosTrends();
    return all.find((r) => r.id === id) ?? null;
  }
}

export async function saveOosTrend(
  filters: OosTrendFilterInput,
  form: OosTrendSaveForm,
  actor: OosTrendActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) {
    return { error: 'Firebase is not configured' };
  }
  const analysis = await generateOosTrend(filters);
  if (analysis.filtered_count === 0) {
    return { error: 'At least one OOS record is required for a meaningful trend' };
  }
  const payload = mapOosTrendToRecord({ ...filters, ...form }, analysis, actor);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.trends), payload);
    await audit(actor, 'trend generated', ref.id, `Trend ${payload.trend_id} saved`, undefined, payload);
    await notifyRole(
      'OOS Trend Saved',
      `Trend ${payload.trend_id} for ${filters.review_period_from} to ${filters.review_period_to}`,
      ref.id,
      ['qa_manager', 'head_qa'],
    );
    return { id: ref.id };
  } catch (e) {
    console.error('saveOosTrend', e);
    return { error: 'Failed to save trend record' };
  }
}

export async function approveOosTrend(
  trendId: string,
  actor: OosTrendActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const record = await getOosTrendById(trendId);
  if (!record) return { error: 'Trend record not found' };
  if (record.approved_by) return { error: 'Trend already approved' };
  const now = nowIso();
  try {
    await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.trends, trendId), {
      approved_by: actor.id,
      approved_by_name: actor.name,
      approved_date: now.split('T')[0],
      updated_at: now,
    });
    await audit(actor, 'trend approved', trendId, `Trend ${record.trend_id} approved by Head QA`, record, {
      approved_by: actor.id,
      approved_date: now,
    });
    await notifyRole('OOS Trend Approved', record.trend_id, trendId, ['qa_manager', 'qc_manager']);
    return {};
  } catch (e) {
    console.error('approveOosTrend', e);
    return { error: 'Failed to approve trend' };
  }
}

export async function logOosTrendFilterApplied(actor: OosTrendActor, filters: OosTrendFilterInput) {
  await audit(actor, 'filter applied', 'workspace', `Filters: ${filters.review_period_from} to ${filters.review_period_to}`, undefined, filters);
}

export async function logOosTrendRecommendationGenerated(actor: OosTrendActor, trendId: string, text: string) {
  await audit(actor, 'recommendation generated', trendId, text.slice(0, 200));
}

export async function logOosTrendExport(actor: OosTrendActor, trendId: string, format = 'report') {
  await audit(actor, 'export trend report', trendId, `Export placeholder (${format})`);
}

export async function fetchOosTrendProductOptions(): Promise<string[]> {
  const { records } = await loadTrendContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.product_name) set.add(r.product_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchOosTrendDepartmentOptions(): Promise<string[]> {
  const { records } = await loadTrendContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.department) set.add(r.department);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchOosTrendTestOptions(): Promise<string[]> {
  const { records } = await loadTrendContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.test_name) set.add(r.test_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchOosTrendParameterOptions(): Promise<string[]> {
  const { records } = await loadTrendContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.parameter_name) set.add(r.parameter_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export { computeOosTrendAnalysis };
