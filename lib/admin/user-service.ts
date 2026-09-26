import { sendPasswordResetEmail } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseApp, getFirebaseAuth, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import type { PermissionMatrixData } from '@/lib/permission-presets';
import {
  checkUniqueField, getAdminRecords,
} from './admin-service';
import { ADMIN_COLLECTIONS } from './constants';
import { isDepartmentActiveForAssignment } from './department-service';
import { isDesignationActiveForAssignment } from './designation-service';
import type { AdminUser } from './schemas';

export interface UserAuditMeta {
  userId: string;
  userName: string;
  role?: string;
}

export function canModifyTargetUser(
  currentRole: string,
  currentUid: string,
  target: AdminUser,
): { allowed: boolean; reason?: string } {
  if (target.authUid === currentUid || target.id === currentUid) {
    return { allowed: false, reason: 'You cannot modify your own account status.' };
  }
  const isSuperAdmin = currentRole === 'super_admin';
  const targetIsSuperAdmin = target.role === 'super_admin';
  if (targetIsSuperAdmin && !isSuperAdmin) {
    return { allowed: false, reason: 'Only Super Admin can modify Super Admin accounts.' };
  }
  return { allowed: true };
}

const USER_UPDATE_FIELDS = [
  'employeeId', 'employeeCode', 'firstName', 'middleName', 'lastName',
  'fullName', 'email', 'mobileNumber', 'alternateMobile', 'username',
  'profilePhoto', 'gender', 'dateOfBirth', 'department', 'designation', 'role',
  'reportingManager', 'managerId', 'businessUnit', 'siteId', 'siteName',
  'location', 'shift', 'employmentType', 'joiningDate', 'remarks',
  'userStatus', 'status', 'statusBeforeLock', 'accountLocked', 'isDeleted',
  'passwordResetRequired', 'twoFactorEnabled',
] as const;

const GENDER_VALUES = ['', 'Female', 'Male', 'Non-binary', 'Prefer not to say'] as const;
const EMPLOYMENT_VALUES = ['Permanent', 'Contract', 'Temporary', 'Consultant', 'Vendor', 'Intern'] as const;

function asText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function asDateInput(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const usDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDate) {
    const [, month, day, year] = usDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

function asLastLogin(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; code?: string };
  return (err.message || fallback)
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\(functions\/[\w-]+\)\.?$/i, '')
    .replace(/^internal\s*/i, '')
    .trim() || fallback;
}

function normalizeStatus(value: unknown, isDeleted?: boolean): AdminUser['userStatus'] {
  if (isDeleted) return 'Inactive';
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'locked') return 'Locked';
  if (normalized === 'suspended') return 'Suspended';
  if (normalized === 'inactive' || normalized === 'disabled') return 'Inactive';
  if (normalized === 'pending approval' || normalized === 'pending') return 'Pending Approval';
  return 'Active';
}

export function normalizeAdminUser(user: AdminUser): AdminUser {
  const legacy = user as AdminUser & Record<string, unknown>;
  const userStatus = normalizeStatus(user.userStatus || user.status, user.isDeleted ?? undefined);
  const gender = asText(user.gender);
  const employmentType = asText(user.employmentType);
  return {
    ...user,
    employeeId: asText(user.employeeId) || asText(legacy.employee_id) || user.userId || user.id || '',
    employeeCode: asText(user.employeeCode),
    firstName: asText(user.firstName),
    middleName: asText(user.middleName),
    lastName: asText(user.lastName),
    fullName: asText(user.fullName) || asText(legacy.full_name) || asText(user.email) || user.userId || 'Unnamed user',
    email: asText(user.email),
    mobileNumber: asText(user.mobileNumber) || asText(legacy.phone),
    alternateMobile: asText(user.alternateMobile),
    username: asText(user.username),
    profilePhoto: asText(user.profilePhoto) || asText(legacy.avatar_url),
    gender: (GENDER_VALUES as readonly string[]).includes(gender)
      ? gender as AdminUser['gender']
      : '',
    dateOfBirth: asDateInput(user.dateOfBirth),
    department: asText(user.department),
    designation: asText(user.designation),
    role: asText(user.role) || 'viewer',
    reportingManager: asText(user.reportingManager),
    managerId: asText(user.managerId),
    businessUnit: asText(user.businessUnit),
    siteId: asText(user.siteId),
    siteName: asText(user.siteName),
    location: asText(user.location),
    shift: asText(user.shift),
    employmentType: (EMPLOYMENT_VALUES as readonly string[]).includes(employmentType)
      ? employmentType as AdminUser['employmentType']
      : 'Permanent',
    joiningDate: asDateInput(user.joiningDate),
    remarks: asText(user.remarks),
    userStatus,
    status: userStatus === 'Active' ? 'Active' : 'Inactive',
    accountLocked: Boolean(user.accountLocked || userStatus === 'Locked'),
    passwordResetRequired: Boolean(user.passwordResetRequired),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    lastLogin: asLastLogin(user.lastLogin ?? legacy.last_login),
    emailVerified: Boolean(user.emailVerified),
    authUid: user.authUid || (legacy.full_name ? user.id : undefined),
  };
}

export async function fetchUsers(includeDeleted = false): Promise<AdminUser[]> {
  const records = await getAdminRecords<AdminUser>(ADMIN_COLLECTIONS.users);
  return records
    .map(normalizeAdminUser)
    .filter((user) => includeDeleted || !user.isDeleted);
}

export function subscribeToUsers(
  includeDeleted: boolean,
  onUsers: (users: AdminUser[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onUsers([]);
    return () => undefined;
  }
  const usersQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.users),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(usersQuery, (snapshot) => {
    const users = snapshot.docs
      .map((record) => normalizeAdminUser({ id: record.id, ...record.data() } as AdminUser))
      .filter((user) => includeDeleted || !user.isDeleted);
    onUsers(users);
  }, (error) => onError(error));
}

export async function fetchUserById(id: string, includeDeleted = false): Promise<AdminUser | null> {
  if (!isFirebaseConfigured() || !id) return null;
  const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.users, id));
  if (!snapshot.exists()) return null;
  const user = normalizeAdminUser({ id: snapshot.id, ...snapshot.data() } as AdminUser);
  return !includeDeleted && user.isDeleted ? null : user;
}

type UserMasterDepartment = {
  id?: string;
  departmentName: string;
  departmentCode: string;
  status?: string;
  isDeleted?: boolean;
};

type UserMasterDesignation = {
  id?: string;
  designationName: string;
  designationCode: string;
  department: string;
  status?: string;
  isDeleted?: boolean;
};

type UserMasterSite = {
  id?: string;
  companyName?: string;
  siteName: string;
  siteCode?: string;
  plantAddress?: string;
  city?: string;
  state?: string;
  country?: string;
  status?: string;
  isDeleted?: boolean;
};

function dedupeMasterRecords<T>(records: T[], keyFn: (record: T) => string): T[] {
  const seen = new Set<string>();
  return records.filter((record) => {
    const key = keyFn(record);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchUserMasters() {
  const [departmentsRaw, designationsRaw, roles, sitesRaw, usersRaw] = await Promise.all([
    getAdminRecords<UserMasterDepartment>(ADMIN_COLLECTIONS.departments).catch(() => []),
    getAdminRecords<UserMasterDesignation>(ADMIN_COLLECTIONS.designations).catch(() => []),
    getAdminRecords<{ roleName: string; roleId: string }>(ADMIN_COLLECTIONS.roles).catch(() => []),
    getAdminRecords<UserMasterSite>(ADMIN_COLLECTIONS.companySites).catch(() => []),
    getAdminRecords<AdminUser>(ADMIN_COLLECTIONS.users).catch(() => []),
  ]);

  const departments = dedupeMasterRecords(
    departmentsRaw.filter((d) => !d.isDeleted),
    (d) => d.departmentName || d.departmentCode,
  );
  const designations = dedupeMasterRecords(
    designationsRaw.filter((d) => !d.isDeleted),
    (d) => `${d.department}|${d.designationName || d.designationCode}`,
  );

  const sites = dedupeMasterRecords(
    sitesRaw.filter((site) => !site.isDeleted && (!site.status || site.status.toLowerCase() === 'active')),
    (site) => site.id || `${site.companyName || ''}|${site.siteName}`,
  );
  const managers = usersRaw
    .map(normalizeAdminUser)
    .filter((user) => !user.isDeleted && user.userStatus === 'Active')
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { departments, designations, roles, sites, managers };
}

export async function createSystemUser(
  data: AdminUser,
  temporaryPassword: string,
  meta: UserAuditMeta,
  accessOptions?: { modulePermissions?: PermissionMatrixData; presetId?: string },
): Promise<{ user: AdminUser | null; error: string | null }> {
  try {
    if (
      (accessOptions?.modulePermissions || accessOptions?.presetId)
      && meta.role !== 'super_admin'
    ) {
      return { user: null, error: 'Only a Super Admin can assign user-specific permissions' };
    }
    if (!await isDepartmentActiveForAssignment(data.department)) {
      return { user: null, error: 'Cannot assign user to an inactive department' };
    }

    if (data.designation && !await isDesignationActiveForAssignment(data.designation)) {
      return { user: null, error: 'Cannot assign user to an inactive designation' };
    }

    if (!isFirebaseConfigured()) {
      return { user: null, error: 'Firebase is not configured. Cannot create authentication account.' };
    }
    if (!temporaryPassword || temporaryPassword.length < 12) {
      return { user: null, error: 'Temporary password required (minimum 12 characters)' };
    }

    const createUser = httpsCallable<Record<string, unknown>, AdminUser>(
      getFirebaseFunctions(),
      'createAdminUser',
    );
    const response = await createUser({
      email: data.email,
      temporaryPassword,
      employeeId: data.employeeId,
      employeeCode: data.employeeCode,
      firstName: data.firstName,
      middleName: data.middleName,
      lastName: data.lastName,
      fullName: data.fullName,
      mobileNumber: data.mobileNumber,
      alternateMobile: data.alternateMobile,
      username: data.username,
      profilePhoto: data.profilePhoto,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth,
      department: data.department,
      designation: data.designation,
      role: data.role,
      reportingManager: data.reportingManager,
      managerId: data.managerId,
      businessUnit: data.businessUnit,
      siteId: data.siteId,
      siteName: data.siteName,
      location: data.location,
      shift: data.shift,
      employmentType: data.employmentType,
      userStatus: data.userStatus,
      accountLocked: data.accountLocked,
      twoFactorEnabled: data.twoFactorEnabled,
      joiningDate: data.joiningDate,
      remarks: data.remarks,
      ...(accessOptions?.modulePermissions !== undefined
        ? { modulePermissions: accessOptions.modulePermissions }
        : {}),
      ...(accessOptions?.presetId !== undefined ? { presetId: accessOptions.presetId } : {}),
    });
    const created = response.data;

    return { user: created, error: null };
  } catch (e) {
    const message = callableErrorMessage(e, 'Unable to create user');
    return { user: null, error: message };
  }
}

export async function updateSystemUser(
  id: string,
  updates: Partial<AdminUser>,
  existing: AdminUser,
  meta: UserAuditMeta,
  action = 'EDIT_USER',
  accessOptions?: { modulePermissions?: PermissionMatrixData; presetId?: string },
  changeReason = 'Administrator user update',
): Promise<{ user: AdminUser | null; error: string | null }> {
  try {
    if (
      (accessOptions?.modulePermissions || accessOptions?.presetId)
      && meta.role !== 'super_admin'
    ) {
      return { user: null, error: 'Only a Super Admin can change user-specific permissions' };
    }
    const incoming = updates;
    updates = USER_UPDATE_FIELDS.reduce<Partial<AdminUser>>((changed, key) => {
      if (!Object.prototype.hasOwnProperty.call(incoming, key)) return changed;
      const nextValue = incoming[key];
      const previousValue = existing[key];
      if (JSON.stringify(nextValue ?? '') !== JSON.stringify(previousValue ?? '')) {
        (changed as Record<string, unknown>)[key] = nextValue;
      }
      return changed;
    }, {});
    if (Object.keys(updates).length === 0 && !accessOptions?.modulePermissions && !accessOptions?.presetId) {
      return { user: existing, error: null };
    }

    if (updates.email && updates.email !== existing.email) {
      const unique = await checkUniqueField(ADMIN_COLLECTIONS.users, 'email', updates.email, id);
      if (!unique) return { user: null, error: 'Email already exists' };
    }

    if (updates.department && updates.department !== existing.department) {
      if (!await isDepartmentActiveForAssignment(updates.department)) {
        return { user: null, error: 'Cannot assign user to an inactive department' };
      }
    }

    if (updates.designation && updates.designation !== existing.designation) {
      if (!await isDesignationActiveForAssignment(updates.designation)) {
        return { user: null, error: 'Cannot assign user to an inactive designation' };
      }
    }

    if (!isFirebaseConfigured()) {
      return { user: null, error: 'Firebase is not configured. Cannot update authentication account.' };
    }
    const updateUser = httpsCallable<
      {
        userId: string;
        updates: Partial<AdminUser>;
        action: string;
        reason: string;
        modulePermissions?: PermissionMatrixData;
        presetId?: string;
      },
      AdminUser
    >(getFirebaseFunctions(), 'updateAdminUser');
    const requestPayload = {
      userId: id,
      updates,
      action,
      reason: changeReason,
      ...(accessOptions?.modulePermissions !== undefined
        ? { modulePermissions: accessOptions.modulePermissions }
        : {}),
      ...(accessOptions?.presetId !== undefined ? { presetId: accessOptions.presetId } : {}),
    };
    const result = await updateUser(requestPayload);
    const record = result.data;

    return { user: record, error: null };
  } catch (e) {
    return { user: null, error: callableErrorMessage(e, 'Unable to update user') };
  }
}

export async function setUserStatus(
  target: AdminUser,
  userStatus: AdminUser['userStatus'],
  meta: UserAuditMeta,
  currentRole: string,
  currentUid: string,
  reason = 'User status changed by administrator',
): Promise<{ success: boolean; error?: string }> {
  const check = canModifyTargetUser(currentRole, currentUid, target);
  if (!check.allowed) return { success: false, error: check.reason };

  if (!target.id) return { success: false, error: 'Invalid user' };

  const updates: Partial<AdminUser> = {
    userStatus,
    status: userStatus === 'Active' ? 'Active' : 'Inactive',
    accountLocked: userStatus === 'Locked',
  };

  const result = await updateSystemUser(
    target.id,
    updates,
    target,
    meta,
    userStatus === 'Active' ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
    undefined,
    reason,
  );
  return result.error ? { success: false, error: result.error } : { success: true };
}

export async function lockUser(
  target: AdminUser,
  locked: boolean,
  meta: UserAuditMeta,
  currentRole: string,
  currentUid: string,
  reason = 'Account lock state changed by administrator',
): Promise<{ success: boolean; error?: string }> {
  const check = canModifyTargetUser(currentRole, currentUid, target);
  if (!check.allowed) return { success: false, error: check.reason };
  if (!target.id) return { success: false, error: 'Invalid user' };

  const updates: Partial<AdminUser> = {
    accountLocked: locked,
    userStatus: locked
      ? 'Locked'
      : target.userStatus === 'Locked'
        ? target.statusBeforeLock || 'Inactive'
        : target.userStatus,
    statusBeforeLock: locked
      ? target.userStatus === 'Locked' ? target.statusBeforeLock : target.userStatus
      : target.statusBeforeLock,
  };

  const result = await updateSystemUser(
    target.id,
    updates,
    target,
    meta,
    locked ? 'LOCK_USER' : 'UNLOCK_USER',
    undefined,
    reason,
  );
  return result.error ? { success: false, error: result.error } : { success: true };
}

export async function restoreUser(
  target: AdminUser,
  meta: UserAuditMeta,
  currentRole: string,
  currentUid: string,
  reason = 'User restored by administrator',
): Promise<{ success: boolean; error?: string }> {
  const check = canModifyTargetUser(currentRole, currentUid, target);
  if (!check.allowed) return { success: false, error: check.reason };
  if (!target.id) return { success: false, error: 'Invalid user' };

  const result = await updateSystemUser(
    target.id,
    { userStatus: 'Inactive', status: 'Inactive', accountLocked: false, isDeleted: false },
    target,
    meta,
    'RESTORE_USER',
    undefined,
    reason,
  );
  return result.error ? { success: false, error: result.error } : { success: true };
}

export async function softDeleteUser(
  target: AdminUser,
  meta: UserAuditMeta,
  currentRole: string,
  currentUid: string,
  reason = 'User retired by administrator',
): Promise<{ success: boolean; error?: string }> {
  const check = canModifyTargetUser(currentRole, currentUid, target);
  if (!check.allowed) return { success: false, error: check.reason };
  if (!target.id) return { success: false, error: 'Invalid user' };

  const result = await updateSystemUser(
    target.id,
    { userStatus: 'Inactive', status: 'Inactive', isDeleted: true },
    target,
    meta,
    'RETIRE_USER',
    undefined,
    reason,
  );
  return result.error ? { success: false, error: result.error } : { success: true };
}

export async function resetUserPassword(
  target: AdminUser,
  meta: UserAuditMeta,
  currentRole: string,
  currentUid: string,
  reason = 'Password reset requested by administrator',
): Promise<{ success: boolean; error?: string }> {
  const check = canModifyTargetUser(currentRole, currentUid, target);
  if (!check.allowed) return { success: false, error: check.reason };
  if (!isFirebaseConfigured()) {
    return { success: false, error: 'Firebase is not configured' };
  }
  try {
    const updated = await updateSystemUser(
      target.id!,
      { passwordResetRequired: true },
      target,
      meta,
      'PASSWORD_RESET',
      undefined,
      reason,
    );
    if (updated.error) return { success: false, error: updated.error };
    await sendPasswordResetEmail(getFirebaseAuth(), target.email);
    return { success: true };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export async function fetchUserLoginActivity(userId: string, email: string) {
  if (!isFirebaseConfigured() || (!userId && !email)) return [];
  const db = getFirebaseFirestore();
  const byUser = userId
    ? await getDocs(query(
      collection(db, ADMIN_COLLECTIONS.loginActivity),
      where('userId', '==', userId),
      orderBy('loginTime', 'desc'),
      limit(20),
    ))
    : null;
  if (byUser && !byUser.empty) {
    return byUser.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
  }
  if (!email) return [];
  const byEmail = await getDocs(query(
    collection(db, ADMIN_COLLECTIONS.loginActivity),
    where('email', '==', email),
    orderBy('loginTime', 'desc'),
    limit(20),
  ));
  return byEmail.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }));
}

export async function fetchUserAuditTrail(recordId: string) {
  if (!isFirebaseConfigured() || !recordId) return [];
  const db = getFirebaseFirestore();
  const [trail, logs] = await Promise.all([
    getDocs(query(
      collection(db, ADMIN_COLLECTIONS.auditTrail),
      where('documentId', '==', recordId),
      orderBy('timestamp', 'desc'),
      limit(30),
    )),
    getDocs(query(
      collection(db, ADMIN_COLLECTIONS.auditLogs),
      where('recordId', '==', recordId),
      orderBy('dateTime', 'desc'),
      limit(30),
    )),
  ]);
  return [...trail.docs, ...logs.docs]
    .map((snapshot): Record<string, unknown> => ({ id: snapshot.id, ...snapshot.data() }))
    .sort((a, b) => String(b.timestamp ?? b.dateTime).localeCompare(String(a.timestamp ?? a.dateTime)))
    .slice(0, 30);
}

export function exportUsersCsv(users: AdminUser[]): string {
  const headers = ['User ID', 'Employee ID', 'Full Name', 'Email', 'Phone', 'Department', 'Designation', 'Role', 'Status', 'Last Login'];
  const rows = users.map((u) => [
    u.userId || u.id,
    u.employeeId,
    u.fullName,
    u.email,
    u.mobileNumber,
    u.department,
    u.designation,
    u.role,
    u.userStatus,
    u.lastLogin || '',
  ]);
  return [headers.join(','), ...rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
}
