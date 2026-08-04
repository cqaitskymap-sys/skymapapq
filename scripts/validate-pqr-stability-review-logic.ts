/**
 * Pure-logic checks for PQR Stability Review.
 * Run: npx tsx scripts/validate-pqr-stability-review-logic.ts
 */
import {
  canAddStabilityReview,
  canExportStabilityReview,
  canManageStabilityReview,
  canPullStabilityReview,
  canUpdateSamplePulling,
  canUpdateStabilityTestData,
  canViewStabilityReview,
  computeStabilityCompliance,
  computeStabilityReviewSummary,
  filterStabilityReviewRecords,
  generateStabilityNarrative,
  normalizeStabilityReviewRecord,
  stabilityReviewFormSchema,
  type PqrStabilityReviewRecord,
} from '../lib/pqr-stability-review-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- Role checks (via normalizeRole) ---
assert(canViewStabilityReview('qa'), 'qa (→qa_manager) can view');
assert(canViewStabilityReview('QA Manager'), 'QA Manager can view');
assert(canViewStabilityReview('head_qa'), 'head_qa can view');
assert(canViewStabilityReview('qc'), 'qc (→qc_manager) can view');
assert(canViewStabilityReview('warehouse'), 'warehouse (→warehouse_manager) can view');
assert(canViewStabilityReview('viewer'), 'viewer can view');
assert(canViewStabilityReview('auditor'), 'auditor can view');

assert(canManageStabilityReview('qa'), 'qa (→qa_manager) can manage (was broken before)');
assert(canManageStabilityReview('head_qa'), 'head_qa can manage');
assert(canManageStabilityReview('qa_executive'), 'qa_executive can manage');
assert(!canManageStabilityReview('qc'), 'qc cannot manage');
assert(!canManageStabilityReview('viewer'), 'viewer cannot manage');
assert(!canManageStabilityReview('warehouse'), 'warehouse cannot manage');

assert(canAddStabilityReview('qa'), 'qa can add');
assert(canAddStabilityReview('qc'), 'qc (→qc_manager) can add');
assert(canAddStabilityReview('warehouse'), 'warehouse can add');
assert(!canAddStabilityReview('viewer'), 'viewer cannot add');

assert(canPullStabilityReview('qa'), 'qa can pull');
assert(canPullStabilityReview('warehouse'), 'warehouse can pull');
assert(!canPullStabilityReview('qc'), 'qc cannot pull');

assert(canUpdateStabilityTestData('qc'), 'qc can update test data');
assert(canUpdateStabilityTestData('head_qa'), 'head_qa can update test data');
assert(!canUpdateStabilityTestData('warehouse'), 'warehouse cannot update test data');

assert(canUpdateSamplePulling('warehouse'), 'warehouse can update sample pulling');
assert(canUpdateSamplePulling('qa'), 'qa (→qa_manager) can update sample pulling');
assert(!canUpdateSamplePulling('qc'), 'qc cannot update sample pulling');

assert(canExportStabilityReview('auditor'), 'auditor can export');
assert(canExportStabilityReview('qa'), 'qa can export');
assert(!canExportStabilityReview('qc'), 'qc cannot export');

// --- Form schema valid / invalid ---
const okForm = stabilityReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  batchNumber: 'B-001',
  studyType: 'Long Term',
  storageCondition: '25°C / 60% RH',
  pullingInterval: '6 Month',
  testDate: '2025-06-15',
  parameterName: 'Assay',
  observedResult: 98,
  lowerLimit: 90,
  upperLimit: 110,
});
assert(okForm.success, 'valid stability form');

const badLimits = stabilityReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  batchNumber: 'B-001',
  studyType: 'Long Term',
  storageCondition: '25°C / 60% RH',
  pullingInterval: '6 Month',
  testDate: '2025-06-15',
  parameterName: 'Assay',
  observedResult: 98,
  lowerLimit: 5,
  upperLimit: 5,
});
assert(!badLimits.success, 'upper<=lower fails refine');

// --- computeStabilityCompliance scenarios ---
// OOS → Critical Observation, WITHOUT inventing product-quality impact.
const oos = computeStabilityCompliance({
  parameterName: 'Assay',
  resultStatus: 'OOS',
  oosCount: 1,
  impactOnProductQuality: 'No',
  impactOnShelfLife: 'No',
});
assert(oos.complianceStatus === 'Critical Observation', 'OOS → Critical Observation');
assert(oos.riskLevel === 'Critical', 'OOS → Critical risk');
assert(!oos.complianceReasons.includes('Product quality impact identified'),
  'OOS alone must NOT auto-flag product quality impact when impact fields are No');

const compliant = computeStabilityCompliance({
  parameterName: 'Assay',
  resultStatus: 'Complies',
  ootCount: 0,
  oosCount: 0,
  samplePullStatus: 'Pulled',
  impactOnProductQuality: 'No',
  impactOnShelfLife: 'No',
});
assert(compliant.complianceStatus === 'Complies', 'no OOT/OOS/miss → Complies');
assert(compliant.riskLevel === 'Low', 'compliant → Low risk');

const oot = computeStabilityCompliance({
  parameterName: 'pH',
  resultStatus: 'OOT',
  ootCount: 1,
  oosCount: 0,
  impactOnProductQuality: 'No',
  impactOnShelfLife: 'No',
});
assert(oot.complianceStatus === 'Observation', 'OOT → Observation');

// Explicit impact escalates to Critical.
const impact = computeStabilityCompliance({
  parameterName: 'Assay',
  resultStatus: 'Complies',
  impactOnProductQuality: 'Yes',
});
assert(impact.complianceStatus === 'Critical Observation', 'explicit product impact → Critical Observation');

// --- normalizeStabilityReviewRecord ---
const stub = normalizeStabilityReviewRecord({
  id: 's1',
  pqrId: 'p1',
  productName: 'Prod',
  batchNumber: 'B-001',
  studyNumber: 'STB-1',
  studyType: 'Long Term',
  storageCondition: '25°C / 60% RH',
  pullingInterval: 'Initial',
  parameterName: 'Assay',
  observedResult: 99,
  lowerLimit: 90,
  upperLimit: 110,
  resultStatus: 'Complies',
});
assert(stub.product === 'Prod', 'normalize product from productName');
assert(stub.complianceStatus === 'Complies', 'normalize computes compliance when absent');
assert(stub.impactOnProductQuality === 'No', 'normalize defaults impact to No');

const records: PqrStabilityReviewRecord[] = [
  stub,
  // Same study (STB-1) different parameter — must NOT be counted as a second study.
  normalizeStabilityReviewRecord({
    id: 's2',
    pqrId: 'p1',
    product: 'Prod',
    batchNumber: 'B-001',
    studyNumber: 'STB-1',
    studyType: 'Long Term',
    storageCondition: '25°C / 60% RH',
    pullingInterval: '6 Month',
    parameterName: 'pH',
    observedResult: 7.0,
    lowerLimit: 6.8,
    upperLimit: 7.2,
    resultStatus: 'Complies',
  }),
  normalizeStabilityReviewRecord({
    id: 's3',
    pqrId: 'p1',
    product: 'Prod',
    batchNumber: 'B-002',
    studyNumber: 'STB-2',
    studyType: 'Accelerated',
    storageCondition: '40°C / 75% RH',
    pullingInterval: '3 Month',
    parameterName: 'Assay',
    observedResult: 85,
    lowerLimit: 90,
    upperLimit: 110,
    resultStatus: 'OOS',
    oosCount: 1,
    riskLevel: 'Critical',
  }),
];

// --- filterStabilityReviewRecords ---
const searchFiltered = filterStabilityReviewRecords(records, { search: 'STB-2' });
assert(searchFiltered.length === 1 && searchFiltered[0].id === 's3', 'search filter');

const typeFiltered = filterStabilityReviewRecords(records, { studyType: 'Accelerated' });
assert(typeFiltered.length === 1 && typeFiltered[0].id === 's3', 'study type filter');

const batchFiltered = filterStabilityReviewRecords(records, { batch: 'B-001' });
assert(batchFiltered.length === 2, 'batch filter');

const riskFiltered = filterStabilityReviewRecords(records, { riskLevel: 'Critical' });
assert(riskFiltered.length === 1 && riskFiltered[0].id === 's3', 'risk filter');

// --- summary totals (UNIQUE studies, not raw rows) ---
const summary = computeStabilityReviewSummary(records);
assert(summary.totalStabilityStudies === 2, 'summary counts 2 unique studies (STB-1, STB-2)');
assert(summary.totalStabilityBatches === 2, 'summary batches');
assert(summary.longTermStudies === 1, 'longTermStudies counts unique study, not rows');
assert(summary.acceleratedStudies === 1, 'acceleratedStudies unique');
assert(summary.oosResults === 1, 'summary oos results');
assert(summary.compliantResults === 2, 'summary compliant results');

const narrative = generateStabilityNarrative(summary, records);
assert(narrative.toLowerCase().includes('oos'), 'narrative mentions OOS');

// Empty-set narrative must NOT falsely claim all comply.
const emptyNarrative = generateStabilityNarrative(computeStabilityReviewSummary([]), []);
assert(emptyNarrative.toLowerCase().includes('no stability study data'), 'empty narrative is honest');

console.log('PQR Stability Review logic validation passed.');
