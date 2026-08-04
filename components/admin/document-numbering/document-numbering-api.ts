/**
 * Enterprise Document Numbering client API — mirrors approval-matrix-service patterns.
 * Wraps Cloud Functions until lib/admin/document-numbering-service.ts is fully aligned.
 */
import {
  collection, doc, getDoc, getDocs, onSnapshot, orderBy, query, where, limit,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from '@/lib/admin/constants';
import type { DocumentNumbering, DocumentNumberingFormData } from '@/lib/admin/schemas';
import {
  buildDocumentNumberPreview,
  exportDocumentNumberingsCsv,
  getDocumentNumberingSummaryCounts,
  normalizeDocumentNumbering,
  parseFormatTokens,
  seedDefaultDocumentNumberings as legacySeedDefaults,
  type DocumentNumberingAuditMeta,
} from '@/lib/admin/document-numbering-service';

export type { DocumentNumberingAuditMeta };
export {
  buildDocumentNumberPreview,
  exportDocumentNumberingsCsv,
  getDocumentNumberingSummaryCounts,
  normalizeDocumentNumbering,
  parseFormatTokens,
};

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

function mapDoc(snapshot: { id: string; data: () => Record<string, unknown> }): DocumentNumbering {
  return normalizeDocumentNumbering({ id: snapshot.id, ...snapshot.data() } as DocumentNumbering);
}

export function isNumberingActive(n: DocumentNumbering): boolean {
  return n.status === 'Active' && !n.isDeleted && !n.isArchived;
}

export function canDeleteNumberingRecord(n: DocumentNumbering): { allowed: boolean; reason?: string } {
  if (n.isDeleted) return { allowed: false, reason: 'Rule is already deleted.' };
  if (n.status === 'Active') return { allowed: false, reason: 'Deactivate rule before deleting.' };
  return { allowed: true };
}

export async function fetchDocumentNumberings(includeDeleted = false): Promise<DocumentNumbering[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.documentNumbering),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => mapDoc(document))
      .filter((n) => includeDeleted || !n.isDeleted);
  } catch (error) {
    console.error('fetchDocumentNumberings failed:', error);
    throw new Error('Unable to load document numbering rules.');
  }
}

export function subscribeToDocumentNumberings(
  includeDeleted: boolean,
  onData: (formats: DocumentNumbering[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const q = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.documentNumbering),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snapshot) => {
      const formats = snapshot.docs
        .map((document) => mapDoc(document))
        .filter((n) => includeDeleted || !n.isDeleted);
      onData(formats);
    },
    (error) => {
      console.error('subscribeToDocumentNumberings failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to document numbering rules'));
    },
  );
}

export async function fetchDocumentNumberingById(
  id: string,
  includeDeleted = false,
): Promise<DocumentNumbering | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.documentNumbering, id));
    if (!snapshot.exists()) return null;
    const format = mapDoc(snapshot);
    if (format.isDeleted && !includeDeleted) return null;
    return format;
  } catch (error) {
    console.error('fetchDocumentNumberingById failed:', error);
    throw new Error('Unable to load numbering rule details.');
  }
}

export async function createDocumentNumbering(
  data: DocumentNumberingFormData,
  meta: DocumentNumberingAuditMeta,
): Promise<{ format: DocumentNumbering | null; error: string | null }> {
  try {
    const fn = httpsCallable<Record<string, unknown>, DocumentNumbering>(
      getFirebaseFunctions(),
      'createAdminDocumentNumbering',
    );
    const response = await fn({
      ...data,
      reason: data.changeReason || 'Initial numbering rule registration',
      userId: meta.userId,
    });
    return { format: normalizeDocumentNumbering(response.data), error: null };
  } catch (error) {
    return { format: null, error: callableErrorMessage(error, 'Unable to create numbering rule') };
  }
}

export async function updateDocumentNumbering(
  id: string,
  data: DocumentNumberingFormData,
  _existing: DocumentNumbering,
  meta: DocumentNumberingAuditMeta,
): Promise<{ format: DocumentNumbering | null; error: string | null }> {
  try {
    const fn = httpsCallable<Record<string, unknown>, { format: DocumentNumbering }>(
      getFirebaseFunctions(),
      'updateAdminDocumentNumbering',
    );
    const response = await fn({
      numberingDocId: id,
      updates: data,
      reason: data.changeReason,
      userId: meta.userId,
    });
    return { format: normalizeDocumentNumbering(response.data.format), error: null };
  } catch (error) {
    return { format: null, error: callableErrorMessage(error, 'Unable to update numbering rule') };
  }
}

export async function setDocumentNumberingStatus(
  id: string,
  _format: DocumentNumbering,
  status: 'Active' | 'Inactive',
  _meta: DocumentNumberingAuditMeta,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminDocumentNumberingStatus');
    await fn({ numberingDocId: id, numberingStatus: status, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update rule status') };
  }
}

export async function archiveDocumentNumbering(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminDocumentNumbering');
    await fn({ numberingDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to archive rule') };
  }
}

export async function softDeleteDocumentNumbering(
  id: string,
  format: DocumentNumbering,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteNumberingRecord(format);
  if (!check.allowed) return { success: false, error: check.reason };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminDocumentNumbering');
    await fn({ numberingDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete rule') };
  }
}

export async function restoreDocumentNumbering(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'restoreAdminDocumentNumbering');
    await fn({ numberingDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore rule') };
  }
}

export async function cloneDocumentNumbering(
  id: string,
  newCode: string,
  newName: string,
  _meta: DocumentNumberingAuditMeta,
  reason: string,
): Promise<{ format: DocumentNumbering | null; error: string | null }> {
  try {
    const fn = httpsCallable<Record<string, unknown>, DocumentNumbering>(
      getFirebaseFunctions(),
      'cloneAdminDocumentNumbering',
    );
    const response = await fn({
      sourceNumberingDocId: id,
      newCode,
      newName,
      reason,
    });
    return { format: normalizeDocumentNumbering(response.data), error: null };
  } catch (error) {
    return { format: null, error: callableErrorMessage(error, 'Unable to clone rule') };
  }
}

export async function bulkUpdateDocumentNumberings(
  ids: string[],
  action: 'activate' | 'deactivate' | 'archive',
  reason: string,
  _meta: DocumentNumberingAuditMeta,
): Promise<{ successCount: number; errors?: string[]; error?: string }> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkUpdateAdminDocumentNumberings');
    const response = await fn({ numberingDocIds: ids, action, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkSoftDeleteDocumentNumberings(
  ids: string[],
  reason: string,
  _meta: DocumentNumberingAuditMeta,
): Promise<{ successCount: number; errors?: string[]; error?: string }> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminDocumentNumberings');
    const response = await fn({ numberingDocIds: ids, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

function rowToImportNumbering(cols: string[], headers: string[]): Record<string, string> | null {
  const idx = (name: string) => headers.findIndex((h) => h.includes(name));
  const code = cols[idx('code')] || cols[idx('numbering')] || '';
  if (!code) return null;
  return {
    numberingCode: code,
    moduleName: cols[idx('module')] || 'PQR',
    documentType: cols[idx('document')] || cols[idx('type')] || 'Report',
    prefix: cols[idx('prefix')] || code.split('-')[0] || 'DOC',
    siteCode: cols[idx('site')] || '',
    departmentCode: cols[idx('department')] || '',
    yearFormat: cols[idx('year')] || 'YYYY',
    separator: cols[idx('separator')] || '/',
    runningNumberLength: cols[idx('length')] || cols[idx('running')] || '4',
    resetFrequency: cols[idx('reset')] || 'Yearly',
    formatTokens: cols[idx('tokens')] || 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR',
    status: 'Inactive',
  };
}

export async function importDocumentNumberings(
  rows: Record<string, unknown>[],
  reason: string,
  meta: DocumentNumberingAuditMeta,
): Promise<{ imported: number; errors: string[] }> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { imported: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminDocumentNumberings');
    const response = await fn({ rows, reason, userId: meta.userId });
    return response.data;
  } catch (error) {
    return { imported: 0, errors: [callableErrorMessage(error, 'Import failed')] };
  }
}

export async function importDocumentNumberingsFromFile(
  file: File,
  meta: DocumentNumberingAuditMeta,
  reason = 'CSV document numbering import',
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
    const row = rowToImportNumbering(cols, headers);
    if (row) rows.push(row);
  }
  if (!rows.length) return { imported: 0, errors: ['No valid rows found'] };
  return importDocumentNumberings(rows, reason, meta);
}

export async function logDocumentNumberingExport(
  meta: DocumentNumberingAuditMeta,
  count: number,
  reason = 'Document numbering list export',
): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminDocumentNumberingExport');
    await fn({ count, reason, userId: meta.userId });
  } catch (error) {
    console.error('logDocumentNumberingExport failed:', error);
  }
}

export async function seedDefaultDocumentNumberings(
  meta: DocumentNumberingAuditMeta,
): Promise<{ created: number; skipped: number }> {
  return legacySeedDefaults(meta);
}

export async function previewDocumentNumber(
  moduleName: string,
  documentType: string,
  options?: { siteCode?: string; departmentCode?: string; productCode?: string; revision?: string },
): Promise<{ number: string; error?: string }> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { number: string }
    >(getFirebaseFunctions(), 'previewAdminDocumentNumber');
    const response = await fn({ moduleName, documentType, ...options });
    return { number: response.data.number };
  } catch (error) {
    return { number: '', error: callableErrorMessage(error, 'Preview failed') };
  }
}

export async function generateDocumentNumber(
  moduleName: string,
  documentType: string,
  options?: { increment?: boolean; preview?: boolean; siteCode?: string; departmentCode?: string },
): Promise<{ number: string; error?: string; preview?: boolean }> {
  try {
    const shouldIncrement = options?.increment === true && options?.preview !== true;
    const fn = httpsCallable<
      Record<string, unknown>,
      { number: string; preview?: boolean }
    >(getFirebaseFunctions(), 'generateAdminDocumentNumber');
    const response = await fn({
      moduleName,
      documentType,
      siteCode: options?.siteCode,
      departmentCode: options?.departmentCode,
      increment: shouldIncrement,
      preview: !shouldIncrement,
    });
    return response.data;
  } catch (error) {
    return { number: '', error: callableErrorMessage(error, 'Generate failed') };
  }
}

export async function listDocumentNumberHistory(
  numberingId?: string,
  formatId?: string,
): Promise<Record<string, unknown>[]> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { history: Record<string, unknown>[] }
    >(getFirebaseFunctions(), 'listAdminDocumentNumberHistory');
    const response = await fn({ numberingId, formatId });
    return response.data.history || [];
  } catch (error) {
    console.error('listDocumentNumberHistory failed:', error);
    return [];
  }
}

export async function fetchDocumentNumberingAudit(id: string): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured() || !id) return [];
  try {
    const firestore = getFirebaseFirestore();
    const [trailSnap, logsSnap] = await Promise.all([
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditTrail),
        where('documentId', '==', id),
        orderBy('timestamp', 'desc'),
        limit(30),
      )).catch(() => ({ docs: [] })),
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditLogs),
        where('recordId', '==', id),
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
    console.error('fetchDocumentNumberingAudit failed:', error);
    return [];
  }
}

export async function resetRunningNumber(
  id: string,
  format: DocumentNumbering,
  meta: DocumentNumberingAuditMeta,
  reason: string,
  resetTo = 0,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'resetAdminDocumentNumberingSequence');
    await fn({
      numberingDocId: id,
      resetTo,
      reason,
      userId: meta.userId,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to reset sequence') };
  }
}

export async function testGenerateNumber(
  format: DocumentNumbering,
  meta: DocumentNumberingAuditMeta,
): Promise<{ number: string; error?: string }> {
  const result = await previewDocumentNumber(format.moduleName, format.documentType, {
    siteCode: format.siteCode,
    departmentCode: format.departmentCode,
    productCode: format.productCodeOptional,
  });
  if (result.number) {
    await logDocumentNumberingExport(meta, 1, `Test preview for ${format.numberingCode}`);
  }
  return result;
}

export function getExtendedSummaryCounts(formats: DocumentNumbering[]) {
  const base = getDocumentNumberingSummaryCounts(formats.filter((n) => !n.isDeleted));
  return {
    ...base,
    archived: formats.filter((n) => n.isArchived && !n.isDeleted).length,
    deleted: formats.filter((n) => n.isDeleted).length,
  };
}

const INTEGRATION_MODULES = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Audit', 'Validation', 'CSV',
  'Equipment', 'Warehouse', 'eBMR', 'Batch', 'Product', 'Risk Management',
];

export function getNumberingIntegrationModules(format: DocumentNumbering): string[] {
  return INTEGRATION_MODULES.filter(
    (mod) => mod === format.moduleName || format.moduleName?.includes(mod),
  );
}
