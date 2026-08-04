import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { getAdminRecords } from './admin-service';
import { ADMIN_COLLECTIONS, SYSTEM_DEPARTMENT_CODES } from './constants';
import type { AdminUser, Department, DepartmentFormData } from './schemas';

export interface DepartmentAuditMeta {
  userId: string;
  userName: string;
  role?: string;
}

const SYSTEM_CODE_SET = new Set(SYSTEM_DEPARTMENT_CODES.map((c) => c.toUpperCase()));

export function buildDepartmentId(code: string): string {
  return `DEPT-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function isSystemDepartment(dept: Pick<Department, 'departmentCode' | 'isSystemDepartment'>): boolean {
  return Boolean(dept.isSystemDepartment) || SYSTEM_CODE_SET.has(String(dept.departmentCode || '').toUpperCase());
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

function normalizeDepartment(dept: Department): Department {
  return {
    ...dept,
    shortName: dept.shortName || '',
    parentDepartmentId: dept.parentDepartmentId || '',
    parentDepartmentName: dept.parentDepartmentName || '',
    departmentHeadId: dept.departmentHeadId || '',
    manager: dept.manager || '',
    managerId: dept.managerId || '',
    email: dept.email || dept.hodEmail || '',
    phone: dept.phone || '',
    extension: dept.extension || '',
    businessUnit: dept.businessUnit || '',
    siteId: dept.siteId || '',
    location: dept.location || dept.siteLocation || '',
    costCenter: dept.costCenter || '',
    remarks: dept.remarks || '',
    isSystemDepartment: isSystemDepartment(dept),
    isDeleted: Boolean(dept.isDeleted),
  };
}

export async function fetchDepartments(includeDeleted = false): Promise<Department[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const records = await getAdminRecords<Department>(ADMIN_COLLECTIONS.departments);
    return records
      .map(normalizeDepartment)
      .filter((d) => includeDeleted || !d.isDeleted);
  } catch (error) {
    console.error('fetchDepartments failed:', error);
    throw new Error('Unable to load departments. Check your connection and permissions.');
  }
}

export function subscribeToDepartments(
  includeDeleted: boolean,
  onData: (departments: Department[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const departmentsQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.departments),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    departmentsQuery,
    (snapshot) => {
      const departments = snapshot.docs
        .map((document) => normalizeDepartment({ id: document.id, ...document.data() } as Department))
        .filter((d) => includeDeleted || !d.isDeleted);
      onData(departments);
    },
    (error) => {
      console.error('subscribeToDepartments failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to departments'));
    },
  );
}

export async function fetchDepartmentById(id: string, includeDeleted = false): Promise<Department | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.departments, id));
    if (!snapshot.exists()) return null;
    const department = normalizeDepartment({ id: snapshot.id, ...snapshot.data() } as Department);
    if (department.isDeleted && !includeDeleted) return null;
    return department;
  } catch (error) {
    console.error('fetchDepartmentById failed:', error);
    throw new Error('Unable to load department details.');
  }
}

export async function fetchActiveUsers(): Promise<AdminUser[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const users = await getAdminRecords<AdminUser>(ADMIN_COLLECTIONS.users);
    return users.filter((u) => !u.isDeleted && String(u.userStatus || u.status) === 'Active');
  } catch (error) {
    console.error('fetchActiveUsers failed:', error);
    return [];
  }
}

export async function fetchCompanySites(): Promise<{
  id?: string;
  siteName: string;
  companyName?: string;
}[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    return await getAdminRecords<{ id?: string; siteName: string; companyName?: string }>(
      ADMIN_COLLECTIONS.companySites,
    );
  } catch (error) {
    console.error('fetchCompanySites failed:', error);
    return [];
  }
}

export function departmentMatchesUser(dept: Department, userDept: string): boolean {
  if (!userDept) return false;
  return userDept === dept.departmentName
    || userDept === dept.departmentCode
    || userDept === dept.departmentId
    || userDept === dept.shortName;
}

export async function countUsersInDepartment(dept: Department): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.users),
      where('department', '==', dept.departmentName),
      limit(500),
    ));
    const byName = snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
    if (byName > 0) return byName;
    const users = await getAdminRecords<AdminUser>(ADMIN_COLLECTIONS.users);
    return users.filter((u) => !u.isDeleted && departmentMatchesUser(dept, u.department)).length;
  } catch (error) {
    console.error('countUsersInDepartment failed:', error);
    return 0;
  }
}

export async function fetchUsersInDepartment(dept: Department): Promise<AdminUser[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const users = await getAdminRecords<AdminUser>(ADMIN_COLLECTIONS.users);
    return users.filter((u) => !u.isDeleted && departmentMatchesUser(dept, u.department));
  } catch (error) {
    console.error('fetchUsersInDepartment failed:', error);
    return [];
  }
}

export async function countChildDepartments(deptId: string): Promise<number> {
  if (!isFirebaseConfigured() || !deptId) return 0;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.departments),
      where('parentDepartmentId', '==', deptId),
      limit(100),
    ));
    return snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
  } catch {
    return 0;
  }
}

export async function isDepartmentActiveForAssignment(departmentName: string): Promise<boolean> {
  try {
    const departments = await fetchDepartments();
    const dept = departments.find(
      (d) => d.departmentName === departmentName || d.departmentCode === departmentName,
    );
    if (!dept) return true;
    return dept.status === 'Active' && !dept.isDeleted;
  } catch {
    return false;
  }
}

export function validateDepartmentHead(
  headName: string,
  activeUsers: AdminUser[],
  headId?: string,
): { valid: boolean; email?: string; userId?: string; error?: string } {
  if (!headName && !headId) {
    return { valid: false, error: 'Department head must be selected from active users' };
  }
  const user = activeUsers.find(
    (u) => u.id === headId
      || u.userId === headId
      || u.fullName === headName
      || u.id === headName
      || u.userId === headName,
  );
  if (!user) return { valid: false, error: 'Department head must be an active user' };
  return { valid: true, email: user.email, userId: user.id || user.authUid };
}

export function buildDepartmentHierarchy(departments: Department[]): Array<Department & {
  depth: number;
  children: Department[];
}> {
  const byId = new Map(departments.map((d) => [d.id!, d]));
  const childrenMap = new Map<string, Department[]>();
  departments.forEach((d) => {
    const parentId = d.parentDepartmentId || '';
    if (!parentId || !byId.has(parentId)) return;
    const list = childrenMap.get(parentId) || [];
    list.push(d);
    childrenMap.set(parentId, list);
  });

  const roots = departments.filter((d) => !d.parentDepartmentId || !byId.has(d.parentDepartmentId));
  const result: Array<Department & { depth: number; children: Department[] }> = [];

  const walk = (node: Department, depth: number) => {
    const children = childrenMap.get(node.id!) || [];
    result.push({ ...node, depth, children });
    children
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName))
      .forEach((child) => walk(child, depth + 1));
  };

  roots
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName))
    .forEach((root) => walk(root, 0));

  return result;
}

export function canDeleteDepartmentRecord(dept: Department): { allowed: boolean; reason?: string } {
  if (isSystemDepartment(dept)) {
    return { allowed: false, reason: 'System departments cannot be deleted. Deactivate instead.' };
  }
  return { allowed: true };
}

export async function createDepartment(
  data: DepartmentFormData,
  _meta: DepartmentAuditMeta,
): Promise<{ department: Department | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, Department>(
      getFirebaseFunctions(),
      'createAdminDepartment',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason,
    });
    return { department: normalizeDepartment(response.data), error: null };
  } catch (error) {
    return { department: null, error: callableErrorMessage(error, 'Unable to create department') };
  }
}

export async function updateDepartment(
  id: string,
  data: DepartmentFormData,
  _existing: Department,
  _meta: DepartmentAuditMeta,
): Promise<{ department: Department | null; error: string | null; cascadeCount?: number }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { department: Department; cascadeCount: number }
    >(getFirebaseFunctions(), 'updateAdminDepartment');
    const response = await updateFn({
      departmentDocId: id,
      updates: data,
      reason: data.changeReason,
    });
    return {
      department: normalizeDepartment(response.data.department),
      error: null,
      cascadeCount: response.data.cascadeCount,
    };
  } catch (error) {
    return {
      department: null,
      error: callableErrorMessage(error, 'Unable to update department'),
    };
  }
}

export async function setDepartmentStatus(
  id: string,
  _dept: Department,
  status: 'Active' | 'Inactive',
  _meta: DepartmentAuditMeta,
  reason = 'Department status change',
): Promise<{ success: boolean; error?: string; linkedUsers?: number }> {
  try {
    const setStatusFn = httpsCallable<
      Record<string, unknown>,
      { success: boolean; linkedUsers: number }
    >(getFirebaseFunctions(), 'setAdminDepartmentStatus');
    const response = await setStatusFn({
      departmentDocId: id,
      status,
      reason,
    });
    return { success: true, linkedUsers: response.data.linkedUsers };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update department status') };
  }
}

export async function deleteDepartment(
  id: string,
  dept: Department,
  _meta: DepartmentAuditMeta,
  reason = 'Department soft delete',
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteDepartmentRecord(dept);
  if (!check.allowed) return { success: false, error: check.reason };

  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminDepartment');
    await deleteFn({ departmentDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete department') };
  }
}

export async function restoreDepartment(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminDepartment');
    await restoreFn({ departmentDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore department') };
  }
}

export async function bulkUpdateDepartments(
  departmentIds: string[],
  action: 'activate' | 'deactivate',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminDepartments');
    const response = await bulkFn({ departmentDocIds: departmentIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function linkUsersToDepartment(
  dept: Department,
  userIds: string[],
  _meta: DepartmentAuditMeta,
  reason = 'Link users to department',
): Promise<{ success: boolean; error?: string; count?: number }> {
  if (dept.status !== 'Active') {
    return { success: false, error: 'Cannot assign users to an inactive department' };
  }
  try {
    const linkFn = httpsCallable<
      Record<string, unknown>,
      { count: number }
    >(getFirebaseFunctions(), 'linkUsersToAdminDepartment');
    const response = await linkFn({
      departmentDocId: dept.id,
      userIds,
      reason,
    });
    return { success: true, count: response.data.count };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Failed to link users') };
  }
}

export async function fetchDepartmentAuditTrail(recordId: string) {
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
    console.error('fetchDepartmentAuditTrail failed:', error);
    return [];
  }
}

export function exportDepartmentsCsv(departments: Department[]): string {
  const headers = [
    'Department ID', 'Code', 'Name', 'Short Name', 'Type', 'Parent', 'Head', 'Manager',
    'HOD Email', 'Email', 'Phone', 'Extension', 'Business Unit', 'Site', 'Location',
    'Cost Center', 'Status', 'System', 'Description', 'Remarks',
  ];
  const rows = departments.map((d) => [
    d.departmentId, d.departmentCode, d.departmentName, d.shortName, d.departmentType,
    d.parentDepartmentName || '', d.departmentHead, d.manager, d.hodEmail, d.email,
    d.phone, d.extension, d.businessUnit, d.siteLocation, d.location, d.costCenter,
    d.status, isSystemDepartment(d) ? 'Yes' : 'No', d.description, d.remarks,
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export async function logDepartmentExport(_meta: DepartmentAuditMeta, count: number) {
  try {
    const exportFn = httpsCallable(getFirebaseFunctions(), 'logAdminDepartmentExport');
    await exportFn({ count, reason: 'Department list export' });
  } catch (error) {
    console.error('logDepartmentExport failed:', error);
  }
}
