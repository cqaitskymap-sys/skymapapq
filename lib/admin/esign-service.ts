import {
  EmailAuthProvider, reauthenticateWithCredential,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { createAuditLog } from '@/lib/audit-trail';
import { getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import {
  createSignatureSession, completeSignatureSession, getClientDeviceInfo,
} from '@/lib/electronic-signatures-service';
import { ADMIN_COLLECTIONS } from './constants';
import {
  fetchActiveEsignSetting, normalizeEsignSetting,
} from './esign-settings-service';
import type { EsignRecord, EsignSettings } from './schemas';

export interface PerformEsignInput {
  moduleName: string;
  recordId: string;
  documentNumber?: string;
  actionType: string;
  signatureMeaning?: string;
  password?: string;
  reasonComment?: string;
  confirmed?: boolean;
  userId: string;
  userName: string;
  userEmail: string;
  userRole?: string;
  department?: string;
  isTest?: boolean;
  workflowId?: string;
  approvalLevel?: string;
  subModule?: string;
}

export interface PerformEsignResult {
  success: boolean;
  record?: EsignRecord;
  error?: string;
  locked?: boolean;
}

function getDeviceInfo(): string {
  return getClientDeviceInfo().device;
}

function parseUa() {
  if (typeof navigator === 'undefined') {
    return { browser: 'server', operatingSystem: 'server' };
  }
  const ua = navigator.userAgent;
  let browser = 'Unknown';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  let operatingSystem = 'Unknown';
  if (/Windows/i.test(ua)) operatingSystem = 'Windows';
  else if (/Mac OS/i.test(ua)) operatingSystem = 'macOS';
  else if (/Android/i.test(ua)) operatingSystem = 'Android';
  else if (/iPhone|iPad/i.test(ua)) operatingSystem = 'iOS';
  else if (/Linux/i.test(ua)) operatingSystem = 'Linux';
  return { browser, operatingSystem };
}

export async function fetchEsignRecords(): Promise<EsignRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.esignRecords),
      orderBy('signedDateTime', 'desc'),
      limit(400),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as EsignRecord));
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.esignRecords));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as EsignRecord))
        .sort((a, b) => String(b.signedDateTime).localeCompare(String(a.signedDateTime)));
    } catch {
      return [];
    }
  }
}

export async function fetchEsignRecordsForRecord(recordId: string): Promise<EsignRecord[]> {
  const all = await fetchEsignRecords();
  return all.filter((r) => r.recordId === recordId && !r.isTest);
}

export function getEsignRecordsSummary(records: EsignRecord[]) {
  return {
    totalRecords: records.filter((r) => !r.isTest).length,
    failedAttempts: records.filter((r) => r.authenticationStatus === 'Failed').length,
    testSignatures: records.filter((r) => r.isTest).length,
    signed: records.filter((r) => r.status === 'Signed' && !r.isTest).length,
  };
}

async function getUserLockState(userId: string): Promise<{ failedAttempts: number; lockedUntil: string | null }> {
  if (!isFirebaseConfigured()) return { failedAttempts: 0, lockedUntil: null };
  const snap = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.users, userId));
  if (!snap.exists()) return { failedAttempts: 0, lockedUntil: null };
  const data = snap.data();
  return {
    failedAttempts: Number(data.esignFailedAttempts ?? 0),
    lockedUntil: data.esignLockedUntil ? String(data.esignLockedUntil) : null,
  };
}

async function incrementFailedAttempts(
  userId: string,
  maxAttempts: number,
  lockAccount: boolean,
): Promise<{ locked: boolean; attempts: number }> {
  if (!isFirebaseConfigured()) return { locked: false, attempts: 0 };
  const ref = doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.users, userId);
  const snap = await getDoc(ref);
  const current = Number(snap.data()?.esignFailedAttempts ?? 0) + 1;
  const locked = lockAccount && current >= maxAttempts;
  const lockedUntil = locked ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;
  await updateDoc(ref, {
    esignFailedAttempts: current,
    esignLockedUntil: lockedUntil,
    updatedAt: new Date().toISOString(),
  }).catch(() => undefined);
  return { locked, attempts: current };
}

async function resetFailedAttempts(userId: string): Promise<void> {
  if (!isFirebaseConfigured()) return;
  await updateDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.users, userId), {
    esignFailedAttempts: 0,
    esignLockedUntil: null,
    updatedAt: new Date().toISOString(),
  }).catch(() => undefined);
}

async function attestViaCloud(input: {
  moduleName: string;
  actionType: string;
  recordId: string;
  documentNumber?: string;
  signatureMeaning: string;
  reasonComment?: string;
  authenticationStatus: string;
  isTest?: boolean;
  clientReauthAt?: string;
  department?: string;
  workflowId?: string;
  approvalLevel?: string;
  subModule?: string;
}): Promise<EsignRecord> {
  const ua = parseUa();
  const fn = httpsCallable(getFirebaseFunctions(), 'recordAdminEsignAttestation');
  const result = await fn({
    ...input,
    deviceInfo: getDeviceInfo(),
    browser: ua.browser,
    operatingSystem: ua.operatingSystem,
    authenticationMethod: 'Password Confirmation',
    mfaStatus: 'Not Applicable',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  });
  const data = result.data as { record?: EsignRecord; id?: string };
  return { ...(data.record || {}), id: data.id } as EsignRecord;
}

export async function performEsign(input: PerformEsignInput): Promise<PerformEsignResult> {
  const setting = await fetchActiveEsignSetting(input.moduleName, input.actionType);
  if (!setting && !input.isTest) {
    return { success: false, error: `No active e-signature setting for ${input.moduleName} / ${input.actionType}` };
  }

  const normalized = setting ? normalizeEsignSetting(setting) : null;
  const lockState = await getUserLockState(input.userId);
  if (lockState.lockedUntil && new Date(lockState.lockedUntil) > new Date()) {
    return { success: false, error: 'Account is temporarily locked due to failed e-signature attempts', locked: true };
  }

  if (normalized?.requireActiveSession && !input.userId) {
    return { success: false, error: 'Active session required' };
  }

  if (!input.confirmed) {
    return { success: false, error: 'Electronic signature confirmation is required' };
  }

  if (normalized?.requireRoleVerification && (normalized.allowedRoles || []).length > 0) {
    if (!input.userRole || !normalized.allowedRoles.includes(input.userRole)) {
      return { success: false, error: 'Your role is not authorized for this electronic signature' };
    }
  }

  if (normalized?.requireDepartmentVerification && (normalized.allowedDepartments || []).length > 0) {
    if (!input.department || !normalized.allowedDepartments.includes(input.department)) {
      return { success: false, error: 'Your department is not authorized for this electronic signature' };
    }
  }

  let sessionId = '';
  try {
    sessionId = await createSignatureSession(input.userId, input.moduleName, input.recordId, input.actionType);
  } catch { /* session optional */ }

  const meaning = input.signatureMeaning || normalized?.signatureMeaning || '';
  if (normalized?.requireCommentReason && !input.reasonComment?.trim()) {
    return { success: false, error: 'Reason or comment is required' };
  }

  let clientReauthAt = '';
  if (normalized?.requirePasswordReAuthentication) {
    if (!input.password) {
      return { success: false, error: 'Password is required for re-authentication' };
    }
    if (!isFirebaseConfigured()) {
      return { success: false, error: 'Firebase not configured' };
    }
    try {
      const auth = getFirebaseAuth();
      const currentUser = auth.currentUser;
      if (!currentUser || currentUser.uid !== input.userId) {
        return { success: false, error: 'You can only sign as the logged-in user' };
      }
      // Prevent autofill bypass: require non-empty password typed for this session
      if (input.password.length < 6) {
        return { success: false, error: 'Invalid password for re-authentication' };
      }
      const credential = EmailAuthProvider.credential(input.userEmail, input.password);
      await reauthenticateWithCredential(currentUser, credential);
      clientReauthAt = new Date().toISOString();
    } catch {
      const maxAttempts = normalized?.maxFailedEsignAttempts ?? 3;
      const lockResult = await incrementFailedAttempts(
        input.userId,
        maxAttempts,
        normalized?.lockAccountAfterFailedAttempts ?? true,
      );

      let failedRecord: EsignRecord | undefined;
      try {
        failedRecord = await attestViaCloud({
          moduleName: input.moduleName,
          actionType: input.actionType,
          recordId: input.recordId,
          documentNumber: input.documentNumber,
          signatureMeaning: meaning,
          reasonComment: input.reasonComment,
          authenticationStatus: 'Failed',
          isTest: input.isTest,
          department: input.department,
          workflowId: input.workflowId,
          approvalLevel: input.approvalLevel,
          subModule: input.subModule,
        });
      } catch { /* best effort */ }

      await createAuditLog({
        moduleName: input.moduleName,
        collectionName: ADMIN_COLLECTIONS.esignRecords,
        recordId: input.recordId,
        documentNumber: input.documentNumber,
        actionType: 'E-Signature',
        actionDescription: 'Failed e-signature attempt',
        user: { id: input.userId, name: input.userName, role: input.userRole, department: input.department },
        status: 'Failed',
        newValue: { attempts: lockResult.attempts },
      }).catch(() => undefined);

      if (sessionId) {
        await completeSignatureSession(sessionId, false).catch(() => undefined);
      }

      return {
        success: false,
        error: lockResult.locked
          ? 'Maximum failed attempts reached. Account temporarily locked.'
          : 'Password re-authentication failed',
        locked: lockResult.locked,
        record: failedRecord,
      };
    }
  }

  await resetFailedAttempts(input.userId);

  try {
    const record = await attestViaCloud({
      moduleName: input.moduleName,
      actionType: input.actionType,
      recordId: input.recordId,
      documentNumber: input.documentNumber,
      signatureMeaning: meaning,
      reasonComment: input.reasonComment,
      authenticationStatus: 'Success',
      isTest: input.isTest,
      clientReauthAt: clientReauthAt || new Date().toISOString(),
      department: input.department,
      workflowId: input.workflowId,
      approvalLevel: input.approvalLevel,
      subModule: input.subModule,
    });

    if (sessionId) {
      await completeSignatureSession(sessionId, true).catch(() => undefined);
    }

    await createAuditLog({
      moduleName: input.moduleName,
      collectionName: ADMIN_COLLECTIONS.esignRecords,
      recordId: input.recordId,
      documentNumber: input.documentNumber,
      actionType: 'E-Signature',
      actionDescription: input.isTest ? 'Test e-signature' : 'Successful e-signature',
      fieldName: 'actionType',
      newValue: input.actionType,
      reason: input.reasonComment,
      user: { id: input.userId, name: input.userName, role: input.userRole, department: input.department },
      status: 'Success',
      eSignatureRequired: true,
      eSignatureStatus: 'Signed',
    }).catch(() => undefined);

    return { success: true, record };
  } catch (e) {
    if (sessionId) {
      await completeSignatureSession(sessionId, false).catch(() => undefined);
    }
    return {
      success: false,
      error: (e as Error).message || 'Unable to record electronic signature',
    };
  }
}

/** Backward-compatible global settings reader */
export async function getEsignSettings(): Promise<EsignSettings | null> {
  const { fetchEsignSettings } = await import('./esign-settings-service');
  const settings = await fetchEsignSettings();
  return settings.find((s) => s.status === 'Active') ?? settings[0] ?? null;
}
