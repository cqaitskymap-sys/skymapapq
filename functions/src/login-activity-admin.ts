/**
 * Login Activity — privileged Cloud Functions.
 * Immutable session/security event logging for 21 CFR Part 11 / ISO 27001.
 */
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData,
} from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { BROWSER_CALLABLE } from './callable-options';


function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 2000): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function buildLoginId(): string {
  return `LGN-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function buildSessionId(): string {
  return `SES-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

const VIEWER_ROLES = [
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'qa',
  'regulatory_affairs', 'regulatory', 'auditor',
];
const ADMIN_ROLES = ['super_admin', 'admin'];

const LOGIN_EVENT_TYPES = [
  'Successful Login', 'Logout', 'Failed Login', 'Invalid Password', 'Invalid Username',
  'Password Reset', 'Password Change', 'Account Lock', 'Account Unlock',
  'Session Timeout', 'Session Expired', 'Remember Me Login',
  'MFA Success', 'MFA Failure', 'New Device Login', 'New Browser Login',
  'Multiple Concurrent Login', 'Forced Logout', 'Administrator Logout',
] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Login activity access required');
  }
}

function assertAdmin(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ADMIN_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Administrator access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = snap.data();
  return {
    firestore,
    actor,
    actorRole: String(actor?.role || ''),
    actorName: String(actor?.full_name || actor?.email || request.auth.uid),
    actorUid: request.auth.uid,
  };
}

function parseDevice(deviceInfo: string) {
  const ua = deviceInfo || '';
  let deviceType = 'Desktop';
  if (/Mobile|Android|iPhone/i.test(ua)) deviceType = 'Mobile';
  else if (/Tablet|iPad/i.test(ua)) deviceType = 'Tablet';
  let browser = 'Unknown';
  let browserVersion = '';
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  const firefox = ua.match(/Firefox\/([\d.]+)/);
  const safari = ua.match(/Version\/([\d.]+).*Safari/);
  const edge = ua.match(/Edg\/([\d.]+)/);
  if (edge) { browser = 'Edge'; browserVersion = edge[1]; }
  else if (chrome) { browser = 'Chrome'; browserVersion = chrome[1]; }
  else if (firefox) { browser = 'Firefox'; browserVersion = firefox[1]; }
  else if (safari) { browser = 'Safari'; browserVersion = safari[1]; }
  let operatingSystem = 'Unknown';
  if (/Windows/i.test(ua)) operatingSystem = 'Windows';
  else if (/Mac OS/i.test(ua)) operatingSystem = 'macOS';
  else if (/Android/i.test(ua)) operatingSystem = 'Android';
  else if (/iPhone|iPad/i.test(ua)) operatingSystem = 'iOS';
  else if (/Linux/i.test(ua)) operatingSystem = 'Linux';
  return { deviceType, browser, browserVersion, operatingSystem };
}

function assessRisk(input: {
  loginStatus: string;
  isNewDevice: boolean;
  isNewBrowser: boolean;
  failedRecent: number;
}): string {
  if (input.loginStatus === 'Failed' || input.loginStatus === 'Locked') return 'High';
  if (input.failedRecent >= 3 || input.isNewDevice) return 'Medium';
  if (input.isNewBrowser) return 'Low';
  return 'Info';
}

async function writeLoginAudit(
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    now: string;
  },
) {
  const batch = firestore.batch();
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-LGN-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'Login Activity',
    collectionName: 'login_activity',
    recordId: input.recordId,
    documentId: input.recordId,
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    changedByUserId: input.actorUid,
    changedByUserName: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    reasonForChange: input.reason || '',
    reason: input.reason || '',
    ipAddress: 'server',
    deviceInfo: 'cloud-function',
    status: 'Success',
    appendOnly: true,
    immutable: true,
    source: 'login-activity-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'Login Activity',
    recordId: input.recordId,
    action: input.actionType,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason || '',
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  await batch.commit();
}

async function notify(
  firestore: Firestore,
  userId: string,
  type: string,
  title: string,
  message: string,
  now: string,
  severity = 'Medium',
) {
  await firestore.collection('notifications').doc().set({
    userId,
    type,
    title,
    message,
    module: 'Login Activity',
    severity,
    isRead: false,
    createdAt: now,
  });
}

async function getGlobalSettings(firestore: Firestore) {
  const snap = await firestore.collection('system_settings').doc('global').get();
  return snap.data() || {};
}

async function getPasswordPolicy(firestore: Firestore) {
  const [legacySnap, global] = await Promise.all([
    firestore.collection('password_policy').limit(1).get(),
    getGlobalSettings(firestore),
  ]);
  const legacy = legacySnap.docs[0]?.data() || {};
  const maxLoginAttempts = Number(
    global.maxFailedLoginAttempts ?? global.maxLoginAttempts ?? legacy.maxLoginAttempts ?? 5,
  );
  const lockoutDurationMinutes = Number(
    global.accountLockDurationMinutes ?? global.lockoutDurationMinutes ?? legacy.lockoutDurationMinutes ?? 30,
  );
  return {
    maxLoginAttempts: Math.max(1, Number.isFinite(maxLoginAttempts) ? maxLoginAttempts : 5),
    lockoutDurationMinutes: Math.max(1, Number.isFinite(lockoutDurationMinutes) ? lockoutDurationMinutes : 30),
    lockoutEnabled: global.enableAccountLockout !== false,
  };
}

async function getSessionSettings(firestore: Firestore) {
  const [legacySnap, global] = await Promise.all([
    firestore.collection('system_settings').doc('session_policy').get(),
    getGlobalSettings(firestore),
  ]);
  const legacy = legacySnap.data() || {};
  const sessionTimeout = Number(global.sessionTimeoutMinutes ?? legacy.sessionTimeoutMinutes ?? 30);
  const idleTimeout = Number(global.idleTimeoutMinutes ?? legacy.idleTimeoutMinutes ?? 15);
  const maxConcurrent = Number(global.maxConcurrentSessions ?? legacy.maxConcurrentSessions ?? 3);
  return {
    maxConcurrentSessions: Math.max(1, Number.isFinite(maxConcurrent) ? maxConcurrent : 3),
    sessionTimeoutMinutes: Math.max(5, Number.isFinite(sessionTimeout) ? sessionTimeout : 30),
    idleTimeoutMinutes: Math.max(5, Number.isFinite(idleTimeout) ? idleTimeout : 15),
    allowMultipleSessions: (global.allowMultipleSessions ?? legacy.allowMultipleSessions) !== false,
  };
}

function clientContext(data: Record<string, unknown>) {
  const deviceInfo = optionalString(data.deviceInfo || data.userAgent, 'deviceInfo', 1000) || 'browser';
  const parsed = parseDevice(deviceInfo);
  return {
    deviceInfo,
    deviceName: optionalString(data.deviceName, 'deviceName', 120) || parsed.deviceType,
    deviceType: optionalString(data.deviceType, 'deviceType', 40) || parsed.deviceType,
    browser: optionalString(data.browser, 'browser', 80) || parsed.browser,
    browserVersion: optionalString(data.browserVersion, 'browserVersion', 40) || parsed.browserVersion,
    operatingSystem: optionalString(data.operatingSystem, 'operatingSystem', 80) || parsed.operatingSystem,
    ipAddress: optionalString(data.ipAddress, 'ipAddress', 120) || 'client',
    macAddress: optionalString(data.macAddress, 'macAddress', 64),
    geoLocation: optionalString(data.geoLocation, 'geoLocation', 200),
    authenticationMethod: optionalString(data.authenticationMethod, 'authenticationMethod', 80) || 'Password',
    mfaStatus: optionalString(data.mfaStatus, 'mfaStatus', 40) || 'Not Applicable',
    rememberMe: Boolean(data.rememberMe),
  };
}

function requestIp(request: CallableRequest): string {
  const headers = request.rawRequest?.headers || {};
  const forwarded = String(headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim();
  const socketIp = String(request.rawRequest?.ip || request.rawRequest?.socket?.remoteAddress || '');
  return (forwarded || socketIp).slice(0, 120);
}

async function countRecentFailed(firestore: Firestore, email: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const snap = await firestore.collection('login_activity')
    .where('email', '==', email.toLowerCase())
    .where('loginStatus', '==', 'Failed')
    .where('loginTime', '>=', since)
    .limit(50)
    .get()
    .catch(() => null);
  return snap?.size || 0;
}

async function hasSeenDevice(firestore: Firestore, userId: string, deviceFingerprint: string): Promise<boolean> {
  if (!deviceFingerprint) return true;
  const snap = await firestore.collection('login_activity')
    .where('userId', '==', userId)
    .where('deviceFingerprint', '==', deviceFingerprint)
    .where('loginStatus', '==', 'Success')
    .limit(1)
    .get()
    .catch(() => null);
  return Boolean(snap && !snap.empty);
}

/**
 * Record successful login + open session (authenticated).
 */
export const recordAdminLoginSuccess = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  if (!actor || actor.is_active !== true) {
    throw new HttpsError('permission-denied', 'Active account required');
  }
  if (actor.account_locked === true) {
    throw new HttpsError('failed-precondition', 'Account is locked. Contact administrator.');
  }
  const blockedUntil = actor.login_blocked_until ? new Date(String(actor.login_blocked_until)).getTime() : 0;
  if (blockedUntil && blockedUntil > Date.now()) {
    throw new HttpsError('failed-precondition', 'Account is temporarily locked due to failed login attempts. Try again later.');
  }

  const data = (request.data || {}) as Record<string, unknown>;
  const ctx = clientContext(data);
  const now = new Date().toISOString();
  const loginId = buildLoginId();
  const logicalSessionId = buildSessionId();
  const deviceFingerprint = optionalString(data.deviceFingerprint, 'deviceFingerprint', 200)
    || `${ctx.browser}|${ctx.operatingSystem}|${ctx.deviceType}`;
  const email = String(actor.email || optionalString(data.email, 'email', 320) || '').toLowerCase();
  const seen = await hasSeenDevice(firestore, actorUid, deviceFingerprint);
  const isNewDevice = !seen;
  const eventType = data.rememberMe === true ? 'Remember Me Login' : (isNewDevice ? 'New Device Login' : 'Successful Login');
  const riskLevel = assessRisk({
    loginStatus: 'Success',
    isNewDevice,
    isNewBrowser: isNewDevice,
    failedRecent: 0,
  });

  const settings = await getSessionSettings(firestore);
  const activeSnap = await firestore.collection('login_activity')
    .where('userId', '==', actorUid)
    .where('status', '==', 'Active')
    .limit(20)
    .get()
    .catch(() => null);

  const batch = firestore.batch();
  let concurrentClosed = 0;
  if (activeSnap && !settings.allowMultipleSessions) {
    for (const docSnap of activeSnap.docs) {
      batch.update(docSnap.ref, {
        logoutTime: now,
        status: 'Closed',
        eventType: 'Forced Logout',
        failureReason: 'Single-session policy — prior session closed',
        updatedAt: now,
      });
      concurrentClosed += 1;
    }
  } else if (activeSnap && activeSnap.size >= settings.maxConcurrentSessions) {
    const sorted = [...activeSnap.docs].sort((a, b) =>
      String(a.data().loginTime || '').localeCompare(String(b.data().loginTime || '')));
    const toClose = sorted.slice(0, Math.max(0, activeSnap.size - settings.maxConcurrentSessions + 1));
    for (const docSnap of toClose) {
      batch.update(docSnap.ref, {
        logoutTime: now,
        status: 'Closed',
        eventType: 'Multiple Concurrent Login',
        failureReason: 'Concurrent session limit exceeded',
        updatedAt: now,
      });
      concurrentClosed += 1;
    }
  }

  const ref = firestore.collection('login_activity').doc();
  const record = {
    loginId,
    sessionId: logicalSessionId,
    userId: actorUid,
    employeeId: String(actor.employee_id || actor.employeeId || ''),
    username: email,
    userName: actorName,
    fullName: actorName,
    email,
    role: actorRole,
    department: String(actor.department || ''),
    businessUnit: String(actor.business_unit || actor.businessUnit || ''),
    company: String(actor.company || ''),
    site: String(actor.site || ''),
    ...ctx,
    deviceFingerprint,
    loginTime: now,
    logoutTime: null,
    sessionDurationMinutes: null,
    loginStatus: 'Success',
    eventType,
    failureReason: '',
    riskLevel,
    status: 'Active',
    rememberMe: ctx.rememberMe,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    idleTimeoutMinutes: settings.idleTimeoutMinutes,
    isArchived: false,
    immutable: true,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(ref, record);
  batch.update(firestore.collection('profiles').doc(actorUid), {
    last_login: now,
    failed_login_count: 0,
    login_blocked_until: null,
    updated_at: now,
  });
  await batch.commit();

  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: 'Login',
    description: `${eventType} for ${email}`,
    newValue: { loginId, sessionId: logicalSessionId, riskLevel },
    now,
  });

  if (isNewDevice) {
    await notify(firestore, actorUid, 'New Device Login', 'New device login detected',
      `A login from a new device/browser was recorded (${ctx.browser} / ${ctx.operatingSystem}).`, now, 'High');
  }
  if (concurrentClosed > 0) {
    await notify(firestore, actorUid, 'Concurrent Login', 'Session policy applied',
      `${concurrentClosed} prior session(s) were closed due to concurrent session policy.`, now, 'Medium');
  }
  await notify(firestore, actorUid, 'Successful Login', 'Login successful',
    `Session ${logicalSessionId} started.`, now, 'Info');

  return { id: ref.id, loginId, sessionId: logicalSessionId, riskLevel, eventType };
});

/**
 * Record failed login (may be unauthenticated).
 */
export const recordAdminLoginFailure = onCall(BROWSER_CALLABLE, async (request) => {
    const firestore = getAdminFirestore();
  const data = (request.data || {}) as Record<string, unknown>;
  const email = requiredString(data.email, 'Email', 320).toLowerCase();
  const failureReason = optionalString(data.failureReason, 'failureReason', 500)
    || 'Invalid credentials';
  const ctx = clientContext(data);
  const ipAddress = requestIp(request) || ctx.ipAddress || 'unknown';
  const now = new Date().toISOString();
  const loginId = buildLoginId();
  const recentWindow = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const emailRateSnap = await firestore.collection('login_activity')
    .where('email', '==', email)
    .where('loginStatus', '==', 'Failed')
    .where('loginTime', '>=', recentWindow)
    .limit(12)
    .get()
    .catch(() => null);
  if (emailRateSnap && emailRateSnap.size >= 10) {
    throw new HttpsError('resource-exhausted', 'Too many failed login attempts. Try again later.');
  }

  if (ipAddress && ipAddress !== 'unknown' && ipAddress !== 'client') {
    const ipRateSnap = await firestore.collection('login_activity')
      .where('ipAddress', '==', ipAddress)
      .where('loginStatus', '==', 'Failed')
      .where('loginTime', '>=', recentWindow)
      .limit(22)
      .get()
      .catch(() => null);
    if (ipRateSnap && ipRateSnap.size >= 20) {
      throw new HttpsError('resource-exhausted', 'Too many failed login attempts. Try again later.');
    }
  }

  const failedRecent = await countRecentFailed(firestore, email);
  const policy = await getPasswordPolicy(firestore);
  let loginStatus: 'Failed' | 'Locked' = 'Failed';
  let eventType: string = failureReason.toLowerCase().includes('user')
    ? 'Invalid Username'
    : 'Invalid Password';
  let locked = false;

  const profiles = await firestore.collection('profiles')
    .where('email', '==', email)
    .limit(1)
    .get()
    .catch(() => null);
  const profileDoc = profiles?.docs[0];
  const profile = profileDoc?.data();

  // Unauthenticated failures must never permanently lock an account (DoS).
  // Apply a time-bounded cooldown from password policy instead.
  if (policy.lockoutEnabled && profile && (failedRecent + 1) >= policy.maxLoginAttempts) {
    loginStatus = 'Locked';
    eventType = 'Account Lock';
    locked = true;
    const blockedUntil = new Date(Date.now() + policy.lockoutDurationMinutes * 60 * 1000).toISOString();
    if (profileDoc) {
      await profileDoc.ref.set({
        login_blocked_until: blockedUntil,
        failed_login_count: failedRecent + 1,
        updated_at: now,
      }, { merge: true });
    }
  } else if (profileDoc) {
    await profileDoc.ref.set({
      failed_login_count: failedRecent + 1,
      updated_at: now,
    }, { merge: true });
  }

  const riskLevel = assessRisk({
    loginStatus,
    isNewDevice: false,
    isNewBrowser: false,
    failedRecent: failedRecent + 1,
  });

  const ref = firestore.collection('login_activity').doc();
  const record = {
    loginId,
    sessionId: '',
    userId: profileDoc?.id || '',
    employeeId: String(profile?.employee_id || ''),
    username: email,
    userName: String(profile?.full_name || email),
    fullName: String(profile?.full_name || email),
    email,
    role: String(profile?.role || ''),
    department: String(profile?.department || ''),
    businessUnit: String(profile?.business_unit || ''),
    company: String(profile?.company || ''),
    site: String(profile?.site || ''),
    ...ctx,
    ipAddress,
    deviceFingerprint: optionalString(data.deviceFingerprint, 'deviceFingerprint', 200),
    loginTime: now,
    logoutTime: null,
    sessionDurationMinutes: null,
    loginStatus,
    eventType,
    failureReason,
    riskLevel,
    status: 'Closed',
    rememberMe: false,
    isArchived: false,
    immutable: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(record);

  const actorUid = profileDoc?.id || 'system';
  const actorName = String(profile?.full_name || email);
  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: 'Failed Login',
    description: `${eventType}: ${failureReason}`,
    newValue: { email, loginStatus, riskLevel },
    reason: failureReason,
    now,
  });

  if (profileDoc) {
    await notify(firestore, profileDoc.id, 'Failed Login', 'Failed login attempt',
      `Failed login for ${email}: ${failureReason}`, now, 'High');
  }
  if (locked && profileDoc) {
    await notify(firestore, profileDoc.id, 'Account Locked', 'Temporary login cooldown',
      `Login temporarily blocked for ${policy.lockoutDurationMinutes} minutes after ${policy.maxLoginAttempts} failed attempts.`, now, 'Critical');
  }
  if (failedRecent + 1 >= 3 && profileDoc) {
    await notify(firestore, profileDoc.id, 'Security Alert', 'Multiple failed logins',
      `${failedRecent + 1} failed attempts in the last 30 minutes.`, now, 'High');
  }

  return {
    id: ref.id,
    loginId,
    loginStatus,
    locked,
    remainingAttempts: Math.max(0, policy.maxLoginAttempts - (failedRecent + 1)),
  };
});

/**
 * Close session on logout.
 */
export const recordAdminLogout = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const sessionDocId = optionalString(data.sessionDocId || data.sessionId, 'sessionDocId', 128);
  const eventType = optionalString(data.eventType, 'eventType', 80) || 'Logout';
  const now = new Date().toISOString();

  let target = sessionDocId
    ? await firestore.collection('login_activity').doc(sessionDocId).get()
    : null;

  if (!target?.exists) {
    const active = await firestore.collection('login_activity')
      .where('userId', '==', actorUid)
      .where('status', '==', 'Active')
      .orderBy('loginTime', 'desc')
      .limit(1)
      .get()
      .catch(() => null);
    target = active?.docs[0] || null;
  }

  if (!target?.exists) {
    return { success: true, closed: false };
  }

  const existing = target.data()!;
  if (existing.userId !== actorUid && !ADMIN_ROLES.includes(String(actor?.role || ''))) {
    throw new HttpsError('permission-denied', 'Cannot close another user session');
  }

  const loginTime = new Date(String(existing.loginTime || now)).getTime();
  const duration = Math.max(0, Math.round((Date.now() - loginTime) / 60000));
  await target.ref.update({
    logoutTime: now,
    status: 'Closed',
    eventType,
    sessionDurationMinutes: duration,
    updatedAt: now,
  });

  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: target.id, actionType: 'Logout',
    description: `${eventType} — session duration ${duration} min`,
    newValue: { logoutTime: now, sessionDurationMinutes: duration },
    now,
  });
  await notify(firestore, actorUid, 'Session Expired', eventType,
    `Session closed (${eventType}).`, now, 'Info');

  return { success: true, closed: true, id: target.id, sessionDurationMinutes: duration };
});

export const terminateAdminSession = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const sessionDocId = requiredString(data.sessionDocId, 'Session ID', 128);
  const reason = requiredString(data.reason || data.changeReason, 'Change reason', 500);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');

  const snap = await firestore.collection('login_activity').doc(sessionDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Session not found');
  const existing = snap.data()!;
  if (existing.status !== 'Active') {
    throw new HttpsError('failed-precondition', 'Session is not active');
  }

  const now = new Date().toISOString();
  const loginTime = new Date(String(existing.loginTime || now)).getTime();
  const duration = Math.max(0, Math.round((Date.now() - loginTime) / 60000));
  await snap.ref.update({
    logoutTime: now,
    status: 'Closed',
    eventType: 'Administrator Logout',
    failureReason: reason,
    sessionDurationMinutes: duration,
    terminatedBy: actorUid,
    updatedAt: now,
  });

  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: snap.id, actionType: 'Forced Logout',
    description: `Admin terminated session for ${existing.userName || existing.email}`,
    reason, newValue: { status: 'Closed' }, now,
  });
  if (existing.userId) {
    await notify(firestore, String(existing.userId), 'Forced Logout', 'Session terminated',
      `An administrator terminated your session: ${reason}`, now, 'High');
  }
  return { success: true };
});

export const terminateAllAdminSessionsForUser = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const targetUserId = requiredString(data.userId, 'User ID', 128);
  const reason = requiredString(data.reason || data.changeReason, 'Change reason', 500);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');

  const snap = await firestore.collection('login_activity')
    .where('userId', '==', targetUserId)
    .where('status', '==', 'Active')
    .limit(50)
    .get();

  const now = new Date().toISOString();
  let closed = 0;
  for (const docSnap of snap.docs) {
    const loginTime = new Date(String(docSnap.data().loginTime || now)).getTime();
    const duration = Math.max(0, Math.round((Date.now() - loginTime) / 60000));
    await docSnap.ref.update({
      logoutTime: now,
      status: 'Closed',
      eventType: 'Forced Logout',
      failureReason: reason,
      sessionDurationMinutes: duration,
      terminatedBy: actorUid,
      updatedAt: now,
    });
    closed += 1;
  }

  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: targetUserId, actionType: 'Forced Logout',
    description: `Terminated ${closed} active session(s)`,
    reason, newValue: { closed }, now,
  });
  await notify(firestore, targetUserId, 'Forced Logout', 'All sessions terminated',
    `Administrator logged you out of all devices: ${reason}`, now, 'High');

  return { success: true, closed };
});

export const unlockAdminAccount = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const targetUserId = requiredString(data.userId, 'User ID', 128);
  const reason = requiredString(data.reason || data.changeReason, 'Change reason', 500);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');

  const now = new Date().toISOString();
  const targetRef = firestore.collection('profiles').doc(targetUserId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  await targetRef.set({
    account_locked: false,
    locked_at: null,
    lock_reason: null,
    failed_login_count: 0,
    login_blocked_until: null,
    updated_at: now,
  }, { merge: true });

  const ref = firestore.collection('login_activity').doc();
  await ref.set({
    loginId: buildLoginId(),
    sessionId: '',
    userId: targetUserId,
    userName: actorName,
    fullName: actorName,
    email: '',
    loginStatus: 'Success',
    eventType: 'Account Unlock',
    failureReason: reason,
    loginTime: now,
    logoutTime: now,
    status: 'Closed',
    riskLevel: 'Info',
    ipAddress: 'server',
    deviceInfo: 'admin-action',
    immutable: true,
    createdAt: now,
    updatedAt: now,
  });

  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: targetUserId, actionType: 'Account Unlock',
    description: 'Account unlocked by administrator', reason, now,
  });
  await notify(firestore, targetUserId, 'Account Unlock', 'Account unlocked',
    'Your account has been unlocked by an administrator.', now, 'Medium');

  return { success: true };
});

export const recordAdminSecurityEvent = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorName, actorUid } = await resolveActor(request);
  if (!actor || actor.is_active !== true) {
    throw new HttpsError('permission-denied', 'Active account required');
  }
  const data = (request.data || {}) as Record<string, unknown>;
  const eventType = requiredString(data.eventType, 'Event type', 80);
  if (!(LOGIN_EVENT_TYPES as readonly string[]).includes(eventType)) {
    throw new HttpsError('invalid-argument', 'Unsupported security event type');
  }
  const ctx = clientContext(data);
  const now = new Date().toISOString();
  const ref = firestore.collection('login_activity').doc();
  await ref.set({
    loginId: buildLoginId(),
    sessionId: optionalString(data.sessionId, 'sessionId', 128),
    userId: actorUid,
    employeeId: String(actor?.employee_id || ''),
    username: String(actor?.email || ''),
    userName: actorName,
    fullName: actorName,
    email: String(actor?.email || ''),
    role: String(actor?.role || ''),
    department: String(actor?.department || ''),
    ...ctx,
    loginTime: now,
    logoutTime: eventType.includes('Logout') || eventType.includes('Timeout') || eventType.includes('Expired') ? now : null,
    loginStatus: eventType.includes('Fail') ? 'Failed' : 'Success',
    eventType,
    failureReason: optionalString(data.failureReason || data.reason, 'reason', 500),
    riskLevel: eventType.includes('Fail') || eventType.includes('Lock') ? 'High' : 'Info',
    status: 'Closed',
    immutable: true,
    createdAt: now,
    updatedAt: now,
  });

  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: eventType,
    description: optionalString(data.description, 'description', 500) || eventType,
    reason: optionalString(data.reason, 'reason', 500),
    now,
  });

  return { id: ref.id, eventType };
});

export const archiveAdminLoginActivity = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const beforeDate = requiredString(data.beforeDate, 'Before date', 40);
  const reason = requiredString(data.reason || data.changeReason, 'Change reason', 500);
  if (reason.length < 5) throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');

  const snap = await firestore.collection('login_activity')
    .where('loginTime', '<', beforeDate)
    .limit(200)
    .get();

  let archived = 0;
  const now = new Date().toISOString();
  for (const docSnap of snap.docs) {
    const archiveRef = firestore.collection('login_activity_archive').doc(docSnap.id);
    if ((await archiveRef.get()).exists) continue;
    await archiveRef.set({
      ...docSnap.data(),
      archivedAt: now,
      archivedBy: actorUid,
      archiveReason: reason,
      originalId: docSnap.id,
    });
    archived += 1;
  }

  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: 'archive', actionType: 'Archive',
    description: `Archived ${archived} login records before ${beforeDate}`,
    reason, newValue: { archived, beforeDate }, now,
  });

  return { archived, beforeDate };
});

export const logAdminLoginActivityExport = onCall(BROWSER_CALLABLE, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const format = optionalString(data.format, 'format', 40) || 'Excel';
  const count = Number(data.count || 0);
  const now = new Date().toISOString();
  await writeLoginAudit(firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Export',
    description: `Login activity exported as ${format} (${count} records)`,
    newValue: { format, count }, now,
  });
  return { success: true };
});
