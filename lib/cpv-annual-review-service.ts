import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { uploadTextToStorage } from '@/lib/storage-text-upload';
import { getRecord, getRecords } from '@/lib/firestore';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS, CppRecord, CqaRecord, RiskRecord } from '@/lib/cpv';
import { fetchStabilityResults } from '@/lib/cpv-stability-monitoring-service';
import { fetchHoldTimeRecords } from '@/lib/cpv-hold-time-monitoring-service';
import { fetchProcessCapabilityRecords } from '@/lib/cpv-process-capability-service';
import { fetchTrendAnalysisRecords } from '@/lib/cpv-trend-analysis-service';
import { fetchSpcRecords } from '@/lib/cpv-spc-service';
import { fetchRawMaterialRecords } from '@/lib/cpv-raw-material-monitoring-service';
import { fetchPackingMaterialRecords } from '@/lib/cpv-packing-material-monitoring-service';
import { fetchUtilityRecords } from '@/lib/cpv-utility-monitoring-service';
import { fetchEnvironmentalRecords } from '@/lib/cpv-environmental-monitoring-service';
import { fetchYieldRecords } from '@/lib/cpv-yield-monitoring-service';
import { fetchRiskAssessmentRecords } from '@/lib/cpv-risk-assessment-service';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { enrichAiClient } from '@/lib/ai/client';
import {
  AnnualCpvDocument,
  AnnualCpvSignature,
  AnnualCpvSnapshot,
  AnnualCpvWorkflowStatus,
  DEFAULT_ANNUAL_CPV_SIGNATURES,
  buildAnnualCpvSnapshot,
  generateAnnualCpvNumber,
} from '@/lib/cpv-annual-review';
import {
  CPV_REVIEW_COLLECTION,
  CPV_REVIEW_LEGACY,
  CPV_REVIEW_SECTIONS_COLLECTION,
  computeAiInsights,
  computeOverallAssessment,
  enrichCpvReviewMetrics,
  generateCpvReviewNumber,
  buildCpvReviewId,
  type CpvAnnualReviewRecord,
  type CpvReviewApprovalRecord,
  type CpvReviewFormData,
  type CpvReviewSectionRecord,
  type CpvReviewStatus,
} from '@/lib/cpv-annual-review-records';

export type AnnualReviewActor = { id: string; name: string; role?: string };

function callableErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\.?$/, '').trim() || fallback;
  }
  return fallback;
}

function resolveChangeReason(primary?: string | null, fallback?: string | null, defaultReason?: string): string | null {
  const candidate = (primary || fallback || defaultReason || '').trim();
  return candidate.length >= 5 ? candidate : null;
}

async function readFirstAvailable(candidates: string[], max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  for (const name of candidates) {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('createdAt', 'desc'), limit(max)));
      if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      try {
        const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
        if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } catch { /* try next */ }
    }
  }
  return [];
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function mapLegacyStatus(status: string): CpvReviewStatus {
  const map: Record<string, CpvReviewStatus> = {
    draft: 'Draft',
    under_review: 'Under Review',
    approved: 'Approved',
    archived: 'Archived',
    generated: 'Generated',
    rejected: 'Rejected',
  };
  return map[status] || (status as CpvReviewStatus) || 'Draft';
}

export function normalizeCpvReviewRecord(raw: Record<string, unknown>): CpvAnnualReviewRecord {
  const snap = (raw.snapshot || {}) as AnnualCpvSnapshot;
  const metrics = enrichCpvReviewMetrics({
    totalBatchesReviewed: num(raw.totalBatchesReviewed, snap.batches?.total),
    releasedBatches: num(snap.batches?.released ?? (snap.metrics as { releasedBatches?: number } | undefined)?.releasedBatches),
    rejectedBatches: num(snap.batches?.rejected ?? (snap.metrics as { rejectedBatches?: number } | undefined)?.rejectedBatches),
    holdBatches: num((snap.metrics as { holdBatches?: number } | undefined)?.holdBatches),
    cppCompliancePct: snap.cpp?.total ? ((snap.cpp.complies || 0) / snap.cpp.total) * 100 : num((snap.metrics as { cppCompliancePct?: number } | undefined)?.cppCompliancePct, 100),
    cqaCompliancePct: snap.cqa?.total ? ((snap.cqa.complies || 0) / snap.cqa.total) * 100 : num((snap.metrics as { cqaCompliancePct?: number } | undefined)?.cqaCompliancePct, 100),
    yieldAverage: num(snap.yield?.averageYield ?? (snap.metrics as { yieldAverage?: number } | undefined)?.yieldAverage),
    ootCount: num((snap.metrics as { ootCount?: number } | undefined)?.ootCount ?? snap.trendAnalysis?.oot),
    oosCount: num((snap.metrics as { oosCount?: number } | undefined)?.oosCount ?? snap.oos?.total),
    deviationCount: num((snap.metrics as { deviationCount?: number } | undefined)?.deviationCount ?? snap.deviations?.total),
    capaCount: num((snap.metrics as { capaCount?: number } | undefined)?.capaCount ?? snap.capa?.total),
    changeControlCount: num((snap.metrics as { changeControlCount?: number } | undefined)?.changeControlCount ?? snap.changeControl?.total),
    openRiskCount: num((snap.metrics as { openRiskCount?: number } | undefined)?.openRiskCount),
    highRiskCount: num((snap.metrics as { highRiskCount?: number } | undefined)?.highRiskCount ?? snap.risk?.high),
    criticalOpenRiskCount: num((snap.metrics as { criticalOpenRiskCount?: number } | undefined)?.criticalOpenRiskCount ?? snap.risk?.critical),
    criticalOosOpen: num((snap.metrics as { criticalOosOpen?: number } | undefined)?.criticalOosOpen),
    repeatedOot: Boolean((snap.metrics as { repeatedOot?: boolean } | undefined)?.repeatedOot),
    repeatedDeviation: Boolean((snap.metrics as { repeatedDeviation?: boolean } | undefined)?.repeatedDeviation),
    sterilityEndotoxinFailure: Boolean((snap.metrics as { sterilityEndotoxinFailure?: boolean } | undefined)?.sterilityEndotoxinFailure),
    averageCp: num((snap.metrics as { averageCp?: number } | undefined)?.averageCp ?? snap.capability?.averageCpk),
    averageCpk: num(raw.averageCpk, snap.capability?.averageCpk ?? (snap.metrics as { averageCpk?: number } | undefined)?.averageCpk),
    averagePp: num((snap.metrics as { averagePp?: number } | undefined)?.averagePp ?? snap.capability?.averagePpk),
    averagePpk: num(raw.averagePpk, snap.capability?.averagePpk ?? (snap.metrics as { averagePpk?: number } | undefined)?.averagePpk),
    ...(typeof raw.metrics === 'object' && raw.metrics ? raw.metrics as Record<string, unknown> : {}),
  });

  const assessment = computeOverallAssessment(metrics);
  const overallProcessStatus = (str(
    raw.overallProcessStatus || snap.overallProcessStatus,
    assessment.overallProcessStatus,
  ) as CpvAnnualReviewRecord['overallProcessStatus']);
  const overallRiskLevel = (str(
    raw.overallRiskLevel || snap.overallRiskLevel,
    assessment.overallRiskLevel,
  ) as CpvAnnualReviewRecord['overallRiskLevel']);
  const aiInsights = (raw.aiInsights && typeof raw.aiInsights === 'object')
    ? raw.aiInsights as CpvAnnualReviewRecord['aiInsights']
    : computeAiInsights(metrics, { overallProcessStatus, overallRiskLevel });

  return {
    id: str(raw.id),
    cpvReviewId: str(raw.cpvReviewId || raw.cpv_review_id, buildCpvReviewId(str(raw.productCode))),
    cpvReviewNumber: str(raw.cpvReviewNumber || raw.cpv_review_number || raw.documentNumber, 'CPV/DRAFT/0001'),
    productName: str(raw.productName || raw.product_name, snap.productFilter || 'All Products'),
    productCode: str(raw.productCode || raw.product_code),
    productFamily: str(raw.productFamily || raw.product_family),
    productVersion: str(raw.productVersion || raw.product_version),
    genericName: str(raw.genericName || raw.generic_name),
    strength: str(raw.strength),
    dosageForm: str(raw.dosageForm || raw.dosage_form),
    site: str(raw.site),
    plant: str(raw.plant),
    department: str(raw.department),
    batchRange: str(raw.batchRange || raw.batch_range),
    manufacturingCampaign: str(raw.manufacturingCampaign || raw.manufacturing_campaign),
    reviewPeriodFrom: str(raw.reviewPeriodFrom || raw.review_period_from, `${raw.reviewYear || snap.reviewYear}-01-01`),
    reviewPeriodTo: str(raw.reviewPeriodTo || raw.review_period_to, `${raw.reviewYear || snap.reviewYear}-12-31`),
    reviewYear: num(raw.reviewYear || snap.reviewYear, new Date().getFullYear()),
    reviewOwner: str(raw.reviewOwner || raw.review_owner || raw.preparedBy),
    effectiveDate: str(raw.effectiveDate || raw.effective_date),
    approvalDate: str(raw.approvalDate || raw.approval_date),
    nextReviewDate: str(raw.nextReviewDate || raw.next_review_date),
    version: str(raw.version, '1.0'),
    description: str(raw.description),
    changeReason: str(raw.changeReason || raw.change_reason),
    totalBatchesReviewed: num(raw.totalBatchesReviewed, metrics.totalBatchesReviewed),
    totalCppParametersReviewed: num(raw.totalCppParametersReviewed, snap.cpp?.total),
    totalCqaParametersReviewed: num(raw.totalCqaParametersReviewed, snap.cqa?.total),
    totalDeviations: num(raw.totalDeviations, snap.deviations?.total),
    totalOos: num(raw.totalOos, snap.oos?.total),
    totalCapa: num(raw.totalCapa, snap.capa?.total),
    totalChangeControls: num(raw.totalChangeControls, snap.changeControl?.total),
    averageCpk: num(raw.averageCpk, metrics.averageCpk),
    averagePpk: num(raw.averagePpk, metrics.averagePpk),
    overallProcessStatus,
    overallRiskLevel,
    processHealthScore: num(raw.processHealthScore, aiInsights.processHealthScore),
    productHealthScore: num(raw.productHealthScore, aiInsights.productHealthScore),
    complianceScore: num(raw.complianceScore, aiInsights.complianceScore),
    confidenceScore: num(raw.confidenceScore, aiInsights.confidenceScore),
    riskScore: num(raw.riskScore, aiInsights.riskScore),
    aiInsights,
    executiveSummary: str(raw.executiveSummary, snap.executiveSummary || aiInsights.aiExecutiveSummary),
    conclusion: str(raw.conclusion, snap.conclusion),
    recommendations: str(raw.recommendations, snap.recommendations || aiInsights.aiPreventiveRecommendations),
    preparedBy: str(raw.preparedBy),
    reviewedBy: str(raw.reviewedBy),
    approvedBy: str(raw.approvedBy),
    reviewStatus: mapLegacyStatus(str(raw.reviewStatus || raw.status, 'Draft')),
    isLocked: Boolean(raw.isLocked) || ['Approved', 'Archived'].includes(mapLegacyStatus(str(raw.reviewStatus || raw.status, 'Draft'))),
    metrics,
    snapshot: snap as unknown as Record<string, unknown>,
    sections: Array.isArray(raw.sections) ? raw.sections as CpvReviewSectionRecord[] : [],
    signatures: (Array.isArray(raw.signatures) ? raw.signatures : DEFAULT_ANNUAL_CPV_SIGNATURES) as CpvReviewApprovalRecord[],
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    createdBy: str(raw.createdBy),
    updatedBy: str(raw.updatedBy),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function toAnnualCpvDocument(record: CpvAnnualReviewRecord): AnnualCpvDocument {
  return {
    id: record.id,
    documentNumber: record.cpvReviewNumber,
    reviewYear: record.reviewYear,
    productName: record.productName,
    status: record.reviewStatus.toLowerCase().replace(/\s+/g, '_') as AnnualCpvWorkflowStatus,
    conclusion: record.conclusion,
    recommendations: record.recommendations,
    preparedBy: record.preparedBy,
    preparedById: record.createdBy,
    signatures: record.signatures as unknown as AnnualCpvSignature[],
    snapshot: record.snapshot as unknown as AnnualCpvSnapshot,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    version: Number(record.version) || 1,
  };
}

export async function loadAnnualReviewSourceData(
  year: number,
  productFilter = 'all',
  reviewPeriodFrom?: string,
  reviewPeriodTo?: string,
  productCode = '',
) {
  if (!isFirebaseConfigured()) {
    const emptySnap = buildAnnualCpvSnapshot({
      year, productFilter, productCode, reviewPeriodFrom, reviewPeriodTo,
      cpp: [], cqa: [], risks: [], deviations: [], oos: [], capa: [],
      changeControl: [], batches: [], equipment: [],
    });
    return { snapshot: emptySnap, raw: {} };
  }

  try {
    const [
      cpp, cqa, risks, riskAssessment, deviations, oos, capa, changeControl,
      cpvBatches, equipmentRaw, stabilityResults, holdTimeResults,
      capabilityResults, trendAnalysisResults, spcResults,
      rawMaterialResults, packingMaterialResults, utilityResults,
      environmentalResults, yieldResults,
    ] = await Promise.all([
      listCpvRecords<CppRecord>(CPV_COLLECTIONS.cpp, 1000),
      listCpvRecords<CqaRecord>(CPV_COLLECTIONS.cqa, 1000),
      listCpvRecords<RiskRecord>(CPV_COLLECTIONS.risk, 500),
      fetchRiskAssessmentRecords(500),
      readFirstAvailable(['deviations']),
      readFirstAvailable(['oos_records', 'oos']),
      readFirstAvailable(['capa_records', 'capa']),
      readFirstAvailable(['change_controls', 'change_control']),
      fetchCpvBatches().catch(() => readFirstAvailable(['cpv_batches', 'batches', 'pqr_batches'])),
      readFirstAvailable(['equipment', 'equipment_qualification', 'equipment_records']),
      fetchStabilityResults(1000),
      fetchHoldTimeRecords(1000),
      fetchProcessCapabilityRecords(500),
      fetchTrendAnalysisRecords(500),
      fetchSpcRecords(500),
      fetchRawMaterialRecords(500),
      fetchPackingMaterialRecords(500),
      fetchUtilityRecords(500),
      fetchEnvironmentalRecords(500),
      fetchYieldRecords(500),
    ]);

    const batches = (Array.isArray(cpvBatches) ? cpvBatches : []).map((b) =>
      typeof b === 'object' && b !== null ? b as Record<string, unknown> : {},
    );

    const snapshot = buildAnnualCpvSnapshot({
      year,
      productFilter,
      productCode,
      reviewPeriodFrom,
      reviewPeriodTo,
      cpp,
      cqa,
      risks,
      riskAssessment: riskAssessment as unknown as Record<string, unknown>[],
      deviations,
      oos,
      capa,
      changeControl,
      batches,
      equipment: equipmentRaw,
      stability: stabilityResults as unknown as Record<string, unknown>[],
      holdTime: holdTimeResults as unknown as Record<string, unknown>[],
      processCapability: capabilityResults as unknown as Record<string, unknown>[],
      trendAnalysis: trendAnalysisResults as unknown as Record<string, unknown>[],
      spc: spcResults as unknown as Record<string, unknown>[],
      rawMaterial: rawMaterialResults as unknown as Record<string, unknown>[],
      packingMaterial: packingMaterialResults as unknown as Record<string, unknown>[],
      utility: utilityResults as unknown as Record<string, unknown>[],
      environmental: environmentalResults as unknown as Record<string, unknown>[],
      yield: yieldResults as unknown as Record<string, unknown>[],
    });

    return {
      snapshot,
      raw: {
        cpp, cqa, risks, riskAssessment, deviations, oos, capa, changeControl,
        batches, equipment: equipmentRaw, stability: stabilityResults,
        holdTime: holdTimeResults, processCapability: capabilityResults,
        trendAnalysis: trendAnalysisResults, spc: spcResults,
        rawMaterial: rawMaterialResults, packingMaterial: packingMaterialResults,
        utility: utilityResults, environmental: environmentalResults, yield: yieldResults,
      },
    };
  } catch (e) {
    console.error('loadAnnualReviewSourceData failed', e);
    throw e;
  }
}

export async function fetchCpvReviewRecords(max = 100): Promise<CpvAnnualReviewRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let rows: CpvAnnualReviewRecord[] = [];
    try {
      rows = await getRecords<CpvAnnualReviewRecord>(CPV_REVIEW_COLLECTION, [orderBy('createdAt', 'desc'), limit(max)]);
    } catch {
      rows = await getRecords<CpvAnnualReviewRecord>(CPV_REVIEW_COLLECTION, [limit(max)]);
    }
    const normalized = (rows.length
      ? rows
      : await (async () => {
        for (const legacy of CPV_REVIEW_LEGACY) {
          try {
            const legacyRows = await getRecords<Record<string, unknown>>(legacy, [limit(max)]);
            if (legacyRows.length) return legacyRows;
          } catch { /* continue */ }
        }
        return [] as Record<string, unknown>[];
      })()
    ).map((r) => normalizeCpvReviewRecord(r as unknown as Record<string, unknown>));
    return normalized.filter((r) => !r.isDeleted);
  } catch (e) {
    console.error('fetchCpvReviewRecords failed', e);
    return [];
  }
}

export async function fetchCpvReviewById(id: string): Promise<CpvAnnualReviewRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const record = await getRecord<CpvAnnualReviewRecord>(CPV_REVIEW_COLLECTION, id);
    if (record) return normalizeCpvReviewRecord(record as unknown as Record<string, unknown>);
    for (const legacy of CPV_REVIEW_LEGACY) {
      const legacyRecord = await getRecord<Record<string, unknown>>(legacy, id);
      if (legacyRecord) return normalizeCpvReviewRecord(legacyRecord);
    }
    return null;
  } catch (e) {
    console.error('fetchCpvReviewById failed', e);
    return null;
  }
}

export async function fetchCpvReviewSections(reviewId: string): Promise<CpvReviewSectionRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), CPV_REVIEW_SECTIONS_COLLECTION),
      where('cpvReviewId', '==', reviewId),
      limit(50),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CpvReviewSectionRecord));
  } catch (e) {
    console.error('fetchCpvReviewSections failed', e);
    return [];
  }
}

export async function fetchCpvReviewAuditTrail(reviewId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), 'audit_trail'),
      where('documentId', '==', reviewId),
      orderBy('createdAt', 'desc'),
      limit(50),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), limit(100)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .filter((r: Record<string, unknown>) => String(r.documentId || r.recordId) === reviewId);
    } catch (e) {
      console.error('fetchCpvReviewAuditTrail failed', e);
      return [];
    }
  }
}

export async function createCpvReview(
  form: CpvReviewFormData,
  snapshot: AnnualCpvSnapshot,
  _actor: AnnualReviewActor,
  _existingCount = 0,
): Promise<{ result: CpvAnnualReviewRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  const changeReason = resolveChangeReason(form.changeReason, null, 'Initial annual CPV review generation');
  if (!changeReason) return { result: null, error: 'Change reason must be at least 5 characters.' };
  try {
    const assessment = {
      overallProcessStatus: snapshot.overallProcessStatus,
      overallRiskLevel: snapshot.overallRiskLevel,
    };
    const baseAi = computeAiInsights(snapshot.metrics, assessment);
    let aiInsights = baseAi;
    try {
      const enriched = await enrichAiClient({
        task: 'annual_review',
        context: {
          productName: form.productName || snapshot.productFilter,
          metrics: snapshot.metrics,
          assessment,
        },
        fallback: { ...baseAi },
      });
      aiInsights = {
        ...baseAi,
        aiExecutiveSummary: String(enriched.data.aiExecutiveSummary || baseAi.aiExecutiveSummary),
        aiQualityReview: String(enriched.data.aiQualityReview || baseAi.aiQualityReview),
        aiRiskPrediction: String(enriched.data.aiRiskPrediction || baseAi.aiRiskPrediction),
        aiPreventiveRecommendations: String(
          enriched.data.aiPreventiveRecommendations || baseAi.aiPreventiveRecommendations,
        ),
      };
    } catch {
      aiInsights = baseAi;
    }

    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminCpvAnnualReview',
    );
    const result = await fn({
      ...form,
      changeReason,
      snapshot,
      aiInsights,
      executiveSummary: form.executiveSummary || aiInsights.aiExecutiveSummary,
      recommendations: form.recommendations || aiInsights.aiPreventiveRecommendations,
    });
    return { result: normalizeCpvReviewRecord(result.data), error: null };
  } catch (e) {
    console.error('createCpvReview failed', e);
    return { result: null, error: callableErrorMessage(e, 'Failed to create CPV review.') };
  }
}

export async function updateCpvReview(
  id: string,
  updates: Partial<CpvReviewFormData & Pick<CpvAnnualReviewRecord, 'reviewStatus' | 'conclusion' | 'recommendations' | 'executiveSummary' | 'sections'>>,
  _actor: AnnualReviewActor,
  existing: CpvAnnualReviewRecord,
  options?: { esignConfirmed?: boolean; changeReason?: string; qaOverride?: boolean },
): Promise<{ result: CpvAnnualReviewRecord | null; error: string | null }> {
  try {
    const changeReason = resolveChangeReason(
      options?.changeReason ?? updates.changeReason,
      existing.changeReason,
      'Annual CPV review section update',
    );
    if (!changeReason) return { result: null, error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminCpvAnnualReview',
    );
    const result = await fn({
      ...existing,
      ...updates,
      changeReason,
      esignConfirmed: options?.esignConfirmed === true,
      qaOverride: options?.qaOverride === true,
      id,
    });
    return { result: normalizeCpvReviewRecord(result.data), error: null };
  } catch (e) {
    console.error('updateCpvReview failed', e);
    return { result: null, error: callableErrorMessage(e, 'Update failed.') };
  }
}

export async function submitCpvReviewForApproval(
  id: string,
  _actor: AnnualReviewActor,
  existing: CpvAnnualReviewRecord,
  options?: { changeReason?: string; signatureText?: string; meaning?: string },
): Promise<{ error: string | null }> {
  try {
    const changeReason = resolveChangeReason(
      options?.changeReason,
      existing.changeReason,
      'Submitted for management approval',
    );
    if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'submitAdminCpvAnnualReview');
    await fn({
      id,
      changeReason,
      signatureText: options?.signatureText,
      meaning: options?.meaning || 'review',
    });
    return { error: null };
  } catch (e) {
    console.error('submitCpvReviewForApproval failed', e);
    return { error: callableErrorMessage(e, 'Submission failed.') };
  }
}

export async function approveCpvReview(
  id: string,
  _actor: AnnualReviewActor,
  existing: CpvAnnualReviewRecord,
  signature: { signatureText: string; meaning: string; reason: string },
): Promise<{ error: string | null }> {
  try {
    const changeReason = resolveChangeReason(signature.reason, existing.changeReason, 'Approved by QA management');
    if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'approveAdminCpvAnnualReview');
    await fn({
      id,
      changeReason,
      reason: changeReason,
      signatureText: signature.signatureText,
      meaning: signature.meaning,
      esignConfirmed: true,
    });
    return { error: null };
  } catch (e) {
    console.error('approveCpvReview failed', e);
    return { error: callableErrorMessage(e, 'Approval failed.') };
  }
}

export async function rejectCpvReview(
  id: string,
  _actor: AnnualReviewActor,
  existing: CpvAnnualReviewRecord,
  changeReason = 'Rejected by approver',
) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason, 'Rejected by approver');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'rejectAdminCpvAnnualReview');
    await fn({ id, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('rejectCpvReview failed', e);
    return { error: callableErrorMessage(e, 'Reject failed.') };
  }
}

export async function archiveCpvReview(
  id: string,
  _actor: AnnualReviewActor,
  existing: CpvAnnualReviewRecord,
  options?: { changeReason?: string },
) {
  try {
    const reason = resolveChangeReason(options?.changeReason, existing.changeReason, 'Archived after approval');
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminCpvAnnualReview');
    await fn({ id, changeReason: reason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    console.error('archiveCpvReview failed', e);
    return { error: callableErrorMessage(e, 'Archive failed.') };
  }
}

export async function softDeleteCpvReview(
  id: string,
  existing: CpvAnnualReviewRecord,
  changeReason: string,
) {
  try {
    const reason = resolveChangeReason(changeReason, existing.changeReason);
    if (!reason) return { error: 'Change reason must be at least 5 characters.' };
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminCpvAnnualReview');
    await fn({ id, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error('softDeleteCpvReview failed', e);
    return { error: callableErrorMessage(e, 'Delete failed.') };
  }
}

export async function uploadCpvReviewPdfPlaceholder(reviewId: string, reviewNumber: string, htmlContent: string) {
  if (!isFirebaseConfigured()) return null;
  try {
    const path = `cpv-reviews/${reviewId}/${reviewNumber.replace(/\//g, '-')}.html`;
    await uploadTextToStorage(path, htmlContent, 'text/html');
    return path;
  } catch (e) {
    console.error('uploadCpvReviewPdfPlaceholder failed', e);
    return null;
  }
}

export async function logCpvReviewExport(
  _actor: AnnualReviewActor,
  type: 'PDF' | 'Excel',
  reviewId: string,
  reviewNumber: string,
) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCpvAnnualReviewExport');
    await fn({ id: reviewId, exportType: type, documentNumber: reviewNumber });
  } catch (e) {
    console.error('logCpvReviewExport failed', e);
  }
}

/* Legacy compatibility exports */
export async function listAnnualCpvDocuments(): Promise<AnnualCpvDocument[]> {
  const records = await fetchCpvReviewRecords();
  return records.map(toAnnualCpvDocument);
}

export async function getAnnualCpvDocumentsByYear(year: number): Promise<AnnualCpvDocument[]> {
  const docs = await listAnnualCpvDocuments();
  return docs.filter((d) => d.reviewYear === year);
}

export async function saveAnnualCpvDraft(
  input: {
    reviewYear: number;
    productName?: string;
    snapshot: AnnualCpvSnapshot;
    conclusion?: string;
    recommendations?: string;
    existingId?: string;
  },
  actor: { id?: string; name?: string; role?: string },
): Promise<AnnualCpvDocument> {
  const actorFull: AnnualReviewActor = { id: actor.id || 'system', name: actor.name || 'System', role: actor.role };
  if (input.existingId) {
    const existing = await fetchCpvReviewById(input.existingId);
    if (existing) {
      const { result } = await updateCpvReview(input.existingId, {
        conclusion: input.conclusion || input.snapshot.conclusion,
        recommendations: input.recommendations || input.snapshot.recommendations,
        executiveSummary: input.snapshot.executiveSummary,
        changeReason: 'Draft annual CPV review update',
      }, actorFull, existing);
      return toAnnualCpvDocument(result || existing);
    }
  }
  const existing = await fetchCpvReviewRecords();
  const yearCount = existing.filter((r) => r.reviewYear === input.reviewYear).length;
  const { result, error } = await createCpvReview({
    productName: input.productName || 'All Products',
    productCode: '',
    productFamily: '',
    productVersion: '',
    genericName: '',
    strength: '',
    dosageForm: '',
    site: '',
    plant: '',
    department: '',
    batchRange: '',
    manufacturingCampaign: '',
    reviewPeriodFrom: `${input.reviewYear}-01-01`,
    reviewPeriodTo: `${input.reviewYear}-12-31`,
    reviewOwner: actorFull.name,
    effectiveDate: '',
    nextReviewDate: '',
    version: '1.0',
    description: '',
    executiveSummary: input.snapshot.executiveSummary,
    conclusion: input.conclusion || input.snapshot.conclusion,
    recommendations: input.recommendations || input.snapshot.recommendations,
    changeReason: 'Draft annual CPV review creation',
  }, input.snapshot, actorFull, yearCount);
  if (error || !result) throw new Error(error || 'Save failed');
  return toAnnualCpvDocument(result);
}

export async function updateAnnualCpvWorkflow(
  documentId: string,
  status: AnnualCpvWorkflowStatus,
  updates?: Partial<Pick<AnnualCpvDocument, 'conclusion' | 'recommendations' | 'snapshot'>>,
) {
  const existing = await fetchCpvReviewById(documentId);
  if (!existing) throw new Error('Document not found');
  const actor: AnnualReviewActor = { id: 'system', name: 'System' };
  if (status === 'under_review') {
    const { error } = await submitCpvReviewForApproval(documentId, actor, existing);
    if (error) throw new Error(error);
    return;
  }
  if (status === 'approved') {
    const { error } = await approveCpvReview(documentId, actor, existing, {
      signatureText: 'System',
      meaning: 'approve',
      reason: 'Workflow approval',
    });
    if (error) throw new Error(error);
    return;
  }
  if (status === 'archived') {
    const { error } = await archiveCpvReview(documentId, actor, existing);
    if (error) throw new Error(error);
    return;
  }
  if (status === 'rejected') {
    const { error } = await rejectCpvReview(documentId, actor, existing, 'Workflow rejection');
    if (error) throw new Error(error);
    return;
  }
  await updateCpvReview(documentId, {
    conclusion: updates?.conclusion,
    recommendations: updates?.recommendations,
    changeReason: 'Workflow status update',
  }, actor, existing);
}

export async function signAnnualCpv(
  documentId: string,
  role: AnnualCpvSignature['role'],
  payload: { name: string; signatureText: string; meaning: string; reason: string; userId?: string },
) {
  const existing = await fetchCpvReviewById(documentId);
  if (!existing) throw new Error('Document not found');
  const actor: AnnualReviewActor = { id: payload.userId || 'system', name: payload.name };
  if (role === 'approved') {
    const { error } = await approveCpvReview(documentId, actor, existing, payload);
    if (error) throw new Error(error);
    return;
  }
  if (role === 'reviewed') {
    const { error } = await submitCpvReviewForApproval(documentId, actor, existing, {
      changeReason: payload.reason,
      signatureText: payload.signatureText,
      meaning: payload.meaning,
    });
    if (error) throw new Error(error);
    return;
  }
  await updateCpvReview(documentId, {
    changeReason: payload.reason || 'Prepared signature recorded',
  }, actor, existing);
}

export async function archiveAnnualCpv(documentId: string) {
  const existing = await fetchCpvReviewById(documentId);
  if (!existing) throw new Error('Document not found');
  await archiveCpvReview(documentId, { id: 'system', name: 'System' }, existing);
}

export { generateAnnualCpvNumber, generateCpvReviewNumber };
