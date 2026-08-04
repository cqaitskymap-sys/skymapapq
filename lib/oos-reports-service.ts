import {
  addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, updateDoc,
} from 'firebase/firestore';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  REPORTS_MODULE,
  computeOosReportAnalytics,
  generateOosReportNumber,
  mapOosReportToRecord,
  summarizeOosReportsDashboard,
  type OosReportActor,
  type OosReportFilterInput,
  type OosReportFormData,
} from '@/lib/oos-reports-records';
import {
  OOS_COLLECTIONS,
  type OosImpactAssessment,
  type OosPhase1,
  type OosPhase2,
  type OosReportRecord,
} from '@/lib/oos-types';
import { listOosRecords } from '@/lib/oos-service';
import { polishQmsReportTexts } from '@/lib/ai/client';

export type { OosReportActor, OosReportFilterInput, OosReportFormData };

const nowIso = () => new Date().toISOString();

async function audit(
  actor: OosReportActor,
  actionType: string,
  recordId: string,
  detail?: string,
  oldVal?: unknown,
  newVal?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: REPORTS_MODULE,
      collectionName: OOS_COLLECTIONS.reports,
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
      collectionName: OOS_COLLECTIONS.reports,
      documentId: recordId,
      action: actionType,
      oldValue: oldVal,
      newValue: newVal,
      userId: actor.id,
      userName: actor.name,
      moduleName: REPORTS_MODULE,
    });
  } catch (e) {
    console.error('oos report audit', e);
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
  const [records, phase1List, phase2List, impactList] = await Promise.all([
    listOosRecords(),
    fetchCollectionAll<OosPhase1>(OOS_COLLECTIONS.phase1),
    fetchCollectionAll<OosPhase2>(OOS_COLLECTIONS.phase2),
    fetchCollectionAll<OosImpactAssessment>(OOS_COLLECTIONS.impactAssessments),
  ]);
  return { records, phase1List, phase2List, impactList };
}

export async function previewOosReport(filters: OosReportFilterInput) {
  const ctx = await loadReportContext();
  return computeOosReportAnalytics(ctx.records, ctx.phase1List, ctx.phase2List, ctx.impactList, filters);
}

export async function fetchOosReportRecords(max = 100): Promise<OosReportRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), OOS_COLLECTIONS.reports),
      orderBy('created_at', 'desc'),
      limit(max),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as OosReportRecord))
      .filter((r) => !r.is_deleted);
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), OOS_COLLECTIONS.reports), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as OosReportRecord))
        .filter((r) => !r.is_deleted)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    } catch (e) {
      console.error('fetchOosReportRecords', e);
      return [];
    }
  }
}

export async function getOosReportById(id: string): Promise<OosReportRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.reports, id));
    if (!snap.exists()) {
      const all = await fetchOosReportRecords();
      return all.find((r) => r.id === id) ?? null;
    }
    return { id: snap.id, ...snap.data() } as OosReportRecord;
  } catch {
    const all = await fetchOosReportRecords();
    return all.find((r) => r.id === id) ?? null;
  }
}

export async function generateOosReport(
  form: OosReportFormData,
  actor: OosReportActor,
  existingCount = 0,
): Promise<{ record?: OosReportRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured' };
  const filters: OosReportFilterInput = {
    report_type: form.report_type,
    review_period_from: form.review_period_from,
    review_period_to: form.review_period_to,
    department: form.department,
    product: form.product,
    batch_number: form.batch_number,
    test_name: form.test_name,
    status: form.status,
    root_cause_category: form.root_cause_category,
  };
  const analytics = await previewOosReport(filters);
  const polished = await polishQmsReportTexts({
    module: 'OOS Reports',
    summary: analytics.summary,
    recommendations: analytics.capa_summary,
    management_summary: analytics.investigation_summary,
    context: { reportType: form.report_type, metrics: analytics.metrics, filters },
  });
  const enrichedAnalytics = {
    ...analytics,
    summary: polished.summary,
    capa_summary: polished.recommendations || analytics.capa_summary,
    investigation_summary: polished.management_summary || analytics.investigation_summary,
  };
  const year = new Date(form.review_period_to).getFullYear();
  const reportNumber = generateOosReportNumber(year, existingCount);
  const payload = mapOosReportToRecord(form, enrichedAnalytics, actor, reportNumber);
  try {
    const ref = await addDoc(collection(getFirebaseFirestore(), OOS_COLLECTIONS.reports), payload);
    const record = { id: ref.id, ...payload };
    await audit(actor, 'report generated', ref.id, `${form.report_type} — ${reportNumber}`, undefined, payload);
    return { record };
  } catch (e) {
    console.error('generateOosReport', e);
    return { error: 'Failed to save report' };
  }
}

export async function logOosReportPreviewed(actor: OosReportActor, reportType: string, count: number) {
  await audit(actor, 'report previewed', 'workspace', `${reportType}: ${count} record(s)`);
}

export async function exportOosReport(
  report: OosReportRecord,
  exportType: 'PDF' | 'Excel' | 'CSV',
  actor: OosReportActor,
): Promise<{ fileUrl: string; error?: string }> {
  const placeholderUrl = `/api/exports/oos-reports/${report.id}/${exportType.toLowerCase()}`;
  const fileName = `${report.report_number.replace(/\//g, '-')}.${exportType === 'Excel' ? 'xlsx' : exportType === 'PDF' ? 'pdf' : 'csv'}`;
  if (isFirebaseConfigured()) {
    try {
      await updateDoc(doc(getFirebaseFirestore(), OOS_COLLECTIONS.reports, report.id), {
        export_type: exportType,
        file_url: placeholderUrl,
        file_name: fileName,
        report_status: 'Exported',
        updated_at: nowIso(),
      });
    } catch (e) {
      console.error('exportOosReport update', e);
    }
  }
  const action = exportType === 'PDF' ? 'exported PDF' : exportType === 'Excel' ? 'exported Excel' : 'exported CSV';
  await audit(actor, action, report.id, `${report.report_number} — ${exportType} placeholder`, undefined, { fileName, placeholderUrl });
  return { fileUrl: placeholderUrl };
}

export async function logOosReportDownloaded(actor: OosReportActor, reportId: string, reportNumber: string) {
  await audit(actor, 'downloaded', reportId, `Download placeholder — ${reportNumber}`);
}

export async function fetchOosReportProductOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.product_name) set.add(r.product_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchOosReportDepartmentOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.department) set.add(r.department);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchOosReportTestOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.test_name) set.add(r.test_name);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchOosReportBatchOptions(): Promise<string[]> {
  const { records } = await loadReportContext();
  const set = new Set<string>();
  for (const r of records) {
    if (r.batch_number) set.add(r.batch_number);
  }
  return ['All', ...Array.from(set).sort()];
}

export async function fetchOosDashboardAnalytics() {
  const ctx = await loadReportContext();
  const analytics = summarizeOosReportsDashboard(ctx.records, ctx.phase1List, ctx.phase2List, ctx.impactList);
  return {
    metrics: analytics.metrics,
    byStatus: analytics.byStatus,
    phase1_completed: analytics.phase1_completed,
    phase2_completed: analytics.phase2_completed,
  };
}

export { computeOosReportAnalytics };
