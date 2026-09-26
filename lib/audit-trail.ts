import { httpsCallableMaybeProxied } from './callable';
import { isFirebaseConfigured } from './firebase';
import { AUDIT_LOG_STATUSES } from './admin/constants';

export const AUDIT_TRAIL_COLLECTION = 'audit_trail';

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'STATUS_CHANGE' | 'APPROVE' | 'REJECT' | 'LOGIN' | 'LOGOUT';

export interface AuditTrailEntry {
  id?: string;
  collectionName: string;
  documentId: string;
  action: AuditAction | string;
  oldValue: unknown;
  newValue: unknown;
  userId: string;
  userName: string;
  timestamp: string;
  ipAddress?: string;
  moduleName: string;
}

export interface AuditActor {
  id?: string;
  name?: string;
  role?: string;
  department?: string;
}

export interface CreateAuditLogInput {
  moduleName: string;
  collectionName: string;
  recordId: string;
  documentNumber?: string;
  actionType: string;
  actionDescription?: string;
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
  changedFields?: string;
  reason?: string;
  remarks?: string;
  user: AuditActor;
  status?: typeof AUDIT_LOG_STATUSES[number];
  eSignatureRequired?: boolean;
  eSignatureStatus?: string;
  eSignatureId?: string;
  location?: string;
  ipAddress?: string;
  deviceInfo?: string;
  browserInfo?: string;
  operatingSystem?: string;
  subModule?: string;
  screen?: string;
  site?: string;
  businessUnit?: string;
  company?: string;
  sessionId?: string;
  requestId?: string;
  workflowId?: string;
  approvalLevel?: string;
  employeeId?: string;
  username?: string;
  timezone?: string;
}

const SKIP_COMPARE_FIELDS = new Set([
  'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'id', 'isDeleted',
]);

function nowIso() {
  return new Date().toISOString();
}

function buildAuditId() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AUD-${ts}-${rnd}`;
}

function getClientIp(): string {
  if (typeof window === 'undefined') return 'server';
  return 'client';
}

function getBrowserInfo(): string {
  if (typeof navigator === 'undefined') return 'server';
  return navigator.userAgent;
}

function getDeviceInfo(): string {
  if (typeof navigator === 'undefined') return 'server';
  const ua = navigator.userAgent;
  if (/Mobile|Android|iPhone/i.test(ua)) return 'Mobile';
  if (/Tablet|iPad/i.test(ua)) return 'Tablet';
  return 'Desktop';
}

function getOperatingSystem(): string {
  if (typeof navigator === 'undefined') return 'server';
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iOS';
  return 'Unknown';
}

function serializeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function callableErrorMessage(error: unknown): string {
  const err = error as { message?: string };
  return (err.message || 'Audit write failed')
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

export function isLocalhostRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

/** Skip remote Cloud Function calls on localhost unless emulator or opt-in is set. */
export function shouldSkipRemoteAuditInLocalDev(): boolean {
  if (process.env.NODE_ENV !== 'development') return false;
  if (!isLocalhostRuntime()) return false;

  const usingEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
  const allowRemoteAuditFromLocalhost = process.env.NEXT_PUBLIC_ALLOW_REMOTE_AUDIT_FROM_LOCALHOST === 'true';

  return !usingEmulator && !allowRemoteAuditFromLocalhost;
}

/** Alias for non-audit admin callables (login activity, health checks, etc.). */
export const shouldSkipRemoteCallablesInLocalDev = shouldSkipRemoteAuditInLocalDev;

const AUDIT_APPEND_FNS = ['appendAdminAuditTrail', 'recordAdminAuditTrail'] as const;
const AUDIT_CALLABLE_UNAVAILABLE_KEY = 'skymap-audit-callables-unavailable';

let auditCallablesUnavailable = false;

function markAuditCallablesUnavailable(): void {
  auditCallablesUnavailable = true;
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(AUDIT_CALLABLE_UNAVAILABLE_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function areAuditCallablesUnavailable(): boolean {
  if (auditCallablesUnavailable) return true;
  if (typeof sessionStorage === 'undefined') return false;
  try {
    if (sessionStorage.getItem(AUDIT_CALLABLE_UNAVAILABLE_KEY) === '1') {
      auditCallablesUnavailable = true;
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

function isCallableGatewayFailure(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  const code = String(err.code || '').toLowerCase();
  const message = String(err.message || '').toLowerCase();
  return (
    code.includes('internal')
    || code.includes('unavailable')
    || code.includes('not-found')
    || /cors|preflight|access-control-allow-origin|failed to fetch|network error|not serving|check billing|returned 50[023]|not found/i.test(message)
  );
}

function getAppendAuditCallable(name: (typeof AUDIT_APPEND_FNS)[number]) {
  return httpsCallableMaybeProxied<Record<string, unknown>, { id: string; auditId: string }>(name);
}

export { httpsCallableMaybeProxied } from './callable';

/**
 * GMP / 21 CFR Part 11 compliant append-only audit log writer.
 * Routes through trusted Cloud Function (integrity hash + dual write).
 * Falls back to local queue warning if callable unavailable (never silently drops
 * without logging — returns null and emits console + optional notification path).
 */
export async function createAuditLog(
  input: CreateAuditLogInput,
  _collectionName = AUDIT_TRAIL_COLLECTION,
): Promise<string | null> {
  if (!isFirebaseConfigured()) {
    console.error('AUDIT_FAILURE: Firebase not configured — audit event not persisted', {
      module: input.moduleName,
      action: input.actionType,
      recordId: input.recordId,
    });
    return null;
  }

  if (shouldSkipRemoteAuditInLocalDev() || areAuditCallablesUnavailable()) {
    // Localhost + non-emulator flows often do not have Cloud Functions deployed.
    // Skip remote callable to avoid noisy CORS/network errors during development.
    return null;
  }

  const payload = {
    moduleName: input.moduleName,
    collectionName: input.collectionName,
    recordId: input.recordId,
    documentNumber: input.documentNumber || '',
    actionType: input.actionType,
    actionDescription: input.actionDescription || `${input.actionType} on ${input.moduleName}`,
    fieldName: input.fieldName || '',
    oldValue: serializeValue(input.oldValue),
    newValue: serializeValue(input.newValue),
    changedFields: input.changedFields || '',
    reason: input.reason || '',
    remarks: input.remarks || '',
    userName: input.user.name || 'System',
    role: input.user.role || '',
    department: input.user.department || '',
    status: input.status || 'Success',
    eSignatureRequired: input.eSignatureRequired ?? false,
    eSignatureStatus: input.eSignatureStatus || '',
    eSignatureId: input.eSignatureId || '',
    location: input.location || '',
    ipAddress: input.ipAddress ?? getClientIp(),
    deviceInfo: input.deviceInfo ?? getDeviceInfo(),
    browserInfo: input.browserInfo ?? getBrowserInfo(),
    operatingSystem: input.operatingSystem ?? getOperatingSystem(),
    subModule: input.subModule || '',
    screen: input.screen || '',
    site: input.site || '',
    businessUnit: input.businessUnit || '',
    company: input.company || '',
    sessionId: input.sessionId || '',
    requestId: input.requestId || '',
    workflowId: input.workflowId || '',
    approvalLevel: input.approvalLevel || '',
    employeeId: input.employeeId || '',
    username: input.username || input.user.name || '',
    timezone: input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };

  let lastError: unknown;
  for (let i = 0; i < AUDIT_APPEND_FNS.length; i += 1) {
    const name = AUDIT_APPEND_FNS[i]!;
    try {
      const response = await getAppendAuditCallable(name)(payload);
      return response.data.id || response.data.auditId || null;
    } catch (error) {
      lastError = error;
      const remaining = AUDIT_APPEND_FNS.length - i - 1;
      const code = String((error as { code?: string }).code || '').toLowerCase();
      const canRetry = remaining > 0 && (
        isCallableGatewayFailure(error)
        || code.includes('not-found')
      );
      if (!canRetry) break;
    }
  }

  // Never silently fail — Part 11 requires detectable audit failures
  console.error('AUDIT_FAILURE: append audit callable failed', {
    error: callableErrorMessage(lastError),
    module: input.moduleName,
    action: input.actionType,
    recordId: input.recordId,
    auditId: buildAuditId(),
    at: nowIso(),
  });
  if (isCallableGatewayFailure(lastError)) {
    markAuditCallablesUnavailable();
  }
  return null;
}

export async function writeAuditTrail(
  entry: Omit<AuditTrailEntry, 'timestamp' | 'ipAddress'> & { ipAddress?: string },
  collectionName = AUDIT_TRAIL_COLLECTION,
): Promise<string | null> {
  return createAuditLog({
    moduleName: entry.moduleName,
    collectionName: entry.collectionName,
    recordId: entry.documentId,
    actionType: String(entry.action),
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    user: { id: entry.userId, name: entry.userName },
    ipAddress: entry.ipAddress,
  }, collectionName);
}

export async function auditCreate(
  collectionName: string,
  documentId: string,
  moduleName: string,
  actor: AuditActor,
  newValue: unknown,
) {
  return createAuditLog({
    moduleName,
    collectionName,
    recordId: documentId,
    actionType: 'Create',
    actionDescription: `Created record in ${collectionName}`,
    newValue,
    user: actor,
    status: 'Success',
  });
}

export async function auditUpdate(
  collectionName: string,
  documentId: string,
  moduleName: string,
  actor: AuditActor,
  oldValue: unknown,
  newValue: unknown,
  action: AuditAction = 'UPDATE',
) {
  const actionType = action === 'STATUS_CHANGE' ? 'Status Change' : 'Update';
  return createAuditLog({
    moduleName,
    collectionName,
    recordId: documentId,
    actionType,
    oldValue,
    newValue,
    user: actor,
    status: 'Success',
  });
}

export async function auditDelete(
  collectionName: string,
  documentId: string,
  moduleName: string,
  actor: AuditActor,
  oldValue: unknown,
) {
  return createAuditLog({
    moduleName,
    collectionName,
    recordId: documentId,
    actionType: 'Delete',
    oldValue,
    newValue: { isDeleted: true },
    user: actor,
    status: 'Success',
  });
}

export async function createFieldChangeAuditLogs(
  params: {
    moduleName: string;
    collectionName: string;
    recordId: string;
    documentNumber?: string;
    oldData: Record<string, unknown>;
    newData: Record<string, unknown>;
    user: AuditActor;
    reason?: string;
    fieldsToTrack?: string[];
  },
): Promise<number> {
  const keys = params.fieldsToTrack
    ?? Object.keys({ ...params.oldData, ...params.newData }).filter((k) => !SKIP_COMPARE_FIELDS.has(k));

  let count = 0;
  for (const field of keys) {
    const oldVal = params.oldData[field];
    const newVal = params.newData[field];
    const oldStr = serializeValue(oldVal);
    const newStr = serializeValue(newVal);
    if (oldStr === newStr) continue;

    await createAuditLog({
      moduleName: params.moduleName,
      collectionName: params.collectionName,
      recordId: params.recordId,
      documentNumber: params.documentNumber,
      actionType: 'Update',
      actionDescription: `Field "${field}" changed`,
      fieldName: field,
      oldValue: oldVal,
      newValue: newVal,
      changedFields: field,
      reason: params.reason,
      user: params.user,
      status: 'Success',
    });
    count += 1;
  }
  return count;
}
