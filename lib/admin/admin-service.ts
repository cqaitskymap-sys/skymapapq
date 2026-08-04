import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, writeBatch, QueryConstraint,
} from 'firebase/firestore';
import { getFirebaseFirestore, getFirebaseAuth, isFirebaseConfigured } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from './constants';
import { createRecord, getRecords, getRecord, updateRecord, deleteRecord } from '@/lib/firestore-service';
import type { AdminAuditLog } from './schemas';

export async function logAuditEvent(
  event: Omit<AdminAuditLog, 'id' | 'dateTime'> & { status?: string },
  userId?: string
): Promise<void> {
  try {
    const { createAuditLog } = await import('@/lib/audit-trail');
    await createAuditLog({
      moduleName: event.module || 'Admin',
      collectionName: ADMIN_COLLECTIONS.auditLogs,
      recordId: event.recordId || 'system',
      actionType: event.action || 'Update',
      actionDescription: String(event.action || 'Audit event'),
      oldValue: event.oldValue,
      newValue: event.newValue,
      reason: event.reason,
      user: {
        id: event.userId || userId || 'system',
        name: event.userName || 'System',
      },
      ipAddress: event.ipAddress || 'client',
      deviceInfo: event.device || 'browser',
      status: (event.status as 'Success' | 'Failed' | 'Pending' | 'System Generated') || 'Success',
    });
  } catch (error) {
    console.error('AUDIT_FAILURE: logAuditEvent failed:', error);
  }
}

export async function checkUniqueField(
  collectionName: string,
  field: string,
  value: string,
  excludeId?: string
): Promise<boolean> {
  const q = query(collection(getFirebaseFirestore(), collectionName), where(field, '==', value));
  const snap = await getDocs(q);
  if (snap.empty) return true;
  if (excludeId) {
    return snap.docs.every((d) => d.id === excludeId);
  }
  return false;
}

export async function getAdminRecords<T extends Record<string, unknown>>(
  collectionName: string,
  constraints: QueryConstraint[] = []
): Promise<T[]> {
  return getRecords<T>(collectionName, [orderBy('createdAt', 'desc'), ...constraints]);
}

export async function createAdminRecord<T extends Record<string, unknown>>(
  collectionName: string,
  data: Omit<T, 'id'>,
  auditMeta: { userId: string; userName: string; module: string; action?: string }
): Promise<T> {
  const record = await createRecord<T>(
    collectionName,
    { ...data, createdBy: auditMeta.userId, updatedBy: auditMeta.userId } as Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'isDeleted'>,
    {
      moduleName: auditMeta.module,
      actor: { id: auditMeta.userId, name: auditMeta.userName },
    },
  );

  await logAuditEvent({
    userId: auditMeta.userId,
    userName: auditMeta.userName,
    module: auditMeta.module,
    recordId: (record as { id?: string }).id || '',
    action: auditMeta.action || 'CREATE',
    oldValue: '',
    newValue: JSON.stringify(data),
    reason: '',
    ipAddress: typeof window !== 'undefined' ? 'client' : 'server',
    device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
    status: 'Success',
  });

  return record;
}

export async function updateAdminRecord<T extends Record<string, unknown>>(
  collectionName: string,
  recordId: string,
  updates: Partial<T>,
  auditMeta: { userId: string; userName: string; module: string; oldValue?: string }
): Promise<T | null> {
  const existing = await getRecord<T>(collectionName, recordId);
  const record = await updateRecord<T>(
    collectionName,
    recordId,
    { ...updates, updatedBy: auditMeta.userId },
    {
      moduleName: auditMeta.module,
      actor: { id: auditMeta.userId, name: auditMeta.userName },
    },
  );

  if (record) {
    await logAuditEvent({
      userId: auditMeta.userId,
      userName: auditMeta.userName,
      module: auditMeta.module,
      recordId,
      action: 'UPDATE',
      oldValue: auditMeta.oldValue || JSON.stringify(existing),
      newValue: JSON.stringify(updates),
      reason: '',
      ipAddress: 'client',
      device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
      status: 'Success',
    });
  }

  return record;
}

export async function deleteAdminRecord(
  collectionName: string,
  recordId: string,
  auditMeta: { userId: string; userName: string; module: string }
): Promise<boolean> {
  const existing = await getRecord(collectionName, recordId);
  const success = await deleteRecord(collectionName, recordId, {
    moduleName: auditMeta.module,
    actor: { id: auditMeta.userId, name: auditMeta.userName },
  });

  if (success) {
    await logAuditEvent({
      userId: auditMeta.userId,
      userName: auditMeta.userName,
      module: auditMeta.module,
      recordId,
      action: 'DELETE',
      oldValue: JSON.stringify(existing),
      newValue: JSON.stringify({ isDeleted: true }),
      reason: 'Soft delete',
      ipAddress: 'client',
      device: typeof navigator !== 'undefined' ? navigator.userAgent : 'server',
      status: 'Success',
    });
  }

  return success;
}

export async function checkFirebaseConnection(): Promise<{
  configured: boolean;
  connected: boolean;
  projectId: string;
  latencyMs: number;
  error?: string;
}> {
  const configured = isFirebaseConfigured();
  if (!configured) {
    return { configured: false, connected: false, projectId: '', latencyMs: 0, error: 'Not configured' };
  }
  const start = Date.now();
  try {
    await getDocs(query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.systemSettings), limit(1)));
    return {
      configured: true,
      connected: true,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      latencyMs: Date.now() - start,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

export async function getSystemHealthCheck() {
  const checks: { name: string; status: 'Healthy' | 'Degraded' | 'Down'; detail: string }[] = [];
  const firebase = await checkFirebaseConnection();
  checks.push({
    name: 'Firebase Connection',
    status: firebase.connected ? 'Healthy' : firebase.configured ? 'Degraded' : 'Down',
    detail: firebase.connected
      ? `Connected (${firebase.latencyMs}ms)`
      : firebase.error || 'Not configured',
  });

  try {
    const settingsSnap = await getDocs(query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.systemSettings), limit(1)));
    checks.push({
      name: 'System Settings',
      status: settingsSnap.empty ? 'Degraded' : 'Healthy',
      detail: settingsSnap.empty ? 'No settings configured' : 'Settings loaded',
    });
  } catch {
    checks.push({ name: 'System Settings', status: 'Down', detail: 'Cannot read settings' });
  }

  try {
    const backupSnap = await getDocs(
      query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupRestore), orderBy('backupDateTime', 'desc'), limit(1))
    );
    const lastBackup = backupSnap.docs[0]?.data();
    const lastBackupDate = lastBackup?.backupDateTime ?? lastBackup?.backupDate;
    const backupAge = lastBackupDate
      ? Math.floor((Date.now() - new Date(lastBackupDate).getTime()) / 86400000)
      : null;
    checks.push({
      name: 'Backup Status',
      status: backupAge === null ? 'Degraded' : backupAge > 7 ? 'Degraded' : 'Healthy',
      detail: backupAge === null ? 'No backups found' : `Last backup ${backupAge} day(s) ago`,
    });
  } catch {
    checks.push({ name: 'Backup Status', status: 'Degraded', detail: 'Cannot read backup log' });
  }

  const overall = checks.some((c) => c.status === 'Down')
    ? 'Down'
    : checks.some((c) => c.status === 'Degraded')
      ? 'Degraded'
      : 'Healthy';

  return { overall, checks, checkedAt: new Date().toISOString() };
}

export async function getDashboardStats() {
  const safeGet = async (c: string) =>
    getDocs(collection(getFirebaseFirestore(), c)).catch(() => ({ size: 0, docs: [] as { data: () => Record<string, unknown> }[] }));

  const [users, auditLogs, auditTrail, loginActivity, backups, deviations, capa, oos, pqr, cpv] = await Promise.all([
    safeGet(ADMIN_COLLECTIONS.users),
    safeGet(ADMIN_COLLECTIONS.auditLogs),
    safeGet(ADMIN_COLLECTIONS.auditTrail),
    safeGet(ADMIN_COLLECTIONS.loginActivity),
    safeGet(ADMIN_COLLECTIONS.backupRestore),
    safeGet('deviations'),
    safeGet('capa_records'),
    safeGet('oos_records'),
    safeGet('pqr_records'),
    safeGet('cpv_reviews'),
  ]);

  const userDocs = users.docs?.map((d) => d.data()) || [];
  const activeUsers = userDocs.filter((u) => u.userStatus === 'Active' || u.status === 'Active').length;
  const inactiveUsers = userDocs.filter((u) => u.userStatus === 'Inactive' || u.status === 'Inactive').length;
  const pendingApprovals = userDocs.filter((u) => u.userStatus === 'Pending Approval').length;

  const loginDocs = loginActivity.docs?.map((d) => d.data()) || [];
  const failedLoginAttempts = loginDocs.filter((l) => l.loginStatus === 'Failed').length;

  const backupDocs = backups.docs?.map((d) => d.data()) || [];
  const lastBackup = backupDocs.sort((a, b) =>
    String(b.backupDateTime || b.backupDate || '').localeCompare(
      String(a.backupDateTime || a.backupDate || ''),
    )
  )[0];

  const firebase = await checkFirebaseConnection();
  const health = await getSystemHealthCheck();

  const openDeviations = deviations.docs?.filter((d) => d.data().status !== 'Closed').length || 0;
  const openCapa = capa.docs?.filter((d) => d.data().status !== 'Closed').length || 0;
  const openOos = oos.docs?.filter((d) => d.data().status !== 'Closed').length || 0;
  const pendingPqr = pqr.docs?.filter((d) => d.data().status === 'Pending').length || 0;
  const pendingCpvReview = cpv.docs?.filter((d) => d.data().status === 'Pending').length || 0;

  const auditTrailCount = (auditLogs.size || 0) + (auditTrail.size || 0);

  return {
    totalUsers: userDocs.length,
    activeUsers,
    inactiveUsers,
    pendingApprovals,
    failedLoginAttempts,
    openAuditLogs: auditTrailCount,
    systemHealth: health.overall,
    firebaseStatus: firebase.connected ? 'Connected' : firebase.configured ? 'Degraded' : 'Not Configured',
    backupStatus: lastBackup
      ? `${lastBackup.backupStatus || 'Success'} — ${new Date(String(lastBackup.backupDateTime || lastBackup.backupDate)).toLocaleDateString()}`
      : 'No backups',
    totalDepartments: 0,
    totalProducts: 0,
    openDeviations,
    openCapa,
    openOos,
    pendingPqr,
    pendingCpvReview,
    auditTrailCount,
    firebaseLatencyMs: firebase.latencyMs,
  };
}

export async function getLoginActivity(limitCount = 200) {
  return getRecords<Record<string, unknown>>(
    ADMIN_COLLECTIONS.loginActivity,
    [orderBy('loginTime', 'desc'), limit(limitCount)]
  );
}

export async function getRecentAdminActivities(limitCount = 10) {
  const [adminLogs, trailLogs] = await Promise.all([
    getAuditLogs(),
    getRecords<Record<string, unknown>>(
      ADMIN_COLLECTIONS.auditTrail,
      [orderBy('timestamp', 'desc'), limit(limitCount)]
    ),
  ]);

  const normalized = [
    ...adminLogs.map((l) => ({
      id: l.id,
      dateTime: l.dateTime,
      userName: l.userName,
      module: l.module,
      action: l.action,
      recordId: l.recordId,
    })),
    ...trailLogs.map((l) => ({
      id: l.id as string,
      dateTime: String(l.timestamp || ''),
      userName: String(l.userName || ''),
      module: String(l.moduleName || ''),
      action: String(l.action || ''),
      recordId: String(l.documentId || ''),
    })),
  ];

  return normalized
    .sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime)))
    .slice(0, limitCount);
}

export async function getAuditLogs(filters?: {
  userId?: string;
  module?: string;
  action?: string;
  recordId?: string;
  startDate?: string;
  endDate?: string;
}) {
  const constraints: QueryConstraint[] = [orderBy('dateTime', 'desc'), limit(500)];

  if (filters?.module) constraints.unshift(where('module', '==', filters.module));
  if (filters?.action) constraints.unshift(where('action', '==', filters.action));
  if (filters?.userId) constraints.unshift(where('userId', '==', filters.userId));
  if (filters?.recordId) constraints.unshift(where('recordId', '==', filters.recordId));

  const [adminLogs, trailLogs] = await Promise.all([
    getRecords<AdminAuditLog>(ADMIN_COLLECTIONS.auditLogs, constraints).catch(() => []),
    getRecords<Record<string, unknown>>(
      ADMIN_COLLECTIONS.auditTrail,
      [orderBy('timestamp', 'desc'), limit(500)]
    ).catch(() => []),
  ]);

  const trailNormalized: AdminAuditLog[] = trailLogs.map((l) => ({
    id: l.id as string,
    dateTime: String(l.timestamp || l.dateTime || ''),
    userId: String(l.userId || ''),
    userName: String(l.userName || ''),
    module: String(l.moduleName || l.module || ''),
    recordId: String(l.documentId || l.recordId || ''),
    action: String(l.action || ''),
    oldValue: typeof l.oldValue === 'string' ? l.oldValue : JSON.stringify(l.oldValue ?? ''),
    newValue: typeof l.newValue === 'string' ? l.newValue : JSON.stringify(l.newValue ?? ''),
    reason: String(l.reason || ''),
    ipAddress: String(l.ipAddress || ''),
    device: String(l.device || l.deviceInfo || ''),
    status: String(l.status || 'Success'),
  }));

  let merged = [...adminLogs, ...trailNormalized];

  if (filters?.module) merged = merged.filter((l) => l.module === filters.module);
  if (filters?.action) merged = merged.filter((l) => l.action === filters.action);
  if (filters?.userId) merged = merged.filter((l) => l.userId === filters.userId);
  if (filters?.recordId) merged = merged.filter((l) => l.recordId === filters.recordId);
  if (filters?.startDate) merged = merged.filter((l) => l.dateTime >= filters.startDate!);
  if (filters?.endDate) merged = merged.filter((l) => l.dateTime <= filters.endDate! + 'T23:59:59');

  return merged
    .sort((a, b) => String(b.dateTime).localeCompare(String(a.dateTime)))
    .slice(0, 500);
}

export async function generateDocumentNumber(modulePrefix: string): Promise<string | null> {
  const q = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.documentNumbering),
    where('prefix', '==', modulePrefix),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const docRef = snap.docs[0];
  const data = docRef.data();
  const nextNum = (data.currentNumber || 0) + 1;
  const year = new Date().getFullYear();
  const padded = String(nextNum).padStart(data.runningNumber || 4, '0');
  const sep = data.separator || '/';

  const number = [
    data.prefix,
    data.siteCode,
    padded,
    data.departmentCode,
    year,
  ].filter(Boolean).join(sep);

  await updateDoc(docRef.ref, { currentNumber: nextNum, updatedAt: new Date().toISOString() });
  return number;
}

export async function seedDefaultData(userId: string) {
  const deptSnap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.departments));
  if (deptSnap.empty) {
    const { DEFAULT_DEPARTMENTS, DEFAULT_DESIGNATIONS } = await import('./constants');
    const batch = writeBatch(getFirebaseFirestore());
    const now = new Date().toISOString();

    DEFAULT_DEPARTMENTS.forEach((dept) => {
      const ref = doc(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.departments));
      batch.set(ref, { ...dept, status: 'Active', createdBy: userId, updatedBy: userId, createdAt: now, updatedAt: now });
    });

    DEFAULT_DESIGNATIONS.forEach((des) => {
      const ref = doc(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.designations));
      batch.set(ref, { ...des, status: 'Active', createdBy: userId, updatedBy: userId, createdAt: now, updatedAt: now });
    });

    await batch.commit();
  }
}

export { ADMIN_COLLECTIONS };
