/**
 * E-Signature Settings — privileged Cloud Functions.
 * Part 11 / Annex 11 / ALCOA+ policy master + server-attested signature records.
 */
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore, type Firestore, type DocumentData,
} from 'firebase-admin/firestore';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

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

function optionalString(value: unknown, field: string, maxLength = 5000): string {
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

function requiredReason(value: unknown): string {
  const reason = requiredString(value, 'Change reason', 2000);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function asNumber(value: unknown, fallback: number, min = 1): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 40);
}

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'];
const EDITOR_ROLES = ['super_admin', 'admin'];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'E-Signature Settings view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'E-Signature Settings edit access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
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

async function writeEsignAudit(
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
    auditId: `AUD-ESIGN-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'E-Signature Settings',
    collectionName: 'esign_settings',
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
    source: 'esign-settings-admin',
    eSignatureRequired: false,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'E-Signature Settings',
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
  if (!userId) return;
  await firestore.collection('notifications').doc().set({
    userId,
    type,
    title,
    message,
    module: 'E-Signature Settings',
    severity,
    isRead: false,
    createdAt: now,
  });
}

function buildSettingCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, '-').slice(0, 60);
}

function buildEsignSettingId(code: string): string {
  return `ESIGN-${buildSettingCode(code)}`;
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

function settingMatches(
  setting: DocumentData,
  moduleName: string,
  actionType: string,
): boolean {
  const modules = [String(setting.moduleName || ''), ...asStringArray(setting.moduleAliases)];
  const actions = [String(setting.actionType || ''), ...asStringArray(setting.actionAliases)];
  const moduleOk = modules.some((m) => tokensMatch(m, moduleName));
  const actionOk = actions.some((a) => tokensMatch(a, actionType));
  return moduleOk && actionOk;
}

function parseSettingPayload(data: Record<string, unknown>, actorUid: string, status = 'Active') {
  const settingCode = buildSettingCode(requiredString(data.settingCode, 'Setting code', 60));
  const moduleName = requiredString(data.moduleName, 'Module', 120);
  const actionType = requiredString(data.actionType, 'Action type', 120);
  const signatureMeaning = requiredString(data.signatureMeaning, 'Signature meaning', 500);
  const statement = optionalString(data.signatureStatementText, 'Statement', 2000)
    || `By signing electronically, I confirm: ${signatureMeaning}`;

  return {
    esignSettingId: buildEsignSettingId(settingCode),
    settingCode,
    moduleName,
    actionType,
    moduleAliases: asStringArray(data.moduleAliases),
    actionAliases: asStringArray(data.actionAliases),
    signatureMeaning,
    allowedMeanings: asStringArray(data.allowedMeanings),
    requirePasswordReAuthentication: asBool(data.requirePasswordReAuthentication, true),
    requirePasswordConfirmation: asBool(data.requirePasswordReAuthentication, true),
    requireCommentReason: asBool(data.requireCommentReason, true),
    requireReason: asBool(data.requireCommentReason, true),
    requireRoleVerification: asBool(data.requireRoleVerification, true),
    requireDepartmentVerification: asBool(data.requireDepartmentVerification, false),
    requireActiveSession: asBool(data.requireActiveSession, true),
    sessionTimeoutMinutes: asNumber(data.sessionTimeoutMinutes, 15),
    sessionTimeout: asNumber(data.sessionTimeoutMinutes, 15),
    maxFailedEsignAttempts: asNumber(data.maxFailedEsignAttempts, 3),
    lockAccountAfterFailedAttempts: asBool(data.lockAccountAfterFailedAttempts, true),
    allowDelegatedSignature: asBool(data.allowDelegatedSignature, false),
    requireFinalApprovalSignature: asBool(data.requireFinalApprovalSignature, false),
    showSignatureStatement: asBool(data.showSignatureStatement, true),
    signatureStatementText: statement,
    authenticationMethods: asStringArray(data.authenticationMethods).length
      ? asStringArray(data.authenticationMethods)
      : ['Password Confirmation'],
    allowedRoles: asStringArray(data.allowedRoles),
    allowedDepartments: asStringArray(data.allowedDepartments),
    siteScope: optionalString(data.siteScope, 'Site scope', 120),
    businessUnitScope: optionalString(data.businessUnitScope, 'BU scope', 120),
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    status,
    isDeleted: false,
    immutable: false,
    updatedBy: actorUid,
  };
}

async function assertNoDuplicateActive(
  firestore: Firestore,
  moduleName: string,
  actionType: string,
  excludeId?: string,
) {
  const snap = await firestore.collection('esign_settings')
    .where('status', '==', 'Active')
    .limit(200)
    .get();
  const conflict = snap.docs.find((d) => {
    if (excludeId && d.id === excludeId) return false;
    const data = d.data();
    if (data.isDeleted === true) return false;
    return String(data.moduleName) === moduleName && String(data.actionType) === actionType;
  });
  if (conflict) {
    throw new HttpsError('already-exists', 'An active setting already exists for this module and action');
  }
}

const DEFAULT_SETTINGS = [
  {
    settingCode: 'PQR-APPROVE',
    moduleName: 'PQR',
    actionType: 'Approved By',
    moduleAliases: ['PQR Approval', 'Product Quality Review'],
    actionAliases: ['Approve', 'Approval', 'Approved'],
    signatureMeaning: 'I approve this record',
  },
  {
    settingCode: 'DEV-APPROVE',
    moduleName: 'Deviation',
    actionType: 'Approved By',
    moduleAliases: ['Deviation Approval', 'Deviation Closure'],
    actionAliases: ['Approve', 'Reject', 'Close Deviation', 'Approval'],
    signatureMeaning: 'I approve this record',
  },
  {
    settingCode: 'CAPA-APPROVE',
    moduleName: 'CAPA',
    actionType: 'Approved By',
    moduleAliases: ['CAPA Approval Workflow', 'CAPA Closure', 'CAPA'],
    actionAliases: ['Approve', 'Approval', 'CAPA Closure Authorization', 'Approved By'],
    signatureMeaning: 'I approve this record',
  },
  {
    settingCode: 'OOS-CLOSE',
    moduleName: 'OOS',
    actionType: 'Closed By',
    moduleAliases: ['OOS Investigation', 'Out of Specification'],
    actionAliases: ['Close', 'Closed', 'Close OOS'],
    signatureMeaning: 'I close this record',
  },
  {
    settingCode: 'CC-APPROVE',
    moduleName: 'Change Control',
    actionType: 'Approved By',
    moduleAliases: ['Change Control Approval', 'Change Control'],
    actionAliases: ['Approve', 'Approval', 'Authorize'],
    signatureMeaning: 'I approve this change',
  },
  {
    settingCode: 'DMS-RELEASE',
    moduleName: 'DMS',
    actionType: 'Document Effective By',
    moduleAliases: ['Document Management', 'Document Release'],
    actionAliases: ['Release', 'Issue', 'Effective', 'Document Effective By'],
    signatureMeaning: 'I confirm this action',
  },
  {
    settingCode: 'EBMR-RELEASE',
    moduleName: 'eBMR',
    actionType: 'Batch Released By',
    moduleAliases: ['eBMR', 'Batch Release'],
    actionAliases: ['Release', 'Batch Released By', 'Batch Release'],
    signatureMeaning: 'I release this batch',
  },
  {
    settingCode: 'ADMIN-CHANGE',
    moduleName: 'Admin Changes',
    actionType: 'Approved By',
    moduleAliases: ['Admin', 'User Access Review', 'E-Signature Settings'],
    actionAliases: ['Approve', 'Configuration Change', 'Policy Update'],
    signatureMeaning: 'I confirm this action',
  },
];

export const createAdminEsignSetting = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const payload = parseSettingPayload(data, actorUid, 'Active');

  const codeSnap = await firestore.collection('esign_settings')
    .where('settingCode', '==', payload.settingCode)
    .limit(1)
    .get();
  if (!codeSnap.empty && codeSnap.docs[0].data().isDeleted !== true) {
    throw new HttpsError('already-exists', 'Setting code already exists');
  }
  await assertNoDuplicateActive(firestore, payload.moduleName, payload.actionType);

  const now = new Date().toISOString();
  const ref = firestore.collection('esign_settings').doc();
  await ref.set({
    ...payload,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    changeReason: reason,
  });

  await writeEsignAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: 'Create',
    description: `E-signature setting ${payload.settingCode} created`,
    newValue: payload, reason, now,
  });
  await notify(firestore, actorUid, 'Configuration Changed', 'E-signature setting created',
    `${payload.settingCode} created for ${payload.moduleName}/${payload.actionType}`, now);

  return { success: true, id: ref.id, esignSettingId: payload.esignSettingId };
});

export const updateAdminEsignSetting = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Setting ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('esign_settings').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'E-signature setting not found');
  }
  const prev = snap.data() || {};
  const payload = parseSettingPayload(data, actorUid, String(prev.status || 'Active'));

  if (payload.settingCode !== String(prev.settingCode || '')) {
    const codeSnap = await firestore.collection('esign_settings')
      .where('settingCode', '==', payload.settingCode)
      .limit(1)
      .get();
    if (!codeSnap.empty && codeSnap.docs[0].id !== id) {
      throw new HttpsError('already-exists', 'Setting code already exists');
    }
  }
  if (String(prev.status) === 'Active') {
    await assertNoDuplicateActive(firestore, payload.moduleName, payload.actionType, id);
  }

  const now = new Date().toISOString();
  await snap.ref.update({
    ...payload,
    updatedAt: now,
    changeReason: reason,
  });

  await writeEsignAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Update',
    description: `E-signature setting ${payload.settingCode} updated`,
    oldValue: { moduleName: prev.moduleName, actionType: prev.actionType, status: prev.status },
    newValue: payload, reason, now,
  });
  await notify(firestore, actorUid, 'Policy Updated', 'E-signature policy updated',
    `${payload.settingCode} was updated`, now);

  return { success: true, id };
});

export const setAdminEsignSettingStatus = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Setting ID', 128);
  const status = requiredString(data.status, 'Status', 20);
  const reason = requiredReason(data.changeReason ?? data.reason);
  if (!['Active', 'Inactive'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Status must be Active or Inactive');
  }
  const snap = await firestore.collection('esign_settings').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'E-signature setting not found');
  const prev = snap.data() || {};
  if (status === 'Active') {
    await assertNoDuplicateActive(firestore, String(prev.moduleName), String(prev.actionType), id);
  }
  const now = new Date().toISOString();
  await snap.ref.update({ status, updatedAt: now, updatedBy: actorUid, changeReason: reason });
  await writeEsignAudit(firestore, {
    actorUid, actorName, recordId: id,
    actionType: status === 'Active' ? 'Activate' : 'Deactivate',
    description: `E-signature setting ${prev.settingCode || id} set to ${status}`,
    oldValue: { status: prev.status }, newValue: { status }, reason, now,
  });
  return { success: true, id, status };
});

export const softDeleteAdminEsignSetting = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Setting ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('esign_settings').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'E-signature setting not found');
  const prev = snap.data() || {};
  const now = new Date().toISOString();
  await snap.ref.update({
    isDeleted: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  });
  await writeEsignAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Delete',
    description: `E-signature setting ${prev.settingCode || id} soft-deleted`,
    oldValue: prev, newValue: { isDeleted: true }, reason, now,
  });
  return { success: true, id };
});

export const seedAdminEsignSettings = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason ?? 'Seed default e-signature policies');
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;

  for (const def of DEFAULT_SETTINGS) {
    const existing = await firestore.collection('esign_settings')
      .where('settingCode', '==', def.settingCode)
      .limit(1)
      .get();
    if (!existing.empty && existing.docs[0].data().isDeleted !== true) {
      // Enrich aliases on existing seed rows
      await existing.docs[0].ref.update({
        moduleAliases: def.moduleAliases,
        actionAliases: def.actionAliases,
        updatedAt: now,
        updatedBy: actorUid,
      });
      skipped += 1;
      continue;
    }
    const payload = parseSettingPayload({
      ...def,
      requirePasswordReAuthentication: true,
      requireCommentReason: true,
      requireRoleVerification: true,
      requireDepartmentVerification: def.settingCode === 'EBMR-RELEASE',
      requireActiveSession: true,
      sessionTimeoutMinutes: def.settingCode === 'EBMR-RELEASE' ? 10 : 15,
      maxFailedEsignAttempts: 3,
      lockAccountAfterFailedAttempts: true,
      allowDelegatedSignature: false,
      requireFinalApprovalSignature: ['PQR-APPROVE', 'EBMR-RELEASE'].includes(def.settingCode),
      showSignatureStatement: true,
      remarks: `Seeded default ${def.settingCode}`,
    }, actorUid, 'Active');
    await firestore.collection('esign_settings').doc().set({
      ...payload,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      changeReason: reason,
    });
    created += 1;
  }

  await writeEsignAudit(firestore, {
    actorUid, actorName, recordId: 'seed', actionType: 'Create',
    description: `Seeded e-signature settings (created ${created}, updated/skipped ${skipped})`,
    newValue: { created, skipped }, reason, now,
  });
  return { success: true, created, skipped };
});

export const resolveAdminEsignSetting = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const moduleName = requiredString(data.moduleName, 'Module', 120);
  const actionType = requiredString(data.actionType, 'Action type', 120);
  const snap = await firestore.collection('esign_settings')
    .where('status', '==', 'Active')
    .limit(300)
    .get();
  const match = snap.docs.find((d) => {
    const row = d.data();
    return row.isDeleted !== true && settingMatches(row, moduleName, actionType);
  });
  if (!match) return { success: true, setting: null };
  return { success: true, setting: { id: match.id, ...match.data() } };
});

export const recordAdminEsignAttestation = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  if (!actor || actor.is_active !== true) {
    throw new HttpsError('permission-denied', 'Active account required');
  }
  const data = (request.data || {}) as Record<string, unknown>;
  const moduleName = requiredString(data.moduleName, 'Module', 120);
  const actionType = requiredString(data.actionType, 'Action type', 120);
  const recordId = requiredString(data.recordId, 'Record ID', 128);
  const meaning = requiredString(data.signatureMeaning, 'Signature meaning', 500);
  const reasonComment = optionalString(data.reasonComment, 'Reason', 2000);
  const isTest = Boolean(data.isTest);
  const authStatus = requiredString(data.authenticationStatus || 'Success', 'Auth status', 40);
  const documentNumber = optionalString(data.documentNumber, 'Document number', 120);
  const deviceInfo = optionalString(data.deviceInfo, 'Device', 1000) || 'client';
  const browser = optionalString(data.browser, 'Browser', 120);
  const operatingSystem = optionalString(data.operatingSystem, 'OS', 120);
  const authMethod = optionalString(data.authenticationMethod, 'Auth method', 80) || 'Password Confirmation';
  const mfaStatus = optionalString(data.mfaStatus, 'MFA status', 40) || 'Not Applicable';
  const clientReauthAt = optionalString(data.clientReauthAt, 'Reauth timestamp', 40);

  // Require recent auth_time for non-test signatures (Part 11 re-authentication)
  if (!isTest && authStatus === 'Success') {
    const authTime = Number(request.auth?.token?.auth_time || 0) * 1000;
    const reauthMs = clientReauthAt ? Date.parse(clientReauthAt) : 0;
    const recent = (authTime && Date.now() - authTime < 10 * 60_000)
      || (reauthMs && Date.now() - reauthMs < 10 * 60_000);
    if (!recent) {
      throw new HttpsError('failed-precondition', 'Recent re-authentication is required before signing');
    }
  }

  const settingsSnap = await firestore.collection('esign_settings')
    .where('status', '==', 'Active')
    .limit(300)
    .get();
  const settingDoc = settingsSnap.docs.find((d) => {
    const row = d.data();
    return row.isDeleted !== true && settingMatches(row, moduleName, actionType);
  });
  const setting = settingDoc?.data();

  if (!setting && !isTest) {
    throw new HttpsError('failed-precondition', `No active e-signature setting for ${moduleName} / ${actionType}`);
  }

  if (setting?.requireCommentReason && authStatus === 'Success' && !reasonComment) {
    throw new HttpsError('invalid-argument', 'Reason or comment is required');
  }

  if (setting?.requireRoleVerification && Array.isArray(setting.allowedRoles) && setting.allowedRoles.length > 0) {
    if (!setting.allowedRoles.map(String).includes(actorRole)) {
      throw new HttpsError('permission-denied', 'Your role is not authorized for this signature');
    }
  }

  if (setting?.requireDepartmentVerification && Array.isArray(setting.allowedDepartments) && setting.allowedDepartments.length) {
    const dept = String(actor?.department || data.department || '');
    if (!setting.allowedDepartments.map(String).includes(dept)) {
      throw new HttpsError('permission-denied', 'Your department is not authorized for this signature');
    }
  }

  if (setting?.allowDelegatedSignature === false && data.delegated === true) {
    throw new HttpsError('failed-precondition', 'Delegated signatures are not allowed for this policy');
  }

  const now = new Date().toISOString();
  const esignRecordId = `ESR-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const transactionId = `TXN-ESIGN-${Date.now().toString(36).toUpperCase()}`;
  const timezone = optionalString(data.timezone, 'Timezone', 80) || 'UTC';

  const hashPayload = {
    esignRecordId,
    transactionId,
    moduleName,
    actionType,
    recordId,
    documentNumber,
    signatureMeaning: meaning,
    reasonComment,
    userId: actorUid,
    userName: actorName,
    signedDateTime: now,
    authenticationStatus: authStatus,
    authenticationMethod: authMethod,
  };
  const digitalHash = createHash('sha256').update(JSON.stringify(hashPayload)).digest('hex');

  const record = {
    esignRecordId,
    transactionId,
    referenceId: recordId,
    workflowId: optionalString(data.workflowId, 'Workflow ID', 128),
    approvalLevel: optionalString(data.approvalLevel, 'Approval level', 40),
    moduleName,
    subModule: optionalString(data.subModule, 'Sub module', 120),
    documentNumber,
    recordId,
    actionType,
    signatureMeaning: meaning,
    reason: reasonComment,
    reasonComment,
    comments: reasonComment,
    userId: actorUid,
    user_id: actorUid,
    signed_by: actorUid,
    signer_user_id: actorUid,
    employeeId: optionalString(data.employeeId, 'Employee ID', 80),
    username: optionalString(data.username, 'Username', 80) || String(actor?.email || ''),
    userName: actorName,
    userEmail: String(actor?.email || ''),
    userRole: actorRole,
    role: actorRole,
    department: String(actor?.department || data.department || ''),
    company: optionalString(data.company, 'Company', 120),
    businessUnit: optionalString(data.businessUnit, 'Business unit', 120),
    site: optionalString(data.site, 'Site', 120),
    ipAddress: request.rawRequest.ip || 'server',
    deviceInfo,
    device: deviceInfo,
    browser,
    operatingSystem,
    authenticationMethod: authMethod,
    mfaStatus,
    signedDateTime: now,
    timestampUtc: now,
    timezone,
    digitalHash,
    integrityHash: digitalHash,
    authenticationStatus: authStatus,
    status: authStatus === 'Failed' ? 'Failed' : (isTest ? 'Test' : 'Signed'),
    isTest,
    settingId: settingDoc?.id || '',
    settingCode: String(setting?.settingCode || ''),
    appendOnly: true,
    immutable: true,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
  };

  const ref = firestore.collection('esign_records').doc();
  await ref.set(record);

  // Dual-write enterprise collection with rule-compatible fields
  await firestore.collection('electronic_signatures').doc(ref.id).set({
    ...record,
    user_id: actorUid,
    userId: actorUid,
    signed_by: actorUid,
    signer_user_id: actorUid,
    signed_at: now,
    module: moduleName,
    action: actionType,
  }).catch(() => undefined);

  await writeEsignAudit(firestore, {
    actorUid, actorName, recordId: ref.id,
    actionType: authStatus === 'Failed' ? 'E-Signature Failed' : 'E-Signature',
    description: `${authStatus === 'Failed' ? 'Failed' : 'Completed'} e-signature for ${moduleName}/${actionType}`,
    newValue: {
      esignRecordId, recordId, moduleName, actionType, digitalHash, authenticationStatus: authStatus,
    },
    reason: reasonComment || 'Electronic signature',
    now,
  });

  if (authStatus === 'Failed') {
    await notify(firestore, actorUid, 'Signature Failed', 'Electronic signature failed',
      `Authentication failed for ${moduleName}/${actionType}`, now, 'High');
  } else if (!isTest) {
    await notify(firestore, actorUid, 'Signature Completed', 'Electronic signature completed',
      `Signed ${moduleName}/${actionType} on ${recordId}`, now);
  }

  return { success: true, id: ref.id, esignRecordId, digitalHash, record };
});

export const logAdminEsignSettingsExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const format = requiredString(data.format || 'Excel', 'Format', 40);
  const count = Number(data.count || 0);
  const now = new Date().toISOString();
  await writeEsignAudit(firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Export',
    description: `Exported ${count} e-signature settings as ${format}`,
    newValue: { format, count }, reason: 'Export', now,
  });
  return { success: true };
});
