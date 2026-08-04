/**
 * Pure-logic checks for Create Annual PQR.
 * Run: npx tsx scripts/validate-pqr-create-logic.ts
 */
import {
  ALWAYS_INCLUDED_SECTIONS,
  SCOPE_TO_SECTIONS,
  canCreateAnnualPqr,
  defaultReviewScope,
  emptyCollectedSummary,
  reviewPeriodSchema,
} from '../lib/pqr-create-records';
import { computeOverallAssessment } from '../lib/pqr-create-service';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(canCreateAnnualPqr('qa'), 'qa can create via normalize');
assert(canCreateAnnualPqr('qa_manager'), 'qa_manager can create');
assert(!canCreateAnnualPqr('viewer'), 'viewer cannot create');

const okPeriod = reviewPeriodSchema.safeParse({
  reviewPeriodFrom: '2025-01-01',
  reviewPeriodTo: '2025-12-31',
  reviewYear: 2025,
  pqrFrequency: 'Yearly',
  dueDate: '2026-03-31',
  allowFuture: true,
});
assert(okPeriod.success, 'valid period');

const badPeriod = reviewPeriodSchema.safeParse({
  reviewPeriodFrom: '2025-12-31',
  reviewPeriodTo: '2025-01-01',
  reviewYear: 2025,
  pqrFrequency: 'Yearly',
  dueDate: '2026-03-31',
});
assert(!badPeriod.success, 'end before start fails');

const scope = defaultReviewScope();
assert(scope.batchReview && scope.conclusionRecommendation, 'default scope required keys');
assert((ALWAYS_INCLUDED_SECTIONS as readonly string[]).includes('cover_page'), 'cover always included');
assert(Boolean(SCOPE_TO_SECTIONS.batchReview?.includes('batch_manufacturing')), 'scope maps sections');

const emptyAssess = computeOverallAssessment(emptyCollectedSummary());
assert(emptyAssess.conclusion.toLowerCase().includes('stability') || emptyAssess.conclusion.length > 20, 'assessment produces conclusion');
assert(!emptyAssess.conclusion.toLowerCase().includes('remains within approved specification')
  || emptyCollectedSummary().stabilityRecords > 0, 'no false stability claim when zero records');

const critical = computeOverallAssessment({
  ...emptyCollectedSummary(),
  recalls: 1,
  openCriticalOos: 1,
});
assert(critical.overallRiskLevel === 'Critical', 'critical risk');

console.log('PQR create logic validation passed.');
