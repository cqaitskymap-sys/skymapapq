/**
 * Backup & Restore — client service.
 * Reads via Firestore; privileged mutations via Cloud Functions.
 */
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  ADMIN_COLLECTIONS, BACKUP_SCOPE_COLLECTIONS, BACKUP_EXPORT_COLLECTIONS, BACKUP_STATUSES,
} from './constants';
import type {
  BackupHistory, BackupFormData, BackupSettings, RestoreHistory, RestoreRequestFormData,
} from './schemas';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';

export interface BackupAuditMeta {
  userId: string;
  userName: string;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function buildBackupNumber(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `BK-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

export function buildRestoreId(): string {
  return `RST-${Date.now().toString(36).toUpperCase()}`;
}

export function buildBackupId(): string {
  return `BKP-${Date.now()}`;
}

function normalizeBackupStatus(status?: string): BackupHistory['backupStatus'] {
  if (status === 'Success') return 'Completed';
  const values = BACKUP_STATUSES as readonly string[];
  if (status && values.includes(status)) {
    return status as BackupHistory['backupStatus'];
  }
  return 'Pending';
}

export function normalizeBackup(record: BackupHistory): BackupHistory {
  const dateTime = record.backupDateTime || record.backupDate || record.createdAt || '';
  return {
    ...record,
    backupNumber: record.backupNumber || record.backupId || '',
    backupDateTime: dateTime,
    backupDate: dateTime,
    backupStatus: normalizeBackupStatus(record.backupStatus),
    backupType: (record.backupType as BackupHistory['backupType']) || 'Manual Backup',
    backupScope: (record.backupScope as BackupHistory['backupScope']) || 'Full System',
    storageLocation: record.storageLocation || record.filePath || '',
    filePath: record.storageLocation || record.filePath || '',
    collectionsIncluded: record.collectionsIncluded || [],
    checksum: record.checksum || '',
    integrityStatus: record.integrityStatus || 'Pending',
    encryptionStatus: record.encryptionStatus || '',
    encryptionAlgorithm: record.encryptionAlgorithm || 'AES-256-GCM',
    storageProvider: record.storageProvider || 'Firebase Cloud Storage',
    restorePointCreated: record.restorePointCreated ?? false,
    isProtected: record.isProtected ?? false,
    isArchived: record.isArchived ?? false,
  };
}

export function resolveCollectionsForScope(
  scope: string,
  selectedCollections: string[] = [],
): string[] {
  if (scope === 'Selected Collections') return selectedCollections;
  const mapped = BACKUP_SCOPE_COLLECTIONS[scope];
  if (mapped && mapped.length > 0) return [...mapped];
  return [...BACKUP_EXPORT_COLLECTIONS];
}

export async function computeChecksum(data: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `len-${data.length}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function fetchBackupHistory(includeArchived = false): Promise<BackupHistory[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupHistory),
      orderBy('backupDateTime', 'desc'),
      limit(400),
    ));
    return snap.docs
      .map((d) => normalizeBackup({ id: d.id, ...d.data() } as BackupHistory))
      .filter((r) => !r.isDeleted && (includeArchived || !r.isArchived));
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupHistory));
      return snap.docs
        .map((d) => normalizeBackup({ id: d.id, ...d.data() } as BackupHistory))
        .filter((r) => !r.isDeleted && (includeArchived || !r.isArchived))
        .sort((a, b) => String(b.backupDateTime || '').localeCompare(String(a.backupDateTime || '')));
    } catch {
      return [];
    }
  }
}

export function subscribeToBackupHistory(
  onData: (rows: BackupHistory[]) => void,
  onError?: (error: Error) => void,
  includeArchived = false,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupHistory), limit(400)),
    (snapshot) => {
      onData(snapshot.docs
        .map((d) => normalizeBackup({ id: d.id, ...d.data() } as BackupHistory))
        .filter((r) => !r.isDeleted && (includeArchived || !r.isArchived))
        .sort((a, b) => String(b.backupDateTime || '').localeCompare(String(a.backupDateTime || ''))));
    },
    (error) => onError?.(new Error(error.message)),
  );
}

export async function fetchBackupById(id: string): Promise<BackupHistory | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupHistory, id));
    if (snap.exists()) {
      return normalizeBackup({ id: snap.id, ...snap.data() } as BackupHistory);
    }
  } catch {
    /* fall through */
  }
  const all = await fetchBackupHistory();
  return all.find((b) => b.id === id || b.backupId === id) ?? null;
}

export async function fetchRestoreHistory(includeArchived = false): Promise<RestoreHistory[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.restoreHistory),
      orderBy('restoreDateTime', 'desc'),
      limit(300),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as RestoreHistory))
      .filter((r) => includeArchived || !r.isArchived);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.restoreHistory));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as RestoreHistory))
        .filter((r) => includeArchived || !r.isArchived)
        .sort((a, b) => String(b.restoreDateTime || '').localeCompare(String(a.restoreDateTime || '')));
    } catch {
      return [];
    }
  }
}

export function subscribeToRestoreHistory(
  onData: (rows: RestoreHistory[]) => void,
  onError?: (error: Error) => void,
  includeArchived = false,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.restoreHistory), limit(300)),
    (snapshot) => {
      onData(snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as RestoreHistory))
        .filter((r) => includeArchived || !r.isArchived)
        .sort((a, b) => String(b.restoreDateTime || '').localeCompare(String(a.restoreDateTime || ''))));
    },
    (error) => onError?.(new Error(error.message)),
  );
}

export async function fetchRestoreById(id: string): Promise<RestoreHistory | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.restoreHistory, id));
    if (snap.exists()) return { id: snap.id, ...snap.data() } as RestoreHistory;
  } catch {
    /* fall through */
  }
  const all = await fetchRestoreHistory(true);
  return all.find((r) => r.id === id || r.restoreId === id) ?? null;
}

export type BackupHistoryListTab =
  | 'all' | 'backups' | 'restores' | 'failed' | 'integrity' | 'encrypted' | 'expired' | 'archived';

export interface BackupHistoryFilters {
  search?: string;
  operationType?: string;
  backupType?: string;
  restoreType?: string;
  status?: string;
  integrityStatus?: string;
  encryptionStatus?: string;
  storageProvider?: string;
  createdBy?: string;
  startDate?: string;
  endDate?: string;
}

export function getHistoryDashboardSummary(
  backups: BackupHistory[],
  restores: RestoreHistory[],
) {
  const now = Date.now();
  const failedBackups = backups.filter((b) => b.backupStatus === 'Failed');
  const failedRestores = restores.filter((r) => r.restoreStatus === 'Failed');
  const verified = backups.filter((b) =>
    b.backupStatus === 'Verified' || b.integrityStatus === 'Verified',
  );
  const integrityFailed = backups.filter((b) => b.integrityStatus === 'Failed');
  const encrypted = backups.filter((b) => b.encryptionStatus === 'Encrypted');
  const expired = backups.filter((b) =>
    b.expirationDate && new Date(b.expirationDate).getTime() < now,
  );
  const storageBytes = backups.reduce((s, b) => s + Number(b.fileSizeBytes || 0), 0);
  return {
    totalBackups: backups.length,
    totalRestores: restores.length,
    failedBackups: failedBackups.length,
    failedRestores: failedRestores.length,
    verified: verified.length,
    integrityFailed: integrityFailed.length,
    encrypted: encrypted.length,
    expired: expired.length,
    completedRestores: restores.filter((r) => r.restoreStatus === 'Completed' && !r.dryRun).length,
    dryRuns: restores.filter((r) => r.dryRun).length,
    storageUsed: formatBytes(storageBytes),
    storageBytes,
  };
}

export function applyBackupHistoryFilters(
  backups: BackupHistory[],
  filters: BackupHistoryFilters,
): BackupHistory[] {
  const q = (filters.search || '').toLowerCase().trim();
  return backups.filter((b) => {
    const matchSearch = !q
      || b.backupId?.toLowerCase().includes(q)
      || b.backupNumber?.toLowerCase().includes(q)
      || b.checksum?.toLowerCase().includes(q)
      || b.createdBy?.toLowerCase().includes(q)
      || b.storageLocation?.toLowerCase().includes(q)
      || b.failureReason?.toLowerCase().includes(q);
    const matchType = !filters.backupType || filters.backupType === 'all' || b.backupType === filters.backupType;
    const matchStatus = !filters.status || filters.status === 'all' || b.backupStatus === filters.status;
    const matchIntegrity = !filters.integrityStatus || filters.integrityStatus === 'all'
      || b.integrityStatus === filters.integrityStatus;
    const matchEnc = !filters.encryptionStatus || filters.encryptionStatus === 'all'
      || b.encryptionStatus === filters.encryptionStatus;
    const matchProvider = !filters.storageProvider || filters.storageProvider === 'all'
      || b.storageProvider === filters.storageProvider;
    const matchBy = !filters.createdBy || filters.createdBy === 'all'
      || String(b.createdBy || '').toLowerCase().includes(filters.createdBy.toLowerCase());
    const dt = String(b.backupDateTime || '');
    const matchStart = !filters.startDate || dt >= filters.startDate;
    const matchEnd = !filters.endDate || dt.slice(0, 10) <= filters.endDate;
    return matchSearch && matchType && matchStatus && matchIntegrity && matchEnc
      && matchProvider && matchBy && matchStart && matchEnd;
  });
}

export function applyRestoreHistoryFilters(
  restores: RestoreHistory[],
  filters: BackupHistoryFilters,
): RestoreHistory[] {
  const q = (filters.search || '').toLowerCase().trim();
  return restores.filter((r) => {
    const matchSearch = !q
      || r.restoreId?.toLowerCase().includes(q)
      || r.backupId?.toLowerCase().includes(q)
      || r.reasonForRestore?.toLowerCase().includes(q)
      || r.restoredBy?.toLowerCase().includes(q)
      || r.esignRecordId?.toLowerCase().includes(q);
    const matchType = !filters.restoreType || filters.restoreType === 'all' || r.restoreType === filters.restoreType;
    const matchStatus = !filters.status || filters.status === 'all' || r.restoreStatus === filters.status;
    const matchBy = !filters.createdBy || filters.createdBy === 'all'
      || String(r.restoredBy || r.createdBy || '').toLowerCase().includes(filters.createdBy.toLowerCase());
    const dt = String(r.restoreDateTime || '');
    const matchStart = !filters.startDate || dt >= filters.startDate;
    const matchEnd = !filters.endDate || dt.slice(0, 10) <= filters.endDate;
    return matchSearch && matchType && matchStatus && matchBy && matchStart && matchEnd;
  });
}

export async function archiveBackupHistoryRecord(
  id: string,
  changeReason: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminBackupHistory');
    await fn({ id, changeReason });
    return { success: true };
  } catch (e) {
    return { error: callableErrorMessage(e, 'Archive failed') };
  }
}

export async function archiveRestoreHistoryRecord(
  id: string,
  changeReason: string,
): Promise<{ success?: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminRestoreHistory');
    await fn({ id, changeReason });
    return { success: true };
  } catch (e) {
    return { error: callableErrorMessage(e, 'Archive failed') };
  }
}

export async function fetchBackupSettings(): Promise<BackupSettings | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupSettings),
      limit(1),
    ));
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as BackupSettings;
  } catch {
    return null;
  }
}

export async function fetchBackupJobs(): Promise<Array<Record<string, unknown>>> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.backupJobs),
      limit(100),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  } catch {
    return [];
  }
}

export function getBackupSummary(backups: BackupHistory[], restores: RestoreHistory[], settings: BackupSettings | null) {
  const successful = backups.filter((b) =>
    b.backupStatus === 'Completed' || b.backupStatus === 'Verified',
  );
  const failed = backups.filter((b) => b.backupStatus === 'Failed');
  const last = [...backups].sort((a, b) =>
    String(b.backupDateTime).localeCompare(String(a.backupDateTime)),
  )[0];
  const restoreRequests = restores.filter((r) => r.restoreStatus === 'Requested');
  const completedRestores = restores.filter((r) => r.restoreStatus === 'Completed');
  const storageBytes = backups.reduce((sum, b) => sum + Number(b.fileSizeBytes || 0), 0);
  const encrypted = backups.filter((b) => b.encryptionStatus === 'Encrypted').length;

  return {
    totalBackups: backups.length,
    successfulBackups: successful.length,
    failedBackups: failed.length,
    lastBackupStatus: last?.backupStatus || 'None',
    lastBackupDate: last?.backupDateTime || '',
    nextBackupDue: settings?.nextBackupDate || last?.nextBackupDue || '',
    restoreRequests: restoreRequests.length,
    completedRestores: completedRestores.length,
    storageUsed: formatBytes(storageBytes),
    storageBytes,
    encryptedBackups: encrypted,
    autoBackupEnabled: settings?.autoBackupEnabled ?? false,
  };
}

export function getBackupChartsData(backups: BackupHistory[], restores: RestoreHistory[]) {
  const successByMonth = new Map<string, { success: number; failed: number }>();
  backups.forEach((b) => {
    const month = b.backupDateTime?.slice(0, 7) || 'unknown';
    const entry = successByMonth.get(month) || { success: 0, failed: 0 };
    if (b.backupStatus === 'Completed' || b.backupStatus === 'Verified') entry.success += 1;
    if (b.backupStatus === 'Failed') entry.failed += 1;
    successByMonth.set(month, entry);
  });

  const typeDist = new Map<string, number>();
  backups.forEach((b) => {
    const t = b.backupType || 'Manual Backup';
    typeDist.set(t, (typeDist.get(t) || 0) + 1);
  });

  const restoreByMonth = new Map<string, number>();
  restores.forEach((r) => {
    const month = r.restoreDateTime?.slice(0, 7) || 'unknown';
    restoreByMonth.set(month, (restoreByMonth.get(month) || 0) + 1);
  });

  const sizeByMonth = new Map<string, number>();
  backups.forEach((b) => {
    const month = b.backupDateTime?.slice(0, 7) || 'unknown';
    sizeByMonth.set(month, (sizeByMonth.get(month) || 0) + Number(b.fileSizeBytes || 0));
  });

  return {
    successTrend: Array.from(successByMonth.entries()).map(([month, v]) => ({
      month, success: v.success, failed: v.failed,
    })),
    typeDistribution: Array.from(typeDist.entries()).map(([name, value]) => ({ name, value })),
    restoreTrend: Array.from(restoreByMonth.entries()).map(([month, count]) => ({ month, count })),
    sizeTrend: Array.from(sizeByMonth.entries()).map(([month, bytes]) => ({
      month, size: Math.round(bytes / 1024),
    })),
  };
}

export async function createBackup(
  form: BackupFormData,
  _meta: BackupAuditMeta,
  onProgress?: (pct: number, label: string) => void,
): Promise<{ backup: BackupHistory | null; error?: string }> {
  if (!isFirebaseConfigured()) return { backup: null, error: 'Firebase is not configured' };
  onProgress?.(10, 'Starting server-side backup...');
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'createAdminBackup');
    onProgress?.(40, 'Exporting & encrypting (Cloud Function)...');
    const result = await fn({
      backupNumber: form.backupNumber,
      backupType: form.backupType,
      backupScope: form.backupScope,
      selectedCollections: form.selectedCollections,
      backupFrequency: form.backupFrequency,
      remarks: form.remarks,
      changeReason: form.changeReason || form.remarks || 'Manual backup',
      isProtected: form.isProtected,
    });
    onProgress?.(100, 'Complete');
    const data = result.data as {
      backupDocId: string;
      backupId: string;
      backupNumber: string;
      recordsCount: number;
      checksum: string;
      storageLocation: string;
      status: string;
    };
    const backup = await fetchBackupById(data.backupDocId);
    return {
      backup: backup || normalizeBackup({
        id: data.backupDocId,
        backupId: data.backupId,
        backupNumber: data.backupNumber,
        backupType: form.backupType,
        backupScope: form.backupScope,
        backupDateTime: new Date().toISOString(),
        backupStatus: 'Completed',
        recordsCount: data.recordsCount,
        checksum: data.checksum,
        storageLocation: data.storageLocation,
        encryptionStatus: 'Encrypted',
        integrityStatus: 'Verified',
      } as BackupHistory),
    };
  } catch (e) {
    return { backup: null, error: callableErrorMessage(e, 'Backup failed') };
  }
}

export async function createPreRestoreBackup(meta: BackupAuditMeta): Promise<BackupHistory | null> {
  const result = await createBackup({
    backupNumber: buildBackupNumber(),
    backupType: 'Pre-Restore Backup',
    backupScope: 'Full System',
    selectedCollections: [],
    backupFrequency: 'Manual Only',
    remarks: 'Automatic pre-restore safety backup',
    changeReason: 'Pre-restore safety backup',
    isProtected: true,
  }, meta);
  return result.backup;
}

export async function downloadBackup(backup: BackupHistory): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'getAdminBackupDownloadUrl');
    const result = await fn({
      backupId: backup.id || backup.backupId,
      changeReason: 'Authorized backup download',
    });
    const data = result.data as { fileName: string; content: string; mimeType: string };
    const blob = new Blob([data.content], { type: data.mimeType || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.fileName || backup.fileName || `${backup.backupNumber}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Download failed') };
  }
}

export async function verifyBackup(
  backup: BackupHistory,
  _meta: BackupAuditMeta,
): Promise<{ verified: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'verifyAdminBackup');
    const result = await fn({
      backupId: backup.id || backup.backupId,
      changeReason: 'Integrity verification',
    });
    const data = result.data as { verified: boolean };
    return { verified: data.verified, error: data.verified ? undefined : 'Checksum mismatch' };
  } catch (e) {
    return { verified: false, error: callableErrorMessage(e, 'Verification failed') };
  }
}

export async function requestRestore(
  form: RestoreRequestFormData,
  _meta: BackupAuditMeta,
): Promise<{ restore: RestoreHistory | null; error?: string }> {
  try {
    const dryRun = form.dryRun || form.restoreType === 'Dry Run Restore';
    const fn = httpsCallable(getFirebaseFunctions(), 'requestAdminRestore');
    const result = await fn({
      backupId: form.backupId,
      restoreType: dryRun ? 'Full Restore' : form.restoreType,
      selectedCollections: form.selectedCollections,
      reasonForRestore: form.reasonForRestore,
      remarks: form.remarks,
      dryRun,
      esignRecordId: form.esignRecordId,
    });
    const data = result.data as {
      id: string;
      restoreId: string;
      dryRun: boolean;
      collections: string[];
      previewCount: number;
      status: string;
    };
    return {
      restore: {
        id: data.id,
        restoreId: data.restoreId,
        backupId: form.backupId,
        restoreDateTime: new Date().toISOString(),
        restoreType: form.restoreType,
        restoreStatus: data.status as RestoreHistory['restoreStatus'],
        collectionsRestored: data.collections,
        recordsRestored: data.previewCount,
        reasonForRestore: form.reasonForRestore,
        dryRun: data.dryRun,
        approvalRequired: !data.dryRun,
      } as RestoreHistory,
    };
  } catch (e) {
    return { restore: null, error: callableErrorMessage(e, 'Restore request failed') };
  }
}

export async function approveRestore(
  restore: RestoreHistory,
  _meta: BackupAuditMeta,
  esignRecordId?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'approveAdminRestore');
    await fn({
      restoreDocId: restore.id,
      changeReason: restore.reasonForRestore || 'Production restore approved',
      esignRecordId: esignRecordId || restore.esignRecordId,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Restore approval failed') };
  }
}

export async function rejectRestore(
  restore: RestoreHistory,
  _meta: BackupAuditMeta,
  reason: string,
): Promise<void> {
  const fn = httpsCallable(getFirebaseFunctions(), 'rejectAdminRestore');
  await fn({
    restoreDocId: restore.id,
    changeReason: reason || 'Restore rejected',
  });
}

export async function updateBackupSettings(
  settings: Partial<BackupSettings> & { changeReason?: string },
  _meta: BackupAuditMeta,
): Promise<BackupSettings | null> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminBackupSettings');
    const result = await fn({
      ...settings,
      changeReason: settings.changeReason || 'Backup settings updated',
    });
    return result.data as BackupSettings;
  } catch {
    return null;
  }
}

export async function seedDefaultBackupSettings(meta: BackupAuditMeta): Promise<BackupSettings | null> {
  const existing = await fetchBackupSettings();
  if (existing) return existing;
  return updateBackupSettings({
    autoBackupEnabled: false,
    backupFrequency: 'Weekly',
    backupTime: '02:00',
    backupScope: 'Full System',
    retentionPeriodDays: 90,
    notifyAdminOnSuccess: true,
    notifyAdminOnFailure: true,
    changeReason: 'Seed default backup settings',
  }, meta);
}

export async function purgeExpiredBackups(changeReason: string): Promise<{ purged?: number; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'purgeExpiredAdminBackups');
    const result = await fn({ changeReason });
    return result.data as { purged: number };
  } catch (e) {
    return { error: callableErrorMessage(e, 'Purge failed') };
  }
}

export async function softDeleteBackup(id: string, changeReason: string): Promise<{ success?: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminBackup');
    await fn({ id, changeReason });
    return { success: true };
  } catch (e) {
    return { error: callableErrorMessage(e, 'Delete failed') };
  }
}

export async function logBackupExport(
  description: string,
  metaOrRecordId?: BackupAuditMeta | string,
  _count?: number,
): Promise<void> {
  const recordId = typeof metaOrRecordId === 'string'
    ? metaOrRecordId
    : 'export';
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminBackupExport');
    await fn({ description, recordId, changeReason: 'History export' });
  } catch {
    /* non-blocking */
  }
}

export function exportBackupHistoryCsv(backups: BackupHistory[]): string {
  const headers = [
    'History Doc ID', 'Backup ID', 'Backup Number', 'Type', 'Scope', 'Status',
    'Records', 'Size Bytes', 'Size', 'Checksum', 'Integrity', 'Encryption',
    'Algorithm', 'Provider', 'Storage Location', 'Version', 'Retention Days',
    'Expiration', 'Protected', 'Archived', 'Failure Reason', 'Duration Ms',
    'Created By', 'Date', 'Change Reason',
  ];
  const rows = backups.map((b) => [
    b.id || '', b.backupId, b.backupNumber, b.backupType, b.backupScope, b.backupStatus,
    String(b.recordsCount || 0), String(b.fileSizeBytes || 0), b.fileSize || '',
    b.checksum || '', b.integrityStatus || '', b.encryptionStatus || '',
    b.encryptionAlgorithm || '', b.storageProvider || '', b.storageLocation || '',
    b.version || '', String(b.retentionPolicyDays || ''), b.expirationDate || '',
    b.isProtected ? 'Yes' : 'No', b.isArchived ? 'Yes' : 'No',
    b.failureReason || '', String(b.durationMs || 0),
    b.createdBy || '', b.backupDateTime || '', b.changeReason || '',
  ]);
  return [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function exportRestoreHistoryCsv(restores: RestoreHistory[]): string {
  const headers = [
    'History Doc ID', 'Restore ID', 'Backup ID', 'Type', 'Status', 'Records',
    'Reason', 'Requested By', 'Approved By', 'Approved At', 'E-Sign ID',
    'Pre-Restore Backup', 'Dry Run', 'Failure Reason', 'Duration Ms',
    'Archived', 'Date', 'Collections',
  ];
  const rows = restores.map((r) => [
    r.id || '', r.restoreId, r.backupId, r.restoreType, r.restoreStatus,
    String(r.recordsRestored || 0), r.reasonForRestore || '',
    r.restoredBy || r.createdBy || '', r.approvedBy || '', r.approvedAt || '',
    r.esignRecordId || '', r.preRestoreBackupId || '', r.dryRun ? 'Yes' : 'No',
    r.failureReason || '', String(r.durationMs || 0),
    r.isArchived ? 'Yes' : 'No', r.restoreDateTime || '',
    (r.collectionsRestored || []).join(';'),
  ]);
  return [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function buildFailedBackupReportHtml(backups: BackupHistory[], generatedBy = ''): string {
  const failed = backups.filter((b) => b.backupStatus === 'Failed');
  return buildBackupHistoryPdfHtml(failed, generatedBy).replace(
    '<h1>Backup History</h1>',
    '<h1>Failed Backup Report</h1>',
  );
}

export function buildIntegrityReportHtml(backups: BackupHistory[], generatedBy = ''): string {
  const rows = backups.map((b) => `
    <tr>
      <td>${b.backupNumber}</td><td>${b.integrityStatus || '—'}</td>
      <td>${b.checksum || '—'}</td><td>${b.encryptionStatus || '—'}</td>
      <td>${b.backupDateTime}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><title>Integrity Verification Report</title>
    <style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;font-size:12px}</style>
    </head><body><h1>Integrity Verification Report</h1>
    ${generatedBy ? `<p>Generated by: ${generatedBy}</p>` : ''}
    <table>
    <tr><th>Backup</th><th>Integrity</th><th>Checksum</th><th>Encryption</th><th>Date</th></tr>
    ${rows}</table></body></html>`;
}

export function buildRetentionReportHtml(backups: BackupHistory[], generatedBy = ''): string {
  const rows = backups.map((b) => `
    <tr>
      <td>${b.backupNumber}</td><td>${b.retentionPolicyDays}</td>
      <td>${b.expirationDate || '—'}</td><td>${b.isProtected ? 'Yes' : 'No'}</td>
      <td>${b.isArchived ? 'Yes' : 'No'}</td><td>${b.backupStatus}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><title>Retention Report</title>
    <style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;font-size:12px}</style>
    </head><body><h1>Backup Retention Report</h1>
    ${generatedBy ? `<p>Generated by: ${generatedBy}</p>` : ''}
    <table>
    <tr><th>Backup</th><th>Retention Days</th><th>Expires</th><th>Protected</th><th>Archived</th><th>Status</th></tr>
    ${rows}</table></body></html>`;
}

export function buildComplianceHistoryReportHtml(
  backups: BackupHistory[],
  restores: RestoreHistory[],
  generatedBy = '',
): string {
  return `<!DOCTYPE html><html><head><title>DR Compliance Report</title>
    <style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%;margin-bottom:24px}td,th{border:1px solid #ccc;padding:6px;font-size:12px}</style>
    </head><body>
    <h1>Disaster Recovery / Backup Compliance Report</h1>
    ${generatedBy ? `<p>Generated by: ${generatedBy}</p>` : ''}
    <p>Backups: ${backups.length} · Restores: ${restores.length} · Encrypted: ${backups.filter((b) => b.encryptionStatus === 'Encrypted').length}</p>
    <h2>Backup Traceability</h2>
    ${buildBackupHistoryPdfHtml(backups, '').replace(/<!DOCTYPE[\s\S]*?<body>|<\/body><\/html>/g, '')}
    <h2>Restore Traceability</h2>
    ${buildRestoreHistoryPdfHtml(restores, '').replace(/<!DOCTYPE[\s\S]*?<body>|<\/body><\/html>/g, '')}
    </body></html>`;
}

export function buildBackupHistoryPdfHtml(backups: BackupHistory[], generatedBy = ''): string {
  const rows = backups.map((b) => `
    <tr>
      <td>${b.backupNumber}</td><td>${b.backupType}</td><td>${b.backupStatus}</td>
      <td>${b.recordsCount}</td><td>${b.encryptionStatus || '—'}</td><td>${b.backupDateTime}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><title>Backup History</title>
    <style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;font-size:12px}</style>
    </head><body><h1>Backup History</h1>
    ${generatedBy ? `<p>Generated by: ${generatedBy}</p>` : ''}
    <table>
    <tr><th>Number</th><th>Type</th><th>Status</th><th>Records</th><th>Encryption</th><th>Date</th></tr>
    ${rows}</table></body></html>`;
}

export function buildRestoreHistoryPdfHtml(restores: RestoreHistory[], generatedBy = ''): string {
  const rows = restores.map((r) => `
    <tr>
      <td>${r.restoreId}</td><td>${r.backupId}</td><td>${r.restoreStatus}</td>
      <td>${r.recordsRestored}</td><td>${r.reasonForRestore}</td><td>${r.restoreDateTime}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><title>Restore History</title>
    <style>body{font-family:sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px;font-size:12px}</style>
    </head><body><h1>Restore History</h1>
    ${generatedBy ? `<p>Generated by: ${generatedBy}</p>` : ''}
    <table>
    <tr><th>Restore ID</th><th>Backup</th><th>Status</th><th>Records</th><th>Reason</th><th>Date</th></tr>
    ${rows}</table></body></html>`;
}

/** @deprecated Client export removed — use createAdminBackup */
export async function exportCollection(): Promise<{ name: string; records: unknown[]; count: number }> {
  return { name: '', records: [], count: 0 };
}

/** @deprecated Client restore removed — use approveAdminRestore */
export async function restoreCollection(): Promise<number> {
  return 0;
}
