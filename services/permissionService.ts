import { query, where, getDocs, collection, limit } from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import {
  getRecords, createDocument, updateDocument, type DocumentActor,
} from '@/lib/firestore';
import { ADMIN_COLLECTIONS } from '@/lib/admin/constants';
import type { PermissionMatrix } from '@/lib/admin/schemas';
import {
  normalizeRole,
  type AppModule,
  type PermissionAction,
} from '@/lib/permissions';
import {
  getPresetMatrix, emptyPermissionMatrix, type PermissionMatrixData,
} from '@/lib/permission-presets';
export type { PermissionMatrixData } from '@/lib/permission-presets';
import { writeAuditTrail } from '@/lib/audit-trail';

export const USER_PERMISSIONS_COLLECTION = 'user_permissions';

export interface UserPermissionRecord {
  id?: string;
  userId: string;
  roleId: string;
  modulePermissions: PermissionMatrixData;
  customPermissions?: PermissionMatrixData;
  presetId?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  updatedBy?: string;
  isDeleted?: boolean;
  [key: string]: unknown;
}

/** Maps app route modules to permission matrix module names */
export const APP_MODULE_TO_MATRIX: Record<AppModule, string> = {
  admin: 'Admin',
  cpv: 'CPV',
  pqr: 'PQR',
  qms: 'Deviation',
  deviation: 'Deviation',
  oos: 'OOS',
  capa: 'CAPA',
  change_control: 'Change Control',
  risk: 'Risk Management',
  stability: 'Stability',
  complaints: 'Complaint',
  recall: 'Recall',
  dms: 'DMS',
  audit: 'Audit',
  vendors: 'Vendor',
  validation: 'Validation',
  csv: 'CSV',
  equipment: 'Equipment',
  monitoring: 'Monitoring',
  warehouse: 'Warehouse',
  ebmr: 'eBMR',
};

const ACTION_TO_MATRIX: Record<PermissionAction, string[]> = {
  view: ['View', 'Read Only'],
  create: ['Create'],
  edit: ['Edit'],
  delete: ['Delete'],
  review: ['Review'],
  approve: ['Approve'],
  reject: ['Reject'],
  export: ['Export', 'Print'],
  import: ['Import', 'import'],
  archive: ['Archive', 'Close'],
  eSign: ['Electronic Signature', 'eSign'],
};

function nowIso() {
  return new Date().toISOString();
}

function matrixHasAction(
  matrix: PermissionMatrixData | undefined | null,
  moduleKey: string,
  action: PermissionAction,
): boolean {
  if (!matrix) return false;
  const modPerms = matrix[moduleKey];
  if (!modPerms) return false;
  const aliases = ACTION_TO_MATRIX[action] || [action];
  return aliases.some((a) => modPerms[a] === true);
}

export function mergePermissionMatrices(
  ...matrices: (PermissionMatrixData | undefined | null)[]
): PermissionMatrixData {
  const result = emptyPermissionMatrix();
  for (const matrix of matrices) {
    if (!matrix) continue;
    for (const [mod, actions] of Object.entries(matrix)) {
      if (!result[mod]) result[mod] = {};
      for (const [action, allowed] of Object.entries(actions)) {
        if (allowed) result[mod][action] = true;
      }
    }
  }
  return result;
}

export async function getRolePermissions(roleId: string): Promise<PermissionMatrixData> {
  if (!isFirebaseConfigured()) {
    return emptyPermissionMatrix();
  }
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.permissions),
      where('roleId', '==', roleId),
      limit(5),
    ));
    const match = snap.docs
      .map((document) => ({ id: document.id, ...document.data() } as PermissionMatrix))
      .find((record) => !(record as { isDeleted?: boolean }).isDeleted);
    if (match?.permissions) return match.permissions;
  } catch (e) {
    console.error('getRolePermissions failed:', e);
  }
  return emptyPermissionMatrix();
}

export async function getUserPermissionRecord(userId: string): Promise<UserPermissionRecord | null> {
  if (!isFirebaseConfigured() || !userId) return null;
  try {
    const db = getFirebaseFirestore();
    const q = query(
      collection(db, USER_PERMISSIONS_COLLECTION),
      where('userId', '==', userId),
    );
    const snap = await getDocs(q);
    const docSnap = snap.docs.find((d) => !d.data().isDeleted);
    if (!docSnap) return null;
    return { id: docSnap.id, ...docSnap.data() } as UserPermissionRecord;
  } catch (e) {
    console.error('getUserPermissionRecord failed:', e);
    return null;
  }
}

export async function resolveUserPermissions(
  userId: string,
  roleId?: string | null,
): Promise<PermissionMatrixData> {
  const role = normalizeRole(roleId);
  if (role === 'super_admin') {
    return getPresetMatrix('super_admin');
  }

  const [userPerms, rolePerms] = await Promise.all([
    getUserPermissionRecord(userId),
    getRolePermissions(role),
  ]);

  if (userPerms?.customPermissions && Object.keys(userPerms.customPermissions).length > 0) {
    return mergePermissionMatrices(rolePerms, userPerms.customPermissions);
  }
  if (userPerms?.modulePermissions && hasAnyPermission(userPerms.modulePermissions)) {
    return mergePermissionMatrices(rolePerms, userPerms.modulePermissions);
  }
  if (userPerms?.presetId) {
    return mergePermissionMatrices(rolePerms, getPresetMatrix(userPerms.presetId));
  }
  return rolePerms;
}

function hasAnyPermission(matrix: PermissionMatrixData): boolean {
  return Object.values(matrix).some((mod) => Object.values(mod).some(Boolean));
}

export async function saveUserPermissions(
  userId: string,
  data: {
    roleId: string;
    modulePermissions?: PermissionMatrixData;
    customPermissions?: PermissionMatrixData;
    presetId?: string;
  },
  actor: DocumentActor,
): Promise<UserPermissionRecord | null> {
  if (!isFirebaseConfigured()) return null;

  const existing = await getUserPermissionRecord(userId);
  const payload: Omit<UserPermissionRecord, 'id'> = {
    userId,
    roleId: data.roleId,
    modulePermissions: data.modulePermissions || data.customPermissions || emptyPermissionMatrix(),
    customPermissions: data.customPermissions,
    presetId: data.presetId,
    updatedAt: nowIso(),
    updatedBy: actor.id || 'system',
    isDeleted: false,
  };

  try {
    const db = getFirebaseFirestore();
    let record: UserPermissionRecord;

    if (existing?.id) {
      await updateDocument(
        USER_PERMISSIONS_COLLECTION,
        existing.id,
        payload,
        { moduleName: 'User Management', actor },
      );
      record = { ...existing, ...payload, id: existing.id };
    } else {
      const created = await createDocument<UserPermissionRecord>(
        USER_PERMISSIONS_COLLECTION,
        { ...payload, createdAt: nowIso(), createdBy: actor.id || 'system' },
        { moduleName: 'User Management', actor },
      );
      record = created;
    }

    await writeAuditTrail({
      collectionName: USER_PERMISSIONS_COLLECTION,
      documentId: record.id || userId,
      action: 'PERMISSION_CHANGED',
      oldValue: existing,
      newValue: record,
      userId: actor.id || 'system',
      userName: actor.name || 'Admin',
      moduleName: 'User Management',
    });

    return record;
  } catch (e) {
    console.error('saveUserPermissions failed:', e);
    return null;
  }
}

export async function assignPresetToUser(
  userId: string,
  roleId: string,
  presetId: string,
  actor: DocumentActor,
): Promise<UserPermissionRecord | null> {
  const matrix = getPresetMatrix(presetId);
  return saveUserPermissions(userId, {
    roleId,
    modulePermissions: matrix,
    customPermissions: matrix,
    presetId,
  }, actor);
}

export function canAccessModuleFromMatrix(
  matrix: PermissionMatrixData | null | undefined,
  module: AppModule,
  role?: string | null,
): boolean {
  if (normalizeRole(role) === 'super_admin') return true;
  const matrixModule = APP_MODULE_TO_MATRIX[module];
  if (!matrixModule) return false;
  return matrixHasAction(matrix, matrixModule, 'view')
    || matrix?.[matrixModule]?.['Read Only'] === true;
}

export function canPerformActionFromMatrix(
  matrix: PermissionMatrixData | null | undefined,
  module: AppModule,
  action: PermissionAction,
  role?: string | null,
): boolean {
  if (normalizeRole(role) === 'super_admin') return true;
  const matrixModule = APP_MODULE_TO_MATRIX[module];
  if (!matrixModule) return false;
  return matrixHasAction(matrix, matrixModule, action);
}

export function canViewDashboard(matrix: PermissionMatrixData | null | undefined, role?: string | null): boolean {
  if (normalizeRole(role) === 'super_admin') return true;
  if (!matrix) return false;
  return Object.values(matrix).some((mod) =>
    Object.entries(mod).some(([action, allowed]) => allowed && ['View', 'Read Only'].includes(action)),
  );
}

export async function logAccessDenied(params: {
  userId: string;
  userName: string;
  module: string;
  path: string;
}) {
  await writeAuditTrail({
    collectionName: 'audit_trail',
    documentId: params.path,
    action: 'ACCESS_DENIED',
    oldValue: null,
    newValue: { module: params.module, path: params.path },
    userId: params.userId,
    userName: params.userName,
    moduleName: params.module,
  }).catch(() => undefined);
}

/** Sync user_permissions doc id lookup by auth uid */
export async function getUserPermissionsByAuthUid(authUid: string): Promise<PermissionMatrixData> {
  const userPerms = await getUserPermissionRecord(authUid);
  if (userPerms) {
    if (userPerms.customPermissions && hasAnyPermission(userPerms.customPermissions)) {
      return userPerms.customPermissions;
    }
    if (userPerms.modulePermissions && hasAnyPermission(userPerms.modulePermissions)) {
      return userPerms.modulePermissions;
    }
    if (userPerms.presetId) return getPresetMatrix(userPerms.presetId);
  }
  return emptyPermissionMatrix();
}
