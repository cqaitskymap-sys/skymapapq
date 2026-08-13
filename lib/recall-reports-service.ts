import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { listRecalls } from '@/lib/recall-service';
import {
  REPORTS_MODULE,
  computeRecallReportAnalytics,
  extractRecallReportMarketOptions,
  extractRecallReportProductOptions,
  generateRecallReportNumber,
  mapRecallReportToRecord,
  summarizeRecallReportsDashboard,
  type RecallReportActor,
  type RecallReportContext,
  type RecallReportFilterInput,
  type RecallReportFormData,
} from '@/lib/recall-reports-records';
import { polishQmsReportTexts } from '@/lib/ai/client';
import {
  RECALL_COLLECTIONS,
  type RecallClosure,
  type RecallDistribution,
  type RecallRecovery,
  type RecallRegulatoryNotification,
  type RecallReportRecord,
} from '@/lib/recall-types';

export type { RecallReportActor, RecallReportFilterInput, RecallReportFormData };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: RecallReportActor,
  actionType: string,
  recordId: string,
  detail?: string,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: REPORTS_MODULE,
      collectionName: RECALL_COLLECTIONS.reports,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      newValue: newVal,
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('recall report audit', e);
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

async function loadReportContext(): Promise<RecallReportContext & { records: Awaited<ReturnType<typeof listRecalls>> }> {
  const [records, distributions, recoveries, regulatoryNotifications, closures] = await Promise.all([
    listRecalls(),
    fetchCollectionAll<RecallDistribution>(RECALL_COLLECTIONS.distribution),
    fetchCollectionAll<RecallRecovery>(RECALL_COLLECTIONS.recovery),
    fetchCollectionAll<RecallRegulatoryNotification>(RECALL_COLLECTIONS.regulatoryNotifications),
    fetchCollectionAll<RecallClosure>(RECALL_COLLECTIONS.closure),
  ]);
  return { records, distributions, recoveries, regulatoryNotifications, closures };
}

export async function previewRecallReport(filters: RecallReportFilterInput, role?: string, userId?: string) {
  const ctx = await loadReportContext();
  return computeRecallReportAnalytics(
    ctx.records,
    filters,
    ctx,
    role,
    userId,
  );
}

export async function fetchRecallReportRecords(max = 100): Promise<RecallReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RECALL_COLLECTIONS.reports),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as RecallReportRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.reports), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RecallReportRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, max);
    } catch (e) {
      console.error('fetchRecallReportRecords', e);
      return [];
    }
  }
}

export async function getRecallReportById(id: string): Promise<RecallReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), RECALL_COLLECTIONS.reports, id));
    if (!snap.exists()) return null;
    const data = snap.data() as RecallReportRecord;
    if (data.is_deleted) return null;
    return { ...data, id: snap.id };
  } catch {
    return null;
  }
}

export async function generateRecallReport(
  form: RecallReportFormData,
  actor: RecallReportActor,
  existingCount = 0,
): Promise<{ record?: RecallReportRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: RecallReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    recall_number: form.recall_number,
    product: form.product,
    batch_number: form.batch_number,
    market_region: form.market_region,
    recall_type: form.recall_type,
    recall_classification: form.recall_classification,
    status: form.status,
    regulatory_notification_required: form.regulatory_notification_required,
    capa_required: form.capa_required,
  };
  const ctx = await loadReportContext();
  const analytics = computeRecallReportAnalytics(ctx.records, filters, ctx, actor.role, actor.id);
  const polished = await polishQmsReportTexts({
    module: 'Recall Reports',
    summary: analytics.summary,
    recommendations: analytics.recommendations,
    management_summary: analytics.managementReview.narrative,
    context: { reportType: form.report_type, metrics: analytics.metrics, filters },
  });
  const enrichedAnalytics = {
    ...analytics,
    summary: polished.summary,
    recommendations: polished.recommendations,
    managementReview: {
      ...analytics.managementReview,
      narrative: polished.management_summary || analytics.managementReview.narrative,
    },
  };
  const year = new Date(form.review_period_to).getFullYear();
  const reportNumber = generateRecallReportNumber(year, existingCount);
  const payload = mapRecallReportToRecord(form, enrichedAnalytics, actor, reportNumber);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), RECALL_COLLECTIONS.reports), payload);
    const record = { ...payload, id: ref.id };
    await audit(actor, 'report generated', ref.id, `${form.report_type} — ${reportNumber}`, payload);
    return { record };
  } catch (e) {
    console.error('generateRecallReport', e);
    return { error: 'Failed to save report' };
  }
}

export async function logRecallReportPreviewed(actor: RecallReportActor, reportType: string, count: number) {
  await audit(actor, 'report previewed', 'workspace', `${reportType}: ${count} record(s)`);
}

export async function logManagementReportViewed(actor: RecallReportActor) {
  await audit(actor, 'management report viewed', 'management-review', 'Management review tab accessed');
}

export async function exportRecallReport(
  report: RecallReportRecord,
  exportType: 'PDF' | 'Excel' | 'CSV',
  actor: RecallReportActor,
): Promise<{ fileUrl: string; error?: string }> {
  await audit(actor, `${exportType} export blocked`, report.id, `${report.report_number} — backend export is not configured`);
  throw new Error('Recall report export backend is not configured.');
}

export async function logRecallReportPrinted(actor: RecallReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'report printed', reportId, `Print — ${reportNumber}`);
}

export async function logRecallReportDownloaded(actor: RecallReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'report download blocked', reportId, `Backend export download unavailable — ${reportNumber}`);
}

export async function logRecallReportsModuleViewed(actor: RecallReportActor) {
  await audit(actor, 'module viewed', 'recall-reports', 'Recall Reports & Analytics module opened');
}

export async function fetchRecallReportProductOptions(): Promise<string[]> {
  const ctx = await loadReportContext();
  return extractRecallReportProductOptions(ctx.records);
}

export async function fetchRecallReportMarketOptions(): Promise<string[]> {
  const ctx = await loadReportContext();
  return extractRecallReportMarketOptions(ctx.records);
}

export async function fetchRecallDashboardAnalytics() {
  const ctx = await loadReportContext();
  const analytics = summarizeRecallReportsDashboard(ctx.records, ctx);
  return {
    metrics: analytics.metrics,
    charts: analytics.charts,
    managementReview: analytics.managementReview,
  };
}

export async function fetchRecallExportHistory(max = 50): Promise<RecallReportRecord[]> {
  const all = await fetchRecallReportRecords(max);
  return all.filter((r) => r.report_status === 'Exported' || Boolean(r.export_type));
}

export { computeRecallReportAnalytics, summarizeRecallReportsDashboard } from '@/lib/recall-reports-records';
