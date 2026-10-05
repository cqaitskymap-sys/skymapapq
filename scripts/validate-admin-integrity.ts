import assert from 'node:assert/strict';
import {
  approveChainHasCycle,
  effectivePasswordRules,
  passwordPolicyError,
  redactSensitiveFields,
  wouldRemoveLastSuperAdmin,
} from '../functions/src/account-guards';

const baseline = effectivePasswordRules(null);
assert.equal(baseline.minLength, 12);
assert.equal(passwordPolicyError('Short1!a', null) !== null, true);
assert.equal(passwordPolicyError('LongEnough1!a', null), null);

const raised = effectivePasswordRules({ minPasswordLength: 16 });
assert.equal(raised.minLength, 16);
assert.equal(passwordPolicyError('LongEnough1!a', { minPasswordLength: 16 }) !== null, true);
assert.equal(passwordPolicyError('LongerPassword1!a', { minPasswordLength: 16 }), null);

const weakened = effectivePasswordRules({ minPasswordLength: 6, requireSpecialChar: false });
assert.equal(weakened.minLength, 12);
assert.equal(weakened.requireSpecialChar, true);
assert.equal(passwordPolicyError('LongEnough1abc', { requireSpecialChar: false }) !== null, true);

assert.equal(wouldRemoveLastSuperAdmin({
  targetIsActiveSuperAdmin: true,
  remainsActiveSuperAdmin: false,
  activeSuperAdminCount: 1,
}), true);
assert.equal(wouldRemoveLastSuperAdmin({
  targetIsActiveSuperAdmin: true,
  remainsActiveSuperAdmin: true,
  activeSuperAdminCount: 1,
}), false);
assert.equal(wouldRemoveLastSuperAdmin({
  targetIsActiveSuperAdmin: true,
  remainsActiveSuperAdmin: false,
  activeSuperAdminCount: 2,
}), false);
assert.equal(wouldRemoveLastSuperAdmin({
  targetIsActiveSuperAdmin: false,
  remainsActiveSuperAdmin: false,
  activeSuperAdminCount: 1,
}), false);

assert.equal(approveChainHasCycle([
  { stepName: 'Review', nextStepOnApprove: 'Approve' },
  { stepName: 'Approve', nextStepOnApprove: 'End' },
  { stepName: 'End' },
]), false);
assert.equal(approveChainHasCycle([
  { stepName: 'Review', nextStepOnApprove: 'Approve' },
  { stepName: 'Approve', nextStepOnApprove: 'Review' },
]), true);

const redacted = redactSensitiveFields({
  email: 'a@b.com',
  password: 'secret',
  passwordHash: 'abc',
  role: 'admin',
});
assert.equal(redacted.email, 'a@b.com');
assert.equal('password' in redacted, false);
assert.equal('passwordHash' in redacted, false);
assert.equal(redacted.role, 'admin');

console.log('Administration integrity checks passed');
