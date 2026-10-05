/**
 * PQR integrity checks for classification, matching, and conclusions.
 * Run: npx tsx scripts/validate-pqr-integrity-logic.ts
 */
import assert from 'node:assert/strict';
import {
  computeBatchSummary,
  isReleasedBatch,
  isRejectedBatch,
  statusMeansReleased,
} from '../lib/pqr-batch-review-records';
import { computeOverallAssessment } from '../lib/pqr-create-service';
import { emptyCollectedSummary } from '../lib/pqr-create-records';
import { canTransitionPqrStatus } from '../lib/pqr-dashboard-records';
import type { PqrBatchReviewRecord } from '../lib/pqr-batch-review-records';

function batch(partial: Partial<PqrBatchReviewRecord>): PqrBatchReviewRecord {
  return {
    batchStatus: 'Manufactured',
    releaseStatus: 'Pending',
    isDeleted: false,
    linkedDeviationCount: 0,
    linkedOosCount: 0,
    linkedCapaCount: 0,
    reworkRequired: false,
    reprocessRequired: false,
    ...partial,
  } as PqrBatchReviewRecord;
}

assert.equal(statusMeansReleased('Not Released'), false);
assert.equal(statusMeansReleased('Pending Release'), false);
assert.equal(statusMeansReleased('Released'), true);
assert.equal(isReleasedBatch(batch({ releaseStatus: 'Not Released' })), false);
assert.equal(isRejectedBatch(batch({ batchStatus: 'Rejected', releaseStatus: 'Released' })), true);
assert.equal(isReleasedBatch(batch({ batchStatus: 'Rejected', releaseStatus: 'Released' })), false);

const summary = computeBatchSummary([
  batch({ releaseStatus: 'Released', theoreticalYield: 100, actualYield: 0, yieldPct: 0 }),
  batch({ releaseStatus: 'Not Released' }),
  batch({ batchStatus: 'Rejected', releaseStatus: 'Released' }),
]);
assert.equal(summary.releasedBatches, 1);
assert.equal(summary.rejectedBatches, 1);
assert.equal(summary.avgYieldPct, 0);

const empty = computeOverallAssessment(emptyCollectedSummary());
assert.equal(empty.conclusion.toLowerCase().includes('all batches manufactured'), false);
assert.equal(empty.conclusion.toLowerCase().includes('no batches were identified'), true);
assert.equal(empty.conclusion.toLowerCase().includes('process capability data was not available'), true);
assert.equal(empty.conclusion.toLowerCase().includes('remains within approved specification'), false);

const partial = computeOverallAssessment({
  ...emptyCollectedSummary(),
  totalBatches: 4,
  releasedBatches: 2,
  rejectedBatches: 0,
});
assert.equal(partial.conclusion.includes('2 of 4'), true);

assert.equal(canTransitionPqrStatus('Approved', 'Draft'), false);
assert.equal(canTransitionPqrStatus('Approved', 'Closed'), true);
assert.equal(canTransitionPqrStatus('Archived', 'Under Review'), false);

console.log('PQR integrity logic checks passed');
