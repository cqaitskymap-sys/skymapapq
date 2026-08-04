import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from './constants';
import type { DocumentNumbering, DocumentNumberingFormData } from './schemas';

export interface DocumentNumberingAuditMeta {
  userId: string;
  userName: string;
}

export interface GenerateDocumentNumberOptions {
  siteCode?: string;
  departmentCode?: string;
  productCode?: string;
  revision?: string;
  manualNumber?: string;
  allowManualOverride?: boolean;
  increment?: boolean;
  preview?: boolean;
  date?: Date | string;
}

export interface GenerateDocumentNumberResult {
  number: string;
  formatId?: string;
  error?: string;
  preview?: boolean;
  nextRunningNumber?: number;
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Set after first undeployed/CORS failure so we stop calling missing Cloud Functions. */
let documentNumberingCallablesUnavailable = false;
let warnedDocumentNumberingUnavailable = false;

function isCallableUnavailableError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || '').toLowerCase();
  const message = String((error as { message?: string })?.message || error || '').toLowerCase();
  return (
    code.includes('not-found')
    || code.includes('internal')
    || message.includes('not-found')
    || message.includes('cors')
    || message.includes('failed to fetch')
    || message.includes('network')
  );
}

function markDocumentNumberingUnavailable(context: string): void {
  documentNumberingCallablesUnavailable = true;
  if (!warnedDocumentNumberingUnavailable) {
    warnedDocumentNumberingUnavailable = true;
    console.warn(
      `[document-numbering] Cloud Function unavailable (${context}). ` +
        'Enable billing on apq-skymap and deploy generateAdminDocumentNumber. Using local fallbacks where available.',
    );
  }
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function buildNumberingId(code: string): string {
  return `NUM-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function parseFormatTokens(formatTokens: string): string[] {
  return formatTokens.split(',').map((t) => t.trim()).filter(Boolean);
}

export function formatYear(yearFormat: string, date: Date): string {
  if (yearFormat === 'None') return '';
  const y = date.getFullYear();
  return yearFormat === 'YY' ? String(y).slice(-2) : String(y);
}

export function formatMonth(monthFormat: string, date: Date): string {
  if (monthFormat === 'None') return '';
  const m = date.getMonth();
  if (monthFormat === 'MMM') return MONTH_ABBR[m];
  return String(m + 1).padStart(2, '0');
}

export function formatRevision(revisionFormat: string, revision?: string): string {
  if (revision) return revision;
  switch (revisionFormat) {
    case '01': return '01';
    case 'Rev-00': return 'Rev-00';
    case 'R00': return 'R00';
    case 'V1.0': return 'V1.0';
    case 'Custom': return '00';
    default: return '00';
  }
}

export function documentTypeToken(documentType: string): string {
  const map: Record<string, string> = {
    'CSV URS': 'URS', 'CSV IQ': 'IQ', 'CSV OQ': 'OQ', 'CSV PQ': 'PQ',
    'Validation Protocol': 'VAL', 'Validation Report': 'VAL',
  };
  if (map[documentType]) return map[documentType];
  const first = documentType.split(' ')[0] || documentType;
  return first.toUpperCase().slice(0, 6);
}

export function getSeparatorChar(separator: string): string {
  if (separator === 'None') return '';
  return separator;
}

export function buildDocumentNumberPreview(
  format: Partial<DocumentNumbering>,
  options?: {
    siteCode?: string;
    departmentCode?: string;
    productCode?: string;
    revision?: string;
    runningNumber?: number;
    date?: Date;
  },
): string {
  const date = options?.date ?? new Date();
  const tokens = parseFormatTokens(format.formatTokens || 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR');
  const sep = getSeparatorChar(format.separator || '/');
  const runLen = Number(format.runningNumberLength ?? format.runningNumber ?? 4);
  const runVal = options?.runningNumber ?? Number(format.currentRunningNumber ?? format.currentNumber ?? 0);
  const paddedRun = String(runVal).padStart(runLen, '0');
  const suffix = format.suffix || '';

  const parts = tokens.map((token) => {
    switch (token) {
      case 'PREFIX': return format.prefix || '';
      case 'SUFFIX': return suffix;
      case 'SITE_CODE': return options?.siteCode || format.siteCode || '';
      case 'DEPARTMENT_CODE': return options?.departmentCode || format.departmentCode || '';
      case 'PRODUCT_CODE': return options?.productCode || format.productCodeOptional || format.product || '';
      case 'DOCUMENT_TYPE': return documentTypeToken(format.documentType || '');
      case 'RUNNING_NUMBER': return paddedRun;
      case 'MONTH': return formatMonth(format.monthFormat || 'None', date);
      case 'YEAR': return formatYear(format.yearFormat || 'YYYY', date);
      case 'REVISION': return formatRevision(format.revisionFormat || '00', options?.revision);
      default: return '';
    }
  }).filter((p) => p !== '');

  if (suffix && !tokens.includes('SUFFIX')) {
    parts.push(suffix);
  }

  if (!sep) return parts.join('');
  return parts.join(sep);
}

export function getPeriodKey(resetFrequency: string, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  switch (resetFrequency) {
    case 'Yearly':
      return `${y}`;
    case 'Monthly':
      return `${y}-${m}`;
    case 'Daily':
      return `${y}-${m}-${d}`;
    default:
      return 'all';
  }
}

export function normalizeDocumentNumbering(n: DocumentNumbering): DocumentNumbering {
  const numberingId = n.numberingId || buildNumberingId(n.numberingCode || n.moduleName || 'NUM');
  const runLen = Number(n.runningNumberLength ?? n.runningNumber ?? 4);
  const currentRun = Number(n.currentRunningNumber ?? n.currentNumber ?? 0);
  const moduleName = n.moduleName || n.module || '';
  const numberingName = n.numberingName || n.numberingCode || numberingId;
  return {
    ...n,
    numberingId,
    numberingCode: n.numberingCode || numberingId.replace('NUM-', ''),
    numberingName,
    description: n.description || '',
    moduleName,
    module: moduleName,
    documentCategory: n.documentCategory || '',
    department: n.department || '',
    site: n.site || '',
    businessUnit: n.businessUnit || '',
    company: n.company || '',
    location: n.location || '',
    product: n.product || '',
    workflowCode: n.workflowCode || '',
    suffix: n.suffix || '',
    startingNumber: Number(n.startingNumber ?? 0),
    runningNumberLength: runLen,
    runningNumber: runLen,
    currentRunningNumber: currentRun,
    currentNumber: currentRun,
    exampleNumberPreview: n.exampleNumberPreview || n.exampleFormat || buildDocumentNumberPreview(n),
    exampleFormat: n.exampleNumberPreview || n.exampleFormat || buildDocumentNumberPreview(n),
    numberingVersion: n.numberingVersion || '1.0',
    autoGenerateEnabled: n.autoGenerateEnabled ?? true,
    manualOverrideAllowed: n.manualOverrideAllowed ?? false,
    allowSkipSequence: n.allowSkipSequence ?? false,
    formatTokens: n.formatTokens || 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR',
    monthFormat: (n.monthFormat as DocumentNumbering['monthFormat']) || 'None',
    revisionFormat: (n.revisionFormat as DocumentNumbering['revisionFormat']) || '00',
    isArchived: n.isArchived ?? false,
    isDeleted: Boolean(n.isDeleted),
  };
}

function mapNumberingDoc(snapshot: { id: string; data: () => Record<string, unknown> }): DocumentNumbering {
  return normalizeDocumentNumbering({ id: snapshot.id, ...snapshot.data() } as DocumentNumbering);
}

export function isNumberingActive(n: DocumentNumbering): boolean {
  return n.status === 'Active' && !n.isDeleted && !n.isArchived;
}

export async function fetchDocumentNumberings(includeDeleted = false): Promise<DocumentNumbering[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.documentNumbering),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => mapNumberingDoc(document))
      .filter((n) => includeDeleted || !n.isDeleted);
  } catch (error) {
    console.error('fetchDocumentNumberings failed:', error);
    throw new Error('Unable to load document numbering rules. Check your connection and permissions.');
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
  const numberingQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.documentNumbering),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    numberingQuery,
    (snapshot) => {
      const formats = snapshot.docs
        .map((document) => mapNumberingDoc(document))
        .filter((n) => includeDeleted || !n.isDeleted);
      onData(formats);
    },
    (error) => {
      console.error('subscribeToDocumentNumberings failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to document numbering'));
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
    const format = mapNumberingDoc(snapshot);
    if (format.isDeleted && !includeDeleted) return null;
    return format;
  } catch (error) {
    console.error('fetchDocumentNumberingById failed:', error);
    throw new Error('Unable to load numbering rule details.');
  }
}

export async function fetchActiveNumberingForModule(
  moduleName: string,
  documentType: string,
): Promise<DocumentNumbering | null> {
  if (!isFirebaseConfigured() || !moduleName) return null;
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.documentNumbering),
      where('moduleName', '==', moduleName),
      where('status', '==', 'Active'),
      limit(20),
    ));
    const formats = snapshot.docs
      .map((document) => mapNumberingDoc(document))
      .filter((n) => isNumberingActive(n));
    return formats.find((n) => n.documentType === documentType) ?? formats[0] ?? null;
  } catch {
    const all = await fetchDocumentNumberings();
    return all.find((n) =>
      isNumberingActive(n)
      && n.moduleName === moduleName
      && n.documentType === documentType,
    ) ?? null;
  }
}

export async function hasDuplicateActiveNumbering(
  moduleName: string,
  documentType: string,
  excludeId?: string,
): Promise<boolean> {
  const list = await fetchDocumentNumberings();
  return list.some((n) =>
    isNumberingActive(n)
    && n.moduleName === moduleName
    && n.documentType === documentType
    && n.id !== excludeId,
  );
}

export function getDocumentNumberingSummaryCounts(formats: DocumentNumbering[]) {
  const active = formats.filter((n) => !n.isDeleted);
  return {
    total: active.length,
    active: active.filter((n) => n.status === 'Active').length,
    inactive: active.filter((n) => n.status === 'Inactive').length,
    archived: active.filter((n) => n.isArchived).length,
    autoGenerateEnabled: active.filter((n) => n.autoGenerateEnabled).length,
    manualOverrideEnabled: active.filter((n) => n.manualOverrideAllowed).length,
    yearlyReset: active.filter((n) => n.resetFrequency === 'Yearly').length,
    monthlyReset: active.filter((n) => n.resetFrequency === 'Monthly').length,
    deleted: formats.filter((n) => n.isDeleted).length,
  };
}

export function getExtendedSummaryCounts(formats: DocumentNumbering[]) {
  return getDocumentNumberingSummaryCounts(formats);
}

export function getNumberingIntegrationModules(format: DocumentNumbering): string[] {
  const modules = [
    'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
    'Complaint', 'Recall', 'DMS', 'Audit', 'Validation', 'CSV',
    'Equipment', 'Warehouse', 'eBMR', 'Batch', 'Product', 'Risk Management',
  ];
  return modules.filter(
    (mod) => mod === format.moduleName || format.moduleName?.includes(mod),
  );
}

export function canDeleteNumberingRecord(format: DocumentNumbering): { allowed: boolean; reason?: string } {
  if (format.isDeleted) return { allowed: false, reason: 'Rule is already deleted.' };
  if (format.status === 'Active') {
    return { allowed: false, reason: 'Deactivate rule before deleting.' };
  }
  return { allowed: true };
}

export async function createDocumentNumbering(
  data: DocumentNumberingFormData,
  _meta: DocumentNumberingAuditMeta,
): Promise<{ format: DocumentNumbering | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, DocumentNumbering>(
      getFirebaseFunctions(),
      'createAdminDocumentNumbering',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason || 'Initial numbering rule registration',
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
  _meta: DocumentNumberingAuditMeta,
): Promise<{ format: DocumentNumbering | null; error: string | null }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { format: DocumentNumbering }
    >(getFirebaseFunctions(), 'updateAdminDocumentNumbering');
    const response = await updateFn({
      numberingDocId: id,
      updates: data,
      reason: data.changeReason,
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
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminDocumentNumbering');
    await deleteFn({ numberingDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete rule') };
  }
}

/** @deprecated use softDeleteDocumentNumbering */
export async function deleteDocumentNumbering(
  id: string,
  format: DocumentNumbering,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  return softDeleteDocumentNumbering(id, format, reason);
}

export async function restoreDocumentNumbering(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminDocumentNumbering');
    await restoreFn({ numberingDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore rule') };
  }
}

export async function cloneDocumentNumbering(
  sourceId: string,
  newCode: string,
  newName: string,
  _meta: DocumentNumberingAuditMeta,
  reason = 'Clone numbering rule',
): Promise<{ format: DocumentNumbering | null; error: string | null }> {
  try {
    const cloneFn = httpsCallable<Record<string, unknown>, DocumentNumbering>(
      getFirebaseFunctions(),
      'cloneAdminDocumentNumbering',
    );
    const response = await cloneFn({
      sourceNumberingDocId: sourceId,
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
  numberingIds: string[],
  action: 'activate' | 'deactivate' | 'archive',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminDocumentNumberings');
    const response = await bulkFn({ numberingDocIds: numberingIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkSoftDeleteDocumentNumberings(
  numberingIds: string[],
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminDocumentNumberings');
    const response = await bulkFn({ numberingDocIds: numberingIds, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

export async function resetRunningNumber(
  id: string,
  _format: DocumentNumbering,
  _meta: DocumentNumberingAuditMeta,
  reason: string,
  resetTo = 0,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'resetAdminDocumentNumberingSequence');
    await fn({ numberingDocId: id, resetTo, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to reset sequence') };
  }
}

export async function testGenerateNumber(
  format: DocumentNumbering,
  _meta?: DocumentNumberingAuditMeta,
): Promise<GenerateDocumentNumberResult> {
  return previewDocumentNumber(format.moduleName, format.documentType, {
    siteCode: format.siteCode,
    departmentCode: format.departmentCode,
    productCode: format.productCodeOptional || format.product,
  });
}

export async function generateDocumentNumber(
  moduleName: string,
  documentType: string,
  options: GenerateDocumentNumberOptions = {},
): Promise<GenerateDocumentNumberResult> {
  if (documentNumberingCallablesUnavailable) {
    return {
      number: '',
      error: `Unable to generate number for ${moduleName} / ${documentType}`,
    };
  }
  try {
    // Mutate sequence only when increment is explicitly true
    const shouldIncrement = options.increment === true && options.preview !== true;
    const fn = httpsCallable<
      Record<string, unknown>,
      GenerateDocumentNumberResult
    >(getFirebaseFunctions(), 'generateAdminDocumentNumber');
    const response = await fn({
      moduleName,
      documentType,
      siteCode: options.siteCode,
      departmentCode: options.departmentCode,
      productCode: options.productCode,
      revision: options.revision,
      manualNumber: options.manualNumber,
      allowManualOverride: options.allowManualOverride,
      preview: !shouldIncrement,
      increment: shouldIncrement,
      date: options.date instanceof Date ? options.date.toISOString() : options.date,
    });
    return response.data;
  } catch (error) {
    if (isCallableUnavailableError(error)) {
      markDocumentNumberingUnavailable('generateAdminDocumentNumber');
    }
    return {
      number: '',
      error: callableErrorMessage(error, `Unable to generate number for ${moduleName} / ${documentType}`),
    };
  }
}

export async function previewDocumentNumber(
  moduleName: string,
  documentType: string,
  options: GenerateDocumentNumberOptions = {},
): Promise<GenerateDocumentNumberResult> {
  if (documentNumberingCallablesUnavailable) {
    return {
      number: '',
      preview: true,
      error: `Unable to preview number for ${moduleName} / ${documentType}`,
    };
  }
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      GenerateDocumentNumberResult
    >(getFirebaseFunctions(), 'previewAdminDocumentNumber');
    const response = await fn({
      moduleName,
      documentType,
      siteCode: options.siteCode,
      departmentCode: options.departmentCode,
      productCode: options.productCode,
      revision: options.revision,
      date: options.date instanceof Date ? options.date.toISOString() : options.date,
    });
    return { ...response.data, preview: true };
  } catch (error) {
    if (isCallableUnavailableError(error)) {
      markDocumentNumberingUnavailable('previewAdminDocumentNumber');
      return {
        number: '',
        preview: true,
        error: callableErrorMessage(error, `Unable to preview number for ${moduleName} / ${documentType}`),
      };
    }
    // Fallback to generate with preview flag
    return generateDocumentNumber(moduleName, documentType, { ...options, preview: true, increment: false });
  }
}

export async function listDocumentNumberHistory(
  numberingId?: string,
  formatId?: string,
): Promise<Array<Record<string, unknown> & { id: string }>> {
  try {
    const fn = httpsCallable<
      Record<string, unknown>,
      { history: Array<Record<string, unknown> & { id: string }> }
    >(getFirebaseFunctions(), 'listAdminDocumentNumberHistory');
    const response = await fn({ numberingId, formatId });
    return response.data.history || [];
  } catch (error) {
    console.error('listDocumentNumberHistory failed:', error);
    return [];
  }
}

export async function fetchDocumentNumberingAuditTrail(recordId: string) {
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
    console.error('fetchDocumentNumberingAuditTrail failed:', error);
    return [];
  }
}

/** Alias used by UI */
export async function fetchDocumentNumberingAudit(recordId: string) {
  return fetchDocumentNumberingAuditTrail(recordId);
}

export function exportDocumentNumberingsCsv(formats: DocumentNumbering[]): string {
  const headers = [
    'Numbering Code', 'Numbering Name', 'Module', 'Document Type', 'Category',
    'Department', 'Site', 'Business Unit', 'Prefix', 'Suffix', 'Site Code', 'Department Code',
    'Year Format', 'Month Format', 'Separator', 'Running Length', 'Starting Number',
    'Current Number', 'Reset Frequency', 'Revision Format', 'Format Tokens', 'Example Preview',
    'Version', 'Auto Generate', 'Manual Override', 'Allow Skip', 'Status', 'Archived',
  ];
  const rows = formats.map((n) => [
    n.numberingCode,
    n.numberingName,
    n.moduleName,
    n.documentType,
    n.documentCategory,
    n.department,
    n.site,
    n.businessUnit,
    n.prefix,
    n.suffix,
    n.siteCode,
    n.departmentCode,
    n.yearFormat,
    n.monthFormat,
    n.separator,
    String(n.runningNumberLength),
    String(n.startingNumber ?? 0),
    String(n.currentRunningNumber),
    n.resetFrequency,
    n.revisionFormat,
    n.formatTokens,
    n.exampleNumberPreview,
    n.numberingVersion,
    n.autoGenerateEnabled ? 'Yes' : 'No',
    n.manualOverrideAllowed ? 'Yes' : 'No',
    n.allowSkipSequence ? 'Yes' : 'No',
    n.status,
    n.isArchived ? 'Yes' : 'No',
  ].map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export async function logDocumentNumberingExport(
  meta: DocumentNumberingAuditMeta,
  count: number,
  reason = 'Numbering list export',
): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminDocumentNumberingExport');
    await fn({ count, reason, userId: meta.userId });
  } catch (error) {
    console.error('logDocumentNumberingExport failed:', error);
  }
}

function rowToImportNumbering(cols: string[], headers: string[]): Record<string, string> | null {
  const idx = (name: string) => headers.findIndex((h) => h.includes(name));
  const code = cols[idx('code')] || '';
  if (!code) return null;
  return {
    numberingCode: code,
    numberingName: cols[idx('name')] || code,
    moduleName: cols[idx('module')] || 'PQR',
    documentType: cols[idx('document')] || cols[idx('type')] || 'PQR Report',
    prefix: cols[idx('prefix')] || code.split('-')[0] || 'DOC',
    departmentCode: cols[idx('department')] || 'QA',
    siteCode: cols[idx('site')] || '',
    formatTokens: cols[idx('format')] || 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR',
    separator: cols[idx('separator')] || '/',
    yearFormat: cols[idx('year')] || 'YYYY',
    resetFrequency: cols[idx('reset')] || 'Yearly',
  };
}

export async function importDocumentNumberings(
  rows: Record<string, unknown>[],
  reason = 'CSV numbering import',
): Promise<{ imported: number; errors: string[] }> {
  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { imported: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminDocumentNumberings');
    const response = await importFn({ rows, reason });
    return response.data;
  } catch (error) {
    return { imported: 0, errors: [callableErrorMessage(error, 'Import failed')] };
  }
}

export async function importDocumentNumberingsFromFile(
  file: File,
  meta: DocumentNumberingAuditMeta,
  reason = 'CSV numbering import',
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
  return importDocumentNumberings(rows, reason || `Import by ${meta.userName}`);
}

export const DEFAULT_NUMBERING_PRESETS: DocumentNumberingFormData[] = [
  {
    numberingCode: 'PQR-REPORT', numberingName: 'PQR Report Numbering', description: 'Default PQR',
    moduleName: 'PQR', documentType: 'Annual PQR', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: 'PQR-DEFAULT',
    prefix: 'PQR', suffix: '', siteCode: 'HMF', departmentCode: '0041', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 3, startingNumber: 0,
    currentRunningNumber: 40, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,SITE_CODE,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: 'Default PQR numbering', changeReason: 'Seed default',
  },
  {
    numberingCode: 'DEV-REPORT', numberingName: 'Deviation Numbering', description: 'GMP Deviation',
    moduleName: 'Deviation', documentType: 'GMP Deviation', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: 'DEV-DEFAULT',
    prefix: 'DEV', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: 'Default deviation numbering', changeReason: 'Seed default',
  },
  {
    numberingCode: 'OOS-INV', numberingName: 'OOS Investigation Numbering', description: 'OOS',
    moduleName: 'OOS', documentType: 'OOS Investigation', documentCategory: 'Quality', department: 'QC',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: 'OOS-DEFAULT',
    prefix: 'OOS', suffix: '', siteCode: '', departmentCode: 'QC', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
  {
    numberingCode: 'CAPA-REPORT', numberingName: 'CAPA Numbering', description: 'CAPA / Corrective Action',
    moduleName: 'CAPA', documentType: 'Corrective Action', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: 'CAPA-DEFAULT',
    prefix: 'CAPA', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
  {
    numberingCode: 'CC-CTRL', numberingName: 'Change Control Numbering', description: 'Change Control',
    moduleName: 'Change Control', documentType: 'Change Control', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: 'CC-DEFAULT',
    prefix: 'CC', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
  {
    numberingCode: 'CMP-MKT', numberingName: 'Complaint Numbering', description: 'Market Complaint',
    moduleName: 'Complaint', documentType: 'Market Complaint', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: '',
    prefix: 'CMP', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
  {
    numberingCode: 'REC-PROD', numberingName: 'Recall Numbering', description: 'Product Recall',
    moduleName: 'Recall', documentType: 'Product Recall', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: '',
    prefix: 'REC', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
  {
    numberingCode: 'RISK-ASM', numberingName: 'Risk Assessment Numbering', description: 'Risk',
    moduleName: 'Risk Management', documentType: 'Risk Assessment', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: '',
    prefix: 'RISK', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
  {
    numberingCode: 'SOP-DOC', numberingName: 'SOP Numbering', description: 'DMS SOP',
    moduleName: 'DMS', documentType: 'SOP', documentCategory: 'Document', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: 'DMS-DEFAULT',
    prefix: 'SOP', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'None', monthFormat: 'None', separator: '/', runningNumberLength: 3, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Never', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,REVISION', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: true,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
  {
    numberingCode: 'AUD-FIND', numberingName: 'Audit Numbering', description: 'Audit',
    moduleName: 'Audit', documentType: 'Audit Report', documentCategory: 'Quality', department: 'QA',
    site: '', businessUnit: '', company: '', location: '', product: '', workflowCode: '',
    prefix: 'AUD', suffix: '', siteCode: '', departmentCode: 'QA', productCodeOptional: '',
    yearFormat: 'YYYY', monthFormat: 'None', separator: '/', runningNumberLength: 4, startingNumber: 0,
    currentRunningNumber: 0, resetFrequency: 'Yearly', revisionFormat: '00',
    formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', numberingVersion: '1.0',
    effectiveDate: '', reviewDate: '', autoGenerateEnabled: true, manualOverrideAllowed: false,
    allowSkipSequence: false, remarks: '', changeReason: 'Seed default',
  },
];

export async function seedDefaultDocumentNumberings(
  meta: DocumentNumberingAuditMeta,
  reason = 'Seed default numbering rules',
): Promise<{ created: number; skipped: number }> {
  try {
    const seedFn = httpsCallable<
      Record<string, unknown>,
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminDefaultDocumentNumberings');
    const response = await seedFn({
      presets: DEFAULT_NUMBERING_PRESETS,
      reason,
      userId: meta.userId,
    });
    return response.data;
  } catch (error) {
    console.error('seedDefaultDocumentNumberings failed:', error);
    return { created: 0, skipped: DEFAULT_NUMBERING_PRESETS.length };
  }
}
