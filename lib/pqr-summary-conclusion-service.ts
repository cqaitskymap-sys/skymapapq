import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, limit, orderBy,
} from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { downloadCsv } from '@/lib/export-utils';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { fetchPqrOptions } from '@/lib/pqr-batch-review-service';
import { fetchBatchReviewRecords } from '@/lib/pqr-batch-review-service';
import { fetchMaterialReviewRecords } from '@/lib/pqr-material-review-service';
import { fetchPackagingReviewRecords } from '@/lib/pqr-packaging-review-service';
import { fetchEquipmentReviewRecords } from '@/lib/pqr-equipment-review-service';
import { fetchUtilityEnvReviewRecords } from '@/lib/pqr-utility-environmental-review-service';
import { fetchStabilityReviewRecords } from '@/lib/pqr-stability-review-service';
import {
  PQR_SUMMARY_CONCLUSION_COLLECTIONS,
  PQR_SUMMARY_CONCLUSION_MODULE,
  buildApprovalReadiness,
  buildSectionCompletion,
  buildSummaryFindings,
  buildSummaryMetrics,
  determineOverallStatuses,
  generateRecommendations,
  generateSectionNarratives,
  normalizeSummaryMetrics,
  type ConsolidatedReviewData,
  type PqrSummaryConclusionRecord,
  type SummaryApprovalFormData,
} from '@/lib/pqr-summary-conclusion-records';
import { polishQmsReportTexts } from '@/lib/ai/client';

export type PqrSummaryConclusionActor = { id: string; name: string; role?: string; email?: string };

export { fetchPqrOptions };

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));

function userSafeError(fallback: string, e?: unknown): string {
  console.error(fallback, e);
  return fallback;
}

function buildSummaryId(pqrNumber: string) {
  return `PSUM-${pqrNumber.replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function readCollection(name: string, max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error(`readCollection ${name}`, e);
      return [];
    }
  }
}

async function readFirst(names: string[], max = 500): Promise<Record<string, unknown>[]> {
  for (const name of names) {
    const rows = await readCollection(name, max);
    if (rows.length) return rows;
  }
  return [];
}

function inPeriod(dateStr: string, from: string, to: string): boolean {
  const d = dateStr.slice(0, 10);
  if (from && to) {
    if (!d) return false;
    return d >= from && d <= to;
  }
  return true;
}

/**
 * Product match must be explicit. Never attach productless QMS rows to every PQR.
 * Also accepts explicit pqrId linkage and batch-number overlap with PQR batches.
 */
function matchesPqrScope(
  raw: Record<string, unknown>,
  pqr: PqrOption,
  batchNumbers: Set<string>,
): boolean {
  const linkedPqr = str(raw.pqrId || raw.pqr_id);
  if (linkedPqr && linkedPqr === pqr.id) return true;

  const code = str(raw.productCode || raw.product_code).toLowerCase();
  const name = str(raw.productName || raw.product_name || raw.product).toLowerCase();
  const pCode = (pqr.productCode || '').toLowerCase();
  const pName = (pqr.productName || '').toLowerCase();

  const productMatch =
    (Boolean(code) && Boolean(pCode) && code === pCode)
    || (Boolean(name) && Boolean(pName) && (name === pName || pName.includes(name) || name.includes(pName)));

  if (productMatch) return true;

  if (batchNumbers.size > 0) {
    const batch = str(raw.batchNumber || raw.batch_number || raw.batchNo || raw.batch).toLowerCase();
    if (batch && batchNumbers.has(batch)) return true;
  }

  return false;
}

function filterByPqr(
  rows: Record<string, unknown>[],
  pqr: PqrOption,
  batchNumbers: Set<string>,
): Record<string, unknown>[] {
  const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
  const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
  return rows.filter((r) => {
    if (r.isDeleted) return false;
    if (!matchesPqrScope(r, pqr, batchNumbers)) return false;
    const date = str(r.createdAt || r.created_at || r.reportedDate || r.date || r.reviewDate || r.effectiveDate);
    if (str(r.pqrId || r.pqr_id) === pqr.id && !date) return true;
    return inPeriod(date, from, to);
  });
}

async function logSummaryAudit(
  actionType: string,
  actor: PqrSummaryConclusionActor,
  detail?: unknown,
  recordId = 'summary-conclusion',
  oldValue?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: PQR_SUMMARY_CONCLUSION_MODULE,
      collectionName: PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary,
      recordId,
      actionType,
      newValue: detail,
      oldValue: oldValue ?? null,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary,
      documentId: recordId,
      action: actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_SUMMARY_CONCLUSION_MODULE,
    });
  } catch (e) {
    console.error('logSummaryAudit failed', e);
  }
}

export async function consolidatePqrReviewData(pqr: PqrOption): Promise<ConsolidatedReviewData> {
  const [
    batches, materials, packaging, equipment, utilityEnv, stability,
    deviationsRaw, oosRaw, capaRaw, ccRaw, risksRaw, cpvRaw, capRaw, trendRaw, capaTrendRaw, recallRaw,
  ] = await Promise.all([
    fetchBatchReviewRecords(pqr.id),
    fetchMaterialReviewRecords(pqr.id),
    fetchPackagingReviewRecords(pqr.id),
    fetchEquipmentReviewRecords(pqr.id),
    fetchUtilityEnvReviewRecords(pqr.id),
    fetchStabilityReviewRecords(pqr.id),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.deviations]),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.oosRecords, 'oos']),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.capaRecords, 'capa']),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.changeControls, 'change_control']),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.riskAssessment, 'risk_assessment']),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.cpvReviews, 'cpv_annual_review']),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.processCapability, 'cpv_capability']),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.trendAnalysis, 'cpv_trends']),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.capaTrends]),
    readFirst([PQR_SUMMARY_CONCLUSION_COLLECTIONS.recalls, 'recall_records']),
  ]);

  const batchNumbers = new Set(
    batches
      .filter((b) => !b.isDeleted)
      .map((b) => (b.batchNumber || '').toLowerCase())
      .filter(Boolean),
  );

  return {
    batches,
    materials,
    packaging,
    equipment,
    utilityEnv,
    stability,
    deviations: filterByPqr(deviationsRaw, pqr, batchNumbers),
    oos: filterByPqr(oosRaw, pqr, batchNumbers),
    capa: filterByPqr(capaRaw, pqr, batchNumbers),
    changeControls: filterByPqr(ccRaw, pqr, batchNumbers),
    risks: filterByPqr(risksRaw, pqr, batchNumbers),
    cpvReviews: filterByPqr(cpvRaw, pqr, batchNumbers),
    capability: filterByPqr(capRaw, pqr, batchNumbers),
    trends: filterByPqr(trendRaw, pqr, batchNumbers),
    capaTrends: filterByPqr(capaTrendRaw, pqr, batchNumbers).sort((a, b) =>
      str(b.created_at || b.generated_date).localeCompare(str(a.created_at || a.generated_date)),
    ),
    recalls: filterByPqr(recallRaw, pqr, batchNumbers),
  };
}

export async function fetchSummaryConclusionRecord(pqrId: string): Promise<PqrSummaryConclusionRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary),
      where('pqrId', '==', pqrId),
      where('isDeleted', '==', false),
    ));
    if (snap.empty) return null;
    const docSnap = snap.docs.sort((a, b) =>
      str(b.data().updatedAt).localeCompare(str(a.data().updatedAt)),
    )[0];
    const raw = { id: docSnap.id, ...docSnap.data() } as PqrSummaryConclusionRecord;
    return {
      ...raw,
      status: raw.status || 'Draft',
      metrics: normalizeSummaryMetrics(raw.metrics),
    };
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary),
        where('pqrId', '==', pqrId),
      ));
      const active = snap.docs.filter((d) => !d.data().isDeleted);
      if (!active.length) return null;
      const docSnap = active.sort((a, b) =>
        str(b.data().updatedAt).localeCompare(str(a.data().updatedAt)),
      )[0];
      const raw = { id: docSnap.id, ...docSnap.data() } as PqrSummaryConclusionRecord;
      return {
        ...raw,
        status: raw.status || 'Draft',
        metrics: normalizeSummaryMetrics(raw.metrics),
      };
    } catch (e) {
      console.error('fetchSummaryConclusionRecord failed', e);
      return null;
    }
  }
}

async function saveSummarySectionToPqr(
  pqrId: string,
  record: Omit<PqrSummaryConclusionRecord, 'id'> | PqrSummaryConclusionRecord,
  actor: PqrSummaryConclusionActor,
): Promise<void> {
  const ts = nowIso();
  const snap = await getDocs(query(
    collection(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.sections),
    where('pqrId', '==', pqrId),
    where('sectionKey', '==', 'summary_conclusion'),
  ));

  let sectionStatus = 'Draft';
  if (record.status === 'Approved' || record.status === 'Archived') sectionStatus = record.status;
  else if (record.status === 'Under Review') sectionStatus = 'Under Review';
  else if (record.status === 'Rejected') sectionStatus = 'Returned';
  else if (record.status === 'Generated' || record.executiveSummary) sectionStatus = 'Completed';

  const payload = {
    pqrId,
    sectionKey: 'summary_conclusion',
    sectionType: 'Summary & Conclusion',
    sectionOrder: 30,
    sectionTitle: 'Summary & Conclusion',
    narrative: record.finalConclusion || record.executiveSummary || '',
    dataSummary: JSON.stringify(record.metrics || {}),
    included: true,
    status: sectionStatus,
    updatedAt: ts,
    updatedBy: actor.id,
  };
  if (snap.empty) {
    await addDoc(collection(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.sections), {
      ...payload, createdAt: ts, createdBy: actor.id, isDeleted: false,
    });
  } else {
    await updateDoc(snap.docs[0].ref, payload);
  }

  try {
    await updateDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.records, pqrId), {
      'scope.summaryConclusion': true,
      updatedAt: ts,
      updatedBy: actor.id,
    });
  } catch {
    /* non-fatal */
  }
}

export async function generateSummaryConclusion(
  pqr: PqrOption,
  actor: PqrSummaryConclusionActor,
): Promise<{ record?: PqrSummaryConclusionRecord; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };

  try {
    const data = await consolidatePqrReviewData(pqr);
    const metrics = buildSummaryMetrics(data);
    const statuses = determineOverallStatuses(metrics);
    const recommendationsBase = generateRecommendations(metrics, data);
    const narratives = generateSectionNarratives(metrics, data);
    const polished = await polishQmsReportTexts({
      module: 'PQR Summary Conclusion',
      summary: narratives.executiveSummary,
      recommendations: recommendationsBase,
      management_summary: statuses.finalConclusion,
      context: {
        product: pqr.productName,
        metrics,
        overallQualityStatus: statuses.overallQualityStatus,
        overallProcessStatus: statuses.overallProcessStatus,
        overallRiskLevel: statuses.overallRiskLevel,
      },
    });
    const recommendations = polished.recommendations || recommendationsBase;
    const ts = nowIso();
    const reviewYear = pqr.reviewPeriodTo?.slice(0, 4) || new Date().getFullYear().toString();
    const existing = await fetchSummaryConclusionRecord(pqr.id);

    if (existing?.status === 'Approved' || existing?.status === 'Archived') {
      return { error: 'Approved or archived summaries cannot be regenerated. Create a controlled revision via Change Control if required.' };
    }

    const payload: Omit<PqrSummaryConclusionRecord, 'id'> = {
      summaryId: existing?.summaryId || buildSummaryId(pqr.pqrNumber),
      pqrId: pqr.id,
      pqrNumber: pqr.pqrNumber,
      product: pqr.productName,
      productCode: pqr.productCode,
      reviewYear,
      reviewPeriodFrom: pqr.reviewPeriodFrom?.slice(0, 10) || '',
      reviewPeriodTo: pqr.reviewPeriodTo?.slice(0, 10) || '',
      ...narratives,
      executiveSummary: polished.summary || narratives.executiveSummary,
      overallQualityStatus: statuses.overallQualityStatus,
      overallProcessStatus: statuses.overallProcessStatus,
      overallRiskLevel: statuses.overallRiskLevel,
      finalConclusion: polished.management_summary || statuses.finalConclusion,
      recommendations,
      preparedBy: existing?.preparedBy || actor.name,
      reviewedBy: existing?.reviewedBy || '',
      approvedBy: existing?.approvedBy || '',
      approvalDate: existing?.approvalDate || '',
      reviewerComments: existing?.reviewerComments || '',
      qaComments: existing?.qaComments || '',
      headQaComments: existing?.headQaComments || '',
      finalApprovalComments: existing?.finalApprovalComments || '',
      eSignatureApplied: false,
      eSignatureMeaning: '',
      metrics,
      status: 'Generated',
      createdAt: existing?.createdAt || ts,
      updatedAt: ts,
      createdBy: existing?.createdBy || actor.id,
      updatedBy: actor.id,
      createdByName: existing?.createdByName || actor.name,
      updatedByName: actor.name,
      isDeleted: false,
    };

    let record: PqrSummaryConclusionRecord;
    if (existing?.id) {
      await updateDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, existing.id), payload);
      record = { id: existing.id, ...payload };
    } else {
      const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary), payload);
      record = { id: docRef.id, ...payload };
    }

    await saveSummarySectionToPqr(pqr.id, payload, actor);
    await logSummaryAudit('summary generated', actor, { pqrId: pqr.id, summaryId: payload.summaryId }, record.id || pqr.id);
    await logSummaryAudit('quality score calculated', actor, { score: metrics.qualityScore }, record.id || pqr.id);
    await logSummaryAudit('recommendation generated', actor, { count: recommendations.split('\n').length }, record.id || pqr.id);
    await logSummaryAudit('conclusion generated', actor, statuses, record.id || pqr.id);
    return { record };
  } catch (e) {
    return { error: userSafeError('Unable to generate summary and conclusion. Please try again.', e) };
  }
}

export async function updateSummaryConclusionFields(
  id: string,
  fields: Partial<PqrSummaryConclusionRecord>,
  actor: PqrSummaryConclusionActor,
  pqrId?: string,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const current = await getDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, id));
    if (current.exists()) {
      const status = str(current.data().status);
      if (status === 'Approved' || status === 'Archived') {
        return { error: 'Approved or archived summaries are controlled and cannot be edited.' };
      }
    }

    await updateDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, id), {
      ...fields,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logSummaryAudit('summary updated', actor, { id, fields: Object.keys(fields) }, id);
    if (pqrId) {
      const rec = await fetchSummaryConclusionRecord(pqrId);
      if (rec) await saveSummarySectionToPqr(pqrId, rec, actor).catch(() => undefined);
    }
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to save summary changes.', e) };
  }
}

export async function submitSummaryForReview(
  id: string,
  data: SummaryApprovalFormData,
  actor: PqrSummaryConclusionActor,
  pqr: PqrOption,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const consolidated = await consolidatePqrReviewData(pqr);
    const existing = await fetchSummaryConclusionRecord(pqr.id);
    const readiness = buildApprovalReadiness(consolidated, existing ? { ...existing, ...data } as PqrSummaryConclusionRecord : null);
    const blockers = readiness.items.filter((i) => !i.ok && i.key !== 'esign' && i.key !== 'critical' && i.key !== 'open-critical-capa');
    if (blockers.length) {
      return { error: `Cannot submit: ${blockers.map((b) => b.label).join('; ')}` };
    }

    const ts = nowIso();
    await updateDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, id), {
      ...data,
      status: 'Under Review',
      preparedBy: actor.name,
      updatedAt: ts,
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    const rec = await fetchSummaryConclusionRecord(pqr.id);
    if (rec) await saveSummarySectionToPqr(pqr.id, { ...rec, status: 'Under Review' }, actor);
    await logSummaryAudit('review submitted', actor, { id }, id);
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to submit summary for review.', e) };
  }
}

export async function approveSummaryConclusion(
  id: string,
  data: SummaryApprovalFormData,
  actor: PqrSummaryConclusionActor,
  eSignature: { meaning: string; reason: string; password: string },
  pqrId: string,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    if (!eSignature.password || eSignature.password.length < 6) {
      return { error: 'Password is required for electronic signature re-authentication.' };
    }
    if (!eSignature.reason.trim()) {
      return { error: 'Reason for signature is required.' };
    }

    const auth = getFirebaseAuth();
    const currentUser = auth.currentUser;
    if (!currentUser || currentUser.uid !== actor.id) {
      return { error: 'You can only sign as the logged-in user.' };
    }
    const email = actor.email || currentUser.email;
    if (!email) return { error: 'User email is required for e-signature.' };

    try {
      const credential = EmailAuthProvider.credential(email, eSignature.password);
      await reauthenticateWithCredential(currentUser, credential);
    } catch {
      return { error: 'E-signature authentication failed. Check your password and try again.' };
    }

    const ts = nowIso();
    await updateDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, id), {
      ...data,
      status: 'Approved',
      approvalDate: ts.slice(0, 10),
      eSignatureApplied: true,
      eSignatureMeaning: eSignature.meaning || 'Approved By',
      eSignatureReason: eSignature.reason.trim(),
      eSignatureAt: ts,
      eSignatureBy: actor.id,
      eSignatureByName: actor.name,
      updatedAt: ts,
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    const rec = await fetchSummaryConclusionRecord(pqrId);
    if (rec) await saveSummarySectionToPqr(pqrId, { ...rec, status: 'Approved' }, actor);
    await logSummaryAudit('approved', actor, { id }, id);
    await logSummaryAudit('e-signature applied', actor, {
      meaning: eSignature.meaning,
      reason: eSignature.reason,
      at: ts,
    }, id);
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to approve summary.', e) };
  }
}

export async function rejectSummaryConclusion(
  id: string,
  comments: string,
  actor: PqrSummaryConclusionActor,
  pqrId: string,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!comments.trim()) return { error: 'Rejection comments are required.' };
  try {
    await updateDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, id), {
      status: 'Rejected',
      finalApprovalComments: comments.trim(),
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    const rec = await fetchSummaryConclusionRecord(pqrId);
    if (rec) await saveSummarySectionToPqr(pqrId, { ...rec, status: 'Rejected' }, actor);
    await logSummaryAudit('rejected', actor, { id, comments }, id);
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to reject summary.', e) };
  }
}

export async function archiveSummaryConclusion(
  id: string,
  actor: PqrSummaryConclusionActor,
  pqrId: string,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const current = await getDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, id));
    if (!current.exists() || str(current.data().status) !== 'Approved') {
      return { error: 'Only approved summaries can be archived.' };
    }
    await updateDoc(doc(getFirebaseFirestore(), PQR_SUMMARY_CONCLUSION_COLLECTIONS.summary, id), {
      status: 'Archived',
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    const rec = await fetchSummaryConclusionRecord(pqrId);
    if (rec) await saveSummarySectionToPqr(pqrId, { ...rec, status: 'Archived' }, actor);
    await logSummaryAudit('archived', actor, { id }, id);
    return {};
  } catch (e) {
    return { error: userSafeError('Unable to archive summary.', e) };
  }
}

export function exportSummaryConclusionCsv(
  record: PqrSummaryConclusionRecord,
  data: ConsolidatedReviewData,
): void {
  const metrics = normalizeSummaryMetrics(record.metrics);
  const sections = buildSectionCompletion(data);
  const findings = buildSummaryFindings(data, metrics);
  const readiness = buildApprovalReadiness(data, record);

  const headers = ['Section', 'Field', 'Value'];
  const rows: Array<Array<string | number>> = [
    ['Header', 'PQR Number', record.pqrNumber],
    ['Header', 'Product', record.product],
    ['Header', 'Product Code', record.productCode],
    ['Header', 'Review Period', `${record.reviewPeriodFrom} — ${record.reviewPeriodTo}`],
    ['Header', 'Status', String(record.status)],
    ['Metrics', 'Quality Score', metrics.qualityScore],
    ['Metrics', 'Quality Band', metrics.qualityScoreBand],
    ['Metrics', 'Overall Quality', String(record.overallQualityStatus)],
    ['Metrics', 'Overall Process', String(record.overallProcessStatus)],
    ['Metrics', 'Overall Risk', String(record.overallRiskLevel)],
    ['Metrics', 'Batches', metrics.totalBatchesManufactured],
    ['Metrics', 'Released', metrics.totalReleasedBatches],
    ['Metrics', 'Rejected', metrics.totalRejectedBatches],
    ['Metrics', 'Avg Yield %', metrics.avgYieldPct != null ? metrics.avgYieldPct : 'N/A'],
    ['Metrics', 'Deviations', metrics.totalDeviations],
    ['Metrics', 'OOS', metrics.totalOos],
    ['Metrics', 'CAPA', metrics.totalCapa],
    ['Metrics', 'Change Controls', metrics.totalChangeControls],
    ['Metrics', 'Avg Cpk', metrics.hasCapabilityData ? metrics.averageCpk : 'N/A'],
    ['Narrative', 'Executive Summary', record.executiveSummary],
    ['Narrative', 'Final Conclusion', record.finalConclusion],
    ['Narrative', 'Recommendations', record.recommendations],
    ...sections.map((s) => ['Section Completion', s.label, `${s.status} (${s.recordCount})`]),
    ...findings.map((f) => ['Finding', `${f.id} [${f.severity}] ${f.category}`, f.description]),
    ...readiness.items.map((i) => ['Readiness', i.label, `${i.ok ? 'OK' : 'Incomplete'}: ${i.detail}`]),
  ];

  downloadCsv(
    `pqr-summary-${record.pqrNumber || record.pqrId}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows,
  );
}

export {
  buildSummaryCharts,
  buildSummaryMetrics,
  buildSectionCompletion,
  buildApprovalReadiness,
  buildSummaryFindings,
  determineOverallStatuses,
  generateRecommendations,
  normalizeSummaryMetrics,
} from '@/lib/pqr-summary-conclusion-records';

export async function logSummaryConclusionView(actor: PqrSummaryConclusionActor) {
  await logSummaryAudit('summary conclusion viewed', actor);
}

export async function logSummaryExportPdf(actor: PqrSummaryConclusionActor) {
  await logSummaryAudit('export PDF', actor);
}

export async function logSummaryExportExcel(actor: PqrSummaryConclusionActor) {
  await logSummaryAudit('export Excel', actor);
}

export async function logSummaryExportCsv(actor: PqrSummaryConclusionActor) {
  await logSummaryAudit('export CSV', actor);
}

export async function logSummaryNarrativeEdit(actor: PqrSummaryConclusionActor, pqrId: string) {
  await logSummaryAudit('narrative edited', actor, { pqrId }, pqrId);
}
