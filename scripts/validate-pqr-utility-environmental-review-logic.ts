/**
 * Pure-logic checks for PQR Utility & Environmental Review.
 * Run: npx tsx scripts/validate-pqr-utility-environmental-review-logic.ts
 */
import {
  canAddUtilityEnvReview,
  canExportUtilityEnvReview,
  canManageUtilityEnvReview,
  canViewUtilityEnvReview,
  computeUtilityEnvCompliance,
  computeUtilityEnvSummary,
  filterUtilityEnvReviewRecords,
  generateUtilityEnvNarrative,
  normalizeUtilityEnvReviewRecord,
  utilityEnvReviewFormSchema,
  type PqrUtilityEnvironmentalReviewRecord,
} from '../lib/pqr-utility-environmental-review-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- Role checks (via normalizeRole) ---
assert(canViewUtilityEnvReview('qa'), 'qa (→qa_manager) can view');
assert(canViewUtilityEnvReview('QA Manager'), 'QA Manager can view');
assert(canViewUtilityEnvReview('head_qa'), 'head_qa can view');
assert(canViewUtilityEnvReview('viewer'), 'viewer can view');
assert(canViewUtilityEnvReview('auditor'), 'auditor can view');
assert(canManageUtilityEnvReview('head_qa'), 'head_qa can manage');
assert(canManageUtilityEnvReview('engineering'), 'engineering (→engineering_manager) can manage');
assert(canManageUtilityEnvReview('maintenance'), 'maintenance can manage');
assert(canManageUtilityEnvReview('validation'), 'validation can manage');
assert(canAddUtilityEnvReview('production'), 'production (→production_manager) can add');
assert(canAddUtilityEnvReview('qc'), 'qc (→qc_manager) can add');
assert(canAddUtilityEnvReview('head_qa'), 'manage roles can also add');
assert(canExportUtilityEnvReview('auditor'), 'auditor can export');
assert(!canManageUtilityEnvReview('viewer'), 'viewer cannot manage');
assert(!canManageUtilityEnvReview('qc'), 'qc cannot manage');
assert(!canAddUtilityEnvReview('viewer'), 'viewer cannot add');
assert(!canExportUtilityEnvReview('production'), 'production cannot export');

// --- Form schema valid / invalid ---
const okForm = utilityEnvReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  reviewPeriodFrom: '2025-01-01',
  reviewPeriodTo: '2025-12-31',
  reviewType: 'Environmental Review',
  systemAreaName: 'Filling Room',
  monitoringParameter: 'Non-Viable Particle Count',
  cleanroomGrade: 'Grade A',
  lowerLimit: 0,
  upperLimit: 3520,
});
assert(okForm.success, 'valid utility/env form');

const badLimits = utilityEnvReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  reviewPeriodFrom: '2025-01-01',
  reviewPeriodTo: '2025-12-31',
  reviewType: 'Utility Review',
  systemAreaName: 'WFI Loop',
  monitoringParameter: 'WFI Conductivity',
  lowerLimit: 5,
  upperLimit: 5,
});
assert(!badLimits.success, 'upper<=lower fails refine');

const badPeriod = utilityEnvReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  reviewPeriodFrom: '2025-12-31',
  reviewPeriodTo: '2025-01-01',
  reviewType: 'Utility Review',
  systemAreaName: 'WFI Loop',
  monitoringParameter: 'WFI Conductivity',
  lowerLimit: 0,
  upperLimit: 1.3,
});
assert(!badPeriod.success, 'review period To before From fails');

// --- computeUtilityEnvCompliance scenarios ---
// Grade A excursion → Critical Observation, WITHOUT inventing product impact.
const gradeAExcursion = computeUtilityEnvCompliance({
  reviewType: 'Environmental Review',
  cleanroomGrade: 'Grade A',
  monitoringParameter: 'Viable Particle Count',
  excursionCount: 1,
  impactOnProductQuality: 'No',
});
assert(gradeAExcursion.complianceStatus === 'Critical Observation', 'Grade A excursion → Critical Observation');
assert(gradeAExcursion.riskLevel === 'Critical', 'Grade A excursion → Critical risk');

const compliant = computeUtilityEnvCompliance({
  reviewType: 'Utility Review',
  cleanroomGrade: 'Unclassified',
  monitoringParameter: 'WFI Conductivity',
  excursionCount: 0,
  alertCount: 0,
  actionCount: 0,
  impactOnProductQuality: 'No',
});
assert(compliant.complianceStatus === 'Complies', 'no excursion/alert/action → Complies');
assert(compliant.riskLevel === 'Low', 'compliant → Low risk');

const alertOnly = computeUtilityEnvCompliance({
  reviewType: 'Utility Review',
  monitoringParameter: 'HVAC Temperature',
  excursionCount: 0,
  alertCount: 2,
  actionCount: 0,
  impactOnProductQuality: 'No',
});
assert(alertOnly.complianceStatus === 'Observation', 'alerts only → Observation');

const wfiExcursion = computeUtilityEnvCompliance({
  reviewType: 'Utility Review',
  utilityType: 'Water for Injection',
  monitoringParameter: 'WFI Microbial Count',
  excursionCount: 1,
  impactOnProductQuality: 'No',
});
assert(wfiExcursion.complianceStatus === 'Critical Observation', 'WFI microbial excursion → Critical Observation');

// --- normalizeUtilityEnvReviewRecord ---
const stub = normalizeUtilityEnvReviewRecord({
  id: 'ue1',
  pqrId: 'p1',
  productName: 'Prod',
  reviewType: 'Utility Review',
  systemAreaName: 'WFI Loop',
  utilityType: 'Water for Injection',
  monitoringParameter: 'WFI Conductivity',
  excursionCount: 0,
  alertCount: 0,
  actionCount: 0,
});
assert(stub.product === 'Prod', 'normalize product from productName');
assert(stub.complianceStatus === 'Complies', 'normalize computes compliance when absent');
assert(stub.impactOnProductQuality === 'No', 'normalize defaults impact to No');

const records: PqrUtilityEnvironmentalReviewRecord[] = [
  stub,
  normalizeUtilityEnvReviewRecord({
    id: 'ue2',
    pqrId: 'p1',
    product: 'Prod',
    reviewType: 'Environmental Review',
    systemAreaName: 'Filling Room A',
    cleanroomGrade: 'Grade A',
    monitoringParameter: 'Viable Particle Count',
    excursionCount: 2,
    oosCount: 1,
    deviationCount: 1,
    capaCount: 1,
    changeControlCount: 1,
    riskLevel: 'Critical',
  }),
];

// --- filterUtilityEnvReviewRecords ---
const searchFiltered = filterUtilityEnvReviewRecords(records, { search: 'filling' });
assert(searchFiltered.length === 1 && searchFiltered[0].systemAreaName === 'Filling Room A', 'search filter');

const typeFiltered = filterUtilityEnvReviewRecords(records, { reviewType: 'Utility Review' });
assert(typeFiltered.length === 1 && typeFiltered[0].id === 'ue1', 'review type filter');

const gradeFiltered = filterUtilityEnvReviewRecords(records, { cleanroomGrade: 'Grade A' });
assert(gradeFiltered.length === 1 && gradeFiltered[0].id === 'ue2', 'cleanroom grade filter');

const riskFiltered = filterUtilityEnvReviewRecords(records, { riskLevel: 'Critical' });
assert(riskFiltered.length === 1 && riskFiltered[0].id === 'ue2', 'risk filter');

// --- summary totals ---
const summary = computeUtilityEnvSummary(records);
assert(summary.totalUtilityRecords === 1, 'summary utility total');
assert(summary.totalEnvironmentalRecords === 1, 'summary environmental total');
assert(summary.excursionRecords === 2, 'summary excursion count');
assert(summary.gradeAExcursions === 1, 'summary grade A excursion');
assert(summary.oosCount === 1, 'summary oos count');
assert(summary.deviationCount === 1, 'summary deviation count');
assert(summary.capaCount === 1, 'summary capa count');
assert(summary.changeControlCount === 1, 'summary change control count');
assert(summary.openCriticalRisks === 1, 'summary critical risks');

const narrative = generateUtilityEnvNarrative(summary, records);
assert(narrative.toLowerCase().includes('excursion'), 'narrative mentions excursion');
assert(narrative.toLowerCase().includes('grade a/b'), 'narrative mentions grade A/B excursion');

// Empty-set narrative must NOT falsely claim all utilities comply.
const emptyNarrative = generateUtilityEnvNarrative(computeUtilityEnvSummary([]), []);
assert(emptyNarrative.toLowerCase().includes('no utility or environmental monitoring data'), 'empty narrative is honest');

console.log('PQR Utility & Environmental Review logic validation passed.');
