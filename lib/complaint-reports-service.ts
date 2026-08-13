import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  COMPLAINT_REPORTS_MODULE,
  computeComplaintReportAnalytics,
  generateComplaintReportNumber,
  mapComplaintReportToRecord,
  summarizeComplaintReportsDashboard,
  type ComplaintReportActor,
  type ComplaintReportFilterInput,
  type ComplaintReportFormData,
} from '@/lib/complaint-reports-records';
import { COMPLAINT_COLLECTIONS, type ComplaintReportRecord } from '@/lib/complaint-types';
import { listComplaints } from '@/lib/complaint-service';
import { polishQmsReportTexts } from '@/lib/ai/client';

export type { ComplaintReportActor, ComplaintReportFilterInput, ComplaintReportFormData };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: ComplaintReportActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: COMPLAINT_REPORTS_MODULE,
      collectionName: COMPLAINT_COLLECTIONS.reports,
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
      collectionName: COMPLAINT_COLLECTIONS.reports,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: COMPLAINT_REPORTS_MODULE,
    });
  } catch (e) {
    console.error('complaint report audit', e);
  }
}

export async function previewComplaintReport(filters: ComplaintReportFilterInput) {
  const all = await listComplaints();
  return computeComplaintReportAnalytics(all, filters);
}

export async function fetchComplaintReportRecords(max = 100): Promise<ComplaintReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.reports),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as ComplaintReportRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.reports),
        limit(max),
      ));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as ComplaintReportRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch (e) {
      console.error('fetchComplaintReportRecords', e);
      return [];
    }
  }
}

export async function getComplaintReportById(id: string): Promise<ComplaintReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.reports, id));
    if (!snap.exists()) {
      const all = await fetchComplaintReportRecords();
      return all.find((r) => r.id === id) ?? null;
    }
    return { id: snap.id, ...snap.data() } as ComplaintReportRecord;
  } catch {
    const all = await fetchComplaintReportRecords();
    return all.find((r) => r.id === id) ?? null;
  }
}

export async function generateComplaintReport(
  form: ComplaintReportFormData,
  actor: ComplaintReportActor,
  existingCount = 0,
): Promise<{ record?: ComplaintReportRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: ComplaintReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    complaint_number: form.complaint_number,
    product: form.product,
    batch_number: form.batch_number,
    market_region: form.market_region,
    customer_name: form.customer_name,
    complaint_category: form.complaint_category,
    criticality: form.criticality,
    status: form.status,
    capa_required: form.capa_required,
    recall_required: form.recall_required,
  };
  const analytics = await previewComplaintReport(filters);
  const polished = await polishQmsReportTexts({
    module: 'Complaint Reports',
    summary: analytics.summary,
    recommendations: analytics.capa_summary,
    management_summary: analytics.management_summary,
    context: {
      reportType: form.report_type,
      metrics: analytics.metrics,
      investigation_summary: analytics.investigation_summary,
      recall_summary: analytics.recall_summary,
      filters,
    },
  });
  const enrichedAnalytics = {
    ...analytics,
    summary: polished.summary,
    capa_summary: polished.recommendations || analytics.capa_summary,
    management_summary: polished.management_summary || analytics.management_summary,
  };
  const year = new Date(form.review_period_to).getFullYear();
  const reportNumber = generateComplaintReportNumber(year, existingCount);
  const payload = mapComplaintReportToRecord(form, enrichedAnalytics, actor, reportNumber);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), COMPLAINT_COLLECTIONS.reports), payload);
    const record = { id: ref.id, ...payload };
    await audit(actor, 'Complaint Report Generated', ref.id, `${form.report_type} — ${reportNumber}`, undefined, payload);
    return { record };
  } catch (e) {
    console.error('generateComplaintReport', e);
    return { error: 'Failed to save report' };
  }
}

export async function logComplaintReportPreviewed(actor: ComplaintReportActor, reportType: string, count: number) {
  await audit(actor, 'Complaint Report Previewed', 'workspace', `${reportType}: ${count} record(s)`);
}

export async function exportComplaintReport(
  report: ComplaintReportRecord,
  exportType: 'PDF' | 'Excel' | 'CSV',
  actor: ComplaintReportActor,
): Promise<{ fileUrl: string; error?: string }> {
  await audit(actor, `${exportType} Export Blocked`, report.id, `${report.report_number} — backend export is not configured`);
  throw new Error('Complaint report export backend is not configured.');
}

export async function logComplaintReportDownloaded(actor: ComplaintReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'Complaint Report Download Blocked', reportId, `Backend export download unavailable — ${reportNumber}`);
}

export async function fetchComplaintReportProductOptions(): Promise<string[]> {
  const all = await listComplaints();
  const set = new Set<string>();
  for (const r of all) {
    if (r.product_name) set.add(r.product_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchComplaintReportMarketOptions(): Promise<string[]> {
  const all = await listComplaints();
  const set = new Set<string>();
  for (const r of all) {
    if (r.market_region) set.add(r.market_region);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchComplaintReportsDashboard() {
  const all = await listComplaints();
  return summarizeComplaintReportsDashboard(all);
}

export { computeComplaintReportAnalytics };
