import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { fetchRiskAssessmentRecords } from '@/lib/cpv-risk-assessment-service';
import {
  REPORTS_MODULE,
  RISK_REPORTS_COLLECTION,
  computeRiskReportAnalytics,
  extractRiskOwnerOptions,
  extractRiskProductOptions,
  generateRiskReportNumber,
  mapRiskReportToRecord,
  summarizeRiskReportsDashboard,
  type RiskReportActor,
  type RiskReportFilterInput,
  type RiskReportFormData,
  type RiskReportRecord,
} from '@/lib/risk-reports-records';

export type { RiskReportActor, RiskReportFilterInput, RiskReportFormData, RiskReportRecord };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: RiskReportActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: REPORTS_MODULE,
      collectionName: RISK_REPORTS_COLLECTION,
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
      collectionName: RISK_REPORTS_COLLECTION,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: REPORTS_MODULE,
    });
  } catch (e) {
    console.error('risk report audit', e);
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
    await addDoc(collection(getFirebaseFirestore(), 'notifications'), {
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
    console.error('risk report notify', e);
  }
}

export async function previewRiskReport(filters: RiskReportFilterInput) {
  const records = await fetchRiskAssessmentRecords(1000);
  return computeRiskReportAnalytics(records.filter((r) => !r.isDeleted), filters);
}

export async function fetchRiskReportRecords(max = 100): Promise<RiskReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), RISK_REPORTS_COLLECTION),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as RiskReportRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), RISK_REPORTS_COLLECTION), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RiskReportRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, max);
    } catch (e) {
      console.error('fetchRiskReportRecords', e);
      return [];
    }
  }
}

export async function getRiskReportById(id: string): Promise<RiskReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), RISK_REPORTS_COLLECTION, id));
    if (!snap.exists()) return null;
    const data = snap.data() as RiskReportRecord;
    if (data.is_deleted) return null;
    return { id: snap.id, ...data };
  } catch {
    return null;
  }
}

export async function generateRiskReport(
  form: RiskReportFormData,
  actor: RiskReportActor,
  existingCount = 0,
): Promise<{ record?: RiskReportRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: RiskReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    risk_number: form.risk_number,
    department: form.department,
    product: form.product,
    risk_category: form.risk_category,
    risk_level: form.risk_level,
    risk_owner: form.risk_owner,
    status: form.status,
    mitigation_status: form.mitigation_status,
    review_status: form.review_status,
  };
  const analytics = await previewRiskReport(filters);
  const year = new Date(form.review_period_to).getFullYear();
  const reportNumber = generateRiskReportNumber(year, existingCount);
  const payload = mapRiskReportToRecord(form, analytics, actor, reportNumber);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), RISK_REPORTS_COLLECTION), payload);
    const record = { id: ref.id, ...payload };
    await audit(actor, 'report generated', ref.id, `${form.report_type} — ${reportNumber}`, undefined, payload);
    if (form.report_type === 'Management Review Report') {
      await notify('Risk Management Review Report', `Report ${reportNumber} generated`, ref.id, undefined, 'head_qa');
    }
    return { record };
  } catch (e) {
    console.error('generateRiskReport', e);
    return { error: 'Failed to save report' };
  }
}

export async function scheduleRiskReport(
  form: RiskReportFormData,
  actor: RiskReportActor,
  frequency: string,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: RiskReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    department: form.department,
    product: form.product,
    risk_category: form.risk_category,
    risk_level: form.risk_level,
    risk_owner: form.risk_owner,
    status: form.status,
    mitigation_status: form.mitigation_status,
    review_status: form.review_status,
  };
  const analytics = await previewRiskReport(filters);
  const payload = mapRiskReportToRecord(form, analytics, actor, generateRiskReportNumber(new Date().getFullYear(), 0));
  const nextRun = new Date();
  if (frequency === 'weekly') nextRun.setDate(nextRun.getDate() + 7);
  else if (frequency === 'monthly') nextRun.setMonth(nextRun.getMonth() + 1);
  else nextRun.setDate(nextRun.getDate() + 1);

  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), RISK_REPORTS_COLLECTION), {
      ...payload,
      report_status: 'Scheduled',
      scheduled: true,
      schedule_frequency: frequency,
      schedule_next_run: nextRun.toISOString().split('T')[0],
    });
    await audit(actor, 'report scheduled', ref.id, `${form.report_type} — ${frequency}`, undefined, { frequency });
    await notify('Scheduled Risk Report', `${form.report_type} scheduled (${frequency})`, ref.id, actor.id);
    return { id: ref.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Failed to schedule report' };
  }
}

export async function softDeleteRiskReport(id: string, actor: RiskReportActor): Promise<void> {
  if (!isFirebaseConfigured()) return;
  try {
    await updateDoc(doc(getFirebaseFirestore(), RISK_REPORTS_COLLECTION, id), {
      is_deleted: true,
      updated_at: nowIso(),
    });
    await audit(actor, 'report soft deleted', id, 'Soft delete only');
  } catch (e) {
    console.error('softDeleteRiskReport', e);
  }
}

export async function logRiskReportPreviewed(actor: RiskReportActor, reportType: string, count: number) {
  await audit(actor, 'report previewed', 'workspace', `${reportType}: ${count} record(s)`);
}

export async function logManagementReportViewed(actor: RiskReportActor) {
  await audit(actor, 'management report viewed', 'management-review', 'Management review tab accessed');
}

export async function exportRiskReport(
  report: RiskReportRecord,
  exportType: 'PDF' | 'Excel' | 'CSV',
  actor: RiskReportActor,
): Promise<{ fileUrl: string; error?: string }> {
  await audit(actor, `${exportType} export blocked`, report.id || report.report_id, `${report.report_number} — backend export is not configured`);
  throw new Error('Risk report export backend is not configured.');
}

export async function logRiskReportPrinted(actor: RiskReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'report printed', reportId, `Print — ${reportNumber}`);
}

export async function fetchRiskReportProductOptions(): Promise<string[]> {
  const records = await fetchRiskAssessmentRecords(500);
  return extractRiskProductOptions(records.filter((r) => !r.isDeleted));
}

export async function fetchRiskReportOwnerOptions(): Promise<string[]> {
  const records = await fetchRiskAssessmentRecords(500);
  return extractRiskOwnerOptions(records.filter((r) => !r.isDeleted));
}

export async function fetchRiskDashboardAnalytics() {
  const records = await fetchRiskAssessmentRecords(1000);
  const active = records.filter((r) => !r.isDeleted);
  return summarizeRiskReportsDashboard(active);
}

export async function fetchRiskExportHistory(max = 50): Promise<RiskReportRecord[]> {
  const all = await fetchRiskReportRecords(max);
  return all.filter((r) => r.report_status === 'Exported' || Boolean(r.export_type));
}

export function openRiskReportPdfHtml(
  report: RiskReportRecord,
  generatedBy: string,
  filterSummary?: string,
): void {
  void report;
  void generatedBy;
  void filterSummary;
  throw new Error('Risk report PDF export backend is not configured.');
}

export { computeRiskReportAnalytics, summarizeRiskReportsDashboard } from '@/lib/risk-reports-records';
