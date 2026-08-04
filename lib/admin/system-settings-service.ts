/**
 * System Settings — client service.
 * Reads via Firestore; privileged mutations via Cloud Functions.
 */
import { doc, getDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ADMIN_COLLECTIONS } from './constants';
import type { SystemSettings } from './schemas';
import { isFirebaseConfigured, getFirebaseAuth, getFirebaseFirestore, getFirebaseFunctions } from '@/lib/firebase';
import { getFirebaseStorageHealthStatus } from '@/lib/firebase-config';
import { checkFirebaseConnection } from './admin-service';

export interface SystemSettingsAuditMeta {
  userId: string;
  userName: string;
}

export interface SystemSettingsSaveOptions {
  changeReason?: string;
  esignConfirmed?: boolean;
}

export interface SystemSettingsVersionRow {
  id: string;
  versionId?: string;
  version?: number;
  section?: string;
  action?: string;
  reason?: string;
  createdAt?: string;
  createdByName?: string;
  electronicSignatureApplied?: boolean;
  snapshot?: Record<string, unknown>;
}

const SETTINGS_DOC_KEY = 'global';

const CRITICAL_SECTIONS = new Set([
  'security', 'password policy', 'password-policy', 'session', 'maintenance',
  'compliance', 'authentication', 'import', 'reset', 'rollback', 'publish',
]);

export function isCriticalSettingsSection(section: string): boolean {
  return CRITICAL_SECTIONS.has(section.toLowerCase());
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function getDefaultSystemSettings(): Omit<SystemSettings, 'id'> {
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
    enableCaching: true,
    cacheTtlSeconds: 120,
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
    configVersion: 1,
    publishedVersion: 1,
    configurationStatus: 'Published',
    draftMode: false,
    passwordPolicy: '',
    createdBy: 'system',
    updatedBy: 'system',
  };
}

export function normalizeSystemSettings(raw: SystemSettings): SystemSettings {
  const defaults = getDefaultSystemSettings();
  const maintenanceEnabled = raw.maintenanceModeEnabled ?? raw.maintenanceMode ?? false;
  const sessionTimeout = Number(raw.sessionTimeoutMinutes ?? raw.sessionTimeout ?? 30);
  const maxAttempts = Number(raw.maxFailedLoginAttempts ?? raw.maxLoginAttempts ?? 5);
  const lockDuration = Number(raw.accountLockDurationMinutes ?? raw.accountLockDuration ?? 30);
  const maxSize = Number(raw.maxFileSizeMb ?? raw.maxUploadSize ?? 10);

  const passwordParts = [
    raw.minPasswordLength ? `Min ${raw.minPasswordLength} chars` : '',
    raw.requireUppercase ? 'uppercase' : '',
    raw.requireLowercase ? 'lowercase' : '',
    raw.requireNumber ? 'number' : '',
    raw.requireSpecialChar ? 'special char' : '',
  ].filter(Boolean);

  return {
    ...defaults,
    ...raw,
    maintenanceModeEnabled: maintenanceEnabled,
    maintenanceMode: maintenanceEnabled,
    sessionTimeoutMinutes: sessionTimeout,
    sessionTimeout,
    maxFailedLoginAttempts: maxAttempts,
    maxLoginAttempts: maxAttempts,
    accountLockDurationMinutes: lockDuration,
    accountLockDuration: lockDuration,
    maxFileSizeMb: maxSize,
    maxUploadSize: maxSize,
    passwordPolicy: raw.passwordPolicy || passwordParts.join(', ') || 'Min 8 chars, uppercase, number, special',
    dateFormat: (raw.dateFormat as SystemSettings['dateFormat']) || 'DD/MM/YYYY',
    timeFormat: (raw.timeFormat as SystemSettings['timeFormat']) || '24h',
    configVersion: Number(raw.configVersion ?? 1),
    configurationStatus: (raw.configurationStatus as SystemSettings['configurationStatus']) || 'Published',
  };
}

function getLocalSystemSettings(id = 'local'): SystemSettings {
  return normalizeSystemSettings({
    id,
    ...getDefaultSystemSettings(),
  } as SystemSettings);
}

export async function fetchSystemSettings(): Promise<SystemSettings | null> {
  if (!isFirebaseConfigured()) return null;

  const auth = getFirebaseAuth();
  if (!auth.currentUser) return null;

  try {
    const ref = doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.systemSettings, SETTINGS_DOC_KEY);
    const snap = await Promise.race([
      getDoc(ref),
      new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 15000)),
    ]);
    if (!snap || snap === null) return getLocalSystemSettings('default');
    if (!snap.exists()) return getLocalSystemSettings('default');
    return normalizeSystemSettings({ id: snap.id, ...snap.data() } as SystemSettings);
  } catch {
    return getLocalSystemSettings('local');
  }
}

export function subscribeSystemSettings(
  onData: (settings: SystemSettings | null) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData(null);
    return () => undefined;
  }
  const ref = doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.systemSettings, SETTINGS_DOC_KEY);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(getLocalSystemSettings('default'));
        return;
      }
      onData(normalizeSystemSettings({ id: snap.id, ...snap.data() } as SystemSettings));
    },
    (err) => {
      onError?.(err.message);
      onData(getLocalSystemSettings('local'));
    },
  );
}

export async function updateSystemSettings(
  updates: Partial<SystemSettings>,
  meta: SystemSettingsAuditMeta,
  section: string,
  options?: SystemSettingsSaveOptions,
): Promise<SystemSettings | null> {
  if (!isFirebaseConfigured()) return null;
  const reason = options?.changeReason?.trim() || `${section} configuration updated`;
  if (reason.length < 5) {
    throw new Error('Change reason must be at least 5 characters');
  }
  const critical = isCriticalSettingsSection(section);
  if (critical && !options?.esignConfirmed) {
    throw new Error('Electronic signature confirmation is required for this section');
  }

  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminSystemSettings');
    const result = await fn({
      section,
      updates,
      changeReason: reason,
      esignConfirmed: Boolean(options?.esignConfirmed || !critical),
    });
    return normalizeSystemSettings({ id: SETTINGS_DOC_KEY, ...(result.data as object) } as SystemSettings);
  } catch (error) {
    throw new Error(callableErrorMessage(error, 'Failed to save system settings'));
  }
}

export async function resetSystemSettingsToDefault(
  meta: SystemSettingsAuditMeta,
  options?: SystemSettingsSaveOptions,
): Promise<SystemSettings | null> {
  void meta;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'resetAdminSystemSettings');
    const result = await fn({
      changeReason: options?.changeReason || 'Reset system settings to factory defaults',
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return normalizeSystemSettings({ id: SETTINGS_DOC_KEY, ...(result.data as object) } as SystemSettings);
  } catch (error) {
    throw new Error(callableErrorMessage(error, 'Failed to reset system settings'));
  }
}

export async function publishSystemSettings(
  options?: SystemSettingsSaveOptions,
): Promise<SystemSettings | null> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'publishAdminSystemSettings');
    const result = await fn({
      changeReason: options?.changeReason || 'Publish system configuration',
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return normalizeSystemSettings({ id: SETTINGS_DOC_KEY, ...(result.data as object) } as SystemSettings);
  } catch (error) {
    throw new Error(callableErrorMessage(error, 'Failed to publish system settings'));
  }
}

export async function rollbackSystemSettings(
  versionId: string,
  options?: SystemSettingsSaveOptions,
): Promise<SystemSettings | null> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'rollbackAdminSystemSettings');
    const result = await fn({
      versionId,
      changeReason: options?.changeReason || 'Rollback system configuration',
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return normalizeSystemSettings({ id: SETTINGS_DOC_KEY, ...(result.data as object) } as SystemSettings);
  } catch (error) {
    throw new Error(callableErrorMessage(error, 'Failed to rollback system settings'));
  }
}

export async function fetchSystemSettingsVersions(): Promise<SystemSettingsVersionRow[]> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'fetchAdminSystemSettingsVersions');
    const result = await fn({});
    return ((result.data as { rows?: SystemSettingsVersionRow[] })?.rows || []);
  } catch {
    return [];
  }
}

export function exportSystemSettingsJson(settings: SystemSettings): string {
  const exportable = { ...settings };
  delete (exportable as { id?: string }).id;
  return JSON.stringify(exportable, null, 2);
}

export async function importSystemSettingsJson(
  json: string,
  meta: SystemSettingsAuditMeta,
  options?: SystemSettingsSaveOptions,
): Promise<{ settings: SystemSettings | null; error?: string }> {
  void meta;
  try {
    const parsed = JSON.parse(json) as Partial<SystemSettings>;
    const forbidden = ['id', 'createdAt', 'createdBy', 'configVersion', 'publishedVersion'];
    forbidden.forEach((k) => delete (parsed as Record<string, unknown>)[k]);
    const fn = httpsCallable(getFirebaseFunctions(), 'importAdminSystemSettings');
    const result = await fn({
      settings: parsed,
      changeReason: options?.changeReason || 'Import system configuration JSON',
      esignConfirmed: options?.esignConfirmed !== false,
    });
    return {
      settings: normalizeSystemSettings({ id: SETTINGS_DOC_KEY, ...(result.data as object) } as SystemSettings),
    };
  } catch (e) {
    return { settings: null, error: callableErrorMessage(e, (e as Error).message) };
  }
}

export async function logSystemSettingsExport(description: string, changeReason?: string): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminSystemSettingsExport');
    await fn({ description, changeReason: changeReason || 'Report export' });
  } catch {
    // non-blocking
  }
}

export function buildPasswordPolicyPreview(settings: SystemSettings): string {
  const rules: string[] = [];
  rules.push(`At least ${settings.minPasswordLength} characters`);
  if (settings.requireUppercase) rules.push('One uppercase letter');
  if (settings.requireLowercase) rules.push('One lowercase letter');
  if (settings.requireNumber) rules.push('One number');
  if (settings.requireSpecialChar) rules.push('One special character');
  if (settings.passwordExpiryDays > 0) rules.push(`Expires every ${settings.passwordExpiryDays} days`);
  if (settings.preventLastPasswordReuseCount > 0) {
    rules.push(`Cannot reuse last ${settings.preventLastPasswordReuseCount} passwords`);
  }
  if (settings.forcePasswordChangeOnFirstLogin) rules.push('Force change on first login');
  return rules.join(' · ');
}

export interface FirebaseHealthStatus {
  configured: boolean;
  authStatus: 'Connected' | 'Degraded' | 'Not Configured';
  firestoreStatus: 'Connected' | 'Degraded' | 'Not Configured';
  storageStatus: 'Connected' | 'Degraded' | 'Not Configured';
  projectId: string;
  latencyMs: number;
  envVars: { key: string; configured: boolean }[];
  error?: string;
}

const FIREBASE_ENV_KEYS = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
] as const;

export async function checkFirebaseHealth(): Promise<FirebaseHealthStatus> {
  const envVars = FIREBASE_ENV_KEYS.map((key) => ({
    key,
    configured: Boolean(process.env[key]?.trim()),
  }));

  const configured = isFirebaseConfigured();
  if (!configured) {
    return {
      configured: false,
      authStatus: 'Not Configured',
      firestoreStatus: 'Not Configured',
      storageStatus: 'Not Configured',
      projectId: '',
      latencyMs: 0,
      envVars,
      error: 'Firebase environment variables missing',
    };
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '';
  const base = await checkFirebaseConnection();
  let authStatus: FirebaseHealthStatus['authStatus'] = 'Connected';
  try {
    const auth = getFirebaseAuth();
    authStatus = auth.currentUser || auth.app ? 'Connected' : 'Degraded';
  } catch {
    authStatus = 'Degraded';
  }

  let storageStatus = getFirebaseStorageHealthStatus();
  if (storageStatus === 'Connected' && !base.connected) {
    storageStatus = 'Degraded';
  }

  return {
    configured: true,
    authStatus,
    firestoreStatus: base.connected ? 'Connected' : 'Degraded',
    storageStatus,
    projectId,
    latencyMs: base.latencyMs,
    envVars,
    error: base.error,
  };
}

export async function logFirebaseHealthCheck(meta: SystemSettingsAuditMeta): Promise<FirebaseHealthStatus> {
  void meta;
  const health = await checkFirebaseHealth();
  await logSystemSettingsExport('Firebase health check from System Settings', 'Firebase health probe');
  return health;
}

export function isMaintenanceModeActive(settings: SystemSettings | null): boolean {
  if (!settings) return false;
  return Boolean(settings.maintenanceModeEnabled ?? settings.maintenanceMode);
}

export function canAccessDuringMaintenance(role?: string | null): boolean {
  const r = role?.toLowerCase() || '';
  return ['super_admin', 'admin'].includes(r);
}

export function getAllowedFileExtensions(settings: SystemSettings): string[] {
  const fromString = settings.allowedFileTypes
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const fromFlags: string[] = [];
  if (settings.allowPdf) fromFlags.push('.pdf');
  if (settings.allowExcel) fromFlags.push('.xls', '.xlsx', '.csv');
  if (settings.allowWord) fromFlags.push('.doc', '.docx');
  if (settings.allowImages) fromFlags.push('.jpg', '.jpeg', '.png', '.gif', '.webp');
  return Array.from(new Set([...fromString, ...fromFlags]));
}

export function validateFileAgainstSettings(
  file: File,
  settings: SystemSettings | null,
): { allowed: boolean; error?: string } {
  const s = settings
    ? normalizeSystemSettings(settings)
    : normalizeSystemSettings(getDefaultSystemSettings() as SystemSettings);
  const maxBytes = s.maxFileSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      allowed: false,
      error: `File size exceeds maximum allowed size of ${s.maxFileSizeMb} MB.`,
    };
  }

  const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
  const allowed = getAllowedFileExtensions(s);
  if (!allowed.some((a) => a === ext || a === ext.replace('.', ''))) {
    return {
      allowed: false,
      error: `File type "${ext}" is not allowed. Allowed types: ${allowed.join(', ')}`,
    };
  }

  return { allowed: true };
}
