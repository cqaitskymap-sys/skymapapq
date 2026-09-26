import {
  collection, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS, MASTER_DATA_IMPORT_EXPORT_TYPES } from './constants';
import type { MasterDataImportExport } from './schemas';

export interface MasterDataImpexAuditMeta {
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

export function getMasterDataTypeOptions() {
  return MASTER_DATA_IMPORT_EXPORT_TYPES.map((t) => ({
    value: t.code,
    label: t.label,
    collection: t.collection,
    uniqueKey: t.uniqueKey,
    required: [...t.required],
  }));
}

export function normalizeImpexOperation(row: MasterDataImportExport): MasterDataImportExport {
  return {
    ...row,
    successCount: Number(row.successCount || 0),
    errorCount: Number(row.errorCount || 0),
    skippedCount: Number(row.skippedCount || 0),
    recordCount: Number(row.recordCount || 0),
    operationStatus: row.operationStatus || 'Queued',
    fileFormat: row.fileFormat || 'JSON',
  };
}

export function getImpexSummary(rows: MasterDataImportExport[]) {
  return {
    total: rows.length,
    imports: rows.filter((r) => r.operationType === 'Import').length,
    exports: rows.filter((r) => r.operationType === 'Export').length,
    failed: rows.filter((r) => r.operationStatus === 'Failed').length,
    success: rows.filter((r) => r.operationStatus === 'Success').length,
    partial: rows.filter((r) => r.operationStatus === 'Partial Success').length,
  };
}

export async function fetchImpexOperations(): Promise<MasterDataImportExport[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.masterDataImportExport),
      orderBy('operationDate', 'desc'),
      limit(300),
    ));
    return snap.docs
      .map((d) => normalizeImpexOperation({ id: d.id, ...d.data() } as MasterDataImportExport))
      .filter((r) => !r.isDeleted);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.masterDataImportExport));
      return snap.docs
        .map((d) => normalizeImpexOperation({ id: d.id, ...d.data() } as MasterDataImportExport))
        .filter((r) => !r.isDeleted)
        .sort((a, b) => String(b.operationDate || '').localeCompare(String(a.operationDate || '')));
    } catch {
      return [];
    }
  }
}

export function subscribeToImpexOperations(
  onData: (rows: MasterDataImportExport[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.masterDataImportExport), limit(300)),
    (snapshot) => {
      onData(snapshot.docs
        .map((d) => normalizeImpexOperation({ id: d.id, ...d.data() } as MasterDataImportExport))
        .filter((r) => !r.isDeleted)
        .sort((a, b) => String(b.operationDate || '').localeCompare(String(a.operationDate || ''))));
    },
    (error) => onError?.(new Error(error.message)),
  );
}

export async function fetchImpexErrors(operationDocId: string): Promise<Array<Record<string, unknown>>> {
  if (!isFirebaseConfigured() || !operationDocId) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.masterDataImportExportErrors),
      where('operationDocId', '==', operationDocId),
      limit(100),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/** Parse uploaded text as JSON array, CSV, or TSV (first row headers). */
export function parseImportFile(text: string, fileName: string): {
  rows: Array<Record<string, unknown>>;
  format: 'JSON' | 'CSV';
  error?: string;
} {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return { rows: [], format: 'JSON', error: 'File is empty' };

  const lower = fileName.toLowerCase();
  const isDelimited = lower.endsWith('.csv') || lower.endsWith('.tsv')
    || (!trimmed.startsWith('[') && !trimmed.startsWith('{'));

  if (isDelimited) {
    const delimiter = lower.endsWith('.tsv') || (!lower.endsWith('.csv') && trimmed.includes('\t') && !trimmed.includes(','))
      ? '\t'
      : ',';
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      return { rows: [], format: 'CSV', error: 'Delimited file requires header + at least one data row' };
    }
    const parseDelimitedLine = (line: string): string[] => {
      if (delimiter === '\t') return line.split('\t').map((c) => c.trim());
      const cells: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { cur += '"'; i += 1; }
          else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          cells.push(cur); cur = '';
        } else cur += ch;
      }
      cells.push(cur);
      return cells.map((c) => c.trim());
    };
    const headers = parseDelimitedLine(lines[0]);
    const headerSet = new Set<string>();
    for (const h of headers) {
      if (!h) return { rows: [], format: 'CSV', error: 'Empty column header detected' };
      if (headerSet.has(h)) return { rows: [], format: 'CSV', error: `Duplicate column: ${h}` };
      headerSet.add(h);
    }
    const rows = lines.slice(1).map((line) => {
      const cells = parseDelimitedLine(line);
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
      return row;
    });
    return { rows, format: 'CSV' };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return { rows: [], format: 'JSON', error: 'JSON root must be an array of records' };
    return { rows: parsed as Array<Record<string, unknown>>, format: 'JSON' };
  } catch {
    return { rows: [], format: 'JSON', error: 'Invalid JSON' };
  }
}

export async function exportMasterData(input: {
  masterType: string;
  format: 'JSON' | 'CSV';
  changeReason: string;
}): Promise<{
  records?: Array<Record<string, unknown>>;
  csv?: string;
  fileName?: string;
  count?: number;
  error?: string;
}> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'exportAdminMasterData');
    const result = await fn(input);
    return result.data as {
      records: Array<Record<string, unknown>>;
      csv: string;
      fileName: string;
      count: number;
    };
  } catch (e) {
    return { error: callableErrorMessage(e, 'Export failed') };
  }
}

export async function validateMasterDataImport(input: {
  masterType: string;
  rows: Array<Record<string, unknown>>;
  fileName?: string;
  fileFormat?: string;
  changeReason: string;
}): Promise<{
  valid?: number;
  errorCount?: number;
  duplicates?: number;
  errors?: string[];
  preview?: Array<Record<string, unknown>>;
  error?: string;
}> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'validateAdminMasterDataImport');
    const result = await fn(input);
    return result.data as {
      valid: number;
      errorCount: number;
      duplicates: number;
      errors: string[];
      preview: Array<Record<string, unknown>>;
    };
  } catch (e) {
    return { error: callableErrorMessage(e, 'Validation failed') };
  }
}

export async function importMasterData(input: {
  masterType: string;
  rows: Array<Record<string, unknown>>;
  importMode: string;
  fileName?: string;
  fileFormat?: string;
  changeReason: string;
}): Promise<{
  successCount?: number;
  errorCount?: number;
  skippedCount?: number;
  errors?: string[];
  status?: string;
  dryRun?: boolean;
  error?: string;
}> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'importAdminMasterData');
    const result = await fn(input);
    return result.data as {
      successCount: number;
      errorCount: number;
      skippedCount: number;
      errors: string[];
      status: string;
      dryRun: boolean;
    };
  } catch (e) {
    return { error: callableErrorMessage(e, 'Import failed') };
  }
}

export function downloadTextFile(content: string, fileName: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
