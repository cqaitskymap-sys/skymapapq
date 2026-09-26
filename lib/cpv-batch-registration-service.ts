import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchBatches as fetchAdminBatches, normalizeBatch } from '@/lib/admin/batch-service';
import { fetchCpvProducts, fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational, type CpvProductRecord } from '@/lib/cpv-product-master';
import type { AdminBatch } from '@/lib/admin/schemas';
import {
  CPV_BATCH_COLLECTION,
  buildCpvBatchId,
  toMonthYearValue,
  type CpvBatchFormData,
  type CpvBatchRecord,
} from '@/lib/cpv-batch-registration';

const LEGACY_COLLECTION = 'batches';

export interface CpvBatchActor {
  id: string;
  name: string;
}

function str(v: unknown, fallback = ''): string {
  if (v === null || v === undefined) return fallback;
  return String(v);
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function cfErrorMessage(e: unknown, fallback: string): string {
  const localhost = typeof window !== 'undefined'
    && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    const code = String((e as { code?: string }).code || '');
    if (
      localhost
      && (code === 'functions/internal' || /cors|preflight|access-control-allow-origin/i.test(msg))
    ) {
      return 'Cloud Function call failed from localhost. Verify createAdminCpvBatch is deployed in project apq-skymap and NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION matches deployed region, then restart dev server.';
    }
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '').trim() || fallback;
  }
  return fallback;
}

export function normalizeCpvBatch(raw: Record<string, unknown>): CpvBatchRecord {
  const batchNumber = str(raw.batchNumber || raw.batch_number || raw.batchNo);
  return {
    id: str(raw.id),
    cpvBatchId: str(raw.cpvBatchId || raw.cpv_batch_id, buildCpvBatchId(batchNumber)),
    recordType: str(raw.recordType, 'cpv_batch'),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id || raw.productId),
    batchNumber,
    batchCode: str(raw.batchCode || raw.batch_code, buildCpvBatchId(batchNumber)),
    productCode: str(raw.productCode || raw.product_code),
    productName: str(raw.productName || raw.product_name),
    productVersion: str(raw.productVersion),
    productCategory: str(raw.productCategory),
    genericName: str(raw.genericName || raw.generic_name),
    strength: str(raw.strength),
    dosageForm: str(raw.dosageForm || raw.dosage_form),
    packSize: str(raw.packSize || raw.pack_size),
    market: str(raw.market),
    batchSize: num(raw.batchSize ?? raw.batch_size, 0),
    targetBatchSize: str(raw.targetBatchSize),
    actualBatchSize: str(raw.actualBatchSize),
    batchSizeUnit: (str(raw.batchSizeUnit || raw.batch_size_unit || raw.unit, 'Vials') as CpvBatchRecord['batchSizeUnit']),
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
    expiryDate: str(raw.expiryDate || raw.expiry_date),
    retestDate: str(raw.retestDate),
    shelfLifeMonths: str(raw.shelfLifeMonths),
    manufacturingEndDate: str(raw.manufacturingEndDate),
    packagingStartDate: str(raw.packagingStartDate),
    packagingEndDate: str(raw.packagingEndDate),
    manufacturingSite: str(raw.manufacturingSite || raw.manufacturing_site || raw.site),
    plant: str(raw.plant),
    manufacturingLine: str(raw.manufacturingLine || raw.manufacturing_line || raw.lineNumber),
    department: str(raw.department),
    shift: str(raw.shift, 'A'),
    campaign: str(raw.campaign),
    manufacturingOrderNumber: str(raw.manufacturingOrderNumber),
    workOrderNumber: str(raw.workOrderNumber),
    mfrNumber: str(raw.mfrNumber || raw.mfr_number),
    bmrNumber: str(raw.bmrNumber || raw.bmr_number),
    bprNumber: str(raw.bprNumber || raw.bpr_number),
    semiFinishedBatchNumber: str(raw.semiFinishedBatchNumber || raw.semi_finished_batch_number),
    finishedProductBatchNumber: str(raw.finishedProductBatchNumber || raw.finished_product_batch_number),
    packingBatchNumber: str(raw.packingBatchNumber || raw.packing_batch_number),
    manufacturedFor: str(raw.manufacturedFor || raw.manufactured_for),
    customerName: str(raw.customerName || raw.customer_name),
    goldenBatchNumber: str(raw.goldenBatchNumber),
    cpvReviewPeriod: (str(raw.cpvReviewPeriod || raw.cpv_review_period, 'Yearly') as CpvBatchRecord['cpvReviewPeriod']),
    batchStatus: (str(raw.batchStatus || raw.batch_status || raw.status, 'Planned') as CpvBatchRecord['batchStatus']),
    releaseStatus: (str(raw.releaseStatus || raw.release_status, 'Pending') as CpvBatchRecord['releaseStatus']),
    qaReleaseDate: str(raw.qaReleaseDate || raw.qa_release_date || raw.releaseDate),
    qaReleasedBy: str(raw.qaReleasedBy || raw.qa_released_by),
    statusChangeReason: str(raw.statusChangeReason || raw.status_change_reason || raw.reason),
    description: str(raw.description),
    remarks: str(raw.remarks),
    specificationNumber: str(raw.specificationNumber || raw.specification_number),
    stpNumber: str(raw.stpNumber || raw.stp_number),
    equipmentIds: Array.isArray(raw.equipmentIds) ? raw.equipmentIds.map(String) : [],
    operatorIds: Array.isArray(raw.operatorIds) ? raw.operatorIds.map(String) : [],
    linkedCppParameterIds: Array.isArray(raw.linkedCppParameterIds) ? raw.linkedCppParameterIds.map(String) : [],
    linkedCqaParameterIds: Array.isArray(raw.linkedCqaParameterIds) ? raw.linkedCqaParameterIds.map(String) : [],
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName || raw.created_by_name),
    updatedByName: str(raw.updatedByName || raw.updated_by_name),
    isDeleted: Boolean(raw.isDeleted),
    status: str(raw.status || raw.batchStatus),
    changeReason: str(raw.changeReason),
  };
}

export function cpvProductToBatchAutofill(product: CpvProductRecord): Partial<CpvBatchFormData> {
  return {
    cpvProductId: product.id,
    productCode: product.productCode,
    productName: product.productName,
    productVersion: product.version || '',
    productCategory: product.productCategory || '',
    genericName: product.genericName || '',
    strength: product.strength || '',
    dosageForm: product.dosageForm || '',
    packSize: product.packSize || '',
    market: product.market || '',
    batchSize: Number(product.standardBatchSize) || undefined,
    mfrNumber: product.mfrNumber || '',
    bmrNumber: product.bmrNumber || '',
    bprNumber: product.bprNumber || '',
    manufacturingSite: product.manufacturingSite || '',
    cpvReviewPeriod: product.cpvReviewFrequency,
  };
}

export function adminBatchToCpvForm(batch: AdminBatch, cpvProductId = ''): Partial<CpvBatchFormData> {
  const b = normalizeBatch(batch);
  return {
    cpvProductId,
    batchNumber: b.batchNumber,
    productCode: b.productCode,
    productName: b.productName,
    genericName: b.genericName || '',
    strength: b.strength || '',
    dosageForm: b.dosageForm || '',
    market: b.market || '',
    batchSize: Number(b.batchSize) || undefined,
    batchSizeUnit: (b.batchSizeUnit || 'Vials') as CpvBatchFormData['batchSizeUnit'],
    manufacturingDate: toMonthYearValue(b.manufacturingDate || ''),
    expiryDate: toMonthYearValue(b.expiryDate || ''),
    manufacturingSite: b.manufacturingSite || '',
    manufacturingLine: b.manufacturingLine || '',
    shift: b.shift || 'A',
    mfrNumber: b.mfrNumber || '',
    bmrNumber: b.bmrNumber || '',
    bprNumber: b.bprNumber || '',
    semiFinishedBatchNumber: b.semiFinishedBatchNumber || '',
    finishedProductBatchNumber: b.finishedProductBatchNumber || '',
    packingBatchNumber: b.packingBatchNumber || '',
    manufacturedFor: b.manufacturedFor || '',
    customerName: b.customerName || '',
    batchStatus: 'Planned',
    releaseStatus: 'Pending',
    qaReleaseDate: '',
    qaReleasedBy: '',
    remarks: b.remarks || '',
  };
}

export async function fetchCpvBatches(): Promise<CpvBatchRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const primary = await getRecords<CpvBatchRecord>(CPV_BATCH_COLLECTION);
    const normalized = primary
      .map((r) => normalizeCpvBatch(r as unknown as Record<string, unknown>))
      .filter((b) => !b.isDeleted && b.batchNumber);
    if (normalized.length) return normalized;

    const snap = await getDocs(query(collection(getFirebaseFirestore(), LEGACY_COLLECTION), limit(500)));
    return snap.docs
      .map((d) => normalizeCpvBatch({ id: d.id, ...d.data() }))
      .filter((b) => b.batchNumber && !b.isDeleted);
  } catch (e) {
    console.error('fetchCpvBatches failed', e);
    return [];
  }
}

export function filterCpvBatchesForProduct(
  batches: CpvBatchRecord[],
  productName: string,
  cpvProductId = '',
): CpvBatchRecord[] {
  return batches.filter((b) => {
    if (cpvProductId && b.cpvProductId) return b.cpvProductId === cpvProductId;
    return b.productName === productName || b.productCode === productName;
  });
}

/** Client guard used before monitoring writes. Returns an error message, or null when the batch is valid. */
export async function clientBatchErrorForProduct(
  productName: string,
  cpvProductId: string,
  batchNumber: string,
): Promise<string | null> {
  const batches = filterCpvBatchesForProduct(await fetchCpvBatches(), productName, cpvProductId);
  const match = batches.find((b) => b.batchNumber === batchNumber);
  if (!match) return 'Batch does not belong to selected product.';
  if (['Cancelled', 'Closed', 'Rejected', 'Archived'].includes(match.batchStatus)) {
    return 'Closed, rejected, or archived batch — entry not allowed.';
  }
  return null;
}

export async function fetchCpvBatchById(id: string): Promise<CpvBatchRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const record = await getRecord<CpvBatchRecord>(CPV_BATCH_COLLECTION, id);
    if (!record) {
      const all = await fetchCpvBatches();
      return all.find((b) => b.id === id) ?? null;
    }
    const normalized = normalizeCpvBatch(record as unknown as Record<string, unknown>);
    if (normalized.isDeleted) return null;
    return normalized;
  } catch (e) {
    console.error('fetchCpvBatchById failed', e);
    return null;
  }
}

export async function isDuplicateBatchNumber(batchNumber: string, excludeId?: string): Promise<boolean> {
  const batches = await fetchCpvBatches();
  return batches.some((b) => {
    if (excludeId && b.id === excludeId) return false;
    return b.batchNumber.toLowerCase() === batchNumber.toLowerCase();
  });
}

export async function fetchAdminBatchesForImport(): Promise<AdminBatch[]> {
  try {
    return await fetchAdminBatches();
  } catch {
    return [];
  }
}

export async function fetchActiveCpvProductsForBatch(): Promise<CpvProductRecord[]> {
  const products = await fetchCpvProducts();
  return products.filter((p) => isCpvProductOperational(p.cpvStatus));
}

async function safeQuery(name: string, max = 100): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch {
      return [];
    }
  }
}

export async function fetchBatchCppResults(batch: CpvBatchRecord): Promise<Record<string, unknown>[]> {
  const nums = [batch.batchNumber, batch.finishedProductBatchNumber].filter(Boolean);
  const cols = ['cpp_results', 'cpv_cpp'];
  const merged: Record<string, unknown>[] = [];
  for (const col of cols) {
    const rows = await safeQuery(col, 200);
    merged.push(...rows.filter((r) => nums.includes(str(r.batchNo || r.batch_no || r.batch_number))));
  }
  return merged.slice(0, 100);
}

export async function fetchBatchCqaResults(batch: CpvBatchRecord): Promise<Record<string, unknown>[]> {
  const nums = [batch.batchNumber, batch.finishedProductBatchNumber].filter(Boolean);
  const cols = ['cqa_results', 'cpv_cqa'];
  const merged: Record<string, unknown>[] = [];
  for (const col of cols) {
    const rows = await safeQuery(col, 200);
    merged.push(...rows.filter((r) => nums.includes(str(r.batchNo || r.batch_no || r.batch_number))));
  }
  return merged.slice(0, 100);
}

export async function fetchBatchYieldResults(batch: CpvBatchRecord): Promise<Record<string, unknown>[]> {
  const rows = await safeQuery('yield_monitoring', 100);
  return rows.filter((r) => str(r.batchNo || r.batch_no) === batch.batchNumber);
}

export async function fetchBatchStabilityLinks(batch: CpvBatchRecord): Promise<Record<string, unknown>[]> {
  const cols = ['stability_studies', 'cpv_stability_studies'];
  const merged: Record<string, unknown>[] = [];
  for (const col of cols) {
    const rows = await safeQuery(col, 50);
    merged.push(...rows.filter((r) => str(r.batchNo || r.batch_number) === batch.batchNumber));
  }
  return merged;
}

export async function fetchBatchRiskSummary(batch: CpvBatchRecord): Promise<Record<string, unknown>[]> {
  const rows = await safeQuery('risk_assessment', 50);
  return rows.filter((r) => str(r.batchNo || r.batch_no) === batch.batchNumber);
}

export async function fetchBatchAuditTrail(recordId: string): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('documentId', '==', recordId), limit(50)));
    if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const snap2 = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('recordId', '==', recordId), limit(50)));
    return snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const all = await safeQuery('audit_trail', 100);
    return all.filter((r) => str(r.documentId || r.recordId) === recordId);
  }
}

export async function createCpvBatch(
  data: CpvBatchFormData,
  _actor: CpvBatchActor,
): Promise<{ batch: CpvBatchRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { batch: null, error: 'Firebase is not configured.' };
  try {
    if (await isDuplicateBatchNumber(data.batchNumber)) {
      return { batch: null, error: 'A batch with this number already exists.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { batch: null, error: 'Selected CPV product is not operational for batch registration.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminCpvBatch',
    );
    const result = await fn({ ...data, changeReason: data.changeReason });
    return { batch: normalizeCpvBatch(result.data), error: null };
  } catch (e) {
    console.error('createCpvBatch failed', e);
    return { batch: null, error: cfErrorMessage(e, 'Failed to create CPV batch.') };
  }
}

export async function updateCpvBatch(
  id: string,
  data: Partial<CpvBatchFormData>,
  _actor: CpvBatchActor,
  existing: CpvBatchRecord,
): Promise<{ batch: CpvBatchRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { batch: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { batch: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (data.batchNumber && await isDuplicateBatchNumber(data.batchNumber, id)) {
      return { batch: null, error: 'A batch with this number already exists.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminCpvBatch',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
    });
    return { batch: normalizeCpvBatch(result.data), error: null };
  } catch (e) {
    console.error('updateCpvBatch failed', e);
    return { batch: null, error: cfErrorMessage(e, 'Failed to update CPV batch.') };
  }
}

export async function changeCpvBatchStatus(
  id: string,
  batchStatus: CpvBatchRecord['batchStatus'],
  _actor: CpvBatchActor,
  _existing: CpvBatchRecord,
  reason?: string,
  options?: { esignConfirmed?: boolean },
): Promise<{ batch: CpvBatchRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { batch: null, error: 'Firebase is not configured.' };
  try {
    if (!reason || reason.trim().length < 5) {
      return { batch: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'setAdminCpvBatchStatus',
    );
    const result = await fn({
      id,
      batchStatus,
      changeReason: reason,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { batch: normalizeCpvBatch(result.data), error: null };
  } catch (e) {
    console.error('changeCpvBatchStatus failed', e);
    return { batch: null, error: cfErrorMessage(e, 'Failed to update batch status.') };
  }
}

export async function importCpvBatchFromAdmin(
  adminBatchId: string,
  cpvProductId: string,
  _actor: CpvBatchActor,
  changeReason = 'Import from Admin Batch Master',
): Promise<{ batch: CpvBatchRecord | null; error: string | null }> {
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'importAdminCpvBatch',
    );
    const result = await fn({ adminBatchId, cpvProductId, changeReason });
    return { batch: normalizeCpvBatch(result.data), error: null };
  } catch (e) {
    console.error('importCpvBatchFromAdmin failed', e);
    return { batch: null, error: cfErrorMessage(e, 'Failed to import batch.') };
  }
}

export function buildCpvBatchesExportRows(batches: CpvBatchRecord[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = [
    'CPV Batch ID', 'Batch Number', 'Batch Code', 'Product Code', 'Product Name', 'Product Version',
    'Batch Size', 'Target Size', 'Actual Size', 'Unit', 'Shelf Life (months)',
    'Mfg Date', 'Expiry', 'Retest', 'Site', 'Plant', 'Line', 'Department',
    'Shift', 'Campaign', 'MO Number', 'WO Number', 'Batch Status', 'Release Status',
    'QA Release Date', 'Review Period', 'Golden Batch', 'Customer', 'Description',
  ];
  const rows = batches.map((b) => [
    b.cpvBatchId,
    b.batchNumber,
    b.batchCode || '',
    b.productCode,
    b.productName,
    b.productVersion || '',
    b.batchSize,
    b.targetBatchSize || '',
    b.actualBatchSize || '',
    b.batchSizeUnit,
    b.shelfLifeMonths || '',
    b.manufacturingDate,
    b.expiryDate,
    b.retestDate || '',
    b.manufacturingSite,
    b.plant || '',
    b.manufacturingLine,
    b.department || '',
    b.shift,
    b.campaign || '',
    b.manufacturingOrderNumber || '',
    b.workOrderNumber || '',
    b.batchStatus,
    b.releaseStatus,
    b.qaReleaseDate,
    b.cpvReviewPeriod,
    b.goldenBatchNumber || '',
    b.customerName,
    b.description || '',
  ]);
  return { headers, rows };
}

export async function logCpvBatchExport(actor: CpvBatchActor, count: number, format = 'CSV'): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCpvBatchExport');
    await fn({ count, format, changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logCpvBatchExport CF failed (non-blocking)', e);
  }
}

export async function logQaOverride(actor: CpvBatchActor, batchId: string, detail: string): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCpvBatchExport');
    await fn({ count: 0, format: 'QA_OVERRIDE', changeReason: `${batchId}: ${detail} by ${actor.name}` });
  } catch (e) {
    console.warn('logQaOverride failed', e);
  }
}

/** For CPP/CQA batch dropdowns */
export async function listCpvBatchesForDropdown(): Promise<Array<{ id: string; batch_number: string; product_name: string }>> {
  const batches = await fetchCpvBatches();
  return batches
    .filter((b) => !['Cancelled', 'Closed', 'Rejected', 'Archived'].includes(String(b.batchStatus)))
    .map((b) => ({
      id: b.id,
      batch_number: b.batchNumber,
      product_name: b.productName,
    }));
}
