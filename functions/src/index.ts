/**
 * Firebase Cloud Functions — scheduled effective date activation.
 *
 * Deploy: cd functions && npm install && npm run deploy
 * Requires EFFECTIVE_DATE_API_URL and EFFECTIVE_DATE_CRON_SECRET env config.
 *
 * Alternative: call POST /api/dms/effective-date/activate from Cloud Scheduler directly.
 */
import { setGlobalOptions } from 'firebase-functions/v2/options';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';

import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminFirestore, initializeAdmin } from './admin-app';

// Keep Gen2 footprint bounded so large function sets fit Cloud Run quotas.
setGlobalOptions({
  region: 'us-central1',
  maxInstances: 20,
});


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

function validatedPhone(value: unknown, field: string): string {
  const phone = optionalString(value, field, 40);
  if (phone && !/^\+?[\d\s\-()]{10,20}$/.test(phone)) {
    throw new HttpsError('invalid-argument', `${field} is invalid`);
  }
  return phone;
}

function validatedDate(value: unknown, field: string, mustBePast = false): string {
  const date = optionalString(value, field, 10);
  if (!date) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new HttpsError('invalid-argument', `${field} must be a valid date`);
  }
  if (mustBePast && date >= new Date().toISOString().slice(0, 10)) {
    throw new HttpsError('invalid-argument', `${field} must be in the past`);
  }
  return date;
}

const ADMIN_USER_ROLES = [
  'super_admin', 'admin', 'qa', 'qc', 'production', 'engineering', 'warehouse',
  'regulatory', 'head_qa', 'qa_manager', 'qa_executive',
  'qc_manager', 'qc_executive', 'production_manager', 'production_executive',
  'warehouse_manager', 'warehouse_executive', 'engineering_manager',
  'engineering_executive', 'regulatory_affairs', 'hr',
  'document_controller', 'department_head', 'employee', 'auditor', 'vendor', 'viewer',
  'maintenance', 'validation', 'it_administrator',
] as const;

const ADMIN_USER_STATUSES = ['Active', 'Inactive', 'Locked', 'Suspended', 'Pending Approval'] as const;

function validatePermissionMatrix(value: unknown): Record<string, Record<string, boolean>> | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'modulePermissions must be an object');
  }
  const modules = Object.entries(value as Record<string, unknown>);
  if (modules.length > 60) {
    throw new HttpsError('invalid-argument', 'Too many permission modules');
  }

  return modules.reduce<Record<string, Record<string, boolean>>>((matrix, [moduleName, actions]) => {
    if (!moduleName || moduleName.length > 100 || typeof actions !== 'object' || !actions || Array.isArray(actions)) {
      throw new HttpsError('invalid-argument', 'Invalid permission module');
    }
    const actionEntries = Object.entries(actions as Record<string, unknown>);
    if (actionEntries.length > 40 || actionEntries.some(([name, allowed]) =>
      !name || name.length > 80 || typeof allowed !== 'boolean')) {
      throw new HttpsError('invalid-argument', 'Invalid permission action');
    }
    matrix[moduleName] = actionEntries.reduce<Record<string, boolean>>((result, [name, allowed]) => {
      result[name] = allowed as boolean;
      return result;
    }, {});
    return matrix;
  }, {});
}

async function validateUserMasterAssignments(
  firestore: Firestore,
  input: Record<string, unknown>,
  targetUserId?: string,
) {
  const department = optionalString(input.department, 'department', 160);
  if (department) {
    const departments = await firestore.collection('departments')
      .where('departmentName', '==', department)
      .limit(10)
      .get();
    const hasActiveDepartment = departments.docs.some((document) =>
      document.data().isDeleted !== true
      && String(document.data().status || 'Active').toLowerCase() === 'active');
    if (!hasActiveDepartment) {
      throw new HttpsError('failed-precondition', 'Department is missing or inactive');
    }
  }

  const designation = optionalString(input.designation, 'designation', 160);
  if (designation) {
    let designationQuery = firestore.collection('designations')
      .where('designationName', '==', designation);
    if (department) {
      designationQuery = designationQuery.where('department', '==', department);
    }
    const designations = await designationQuery.limit(10).get();
    const hasActiveDesignation = designations.docs.some((document) => {
      const record = document.data();
      return record.isDeleted !== true
        && String(record.status || 'Active').toLowerCase() === 'active'
        && (!department || !record.department || record.department === department);
    });
    if (!hasActiveDesignation) {
      throw new HttpsError('failed-precondition', 'Designation is missing, inactive, or outside the selected department');
    }
  }

  const siteId = optionalString(input.siteId, 'siteId', 128);
  if (siteId) {
    const site = await firestore.collection('company_sites').doc(siteId).get();
    const siteData = site.data();
    if (!site.exists || site.data()?.isDeleted === true
      || String(site.data()?.status || 'Active').toLowerCase() !== 'active') {
      throw new HttpsError('failed-precondition', 'Site is missing or inactive');
    }
    const siteName = optionalString(input.siteName, 'siteName', 200);
    const businessUnit = optionalString(input.businessUnit, 'businessUnit', 160);
    if (siteName && siteData?.siteName && siteName !== siteData.siteName) {
      throw new HttpsError('invalid-argument', 'Site name does not match the selected site');
    }
    if (businessUnit && siteData?.companyName && businessUnit !== siteData.companyName) {
      throw new HttpsError('invalid-argument', 'Business unit does not match the selected site');
    }
  }

  const managerId = optionalString(input.managerId, 'managerId', 128);
  if (managerId) {
    if (managerId === targetUserId) {
      throw new HttpsError('invalid-argument', 'A user cannot report to themselves');
    }
    const manager = await firestore.collection('users').doc(managerId).get();
    const managerData = manager.data();
    if (!manager.exists || managerData?.isDeleted === true
      || String(managerData?.userStatus || managerData?.status || '').toLowerCase() !== 'active') {
      throw new HttpsError('failed-precondition', 'Reporting manager is missing or inactive');
    }
    if (targetUserId) {
      let ancestorId = optionalString(managerData?.managerId, 'managerId', 128);
      const visited = new Set([managerId]);
      for (let depth = 0; ancestorId && depth < 25; depth += 1) {
        if (ancestorId === targetUserId) {
          throw new HttpsError('failed-precondition', 'Reporting manager assignment would create a hierarchy cycle');
        }
        if (visited.has(ancestorId)) {
          throw new HttpsError('failed-precondition', 'The selected reporting hierarchy already contains a cycle');
        }
        visited.add(ancestorId);
        const ancestor = await firestore.collection('users').doc(ancestorId).get();
        if (!ancestor.exists) break;
        ancestorId = optionalString(ancestor.data()?.managerId, 'managerId', 128);
      }
      if (ancestorId) {
        throw new HttpsError('failed-precondition', 'Reporting hierarchy exceeds the supported depth');
      }
    }
  }
}

function userNotification(
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
    moduleName: 'User Management',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: '/dashboard/profile',
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

/**
 * Creates an authentication account without replacing the administrator's browser session.
 * Authorization and privileged writes are enforced server-side.
 */
export const createAdminUser = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');

    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  if (!actorSnapshot.exists || actor?.is_active !== true || !['super_admin', 'admin'].includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }

  const input = request.data as Record<string, unknown>;
  const email = requiredString(input.email, 'email', 320).toLowerCase();
  const password = requiredString(input.temporaryPassword, 'temporaryPassword', 128);
  const employeeId = requiredString(input.employeeId, 'employeeId', 80);
  const fullName = requiredString(input.fullName, 'fullName');
  const department = requiredString(input.department, 'department');
  const role = requiredString(input.role, 'role', 80);
  const username = optionalString(input.username, 'username', 80).toLowerCase();
  const requestedStatus = ADMIN_USER_STATUSES.includes(input.userStatus as typeof ADMIN_USER_STATUSES[number])
    ? input.userStatus as typeof ADMIN_USER_STATUSES[number]
    : 'Active';
  const accountLocked = Boolean(input.accountLocked) || requestedStatus === 'Locked';
  const userStatus = accountLocked ? 'Locked' : requestedStatus;
  const modulePermissions = validatePermissionMatrix(input.modulePermissions);
  const presetId = optionalString(input.presetId, 'presetId', 100);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'A valid email is required');
  }
  if (!ADMIN_USER_ROLES.includes(role as typeof ADMIN_USER_ROLES[number])) {
    throw new HttpsError('invalid-argument', 'Unsupported role');
  }
  if (['super_admin', 'admin'].includes(role) && actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only a Super Admin can assign an administrative role');
  }
  if (modulePermissions && actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only a Super Admin can assign user-specific permissions');
  }
  if (!['', 'Female', 'Male', 'Non-binary', 'Prefer not to say'].includes(String(input.gender || ''))) {
    throw new HttpsError('invalid-argument', 'Invalid gender');
  }
  if (!['Permanent', 'Contract', 'Temporary', 'Consultant', 'Vendor', 'Intern']
    .includes(String(input.employmentType || 'Permanent'))) {
    throw new HttpsError('invalid-argument', 'Invalid employment type');
  }
  const profilePhoto = optionalString(input.profilePhoto, 'profilePhoto', 2048);
  if (profilePhoto && !/^https:\/\//i.test(profilePhoto)) {
    throw new HttpsError('invalid-argument', 'Profile picture URL must use HTTPS');
  }
  if (
    password.length < 12
    || !/[A-Z]/.test(password)
    || !/[a-z]/.test(password)
    || !/\d/.test(password)
    || !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Temporary password must be at least 12 characters and include upper, lower, number, and special characters',
    );
  }

  await validateUserMasterAssignments(firestore, input);

  const [duplicateEmployee, duplicateUsername] = await Promise.all([
    firestore.collection('users').where('employeeId', '==', employeeId).limit(1).get(),
    username
      ? firestore.collection('users').where('username', '==', username).limit(1).get()
      : Promise.resolve(null),
  ]);
  if (!duplicateEmployee.empty) {
    throw new HttpsError('already-exists', 'Employee ID already exists');
  }
  if (duplicateUsername && !duplicateUsername.empty) {
    throw new HttpsError('already-exists', 'Username already exists');
  }

  let createdUid: string | undefined;
  try {
    const authUser = await getAdminAuth().createUser({
      email,
      password,
      displayName: fullName,
      disabled: userStatus !== 'Active' || accountLocked,
      photoURL: profilePhoto || undefined,
    });
    createdUid = authUser.uid;
    await getAdminAuth().setCustomUserClaims(authUser.uid, {
      role,
      active: userStatus === 'Active' && !accountLocked,
    });

    const now = new Date().toISOString();
    const userRef = firestore.collection('users').doc();
    const profileRef = firestore.collection('profiles').doc(authUser.uid);
    const auditRef = firestore.collection('audit_logs').doc();
    const notificationRef = firestore.collection('notifications').doc();
    const userRecord = {
      employeeId,
      employeeCode: optionalString(input.employeeCode, 'employeeCode', 80),
      firstName: optionalString(input.firstName, 'firstName', 100),
      middleName: optionalString(input.middleName, 'middleName', 100),
      lastName: optionalString(input.lastName, 'lastName', 100),
      fullName,
      email,
      mobileNumber: validatedPhone(input.mobileNumber, 'mobileNumber'),
      alternateMobile: validatedPhone(input.alternateMobile, 'alternateMobile'),
      username,
      profilePhoto,
      gender: optionalString(input.gender, 'gender', 40),
      dateOfBirth: validatedDate(input.dateOfBirth, 'dateOfBirth', true),
      department,
      designation: optionalString(input.designation, 'designation', 160),
      role,
      reportingManager: optionalString(input.reportingManager, 'reportingManager'),
      managerId: optionalString(input.managerId, 'managerId', 128),
      businessUnit: optionalString(input.businessUnit, 'businessUnit', 160),
      siteId: optionalString(input.siteId, 'siteId', 128),
      siteName: optionalString(input.siteName, 'siteName', 200),
      location: optionalString(input.location, 'location', 240),
      shift: optionalString(input.shift, 'shift', 80),
      employmentType: optionalString(input.employmentType, 'employmentType', 80) || 'Permanent',
      userStatus,
      statusBeforeLock: accountLocked ? requestedStatus === 'Locked' ? 'Inactive' : requestedStatus : null,
      status: userStatus === 'Active' ? 'Active' : 'Inactive',
      accountLocked,
      passwordResetRequired: true,
      twoFactorEnabled: Boolean(input.twoFactorEnabled),
      joiningDate: validatedDate(input.joiningDate, 'joiningDate'),
      remarks: optionalString(input.remarks, 'remarks', 2000),
      emailVerified: authUser.emailVerified,
      authUid: authUser.uid,
      userId: `USR-${employeeId}`,
      isDeleted: false,
      createdBy: request.auth.uid,
      updatedBy: request.auth.uid,
      createdAt: now,
      updatedAt: now,
    };

    const batch = firestore.batch();
    batch.create(userRef, userRecord);
    batch.create(profileRef, {
      id: authUser.uid,
      full_name: fullName,
      email,
      role,
      department,
      employee_id: employeeId,
      phone: userRecord.mobileNumber,
      avatar_url: userRecord.profilePhoto,
      is_active: userRecord.userStatus === 'Active' && !userRecord.accountLocked,
      access_status: userRecord.accountLocked ? 'locked'
        : userRecord.userStatus === 'Active' ? 'approved' : 'disabled',
      designation: userRecord.designation,
      manager_id: userRecord.managerId,
      site_id: userRecord.siteId,
      business_unit: userRecord.businessUnit,
      last_login: null,
      created_at: now,
      updated_at: now,
    });
    batch.create(auditRef, {
      userId: request.auth.uid,
      userName: String(actor?.full_name || actor?.email || 'Administrator'),
      module: 'User Management',
      recordId: userRef.id,
      action: 'CREATE_USER',
      oldValue: '',
      newValue: JSON.stringify({ employeeId, email, role, department }),
      reason: 'Administrator-created user',
      ipAddress: request.rawRequest.ip || 'server',
      device: request.rawRequest.get('user-agent') || 'unknown',
      status: 'Success',
      dateTime: now,
    });
    batch.create(notificationRef, userNotification(
      authUser.uid,
      userRef.id,
      'USER_CREATED',
      'Your SkyMap account was created',
      'An administrator created your account. Complete the required password reset before use.',
      now,
    ));
    if (modulePermissions || presetId) {
      const permissionRef = firestore.collection('user_permissions').doc(authUser.uid);
      batch.set(permissionRef, {
        userId: authUser.uid,
        roleId: role,
        modulePermissions: modulePermissions || {},
        customPermissions: modulePermissions || {},
        presetId,
        isDeleted: false,
        createdAt: now,
        createdBy: request.auth.uid,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
    }
    await batch.commit();

    return { id: userRef.id, ...userRecord };
  } catch (error) {
    if (createdUid) {
      await getAdminAuth().deleteUser(createdUid).catch((rollbackError) => {
        logger.error('Failed to roll back partially created user', { createdUid, rollbackError });
      });
    }
    if (error instanceof HttpsError) throw error;
    const code = (error as { code?: string }).code;
    if (code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Email already exists');
    }
    logger.error('createAdminUser failed', error);
    throw new HttpsError('internal', 'Unable to create user');
  }
});

export const updateAdminUser = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  
  const firestore = getAdminFirestore();
  const actorSnap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnap.data();
  if (!actorSnap.exists || actor?.is_active !== true || !['super_admin', 'admin'].includes(actor?.role)) {
    throw new HttpsError('permission-denied', 'Administrator access required');
  }

  const userId = requiredString(request.data?.userId, 'userId', 128);
  const requestedUpdates = request.data?.updates;
  if (!requestedUpdates || typeof requestedUpdates !== 'object' || Array.isArray(requestedUpdates)) {
    throw new HttpsError('invalid-argument', 'updates must be an object');
  }

  const userRef = firestore.collection('users').doc(userId);
  const targetSnap = await userRef.get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'User not found');
  const target = targetSnap.data() || {};
  if (actor?.role !== 'super_admin' && ['super_admin', 'admin'].includes(target.role)) {
    throw new HttpsError('permission-denied', 'Only a Super Admin can modify an administrative account');
  }

  const allowedFields = [
    'employeeId', 'employeeCode', 'firstName', 'middleName', 'lastName',
    'fullName', 'email', 'mobileNumber', 'alternateMobile', 'username',
    'profilePhoto', 'gender', 'dateOfBirth', 'department', 'designation', 'role',
    'reportingManager', 'managerId', 'businessUnit', 'siteId', 'siteName',
    'location', 'shift', 'employmentType', 'joiningDate', 'remarks',
    'userStatus', 'status', 'statusBeforeLock', 'accountLocked', 'isDeleted',
    'passwordResetRequired', 'twoFactorEnabled',
  ];
  const updates = Object.entries(requestedUpdates as Record<string, unknown>)
    .reduce<Record<string, unknown>>((result, [key, value]) => {
      if (allowedFields.includes(key)) result[key] = value;
      return result;
    }, {});
  const hasPermissionPayload = Object.prototype.hasOwnProperty.call(request.data || {}, 'modulePermissions')
    || Object.prototype.hasOwnProperty.call(request.data || {}, 'presetId');
  if (Object.keys(updates).length === 0 && !hasPermissionPayload) {
    throw new HttpsError('invalid-argument', 'No supported updates supplied');
  }
  const reason = requiredString(request.data?.reason, 'reason', 1000);
  if (reason.length < 8) {
    throw new HttpsError('invalid-argument', 'A meaningful change reason is required');
  }
  const modulePermissions = validatePermissionMatrix(request.data?.modulePermissions);
  const presetId = optionalString(request.data?.presetId, 'presetId', 100);
  if ((modulePermissions || presetId) && actor?.role !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only a Super Admin can change user-specific permissions');
  }

  if (typeof updates.role === 'string') {
    const nextRole = requiredString(updates.role, 'role', 80);
    updates.role = nextRole;
    if (!ADMIN_USER_ROLES.includes(nextRole as typeof ADMIN_USER_ROLES[number])) {
      throw new HttpsError('invalid-argument', 'Invalid role');
    }
    if (['super_admin', 'admin'].includes(nextRole) && actor?.role !== 'super_admin') {
      throw new HttpsError('permission-denied', 'Only a Super Admin can assign an administrative role');
    }
  }
  if (typeof updates.email === 'string') {
    const normalizedEmail = requiredString(updates.email, 'email', 320).toLowerCase();
    updates.email = normalizedEmail;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new HttpsError('invalid-argument', 'A valid email is required');
    }
  }
  if (typeof updates.employeeId === 'string') {
    const employeeId = requiredString(updates.employeeId, 'employeeId', 80);
    const duplicate = await firestore.collection('users')
      .where('employeeId', '==', employeeId)
      .limit(2)
      .get();
    if (duplicate.docs.some((doc) => doc.id !== userId)) {
      throw new HttpsError('already-exists', 'Employee ID already exists');
    }
    updates.employeeId = employeeId;
  }
  if (typeof updates.username === 'string') {
    const username = optionalString(updates.username, 'username', 80).toLowerCase();
    if (username && !/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw new HttpsError('invalid-argument', 'Invalid username');
    }
    if (username) {
      const duplicate = await firestore.collection('users')
        .where('username', '==', username)
        .limit(2)
        .get();
      if (duplicate.docs.some((document) => document.id !== userId)) {
        throw new HttpsError('already-exists', 'Username already exists');
      }
    }
    updates.username = username;
  }
  if (
    typeof updates.userStatus === 'string'
    && !ADMIN_USER_STATUSES.includes(updates.userStatus as typeof ADMIN_USER_STATUSES[number])
  ) {
    throw new HttpsError('invalid-argument', 'Invalid user status');
  }

  const stringLimits: Record<string, number> = {
    employeeCode: 80, firstName: 100, middleName: 100, lastName: 100,
    fullName: 200, mobileNumber: 40, alternateMobile: 40, profilePhoto: 2048,
    gender: 40, dateOfBirth: 10, department: 160, designation: 160,
    reportingManager: 200, managerId: 128, businessUnit: 160, siteId: 128,
    siteName: 200, location: 240, shift: 80, employmentType: 80,
    joiningDate: 10, remarks: 2000,
  };
  Object.entries(stringLimits).forEach(([field, maxLength]) => {
    if (Object.prototype.hasOwnProperty.call(updates, field)) {
      updates[field] = optionalString(updates[field], field, maxLength);
    }
  });
  if (Object.prototype.hasOwnProperty.call(updates, 'fullName')) {
    updates.fullName = requiredString(updates.fullName, 'fullName', 200);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'department')) {
    updates.department = requiredString(updates.department, 'department', 160);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'mobileNumber')) {
    updates.mobileNumber = validatedPhone(updates.mobileNumber, 'mobileNumber');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'alternateMobile')) {
    updates.alternateMobile = validatedPhone(updates.alternateMobile, 'alternateMobile');
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'dateOfBirth')) {
    updates.dateOfBirth = validatedDate(updates.dateOfBirth, 'dateOfBirth', true);
  }
  if (Object.prototype.hasOwnProperty.call(updates, 'joiningDate')) {
    updates.joiningDate = validatedDate(updates.joiningDate, 'joiningDate');
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, 'gender')
    && !['', 'Female', 'Male', 'Non-binary', 'Prefer not to say'].includes(String(updates.gender))
  ) {
    throw new HttpsError('invalid-argument', 'Invalid gender');
  }
  if (
    Object.prototype.hasOwnProperty.call(updates, 'employmentType')
    && !['Permanent', 'Contract', 'Temporary', 'Consultant', 'Vendor', 'Intern']
      .includes(String(updates.employmentType))
  ) {
    throw new HttpsError('invalid-argument', 'Invalid employment type');
  }
  if (
    typeof updates.profilePhoto === 'string'
    && updates.profilePhoto
    && !/^https:\/\//i.test(updates.profilePhoto)
  ) {
    throw new HttpsError('invalid-argument', 'Profile picture URL must use HTTPS');
  }

  if (['department', 'designation', 'siteId', 'managerId'].some((field) =>
    Object.prototype.hasOwnProperty.call(updates, field))) {
    await validateUserMasterAssignments(firestore, { ...target, ...updates }, userId);
  }

  const authUid = String(target.authUid || userId);
  if (
    authUid === request.auth.uid
    && ['role', 'userStatus', 'status', 'accountLocked', 'isDeleted']
      .some((field) => Object.prototype.hasOwnProperty.call(updates, field))
  ) {
    throw new HttpsError('failed-precondition', 'You cannot change your own access or account status');
  }
  const authUserBefore = await getAdminAuth().getUser(authUid);
  const previousDisabled = authUserBefore.disabled;
  const requestedNextStatus = String(updates.userStatus ?? target.userStatus ?? target.status ?? 'Inactive');
  const nextLocked = Boolean(updates.accountLocked ?? target.accountLocked) || requestedNextStatus === 'Locked';
  const nextStatus = nextLocked ? 'Locked' : requestedNextStatus;
  if (nextStatus !== target.userStatus) updates.userStatus = nextStatus;
  if (nextLocked !== Boolean(target.accountLocked)) updates.accountLocked = nextLocked;
  updates.status = nextStatus === 'Active' ? 'Active' : 'Inactive';
  const nextDeleted = Boolean(updates.isDeleted ?? target.isDeleted);
  const nextDisabled = nextStatus !== 'Active' || nextLocked || nextDeleted;
  const previousEmail = authUserBefore.email || String(target.email || '');
  const nextEmail = typeof updates.email === 'string' ? updates.email.trim().toLowerCase() : previousEmail;

  try {
    await getAdminAuth().updateUser(authUid, {
      email: nextEmail || undefined,
      disabled: nextDisabled,
      displayName: typeof updates.fullName === 'string' ? updates.fullName.trim() : undefined,
      photoURL: typeof updates.profilePhoto === 'string' ? updates.profilePhoto || null : undefined,
    });
    const accessClaimsChanged = typeof updates.role === 'string' || nextDisabled !== previousDisabled;
    if (accessClaimsChanged) {
      await getAdminAuth().setCustomUserClaims(authUid, {
        ...authUserBefore.customClaims,
        role: updates.role ?? target.role ?? 'viewer',
        active: !nextDisabled,
      });
    }

    const now = new Date().toISOString();
    const profileRef = firestore.collection('profiles').doc(authUid);
    const auditRef = firestore.collection('audit_trail').doc();
    const notificationRef = firestore.collection('notifications').doc();
    const batch = firestore.batch();
    batch.update(userRef, { ...updates, email: nextEmail, updatedAt: now, updatedBy: request.auth.uid });
    batch.set(profileRef, {
      full_name: updates.fullName ?? target.fullName ?? '',
      email: nextEmail,
      role: updates.role ?? target.role ?? 'viewer',
      department: updates.department ?? target.department ?? '',
      employee_id: updates.employeeId ?? target.employeeId ?? '',
      phone: updates.mobileNumber ?? target.mobileNumber ?? '',
      avatar_url: updates.profilePhoto ?? target.profilePhoto ?? '',
      is_active: !nextDisabled,
      access_status: nextDeleted ? 'retired' : nextLocked ? 'locked' : nextDisabled ? 'disabled' : 'approved',
      designation: updates.designation ?? target.designation ?? '',
      manager_id: updates.managerId ?? target.managerId ?? '',
      site_id: updates.siteId ?? target.siteId ?? '',
      business_unit: updates.businessUnit ?? target.businessUnit ?? '',
      updated_at: now,
    }, { merge: true });

    const changedFields = Object.keys(updates);
    let auditAction = 'UPDATE_USER';
    if (modulePermissions || presetId) auditAction = 'PERMISSION_CHANGE';
    if (updates.department !== undefined && updates.department !== target.department) auditAction = 'DEPARTMENT_CHANGE';
    if (updates.role !== undefined && updates.role !== target.role) auditAction = 'ROLE_CHANGE';
    if (updates.userStatus === 'Active' && target.userStatus !== 'Active') auditAction = 'ACTIVATE_USER';
    if (updates.userStatus === 'Inactive' && target.userStatus === 'Active') auditAction = 'DEACTIVATE_USER';
    if (updates.accountLocked === true && target.accountLocked !== true) auditAction = 'LOCK_USER';
    if (updates.accountLocked === false && target.accountLocked === true) auditAction = 'UNLOCK_USER';
    if (updates.isDeleted === true && target.isDeleted !== true) auditAction = 'RETIRE_USER';
    if (updates.isDeleted === false && target.isDeleted === true) auditAction = 'RESTORE_USER';
    if (updates.passwordResetRequired === true && target.passwordResetRequired !== true) {
      auditAction = 'PASSWORD_RESET';
    }
    if (request.data?.action === 'PASSWORD_RESET' && updates.passwordResetRequired === true) {
      auditAction = 'PASSWORD_RESET';
    }

    batch.create(auditRef, {
      userId: request.auth.uid,
      userName: String(actor?.full_name || actor?.email || 'Administrator'),
      collectionName: 'users',
      documentId: userId,
      moduleName: 'User Management',
      module: 'User Management',
      recordId: userId,
      action: auditAction,
      oldValue: JSON.stringify(target),
      newValue: JSON.stringify({ ...target, ...updates, email: nextEmail }),
      changedFields,
      reason,
      ipAddress: request.rawRequest.ip || 'server',
      device: request.rawRequest.get('user-agent') || 'unknown',
      status: 'Success',
      dateTime: now,
      timestamp: now,
    });

    const notificationTitles: Record<string, string> = {
      ROLE_CHANGE: 'Your role was changed',
      PERMISSION_CHANGE: 'Your permissions were changed',
      DEPARTMENT_CHANGE: 'Your department was changed',
      ACTIVATE_USER: 'Your account was activated',
      DEACTIVATE_USER: 'Your account was deactivated',
      LOCK_USER: 'Your account was locked',
      UNLOCK_USER: 'Your account was unlocked',
      RETIRE_USER: 'Your account was retired',
      RESTORE_USER: 'Your account record was restored',
      PASSWORD_RESET: 'Password reset requested',
      UPDATE_USER: 'Your user profile was updated',
    };
    batch.create(notificationRef, userNotification(
      authUid,
      userId,
      auditAction,
      notificationTitles[auditAction] || 'Your account was updated',
      `An administrator updated your account. Reason: ${reason}`,
      now,
    ));

    if (hasPermissionPayload) {
      const permissionQuery = await firestore.collection('user_permissions')
        .where('userId', '==', authUid)
        .limit(1)
        .get();
      const permissionRef = permissionQuery.empty
        ? firestore.collection('user_permissions').doc(authUid)
        : permissionQuery.docs[0].ref;
      batch.set(permissionRef, {
        userId: authUid,
        roleId: updates.role ?? target.role ?? 'viewer',
        modulePermissions: modulePermissions || {},
        customPermissions: modulePermissions || {},
        presetId,
        isDeleted: false,
        updatedAt: now,
        updatedBy: request.auth.uid,
        ...(permissionQuery.empty ? { createdAt: now, createdBy: request.auth.uid } : {}),
      }, { merge: true });
    }
    await batch.commit();
    if (accessClaimsChanged) {
      await getAdminAuth().revokeRefreshTokens(authUid)
        .catch((revokeError) => logger.error('Failed to revoke changed user sessions', revokeError));
    }
    return { id: userId, ...target, ...updates, email: nextEmail, updatedAt: now };
  } catch (error) {
    await getAdminAuth().updateUser(authUid, {
      email: previousEmail || undefined,
      disabled: previousDisabled,
      displayName: authUserBefore.displayName || undefined,
      photoURL: authUserBefore.photoURL || null,
    }).then(async () => {
      if (typeof updates.role === 'string' || nextDisabled !== previousDisabled) {
        await getAdminAuth().setCustomUserClaims(authUid, authUserBefore.customClaims || {});
      }
    }).catch((rollbackError) => logger.error('Failed to roll back Auth user update', rollbackError));
    if (error instanceof HttpsError) throw error;
    const code = (error as { code?: string }).code;
    if (code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Email already exists');
    }
    if (code === 'auth/user-not-found') {
      throw new HttpsError('not-found', 'Authentication account not found');
    }
    logger.error('updateAdminUser failed', error);
    throw new HttpsError('internal', 'Unable to update user');
  }
});

export const updateOwnUserProfile = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  
  const firestore = getAdminFirestore();
  const profileRef = firestore.collection('profiles').doc(request.auth.uid);
  const profileSnapshot = await profileRef.get();
  const profile = profileSnapshot.data();
  if (!profileSnapshot.exists || profile?.is_active !== true || profile?.access_status === 'pending') {
    throw new HttpsError('permission-denied', 'An active account is required');
  }

  const fullName = requiredString(request.data?.fullName, 'fullName', 200);
  const phone = optionalString(request.data?.phone, 'phone', 40);
  const usersByAuthUid = await firestore.collection('users')
    .where('authUid', '==', request.auth.uid)
    .limit(1)
    .get();
  const fallbackUserRef = firestore.collection('users').doc(request.auth.uid);
  const fallbackUser = usersByAuthUid.empty ? await fallbackUserRef.get() : null;
  const userRef = !usersByAuthUid.empty
    ? usersByAuthUid.docs[0].ref
    : fallbackUser?.exists ? fallbackUserRef : null;

  const authBefore = await getAdminAuth().getUser(request.auth.uid);
  const now = new Date().toISOString();
  try {
    await getAdminAuth().updateUser(request.auth.uid, { displayName: fullName });
    const batch = firestore.batch();
    batch.update(profileRef, { full_name: fullName, phone, updated_at: now });
    if (userRef) {
      batch.update(userRef, {
        fullName,
        mobileNumber: phone,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
    }
    batch.create(firestore.collection('audit_trail').doc(), {
      collectionName: 'profiles',
      documentId: request.auth.uid,
      action: 'PROFILE_UPDATE',
      oldValue: { fullName: profile.full_name || '', phone: profile.phone || '' },
      newValue: { fullName, phone },
      userId: request.auth.uid,
      userName: fullName,
      moduleName: 'Profile',
      source: 'cloud-function',
      reason: 'User updated own contact profile',
      ipAddress: request.rawRequest.ip || 'server',
      device: request.rawRequest.get('user-agent') || 'unknown',
      timestamp: now,
    });
    await batch.commit();
    return { fullName, phone, updatedAt: now };
  } catch (error) {
    await getAdminAuth().updateUser(request.auth.uid, {
      displayName: authBefore.displayName || undefined,
    }).catch((rollbackError) => logger.error('Failed to roll back profile display name', rollbackError));
    if (error instanceof HttpsError) throw error;
    logger.error('updateOwnUserProfile failed', error);
    throw new HttpsError('internal', 'Unable to update profile');
  }
});

export const recordOwnPasswordChange = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const authenticatedAt = Number(request.auth.token.auth_time || 0) * 1000;
  if (!authenticatedAt || Date.now() - authenticatedAt > 5 * 60_000) {
    throw new HttpsError('failed-precondition', 'Recent authentication is required');
  }
  
  const firestore = getAdminFirestore();
  const profile = await firestore.collection('profiles').doc(request.auth.uid).get();
  if (!profile.exists || profile.data()?.is_active !== true) {
    throw new HttpsError('permission-denied', 'An active account is required');
  }
  const usersByAuthUid = await firestore.collection('users')
    .where('authUid', '==', request.auth.uid)
    .limit(1)
    .get();
  const fallbackRef = firestore.collection('users').doc(request.auth.uid);
  const fallback = usersByAuthUid.empty ? await fallbackRef.get() : null;
  const userRef = !usersByAuthUid.empty
    ? usersByAuthUid.docs[0].ref
    : fallback?.exists ? fallbackRef : null;
  const now = new Date().toISOString();
  const batch = firestore.batch();
  if (userRef) {
    batch.update(userRef, {
      passwordResetRequired: false,
      passwordChangedAt: now,
      updatedAt: now,
      updatedBy: request.auth.uid,
    });
  }
  batch.create(firestore.collection('audit_trail').doc(), {
    collectionName: 'users',
    documentId: userRef?.id || request.auth.uid,
    action: 'PASSWORD_CHANGE',
    oldValue: null,
    newValue: { passwordChanged: true },
    userId: request.auth.uid,
    userName: String(profile.data()?.full_name || profile.data()?.email || 'User'),
    moduleName: 'Auth',
    source: 'cloud-function',
    reason: 'User changed own password after reauthentication',
    ipAddress: request.rawRequest.ip || 'server',
    device: request.rawRequest.get('user-agent') || 'unknown',
    timestamp: now,
  });
  await batch.commit();
  return { success: true };
});

export const syncOwnEmailVerification = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();

  const authUser = await getAdminAuth().getUser(request.auth.uid);
  if (!authUser.emailVerified) return { verified: false };
  const firestore = getAdminFirestore();
  const profileRef = firestore.collection('profiles').doc(request.auth.uid);
  const profile = await profileRef.get();
  if (!profile.exists || profile.data()?.is_active !== true) {
    throw new HttpsError('permission-denied', 'An active account is required');
  }
  if (profile.data()?.email_verified === true) return { verified: true };

  const usersByAuthUid = await firestore.collection('users')
    .where('authUid', '==', request.auth.uid)
    .limit(1)
    .get();
  const fallbackRef = firestore.collection('users').doc(request.auth.uid);
  const fallback = usersByAuthUid.empty ? await fallbackRef.get() : null;
  const userRef = !usersByAuthUid.empty
    ? usersByAuthUid.docs[0].ref
    : fallback?.exists ? fallbackRef : null;
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(profileRef, { email_verified: true, updated_at: now });
  if (userRef) {
    batch.update(userRef, {
      emailVerified: true,
      updatedAt: now,
      updatedBy: request.auth.uid,
    });
  }
  batch.create(firestore.collection('audit_trail').doc(), {
    collectionName: 'users',
    documentId: userRef?.id || request.auth.uid,
    action: 'EMAIL_VERIFIED',
    oldValue: { emailVerified: false },
    newValue: { emailVerified: true },
    userId: request.auth.uid,
    userName: String(profile.data()?.full_name || profile.data()?.email || 'User'),
    moduleName: 'Auth',
    source: 'cloud-function',
    reason: 'Firebase Authentication email verification confirmed',
    timestamp: now,
  });
  await batch.commit();
  return { verified: true };
});

export const auditPendingUserRegistration = onDocumentCreated('profiles/{userId}', async (event) => {
  initializeAdmin();
  const profile = event.data?.data();
  if (!profile || profile.is_active !== false || profile.access_status !== 'pending') return;

  await getAdminFirestore().collection('audit_trail').add({
    collectionName: 'profiles',
    documentId: event.params.userId,
    action: 'REGISTER',
    oldValue: null,
    newValue: {
      email: profile.email || '',
      requestedRole: profile.requested_role || 'viewer',
      accessStatus: 'pending',
    },
    userId: event.params.userId,
    userName: profile.full_name || profile.email || 'Pending User',
    moduleName: 'Auth',
    source: 'cloud-function',
    timestamp: new Date().toISOString(),
  });
});

const cronSecret = defineSecret('EFFECTIVE_DATE_CRON_SECRET');
const apiUrl = defineSecret('EFFECTIVE_DATE_API_URL');

export const scheduledEffectiveDateActivation = onSchedule(
  {
    schedule: 'every day 00:05',
    timeZone: 'UTC',
    secrets: [cronSecret, apiUrl],
  },
  async () => {
    const url = apiUrl.value() || process.env.EFFECTIVE_DATE_API_URL;
    const secret = cronSecret.value() || process.env.EFFECTIVE_DATE_CRON_SECRET;
    if (!url) {
      logger.error('EFFECTIVE_DATE_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Effective date activation completed', body);
  },
);

const prmCronSecret = defineSecret('PERIODIC_REVIEW_CRON_SECRET');
const prmApiUrl = defineSecret('PERIODIC_REVIEW_API_URL');

export const scheduledPeriodicReviewJobs = onSchedule(
  {
    schedule: 'every day 06:00',
    timeZone: 'UTC',
    secrets: [prmCronSecret, prmApiUrl],
  },
  async () => {
    const url = prmApiUrl.value() || process.env.PERIODIC_REVIEW_API_URL;
    const secret = prmCronSecret.value() || process.env.PERIODIC_REVIEW_CRON_SECRET;
    if (!url) {
      logger.error('PERIODIC_REVIEW_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Periodic review scheduler completed', body);
  },
);

const ciaCronSecret = defineSecret('CHANGE_IMPACT_CRON_SECRET');
const ciaApiUrl = defineSecret('CHANGE_IMPACT_API_URL');

export const scheduledChangeImpactJobs = onSchedule(
  {
    schedule: 'every day 08:00',
    timeZone: 'UTC',
    secrets: [ciaCronSecret, ciaApiUrl],
  },
  async () => {
    const url = ciaApiUrl.value() || process.env.CHANGE_IMPACT_API_URL;
    const secret = ciaCronSecret.value() || process.env.CHANGE_IMPACT_CRON_SECRET;
    if (!url) {
      logger.error('CHANGE_IMPACT_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Change impact scheduler completed', body);
  },
);

const archiveCronSecret = defineSecret('ARCHIVE_CRON_SECRET');
const archiveApiUrl = defineSecret('ARCHIVE_API_URL');

export const scheduledArchiveJobs = onSchedule(
  {
    schedule: 'every day 09:00',
    timeZone: 'UTC',
    secrets: [archiveCronSecret, archiveApiUrl],
  },
  async () => {
    const url = archiveApiUrl.value() || process.env.ARCHIVE_API_URL;
    const secret = archiveCronSecret.value() || process.env.ARCHIVE_CRON_SECRET;
    if (!url) {
      logger.error('ARCHIVE_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Archive scheduler completed', body);
  },
);

const retentionCronSecret = defineSecret('RETENTION_CRON_SECRET');
const retentionApiUrl = defineSecret('RETENTION_API_URL');

export const scheduledRetentionJobs = onSchedule(
  {
    schedule: 'every day 10:00',
    timeZone: 'UTC',
    secrets: [retentionCronSecret, retentionApiUrl],
  },
  async () => {
    const url = retentionApiUrl.value() || process.env.RETENTION_API_URL;
    const secret = retentionCronSecret.value() || process.env.RETENTION_CRON_SECRET;
    if (!url) {
      logger.error('RETENTION_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Retention scheduler completed', body);
  },
);

const externalDocCronSecret = defineSecret('EXTERNAL_DOC_CRON_SECRET');
const externalDocApiUrl = defineSecret('EXTERNAL_DOC_API_URL');

export const scheduledExternalDocumentJobs = onSchedule(
  {
    schedule: 'every day 11:00',
    timeZone: 'UTC',
    secrets: [externalDocCronSecret, externalDocApiUrl],
  },
  async () => {
    const url = externalDocApiUrl.value() || process.env.EXTERNAL_DOC_API_URL;
    const secret = externalDocCronSecret.value() || process.env.EXTERNAL_DOC_CRON_SECRET;
    if (!url) {
      logger.error('EXTERNAL_DOC_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('External document scheduler completed', body);
  },
);

const printControlCronSecret = defineSecret('PRINT_CONTROL_CRON_SECRET');
const printControlApiUrl = defineSecret('PRINT_CONTROL_API_URL');

export const scheduledPrintControlJobs = onSchedule(
  {
    schedule: 'every day 12:00',
    timeZone: 'UTC',
    secrets: [printControlCronSecret, printControlApiUrl],
  },
  async () => {
    const url = printControlApiUrl.value() || process.env.PRINT_CONTROL_API_URL;
    const secret = printControlCronSecret.value() || process.env.PRINT_CONTROL_CRON_SECRET;
    if (!url) {
      logger.error('PRINT_CONTROL_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Print control scheduler completed', body);
  },
);

const watermarkCronSecret = defineSecret('WATERMARK_CRON_SECRET');
const watermarkApiUrl = defineSecret('WATERMARK_API_URL');

export const scheduledWatermarkJobs = onSchedule(
  {
    schedule: 'every day 13:00',
    timeZone: 'UTC',
    secrets: [watermarkCronSecret, watermarkApiUrl],
  },
  async () => {
    const url = watermarkApiUrl.value() || process.env.WATERMARK_API_URL;
    const secret = watermarkCronSecret.value() || process.env.WATERMARK_CRON_SECRET;
    if (!url) {
      logger.error('WATERMARK_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Watermark scheduler completed', body);
  },
);

const documentAuditCronSecret = defineSecret('DOCUMENT_AUDIT_CRON_SECRET');
const documentAuditApiUrl = defineSecret('DOCUMENT_AUDIT_API_URL');

export const scheduledDocumentAuditJobs = onSchedule(
  {
    schedule: 'every day 14:00',
    timeZone: 'UTC',
    secrets: [documentAuditCronSecret, documentAuditApiUrl],
  },
  async () => {
    const url = documentAuditApiUrl.value() || process.env.DOCUMENT_AUDIT_API_URL;
    const secret = documentAuditCronSecret.value() || process.env.DOCUMENT_AUDIT_CRON_SECRET;
    if (!url) {
      logger.error('DOCUMENT_AUDIT_API_URL not configured');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.json();
    logger.info('Document audit scheduler completed', body);
  },
);

const ROLE_MATRIX_MODULES = [
  'Dashboard', 'Admin', 'CPV', 'PQR', 'Deviation', 'OOS', 'CAPA', 'Change Control',
  'Risk Management', 'Stability', 'Complaint', 'Recall', 'DMS', 'Audit',
  'Vendor', 'Supplier', 'Validation', 'CSV', 'Equipment', 'Calibration', 'Maintenance',
  'Monitoring', 'Warehouse', 'Inventory', 'eBMR', 'Reports', 'Analytics', 'Settings',
  'Notifications', 'Audit Trail', 'Electronic Signature',
] as const;

const ROLE_MATRIX_ACTIONS = [
  'View', 'Create', 'Edit', 'Delete', 'Review', 'Approve', 'Reject', 'Assign',
  'Export', 'Import', 'Print', 'Archive', 'Restore', 'Close',
  'Electronic Signature', 'Admin', 'Read Only',
] as const;

const SYSTEM_ROLE_IDS = new Set([
  'super_admin', 'admin', 'qa', 'qc', 'production', 'engineering', 'warehouse',
  'regulatory', 'auditor', 'department_head', 'hr',
  'document_controller', 'employee', 'vendor', 'viewer', 'maintenance',
  'validation', 'it_administrator', 'head_qa', 'qa_manager', 'qc_manager',
  'production_manager', 'warehouse_manager', 'engineering_manager', 'regulatory_affairs',
]);

const DATA_SCOPE_OPTIONS = [
  'Own Records', 'Department Records', 'Site Records', 'Business Unit Records', 'Organization Records',
] as const;

function assertActiveAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !['super_admin', 'admin'].includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }
}

function assertCanModifyTargetRole(actorRole: string, targetRoleId: string) {
  if (targetRoleId === 'super_admin' && actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only a Super Admin can modify the Super Admin role');
  }
  if (actorRole === 'admin' && ['super_admin', 'admin', 'it_administrator'].includes(targetRoleId)) {
    throw new HttpsError('permission-denied', 'Admin cannot modify privileged system administrator roles');
  }
}

function buildFullMatrix(roleId: string): Record<string, Record<string, boolean>> {
  const matrix: Record<string, Record<string, boolean>> = {};
  const isSuper = roleId === 'super_admin';
  for (const mod of ROLE_MATRIX_MODULES) {
    matrix[mod] = {};
    for (const action of ROLE_MATRIX_ACTIONS) {
      matrix[mod][action] = isSuper;
    }
  }
  return matrix;
}

function sanitizeRoleMatrix(
  roleId: string,
  value: unknown,
): Record<string, Record<string, boolean>> {
  if (roleId === 'super_admin') return buildFullMatrix('super_admin');
  const validated = validatePermissionMatrix(value);
  if (!validated) {
    throw new HttpsError('invalid-argument', 'Permission matrix is required');
  }
  const matrix: Record<string, Record<string, boolean>> = {};
  for (const mod of ROLE_MATRIX_MODULES) {
    matrix[mod] = {};
    for (const action of ROLE_MATRIX_ACTIONS) {
      matrix[mod][action] = Boolean(validated[mod]?.[action]);
    }
  }
  // Preserve unknown legacy module keys so existing grants are not silently dropped.
  for (const [mod, actions] of Object.entries(validated)) {
    if (!matrix[mod]) matrix[mod] = {};
    for (const [action, allowed] of Object.entries(actions)) {
      if (matrix[mod][action] === undefined) matrix[mod][action] = allowed;
    }
  }
  if (roleId !== 'super_admin') {
    if (!matrix.Admin) matrix.Admin = {};
    matrix.Admin.Admin = false;
    if (!['admin', 'it_administrator'].includes(roleId)) {
      matrix.Admin.Delete = false;
    }
  }
  return matrix;
}

function roleNotification(
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
    moduleName: 'Role Management',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/roles/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeRoleAudit(
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
  const auditRef = firestore.collection('audit_logs').doc();
  batch.set(auditRef, {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'Role Management',
    recordId: input.recordId,
    action: input.action,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason,
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  const trailRef = firestore.collection('audit_trail').doc();
  batch.set(trailRef, {
    collectionName: 'roles',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Role Management',
    reason: input.reason,
    timestamp: input.now,
  });
}

async function findPermissionDoc(firestore: Firestore, roleId: string) {
  const snapshot = await firestore.collection('permissions')
    .where('roleId', '==', roleId)
    .limit(10)
    .get();
  return snapshot.docs.find((document) => document.data().isDeleted !== true) || null;
}

async function countAssignedUsers(firestore: Firestore, roleId: string) {
  const snapshot = await firestore.collection('users')
    .where('role', '==', roleId)
    .limit(500)
    .get();
  return snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
}

/**
 * Creates a role + permission matrix atomically with immutable audit + notification.
 */
export const createAdminRole = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const input = request.data as Record<string, unknown>;
  const roleId = requiredString(input.roleId, 'roleId', 64).toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(roleId)) {
    throw new HttpsError('invalid-argument', 'Role ID must be lowercase snake_case');
  }
  assertCanModifyTargetRole(actorRole, roleId);

  const roleName = requiredString(input.roleName, 'roleName', 120);
  const roleDescription = optionalString(input.roleDescription, 'roleDescription', 2000);
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const roleLevel = Number(input.roleLevel ?? 10);
  if (!Number.isFinite(roleLevel) || roleLevel < 1 || roleLevel > 100) {
    throw new HttpsError('invalid-argument', 'Role level must be between 1 and 100');
  }
  if (actorRole === 'admin' && roleLevel >= 90) {
    throw new HttpsError('permission-denied', 'Admin cannot create administrator-level roles');
  }

  const status = String(input.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
  const departmentAccess = optionalString(input.departmentAccess, 'departmentAccess', 160);
  const siteAccess = optionalString(input.siteAccess, 'siteAccess', 160);
  const businessUnitAccess = optionalString(input.businessUnitAccess, 'businessUnitAccess', 160);
  const dataScope = DATA_SCOPE_OPTIONS.includes(input.dataScope as typeof DATA_SCOPE_OPTIONS[number])
    ? String(input.dataScope)
    : 'Organization Records';
  const fieldPolicies = Array.isArray(input.fieldPolicies) ? input.fieldPolicies.slice(0, 100) : [];
  const permissions = sanitizeRoleMatrix(roleId, input.permissions);
  if (actorRole === 'admin') {
    if (!permissions.Admin) permissions.Admin = {};
    permissions.Admin.Admin = false;
    permissions.Admin.Delete = false;
  }
  const isSystemRole = Boolean(input.isSystemRole) || SYSTEM_ROLE_IDS.has(roleId);

  const [dupId, dupName] = await Promise.all([
    firestore.collection('roles').where('roleId', '==', roleId).limit(5).get(),
    firestore.collection('roles').where('roleName', '==', roleName).limit(5).get(),
  ]);
  if (dupId.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Role ID already exists');
  }
  if (dupName.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Role name already exists');
  }

  const now = new Date().toISOString();
  const roleRef = firestore.collection('roles').doc();
  const permRef = firestore.collection('permissions').doc();
  const batch = firestore.batch();
  const rolePayload = {
    roleId,
    roleName,
    roleDescription,
    description: roleDescription,
    roleLevel,
    level: roleLevel,
    departmentAccess,
    siteAccess,
    businessUnitAccess,
    dataScope,
    fieldPolicies,
    status,
    isSystemRole,
    isDeleted: false,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  };
  batch.set(roleRef, rolePayload);
  batch.set(permRef, {
    roleId,
    roleName,
    permissions,
    status,
    isDeleted: false,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  });
  writeRoleAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: roleRef.id,
    action: 'CREATE_ROLE',
    oldValue: null,
    newValue: { role: rolePayload, permissions },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    roleNotification(
      request.auth.uid,
      roleRef.id,
      'ROLE_CREATED',
      'Role created',
      `Role "${roleName}" was created with an updated permission matrix.`,
      now,
    ),
  );
  await batch.commit();
  return { id: roleRef.id, ...rolePayload };
});

export const updateAdminRole = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const input = request.data as Record<string, unknown>;
  const roleDocId = requiredString(input.roleDocId, 'roleDocId', 128);
  const reason = requiredString(input.reason, 'reason', 500);
  const updates = (input.updates && typeof input.updates === 'object' && !Array.isArray(input.updates))
    ? input.updates as Record<string, unknown>
    : {};

  const roleRef = firestore.collection('roles').doc(roleDocId);
  const roleSnap = await roleRef.get();
  if (!roleSnap.exists || roleSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Role not found');
  }
  const existing = roleSnap.data() || {};
  const targetRoleId = String(existing.roleId || '');
  assertCanModifyTargetRole(actorRole, targetRoleId);

  const roleName = optionalString(updates.roleName, 'roleName', 120) || String(existing.roleName || '');
  if (roleName !== existing.roleName) {
    const dupName = await firestore.collection('roles').where('roleName', '==', roleName).limit(5).get();
    if (dupName.docs.some((document) => document.id !== roleDocId && document.data().isDeleted !== true)) {
      throw new HttpsError('already-exists', 'Role name already exists');
    }
  }

  const roleLevel = Number(updates.roleLevel ?? existing.roleLevel ?? existing.level ?? 10);
  if (!Number.isFinite(roleLevel) || roleLevel < 1 || roleLevel > 100) {
    throw new HttpsError('invalid-argument', 'Role level must be between 1 and 100');
  }
  if (actorRole === 'admin' && roleLevel >= 90) {
    throw new HttpsError('permission-denied', 'Admin cannot raise roles to administrator privilege level');
  }

  const status = String(updates.status || existing.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
  if (targetRoleId === 'super_admin' && status !== 'Active') {
    throw new HttpsError('failed-precondition', 'Super Admin role cannot be deactivated');
  }

  const permissions = sanitizeRoleMatrix(targetRoleId, input.permissions);
  if (actorRole === 'admin') {
    if (!permissions.Admin) permissions.Admin = {};
    permissions.Admin.Admin = false;
    permissions.Admin.Delete = false;
  }
  const now = new Date().toISOString();
  const rolePayload = {
    roleName,
    roleDescription: optionalString(updates.roleDescription, 'roleDescription', 2000)
      || String(existing.roleDescription || existing.description || ''),
    description: optionalString(updates.roleDescription, 'roleDescription', 2000)
      || String(existing.roleDescription || existing.description || ''),
    roleLevel,
    level: roleLevel,
    departmentAccess: optionalString(updates.departmentAccess, 'departmentAccess', 160),
    siteAccess: optionalString(updates.siteAccess, 'siteAccess', 160),
    businessUnitAccess: optionalString(updates.businessUnitAccess, 'businessUnitAccess', 160),
    dataScope: DATA_SCOPE_OPTIONS.includes(updates.dataScope as typeof DATA_SCOPE_OPTIONS[number])
      ? String(updates.dataScope)
      : String(existing.dataScope || 'Organization Records'),
    fieldPolicies: Array.isArray(updates.fieldPolicies) ? updates.fieldPolicies.slice(0, 100) : (existing.fieldPolicies || []),
    status,
    updatedBy: request.auth.uid,
    updatedAt: now,
  };

  const permDoc = await findPermissionDoc(firestore, targetRoleId);
  const batch = firestore.batch();
  batch.update(roleRef, rolePayload);
  if (permDoc) {
    batch.update(permDoc.ref, {
      roleName,
      permissions,
      status,
      updatedBy: request.auth.uid,
      updatedAt: now,
    });
  } else {
    batch.set(firestore.collection('permissions').doc(), {
      roleId: targetRoleId,
      roleName,
      permissions,
      status,
      isDeleted: false,
      createdBy: request.auth.uid,
      updatedBy: request.auth.uid,
      createdAt: now,
      updatedAt: now,
    });
  }

  writeRoleAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: roleDocId,
    action: 'EDIT_ROLE',
    oldValue: existing,
    newValue: { ...rolePayload, permissions },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    roleNotification(
      request.auth.uid,
      roleDocId,
      'ROLE_UPDATED',
      'Role updated',
      `Role "${roleName}" permissions were updated.`,
      now,
    ),
  );
  await batch.commit();
  const affectedUsers = await countAssignedUsers(firestore, targetRoleId);
  return {
    role: { id: roleDocId, roleId: targetRoleId, ...existing, ...rolePayload },
    affectedUsers,
  };
});

export const setAdminRoleStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const roleDocId = requiredString(request.data?.roleDocId, 'roleDocId', 128);
  const status = String(request.data?.status || '') === 'Inactive' ? 'Inactive' : 'Active';
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const roleRef = firestore.collection('roles').doc(roleDocId);
  const roleSnap = await roleRef.get();
  if (!roleSnap.exists || roleSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Role not found');
  }
  const existing = roleSnap.data() || {};
  const targetRoleId = String(existing.roleId || '');
  assertCanModifyTargetRole(actorRole, targetRoleId);
  if (targetRoleId === 'super_admin' && status !== 'Active') {
    throw new HttpsError('failed-precondition', 'Super Admin role cannot be deactivated');
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(roleRef, { status, updatedAt: now, updatedBy: request.auth.uid });
  const permDoc = await findPermissionDoc(firestore, targetRoleId);
  if (permDoc) {
    batch.update(permDoc.ref, { status, updatedAt: now, updatedBy: request.auth.uid });
  }
  writeRoleAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: roleDocId,
    action: status === 'Active' ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED',
    oldValue: existing.status,
    newValue: status,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    roleNotification(
      request.auth.uid,
      roleDocId,
      status === 'Active' ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED',
      status === 'Active' ? 'Role activated' : 'Role deactivated',
      `Role "${String(existing.roleName || targetRoleId)}" is now ${status}.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true, status };
});

export const softDeleteAdminRole = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);
  if (actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only Super Admin can soft-delete roles');
  }

  const roleDocId = requiredString(request.data?.roleDocId, 'roleDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const roleRef = firestore.collection('roles').doc(roleDocId);
  const roleSnap = await roleRef.get();
  if (!roleSnap.exists) throw new HttpsError('not-found', 'Role not found');
  const existing = roleSnap.data() || {};
  const targetRoleId = String(existing.roleId || '');
  if (SYSTEM_ROLE_IDS.has(targetRoleId) || existing.isSystemRole === true) {
    throw new HttpsError('failed-precondition', 'System roles cannot be deleted');
  }
  const assigned = await countAssignedUsers(firestore, targetRoleId);
  if (assigned > 0) {
    throw new HttpsError('failed-precondition', `Cannot delete role assigned to ${assigned} user(s)`);
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(roleRef, {
    isDeleted: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  const permDoc = await findPermissionDoc(firestore, targetRoleId);
  if (permDoc) {
    batch.update(permDoc.ref, {
      isDeleted: true,
      status: 'Inactive',
      updatedAt: now,
      updatedBy: request.auth.uid,
    });
  }
  writeRoleAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: roleDocId,
    action: 'DELETE_ROLE',
    oldValue: existing,
    newValue: { isDeleted: true, status: 'Inactive' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    roleNotification(
      request.auth.uid,
      roleDocId,
      'ROLE_DELETED',
      'Role deleted',
      `Role "${String(existing.roleName || targetRoleId)}" was soft-deleted.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const restoreAdminRole = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const roleDocId = requiredString(request.data?.roleDocId, 'roleDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const roleRef = firestore.collection('roles').doc(roleDocId);
  const roleSnap = await roleRef.get();
  if (!roleSnap.exists) throw new HttpsError('not-found', 'Role not found');
  const existing = roleSnap.data() || {};
  const targetRoleId = String(existing.roleId || '');
  assertCanModifyTargetRole(actorRole, targetRoleId);

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(roleRef, {
    isDeleted: false,
    status: 'Active',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  const permSnap = await firestore.collection('permissions')
    .where('roleId', '==', targetRoleId)
    .limit(10)
    .get();
  const permDoc = permSnap.docs[0];
  if (permDoc) {
    batch.update(permDoc.ref, {
      isDeleted: false,
      status: 'Active',
      updatedAt: now,
      updatedBy: request.auth.uid,
    });
  }
  writeRoleAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: roleDocId,
    action: 'RESTORE_ROLE',
    oldValue: { isDeleted: existing.isDeleted, status: existing.status },
    newValue: { isDeleted: false, status: 'Active' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    roleNotification(
      request.auth.uid,
      roleDocId,
      'ROLE_RESTORED',
      'Role restored',
      `Role "${String(existing.roleName || targetRoleId)}" was restored.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const cloneAdminRole = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const sourceRoleDocId = requiredString(request.data?.sourceRoleDocId, 'sourceRoleDocId', 128);
  const newRoleId = requiredString(request.data?.newRoleId, 'newRoleId', 64).toLowerCase();
  const newRoleName = requiredString(request.data?.newRoleName, 'newRoleName', 120);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(newRoleId)) {
    throw new HttpsError('invalid-argument', 'Role ID must be lowercase snake_case');
  }
  if (newRoleId === 'super_admin') {
    throw new HttpsError('permission-denied', 'Cannot clone into Super Admin');
  }
  assertCanModifyTargetRole(actorRole, newRoleId);

  const sourceSnap = await firestore.collection('roles').doc(sourceRoleDocId).get();
  if (!sourceSnap.exists || sourceSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Source role not found');
  }
  const source = sourceSnap.data() || {};
  const sourcePerm = await findPermissionDoc(firestore, String(source.roleId || ''));
  const permissions = sanitizeRoleMatrix(
    newRoleId,
    sourcePerm?.data()?.permissions || {},
  );
  if (actorRole === 'admin') {
    if (!permissions.Admin) permissions.Admin = {};
    permissions.Admin.Admin = false;
    permissions.Admin.Delete = false;
  }

  const [dupId, dupName] = await Promise.all([
    firestore.collection('roles').where('roleId', '==', newRoleId).limit(5).get(),
    firestore.collection('roles').where('roleName', '==', newRoleName).limit(5).get(),
  ]);
  if (dupId.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Role ID already exists');
  }
  if (dupName.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Role name already exists');
  }

  const now = new Date().toISOString();
  const roleRef = firestore.collection('roles').doc();
  const permRef = firestore.collection('permissions').doc();
  const roleLevel = Math.min(Number(source.roleLevel || source.level || 10), actorRole === 'admin' ? 89 : 100);
  const rolePayload = {
    roleId: newRoleId,
    roleName: newRoleName,
    roleDescription: `Cloned from ${String(source.roleName || source.roleId)}`,
    description: `Cloned from ${String(source.roleName || source.roleId)}`,
    roleLevel,
    level: roleLevel,
    departmentAccess: String(source.departmentAccess || ''),
    siteAccess: String(source.siteAccess || ''),
    businessUnitAccess: String(source.businessUnitAccess || ''),
    dataScope: String(source.dataScope || 'Organization Records'),
    fieldPolicies: Array.isArray(source.fieldPolicies) ? source.fieldPolicies : [],
    status: 'Active',
    isSystemRole: SYSTEM_ROLE_IDS.has(newRoleId),
    isDeleted: false,
    clonedFrom: sourceRoleDocId,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  };
  const batch = firestore.batch();
  batch.set(roleRef, rolePayload);
  batch.set(permRef, {
    roleId: newRoleId,
    roleName: newRoleName,
    permissions,
    status: 'Active',
    isDeleted: false,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  });
  writeRoleAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: roleRef.id,
    action: 'CLONE_ROLE',
    oldValue: { sourceRoleDocId },
    newValue: { role: rolePayload, permissions },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    roleNotification(
      request.auth.uid,
      roleRef.id,
      'ROLE_CLONED',
      'Role cloned',
      `Role "${newRoleName}" was cloned from "${String(source.roleName || '')}".`,
      now,
    ),
  );
  await batch.commit();
  return { id: roleRef.id, ...rolePayload };
});

export const bulkUpdateAdminRoles = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const roleDocIds = Array.isArray(request.data?.roleDocIds)
    ? (request.data.roleDocIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (roleDocIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one role');
  }
  const action = String(request.data?.action || '');
  if (!['activate', 'deactivate'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported bulk action');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const status = action === 'activate' ? 'Active' : 'Inactive';
  const now = new Date().toISOString();
  let successCount = 0;

  for (const roleDocId of roleDocIds) {
    const roleRef = firestore.collection('roles').doc(roleDocId);
    const roleSnap = await roleRef.get();
    if (!roleSnap.exists || roleSnap.data()?.isDeleted === true) continue;
    const existing = roleSnap.data() || {};
    const targetRoleId = String(existing.roleId || '');
    try {
      assertCanModifyTargetRole(actorRole, targetRoleId);
      if (targetRoleId === 'super_admin' && status !== 'Active') continue;
    } catch {
      continue;
    }
    const batch = firestore.batch();
    batch.update(roleRef, { status, updatedAt: now, updatedBy: request.auth!.uid });
    const permDoc = await findPermissionDoc(firestore, targetRoleId);
    if (permDoc) {
      batch.update(permDoc.ref, { status, updatedAt: now, updatedBy: request.auth!.uid });
    }
    writeRoleAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: roleDocId,
      action: status === 'Active' ? 'ROLE_ACTIVATED' : 'ROLE_DEACTIVATED',
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

const SYSTEM_DEPARTMENT_CODES = new Set([
  'QA', 'QC', 'PROD', 'WH', 'ENG', 'RA', 'IT', 'CQA', 'ADMIN', 'HR', 'VAL', 'MAINT',
]);

const DEPARTMENT_TYPES = [
  'QA', 'QC', 'Production', 'Warehouse', 'Engineering', 'HR', 'IT',
  'Regulatory', 'Purchase', 'Microbiology', 'Validation', 'Maintenance', 'Admin', 'Other',
] as const;

function departmentNotification(
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
    moduleName: 'Department Master',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/departments/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeDepartmentAudit(
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
    module: 'Department Master',
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
    collectionName: 'departments',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Department Master',
    reason: input.reason,
    timestamp: input.now,
  });
}

function buildDepartmentId(code: string): string {
  return `DEPT-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

async function resolveActiveUserByIdOrName(
  firestore: Firestore,
  userId: string,
  fullName: string,
): Promise<(DocumentData & { id: string }) | null> {
  if (userId) {
    const byId = await firestore.collection('users').doc(userId).get();
    if (byId.exists && byId.data()?.isDeleted !== true
      && String(byId.data()?.userStatus || byId.data()?.status || '') === 'Active') {
      return { id: byId.id, ...(byId.data() || {}) };
    }
  }
  if (!fullName) return null;
  const byName = await firestore.collection('users').where('fullName', '==', fullName).limit(5).get();
  const match = byName.docs.find((document) =>
    document.data().isDeleted !== true
    && String(document.data().userStatus || document.data().status || '') === 'Active');
  return match ? { id: match.id, ...(match.data() || {}) } : null;
}

async function assertNoDepartmentCycle(
  firestore: Firestore,
  departmentDocId: string,
  parentDepartmentId: string,
) {
  if (!parentDepartmentId) return;
  if (parentDepartmentId === departmentDocId) {
    throw new HttpsError('failed-precondition', 'A department cannot be its own parent');
  }
  let currentId = parentDepartmentId;
  const visited = new Set<string>([departmentDocId]);
  for (let depth = 0; depth < 25; depth += 1) {
    if (visited.has(currentId)) {
      throw new HttpsError('failed-precondition', 'Circular parent-child hierarchy is not allowed');
    }
    visited.add(currentId);
    const parentSnap = await firestore.collection('departments').doc(currentId).get();
    if (!parentSnap.exists || parentSnap.data()?.isDeleted === true) {
      throw new HttpsError('failed-precondition', 'Parent department is missing or inactive');
    }
    if (String(parentSnap.data()?.status || 'Active') !== 'Active') {
      throw new HttpsError('failed-precondition', 'Parent department must be Active');
    }
    currentId = String(parentSnap.data()?.parentDepartmentId || '');
    if (!currentId) return;
  }
  throw new HttpsError('failed-precondition', 'Department hierarchy exceeds supported depth');
}

async function countUsersMatchingDepartment(
  firestore: Firestore,
  dept: DocumentData,
) {
  const names = [dept.departmentName, dept.departmentCode, dept.departmentId, dept.shortName]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  let total = 0;
  for (const name of Array.from(new Set(names))) {
    const snapshot = await firestore.collection('users')
      .where('department', '==', name)
      .limit(500)
      .get();
    total += snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
  }
  return total;
}

async function cascadeDepartmentRename(
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
    const users = await firestore.collection('users').where('department', '==', oldName).limit(400).get();
    users.docs.forEach((document) => {
      if (document.data().isDeleted === true) return;
      batch.update(document.ref, { department: newName, updatedAt: now, updatedBy: actorUid });
      cascadeCount += 1;
    });
    const designations = await firestore.collection('designations').where('department', '==', oldName).limit(200).get();
    designations.docs.forEach((document) => {
      if (document.data().isDeleted === true) return;
      batch.update(document.ref, { department: newName, updatedAt: now, updatedBy: actorUid });
      cascadeCount += 1;
    });
  }
  return cascadeCount;
}

export const createAdminDepartment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const input = request.data as Record<string, unknown>;
  const departmentCode = requiredString(input.departmentCode, 'departmentCode', 32).toUpperCase();
  const departmentName = requiredString(input.departmentName, 'departmentName', 160);
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const departmentType = String(input.departmentType || 'Other');
  if (!DEPARTMENT_TYPES.includes(departmentType as typeof DEPARTMENT_TYPES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid department type');
  }
  const parentDepartmentId = optionalString(input.parentDepartmentId, 'parentDepartmentId', 128);
  const departmentHead = requiredString(input.departmentHead, 'departmentHead', 200);
  const departmentHeadId = optionalString(input.departmentHeadId, 'departmentHeadId', 128);
  const manager = optionalString(input.manager, 'manager', 200);
  const managerId = optionalString(input.managerId, 'managerId', 128);
  const status = String(input.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';

  const head = await resolveActiveUserByIdOrName(firestore, departmentHeadId, departmentHead);
  if (!head) throw new HttpsError('failed-precondition', 'Department head must be an active user');
  let managerRecord: (DocumentData & { id: string }) | null = null;
  if (manager || managerId) {
    managerRecord = await resolveActiveUserByIdOrName(firestore, managerId, manager);
    if (!managerRecord) throw new HttpsError('failed-precondition', 'Manager must be an active user');
  }

  if (parentDepartmentId) {
    await assertNoDepartmentCycle(firestore, 'new', parentDepartmentId);
  }

  const [dupCode, dupName] = await Promise.all([
    firestore.collection('departments').where('departmentCode', '==', departmentCode).limit(5).get(),
    firestore.collection('departments').where('departmentName', '==', departmentName).limit(5).get(),
  ]);
  if (dupCode.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Department code already exists');
  }
  if (dupName.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Department name already exists');
  }

  let parentDepartmentName = '';
  if (parentDepartmentId) {
    const parentSnap = await firestore.collection('departments').doc(parentDepartmentId).get();
    parentDepartmentName = String(parentSnap.data()?.departmentName || '');
  }

  const siteId = optionalString(input.siteId, 'siteId', 128);
  let siteLocation = optionalString(input.siteLocation, 'siteLocation', 200);
  let businessUnit = optionalString(input.businessUnit, 'businessUnit', 160);
  if (siteId) {
    const site = await firestore.collection('company_sites').doc(siteId).get();
    if (!site.exists || site.data()?.isDeleted === true) {
      throw new HttpsError('failed-precondition', 'Site is missing or inactive');
    }
    siteLocation = siteLocation || String(site.data()?.siteName || '');
    businessUnit = businessUnit || String(site.data()?.companyName || '');
  }

  const now = new Date().toISOString();
  const departmentId = buildDepartmentId(departmentCode);
  const isSystemDepartment = SYSTEM_DEPARTMENT_CODES.has(departmentCode);
  const payload = {
    departmentId,
    departmentCode,
    departmentName,
    shortName: optionalString(input.shortName, 'shortName', 40) || departmentCode,
    departmentType,
    parentDepartmentId,
    parentDepartmentName,
    departmentHead: String(head.fullName || departmentHead),
    departmentHeadId: String(head.id || ''),
    manager: managerRecord ? String(managerRecord.fullName || manager) : '',
    managerId: managerRecord ? String(managerRecord.id || '') : '',
    hodEmail: optionalString(input.hodEmail, 'hodEmail', 320) || String(head.email || ''),
    email: optionalString(input.email, 'email', 320) || String(head.email || ''),
    phone: validatedPhone(input.phone, 'phone'),
    extension: optionalString(input.extension, 'extension', 20),
    businessUnit,
    siteId,
    siteLocation,
    location: optionalString(input.location, 'location', 200) || siteLocation,
    costCenter: optionalString(input.costCenter, 'costCenter', 64),
    description: optionalString(input.description, 'description', 2000),
    remarks: optionalString(input.remarks, 'remarks', 2000),
    status,
    isSystemDepartment,
    isDeleted: false,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  };

  const ref = firestore.collection('departments').doc();
  const batch = firestore.batch();
  batch.set(ref, payload);
  writeDepartmentAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: ref.id,
    action: 'CREATE_DEPARTMENT',
    oldValue: null,
    newValue: payload,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    departmentNotification(
      request.auth.uid,
      ref.id,
      'DEPARTMENT_CREATED',
      'Department created',
      `Department "${departmentName}" was created.`,
      now,
    ),
  );
  await batch.commit();
  return { id: ref.id, ...payload };
});

export const updateAdminDepartment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);

  const input = request.data as Record<string, unknown>;
  const departmentDocId = requiredString(input.departmentDocId, 'departmentDocId', 128);
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const updates = (input.updates && typeof input.updates === 'object' && !Array.isArray(input.updates))
    ? input.updates as Record<string, unknown>
    : input;

  const ref = firestore.collection('departments').doc(departmentDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Department not found');
  }
  const existing = snap.data() || {};

  const departmentCode = requiredString(
    updates.departmentCode ?? existing.departmentCode,
    'departmentCode',
    32,
  ).toUpperCase();
  const departmentName = requiredString(
    updates.departmentName ?? existing.departmentName,
    'departmentName',
    160,
  );
  const departmentType = String(updates.departmentType || existing.departmentType || 'Other');
  if (!DEPARTMENT_TYPES.includes(departmentType as typeof DEPARTMENT_TYPES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid department type');
  }

  if (departmentCode !== existing.departmentCode) {
    const dupCode = await firestore.collection('departments').where('departmentCode', '==', departmentCode).limit(5).get();
    if (dupCode.docs.some((document) => document.id !== departmentDocId && document.data().isDeleted !== true)) {
      throw new HttpsError('already-exists', 'Department code already exists');
    }
  }
  if (departmentName !== existing.departmentName) {
    const dupName = await firestore.collection('departments').where('departmentName', '==', departmentName).limit(5).get();
    if (dupName.docs.some((document) => document.id !== departmentDocId && document.data().isDeleted !== true)) {
      throw new HttpsError('already-exists', 'Department name already exists');
    }
  }

  const parentDepartmentId = optionalString(
    updates.parentDepartmentId ?? existing.parentDepartmentId,
    'parentDepartmentId',
    128,
  );
  await assertNoDepartmentCycle(firestore, departmentDocId, parentDepartmentId);
  let parentDepartmentName = '';
  if (parentDepartmentId) {
    const parentSnap = await firestore.collection('departments').doc(parentDepartmentId).get();
    parentDepartmentName = String(parentSnap.data()?.departmentName || '');
  }

  const departmentHead = requiredString(
    updates.departmentHead ?? existing.departmentHead,
    'departmentHead',
    200,
  );
  const departmentHeadId = optionalString(
    updates.departmentHeadId ?? existing.departmentHeadId,
    'departmentHeadId',
    128,
  );
  const head = await resolveActiveUserByIdOrName(firestore, departmentHeadId, departmentHead);
  if (!head) throw new HttpsError('failed-precondition', 'Department head must be an active user');

  const manager = optionalString(updates.manager ?? existing.manager, 'manager', 200);
  const managerId = optionalString(updates.managerId ?? existing.managerId, 'managerId', 128);
  let managerRecord: (DocumentData & { id: string }) | null = null;
  if (manager || managerId) {
    managerRecord = await resolveActiveUserByIdOrName(firestore, managerId, manager);
    if (!managerRecord) throw new HttpsError('failed-precondition', 'Manager must be an active user');
  }

  const siteId = optionalString(updates.siteId ?? existing.siteId, 'siteId', 128);
  let siteLocation = optionalString(updates.siteLocation ?? existing.siteLocation, 'siteLocation', 200);
  let businessUnit = optionalString(updates.businessUnit ?? existing.businessUnit, 'businessUnit', 160);
  if (siteId) {
    const site = await firestore.collection('company_sites').doc(siteId).get();
    if (!site.exists || site.data()?.isDeleted === true) {
      throw new HttpsError('failed-precondition', 'Site is missing or inactive');
    }
    siteLocation = siteLocation || String(site.data()?.siteName || '');
    businessUnit = businessUnit || String(site.data()?.companyName || '');
  }

  const status = String(updates.status || existing.status || 'Active') === 'Inactive' ? 'Inactive' : 'Active';
  const now = new Date().toISOString();
  const payload = {
    departmentId: buildDepartmentId(departmentCode),
    departmentCode,
    departmentName,
    shortName: optionalString(updates.shortName ?? existing.shortName, 'shortName', 40) || departmentCode,
    departmentType,
    parentDepartmentId,
    parentDepartmentName,
    departmentHead: String(head.fullName || departmentHead),
    departmentHeadId: String(head.id || ''),
    manager: managerRecord ? String(managerRecord.fullName || manager) : '',
    managerId: managerRecord ? String(managerRecord.id || '') : '',
    hodEmail: optionalString(updates.hodEmail ?? existing.hodEmail, 'hodEmail', 320) || String(head.email || ''),
    email: optionalString(updates.email ?? existing.email, 'email', 320) || String(head.email || ''),
    phone: validatedPhone(updates.phone ?? existing.phone, 'phone'),
    extension: optionalString(updates.extension ?? existing.extension, 'extension', 20),
    businessUnit,
    siteId,
    siteLocation,
    location: optionalString(updates.location ?? existing.location, 'location', 200) || siteLocation,
    costCenter: optionalString(updates.costCenter ?? existing.costCenter, 'costCenter', 64),
    description: optionalString(updates.description ?? existing.description, 'description', 2000),
    remarks: optionalString(updates.remarks ?? existing.remarks, 'remarks', 2000),
    status,
    isSystemDepartment: SYSTEM_DEPARTMENT_CODES.has(departmentCode) || Boolean(existing.isSystemDepartment),
    updatedBy: request.auth.uid,
    updatedAt: now,
  };

  const batch = firestore.batch();
  batch.update(ref, payload);
  const cascadeCount = await cascadeDepartmentRename(
    firestore,
    batch,
    [String(existing.departmentName || ''), String(existing.departmentCode || '')],
    departmentName,
    request.auth.uid,
    now,
  );

  if (existing.departmentHead !== payload.departmentHead) {
    writeDepartmentAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: departmentDocId,
      action: 'DEPARTMENT_HEAD_CHANGED',
      oldValue: existing.departmentHead,
      newValue: payload.departmentHead,
      reason,
      now,
    });
  }
  if (String(existing.parentDepartmentId || '') !== parentDepartmentId) {
    writeDepartmentAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: departmentDocId,
      action: 'HIERARCHY_CHANGED',
      oldValue: { parentDepartmentId: existing.parentDepartmentId, parentDepartmentName: existing.parentDepartmentName },
      newValue: { parentDepartmentId, parentDepartmentName },
      reason,
      now,
    });
  }
  writeDepartmentAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: departmentDocId,
    action: 'EDIT_DEPARTMENT',
    oldValue: existing,
    newValue: payload,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    departmentNotification(
      request.auth.uid,
      departmentDocId,
      'DEPARTMENT_UPDATED',
      'Department updated',
      `Department "${departmentName}" was updated.`,
      now,
    ),
  );
  await batch.commit();
  return {
    department: { id: departmentDocId, ...existing, ...payload },
    cascadeCount,
  };
});

export const setAdminDepartmentStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const departmentDocId = requiredString(request.data?.departmentDocId, 'departmentDocId', 128);
  const status = String(request.data?.status || '') === 'Inactive' ? 'Inactive' : 'Active';
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('departments').doc(departmentDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Department not found');
  }
  const existing = snap.data() || {};
  const linkedUsers = await countUsersMatchingDepartment(firestore, existing);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { status, updatedAt: now, updatedBy: request.auth.uid });
  writeDepartmentAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: departmentDocId,
    action: status === 'Active' ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_DEACTIVATED',
    oldValue: existing.status,
    newValue: status,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    departmentNotification(
      request.auth.uid,
      departmentDocId,
      status === 'Active' ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_DEACTIVATED',
      status === 'Active' ? 'Department activated' : 'Department deactivated',
      `Department "${String(existing.departmentName || '')}" is now ${status}.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true, linkedUsers };
});

export const softDeleteAdminDepartment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);
  if (actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only Super Admin can soft-delete departments');
  }

  const departmentDocId = requiredString(request.data?.departmentDocId, 'departmentDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('departments').doc(departmentDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Department not found');
  const existing = snap.data() || {};
  const code = String(existing.departmentCode || '').toUpperCase();
  if (SYSTEM_DEPARTMENT_CODES.has(code) || existing.isSystemDepartment === true) {
    throw new HttpsError('failed-precondition', 'System departments cannot be deleted');
  }

  const linkedUsers = await countUsersMatchingDepartment(firestore, existing);
  if (linkedUsers > 0) {
    throw new HttpsError('failed-precondition', `Cannot delete department: ${linkedUsers} user(s) are linked`);
  }
  const children = await firestore.collection('departments')
    .where('parentDepartmentId', '==', departmentDocId)
    .limit(20)
    .get();
  if (children.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('failed-precondition', 'Cannot delete department with active child departments');
  }
  const designations = await firestore.collection('designations')
    .where('department', '==', String(existing.departmentName || ''))
    .limit(20)
    .get();
  if (designations.docs.some((document) => document.data().isDeleted !== true)) {
    throw new HttpsError('failed-precondition', 'Cannot delete department linked to designations');
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeDepartmentAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: departmentDocId,
    action: 'DELETE_DEPARTMENT',
    oldValue: existing,
    newValue: { isDeleted: true, status: 'Inactive' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    departmentNotification(
      request.auth.uid,
      departmentDocId,
      'DEPARTMENT_DELETED',
      'Department deleted',
      `Department "${String(existing.departmentName || '')}" was soft-deleted.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const restoreAdminDepartment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const departmentDocId = requiredString(request.data?.departmentDocId, 'departmentDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('departments').doc(departmentDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Department not found');
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: false,
    status: 'Active',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeDepartmentAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: departmentDocId,
    action: 'RESTORE_DEPARTMENT',
    oldValue: { isDeleted: existing.isDeleted, status: existing.status },
    newValue: { isDeleted: false, status: 'Active' },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const bulkUpdateAdminDepartments = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const departmentDocIds = Array.isArray(request.data?.departmentDocIds)
    ? (request.data.departmentDocIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (departmentDocIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one department');
  }
  const action = String(request.data?.action || '');
  if (!['activate', 'deactivate'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported bulk action');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const status = action === 'activate' ? 'Active' : 'Inactive';
  const now = new Date().toISOString();
  let successCount = 0;

  for (const departmentDocId of departmentDocIds) {
    const ref = firestore.collection('departments').doc(departmentDocId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.isDeleted === true) continue;
    const existing = snap.data() || {};
    const batch = firestore.batch();
    batch.update(ref, { status, updatedAt: now, updatedBy: request.auth!.uid });
    writeDepartmentAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: departmentDocId,
      action: status === 'Active' ? 'DEPARTMENT_ACTIVATED' : 'DEPARTMENT_DEACTIVATED',
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

export const linkUsersToAdminDepartment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const departmentDocId = requiredString(request.data?.departmentDocId, 'departmentDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const userIds = Array.isArray(request.data?.userIds)
    ? (request.data.userIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (userIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one user');
  }

  const deptSnap = await firestore.collection('departments').doc(departmentDocId).get();
  if (!deptSnap.exists || deptSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Department not found');
  }
  const dept = deptSnap.data() || {};
  if (String(dept.status || '') !== 'Active') {
    throw new HttpsError('failed-precondition', 'Cannot assign users to an inactive department');
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  let count = 0;
  for (const userId of userIds) {
    const userRef = firestore.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists || userSnap.data()?.isDeleted === true) continue;
    batch.update(userRef, {
      department: String(dept.departmentName || ''),
      updatedAt: now,
      updatedBy: request.auth.uid,
    });
    count += 1;
  }
  if (count === 0) {
    throw new HttpsError('failed-precondition', 'No valid users to link');
  }
  writeDepartmentAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: departmentDocId,
    action: 'LINK_USERS',
    oldValue: null,
    newValue: { userIds, department: dept.departmentName },
    reason,
    now,
  });
  await batch.commit();
  return { count };
});

export const logAdminDepartmentExport = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));
  const count = Number(request.data?.count || 0);
  const reason = optionalString(request.data?.reason, 'reason', 500) || 'Department list export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeDepartmentAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: 'export',
    action: 'EXPORT_DEPARTMENT_LIST',
    oldValue: null,
    newValue: { count },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export {
  createAdminDesignation,
  updateAdminDesignation,
  setAdminDesignationStatus,
  softDeleteAdminDesignation,
  restoreAdminDesignation,
  bulkUpdateAdminDesignations,
  importAdminDesignations,
  logAdminDesignationExport,
} from './designation-admin';

export {
  createAdminCompanySite,
  updateAdminCompanySite,
  setAdminCompanySiteStatus,
  setDefaultAdminCompanySite,
  softDeleteAdminCompanySite,
  restoreAdminCompanySite,
  bulkUpdateAdminCompanySites,
  bulkSoftDeleteAdminCompanySites,
  importAdminCompanySites,
  logAdminCompanySiteExport,
} from './company-site-admin';

export {
  createAdminProduct,
  updateAdminProduct,
  setAdminProductStatus,
  setAdminProductLifecycle,
  archiveAdminProduct,
  softDeleteAdminProduct,
  restoreAdminProduct,
  bulkUpdateAdminProducts,
  bulkSoftDeleteAdminProducts,
  importAdminProducts,
  logAdminProductExport,
  registerAdminProductAttachment,
  softDeleteAdminProductAttachment,
} from './product-admin';

export {
  createAdminBatch,
  updateAdminBatch,
  setAdminBatchStatus,
  softDeleteAdminBatch,
  restoreAdminBatch,
  bulkUpdateAdminBatches,
  bulkSoftDeleteAdminBatches,
  importAdminBatches,
  logAdminBatchExport,
  registerAdminBatchAttachment,
  softDeleteAdminBatchAttachment,
  previewAdminBatchNumber,
} from './batch-admin';

export {
  createAdminParameter,
  updateAdminParameter,
  setAdminParameterStatus,
  archiveAdminParameter,
  softDeleteAdminParameter,
  restoreAdminParameter,
  bulkUpdateAdminParameters,
  bulkSoftDeleteAdminParameters,
  importAdminParameters,
  logAdminParameterExport,
  seedAdminDefaultParameters,
} from './parameter-admin';

export {
  createAdminWorkflow,
  updateAdminWorkflow,
  setAdminWorkflowStatus,
  archiveAdminWorkflow,
  softDeleteAdminWorkflow,
  restoreAdminWorkflow,
  cloneAdminWorkflow,
  bulkUpdateAdminWorkflows,
  bulkSoftDeleteAdminWorkflows,
  importAdminWorkflows,
  logAdminWorkflowExport,
  seedAdminDefaultWorkflows,
  validateAdminWorkflowDesign,
} from './workflow-admin';

export {
  createAdminApprovalMatrix,
  updateAdminApprovalMatrix,
  setAdminApprovalMatrixStatus,
  archiveAdminApprovalMatrix,
  softDeleteAdminApprovalMatrix,
  restoreAdminApprovalMatrix,
  cloneAdminApprovalMatrix,
  bulkUpdateAdminApprovalMatrices,
  bulkSoftDeleteAdminApprovalMatrices,
  importAdminApprovalMatrices,
  logAdminApprovalMatrixExport,
  seedAdminDefaultApprovalMatrices,
} from './approval-matrix-admin';

export {
  createAdminDocumentNumbering,
  updateAdminDocumentNumbering,
  setAdminDocumentNumberingStatus,
  archiveAdminDocumentNumbering,
  softDeleteAdminDocumentNumbering,
  restoreAdminDocumentNumbering,
  cloneAdminDocumentNumbering,
  bulkUpdateAdminDocumentNumberings,
  bulkSoftDeleteAdminDocumentNumberings,
  generateAdminDocumentNumber,
  resetAdminDocumentNumberingSequence,
  previewAdminDocumentNumber,
  listAdminDocumentNumberHistory,
  importAdminDocumentNumberings,
  logAdminDocumentNumberingExport,
  seedAdminDefaultDocumentNumberings,
} from './document-numbering-admin';

export {
  appendAdminAuditTrail,
  logAdminAuditTrailExport,
  archiveAdminAuditTrail,
  verifyAdminAuditIntegrity,
  getAdminAuditIntegrityStatus,
} from './audit-trail-admin';

export {
  recordAdminLoginSuccess,
  recordAdminLoginFailure,
  recordAdminLogout,
  terminateAdminSession,
  terminateAllAdminSessionsForUser,
  unlockAdminAccount,
  recordAdminSecurityEvent,
  archiveAdminLoginActivity,
  logAdminLoginActivityExport,
} from './login-activity-admin';

export {
  createAdminAccessReview,
  updateAdminAccessReview,
  transitionAdminAccessReview,
  completeAdminAccessReview,
  generateAdminAccessReviewCampaign,
  analyzeAdminAccessRisks,
  archiveAdminAccessReviews,
  markAdminAccessReviewsOverdue,
  logAdminAccessReviewExport,
} from './access-review-admin';

export {
  createAdminEsignSetting,
  updateAdminEsignSetting,
  setAdminEsignSettingStatus,
  softDeleteAdminEsignSetting,
  seedAdminEsignSettings,
  resolveAdminEsignSetting,
  recordAdminEsignAttestation,
  logAdminEsignSettingsExport,
} from './esign-settings-admin';

export {
  createAdminNotificationSetting,
  updateAdminNotificationSetting,
  setAdminNotificationSettingStatus,
  softDeleteAdminNotificationSetting,
  seedAdminNotificationSettings,
  dispatchAdminNotificationEvent,
  processAdminNotificationQueue,
  broadcastAdminNotification,
  archiveAdminNotifications,
  logAdminNotificationSettingsExport,
} from './notification-settings-admin';

export {
  createAdminEmailSmsTemplate,
  updateAdminEmailSmsTemplate,
  setAdminEmailSmsTemplateStatus,
  transitionAdminEmailSmsTemplate,
  softDeleteAdminEmailSmsTemplate,
  seedAdminEmailSmsTemplates,
  resolveAdminEmailSmsTemplate,
  previewAdminEmailSmsTemplate,
  logAdminEmailSmsTemplatesExport,
} from './email-sms-templates-admin';

export {
  createAdminModuleConfiguration,
  updateAdminModuleConfiguration,
  setAdminModuleEnabled,
  setAdminModuleVisibility,
  setAdminModuleFeatureFlag,
  softDeleteAdminModuleConfiguration,
  seedAdminModuleConfigurations,
  resolveAdminModuleConfiguration,
  logAdminModuleConfigurationExport,
} from './module-configuration-admin';

export {
  exportAdminMasterData,
  validateAdminMasterDataImport,
  importAdminMasterData,
  softDeleteAdminMasterDataOperation,
} from './master-data-import-export-admin';

export {
  createAdminBackup,
  verifyAdminBackup,
  getAdminBackupDownloadUrl,
  updateAdminBackupSettings,
  requestAdminRestore,
  approveAdminRestore,
  rejectAdminRestore,
  softDeleteAdminBackup,
  purgeExpiredAdminBackups,
  logAdminBackupExport,
  archiveAdminBackupHistory,
  archiveAdminRestoreHistory,
  scheduledAdminBackup,
} from './backup-admin';

export {
  runAdminFirebaseHealthCheck,
  fetchAdminFirebaseHealthHistory,
  logAdminFirebaseStatusExport,
  scheduledFirebaseHealthCheck,
} from './firebase-health-admin';

export {
  runAdminSystemHealthCheck,
  fetchAdminSystemHealthHistory,
  acknowledgeAdminSystemHealthAlert,
  logAdminSystemHealthExport,
  scheduledSystemHealthCheck,
} from './system-health-admin';

export {
  updateAdminSystemSettings,
  resetAdminSystemSettings,
  publishAdminSystemSettings,
  rollbackAdminSystemSettings,
  fetchAdminSystemSettingsVersions,
  importAdminSystemSettings,
  logAdminSystemSettingsExport,
} from './system-settings-admin';

export {
  getAdminCpvDashboardSnapshot,
  logAdminCpvDashboardAudit,
  recordAdminCpvDashboardAudit,
} from './cpv-dashboard-admin';

export {
  createAdminCpvProduct,
  updateAdminCpvProduct,
  setAdminCpvProductStatus,
  linkAdminCpvParameter,
  unlinkAdminCpvParameter,
  importAdminCpvProduct,
  softDeleteAdminCpvProduct,
  logAdminCpvProductExport,
} from './cpv-product-admin';

export {
  createAdminCpvBatch,
  updateAdminCpvBatch,
  setAdminCpvBatchStatus,
  importAdminCpvBatch,
  softDeleteAdminCpvBatch,
  logAdminCpvBatchExport,
} from './cpv-batch-admin';

export {
  createAdminCppResult,
  updateAdminCppResult,
  reviewAdminCppResult,
  approveAdminCppResult,
  bulkCreateAdminCppResults,
  softDeleteAdminCppResult,
  logAdminCppExport,
} from './cpv-cpp-admin';

export {
  createAdminCqaResult,
  updateAdminCqaResult,
  reviewAdminCqaResult,
  approveAdminCqaResult,
  bulkCreateAdminCqaResults,
  softDeleteAdminCqaResult,
  logAdminCqaExport,
} from './cpv-cqa-admin';

export {
  createAdminRawMaterialRecord,
  updateAdminRawMaterialRecord,
  reviewAdminRawMaterialRecord,
  approveAdminRawMaterialRecord,
  bulkCreateAdminRawMaterialRecords,
  softDeleteAdminRawMaterialRecord,
  logAdminRawMaterialExport,
} from './cpv-raw-material-admin';

export {
  createAdminPackingMaterialRecord,
  updateAdminPackingMaterialRecord,
  reviewAdminPackingMaterialRecord,
  approveAdminPackingMaterialRecord,
  bulkCreateAdminPackingMaterialRecords,
  softDeleteAdminPackingMaterialRecord,
  logAdminPackingMaterialExport,
} from './cpv-packing-material-admin';

export {
  createAdminUtilityRecord,
  updateAdminUtilityRecord,
  reviewAdminUtilityRecord,
  approveAdminUtilityRecord,
  bulkCreateAdminUtilityRecords,
  softDeleteAdminUtilityRecord,
  logAdminUtilityExport,
} from './cpv-utility-admin';

export {
  createAdminEnvironmentalRecord,
  updateAdminEnvironmentalRecord,
  reviewAdminEnvironmentalRecord,
  approveAdminEnvironmentalRecord,
  bulkCreateAdminEnvironmentalRecords,
  softDeleteAdminEnvironmentalRecord,
  logAdminEnvironmentalExport,
} from './cpv-environmental-admin';

export {
  createAdminYieldRecord,
  updateAdminYieldRecord,
  reviewAdminYieldRecord,
  approveAdminYieldRecord,
  bulkCreateAdminYieldRecords,
  softDeleteAdminYieldRecord,
  logAdminYieldExport,
} from './cpv-yield-admin';

export {
  createAdminStabilityStudy,
  updateAdminStabilityStudy,
  generateAdminStabilitySchedule,
  updateAdminStabilityPull,
  refreshAdminStabilitySchedules,
  createAdminStabilityResult,
  updateAdminStabilityResult,
  reviewAdminStabilityResult,
  approveAdminStabilityResult,
  bulkCreateAdminStabilityResults,
  softDeleteAdminStabilityResult,
  updateAdminStabilityAttachments,
  logAdminStabilityExport,
} from './cpv-stability-admin';

export {
  createAdminHoldTimeRecord,
  updateAdminHoldTimeRecord,
  reviewAdminHoldTimeRecord,
  approveAdminHoldTimeRecord,
  bulkCreateAdminHoldTimeRecords,
  softDeleteAdminHoldTimeRecord,
  logAdminHoldTimeExport,
} from './cpv-hold-time-admin';

export {
  createAdminProcessCapability,
  recalculateAdminProcessCapability,
  reviewAdminProcessCapability,
  approveAdminProcessCapability,
  rejectAdminProcessCapability,
  softDeleteAdminProcessCapability,
  logAdminProcessCapabilityExport,
} from './cpv-process-capability-admin';

export {
  createAdminTrendAnalysis,
  regenerateAdminTrendAnalysis,
  reviewAdminTrendAnalysis,
  approveAdminTrendAnalysis,
  rejectAdminTrendAnalysis,
  softDeleteAdminTrendAnalysis,
  logAdminTrendAnalysisExport,
} from './cpv-trend-analysis-admin';

export {
  createAdminSpcRecord,
  regenerateAdminSpcRecord,
  reviewAdminSpcRecord,
  approveAdminSpcRecord,
  rejectAdminSpcRecord,
  softDeleteAdminSpcRecord,
  logAdminSpcExport,
} from './cpv-spc-admin';

export {
  createAdminRiskAssessment,
  updateAdminRiskAssessment,
  reviewAdminRiskAssessment,
  approveAdminRiskAssessment,
  rejectAdminRiskAssessment,
  addControlAdminRiskAssessment,
  recordEffectivenessAdminRiskAssessment,
  closeAdminRiskAssessment,
  softDeleteAdminRiskAssessment,
  logAdminRiskAssessmentExport,
} from './cpv-risk-assessment-admin';

export {
  createAdminCpvAnnualReview,
  updateAdminCpvAnnualReview,
  submitAdminCpvAnnualReview,
  approveAdminCpvAnnualReview,
  rejectAdminCpvAnnualReview,
  archiveAdminCpvAnnualReview,
  softDeleteAdminCpvAnnualReview,
  logAdminCpvAnnualReviewExport,
} from './cpv-annual-review-admin';

export {
  createAdminCpvReport,
  exportAdminCpvReport,
  archiveAdminCpvReport,
  softDeleteAdminCpvReport,
  logAdminCpvReportExport,
} from './cpv-reports-admin';

export {
  createAdminCpvAlert,
  acknowledgeAdminCpvAlert,
  assignAdminCpvAlert,
  linkAdminCpvAlert,
  investigateAdminCpvAlert,
  closeAdminCpvAlert,
  rejectAdminCpvAlert,
  escalateAdminCpvAlert,
  saveAdminAlertRule,
  deactivateAdminAlertRule,
  softDeleteAdminCpvAlert,
  logAdminCpvAlertExport,
} from './cpv-alert-admin';

export {
  saveAdminCpvConfigSingleton,
  createAdminCpvConfigListRecord,
  updateAdminCpvConfigListRecord,
  softDeleteAdminCpvConfigListRecord,
  resetAdminCpvConfigurationDefaults,
  importAdminCpvConfiguration,
  logAdminCpvConfigurationExport,
  approveAdminCpvConfiguration,
} from './cpv-configuration-admin';

