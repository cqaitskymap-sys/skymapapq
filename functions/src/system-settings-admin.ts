/**
 * System Settings — privileged Cloud Functions.
 * CF-only writes, versioning, dual audit, e-sign gate for critical sections.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';


function requiredString(value: unknown, field: string, maxLength = 2000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function requiredReason(value: unknown): string {
  const reason = requiredString(value, 'Change reason', 2000);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

function asNumber(value: unknown, fallback: number, min?: number, max?: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  if (max != null && n > max) return max;
  return n;
}

function asString(value: unknown, fallback = '', maxLength = 2000): string {
  if (value == null) return fallback;
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength);
}

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor'];
const EDITOR_ROLES = ['super_admin', 'admin'];
const SECURITY_EDITOR_ROLES = ['super_admin'];

const CRITICAL_SECTIONS = new Set([
  'security', 'password policy', 'password-policy', 'session', 'maintenance',
  'compliance', 'authentication', 'import', 'reset', 'rollback', 'publish',
]);

const SETTINGS_DOC_ID = 'global';

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'System Settings view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string, section: string) {
  if (!actor || actor.is_active !== true) {
    throw new HttpsError('permission-denied', 'Active profile required');
  }
  const critical = CRITICAL_SECTIONS.has(section.toLowerCase());
  const allowed = critical ? SECURITY_EDITOR_ROLES : EDITOR_ROLES;
  if (!allowed.includes(role)) {
    throw new HttpsError(
      'permission-denied',
      critical
        ? 'Only Super Admin can change security-critical system settings'
        : 'System Settings edit access required',
    );
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

async function writeSettingsAudit(
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    now: string;
    esign?: boolean;
  },
) {
  const batch = firestore.batch();
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-SYS-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'System Settings',
    collectionName: 'system_settings',
    recordId: SETTINGS_DOC_ID,
    documentId: SETTINGS_DOC_ID,
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason || '',
    performedBy: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    createdAt: input.now,
    source: 'system-settings-admin',
    immutable: true,
    appendOnly: true,
    eSignatureRequired: Boolean(input.esign),
    electronicSignatureApplied: Boolean(input.esign),
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: 'System Settings',
    action: input.actionType,
    recordId: SETTINGS_DOC_ID,
    description: input.description,
    performedBy: input.actorName,
    userId: input.actorUid,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
    status: 'Success',
  });
  await batch.commit();
}

function defaultSettings(actorUid: string) {
  return {
    applicationName: 'Skymap PharmaQMS',
    applicationShortName: 'PharmaQMS',
    companyName: '',
    businessUnit: '',
    companyDefaultSite: '',
    defaultLanguage: 'en',
    timezone: 'Asia/Kolkata',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    defaultCurrency: 'INR',
    numberFormat: 'en-IN',
    financialYearStartMonth: 'April',
    supportEmail: 'support@pharmaqms.com',
    supportPhone: '',
    applicationVersion: '1.0.0',
    environment: 'Production',
    status: 'Active',
    defaultDashboard: '/admin',
    landingPage: '/dashboard',
    faviconUrl: '',
    secondaryColor: '#0f172a',
    enableRoleBasedAccess: true,
    enablePermissionGuard: true,
    enableAuditTrail: true,
    enableESignature: true,
    enableTwoFactorAuth: false,
    allowMultipleSessions: true,
    allowIpRestriction: false,
    allowedIpList: '',
    enableAccountLockout: true,
    maxFailedLoginAttempts: 5,
    accountLockDurationMinutes: 30,
    enableGoogleLogin: false,
    enableMicrosoftLogin: false,
    ssoReady: false,
    ldapReady: false,
    oauthReady: false,
    minPasswordLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSpecialChar: true,
    passwordExpiryDays: 90,
    preventLastPasswordReuseCount: 5,
    forcePasswordChangeOnFirstLogin: true,
    sessionTimeoutMinutes: 30,
    idleTimeoutMinutes: 15,
    rememberMeEnabled: true,
    autoLogoutWarningMinutes: 2,
    allowedFileTypes: '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.png',
    maxFileSizeMb: 10,
    enableVirusScanPlaceholder: false,
    storagePathFormat: '{module}/{year}/{recordId}',
    allowPdf: true,
    allowExcel: true,
    allowWord: true,
    allowImages: true,
    defaultTheme: 'light',
    enableDarkMode: true,
    primaryColor: '#2563eb',
    sidebarMode: 'Expanded',
    logoDisplayMode: 'Full Logo',
    compactMode: false,
    companyLogo: '',
    maintenanceModeEnabled: false,
    maintenanceMessage: 'System is under scheduled maintenance. Please try again later.',
    allowedAdminAccessDuringMaintenance: true,
    scheduledMaintenanceStart: '',
    scheduledMaintenanceEnd: '',
    enableSystemLogs: true,
    logRetentionDays: 90,
    enableErrorTracking: true,
    enablePerformanceLogs: false,
    enableFda21CfrPart11: true,
    enableEuGmpAnnex11: true,
    enableAlcoaPlus: true,
    enableWhoGmp: true,
    enablePicsGmp: true,
    enableIchQ10: true,
    enableIso27001: true,
    enableGamp5: true,
    enableDocumentVersioning: true,
    enableApprovalWorkflow: true,
    recordRetentionDays: 2555,
    enableBetaFeatures: false,
    enableExperimentalFeatures: false,
    enableRestApi: false,
    enableWebhooks: false,
    smtpConfigured: false,
    smsGatewayConfigured: false,
    enableCaching: true,
    cacheTtlSeconds: 120,
    passwordPolicy: '',
    configVersion: 1,
    publishedVersion: 1,
    configurationStatus: 'Published',
    draftMode: false,
    createdBy: actorUid,
    updatedBy: actorUid,
  };
}

function sanitizeUpdates(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const allow = [
    'applicationName', 'applicationShortName', 'companyName', 'businessUnit', 'companyDefaultSite',
    'defaultLanguage', 'timezone', 'dateFormat', 'timeFormat', 'defaultCurrency', 'numberFormat',
    'financialYearStartMonth', 'supportEmail', 'supportPhone', 'applicationVersion', 'environment',
    'status', 'defaultDashboard', 'landingPage', 'faviconUrl', 'secondaryColor',
    'enableRoleBasedAccess', 'enablePermissionGuard', 'enableAuditTrail', 'enableESignature',
    'enableTwoFactorAuth', 'allowMultipleSessions', 'allowIpRestriction', 'allowedIpList',
    'enableAccountLockout', 'maxFailedLoginAttempts', 'accountLockDurationMinutes',
    'enableGoogleLogin', 'enableMicrosoftLogin', 'ssoReady', 'ldapReady', 'oauthReady',
    'minPasswordLength', 'requireUppercase', 'requireLowercase', 'requireNumber', 'requireSpecialChar',
    'passwordExpiryDays', 'preventLastPasswordReuseCount', 'forcePasswordChangeOnFirstLogin',
    'sessionTimeoutMinutes', 'idleTimeoutMinutes', 'rememberMeEnabled', 'autoLogoutWarningMinutes',
    'allowedFileTypes', 'maxFileSizeMb', 'enableVirusScanPlaceholder', 'storagePathFormat',
    'allowPdf', 'allowExcel', 'allowWord', 'allowImages',
    'defaultTheme', 'enableDarkMode', 'primaryColor', 'sidebarMode', 'logoDisplayMode',
    'compactMode', 'companyLogo',
    'maintenanceModeEnabled', 'maintenanceMessage', 'allowedAdminAccessDuringMaintenance',
    'scheduledMaintenanceStart', 'scheduledMaintenanceEnd',
    'enableSystemLogs', 'logRetentionDays', 'enableErrorTracking', 'enablePerformanceLogs',
    'enableFda21CfrPart11', 'enableEuGmpAnnex11', 'enableAlcoaPlus', 'enableWhoGmp', 'enablePicsGmp',
    'enableIchQ10', 'enableIso27001', 'enableGamp5', 'enableDocumentVersioning',
    'enableApprovalWorkflow', 'recordRetentionDays',
    'enableBetaFeatures', 'enableExperimentalFeatures',
    'enableRestApi', 'enableWebhooks', 'smtpConfigured', 'smsGatewayConfigured',
    'enableCaching', 'cacheTtlSeconds', 'passwordPolicy', 'draftMode', 'configurationStatus',
  ];
  for (const key of allow) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      out[key] = raw[key];
    }
  }

  if (out.applicationName != null) out.applicationName = asString(out.applicationName, 'Skymap PharmaQMS', 120);
  if (out.minPasswordLength != null) out.minPasswordLength = asNumber(out.minPasswordLength, 8, 6, 128);
  if (out.maxFailedLoginAttempts != null) out.maxFailedLoginAttempts = asNumber(out.maxFailedLoginAttempts, 5, 1, 50);
  if (out.sessionTimeoutMinutes != null) out.sessionTimeoutMinutes = asNumber(out.sessionTimeoutMinutes, 30, 5, 1440);
  if (out.idleTimeoutMinutes != null) out.idleTimeoutMinutes = asNumber(out.idleTimeoutMinutes, 15, 5, 1440);
  if (out.maxFileSizeMb != null) out.maxFileSizeMb = asNumber(out.maxFileSizeMb, 10, 1, 500);
  if (out.recordRetentionDays != null) out.recordRetentionDays = asNumber(out.recordRetentionDays, 2555, 30, 36500);
  if (out.cacheTtlSeconds != null) out.cacheTtlSeconds = asNumber(out.cacheTtlSeconds, 120, 10, 86400);
  if (out.logRetentionDays != null) out.logRetentionDays = asNumber(out.logRetentionDays, 90, 1, 3650);

  // Sync legacy aliases
  if (out.maintenanceModeEnabled != null) out.maintenanceMode = out.maintenanceModeEnabled;
  if (out.sessionTimeoutMinutes != null) out.sessionTimeout = out.sessionTimeoutMinutes;
  if (out.maxFailedLoginAttempts != null) out.maxLoginAttempts = out.maxFailedLoginAttempts;
  if (out.accountLockDurationMinutes != null) out.accountLockDuration = out.accountLockDurationMinutes;
  if (out.maxFileSizeMb != null) out.maxUploadSize = out.maxFileSizeMb;

  if (out.maintenanceModeEnabled === true && !asString(out.maintenanceMessage).trim()) {
    throw new HttpsError('invalid-argument', 'Maintenance message is required when maintenance mode is enabled');
  }

  return out;
}

async function getOrCreateSettings(firestore: Firestore, actorUid: string) {
  const ref = firestore.collection('system_settings').doc(SETTINGS_DOC_ID);
  const snap = await ref.get();
  if (snap.exists) return { ref, data: snap.data() || {}, id: SETTINGS_DOC_ID };

  // Migrate legacy single-doc if present
  const legacy = await firestore.collection('system_settings').limit(5).get();
  const other = legacy.docs.find((d) => d.id !== SETTINGS_DOC_ID);
  if (other) {
    const data = other.data();
    await ref.set({ ...data, migratedFrom: other.id, updatedAt: new Date().toISOString() }, { merge: true });
    return { ref, data: (await ref.get()).data() || {}, id: SETTINGS_DOC_ID };
  }

  const now = new Date().toISOString();
  const defaults = { ...defaultSettings(actorUid), createdAt: now, updatedAt: now };
  await ref.set(defaults);
  return { ref, data: defaults, id: SETTINGS_DOC_ID };
}

async function writeVersion(
  firestore: Firestore,
  snapshot: Record<string, unknown>,
  meta: {
    actorUid: string;
    actorName: string;
    section: string;
    action: string;
    reason: string;
    version: number;
    now: string;
    esign: boolean;
  },
) {
  await firestore.collection('system_settings_versions').doc().set({
    versionId: `SSV-${meta.version}-${Date.now().toString(36).toUpperCase()}`,
    settingsDocId: SETTINGS_DOC_ID,
    version: meta.version,
    section: meta.section,
    action: meta.action,
    reason: meta.reason,
    snapshot,
    electronicSignatureApplied: meta.esign,
    createdBy: meta.actorUid,
    createdByName: meta.actorName,
    createdAt: meta.now,
    status: 'Active',
  });
}

function requireEsign(data: Record<string, unknown>, section: string) {
  const critical = CRITICAL_SECTIONS.has(section.toLowerCase());
  if (!critical) return false;
  const confirmed = data.esignConfirmed === true
    || (data.electronicSignature as { confirmed?: boolean } | undefined)?.confirmed === true;
  if (!confirmed) {
    throw new HttpsError(
      'failed-precondition',
      'Electronic signature confirmation is required for critical system configuration changes',
    );
  }
  return true;
}

export const updateAdminSystemSettings = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const section = asString(data.section || 'general', 'general', 80).toLowerCase();
  assertEditor(actor, actorRole, section);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const esign = requireEsign(data, section);
  const updates = sanitizeUpdates((data.updates || data.settings || {}) as Record<string, unknown>);
  if (Object.keys(updates).length === 0) {
    throw new HttpsError('invalid-argument', 'No settings updates provided');
  }

  const now = new Date().toISOString();
  const { ref, data: existing } = await getOrCreateSettings(firestore, actorUid);
  const nextVersion = asNumber(existing.configVersion, 1) + 1;
  const payload = {
    ...updates,
    configVersion: nextVersion,
    updatedBy: actorUid,
    updatedAt: now,
    lastChangeSection: section,
    lastChangeReason: reason,
    electronicSignatureApplied: esign,
  };

  await ref.set(payload, { merge: true });
  const after = (await ref.get()).data() || {};
  await writeVersion(firestore, after as Record<string, unknown>, {
    actorUid, actorName, section, action: 'Configuration Updated', reason, version: nextVersion, now, esign,
  });
  await writeSettingsAudit(firestore, {
    actorUid,
    actorName,
    actionType: esign ? 'Configuration Updated (E-Sign)' : 'Configuration Updated',
    description: `System settings section "${section}" updated (v${nextVersion})`,
    oldValue: { configVersion: existing.configVersion, section },
    newValue: { configVersion: nextVersion, section, keys: Object.keys(updates) },
    reason,
    now,
    esign,
  });

  return { id: SETTINGS_DOC_ID, ...after };
});

export const resetAdminSystemSettings = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  assertEditor(actor, actorRole, 'reset');
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const esign = requireEsign({ ...data, esignConfirmed: data.esignConfirmed ?? true }, 'reset');
  const now = new Date().toISOString();
  const { ref, data: existing } = await getOrCreateSettings(firestore, actorUid);
  const nextVersion = asNumber(existing.configVersion, 1) + 1;
  const defaults = {
    ...defaultSettings(actorUid),
    configVersion: nextVersion,
    publishedVersion: nextVersion,
    configurationStatus: 'Published',
    createdAt: existing.createdAt || now,
    createdBy: existing.createdBy || actorUid,
    updatedBy: actorUid,
    updatedAt: now,
  };
  await ref.set(defaults);
  await writeVersion(firestore, defaults, {
    actorUid, actorName, section: 'reset', action: 'Configuration Rolled Back', reason, version: nextVersion, now, esign,
  });
  await writeSettingsAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'Configuration Reset to Defaults',
    description: `System settings reset to defaults (v${nextVersion})`,
    oldValue: { configVersion: existing.configVersion },
    newValue: { configVersion: nextVersion },
    reason,
    now,
    esign,
  });
  return { id: SETTINGS_DOC_ID, ...defaults };
});

export const publishAdminSystemSettings = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  assertEditor(actor, actorRole, 'publish');
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason ?? 'Publish system configuration');
  const esign = requireEsign({ ...data, esignConfirmed: data.esignConfirmed ?? true }, 'publish');
  const now = new Date().toISOString();
  const { ref, data: existing } = await getOrCreateSettings(firestore, actorUid);
  const version = asNumber(existing.configVersion, 1);
  await ref.set({
    configurationStatus: 'Published',
    publishedVersion: version,
    draftMode: false,
    updatedAt: now,
    updatedBy: actorUid,
  }, { merge: true });
  const after = (await ref.get()).data() || {};
  await writeVersion(firestore, after as Record<string, unknown>, {
    actorUid, actorName, section: 'publish', action: 'Configuration Published', reason, version, now, esign,
  });
  await writeSettingsAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'Configuration Published',
    description: `System settings published (v${version})`,
    newValue: { publishedVersion: version },
    reason,
    now,
    esign,
  });
  return { id: SETTINGS_DOC_ID, ...after };
});

export const rollbackAdminSystemSettings = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  assertEditor(actor, actorRole, 'rollback');
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const esign = requireEsign({ ...data, esignConfirmed: data.esignConfirmed ?? true }, 'rollback');
  const versionId = asString(data.versionId, '', 120);
  if (!versionId) throw new HttpsError('invalid-argument', 'versionId is required');

  let snapshot: Record<string, unknown> | null = null;
  let sourceVersion = 0;

  const byDoc = await firestore.collection('system_settings_versions').doc(versionId).get();
  if (byDoc.exists) {
    const vd = byDoc.data() || {};
    snapshot = (vd.snapshot || {}) as Record<string, unknown>;
    sourceVersion = asNumber(vd.version, 0);
  } else {
    const q = await firestore.collection('system_settings_versions')
      .where('versionId', '==', versionId)
      .limit(1)
      .get();
    if (q.empty) throw new HttpsError('not-found', 'Version not found');
    const vd = q.docs[0].data();
    snapshot = (vd.snapshot || {}) as Record<string, unknown>;
    sourceVersion = asNumber(vd.version, 0);
  }

  if (!snapshot || Object.keys(snapshot).length === 0) {
    throw new HttpsError('failed-precondition', 'Version snapshot is empty');
  }

  const now = new Date().toISOString();
  const { ref, data: existing } = await getOrCreateSettings(firestore, actorUid);
  const nextVersion = asNumber(existing.configVersion, 1) + 1;
  const restored: Record<string, unknown> = {
    ...snapshot,
    configVersion: nextVersion,
    publishedVersion: nextVersion,
    configurationStatus: 'Published',
    draftMode: false,
    rolledBackFromVersion: sourceVersion,
    updatedBy: actorUid,
    updatedAt: now,
  };
  delete restored.id;
  await ref.set(restored);
  await writeVersion(firestore, restored, {
    actorUid, actorName, section: 'rollback', action: 'Configuration Rolled Back', reason, version: nextVersion, now, esign,
  });
  await writeSettingsAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'Configuration Rolled Back',
    description: `Rolled back to version ${sourceVersion} as v${nextVersion}`,
    oldValue: { configVersion: existing.configVersion },
    newValue: { configVersion: nextVersion, from: sourceVersion },
    reason,
    now,
    esign,
  });
  return { id: SETTINGS_DOC_ID, ...restored };
});

export const fetchAdminSystemSettingsVersions = onCall(async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);
  try {
    const snap = await firestore.collection('system_settings_versions')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return { rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  } catch {
    const snap = await firestore.collection('system_settings_versions').limit(50).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String((b as { createdAt?: string }).createdAt || '')
        .localeCompare(String((a as { createdAt?: string }).createdAt || '')));
    return { rows };
  }
});

export const importAdminSystemSettings = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  assertEditor(actor, actorRole, 'import');
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason ?? 'Import system configuration');
  const esign = requireEsign({ ...data, esignConfirmed: data.esignConfirmed ?? true }, 'import');
  const updates = sanitizeUpdates((data.settings || {}) as Record<string, unknown>);
  const now = new Date().toISOString();
  const { ref, data: existing } = await getOrCreateSettings(firestore, actorUid);
  const nextVersion = asNumber(existing.configVersion, 1) + 1;
  const payload = {
    ...updates,
    configVersion: nextVersion,
    updatedBy: actorUid,
    updatedAt: now,
    configurationStatus: 'Published',
  };
  await ref.set(payload, { merge: true });
  const after = (await ref.get()).data() || {};
  await writeVersion(firestore, after as Record<string, unknown>, {
    actorUid, actorName, section: 'import', action: 'Configuration Imported', reason, version: nextVersion, now, esign,
  });
  await writeSettingsAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'Configuration Imported',
    description: `System settings imported (v${nextVersion})`,
    newValue: { configVersion: nextVersion, keys: Object.keys(updates) },
    reason,
    now,
    esign,
  });
  return { id: SETTINGS_DOC_ID, ...after };
});

export const logAdminSystemSettingsExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  await writeSettingsAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'System Settings Report Exported',
    description: requiredString(data.description || 'Settings export', 'Description', 500),
    reason: asString(data.changeReason, 'Report export', 500),
    now: new Date().toISOString(),
  });
  return { success: true };
});
