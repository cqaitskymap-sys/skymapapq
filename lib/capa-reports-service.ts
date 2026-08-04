import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { listCapas } from '@/lib/capa-service';
import {
  REPORTS_MODULE,
  computeCapaReportAnalytics,
  extractCapaReportOwnerOptions,
  extractCapaReportProductOptions,
  generateCapaReportNumber,
  mapCapaReportToRecord,
  summarizeCapaReportsDashboard,
  type CapaReportActor,
  type CapaReportFilterInput,
  type CapaReportFormData,
} from '@/lib/capa-reports-records';
import {
  CAPA_COLLECTIONS,
  type CapaCorrectiveAction,
  type CapaPreventiveAction,
  type CapaReportRecord,
} from '@/lib/capa-types';
import { polishQmsReportTexts } from '@/lib/ai/client';

export type { CapaReportActor, CapaReportFilterInput, CapaReportFormData };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: CapaReportActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: REPORTS_MODULE,
      collectionName: CAPA_COLLECTIONS.reports,
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
      collectionName: CAPA_COLLECTIONS.reports,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: REPORTS_MODULE,
    });
  } catch (e) {
    console.error('capa report audit', e);
  }
}

async function notify(
  title: string,
  message: string,
  recordId: string,
  userId?: string,
  targetRole?: string,
) {
  if (!isFirebaseConfigured()) return;
  try {
    await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.notifications), {
      title,
      message,
      module: REPORTS_MODULE,
      record_id: recordId,
      ...(userId ? { user_id: userId } : {}),
      ...(targetRole ? { target_role: targetRole } : {}),
      read: false,
      created_at: nowIso(),
    });
  } catch (e) {
    console.error('capa report notify', e);
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

async function loadReportContext() {
  const [records, correctiveActions, preventiveActions] = await Promise.all([
    listCapas(),
    fetchCollectionAll<CapaCorrectiveAction>(CAPA_COLLECTIONS.correctiveActions),
    fetchCollectionAll<CapaPreventiveAction>(CAPA_COLLECTIONS.preventiveActions),
  ]);
  return { records, correctiveActions, preventiveActions };
}

export async function previewCapaReport(filters: CapaReportFilterInput) {
  const ctx = await loadReportContext();
  return computeCapaReportAnalytics(
    ctx.records,
    filters,
    ctx.correctiveActions,
    ctx.preventiveActions,
  );
}

export async function fetchCapaReportRecords(max = 100): Promise<CapaReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CAPA_COLLECTIONS.reports),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as CapaReportRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.reports), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as CapaReportRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, max);
    } catch (e) {
      console.error('fetchCapaReportRecords', e);
      return [];
    }
  }
}

export async function getCapaReportById(id: string): Promise<CapaReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.reports, id));
    if (!snap.exists()) return null;
    const data = snap.data();
    if ((data as CapaReportRecord).is_deleted) return null;
    return { id: snap.id, ...data } as CapaReportRecord;
  } catch {
    return null;
  }
}

export async function generateCapaReport(
  form: CapaReportFormData,
  actor: CapaReportActor,
  existingCount = 0,
): Promise<{ record?: CapaReportRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: CapaReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    capa_number: form.capa_number,
    department: form.department,
    product: form.product,
    capa_source: form.capa_source,
    priority: form.priority,
    status: form.status,
    effectiveness_result: form.effectiveness_result,
    owner: form.owner,
    overdue_only: form.overdue_only,
    critical_only: form.critical_only,
  };
  const analytics = await previewCapaReport(filters);
  const polished = await polishQmsReportTexts({
    module: 'CAPA Reports',
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
  const reportNumber = generateCapaReportNumber(year, existingCount);
  const payload = mapCapaReportToRecord(form, enrichedAnalytics, actor, reportNumber);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.reports), payload);
    const record = { id: ref.id, ...payload };
    await audit(actor, 'report generated', ref.id, `${form.report_type} — ${reportNumber}`, undefined, payload);
    if (form.report_type === 'Management Review Report') {
      await notify('CAPA Management Review Report', `Report ${reportNumber} generated`, ref.id, undefined, 'head_qa');
    }
    return { record };
  } catch (e) {
    console.error('generateCapaReport', e);
    return { error: 'Failed to save report' };
  }
}

export async function scheduleCapaReport(
  form: CapaReportFormData,
  actor: CapaReportActor,
  frequency: string,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: CapaReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    department: form.department,
    product: form.product,
    capa_source: form.capa_source,
    priority: form.priority,
    status: form.status,
    effectiveness_result: form.effectiveness_result,
    owner: form.owner,
    overdue_only: form.overdue_only,
    critical_only: form.critical_only,
  };
  const analytics = await previewCapaReport(filters);
  const payload = mapCapaReportToRecord(form, analytics, actor, generateCapaReportNumber(new Date().getFullYear(), 0));
  const nextRun = new Date();
  if (frequency === 'weekly') nextRun.setDate(nextRun.getDate() + 7);
  else if (frequency === 'monthly') nextRun.setMonth(nextRun.getMonth() + 1);
  else nextRun.setDate(nextRun.getDate() + 1);

  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), CAPA_COLLECTIONS.reports), {
      ...payload,
      report_status: 'Scheduled',
      scheduled: true,
      schedule_frequency: frequency,
      schedule_next_run: nextRun.toISOString().split('T')[0],
    });
    await audit(actor, 'report scheduled', ref.id, `${form.report_type} — ${frequency}`, undefined, { frequency });
    await notify('Scheduled CAPA Report', `${form.report_type} scheduled (${frequency})`, ref.id, actor.id);
    return { id: ref.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to schedule report' };
  }
}

export async function logCapaReportPreviewed(actor: CapaReportActor, reportType: string, count: number) {
  await audit(actor, 'report previewed', 'workspace', `${reportType}: ${count} record(s)`);
}

export async function logManagementReportViewed(actor: CapaReportActor) {
  await audit(actor, 'management report viewed', 'management-review', 'Management review tab accessed');
}

export async function exportCapaReport(
  report: CapaReportRecord,
  exportType: 'PDF' | 'Excel' | 'CSV',
  actor: CapaReportActor,
): Promise<{ fileUrl: string; error?: string }> {
  const placeholderUrl = `/api/exports/capa-reports/${report.id}/${exportType.toLowerCase()}`;
  const fileName = `${report.report_number.replace(/\//g, '-')}.${exportType === 'Excel' ? 'xlsx' : exportType === 'PDF' ? 'pdf' : 'csv'}`;
  if (isFirebaseConfigured()) {
    try {
      await updateDoc(doc(getFirebaseFirestore(), CAPA_COLLECTIONS.reports, report.id), {
        export_type: exportType,
        file_url: placeholderUrl,
        file_name: fileName,
        report_status: 'Exported',
        updated_at: nowIso(),
      });
    } catch (e) {
      console.error('exportCapaReport update', e);
    }
  }
  const actionMap = {
    PDF: 'PDF exported',
    Excel: 'Excel exported',
    CSV: 'CSV exported',
  } as const;
  await audit(actor, actionMap[exportType], report.id, `${report.report_number} — ${exportType} placeholder`, undefined, { fileName, placeholderUrl });
  return { fileUrl: placeholderUrl };
}

export async function logCapaReportPrinted(actor: CapaReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'report printed', reportId, `Print — ${reportNumber}`);
}

export async function logCapaReportDownloaded(actor: CapaReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'report exported', reportId, `Download placeholder — ${reportNumber}`);
}

export async function fetchCapaReportProductOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  return extractCapaReportProductOptions(records);
}

export async function fetchCapaReportOwnerOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  return extractCapaReportOwnerOptions(records);
}

export async function fetchCapaDashboardAnalytics() {
  const ctx = await loadReportContext();
  const analytics = summarizeCapaReportsDashboard(ctx.records);
  return {
    metrics: analytics.metrics,
    charts: analytics.charts,
    managementReview: analytics.managementReview,
  };
}

export async function fetchCapaExportHistory(max = 50): Promise<CapaReportRecord[]> {
  const all = await fetchCapaReportRecords(max);
  return all.filter((r) => r.report_status === 'Exported' || Boolean(r.export_type));
}

export { computeCapaReportAnalytics, summarizeCapaReportsDashboard } from '@/lib/capa-reports-records';
