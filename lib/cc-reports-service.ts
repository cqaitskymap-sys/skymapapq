import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  REPORTS_MODULE,
  computeCcReportAnalytics,
  extractCcReportOwnerOptions,
  extractCcReportProductOptions,
  generateCcReportNumber,
  mapCcReportToRecord,
  summarizeCcReportsDashboard,
  type CcReportActor,
  type CcReportFilterInput,
  type CcReportFormData,
} from '@/lib/cc-reports-records';
import {
  CC_COLLECTIONS,
  type CcReportRecord,
  type ChangeEffectivenessReview,
  type ChangeImplementationAction,
  type ChangeRiskAssessment,
} from '@/lib/change-control-types';
import { listAllRiskAssessments, listChanges } from '@/lib/change-control-service';
import { polishQmsReportTexts } from '@/lib/ai/client';

export type { CcReportActor, CcReportFilterInput, CcReportFormData };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: CcReportActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: REPORTS_MODULE,
      collectionName: CC_COLLECTIONS.reports,
      recordId,
      actionType,
      actionDescription: detail || actionType,
      reason: detail || '',
      oldValue: oldVal,
      newValue: newVal,
      user: { id: actor.id, name: actor.name, role: actor.role || '' },
      status: 'Success',
    });
  } catch (e) {
    console.error('cc report audit', e);
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
    await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.notifications), {
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
    console.error('cc report notify', e);
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
  const [records, risks, effectiveness, implementation] = await Promise.all([
    listChanges(),
    listAllRiskAssessments(),
    fetchCollectionAll<ChangeEffectivenessReview>(CC_COLLECTIONS.effectiveness),
    fetchCollectionAll<ChangeImplementationAction>(CC_COLLECTIONS.implementation),
  ]);
  return { records, risks, effectiveness, implementation };
}

export async function previewCcReport(filters: CcReportFilterInput) {
  const ctx = await loadReportContext();
  return computeCcReportAnalytics(
    ctx.records,
    filters,
    ctx.risks,
    ctx.effectiveness,
    ctx.implementation,
  );
}

export async function fetchCcReportRecords(max = 100): Promise<CcReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CC_COLLECTIONS.reports),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as CcReportRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), CC_COLLECTIONS.reports), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as CcReportRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, max);
    } catch (e) {
      console.error('fetchCcReportRecords', e);
      return [];
    }
  }
}

export async function getCcReportById(id: string): Promise<CcReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), CC_COLLECTIONS.reports, id));
    if (!snap.exists()) return null;
    const data = snap.data();
    if ((data as CcReportRecord).is_deleted) return null;
    return { id: snap.id, ...data } as CcReportRecord;
  } catch {
    return null;
  }
}

export async function generateCcReport(
  form: CcReportFormData,
  actor: CcReportActor,
  existingCount = 0,
): Promise<{ record?: CcReportRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: CcReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    change_number: form.change_number,
    department: form.department,
    product: form.product,
    change_type: form.change_type,
    category: form.category,
    priority: form.priority,
    status: form.status,
    validation_impact: form.validation_impact,
    csv_impact: form.csv_impact,
    training_impact: form.training_impact,
    regulatory_impact: form.regulatory_impact,
    owner: form.owner,
  };
  const analytics = await previewCcReport(filters);
  const polished = await polishQmsReportTexts({
    module: 'Change Control Reports',
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
  const reportNumber = generateCcReportNumber(year, existingCount);
  const payload = mapCcReportToRecord(form, enrichedAnalytics, actor, reportNumber);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.reports), payload);
    const record = { id: ref.id, ...payload };
    await audit(actor, 'report generated', ref.id, `${form.report_type} — ${reportNumber}`, undefined, payload);
    if (form.report_type === 'Management Review Report') {
      await notify('Change Control Management Review', `Report ${reportNumber} generated`, ref.id, undefined, 'head_qa');
    }
    await notify('Change Control Report Generated', `${form.report_type} — ${reportNumber}`, ref.id, actor.id);
    return { record };
  } catch (e) {
    console.error('generateCcReport', e);
    return { error: 'Failed to save report' };
  }
}

export async function scheduleCcReport(
  form: CcReportFormData,
  actor: CcReportActor,
  frequency: string,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: CcReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    department: form.department,
    product: form.product,
    change_type: form.change_type,
    category: form.category,
    priority: form.priority,
    status: form.status,
    validation_impact: form.validation_impact,
    csv_impact: form.csv_impact,
    training_impact: form.training_impact,
    regulatory_impact: form.regulatory_impact,
    owner: form.owner,
  };
  const analytics = await previewCcReport(filters);
  const payload = mapCcReportToRecord(form, analytics, actor, generateCcReportNumber(new Date().getFullYear(), 0));
  const nextRun = new Date();
  if (frequency === 'weekly') nextRun.setDate(nextRun.getDate() + 7);
  else if (frequency === 'monthly') nextRun.setMonth(nextRun.getMonth() + 1);
  else nextRun.setDate(nextRun.getDate() + 1);

  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), CC_COLLECTIONS.reports), {
      ...payload,
      report_status: 'Scheduled',
      scheduled: true,
      schedule_frequency: frequency,
      schedule_next_run: nextRun.toISOString().split('T')[0],
    });
    await audit(actor, 'report scheduled', ref.id, `${form.report_type} — ${frequency}`, undefined, { frequency });
    await notify('Scheduled Change Control Report', `${form.report_type} scheduled (${frequency})`, ref.id, actor.id);
    return { id: ref.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to schedule report' };
  }
}

export async function logCcReportPreviewed(actor: CcReportActor, reportType: string, count: number) {
  await audit(actor, 'report previewed', 'workspace', `${reportType}: ${count} record(s)`);
}

export async function logManagementReportViewed(actor: CcReportActor) {
  await audit(actor, 'management report viewed', 'management-review', 'Management review tab accessed');
}

export async function exportCcReport(
  report: CcReportRecord,
  exportType: 'PDF' | 'Excel' | 'CSV',
  actor: CcReportActor,
): Promise<{ fileUrl: string; error?: string }> {
  await audit(actor, `${exportType} export blocked`, report.id, `${report.report_number} — backend export is not configured`);
  throw new Error('Change control report export backend is not configured.');
}

export async function logCcReportPrinted(actor: CcReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'report printed', reportId, `Print — ${reportNumber}`);
}

export async function logCcReportDownloaded(actor: CcReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'report download blocked', reportId, `Backend export download unavailable — ${reportNumber}`);
}

export async function fetchCcReportProductOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  return extractCcReportProductOptions(records);
}

export async function fetchCcReportOwnerOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  return extractCcReportOwnerOptions(records);
}

export async function fetchCcDashboardAnalytics() {
  const ctx = await loadReportContext();
  const analytics = summarizeCcReportsDashboard(ctx.records, ctx.risks, ctx.effectiveness);
  return {
    metrics: analytics.metrics,
    charts: analytics.charts,
    managementReview: analytics.managementReview,
  };
}

export async function fetchCcExportHistory(max = 50): Promise<CcReportRecord[]> {
  const all = await fetchCcReportRecords(max);
  return all.filter((r) => r.report_status === 'Exported' || Boolean(r.export_type));
}

export { computeCcReportAnalytics, summarizeCcReportsDashboard } from '@/lib/cc-reports-records';
