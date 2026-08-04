import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseApp, getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import {
  ADMIN_COLLECTIONS, BATCH_ATTACHMENT_MAX_BYTES, BATCH_LEGACY_STATUS_MAP, BATCH_STATUSES,
} from './constants';
import type { AdminBatch, BatchFormData, BatchAttachment, AdminProduct } from './schemas';

export interface BatchAuditMeta {
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

export function buildBatchId(batchNumber: string): string {
  return `BATCH-${batchNumber.toUpperCase().replace(/\s+/g, '-')}`;
}

export function normalizeBatchStatus(status?: string): AdminBatch['batchStatus'] {
  const raw = status || 'Planned';
  if ((BATCH_STATUSES as readonly string[]).includes(raw)) {
    return raw as AdminBatch['batchStatus'];
  }
  return BATCH_LEGACY_STATUS_MAP[raw] || 'Planned';
}

export function normalizeBatch(b: AdminBatch): AdminBatch {
  const batchStatus = normalizeBatchStatus(b.batchStatus);
  return {
    ...b,
    batchStatus,
    batchSizeUnit: b.batchSizeUnit || b.unit || 'Vials',
    unit: b.batchSizeUnit || b.unit || 'Vials',
    manufacturingLine: b.manufacturingLine || b.lineNumber || '',
    lineNumber: b.manufacturingLine || b.lineNumber || '',
    batchSize: String(b.batchSize ?? ''),
    status: batchStatus === 'Released' ? 'Active' : b.status,
    isDeleted: Boolean(b.isDeleted),
    isArchived: b.isArchived ?? batchStatus === 'Archived',
  };
}

function mapBatchDoc(snapshot: { id: string; data: () => Record<string, unknown> }): AdminBatch {
  return normalizeBatch({ id: snapshot.id, ...snapshot.data() } as AdminBatch);
}

export function productToBatchAutofill(product: AdminProduct): Partial<BatchFormData> {
  return {
    productCode: product.productCode,
    productName: product.productName,
    productVersion: '',
    productCategory: product.category || product.therapeuticCategory || '',
    genericName: product.genericName || '',
    strength: product.strength || '',
    dosageForm: product.dosageForm || '',
    market: product.market || '',
    batchSize: Number(product.standardBatchSize || product.batchSize) || undefined,
    shelfLife: product.shelfLife || '',
    batchPrefix: product.batchPrefix || '',
    manufacturingSite: product.manufacturingSite || '',
    businessUnit: product.businessUnit || '',
    department: product.department || '',
    mfrNumber: product.mfrNumber || '',
    bmrNumber: product.bmrNumber || '',
    bprNumber: product.bprNumber || '',
  };
}

export async function fetchBatches(includeDeleted = false): Promise<AdminBatch[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.batches),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => mapBatchDoc(document))
      .filter((batch) => includeDeleted || !batch.isDeleted);
  } catch (error) {
    console.error('fetchBatches failed:', error);
    throw new Error('Unable to load batches. Check your connection and permissions.');
  }
}

export function subscribeToBatches(
  includeDeleted: boolean,
  onData: (batches: AdminBatch[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const batchesQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.batches),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    batchesQuery,
    (snapshot) => {
      const batches = snapshot.docs
        .map((document) => mapBatchDoc(document))
        .filter((batch) => includeDeleted || !batch.isDeleted);
      onData(batches);
    },
    (error) => {
      console.error('subscribeToBatches failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to batches'));
    },
  );
}

export async function fetchBatchById(id: string, includeDeleted = false): Promise<AdminBatch | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.batches, id));
    if (!snapshot.exists()) return null;
    const batch = mapBatchDoc(snapshot);
    if (batch.isDeleted && !includeDeleted) return null;
    return batch;
  } catch (error) {
    console.error('fetchBatchById failed:', error);
    throw new Error('Unable to load batch details.');
  }
}

export async function fetchBatchAttachments(batchId: string): Promise<BatchAttachment[]> {
  if (!isFirebaseConfigured() || !batchId) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.batchAttachments),
      where('batchId', '==', batchId),
    ));
    return snapshot.docs
      .map((document) => ({ id: document.id, ...document.data() } as BatchAttachment))
      .filter((row) => !(row as { isDeleted?: boolean }).isDeleted);
  } catch (error) {
    console.error('fetchBatchAttachments failed:', error);
    return [];
  }
}

export async function fetchBatchAuditTrail(recordId: string) {
  if (!isFirebaseConfigured() || !recordId) return [];
  try {
    const firestore = getFirebaseFirestore();
    const [trailSnap, logsSnap] = await Promise.all([
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditTrail),
        where('documentId', '==', recordId),
        orderBy('timestamp', 'desc'),
        limit(30),
      )).catch(() => ({ docs: [] })),
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditLogs),
        where('recordId', '==', recordId),
        orderBy('dateTime', 'desc'),
        limit(30),
      )).catch(() => ({ docs: [] })),
    ]);
    return [...trailSnap.docs, ...logsSnap.docs]
      .map((document): Record<string, unknown> & { id: string } => {
        const data = document.data() as Record<string, unknown>;
        return { id: document.id, ...data };
      })
      .sort((a, b) => String(b.timestamp ?? b.dateTime).localeCompare(String(a.timestamp ?? a.dateTime)))
      .slice(0, 30);
  } catch (error) {
    console.error('fetchBatchAuditTrail failed:', error);
    return [];
  }
}

export function getBatchSummaryCounts(batches: AdminBatch[]) {
  const active = batches.filter((b) => !b.isDeleted);
  const count = (status: string) => active.filter((b) => b.batchStatus === status).length;
  return {
    total: active.length,
    planned: count('Planned'),
    scheduled: count('Scheduled'),
    manufacturing: count('Manufacturing'),
    sampling: count('Sampling'),
    testing: count('Testing'),
    underReview: count('Under Review'),
    released: count('Released'),
    rejected: count('Rejected'),
    hold: count('Hold'),
    closed: count('Closed'),
    archived: count('Archived'),
  };
}

export function buildBatchLifecycleDashboard(batches: AdminBatch[]) {
  const active = batches.filter((b) => !b.isDeleted);
  return BATCH_STATUSES.map((status) => ({
    batchStatus: status,
    count: active.filter((b) => b.batchStatus === status).length,
    batches: active.filter((b) => b.batchStatus === status),
  }));
}

export function isBatchReleasedLocked(batch: AdminBatch): boolean {
  return batch.batchStatus === 'Released';
}

export function canDeleteBatchRecord(batch: AdminBatch): { allowed: boolean; reason?: string } {
  if (batch.isDeleted) return { allowed: false, reason: 'Batch is already deleted.' };
  if (batch.batchStatus === 'Released') {
    return { allowed: false, reason: 'Released batches cannot be deleted.' };
  }
  return { allowed: true };
}

export async function previewBatchNumber(
  productCode: string,
  siteCode?: string,
): Promise<{ batchNumber: string; error?: string }> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { batchNumber: string }
    >(getFirebaseFunctions(), 'previewAdminBatchNumber');
    const response = await fn({ productCode, siteCode });
    return { batchNumber: response.data.batchNumber };
  } catch (error) {
    return { batchNumber: '', error: callableErrorMessage(error, 'Unable to preview batch number') };
  }
}

export async function createBatch(
  data: BatchFormData,
  _meta: BatchAuditMeta,
): Promise<{ batch: AdminBatch | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, AdminBatch>(
      getFirebaseFunctions(),
      'createAdminBatch',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason || 'Initial batch registration',
    });
    return { batch: normalizeBatch(response.data), error: null };
  } catch (error) {
    return { batch: null, error: callableErrorMessage(error, 'Unable to create batch') };
  }
}

export async function updateBatch(
  id: string,
  data: BatchFormData,
  _existing: AdminBatch,
  _meta: BatchAuditMeta,
  _currentRole: string,
): Promise<{ batch: AdminBatch | null; error: string | null }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { batch: AdminBatch }
    >(getFirebaseFunctions(), 'updateAdminBatch');
    const response = await updateFn({
      batchDocId: id,
      updates: data,
      reason: data.changeReason,
    });
    return { batch: normalizeBatch(response.data.batch), error: null };
  } catch (error) {
    return { batch: null, error: callableErrorMessage(error, 'Unable to update batch') };
  }
}

export async function setBatchStatusAction(
  id: string,
  _batch: AdminBatch,
  action: 'release' | 'reject' | 'hold' | 'close' | 'archive',
  reason: string,
  _meta: BatchAuditMeta,
): Promise<{ success: boolean; error?: string }> {
  if (!reason.trim()) return { success: false, error: 'Reason is required' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminBatchStatus');
    await fn({ batchDocId: id, action, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update batch status') };
  }
}

export async function deleteBatch(
  id: string,
  batch: AdminBatch,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteBatchRecord(batch);
  if (!check.allowed) return { success: false, error: check.reason };
  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminBatch');
    await deleteFn({ batchDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete batch') };
  }
}

export async function restoreBatch(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminBatch');
    await restoreFn({ batchDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore batch') };
  }
}

export async function bulkUpdateBatches(
  batchIds: string[],
  action: 'hold' | 'close' | 'archive',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminBatches');
    const response = await bulkFn({ batchDocIds: batchIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkDeleteBatches(
  batchIds: string[],
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminBatches');
    const response = await bulkFn({ batchDocIds: batchIds, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

export async function uploadBatchAttachment(
  batchId: string,
  file: File,
  meta: BatchAuditMeta,
  reason = 'Attachment registered after client upload',
): Promise<{ attachment: BatchAttachment | null; error?: string }> {
  if (file.size > BATCH_ATTACHMENT_MAX_BYTES) {
    return { attachment: null, error: 'File must be 10 MB or smaller' };
  }
  if (!isFirebaseConfigured()) {
    return { attachment: null, error: 'Firebase Storage is not configured' };
  }

  try {
    const path = `batches/${batchId}/attachments/${Date.now()}_${file.name}`;
    const storageRef = ref(getFirebaseStorage(), path);
    await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);

    const registerFn = httpsCallable<
      Record<string, unknown>,
      BatchAttachment
    >(getFirebaseFunctions(), 'registerAdminBatchAttachment');
    const response = await registerFn({
      batchDocId: batchId,
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
      storagePath: path,
      downloadUrl,
      reason,
    });
    return { attachment: response.data };
  } catch (error) {
    return { attachment: null, error: callableErrorMessage(error, 'Unable to upload attachment') };
  }
}

export async function deleteBatchAttachment(
  attachment: BatchAttachment,
  _meta: BatchAuditMeta,
  reason = 'Attachment removed',
): Promise<{ success: boolean; error?: string }> {
  if (!attachment.id) return { success: false, error: 'Attachment ID missing' };
  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminBatchAttachment');
    await deleteFn({ attachmentDocId: attachment.id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete attachment') };
  }
}

export function exportBatchesCsv(batches: AdminBatch[]): string {
  const headers = [
    'Batch ID', 'Batch Number', 'Batch Code', 'Product Code', 'Product Name', 'Product Version',
    'Batch Size', 'Planned Qty', 'Actual Qty', 'Mfg Date', 'Packaging Date', 'Expiry', 'Retest',
    'Manufacturing Site', 'Batch Status', 'Release Status', 'QC Status', 'QA Status',
  ];
  const rows = batches.map((b) => [
    b.batchId, b.batchNumber, b.batchCode, b.productCode, b.productName, b.productVersion,
    `${b.batchSize} ${b.batchSizeUnit || b.unit || ''}`.trim(),
    b.plannedQuantity, b.actualQuantity, b.manufacturingDate, b.packagingDate,
    b.expiryDate, b.retestDate, b.manufacturingSite, b.batchStatus, b.releaseStatus,
    b.qcStatus, b.qaStatus,
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export async function logBatchExport(meta: BatchAuditMeta, count: number, reason = 'Batch list export') {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminBatchExport');
    await fn({ count, reason, userId: meta.userId });
  } catch (error) {
    console.error('logBatchExport failed:', error);
  }
}

function rowToImportBatch(cols: string[], headers: string[]): Record<string, string> | null {
  const idx = (name: string) => headers.findIndex((h) => h.includes(name));
  const batchNumber = cols[idx('batch number')] || cols[idx('batch')] || '';
  const productCode = cols[idx('product code')] || cols[idx('product')] || '';
  if (!productCode) return null;
  return {
    batchNumber,
    productCode,
    productName: cols[idx('product name')] || '',
    strength: cols[idx('strength')] || '',
    batchSize: cols[idx('batch size')] || '1',
    manufacturingDate: cols[idx('manufacturing')] || cols[idx('mfg')] || new Date().toISOString().slice(0, 10),
    expiryDate: cols[idx('expiry')] || new Date().toISOString().slice(0, 10),
    manufacturingSite: cols[idx('site')] || '',
    customerName: cols[idx('customer')] || '',
    remarks: 'Imported',
  };
}

export async function importBatchesFromFile(
  file: File,
  meta: BatchAuditMeta,
  reason = 'CSV batch import',
): Promise<{ imported: number; errors: string[] }> {
  const text = await file.text();
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { imported: 0, errors: ['No data rows found'] };

  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const rows: Record<string, string>[] = [];

  for (const line of lines.slice(1)) {
    const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) =>
      c.replace(/^"|"$/g, '').replace(/""/g, '"').trim(),
    ) || [];
    const row = rowToImportBatch(cols, headers);
    if (row) rows.push(row);
    else rows.push({ productCode: '', batchNumber: '', remarks: `Invalid row: ${line.slice(0, 40)}` });
  }

  const validRows = rows.filter((r) => r.productCode);
  if (!validRows.length) return { imported: 0, errors: ['No valid rows found'] };

  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { imported: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminBatches');
    const response = await importFn({ rows: validRows, reason, userId: meta.userId });
    return response.data;
  } catch (error) {
    return { imported: 0, errors: [callableErrorMessage(error, 'Import failed')] };
  }
}

export async function countLinkedIntegrations(batchId: string, batchNumber: string): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const firestore = getFirebaseFirestore();
  const collections: Array<{ name: string; field: string; value: string }> = [
    { name: 'deviations', field: 'batch_id', value: batchId },
    { name: 'capa_records', field: 'batch_id', value: batchId },
    { name: 'oos_records', field: 'batch_id', value: batchId },
    { name: 'cpv_batches', field: 'batchNumber', value: batchNumber },
    { name: 'pqr_batches', field: 'batch_number', value: batchNumber },
  ];
  let total = 0;
  for (const link of collections) {
    try {
      const snap = await getDocs(query(
        collection(firestore, link.name),
        where(link.field, '==', link.value),
        limit(5),
      ));
      total += snap.docs.filter((doc) => doc.data().isDeleted !== true).length;
    } catch {
      // skip
    }
  }
  return total;
}
