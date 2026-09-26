import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { getAdminRecords, checkUniqueField } from './admin-service';
import { ADMIN_COLLECTIONS, SYSTEM_ROLE_IDS } from './constants';
import {
  buildDefaultRoleMatrix, canEditSuperAdminRole,
} from '@/lib/permissions';
import type { AdminRole, PermissionMatrix, RoleFormData } from './schemas';

export interface RoleAuditMeta {
  userId: string;
  userName: string;
  role?: string;
}

const SYSTEM_ROLE_SET = new Set<string>(SYSTEM_ROLE_IDS);

export function isSystemRoleId(roleId: string): boolean {
  return SYSTEM_ROLE_SET.has(roleId);
}

export function enforceSuperAdminMatrix(
  roleId: string,
  permissions: Record<string, Record<string, boolean>>,
): Record<string, Record<string, boolean>> {
  if (roleId !== 'super_admin') return permissions;
  return buildDefaultRoleMatrix('super_admin');
}

export function countPermissionChanges(
  oldPerms: Record<string, Record<string, boolean>>,
  newPerms: Record<string, Record<string, boolean>>,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  const allMods = new Set([...Object.keys(oldPerms), ...Object.keys(newPerms)]);
  allMods.forEach((mod) => {
    const oldM = oldPerms[mod] || {};
    const newM = newPerms[mod] || {};
    const actions = new Set([...Object.keys(oldM), ...Object.keys(newM)]);
    actions.forEach((a) => {
      if (!oldM[a] && newM[a]) added += 1;
      if (oldM[a] && !newM[a]) removed += 1;
    });
  });
  return { added, removed };
}

function normalizeRoleRecord(role: AdminRole): AdminRole {
  return {
    ...role,
    roleDescription: role.roleDescription || role.description || '',
    description: role.description || role.roleDescription || '',
    roleLevel: role.roleLevel ?? role.level ?? 10,
    level: role.level ?? role.roleLevel ?? 10,
    departmentAccess: role.departmentAccess || '',
    siteAccess: role.siteAccess || '',
    businessUnitAccess: role.businessUnitAccess || '',
    dataScope: role.dataScope || 'Organization Records',
    fieldPolicies: role.fieldPolicies || [],
    isSystemRole: Boolean(role.isSystemRole || isSystemRoleId(role.roleId)),
    isDeleted: Boolean(role.isDeleted),
  };
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string; code?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export async function fetchRoles(includeDeleted = false): Promise<AdminRole[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const records = await getAdminRecords<AdminRole>(ADMIN_COLLECTIONS.roles);
    return records
      .map(normalizeRoleRecord)
      .filter((role) => includeDeleted || !role.isDeleted);
  } catch (error) {
    console.error('fetchRoles failed:', error);
    throw new Error('Unable to load roles. Check your connection and permissions.');
  }
}

export function subscribeToRoles(
  includeDeleted: boolean,
  onData: (roles: AdminRole[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const rolesQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.roles),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    rolesQuery,
    (snapshot) => {
      const roles = snapshot.docs
        .map((document) => normalizeRoleRecord({ id: document.id, ...document.data() } as AdminRole))
        .filter((role) => includeDeleted || !role.isDeleted);
      onData(roles);
    },
    (error) => {
      console.error('subscribeToRoles failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to roles'));
    },
  );
}

export async function fetchRoleById(id: string, includeDeleted = false): Promise<AdminRole | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.roles, id));
    if (!snapshot.exists()) return null;
    const role = normalizeRoleRecord({ id: snapshot.id, ...snapshot.data() } as AdminRole);
    if (role.isDeleted && !includeDeleted) return null;
    return role;
  } catch (error) {
    console.error('fetchRoleById failed:', error);
    throw new Error('Unable to load role details.');
  }
}

export async function fetchRolePermissions(roleId: string): Promise<PermissionMatrix | null> {
  if (!isFirebaseConfigured() || !roleId) return null;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.permissions),
      where('roleId', '==', roleId),
      limit(10),
    ));
    const match = snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() } as PermissionMatrix))
      .find((record) => !record.isDeleted);
    return match ?? null;
  } catch (error) {
    console.error('fetchRolePermissions failed:', error);
    return null;
  }
}

export async function fetchRoleWithPermissions(id: string): Promise<{
  role: AdminRole | null;
  permissions: PermissionMatrix | null;
}> {
  const role = await fetchRoleById(id, true);
  if (!role) return { role: null, permissions: null };
  const permissions = await fetchRolePermissions(role.roleId);
  return { role, permissions };
}

export async function countUsersWithRole(roleId: string): Promise<number> {
  if (!isFirebaseConfigured() || !roleId) return 0;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.users),
      where('role', '==', roleId),
      limit(500),
    ));
    return snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
  } catch (error) {
    console.error('countUsersWithRole failed:', error);
    return 0;
  }
}

export function canModifyRole(
  currentRole: string,
  targetRoleId: string,
): { allowed: boolean; reason?: string } {
  if (targetRoleId === 'super_admin' && !canEditSuperAdminRole(currentRole)) {
    return { allowed: false, reason: 'Only Super Admin can modify the Super Admin role.' };
  }
  if (currentRole === 'admin' && ['super_admin', 'admin', 'it_administrator'].includes(targetRoleId)) {
    return { allowed: false, reason: 'Admin cannot modify privileged system administrator roles.' };
  }
  return { allowed: true };
}

export function canDeleteRole(
  currentRole: string,
  target: AdminRole,
): { allowed: boolean; reason?: string } {
  if (isSystemRoleId(target.roleId) || target.isSystemRole) {
    return { allowed: false, reason: 'System roles cannot be deleted. Deactivate or retire instead.' };
  }
  return canModifyRole(currentRole, target.roleId);
}

export async function createRole(
  data: RoleFormData,
  meta: RoleAuditMeta,
  currentRole: string,
): Promise<{ role: AdminRole | null; error: string | null }> {
  const check = canModifyRole(currentRole, data.roleId);
  if (!check.allowed) return { role: null, error: check.reason ?? 'Action not allowed' };
  if (currentRole === 'admin' && data.roleLevel >= 90) {
    return { role: null, error: 'Admin cannot create roles at administrator privilege level' };
  }

  try {
    const nameUnique = await checkUniqueField(ADMIN_COLLECTIONS.roles, 'roleName', data.roleName);
    if (!nameUnique) return { role: null, error: 'Role name already exists' };
    const idUnique = await checkUniqueField(ADMIN_COLLECTIONS.roles, 'roleId', data.roleId);
    if (!idUnique) return { role: null, error: 'Role ID already exists' };

    const createRoleFn = httpsCallable<Record<string, unknown>, AdminRole>(
      getFirebaseFunctions(),
      'createAdminRole',
    );
    const response = await createRoleFn({
      ...data,
      permissions: enforceSuperAdminMatrix(data.roleId, data.permissions),
      isSystemRole: isSystemRoleId(data.roleId),
      reason: data.changeReason,
    });
    return { role: normalizeRoleRecord(response.data), error: null };
  } catch (error) {
    return { role: null, error: callableErrorMessage(error, 'Unable to create role') };
  }
}

export async function updateRole(
  id: string,
  data: RoleFormData,
  existing: AdminRole,
  existingPerms: PermissionMatrix | null,
  meta: RoleAuditMeta,
  currentRole: string,
): Promise<{ role: AdminRole | null; error: string | null; affectedUsers: number }> {
  const check = canModifyRole(currentRole, existing.roleId);
  if (!check.allowed) return { role: null, error: check.reason ?? 'Action not allowed', affectedUsers: 0 };

  if (data.roleName !== existing.roleName) {
    const nameUnique = await checkUniqueField(ADMIN_COLLECTIONS.roles, 'roleName', data.roleName, id);
    if (!nameUnique) return { role: null, error: 'Role name already exists', affectedUsers: 0 };
  }

  try {
    const updateRoleFn = httpsCallable<
      {
        roleDocId: string;
        updates: Record<string, unknown>;
        permissions?: Record<string, Record<string, boolean>>;
        reason: string;
      },
      { role: AdminRole; affectedUsers: number }
    >(getFirebaseFunctions(), 'updateAdminRole');

    const permissions = enforceSuperAdminMatrix(existing.roleId, data.permissions);
    const response = await updateRoleFn({
      roleDocId: id,
      updates: {
        roleName: data.roleName,
        roleDescription: data.roleDescription,
        roleLevel: data.roleLevel,
        departmentAccess: data.departmentAccess,
        siteAccess: data.siteAccess,
        businessUnitAccess: data.businessUnitAccess,
        dataScope: data.dataScope,
        fieldPolicies: data.fieldPolicies,
        status: data.status,
      },
      permissions,
      reason: data.changeReason,
    });
    return {
      role: normalizeRoleRecord(response.data.role),
      error: null,
      affectedUsers: response.data.affectedUsers,
    };
  } catch (error) {
    return {
      role: null,
      error: callableErrorMessage(error, 'Unable to update role'),
      affectedUsers: 0,
    };
  }
}

export async function setRoleStatus(
  id: string,
  role: AdminRole,
  status: 'Active' | 'Inactive',
  meta: RoleAuditMeta,
  currentRole: string,
  reason = 'Role status change',
): Promise<{ success: boolean; error?: string }> {
  if (role.roleId === 'super_admin') {
    return { success: false, error: 'Super Admin role cannot be deactivated' };
  }
  const check = canModifyRole(currentRole, role.roleId);
  if (!check.allowed) return { success: false, error: check.reason ?? 'Action not allowed' };

  try {
    const setStatusFn = httpsCallable(
      getFirebaseFunctions(),
      'setAdminRoleStatus',
    );
    await setStatusFn({
      roleDocId: id,
      status,
      reason,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update role status') };
  }
}

export async function softDeleteRole(
  id: string,
  role: AdminRole,
  currentRole: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteRole(currentRole, role);
  if (!check.allowed) return { success: false, error: check.reason };

  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminRole');
    await deleteFn({ roleDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete role') };
  }
}

export async function restoreRole(
  id: string,
  currentRole: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  if (!['super_admin', 'admin'].includes(currentRole)) {
    return { success: false, error: 'Only administrators can restore roles' };
  }
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminRole');
    await restoreFn({ roleDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore role') };
  }
}

export async function cloneRole(
  sourceId: string,
  newRoleId: string,
  newRoleName: string,
  currentRole: string,
  reason: string,
): Promise<{ role: AdminRole | null; error: string | null }> {
  const check = canModifyRole(currentRole, newRoleId);
  if (!check.allowed) return { role: null, error: check.reason ?? 'Action not allowed' };
  try {
    const cloneFn = httpsCallable<
      Record<string, unknown>,
      AdminRole
    >(getFirebaseFunctions(), 'cloneAdminRole');
    const response = await cloneFn({
      sourceRoleDocId: sourceId,
      newRoleId,
      newRoleName,
      reason,
    });
    return { role: normalizeRoleRecord(response.data), error: null };
  } catch (error) {
    return { role: null, error: callableErrorMessage(error, 'Unable to clone role') };
  }
}

export async function bulkUpdateRoleStatus(
  roleIds: string[],
  status: 'Active' | 'Inactive',
  currentRole: string,
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminRoles');
    const response = await bulkFn({
      roleDocIds: roleIds,
      action: status === 'Active' ? 'activate' : 'deactivate',
      reason,
    });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function fetchRoleAuditTrail(recordId: string) {
  if (!isFirebaseConfigured() || !recordId) return [];
  try {
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
  } catch (error) {
    console.error('fetchRoleAuditTrail failed:', error);
    return [];
  }
}

export function exportRolesCsv(roles: AdminRole[]): string {
  const headers = [
    'Role ID', 'Role Name', 'Level', 'Department Access', 'Site Access',
    'Business Unit', 'Data Scope', 'System Role', 'Status',
  ];
  const rows = roles.map((r) => [
    r.roleId,
    r.roleName,
    r.roleLevel ?? r.level,
    r.departmentAccess || 'All',
    r.siteAccess || 'All',
    r.businessUnitAccess || 'All',
    r.dataScope || 'Organization Records',
    r.isSystemRole || isSystemRoleId(r.roleId) ? 'Yes' : 'No',
    r.status,
  ]);
  return [headers.join(','), ...rows.map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
}
