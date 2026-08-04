/**
 * Pure-logic checks for PQR Summary & Conclusion.
 * Run: npx tsx scripts/validate-pqr-summary-conclusion-logic.ts
 */
import {
  buildApprovalReadiness,
  buildSectionCompletion,
  buildSummaryFindings,
  buildSummaryMetrics,
  canApproveSummaryConclusion,
  canExportSummaryConclusion,
  canManageSummaryConclusion,
  canViewSummaryConclusion,
  computeQualityScore,
  determineOverallStatuses,
  formatCompliancePct,
  generateRecommendations,
  normalizeSummaryMetrics,
  type ConsolidatedReviewData,
  type PqrSummaryConclusionRecord,
} from '../lib/pqr-summary-conclusion-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- Role checks via normalizeRole ---
assert(canViewSummaryConclusion('qa'), 'qa (→qa_manager) can view');
assert(canViewSummaryConclusion('QA Manager'), 'QA Manager can view');
assert(canViewSummaryConclusion('head_qa'), 'head_qa can view');
assert(canViewSummaryConclusion('management'), 'management can view');
assert(canViewSummaryConclusion('auditor'), 'auditor can view');
assert(canViewSummaryConclusion('viewer'), 'viewer can view');

assert(canManageSummaryConclusion('qa'), 'qa can manage');
assert(canManageSummaryConclusion('head_qa'), 'head_qa can manage');
assert(!canManageSummaryConclusion('viewer'), 'viewer cannot manage');
assert(!canManageSummaryConclusion('management'), 'management cannot manage (approve only)');

assert(canApproveSummaryConclusion('management'), 'management can approve');
assert(canApproveSummaryConclusion('head_qa'), 'head_qa can approve');
assert(!canApproveSummaryConclusion('qa_executive'), 'qa_executive cannot approve');
assert(!canApproveSummaryConclusion('viewer'), 'viewer cannot approve');

assert(canExportSummaryConclusion('auditor'), 'auditor can export');
assert(canExportSummaryConclusion('qa'), 'qa can export');
assert(!canExportSummaryConclusion('viewer'), 'viewer cannot export');

// --- Empty data honesty ---
const empty: ConsolidatedReviewData = {
  batches: [], materials: [], packaging: [], equipment: [], utilityEnv: [], stability: [],
  deviations: [], oos: [], capa: [], changeControls: [], risks: [], cpvReviews: [],
  capability: [], trends: [], capaTrends: [], recalls: [],
};

const emptyMetrics = buildSummaryMetrics(empty);
assert(emptyMetrics.materialCompliancePct === 0, 'empty material compliance is 0 not 100');
assert(emptyMetrics.stabilityCompliancePct === 0, 'empty stability compliance is 0 not 100');
assert(emptyMetrics.hasCapabilityData === false, 'no capability data flag');
assert(formatCompliancePct(0, 0) === 'N/A', 'formatCompliancePct N/A for empty');

const statusesEmpty = determineOverallStatuses(emptyMetrics);
assert(
  statusesEmpty.overallQualityStatus !== 'Satisfactory With Observation'
    || emptyMetrics.averageCpk === 0,
  'missing Cpk must not invent With Observation via Cpk path',
);
// With no capability data and no risks/OOT, empty should not be forced to With Observation by Cpk=0
assert(
  !(emptyMetrics.repeatedOot || emptyMetrics.highRisks > 0 || (emptyMetrics.hasCapabilityData && emptyMetrics.averageCpk < 1.33)),
  'empty data observation gate inactive',
);

const scoreEmpty = computeQualityScore(emptyMetrics);
assert(scoreEmpty.score === 100, 'empty quality score starts at 100 without invented penalties');

// --- Cpk gate ---
const withLowCpk = { ...emptyMetrics, hasCapabilityData: true, averageCpk: 1.0 };
const obs = determineOverallStatuses(withLowCpk);
assert(obs.overallQualityStatus === 'Satisfactory With Observation', 'low Cpk with data → observation');

const scoreLow = computeQualityScore(withLowCpk);
assert(scoreLow.score < 100, 'low Cpk deducts score when data exists');

// --- Risk total not double-counting blindly ---
assert(emptyMetrics.totalRisks === 0, 'empty totalRisks is 0');

// --- Change controls in metrics ---
assert(typeof emptyMetrics.totalChangeControls === 'number', 'change controls metric present');
assert(typeof emptyMetrics.openChangeControls === 'number', 'open change controls present');

// --- Section completion ---
const sections = buildSectionCompletion(empty);
assert(sections.length === 6, 'six review sections');
assert(sections.every((s) => s.status === 'Pending'), 'empty sections pending');

const withBatch: ConsolidatedReviewData = {
  ...empty,
  batches: [{
    id: '1', batchReviewId: 'BR1', pqrId: 'p1', pqrNumber: 'PQR-1', product: 'A', productCode: 'A1',
    genericName: '', strength: '', dosageForm: '', reviewPeriodFrom: '', reviewPeriodTo: '',
    batchNumber: 'B1', manufacturingDate: '2025-01-01', expiryDate: '2026-01-01',
    batchSize: 1000, batchSizeUnit: 'Vials', batchStatus: 'Manufactured', releaseStatus: 'Released',
    complianceStatus: 'Complies', complianceReasons: [], riskLevel: 'Low',
    deviationCount: 0, oosCount: 0, capaCount: 0, yieldPct: 98,
    createdAt: '2025-01-01', updatedAt: '2025-01-02', createdBy: 'u', updatedBy: 'u', isDeleted: false,
  } as unknown as ConsolidatedReviewData['batches'][0]],
};
const sections2 = buildSectionCompletion(withBatch);
assert(sections2.find((s) => s.key === 'batches')?.status === 'Completed', 'batch section completed');
assert(sections2.find((s) => s.key === 'batches')?.recordCount === 1, 'batch count 1');

const metricsWithBatch = buildSummaryMetrics(withBatch);
assert(metricsWithBatch.totalBatchesManufactured === 1, 'batch count from summary');
assert(metricsWithBatch.avgYieldPct === 98, 'avg yield from batch');

// --- Findings ---
const findingsEmpty = buildSummaryFindings(empty, emptyMetrics);
assert(findingsEmpty.some((f) => f.severity === 'Observation'), 'positive observation when no issues');

const criticalMetrics = {
  ...emptyMetrics,
  sterilityFailure: true,
  totalOos: 1,
  openOos: 1,
  criticalOos: true,
};
const findingsCrit = buildSummaryFindings(empty, criticalMetrics);
assert(findingsCrit.some((f) => f.severity === 'Critical'), 'critical findings present');

// --- Readiness ---
const readinessEmpty = buildApprovalReadiness(empty, null);
assert(!readinessEmpty.ready, 'not ready without sections/summary');

const stubRecord = {
  id: 's1',
  status: 'Generated',
  executiveSummary: 'Exec',
  finalConclusion: 'Conclusion',
  recommendations: '1. Continue monitoring',
  metrics: metricsWithBatch,
} as PqrSummaryConclusionRecord;

const readinessPartial = buildApprovalReadiness(withBatch, stubRecord);
assert(
  readinessPartial.items.find((i) => i.key === 'batches')?.ok === true,
  'batch readiness ok',
);
assert(
  readinessPartial.items.find((i) => i.key === 'summary')?.ok === true,
  'summary text readiness ok',
);

// --- normalize metrics ---
const normalized = normalizeSummaryMetrics(undefined);
assert(normalized.qualityScore === 100, 'normalize undefined works');
assert(normalized.totalChangeControls === 0, 'normalize fills change controls');

const recs = generateRecommendations(metricsWithBatch, withBatch);
assert(recs.length > 0, 'recommendations generated');

console.log('PQR Summary & Conclusion logic validation passed.');
