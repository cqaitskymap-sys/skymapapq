import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { getAdminRecords } from './admin-service';
import {
  ADMIN_COLLECTIONS, DESIGNATION_LEVEL_APPROVAL_MAP, SYSTEM_DESIGNATION_CODES,
} from './constants';
import { fetchDepartments } from './department-service';
import type { AdminUser, Designation, DesignationFormData } from './schemas';

export interface DesignationAuditMeta {
  userId: string;
  userName: string;
  role?: string;
}

const SYSTEM_CODE_SET = new Set(SYSTEM_DESIGNATION_CODES.map((c) => c.toUpperCase()));

export function buildDesignationId(code: string): string {
  return `DESG-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function approvalLevelFromDesignationLevel(level: string): number {
  return DESIGNATION_LEVEL_APPROVAL_MAP[level] ?? 1;
}

export function isSystemDesignation(
  des: Pick<Designation, 'designationCode' | 'isSystemDesignation'>,
): boolean {
  return Boolean(des.isSystemDesignation)
    || SYSTEM_CODE_SET.has(String(des.designationCode || '').toUpperCase());
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

function normalizeDesignation(des: Designation): Designation {
  return {
    ...des,
    shortName: des.shortName || '',
    parentDesignationId: des.parentDesignationId || '',
    parentDesignationName: des.parentDesignationName || '',
    reportingLevel: des.reportingLevel || '',
    jobGrade: des.jobGrade || '',
    jobBand: des.jobBand || '',
    jobLevel: des.jobLevel || '',
    employmentCategory: des.employmentCategory || 'Permanent',
    minimumExperience: des.minimumExperience ?? 0,
    requiredQualification: des.requiredQualification || '',
    requiredSkills: des.requiredSkills || '',
    businessUnit: des.businessUnit || '',
    siteId: des.siteId || '',
    siteName: des.siteName || '',
    remarks: des.remarks || '',
    isSystemDesignation: isSystemDesignation(des),
    isDeleted: Boolean(des.isDeleted),
  };
}

export async function fetchDesignations(includeDeleted = false): Promise<Designation[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const records = await getAdminRecords<Designation>(ADMIN_COLLECTIONS.designations);
    return records
      .map(normalizeDesignation)
      .filter((d) => includeDeleted || !d.isDeleted);
  } catch (error) {
    console.error('fetchDesignations failed:', error);
    throw new Error('Unable to load designations. Check your connection and permissions.');
  }
}

export function subscribeToDesignations(
  includeDeleted: boolean,
  onData: (designations: Designation[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const designationsQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.designations),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    designationsQuery,
    (snapshot) => {
      const designations = snapshot.docs
        .map((document) => normalizeDesignation({ id: document.id, ...document.data() } as Designation))
        .filter((d) => includeDeleted || !d.isDeleted);
      onData(designations);
    },
    (error) => {
      console.error('subscribeToDesignations failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to designations'));
    },
  );
}

export async function fetchDesignationById(id: string, includeDeleted = false): Promise<Designation | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.designations, id));
    if (!snapshot.exists()) return null;
    const designation = normalizeDesignation({ id: snapshot.id, ...snapshot.data() } as Designation);
    if (designation.isDeleted && !includeDeleted) return null;
    return designation;
  } catch (error) {
    console.error('fetchDesignationById failed:', error);
    throw new Error('Unable to load designation details.');
  }
}

export async function fetchActiveDepartmentsForDesignation(): Promise<{
  departmentName: string;
  departmentCode: string;
}[]> {
  const departments = await fetchDepartments();
  const seen = new Set<string>();
  return departments
    .filter((d) => d.status === 'Active' && !d.isDeleted)
    .filter((d) => {
      if (seen.has(d.departmentName)) return false;
      seen.add(d.departmentName);
      return true;
    })
    .map((d) => ({ departmentName: d.departmentName, departmentCode: d.departmentCode }));
}

export async function isDepartmentActive(departmentName: string): Promise<boolean> {
  try {
    const departments = await fetchDepartments();
    const dept = departments.find(
      (d) => d.departmentName === departmentName || d.departmentCode === departmentName,
    );
    if (!dept) return false;
    return dept.status === 'Active' && !dept.isDeleted;
  } catch {
    return false;
  }
}

export function designationMatchesUser(des: Designation, userDesignation: string): boolean {
  if (!userDesignation) return false;
  return userDesignation === des.designationName
    || userDesignation === des.designationCode
    || userDesignation === des.designationId
    || userDesignation === des.shortName;
}

export async function countUsersWithDesignation(des: Designation): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.users),
      where('designation', '==', des.designationName),
      limit(500),
    ));
    const byName = snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
    if (byName > 0) return byName;
    const users = await getAdminRecords<AdminUser>(ADMIN_COLLECTIONS.users);
    return users.filter((u) => !u.isDeleted && designationMatchesUser(des, u.designation)).length;
  } catch (error) {
    console.error('countUsersWithDesignation failed:', error);
    return 0;
  }
}

export async function fetchUsersWithDesignation(des: Designation): Promise<AdminUser[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const users = await getAdminRecords<AdminUser>(ADMIN_COLLECTIONS.users);
    return users.filter((u) => !u.isDeleted && designationMatchesUser(des, u.designation));
  } catch (error) {
    console.error('fetchUsersWithDesignation failed:', error);
    return [];
  }
}

export async function countChildDesignations(desId: string): Promise<number> {
  if (!isFirebaseConfigured() || !desId) return 0;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.designations),
      where('parentDesignationId', '==', desId),
      limit(100),
    ));
    return snapshot.docs.filter((document) => document.data().isDeleted !== true).length;
  } catch {
    return 0;
  }
}

export async function isDesignationActiveForAssignment(designationName: string): Promise<boolean> {
  try {
    const items = await fetchDesignations();
    const match = items.find(
      (d) => d.designationName === designationName || d.designationCode === designationName,
    );
    if (!match) return true;
    return match.status === 'Active' && !match.isDeleted;
  } catch {
    return false;
  }
}

export function buildDesignationHierarchy(designations: Designation[]): Array<Designation & {
  depth: number;
  children: Designation[];
}> {
  const byId = new Map(designations.map((d) => [d.id!, d]));
  const childrenMap = new Map<string, Designation[]>();
  designations.forEach((d) => {
    const parentId = d.parentDesignationId || '';
    if (!parentId || !byId.has(parentId)) return;
    const list = childrenMap.get(parentId) || [];
    list.push(d);
    childrenMap.set(parentId, list);
  });

  const roots = designations.filter(
    (d) => !d.parentDesignationId || !byId.has(d.parentDesignationId),
  );
  const result: Array<Designation & { depth: number; children: Designation[] }> = [];

  const walk = (node: Designation, depth: number) => {
    const children = childrenMap.get(node.id!) || [];
    result.push({ ...node, depth, children });
    children
      .sort((a, b) => a.designationName.localeCompare(b.designationName))
      .forEach((child) => walk(child, depth + 1));
  };

  roots
    .sort((a, b) => a.designationName.localeCompare(b.designationName))
    .forEach((root) => walk(root, 0));

  return result;
}

export function canDeleteDesignationRecord(des: Designation): { allowed: boolean; reason?: string } {
  if (isSystemDesignation(des)) {
    return { allowed: false, reason: 'System designations cannot be deleted. Deactivate instead.' };
  }
  return { allowed: true };
}

export async function createDesignation(
  data: DesignationFormData,
  _meta: DesignationAuditMeta,
): Promise<{ designation: Designation | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, Designation>(
      getFirebaseFunctions(),
      'createAdminDesignation',
    );
    const response = await createFn({ ...data, reason: data.changeReason });
    return { designation: normalizeDesignation(response.data), error: null };
  } catch (error) {
    return { designation: null, error: callableErrorMessage(error, 'Unable to create designation') };
  }
}

export async function updateDesignation(
  id: string,
  data: DesignationFormData,
  _existing: Designation,
  _meta: DesignationAuditMeta,
): Promise<{ designation: Designation | null; error: string | null; cascadeCount?: number }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { designation: Designation; cascadeCount: number }
    >(getFirebaseFunctions(), 'updateAdminDesignation');
    const response = await updateFn({
      designationDocId: id,
      updates: data,
      reason: data.changeReason,
    });
    return {
      designation: normalizeDesignation(response.data.designation),
      error: null,
      cascadeCount: response.data.cascadeCount,
    };
  } catch (error) {
    return {
      designation: null,
      error: callableErrorMessage(error, 'Unable to update designation'),
    };
  }
}

export async function setDesignationStatus(
  id: string,
  _des: Designation,
  status: 'Active' | 'Inactive',
  _meta: DesignationAuditMeta,
  reason = 'Designation status change',
): Promise<{ success: boolean; error?: string; linkedUsers?: number }> {
  try {
    const setStatusFn = httpsCallable<
      Record<string, unknown>,
      { success: boolean; linkedUsers: number }
    >(getFirebaseFunctions(), 'setAdminDesignationStatus');
    const response = await setStatusFn({ designationDocId: id, status, reason });
    return { success: true, linkedUsers: response.data.linkedUsers };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update designation status') };
  }
}

export async function deleteDesignation(
  id: string,
  des: Designation,
  _meta: DesignationAuditMeta,
  reason = 'Designation soft delete',
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteDesignationRecord(des);
  if (!check.allowed) return { success: false, error: check.reason };

  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminDesignation');
    await deleteFn({ designationDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete designation') };
  }
}

export async function restoreDesignation(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminDesignation');
    await restoreFn({ designationDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore designation') };
  }
}

export async function bulkUpdateDesignations(
  designationIds: string[],
  action: 'activate' | 'deactivate',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminDesignations');
    const response = await bulkFn({ designationDocIds: designationIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function importDesignations(
  rows: Array<Record<string, string>>,
  reason: string,
): Promise<{ successCount: number; errorCount: number; errors: string[]; error?: string }> {
  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errorCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminDesignations');
    const response = await importFn({ rows: rows.slice(0, 100), reason });
    return response.data;
  } catch (error) {
    return {
      successCount: 0,
      errorCount: rows.length,
      errors: [callableErrorMessage(error, 'Import failed')],
      error: callableErrorMessage(error, 'Import failed'),
    };
  }
}

export async function fetchDesignationAuditTrail(recordId: string) {
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
    console.error('fetchDesignationAuditTrail failed:', error);
    return [];
  }
}

export function exportDesignationsCsv(designations: Designation[]): string {
  const headers = [
    'Designation ID', 'Code', 'Name', 'Short Name', 'Department', 'Parent', 'Level',
    'Reporting Level', 'Job Grade', 'Job Band', 'Job Level', 'Employment Category',
    'Min Experience', 'Qualification', 'Skills', 'Business Unit', 'Site',
    'Approval Authority', 'Can Review', 'Can Approve', 'Can E-Sign', 'Status', 'System',
    'Description', 'Remarks',
  ];
  const rows = designations.map((d) => [
    d.designationId, d.designationCode, d.designationName, d.shortName, d.department,
    d.parentDesignationName || '', d.designationLevel, d.reportingLevel, d.jobGrade,
    d.jobBand, d.jobLevel, d.employmentCategory, d.minimumExperience,
    d.requiredQualification, d.requiredSkills, d.businessUnit, d.siteName,
    d.approvalAuthority, d.canReview, d.canApprove, d.canESign, d.status,
    isSystemDesignation(d) ? 'Yes' : 'No', d.description, d.remarks,
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export async function logDesignationExport(_meta: DesignationAuditMeta, count: number) {
  try {
    const exportFn = httpsCallable(getFirebaseFunctions(), 'logAdminDesignationExport');
    await exportFn({ count, reason: 'Designation list export' });
  } catch (error) {
    console.error('logDesignationExport failed:', error);
  }
}

export function parseDesignationImportCsv(csvText: string): Array<Record<string, string>> {
  const lines = csvText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim()) || [];
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cols[index] || '';
    });
    return {
      designationCode: row.code || row['designation code'] || row.designationcode || '',
      designationName: row.name || row['designation name'] || row.designationname || '',
      department: row.department || '',
      designationLevel: row.level || row['designation level'] || row.designationlevel || 'Executive',
      shortName: row['short name'] || row.shortname || '',
      description: row.description || '',
      jobGrade: row['job grade'] || row.jobgrade || '',
      jobBand: row['job band'] || row.jobband || '',
      employmentCategory: row['employment category'] || row.employmentcategory || 'Permanent',
    };
  }).filter((row) => row.designationCode && row.designationName && row.department);
}
