/**
 * Pure-logic checks for PQR Batch Review.
 * Run: npx tsx scripts/validate-pqr-batch-review-logic.ts
 */
import {
  batchReviewFormSchema,
  canAddBatchReview,
  canExportBatchReview,
  canManageBatchReview,
  canViewBatchReview,
  computeBatchSummary,
  computeYieldPct,
  filterBatchReviewRecords,
  generateBatchNarrative,
  isRejectedBatch,
  isReleasedBatch,
  normalizeBatchReviewRecord,
  pqrSectionHref,
  type PqrBatchReviewRecord,
} from '../lib/pqr-batch-review-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(canViewBatchReview('qa'), 'qa can view via normalizeRole');
assert(canViewBatchReview('QA Manager'), 'QA Manager can view');
assert(canManageBatchReview('head_qa'), 'head_qa can manage');
assert(canAddBatchReview('production_manager'), 'production can add');
assert(canExportBatchReview('auditor'), 'auditor can export');
assert(!canManageBatchReview('viewer'), 'viewer cannot manage');

const ok = batchReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  batchNumber: 'B-001',
  manufacturingDate: '2025-01-15',
  expiryDate: '2026-01-15',
  batchSize: 1000,
  batchSizeUnit: 'Vials',
  batchStatus: 'Released',
  releaseStatus: 'Released',
});
assert(ok.success, 'valid batch form');

const badDates = batchReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  batchNumber: 'B-001',
  manufacturingDate: '2026-01-15',
  expiryDate: '2025-01-15',
  batchSize: 1000,
  batchStatus: 'Manufactured',
  releaseStatus: 'Pending',
});
assert(!badDates.success, 'expiry before mfg fails');

const rejectedNeedsReason = batchReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  batchNumber: 'B-002',
  manufacturingDate: '2025-01-15',
  expiryDate: '2026-01-15',
  batchSize: 1000,
  batchStatus: 'Rejected',
  releaseStatus: 'Rejected',
  rejectionReason: '',
});
assert(!rejectedNeedsReason.success, 'rejected requires reason');

assert(computeYieldPct(100, 95) === 95, 'yield pct');
assert(computeYieldPct(0, 10) === null, 'zero theoretical yield is unavailable');
assert(computeYieldPct(null, 10) === null, 'missing theoretical is unavailable');

const stub = normalizeBatchReviewRecord({
  id: 'x1',
  pqrId: 'p1',
  productName: 'Legacy Product',
  product_code: 'LP-1',
  batch_number: 'BN-9',
  status: 'Pending',
  manufacturing_date: '2025-03-01',
  theoreticalYield: 100,
  actualYield: 90,
});
assert(stub.product === 'Legacy Product', 'normalize productName');
assert(stub.batchNumber === 'BN-9', 'normalize batch number');
assert(stub.batchStatus === 'Manufactured', 'Pending status maps to Manufactured');
assert(stub.yieldPct === 90, 'normalize computes yield');

const records: PqrBatchReviewRecord[] = [
  {
    ...stub,
    batchStatus: 'Released',
    releaseStatus: 'Released',
    linkedDeviationCount: 1,
    linkedOosCount: 2,
    linkedCapaCount: 0,
    isDeleted: false,
  },
  {
    ...normalizeBatchReviewRecord({
      id: 'x2',
      pqrId: 'p1',
      product: 'Legacy Product',
      productCode: 'LP-1',
      batchNumber: 'BN-10',
      batchStatus: 'Rejected',
      releaseStatus: 'Rejected',
      manufacturingDate: '2025-04-01',
      linkedDeviationCount: 0,
      linkedOosCount: 0,
      linkedCapaCount: 1,
    }),
  },
];

assert(isReleasedBatch(records[0]), 'released detector');
assert(isRejectedBatch(records[1]), 'rejected detector');

const summary = computeBatchSummary(records);
assert(summary.totalBatches === 2, 'summary total');
assert(summary.releasedBatches === 1, 'summary released');
assert(summary.rejectedBatches === 1, 'summary rejected');
assert(summary.totalDeviations === 1, 'summary deviations');
assert(summary.totalOos === 2, 'summary oos');
assert(summary.totalCapa === 1, 'summary capa');
assert(summary.avgYieldPct === 90, 'avg yield ignores missing');

const narrative = generateBatchNarrative(summary);
assert(narrative.toLowerCase().includes('rejected'), 'narrative mentions rejection');
assert(narrative.includes('90%'), 'narrative includes avg yield');

const filtered = filterBatchReviewRecords(records, { search: 'BN-10', batchStatus: 'all' });
assert(filtered.length === 1 && filtered[0].batchNumber === 'BN-10', 'search filter');

assert(pqrSectionHref('/pqr/materials', 'abc') === '/pqr/materials?pqrId=abc', 'section href retains pqrId');
assert(pqrSectionHref('/pqr/dashboard', 'abc') === '/pqr/dashboard', 'dashboard href unchanged');

console.log('PQR batch review logic validation passed.');
