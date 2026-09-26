import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from './constants';
import type { EsignSettings, EsignSettingFormData } from './schemas';

export interface EsignSettingAuditMeta {
  userId: string;
  userName: string;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

function parseCsvList(value?: string): string[] {
  if (!value?.trim()) return [];
  return value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokensMatch(a: string, b: string): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(' ').filter(Boolean));
  const wb = nb.split(' ').filter(Boolean);
  const overlap = wb.filter((w) => wa.has(w)).length;
  return overlap >= Math.min(2, wb.length) && overlap / Math.max(wa.size, wb.length) >= 0.5;
}

export function settingMatchesModuleAction(
  setting: EsignSettings,
  moduleName: string,
  actionType: string,
): boolean {
  const modules = [setting.moduleName, ...(setting.moduleAliases || [])];
  const actions = [setting.actionType, ...(setting.actionAliases || [])];
  return modules.some((m) => tokensMatch(m, moduleName))
    && actions.some((a) => tokensMatch(a, actionType));
}

export function buildEsignSettingId(code: string): string {
  return `ESIGN-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function defaultStatementText(meaning?: string): string {
  if (!meaning) return 'By signing electronically, I confirm this action is accurate and attributable to me.';
  return `By signing electronically, I confirm: ${meaning}`;
}

export function normalizeEsignSetting(s: EsignSettings): EsignSettings {
  const timeout = Number(s.sessionTimeoutMinutes ?? s.sessionTimeout ?? 15);
  return {
    ...s,
    esignSettingId: s.esignSettingId || buildEsignSettingId(s.settingCode || 'SETTING'),
    moduleAliases: Array.isArray(s.moduleAliases) ? s.moduleAliases : [],
    actionAliases: Array.isArray(s.actionAliases) ? s.actionAliases : [],
    allowedMeanings: Array.isArray(s.allowedMeanings) ? s.allowedMeanings : [],
    allowedRoles: Array.isArray(s.allowedRoles) ? s.allowedRoles : [],
    allowedDepartments: Array.isArray(s.allowedDepartments) ? s.allowedDepartments : [],
    authenticationMethods: Array.isArray(s.authenticationMethods) && s.authenticationMethods.length
      ? s.authenticationMethods
      : ['Password Confirmation'],
    requirePasswordReAuthentication: s.requirePasswordReAuthentication ?? s.requirePasswordConfirmation ?? true,
    requirePasswordConfirmation: s.requirePasswordReAuthentication ?? s.requirePasswordConfirmation ?? true,
    requireCommentReason: s.requireCommentReason ?? s.requireReason ?? true,
    requireReason: s.requireCommentReason ?? s.requireReason ?? true,
    sessionTimeoutMinutes: timeout,
    sessionTimeout: timeout,
    maxFailedEsignAttempts: Number(s.maxFailedEsignAttempts ?? 3),
    lockAccountAfterFailedAttempts: s.lockAccountAfterFailedAttempts ?? true,
    allowDelegatedSignature: s.allowDelegatedSignature ?? false,
    requireFinalApprovalSignature: s.requireFinalApprovalSignature ?? false,
    showSignatureStatement: s.showSignatureStatement ?? true,
    signatureStatementText: s.signatureStatementText || defaultStatementText(s.signatureMeaning),
    requireDepartmentVerification: s.requireDepartmentVerification ?? false,
    requireActiveSession: s.requireActiveSession ?? true,
    requireRoleVerification: s.requireRoleVerification ?? true,
  };
}

export function isEsignSettingActive(s: EsignSettings): boolean {
  return s.status === 'Active' && !s.isDeleted;
}

export async function fetchEsignSettings(): Promise<EsignSettings[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.esignSettings),
      orderBy('updatedAt', 'desc'),
      limit(400),
    ));
    return snap.docs
      .map((d) => normalizeEsignSetting({ id: d.id, ...d.data() } as EsignSettings))
      .filter((s) => !s.isDeleted);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.esignSettings));
      return snap.docs
        .map((d) => normalizeEsignSetting({ id: d.id, ...d.data() } as EsignSettings))
        .filter((s) => !s.isDeleted)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    } catch {
      return [];
    }
  }
}

export function subscribeToEsignSettings(
  onData: (rows: EsignSettings[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.esignSettings), limit(400)),
    (snapshot) => {
      const rows = snapshot.docs
        .map((d) => normalizeEsignSetting({ id: d.id, ...d.data() } as EsignSettings))
        .filter((s) => !s.isDeleted)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      onData(rows);
    },
    (error) => onError?.(new Error(error.message)),
  );
}

export async function fetchEsignSettingById(id: string): Promise<EsignSettings | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.esignSettings, id));
    if (!snap.exists() || snap.data().isDeleted === true) return null;
    return normalizeEsignSetting({ id: snap.id, ...snap.data() } as EsignSettings);
  } catch {
    return null;
  }
}

export async function fetchActiveEsignSetting(
  moduleName: string,
  actionType: string,
): Promise<EsignSettings | null> {
  // Prefer server resolver (alias-aware) when available
  try {
    const fn = httpsCallable<
      { moduleName: string; actionType: string },
      { setting: (EsignSettings & { id?: string }) | null }
    >(getFirebaseFunctions(), 'resolveAdminEsignSetting');
    const result = await fn({ moduleName, actionType });
    if (result.data?.setting) {
      return normalizeEsignSetting(result.data.setting as EsignSettings);
    }
  } catch {
    // fall through to client match
  }

  const settings = await fetchEsignSettings();
  return settings.find((s) =>
    isEsignSettingActive(s) && settingMatchesModuleAction(s, moduleName, actionType),
  ) ?? null;
}

export async function hasDuplicateActiveEsignSetting(
  moduleName: string,
  actionType: string,
  excludeId?: string,
): Promise<boolean> {
  const settings = await fetchEsignSettings();
  return settings.some((s) =>
    isEsignSettingActive(s)
    && s.moduleName === moduleName
    && s.actionType === actionType
    && s.id !== excludeId,
  );
}

export function getEsignSettingsSummary(settings: EsignSettings[]) {
  return {
    total: settings.length,
    active: settings.filter((s) => s.status === 'Active').length,
    inactive: settings.filter((s) => s.status === 'Inactive').length,
    passwordRequired: settings.filter((s) => s.requirePasswordReAuthentication).length,
    commentRequired: settings.filter((s) => s.requireCommentReason).length,
    roleGated: settings.filter((s) => s.requireRoleVerification).length,
    finalApproval: settings.filter((s) => s.requireFinalApprovalSignature).length,
  };
}

function formToCallablePayload(data: EsignSettingFormData, changeReason: string) {
  return {
    settingCode: data.settingCode,
    moduleName: data.moduleName,
    actionType: data.actionType,
    moduleAliases: parseCsvList(data.moduleAliases),
    actionAliases: parseCsvList(data.actionAliases),
    signatureMeaning: data.signatureMeaning,
    requirePasswordReAuthentication: data.requirePasswordReAuthentication,
    requireCommentReason: data.requireCommentReason,
    requireRoleVerification: data.requireRoleVerification,
    requireDepartmentVerification: data.requireDepartmentVerification,
    requireActiveSession: data.requireActiveSession,
    sessionTimeoutMinutes: data.sessionTimeoutMinutes,
    maxFailedEsignAttempts: data.maxFailedEsignAttempts,
    lockAccountAfterFailedAttempts: data.lockAccountAfterFailedAttempts,
    allowDelegatedSignature: data.allowDelegatedSignature,
    requireFinalApprovalSignature: data.requireFinalApprovalSignature,
    showSignatureStatement: data.showSignatureStatement,
    signatureStatementText: data.signatureStatementText,
    allowedRoles: parseCsvList(data.allowedRoles),
    allowedDepartments: parseCsvList(data.allowedDepartments),
    remarks: data.remarks,
    changeReason: changeReason || data.changeReason || 'E-signature policy change',
  };
}

export async function createEsignSetting(
  data: EsignSettingFormData,
  meta: EsignSettingAuditMeta,
): Promise<{ setting: EsignSettings | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Created by ${meta.userName}`;
    if (reason.trim().length < 5) {
      return { setting: null, error: 'Change reason is required (min 5 characters)' };
    }
    const fn = httpsCallable(getFirebaseFunctions(), 'createAdminEsignSetting');
    const result = await fn(formToCallablePayload(data, reason));
    const id = (result.data as { id?: string })?.id;
    const setting = id ? await fetchEsignSettingById(id) : null;
    return { setting, error: null };
  } catch (e) {
    return { setting: null, error: callableErrorMessage(e, 'Unable to create e-signature setting') };
  }
}

export async function updateEsignSetting(
  id: string,
  data: EsignSettingFormData,
  _existing: EsignSettings,
  meta: EsignSettingAuditMeta,
): Promise<{ setting: EsignSettings | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Updated by ${meta.userName}`;
    if (reason.trim().length < 5) {
      return { setting: null, error: 'Change reason is required (min 5 characters)' };
    }
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminEsignSetting');
    await fn({ id, ...formToCallablePayload(data, reason) });
    const setting = await fetchEsignSettingById(id);
    return { setting, error: null };
  } catch (e) {
    return { setting: null, error: callableErrorMessage(e, 'Unable to update e-signature setting') };
  }
}

export async function setEsignSettingStatus(
  id: string,
  setting: EsignSettings,
  status: 'Active' | 'Inactive',
  meta: EsignSettingAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `${status === 'Active' ? 'Activated' : 'Deactivated'} by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminEsignSettingStatus');
    await fn({ id, status, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to update status') };
  }
}

export async function softDeleteEsignSetting(
  id: string,
  meta: EsignSettingAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `Soft-deleted by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminEsignSetting');
    await fn({ id, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to delete setting') };
  }
}

export function exportEsignSettingsCsv(settings: EsignSettings[]): string {
  const headers = [
    'Setting Code', 'Module', 'Action', 'Module Aliases', 'Action Aliases', 'Signature Meaning',
    'Password Required', 'Comment Required', 'Role Verification', 'Session Timeout',
    'Max Failed Attempts', 'Lock After Failures', 'Status',
  ];
  const rows = settings.map((s) => [
    s.settingCode, s.moduleName, s.actionType,
    (s.moduleAliases || []).join('|'), (s.actionAliases || []).join('|'),
    s.signatureMeaning,
    s.requirePasswordReAuthentication ? 'Yes' : 'No',
    s.requireCommentReason ? 'Yes' : 'No',
    s.requireRoleVerification ? 'Yes' : 'No',
    String(s.sessionTimeoutMinutes),
    String(s.maxFailedEsignAttempts),
    s.lockAccountAfterFailedAttempts ? 'Yes' : 'No',
    s.status,
  ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
  return `\uFEFF${[headers.join(','), ...rows].join('\n')}`;
}

export async function logEsignSettingsExport(meta: EsignSettingAuditMeta, count: number): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminEsignSettingsExport');
    await fn({ format: 'Excel', count, userName: meta.userName });
  } catch (error) {
    console.error('ESIGN_SETTINGS_FAILURE: logEsignSettingsExport', error);
  }
}

export async function seedDefaultEsignSettings(
  meta: EsignSettingAuditMeta,
): Promise<{ created: number; skipped: number }> {
  try {
    const fn = httpsCallable<
      { changeReason: string },
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminEsignSettings');
    const result = await fn({ changeReason: `Seeded by ${meta.userName}` });
    return { created: result.data.created || 0, skipped: result.data.skipped || 0 };
  } catch (e) {
    console.error('seedDefaultEsignSettings failed', e);
    return { created: 0, skipped: 0 };
  }
}

/** Used by form defaults */
export function emptyEsignSettingForm(): EsignSettingFormData {
  return {
    settingCode: '',
    moduleName: 'CAPA',
    actionType: 'Approved By',
    moduleAliases: '',
    actionAliases: '',
    signatureMeaning: 'I approve this record',
    requirePasswordReAuthentication: true,
    requireCommentReason: true,
    requireRoleVerification: true,
    requireDepartmentVerification: false,
    requireActiveSession: true,
    sessionTimeoutMinutes: 15,
    maxFailedEsignAttempts: 3,
    lockAccountAfterFailedAttempts: true,
    allowDelegatedSignature: false,
    requireFinalApprovalSignature: false,
    showSignatureStatement: true,
    signatureStatementText: '',
    allowedRoles: '',
    allowedDepartments: '',
    remarks: '',
    changeReason: '',
  };
}
