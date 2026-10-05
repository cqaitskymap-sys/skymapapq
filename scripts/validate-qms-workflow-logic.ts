/**
 * Pure QMS workflow checks. Run: npx tsx scripts/validate-qms-workflow-logic.ts
 */
import assert from 'node:assert/strict';
import { computeClosureReadiness } from '../lib/deviation-closure-records';
import { isCapaSatisfiedForClosure } from '../lib/deviation-capa-records';
import { isComplaintCapaSatisfiedForClosure } from '../lib/complaint-capa-records';
import { computeCapaClosureReadiness } from '../lib/capa-closure-records';
import { computeResultStatus } from '../lib/oos-types';
import { clampScore, calculateRpn, enrichFmeaRow } from '../lib/risk-fmea-records';
import { evaluateStabilityStatus } from '../lib/cpv-stability-monitoring';
import { autoResultStatus } from '../lib/pqr-stability-review-records';
import { assertRecordMutable, addCalendarDays, localCalendarDate, isAcceptableEffectiveness } from '../lib/qms-record-guard';
import { capaDecisionComplete } from '../lib/complaint-closure-records';
import type { CapaRecord } from '../lib/capa-types';

const capa = {
  capa_status: 'approved',
  effectiveness_check_required: true,
  effectiveness_result: 'Effective',
} as CapaRecord;

assert.equal(isCapaSatisfiedForClosure(capa, true), false, 'approved CAPA must not satisfy deviation closure');
assert.equal(isComplaintCapaSatisfiedForClosure({ ...capa, capa_status: 'closed', effectiveness_result: 'Partially Effective' }, true), false);
assert.equal(isCapaSatisfiedForClosure({ ...capa, capa_status: 'closed', effectiveness_result: 'Effective' }, true), true);
assert.equal(isAcceptableEffectiveness('Partially Effective', true), false);

assert.throws(() => assertRecordMutable('closed', undefined, 'deviation'), /controlled reopen/);
assert.doesNotThrow(() => assertRecordMutable('closed', { reopen: true }, 'deviation'));
assert.doesNotThrow(() => assertRecordMutable('qa_review'));

const readiness = computeClosureReadiness({
  record: { id: '1', deviation_number: 'DEV-1', status: 'qa_review', capa_required: true } as never,
  investigation: null,
  impact: null,
  capa: null,
  capaLink: null,
  approvals: [{ approval_status: 'Pending' } as never],
  attachments: [],
  form: {
    investigation_completed: true,
    impact_assessment_completed: true,
    root_cause_identified: true,
    capa_required: false,
    capa_linked: true,
    capa_completed: true,
    effectiveness_check_completed: true,
    product_quality_impact_resolved: true,
    patient_safety_impact_resolved: true,
    regulatory_impact_resolved: true,
    all_attachments_reviewed: true,
    qa_closure_comments: 'ok',
    final_closure_conclusion: 'ok',
  },
});
assert.equal(readiness.ready, false);
assert.ok(readiness.blockers.some((item) => item.includes('Investigation')));

const capaReady = computeCapaClosureReadiness({
  capa: { effectiveness_check_required: true, effectiveness_result: 'Pending' } as CapaRecord,
  investigationStatus: 'Approved',
  correctiveActions: [],
  preventiveActions: [],
  effectiveness: null,
  approvals: [],
  attachmentCount: 0,
  form: {
    corrective_actions_completed: true,
    preventive_actions_completed: true,
    implementation_verified: true,
    evidence_uploaded: true,
    effectiveness_check_completed: true,
    effectiveness_result: 'Effective',
    risk_reduced: true,
    root_cause_eliminated: true,
    recurrence_prevented: true,
    training_completed: true,
    sop_updated: true,
    change_control_completed: true,
    all_evidence_reviewed: true,
    qa_closure_comments: '',
    final_closure_conclusion: '',
  },
});
assert.equal(capaReady.ready, false, 'checkbox overrides must not close an empty CAPA');

assert.equal(computeResultStatus(Number.NaN, 1, 2), 'Under Review');
assert.equal(computeResultStatus(5, 1, 10), 'Pass');
assert.equal(computeResultStatus(11, 1, 10), 'OOS');
assert.equal(clampScore(Number.NaN), 0);
assert.equal(calculateRpn(Number.NaN, 2, 3), 0);

const fmea = enrichFmeaRow({
  failure_mode_id: '1',
  process_step: 'Mix',
  failure_mode: 'Fail',
  potential_effect: 'Effect',
  potential_cause: 'Cause',
  existing_control: 'None',
  severity: 8,
  occurrence: 4,
  detection: 4,
  rpn: 0,
  risk_priority: '',
  mitigation_required: false,
  mitigation_action: '',
  action_owner: '',
  target_date: '',
  residual_severity: 0,
  residual_occurrence: 0,
  residual_detection: 0,
  residual_rpn: 0,
  residual_risk_priority: '',
  status: 'Draft',
});
assert.equal(fmea.rpn, 128);
assert.equal(fmea.residual_rpn, 0);
assert.equal(fmea.residual_risk_priority, 'Not Assessed');

assert.equal(evaluateStabilityStatus('PASSED', 0, 1, 'Pass/Fail'), 'Complies');
assert.equal(evaluateStabilityStatus('mystery', 0, 100, 'Numeric'), 'Under Review');
assert.equal(evaluateStabilityStatus(95, 90, 110, 'Numeric', 98, 105), 'OOT');
assert.equal(evaluateStabilityStatus(80, 90, 110, 'Numeric'), 'OOS');
assert.equal(autoResultStatus('mystery', 0, 100, 'Unknown Parameter'), 'Under Review');

assert.equal(capaDecisionComplete({ status: 'open' } as never, { id: 'impact' } as never, null), false);
assert.equal(capaDecisionComplete({ status: 'open', capa_required: false } as never, null, null), true);

const today = localCalendarDate(new Date(2026, 9, 3));
assert.equal(today, '2026-10-03');
assert.equal(addCalendarDays(today, 7), '2026-10-10');

console.log('QMS workflow logic checks passed');
