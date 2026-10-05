export type PasswordPolicyInput = {
  minPasswordLength?: unknown;
  minLength?: unknown;
  requireUppercase?: unknown;
  requireLowercase?: unknown;
  requireNumber?: unknown;
  requireSpecialChar?: unknown;
};

export type EffectivePasswordRules = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSpecialChar: boolean;
};

const PASSWORD_FLOOR = 12;

/** Policy may raise the temporary-password bar. It cannot drop below the current floor. */
export function effectivePasswordRules(policy?: PasswordPolicyInput | null): EffectivePasswordRules {
  const raw = Number(policy?.minPasswordLength ?? policy?.minLength ?? PASSWORD_FLOOR);
  const minLength = Number.isFinite(raw)
    ? Math.max(PASSWORD_FLOOR, Math.min(128, Math.floor(raw)))
    : PASSWORD_FLOOR;
  return {
    minLength,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecialChar: true,
  };
}

export function passwordPolicyError(password: string, policy?: PasswordPolicyInput | null): string | null {
  const rules = effectivePasswordRules(policy);
  if (
    password.length < rules.minLength
    || (rules.requireUppercase && !/[A-Z]/.test(password))
    || (rules.requireLowercase && !/[a-z]/.test(password))
    || (rules.requireNumber && !/\d/.test(password))
    || (rules.requireSpecialChar && !/[^A-Za-z0-9]/.test(password))
  ) {
    const classes = [
      rules.requireUppercase ? 'upper' : '',
      rules.requireLowercase ? 'lower' : '',
      rules.requireNumber ? 'number' : '',
      rules.requireSpecialChar ? 'special' : '',
    ].filter(Boolean).join(', ');
    return `Temporary password must be at least ${rules.minLength} characters and include ${classes} characters`;
  }
  return null;
}

export function wouldRemoveLastSuperAdmin(input: {
  targetIsActiveSuperAdmin: boolean;
  remainsActiveSuperAdmin: boolean;
  activeSuperAdminCount: number;
}): boolean {
  if (!input.targetIsActiveSuperAdmin || input.remainsActiveSuperAdmin) return false;
  return input.activeSuperAdminCount <= 1;
}

export function approveChainHasCycle(
  steps: Array<{ stepName: string; nextStepOnApprove?: string }>,
): boolean {
  const next = new Map<string, string>();
  for (const step of steps) {
    if (step.nextStepOnApprove) next.set(step.stepName, step.nextStepOnApprove);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (name: string): boolean => {
    if (visiting.has(name)) return true;
    if (visited.has(name)) return false;
    visiting.add(name);
    const target = next.get(name);
    if (target && walk(target)) return true;
    visiting.delete(name);
    visited.add(name);
    return false;
  };
  return steps.some((step) => walk(step.stepName));
}

const SENSITIVE_KEY = /password|secret|token|hash|credential/i;

export function redactSensitiveFields(record: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!SENSITIVE_KEY.test(key)) copy[key] = value;
  }
  return copy;
}
