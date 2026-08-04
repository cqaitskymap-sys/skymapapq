import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  REPORTS_MODULE,
  computeReportAnalytics,
  generateReportNumber,
  mapReportToRecord,
  summarizeReportsDashboard,
  type DeviationReportFormData,
  type ReportActor,
  type ReportFilterInput,
} from '@/lib/deviation-reports-records';
import { DEVIATION_COLLECTIONS, type DeviationReportRecord } from '@/lib/deviation-types';
import { listDeviations } from '@/lib/deviation-service';
import { polishQmsReportTexts } from '@/lib/ai/client';

export type { ReportActor, ReportFilterInput, DeviationReportFormData };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: ReportActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: REPORTS_MODULE,
      collectionName: DEVIATION_COLLECTIONS.reports,
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
      collectionName: DEVIATION_COLLECTIONS.reports,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: REPORTS_MODULE,
    });
  } catch (e) {
    console.error('deviation report audit', e);
  }
}

export async function previewDeviationReport(filters: ReportFilterInput) {
  const all = await listDeviations();
  const analytics = computeReportAnalytics(all, filters);
  return analytics;
}

export async function fetchDeviationReportRecords(max = 100): Promise<DeviationReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.reports),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DeviationReportRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.reports),
        limit(max),
      ));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as DeviationReportRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch (e) {
      console.error('fetchDeviationReportRecords', e);
      return [];
    }
  }
}

export async function getDeviationReportById(id: string): Promise<DeviationReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.reports, id));
    if (!snap.exists()) {
      const all = await fetchDeviationReportRecords();
      return all.find((r) => r.id === id) ?? null;
    }
    return { id: snap.id, ...snap.data() } as DeviationReportRecord;
  } catch {
    const all = await fetchDeviationReportRecords();
    return all.find((r) => r.id === id) ?? null;
  }
}

export async function generateDeviationReport(
  form: DeviationReportFormData,
  actor: ReportActor,
  existingCount = 0,
): Promise<{ record?: DeviationReportRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: ReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    department: form.department,
    product: form.product,
    criticality: form.criticality,
    status: form.status,
  };
  const analytics = await previewDeviationReport(filters);
  const polished = await polishQmsReportTexts({
    module: 'Deviation Reports',
    summary: analytics.summary,
    recommendations: analytics.summary,
    management_summary: analytics.summary,
    context: { reportType: form.report_type, metrics: analytics.metrics, filters },
  });
  const enrichedAnalytics = {
    ...analytics,
    summary: polished.summary || polished.management_summary || analytics.summary,
  };
  const year = new Date(form.review_period_to).getFullYear();
  const reportNumber = generateReportNumber(year, existingCount);
  const payload = mapReportToRecord(form, enrichedAnalytics, actor, reportNumber);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), DEVIATION_COLLECTIONS.reports), payload);
    const record = { id: ref.id, ...payload };
    await audit(actor, 'report generated', ref.id, `${form.report_type} — ${reportNumber}`, undefined, payload);
    return { record };
  } catch (e) {
    console.error('generateDeviationReport', e);
    return { error: 'Failed to save report' };
  }
}

export async function logReportPreviewed(actor: ReportActor, reportType: string, count: number) {
  await audit(actor, 'report previewed', 'workspace', `${reportType}: ${count} record(s)`);
}

export async function exportDeviationReport(
  report: DeviationReportRecord,
  exportType: 'PDF' | 'Excel' | 'CSV',
  actor: ReportActor,
): Promise<{ fileUrl: string; error?: string }> {
  const placeholderUrl = `/api/exports/deviation-reports/${report.id}/${exportType.toLowerCase()}`;
  const fileName = `${report.report_number.replace(/\//g, '-')}.${exportType === 'Excel' ? 'xlsx' : exportType === 'PDF' ? 'pdf' : 'csv'}`;
  if (isFirebaseConfigured()) {
    try {
      await updateDoc(doc(getFirebaseFirestore(), DEVIATION_COLLECTIONS.reports, report.id), {
        export_type: exportType,
        file_url: placeholderUrl,
        file_name: fileName,
        report_status: 'Exported',
        updated_at: nowIso(),
      });
    } catch (e) {
      console.error('exportDeviationReport update', e);
    }
  }
  const action = exportType === 'PDF' ? 'exported PDF' : exportType === 'Excel' ? 'exported Excel' : 'exported CSV';
  await audit(actor, action, report.id, `${report.report_number} — ${exportType} placeholder`, undefined, { fileName, placeholderUrl });
  return { fileUrl: placeholderUrl };
}

export async function logReportDownloaded(actor: ReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'downloaded', reportId, `Download placeholder — ${reportNumber}`);
}

export async function fetchReportProductOptions(): Promise<string[]> {
  const all = await listDeviations();
  const set = new Set<string>();
  for (const r of all) {
    if (r.product_name) set.add(r.product_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchDashboardAnalytics() {
  const all = await listDeviations();
  const metrics = summarizeReportsDashboard(all);
  const year = new Date().getFullYear();
  const trendLike = computeReportAnalytics(all, {
    report_type: 'Deviation Register',
    review_period_from: `${year}-01-01`,
    review_period_to: `${year}-12-31`,
    department: 'All',
    product: 'All',
    criticality: 'All',
    status: 'All',
  });
  return { metrics, byStatus: trendLike.byStatus };
}
