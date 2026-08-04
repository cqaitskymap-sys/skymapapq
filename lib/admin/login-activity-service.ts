import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { shouldSkipRemoteCallablesInLocalDev } from '@/lib/audit-trail';
import { ADMIN_COLLECTIONS, LOGIN_STATUSES } from './constants';
import type { LoginActivity } from './schemas';

export interface LoginActivityFilters {
  search?: string;
  loginStatus?: string;
  eventType?: string;
  userId?: string;
  role?: string;
  department?: string;
  site?: string;
  deviceType?: string;
  browser?: string;
  operatingSystem?: string;
  ipAddress?: string;
  riskLevel?: string;
  authenticationMethod?: string;
  mfaStatus?: string;
  startDate?: string;
  endDate?: string;
}

let loginActivityCallablesUnavailable = false;
let warnedMissingLoginActivityFns = false;

const LOGIN_ACTIVITY_FNS_UNAVAILABLE_KEY = 'skymap-login-activity-fns-unavailable';

function isLocalhostRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

function shouldSkipLoginActivityCallables(): boolean {
  if (process.env.NEXT_PUBLIC_SKIP_ADMIN_CALLABLES === 'true') return true;
  if (loginActivityCallablesUnavailable) return true;

  if (typeof sessionStorage !== 'undefined') {
    try {
      if (sessionStorage.getItem(LOGIN_ACTIVITY_FNS_UNAVAILABLE_KEY) === '1') {
        loginActivityCallablesUnavailable = true;
        return true;
      }
    } catch {
      /* ignore */
    }
  }

  // Match audit-trail: on localhost without emulator/opt-in, skip undeployed callables.
  if (process.env.NODE_ENV === 'development' && isLocalhostRuntime()) {
    const usingEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === 'true';
    const allowRemote =
      process.env.NEXT_PUBLIC_ALLOW_REMOTE_AUDIT_FROM_LOCALHOST === 'true';
    if (!usingEmulator && !allowRemote) return true;
  }

  return false;
}

function markLoginActivityCallablesUnavailable(label: string): void {
  loginActivityCallablesUnavailable = true;
  if (typeof sessionStorage !== 'undefined') {
    try {
      sessionStorage.setItem(LOGIN_ACTIVITY_FNS_UNAVAILABLE_KEY, '1');
    } catch {
      /* ignore */
    }
  }
  if (!warnedMissingLoginActivityFns) {
    warnedMissingLoginActivityFns = true;
    console.warn(
      `[login-activity] Cloud Function unavailable (${label}). ` +
        'Enable billing on project apq-skymap, then deploy login-activity functions. Login still works.',
    );
  }
}

function logLoginActivityCallableFailure(label: string, error: unknown): void {
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  const looksUndeployed =
    code.includes('not-found')
    || code.includes('internal')
    || message.includes('not-found')
    || message.includes('cors')
    || message.includes('failed to fetch');

  if (looksUndeployed) {
    markLoginActivityCallablesUnavailable(label);
    return;
  }

  console.error(`LOGIN_ACTIVITY_FAILURE: ${label}`, error);
}

export type LoginListTab =
  | 'all'
  | 'active'
  | 'history'
  | 'logout'
  | 'failed'
  | 'locked'
  | 'security'
  | 'devices'
  | 'archived';

const FETCH_LIMIT = 400;

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function normalizeLoginActivity(raw: Record<string, unknown>): LoginActivity {
  const status = (['Active', 'Inactive', 'Closed'].includes(String(raw.status))
    ? String(raw.status)
    : 'Active') as LoginActivity['status'];
  const loginStatus = (LOGIN_STATUSES as readonly string[]).includes(String(raw.loginStatus))
    ? (raw.loginStatus as LoginActivity['loginStatus'])
    : 'Success';

  return {
    id: raw.id ? String(raw.id) : undefined,
    status,
    createdAt: String(raw.createdAt || raw.loginTime || ''),
    updatedAt: String(raw.updatedAt || ''),
    createdBy: String(raw.createdBy || raw.userId || ''),
    updatedBy: String(raw.updatedBy || ''),
    loginId: String(raw.loginId || raw.id || ''),
    sessionId: String(raw.sessionId || ''),
    userId: String(raw.userId || ''),
    employeeId: String(raw.employeeId || ''),
    username: String(raw.username || raw.email || ''),
    userName: String(raw.userName || raw.fullName || raw.email || ''),
    fullName: String(raw.fullName || raw.userName || ''),
    email: String(raw.email || ''),
    role: String(raw.role || ''),
    department: String(raw.department || ''),
    businessUnit: String(raw.businessUnit || ''),
    company: String(raw.company || ''),
    site: String(raw.site || ''),
    deviceName: String(raw.deviceName || ''),
    deviceType: String(raw.deviceType || ''),
    deviceInfo: String(raw.deviceInfo || ''),
    deviceFingerprint: String(raw.deviceFingerprint || ''),
    browser: String(raw.browser || ''),
    browserVersion: String(raw.browserVersion || ''),
    operatingSystem: String(raw.operatingSystem || ''),
    ipAddress: String(raw.ipAddress || ''),
    macAddress: String(raw.macAddress || ''),
    geoLocation: String(raw.geoLocation || ''),
    loginTime: String(raw.loginTime || ''),
    logoutTime: (raw.logoutTime as string | null) ?? null,
    sessionDurationMinutes: raw.sessionDurationMinutes == null
      ? null
      : Number(raw.sessionDurationMinutes),
    loginStatus,
    eventType: String(raw.eventType || ''),
    failureReason: String(raw.failureReason || ''),
    authenticationMethod: String(raw.authenticationMethod || 'Password'),
    mfaStatus: String(raw.mfaStatus || 'Not Applicable'),
    rememberMe: Boolean(raw.rememberMe),
    riskLevel: String(raw.riskLevel || 'Info'),
    sessionTimeoutMinutes: raw.sessionTimeoutMinutes == null
      ? undefined
      : Number(raw.sessionTimeoutMinutes),
    idleTimeoutMinutes: raw.idleTimeoutMinutes == null
      ? undefined
      : Number(raw.idleTimeoutMinutes),
    terminatedBy: raw.terminatedBy ? String(raw.terminatedBy) : undefined,
    isArchived: Boolean(raw.isArchived),
    immutable: raw.immutable !== false,
  };
}

function mapDocs(docs: Array<{ id: string; data: () => Record<string, unknown> }>): LoginActivity[] {
  return docs.map((d) => normalizeLoginActivity({ id: d.id, ...d.data() }));
}

function clientDevicePayload() {
  if (typeof navigator === 'undefined') {
    return { deviceInfo: 'server', operatingSystem: 'server', browser: 'server' };
  }
  const ua = navigator.userAgent;
  return {
    deviceInfo: ua.slice(0, 1000),
    userAgent: ua.slice(0, 1000),
    ipAddress: 'client',
    deviceFingerprint: `${navigator.platform}|${navigator.language}|${ua.slice(0, 80)}`,
  };
}

export async function fetchLoginActivities(includeArchived = false): Promise<LoginActivity[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const firestore = getFirebaseFirestore();
    const [live, archived] = await Promise.all([
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.loginActivity),
        orderBy('loginTime', 'desc'),
        limit(FETCH_LIMIT),
      )),
      includeArchived
        ? getDocs(query(
          collection(firestore, ADMIN_COLLECTIONS.loginActivityArchive),
          orderBy('loginTime', 'desc'),
          limit(200),
        )).catch(() => ({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> }))
        : Promise.resolve({ docs: [] as Array<{ id: string; data: () => Record<string, unknown> }> }),
    ]);
    return [
      ...mapDocs(live.docs),
      ...mapDocs(archived.docs).map((r) => ({ ...r, isArchived: true })),
    ].sort((a, b) => b.loginTime.localeCompare(a.loginTime));
  } catch (error) {
    console.error('fetchLoginActivities failed:', error);
    throw new Error('Unable to load login activity. Check connection and permissions.');
  }
}

export function subscribeToLoginActivities(
  onData: (rows: LoginActivity[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const q = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.loginActivity),
    orderBy('loginTime', 'desc'),
    limit(FETCH_LIMIT),
  );
  return onSnapshot(
    q,
    (snapshot) => onData(mapDocs(snapshot.docs)),
    (error) => {
      console.error('subscribeToLoginActivities failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to login activity'));
    },
  );
}

export async function fetchLoginActivityById(id: string): Promise<LoginActivity | null> {
  if (!isFirebaseConfigured() || !id) return null;
  const firestore = getFirebaseFirestore();
  for (const name of [ADMIN_COLLECTIONS.loginActivity, ADMIN_COLLECTIONS.loginActivityArchive]) {
    try {
      const snap = await getDoc(doc(firestore, name, id));
      if (snap.exists()) {
        return normalizeLoginActivity({
          id: snap.id,
          ...snap.data(),
          isArchived: name === ADMIN_COLLECTIONS.loginActivityArchive,
        });
      }
    } catch {
      // continue
    }
  }
  return null;
}

export function applyLoginActivityFilters(
  rows: LoginActivity[],
  filters: LoginActivityFilters,
): LoginActivity[] {
  const q = filters.search?.toLowerCase() || '';
  return rows.filter((r) => {
    const matchSearch = !q
      || r.userName.toLowerCase().includes(q)
      || r.email.toLowerCase().includes(q)
      || r.username.toLowerCase().includes(q)
      || r.employeeId.toLowerCase().includes(q)
      || r.ipAddress.toLowerCase().includes(q)
      || r.loginId.toLowerCase().includes(q)
      || r.sessionId.toLowerCase().includes(q)
      || r.eventType.toLowerCase().includes(q);
    const matchStatus = !filters.loginStatus || filters.loginStatus === 'all' || r.loginStatus === filters.loginStatus;
    const matchEvent = !filters.eventType || filters.eventType === 'all' || r.eventType === filters.eventType;
    const matchUser = !filters.userId || filters.userId === 'all' || r.userId === filters.userId;
    const matchRole = !filters.role || filters.role === 'all' || r.role === filters.role;
    const matchDept = !filters.department || filters.department === 'all' || r.department === filters.department;
    const matchSite = !filters.site || filters.site === 'all' || r.site === filters.site;
    const matchDevice = !filters.deviceType || filters.deviceType === 'all' || r.deviceType === filters.deviceType;
    const matchBrowser = !filters.browser || filters.browser === 'all' || r.browser === filters.browser;
    const matchOs = !filters.operatingSystem || filters.operatingSystem === 'all' || r.operatingSystem === filters.operatingSystem;
    const matchIp = !filters.ipAddress || r.ipAddress.includes(filters.ipAddress);
    const matchRisk = !filters.riskLevel || filters.riskLevel === 'all' || r.riskLevel === filters.riskLevel;
    const matchAuth = !filters.authenticationMethod || filters.authenticationMethod === 'all'
      || r.authenticationMethod === filters.authenticationMethod;
    const matchMfa = !filters.mfaStatus || filters.mfaStatus === 'all' || r.mfaStatus === filters.mfaStatus;
    const matchStart = !filters.startDate || r.loginTime >= filters.startDate;
    const matchEnd = !filters.endDate || r.loginTime <= `${filters.endDate}T23:59:59`;
    return matchSearch && matchStatus && matchEvent && matchUser && matchRole && matchDept
      && matchSite && matchDevice && matchBrowser && matchOs && matchIp && matchRisk
      && matchAuth && matchMfa && matchStart && matchEnd;
  });
}

export function applyLoginListTab(rows: LoginActivity[], tab: LoginListTab): LoginActivity[] {
  switch (tab) {
    case 'active':
      return rows.filter((r) => r.status === 'Active' && r.loginStatus === 'Success');
    case 'history':
      return rows.filter((r) => r.loginStatus === 'Success');
    case 'logout':
      return rows.filter((r) =>
        Boolean(r.logoutTime)
        || ['Logout', 'Forced Logout', 'Administrator Logout', 'Session Timeout', 'Session Expired']
          .includes(r.eventType));
    case 'failed':
      return rows.filter((r) => r.loginStatus === 'Failed'
        || ['Failed Login', 'Invalid Password', 'Invalid Username', 'MFA Failure'].includes(r.eventType));
    case 'locked':
      return rows.filter((r) => r.loginStatus === 'Locked' || r.eventType === 'Account Lock' || r.eventType === 'Account Unlock');
    case 'security':
      return rows.filter((r) =>
        ['New Device Login', 'New Browser Login', 'Multiple Concurrent Login', 'Forced Logout',
          'Account Lock', 'MFA Failure', 'Suspicious Login'].includes(r.eventType)
        || r.riskLevel === 'High' || r.riskLevel === 'Critical');
    case 'devices':
      return rows.filter((r) => Boolean(r.deviceType || r.browser || r.operatingSystem));
    case 'archived':
      return rows.filter((r) => r.isArchived);
    default:
      return rows.filter((r) => !r.isArchived);
  }
}

export function getLoginActivitySummary(rows: LoginActivity[]) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: rows.length,
    activeSessions: rows.filter((r) => r.status === 'Active').length,
    todayLogins: rows.filter((r) => r.loginTime.startsWith(today) && r.loginStatus === 'Success').length,
    failedLogins: rows.filter((r) => r.loginStatus === 'Failed').length,
    lockedEvents: rows.filter((r) => r.loginStatus === 'Locked' || r.eventType === 'Account Lock').length,
    highRisk: rows.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length,
    newDevices: rows.filter((r) => r.eventType === 'New Device Login').length,
    forcedLogouts: rows.filter((r) => r.eventType === 'Forced Logout' || r.eventType === 'Administrator Logout').length,
  };
}

export function exportLoginActivityCsv(rows: LoginActivity[]): string {
  const BOM = '\uFEFF';
  const headers = [
    'Login ID', 'Session ID', 'User', 'Employee ID', 'Email', 'Role', 'Department', 'Site',
    'Login Status', 'Event Type', 'Risk', 'Login Time', 'Logout Time', 'Duration (min)',
    'IP', 'Device', 'Browser', 'OS', 'Auth Method', 'MFA', 'Failure Reason',
  ];
  const escape = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) => [
    r.loginId, r.sessionId, r.userName, r.employeeId, r.email, r.role, r.department, r.site,
    r.loginStatus, r.eventType, r.riskLevel, r.loginTime, r.logoutTime || '',
    r.sessionDurationMinutes ?? '', r.ipAddress, r.deviceType || r.deviceInfo,
    `${r.browser} ${r.browserVersion}`.trim(), r.operatingSystem, r.authenticationMethod,
    r.mfaStatus, r.failureReason,
  ].map((c) => escape(String(c))).join(','));
  return BOM + [headers.join(','), ...lines].join('\n');
}

export function openLoginActivityPdfReport(
  rows: LoginActivity[],
  title: string,
  generatedBy: string,
): void {
  const body = rows.slice(0, 500).map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.loginTime ? new Date(r.loginTime).toLocaleString() : '—'}</td>
      <td>${r.userName}</td>
      <td>${r.loginStatus}</td>
      <td>${r.eventType || '—'}</td>
      <td>${r.ipAddress}</td>
      <td>${r.riskLevel}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${title}</title>
  <style>
    body{font-family:Georgia,serif;margin:24px;color:#1e293b}
    h1{color:#0f4c5c;font-size:22px}
    .meta{font-size:12px;color:#64748b;margin-bottom:12px}
    table{width:100%;border-collapse:collapse;font-size:11px;font-family:system-ui,sans-serif}
    th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left}
    th{background:#ecfdf5}
    @media print{.no-print{display:none}}
  </style></head><body>
  <h1>SkyMap QMS — ${title}</h1>
  <p class="meta">FDA 21 CFR Part 11 / ISO 27001 | Generated ${new Date().toLocaleString()} by ${generatedBy}</p>
  <p class="meta">Records: ${rows.length}${rows.length > 500 ? ' (showing 500)' : ''}</p>
  <table><thead><tr><th>#</th><th>Time</th><th>User</th><th>Status</th><th>Event</th><th>IP</th><th>Risk</th></tr></thead>
  <tbody>${body}</tbody></table>
  <button class="no-print" onclick="window.print()">Print / Save as PDF</button>
  </body></html>`;
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
}

export function buildPeriodLoginEntries(
  rows: LoginActivity[],
  period: 'daily' | 'weekly' | 'monthly',
): LoginActivity[] {
  const now = new Date();
  let start: Date;
  if (period === 'daily') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === 'weekly') {
    start = new Date(now);
    start.setDate(now.getDate() - 7);
  } else start = new Date(now.getFullYear(), now.getMonth(), 1);
  return rows.filter((r) => r.loginTime >= start.toISOString());
}

export async function recordLoginSuccess(options?: {
  rememberMe?: boolean;
  email?: string;
}): Promise<{ id: string; sessionId: string } | null> {
  if (shouldSkipLoginActivityCallables()) return null;
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { id: string; sessionId: string }
    >(getFirebaseFunctions(), 'recordAdminLoginSuccess');
    const response = await fn({ ...clientDevicePayload(), ...options });
    return response.data;
  } catch (error) {
    logLoginActivityCallableFailure('recordLoginSuccess', error);
    return null;
  }
}

export async function recordLoginFailure(email: string, failureReason: string): Promise<void> {
  if (shouldSkipLoginActivityCallables()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'recordAdminLoginFailure');
    await fn({ email, failureReason, ...clientDevicePayload() });
  } catch (error) {
    logLoginActivityCallableFailure('recordLoginFailure', error);
  }
}

export async function recordLogout(sessionDocId?: string | null, eventType = 'Logout'): Promise<void> {
  if (shouldSkipLoginActivityCallables()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'recordAdminLogout');
    await fn({ sessionDocId: sessionDocId || undefined, eventType, ...clientDevicePayload() });
  } catch (error) {
    logLoginActivityCallableFailure('recordLogout', error);
  }
}

export async function recordSecurityEvent(
  eventType: string,
  extras?: Record<string, unknown>,
): Promise<void> {
  if (shouldSkipLoginActivityCallables()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'recordAdminSecurityEvent');
    await fn({ eventType, ...clientDevicePayload(), ...extras });
  } catch (error) {
    logLoginActivityCallableFailure('recordSecurityEvent', error);
  }
}

export async function terminateSession(
  sessionDocId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  if (shouldSkipLoginActivityCallables() || shouldSkipRemoteCallablesInLocalDev()) {
    return { success: false, error: 'Session actions require deployed Cloud Functions.' };
  }
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'terminateAdminSession');
    await fn({ sessionDocId, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to terminate session') };
  }
}

export async function terminateAllSessionsForUser(
  userId: string,
  reason: string,
): Promise<{ success: boolean; closed?: number; error?: string }> {
  if (shouldSkipLoginActivityCallables() || shouldSkipRemoteCallablesInLocalDev()) {
    return { success: false, error: 'Session actions require deployed Cloud Functions.' };
  }
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { closed: number }
    >(getFirebaseFunctions(), 'terminateAllAdminSessionsForUser');
    const response = await fn({ userId, reason });
    return { success: true, closed: response.data.closed };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to terminate sessions') };
  }
}

export async function unlockAccount(
  userId: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  if (shouldSkipLoginActivityCallables() || shouldSkipRemoteCallablesInLocalDev()) {
    return { success: false, error: 'Unlock requires deployed Cloud Functions.' };
  }
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'unlockAdminAccount');
    await fn({ userId, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to unlock account') };
  }
}

export async function archiveLoginActivity(
  beforeDate: string,
  reason: string,
): Promise<{ archived: number; error?: string }> {
  if (shouldSkipLoginActivityCallables() || shouldSkipRemoteCallablesInLocalDev()) {
    return { archived: 0, error: 'Archive requires deployed Cloud Functions.' };
  }
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { archived: number }
    >(getFirebaseFunctions(), 'archiveAdminLoginActivity');
    const response = await fn({ beforeDate, reason });
    return { archived: response.data.archived };
  } catch (error) {
    return { archived: 0, error: callableErrorMessage(error, 'Archive failed') };
  }
}

export async function logLoginActivityExport(
  format: string,
  count: number,
): Promise<void> {
  if (shouldSkipLoginActivityCallables() || shouldSkipRemoteCallablesInLocalDev()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminLoginActivityExport');
    await fn({ format, count });
  } catch (error) {
    logLoginActivityCallableFailure('logLoginActivityExport', error);
  }
}
