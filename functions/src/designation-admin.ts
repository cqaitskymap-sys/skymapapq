/**
 * Designation Master — privileged Cloud Functions.
 * Authorization and writes are enforced server-side.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';


function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 200): string {
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

function assertActiveAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !['super_admin', 'admin'].includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }
}

const SYSTEM_DESIGNATION_CODES = new Set([
  'HQA', 'QAM', 'QAE', 'QCM', 'QCE', 'PM', 'WM', 'EM', 'CQA-IT', 'AUD',
]);

const DESIGNATION_LEVELS = [
  'Executive', 'Senior Executive', 'Assistant Manager', 'Deputy Manager',
  'Manager', 'Senior Manager', 'AGM', 'DGM', 'GM', 'Head', 'Director', 'Admin',
] as const;

const DESIGNATION_LEVEL_APPROVAL_MAP: Record<string, number> = {
  Executive: 1,
  'Senior Executive': 2,
  'Assistant Manager': 3,
  'Deputy Manager': 3,
  Manager: 4,
  'Senior Manager': 5,
  AGM: 6,
  DGM: 7,
  GM: 8,
  Head: 9,
  Director: 10,
  Admin: 5,
};

const EMPLOYMENT_CATEGORIES = [
  'Permanent', 'Contract', 'Temporary', 'Consultant', 'Intern', 'Vendor',
] as const;

function designationNotification(
  targetUid: string,
  recordId: string,
  eventName: string,
  title: string,
  message: string,
  now: string,
) {
  return {
    notificationId: `NTF-${Date.now().toString(36).toUpperCase()}-${recordId.slice(0, 6)}`,
    userId: targetUid,
    recipientUserId: targetUid,
    title,
    message,
    type: 'info',
    moduleName: 'Designation Master',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/designations/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeDesignationAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    action: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
    now: string;
  },
) {
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'Designation Master',
    recordId: input.recordId,
    action: input.action,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason,
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  batch.set(firestore.collection('audit_trail').doc(), {
    collectionName: 'designations',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Designation Master',
    reason: input.reason,
    timestamp: input.now,
  });
}

function buildDesignationId(code: string): string {
  return `DESG-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

async function assertActiveDepartment(firestore: Firestore, departmentName: string) {
  const snapshot = await firestore.collection('departments')
    .where('departmentName', '==', departmentName)
    .limit(10)
    .get();
  const active = snapshot.docs.some((document) =>
    document.data().isDeleted !== true
    && String(document.data().status || 'Active') === 'Active');
  if (!active) {
    throw new HttpsError('failed-precondition', 'Department must be active');
  }
}

async function assertNoDesignationCycle(
  firestore: Firestore,
  designationDocId: string,
  parentDesignationId: string,
) {
  if (!parentDesignationId) return;
  if (parentDesignationId === designationDocId) {
    throw new HttpsError('failed-precondition', 'A designation cannot be its own parent');
  }
  let currentId = parentDesignationId;
  const visited = new Set<string>([designationDocId]);
  for (let depth = 0; depth < 25; depth += 1) {
    if (visited.has(currentId)) {
      throw new HttpsError('failed-precondition', 'Circular reporting hierarchy is not allowed');
    }
    visited.add(currentId);
    const parentSnap = await firestore.collection('designations').doc(currentId).get();
    if (!parentSnap.exists || parentSnap.data()?.isDeleted === true) {
      throw new HttpsError('failed-precondition', 'Parent designation is missing or inactive');
    }
    if (String(parentSnap.data()?.status || 'Active') !== 'Active') {
      throw new HttpsError('failed-precondition', 'Parent designation must be Active');
    }
    currentId = String(parentSnap.data()?.parentDesignationId || '');
    if (!currentId) return;
  }
  throw new HttpsError('failed-precondition', 'Designation hierarchy exceeds supported depth');
}

async function countUsersMatchingDesignation(firestore: Firestore, des: DocumentData) {
  const names = [des.designationName, des.designationCode, des.designationId, des.shortName]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  let total = 0;
  for (const name of Array.from(new Set(names))) {
    const snapshot = await firestore.collection('users')
      .where('designation', '==', name)
      .limit(500)
      .get();
    total += snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
  }
  return total;
}

async function cascadeDesignationRename(
  firestore: Firestore,
  batch: WriteBatch,
  oldNames: string[],
  newName: string,
  actorUid: string,
  now: string,
) {
  let cascadeCount = 0;
  const uniqueOld = Array.from(new Set(oldNames.map((n) => n.trim()).filter(Boolean)));
  for (const oldName of uniqueOld) {
    if (oldName === newName) continue;
    const users = await firestore.collection('users').where('designation', '==', oldName).limit(400).get();
    users.docs.forEach((document) => {
      if (document.data().isDeleted === true) return;
      batch.update(document.ref, { designation: newName, updatedAt: now, updatedBy: actorUid });
      cascadeCount += 1;
    });
  }
  return cascadeCount;
}

function parseDesignationPayload(input: Record<string, unknown>, existing?: DocumentData) {
  const designationCode = requiredString(
    input.designationCode ?? existing?.designationCode,
    'designationCode',
    32,
  ).toUpperCase();
  const designationName = requiredString(
    input.designationName ?? existing?.designationName,
    'designationName',
    160,
  );
  const department = requiredString(input.department ?? existing?.department, 'department', 160);
  const designationLevel = String(input.designationLevel || existing?.designationLevel || 'Executive');
  if (!DESIGNATION_LEVELS.includes(designationLevel as typeof DESIGNATION_LEVELS[number])) {
    throw new HttpsError('invalid-argument', 'Invalid designation level');
  }
  const employmentCategory = String(
    input.employmentCategory || existing?.employmentCategory || 'Permanent',
  );
  if (!EMPLOYMENT_CATEGORIES.includes(employmentCategory as typeof EMPLOYMENT_CATEGORIES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid employment category');
  }
  return {
    designationCode,
    designationName,
    department,
    designationLevel,
    employmentCategory,
    shortName: optionalString(input.shortName ?? existing?.shortName, 'shortName', 40) || designationCode,
    parentDesignationId: optionalString(
      input.parentDesignationId ?? existing?.parentDesignationId,
      'parentDesignationId',
      128,
    ),
    reportingLevel: optionalString(input.reportingLevel ?? existing?.reportingLevel, 'reportingLevel', 10),
    jobGrade: optionalString(input.jobGrade ?? existing?.jobGrade, 'jobGrade', 10),
    jobBand: optionalString(input.jobBand ?? existing?.jobBand, 'jobBand', 20),
    jobLevel: optionalString(input.jobLevel ?? existing?.jobLevel, 'jobLevel', 40),
    minimumExperience: Math.max(0, Math.min(50, Number(input.minimumExperience ?? existing?.minimumExperience ?? 0) || 0)),
    requiredQualification: optionalString(
      input.requiredQualification ?? existing?.requiredQualification,
      'requiredQualification',
      500,
    ),
    requiredSkills: optionalString(input.requiredSkills ?? existing?.requiredSkills, 'requiredSkills', 1000),
    businessUnit: optionalString(input.businessUnit ?? existing?.businessUnit, 'businessUnit', 160),
    siteId: optionalString(input.siteId ?? existing?.siteId, 'siteId', 128),
    siteName: optionalString(input.siteName ?? existing?.siteName, 'siteName', 200),
    approvalAuthority: Boolean(input.approvalAuthority ?? existing?.approvalAuthority ?? false),
    canReview: Boolean(input.canReview ?? existing?.canReview ?? false),
    canApprove: Boolean(input.canApprove ?? existing?.canApprove ?? false),
    canESign: Boolean(input.canESign ?? existing?.canESign ?? false),
    description: optionalString(input.description ?? existing?.description, 'description', 2000),
    remarks: optionalString(input.remarks ?? existing?.remarks, 'remarks', 2000),
    status: String(input.status || existing?.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active',
    approvalLevel: DESIGNATION_LEVEL_APPROVAL_MAP[designationLevel] ?? 1,
  };
}

export const createAdminDesignation = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const input = request.data as Record<string, unknown>;
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const parsed = parseDesignationPayload(input);
  await assertActiveDepartment(firestore, parsed.department);
  if (parsed.parentDesignationId) {
    await assertNoDesignationCycle(firestore, 'new', parsed.parentDesignationId);
  }

  const [dupCode, dupName] = await Promise.all([
    firestore.collection('designations').where('designationCode', '==', parsed.designationCode).limit(5).get(),
    firestore.collection('designations').where('designationName', '==', parsed.designationName).limit(10).get(),
  ]);
  if (dupCode.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Designation code already exists');
  }
  if (dupName.docs.some((document) =>
    document.data().isDeleted !== true
    && String(document.data().department || '') === parsed.department)) {
    throw new HttpsError('already-exists', 'Designation name already exists in this department');
  }

  let parentDesignationName = '';
  if (parsed.parentDesignationId) {
    const parentSnap = await firestore.collection('designations').doc(parsed.parentDesignationId).get();
    parentDesignationName = String(parentSnap.data()?.designationName || '');
  }

  if (parsed.siteId) {
    const site = await firestore.collection('company_sites').doc(parsed.siteId).get();
    if (!site.exists || site.data()?.isDeleted === true) {
      throw new HttpsError('failed-precondition', 'Site is missing or inactive');
    }
    parsed.siteName = parsed.siteName || String(site.data()?.siteName || '');
    parsed.businessUnit = parsed.businessUnit || String(site.data()?.companyName || '');
  }

  const now = new Date().toISOString();
  const payload = {
    ...parsed,
    designationId: buildDesignationId(parsed.designationCode),
    parentDesignationName,
    isSystemDesignation: SYSTEM_DESIGNATION_CODES.has(parsed.designationCode),
    isDeleted: false,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  };

  const ref = firestore.collection('designations').doc();
  const batch = firestore.batch();
  batch.set(ref, payload);
  writeDesignationAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: ref.id,
    action: 'CREATE_DESIGNATION',
    oldValue: null,
    newValue: payload,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    designationNotification(
      request.auth.uid,
      ref.id,
      'DESIGNATION_CREATED',
      'Designation created',
      `Designation "${parsed.designationName}" was created.`,
      now,
    ),
  );
  await batch.commit();
  return { id: ref.id, ...payload };
});

export const updateAdminDesignation = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const input = request.data as Record<string, unknown>;
  const designationDocId = requiredString(input.designationDocId, 'designationDocId', 128);
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const updates = (input.updates && typeof input.updates === 'object' && !Array.isArray(input.updates))
    ? input.updates as Record<string, unknown>
    : input;

  const ref = firestore.collection('designations').doc(designationDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Designation not found');
  }
  const existing = snap.data() || {};
  const parsed = parseDesignationPayload(updates, existing);
  await assertActiveDepartment(firestore, parsed.department);
  await assertNoDesignationCycle(firestore, designationDocId, parsed.parentDesignationId);

  if (parsed.designationCode !== existing.designationCode) {
    const dupCode = await firestore.collection('designations')
      .where('designationCode', '==', parsed.designationCode).limit(5).get();
    if (dupCode.docs.some((document) => document.id !== designationDocId && document.data().isDeleted !== true)) {
      throw new HttpsError('already-exists', 'Designation code already exists');
    }
  }
  if (parsed.designationName !== existing.designationName || parsed.department !== existing.department) {
    const dupName = await firestore.collection('designations')
      .where('designationName', '==', parsed.designationName).limit(10).get();
    if (dupName.docs.some((document) =>
      document.id !== designationDocId
      && document.data().isDeleted !== true
      && String(document.data().department || '') === parsed.department)) {
      throw new HttpsError('already-exists', 'Designation name already exists in this department');
    }
  }

  let parentDesignationName = '';
  if (parsed.parentDesignationId) {
    const parentSnap = await firestore.collection('designations').doc(parsed.parentDesignationId).get();
    parentDesignationName = String(parentSnap.data()?.designationName || '');
  }
  if (parsed.siteId) {
    const site = await firestore.collection('company_sites').doc(parsed.siteId).get();
    if (!site.exists || site.data()?.isDeleted === true) {
      throw new HttpsError('failed-precondition', 'Site is missing or inactive');
    }
    parsed.siteName = parsed.siteName || String(site.data()?.siteName || '');
    parsed.businessUnit = parsed.businessUnit || String(site.data()?.companyName || '');
  }

  const now = new Date().toISOString();
  const payload = {
    ...parsed,
    designationId: buildDesignationId(parsed.designationCode),
    parentDesignationName,
    isSystemDesignation: SYSTEM_DESIGNATION_CODES.has(parsed.designationCode)
      || Boolean(existing.isSystemDesignation),
    updatedBy: request.auth.uid,
    updatedAt: now,
  };

  const batch = firestore.batch();
  batch.update(ref, payload);
  const cascadeCount = await cascadeDesignationRename(
    firestore,
    batch,
    [String(existing.designationName || ''), String(existing.designationCode || '')],
    parsed.designationName,
    request.auth.uid,
    now,
  );

  if (String(existing.parentDesignationId || '') !== parsed.parentDesignationId) {
    writeDesignationAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: designationDocId,
      action: 'HIERARCHY_CHANGED',
      oldValue: {
        parentDesignationId: existing.parentDesignationId,
        parentDesignationName: existing.parentDesignationName,
      },
      newValue: { parentDesignationId: parsed.parentDesignationId, parentDesignationName },
      reason,
      now,
    });
  }
  if (String(existing.jobGrade || '') !== parsed.jobGrade
    || String(existing.jobBand || '') !== parsed.jobBand
    || String(existing.designationLevel || '') !== parsed.designationLevel) {
    writeDesignationAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: designationDocId,
      action: 'GRADE_CHANGED',
      oldValue: {
        jobGrade: existing.jobGrade,
        jobBand: existing.jobBand,
        designationLevel: existing.designationLevel,
      },
      newValue: {
        jobGrade: parsed.jobGrade,
        jobBand: parsed.jobBand,
        designationLevel: parsed.designationLevel,
      },
      reason,
      now,
    });
  }
  writeDesignationAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: designationDocId,
    action: 'EDIT_DESIGNATION',
    oldValue: existing,
    newValue: payload,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    designationNotification(
      request.auth.uid,
      designationDocId,
      'DESIGNATION_UPDATED',
      'Designation updated',
      `Designation "${parsed.designationName}" was updated.`,
      now,
    ),
  );
  await batch.commit();
  return {
    designation: { id: designationDocId, ...existing, ...payload },
    cascadeCount,
  };
});

export const setAdminDesignationStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const designationDocId = requiredString(request.data?.designationDocId, 'designationDocId', 128);
  const status = String(request.data?.status || '') === 'Inactive' ? 'Inactive' : 'Active';
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('designations').doc(designationDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Designation not found');
  }
  const existing = snap.data() || {};
  const linkedUsers = await countUsersMatchingDesignation(firestore, existing);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { status, updatedAt: now, updatedBy: request.auth.uid });
  writeDesignationAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: designationDocId,
    action: status === 'Active' ? 'DESIGNATION_ACTIVATED' : 'DESIGNATION_DEACTIVATED',
    oldValue: existing.status,
    newValue: status,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    designationNotification(
      request.auth.uid,
      designationDocId,
      status === 'Active' ? 'DESIGNATION_ACTIVATED' : 'DESIGNATION_DEACTIVATED',
      status === 'Active' ? 'Designation activated' : 'Designation deactivated',
      `Designation "${String(existing.designationName || '')}" is now ${status}.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true, linkedUsers };
});

export const softDeleteAdminDesignation = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);
  if (actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only Super Admin can soft-delete designations');
  }

  const designationDocId = requiredString(request.data?.designationDocId, 'designationDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('designations').doc(designationDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Designation not found');
  const existing = snap.data() || {};
  const code = String(existing.designationCode || '').toUpperCase();
  if (SYSTEM_DESIGNATION_CODES.has(code) || existing.isSystemDesignation === true) {
    throw new HttpsError('failed-precondition', 'System designations cannot be deleted');
  }

  const linkedUsers = await countUsersMatchingDesignation(firestore, existing);
  if (linkedUsers > 0) {
    throw new HttpsError('failed-precondition', `Cannot delete designation: ${linkedUsers} user(s) are linked`);
  }
  const children = await firestore.collection('designations')
    .where('parentDesignationId', '==', designationDocId)
    .limit(20)
    .get();
  if (children.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('failed-precondition', 'Cannot delete designation with active child designations');
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeDesignationAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: designationDocId,
    action: 'DELETE_DESIGNATION',
    oldValue: existing,
    newValue: { isDeleted: true, status: 'Inactive' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    designationNotification(
      request.auth.uid,
      designationDocId,
      'DESIGNATION_DELETED',
      'Designation deleted',
      `Designation "${String(existing.designationName || '')}" was soft-deleted.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const restoreAdminDesignation = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const designationDocId = requiredString(request.data?.designationDocId, 'designationDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('designations').doc(designationDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Designation not found');
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: false,
    status: 'Active',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeDesignationAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: designationDocId,
    action: 'RESTORE_DESIGNATION',
    oldValue: { isDeleted: existing.isDeleted, status: existing.status },
    newValue: { isDeleted: false, status: 'Active' },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const bulkUpdateAdminDesignations = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const designationDocIds = Array.isArray(request.data?.designationDocIds)
    ? (request.data.designationDocIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (designationDocIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one designation');
  }
  const action = String(request.data?.action || '');
  if (!['activate', 'deactivate'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported bulk action');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const status = action === 'activate' ? 'Active' : 'Inactive';
  const now = new Date().toISOString();
  let successCount = 0;

  for (const designationDocId of designationDocIds) {
    const ref = firestore.collection('designations').doc(designationDocId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.isDeleted === true) continue;
    const existing = snap.data() || {};
    const batch = firestore.batch();
    batch.update(ref, { status, updatedAt: now, updatedBy: request.auth!.uid });
    writeDesignationAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: designationDocId,
      action: status === 'Active' ? 'DESIGNATION_ACTIVATED' : 'DESIGNATION_DEACTIVATED',
      oldValue: existing.status,
      newValue: status,
      reason,
      now,
    });
    await batch.commit();
    successCount += 1;
  }
  return { successCount };
});

export const importAdminDesignations = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const reason = requiredString(request.data?.reason, 'reason', 500);
  const rows = Array.isArray(request.data?.rows)
    ? (request.data.rows as Record<string, unknown>[]).slice(0, 100)
    : [];
  if (rows.length === 0) {
    throw new HttpsError('invalid-argument', 'No import rows provided');
  }

  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const [index, row] of rows.entries()) {
    try {
      const parsed = parseDesignationPayload(row);
      await assertActiveDepartment(firestore, parsed.department);
      const [dupCode, dupName] = await Promise.all([
        firestore.collection('designations').where('designationCode', '==', parsed.designationCode).limit(5).get(),
        firestore.collection('designations').where('designationName', '==', parsed.designationName).limit(10).get(),
      ]);
      if (dupCode.docs.some((document) => document.data().isDeleted !== true)) {
        throw new Error('Designation code already exists');
      }
      if (dupName.docs.some((document) =>
        document.data().isDeleted !== true
        && String(document.data().department || '') === parsed.department)) {
        throw new Error('Designation name already exists in this department');
      }
      const payload = {
        ...parsed,
        designationId: buildDesignationId(parsed.designationCode),
        parentDesignationName: '',
        isSystemDesignation: SYSTEM_DESIGNATION_CODES.has(parsed.designationCode),
        isDeleted: false,
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
        createdAt: now,
        updatedAt: now,
      };
      const ref = firestore.collection('designations').doc();
      const batch = firestore.batch();
      batch.set(ref, payload);
      writeDesignationAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: ref.id,
        action: 'IMPORT_DESIGNATION',
        oldValue: null,
        newValue: payload,
        reason,
        now,
      });
      await batch.commit();
      successCount += 1;
    } catch (error) {
      errorCount += 1;
      errors.push(`Row ${index + 1}: ${(error as Error).message}`);
    }
  }

  return { successCount, errorCount, errors: errors.slice(0, 20) };
});

export const logAdminDesignationExport = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));
  const count = Number(request.data?.count || 0);
  const reason = optionalString(request.data?.reason, 'reason', 500) || 'Designation list export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeDesignationAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: 'export',
    action: 'EXPORT_DESIGNATION_LIST',
    oldValue: null,
    newValue: { count },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});
