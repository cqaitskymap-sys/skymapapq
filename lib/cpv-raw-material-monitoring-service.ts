/**
 * CPV Raw Material Monitoring — client service.
 * Reads: Firestore. Writes: Cloud Functions only.
 */
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { getMaterialMasters } from '@/lib/material-service';
import { listReceipts } from '@/lib/warehouse-mgmt-service';
import { listVendors } from '@/lib/vendor-mgmt-service';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import {
  RAW_MATERIAL_MONITORING_COLLECTION,
  buildRawMaterialMonitoringId,
  type RawMaterialMonitoringFormData,
  type RawMaterialMonitoringRecord,
  type RawMaterialAttachment,
} from '@/lib/cpv-raw-material-monitoring';

export interface RawMaterialActor {
  id: string;
  name: string;
  role?: string;
}

function str(v: unknown, fb = ''): string {
  if (v === null || v === undefined) return fb;
  return String(v);
}

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function optionalNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function cfErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '').trim() || fallback;
  }
  return fallback;
}

export function normalizeRawMaterialRecord(raw: Record<string, unknown>): RawMaterialMonitoringRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const materialCode = str(raw.materialCode || raw.material_code, 'MAT');
  const arNumber = str(raw.arNumber || raw.arNo || raw.ar_number);
  const attachments = Array.isArray(raw.attachments) ? raw.attachments as RawMaterialAttachment[] : [];
  return {
    id: str(raw.id),
    rawMaterialMonitoringId: str(
      raw.rawMaterialMonitoringId || raw.raw_material_monitoring_id,
      buildRawMaterialMonitoringId(batchNumber, materialCode, arNumber),
    ),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    batchNumber,
    materialCode,
    materialName: str(raw.materialName || raw.material_name || raw.apiName),
    materialType: (str(raw.materialType || raw.material_type, 'API') as RawMaterialMonitoringRecord['materialType']),
    materialGrade: str(raw.materialGrade || raw.material_grade || raw.grade),
    materialCategory: str(raw.materialCategory || raw.material_category),
    manufacturerName: str(raw.manufacturerName || raw.manufacturer_name),
    supplierName: str(raw.supplierName || raw.supplier_name),
    vendorId: str(raw.vendorId || raw.vendor_id),
    vendorName: str(raw.vendorName || raw.vendor_name || raw.vendor),
    vendorStatus: str(raw.vendorStatus || raw.vendor_status, 'Active'),
    avlStatus: str(raw.avlStatus || raw.avl_status, 'Approved'),
    vendorCode: str(raw.vendorCode || raw.vendor_code),
    pharmacopoeiaStandard: str(raw.pharmacopoeiaStandard || raw.pharmacopoeia_standard),
    grnNumber: str(raw.grnNumber || raw.grnNo || raw.grn_number),
    purchaseOrderNumber: str(raw.purchaseOrderNumber || raw.purchase_order_number),
    arNumber,
    coaNumber: str(raw.coaNumber || raw.coa_number),
    materialLotNumber: str(raw.materialLotNumber || raw.material_lot_number || raw.batch_lot_number),
    supplierBatchNumber: str(raw.supplierBatchNumber || raw.supplier_batch_number),
    mfgDate: str(raw.mfgDate || raw.mfg_date),
    expDate: str(raw.expDate || raw.exp_date),
    retestDate: str(raw.retestDate || raw.retest_date),
    shelfLifeMonths: str(raw.shelfLifeMonths || raw.shelf_life_months),
    receivedQuantity: num(raw.receivedQuantity ?? raw.received_quantity),
    acceptedQuantity: num(raw.acceptedQuantity ?? raw.accepted_quantity),
    rejectedQuantity: num(raw.rejectedQuantity ?? raw.rejected_quantity),
    quarantineQuantity: num(raw.quarantineQuantity ?? raw.quarantine_quantity),
    issuedQuantity: num(raw.issuedQuantity ?? raw.issued_quantity),
    usedQuantity: num(raw.usedQuantity ?? raw.used_quantity),
    unit: str(raw.unit),
    storageCondition: str(raw.storageCondition || raw.storage_condition),
    warehouseLocation: str(raw.warehouseLocation || raw.warehouse_location),
    storageArea: str(raw.storageArea || raw.storage_area),
    site: str(raw.site),
    department: str(raw.department, 'Warehouse'),
    shift: str(raw.shift),
    qcStatus: (str(raw.qcStatus || raw.qc_status, 'Under Test') as RawMaterialMonitoringRecord['qcStatus']),
    qaStatus: str(raw.qaStatus || raw.qa_status),
    releaseStatus: str(raw.releaseStatus || raw.release_status),
    samplingStatus: str(raw.samplingStatus || raw.sampling_status),
    coaAvailable: (str(raw.coaAvailable || raw.coa_available, 'No') as RawMaterialMonitoringRecord['coaAvailable']),
    specificationNumber: str(raw.specificationNumber || raw.specification_number || raw.specificationNo),
    specificationVersion: str(raw.specificationVersion || raw.specification_version),
    stpNumber: str(raw.stpNumber || raw.stp_number || raw.testMethodStp),
    testParameter: str(raw.testParameter || raw.test_parameter),
    observedResult: ((): string | number | undefined => {
      const v = raw.observedResult ?? raw.observed_result ?? raw.assay;
      if (v === null || v === undefined) return undefined;
      if (typeof v === 'number' || typeof v === 'string') return v;
      return String(v);
    })(),
    lowerLimit: optionalNum(raw.lowerLimit ?? raw.lower_limit ?? raw.lsl),
    upperLimit: optionalNum(raw.upperLimit ?? raw.upper_limit ?? raw.usl),
    testUnit: str(raw.testUnit || raw.test_unit),
    testResultSummary: str(raw.testResultSummary || raw.test_result_summary || raw.testResultSummery),
    remarks: str(raw.remarks),
    effectiveDate: str(raw.effectiveDate || raw.effective_date),
    version: str(raw.version, '1.0'),
    changeReason: str(raw.changeReason || raw.change_reason),
    complianceStatus: str(raw.complianceStatus || raw.compliance_status || raw.status, 'Complies'),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    oosRequired: Boolean(raw.oosRequired || raw.oos_required),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as RawMaterialMonitoringRecord['reviewStatus']),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    attachments,
    warehouseReceiptId: str(raw.warehouseReceiptId || raw.warehouse_receipt_id),
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export async function fetchRawMaterialRecords(max = 500): Promise<RawMaterialMonitoringRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: RawMaterialMonitoringRecord[] = [];
    try {
      primary = await getRecords<RawMaterialMonitoringRecord>(
        RAW_MATERIAL_MONITORING_COLLECTION,
        [orderBy('createdAt', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<RawMaterialMonitoringRecord>(
        RAW_MATERIAL_MONITORING_COLLECTION,
        [limit(max)],
      );
    }
    const normalized = primary
      .map((r) => normalizeRawMaterialRecord(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const legacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.rawMaterials, max);
    return legacy
      .map((r) => normalizeRawMaterialRecord(r))
      .filter((r) => !r.isDeleted);
  } catch (e) {
    console.error('fetchRawMaterialRecords failed', e);
    return [];
  }
}

export async function fetchRawMaterialRecordById(id: string): Promise<RawMaterialMonitoringRecord | null> {
  const record = await getRecord<RawMaterialMonitoringRecord>(RAW_MATERIAL_MONITORING_COLLECTION, id);
  if (record) {
    const n = normalizeRawMaterialRecord(record as unknown as Record<string, unknown>);
    return n.isDeleted ? null : n;
  }
  const all = await fetchRawMaterialRecords();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchMaterialMasterOptions() {
  try {
    return await getMaterialMasters({ status: 'Active' });
  } catch {
    return [];
  }
}

export async function fetchVendorOptions() {
  try {
    return await listVendors({});
  } catch {
    return [];
  }
}

export async function fetchWarehouseReceiptsForImport() {
  try {
    return await listReceipts();
  } catch {
    return [];
  }
}

export async function fetchRmBatchesForProduct(productName: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) => b.productName === productName || b.productCode === productName);
}

export async function createRawMaterialRecord(
  data: RawMaterialMonitoringFormData & { warehouseReceiptId?: string },
  _actor: RawMaterialActor,
  attachments: RawMaterialAttachment[] = [],
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: RawMaterialMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for raw material entry.' };
    }
    const batches = await fetchRmBatchesForProduct(data.productName);
    const batchMatch = batches.find((b) => b.batchNumber === data.batchNumber);
    if (batches.length && !batchMatch) {
      return { result: null, error: 'Batch does not belong to selected product.' };
    }
    if (batchMatch && ['Cancelled', 'Closed', 'Rejected', 'Archived'].includes(batchMatch.batchStatus)) {
      return { result: null, error: 'Closed, rejected, or archived batch — entry not allowed.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }

    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminRawMaterialRecord',
    );
    const result = await fn({
      ...data,
      attachments,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      changeReason: data.changeReason,
      warehouseReceiptId: data.warehouseReceiptId || '',
    });
    return { result: normalizeRawMaterialRecord(result.data), error: null };
  } catch (e) {
    console.error('createRawMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create raw material record.') };
  }
}

export async function updateRawMaterialRecord(
  id: string,
  data: Partial<RawMaterialMonitoringFormData>,
  _actor: RawMaterialActor,
  existing: RawMaterialMonitoringRecord,
  attachments?: RawMaterialAttachment[],
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: RawMaterialMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved record is locked. QA override required.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }

    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminRawMaterialRecord',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      ...(attachments ? { attachments } : {}),
    });
    return { result: normalizeRawMaterialRecord(result.data), error: null };
  } catch (e) {
    console.error('updateRawMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update raw material record.') };
  }
}

export async function reviewRawMaterialRecord(
  id: string,
  _actor: RawMaterialActor,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminRawMaterialRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeRawMaterialRecord(result.data), error: null };
  } catch (e) {
    console.error('reviewRawMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveRawMaterialRecord(
  id: string,
  _actor: RawMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'approveAdminRawMaterialRecord',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeRawMaterialRecord(result.data), error: null };
  } catch (e) {
    console.error('approveRawMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve raw material record.') };
  }
}

export async function softDeleteRawMaterialRecord(
  id: string,
  _actor: RawMaterialActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, { success: boolean; id: string }>(
      getFirebaseFunctions(),
      'softDeleteAdminRawMaterialRecord',
    );
    await fn({ id, changeReason, esignConfirmed: true });
    return { result: { id } as RawMaterialMonitoringRecord, error: null };
  } catch (e) {
    console.error('softDeleteRawMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to archive raw material record.') };
  }
}

export async function bulkCreateRawMaterialRecords(
  rows: RawMaterialMonitoringFormData[],
  _actor: RawMaterialActor,
  changeReason = 'Bulk raw material entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { created: 0, errors: ['Change reason (min 5 characters) is required.'] };
    }
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminRawMaterialRecords',
    );
    const result = await fn({ rows, changeReason });
    return result.data;
  } catch (e) {
    console.error('bulkCreateRawMaterialRecords failed', e);
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function importFromWarehouseReceipt(
  receiptId: string,
  cpvProductId: string,
  productName: string,
  productCode: string,
  batchNumber: string,
  usedQuantity: number,
  actor: RawMaterialActor,
  changeReason = 'Imported from warehouse receipt',
): Promise<{ result: RawMaterialMonitoringRecord | null; error: string | null }> {
  const receipts = await fetchWarehouseReceiptsForImport();
  const receipt = receipts.find((r) => r.id === receiptId);
  if (!receipt) return { result: null, error: 'Warehouse receipt not found.' };

  const qcMap: Record<string, RawMaterialMonitoringFormData['qcStatus']> = {
    Approved: 'Approved',
    Rejected: 'Rejected',
    'Under Test': 'Under Test',
    Quarantine: 'Quarantine',
    'Retest Required': 'Retest Required',
    Pending: 'Under Test',
  };

  const data: RawMaterialMonitoringFormData & { warehouseReceiptId?: string } = {
    cpvProductId,
    productName,
    productCode,
    batchNumber,
    materialCode: receipt.material_code,
    materialName: receipt.material_name,
    materialType: (receipt.material_type === 'API'
      ? 'API'
      : (receipt.material_type || '').includes('Excipient')
        ? 'Excipient'
        : 'Raw Material') as RawMaterialMonitoringFormData['materialType'],
    materialGrade: '',
    materialCategory: '',
    manufacturerName: receipt.manufacturer_name || receipt.vendor_name,
    supplierName: receipt.supplier_name || receipt.vendor_name,
    vendorId: receipt.vendor_doc_id || '',
    vendorName: receipt.vendor_name,
    vendorStatus: 'Active',
    avlStatus: 'Approved',
    vendorCode: '',
    pharmacopoeiaStandard: '',
    grnNumber: receipt.grn_number,
    purchaseOrderNumber: '',
    arNumber: receipt.ar_number,
    coaNumber: '',
    materialLotNumber: receipt.batch_lot_number,
    supplierBatchNumber: '',
    mfgDate: receipt.mfg_date || new Date().toISOString().split('T')[0],
    expDate: receipt.exp_date || new Date().toISOString().split('T')[0],
    retestDate: receipt.retest_date || '',
    shelfLifeMonths: '',
    receivedQuantity: receipt.received_quantity,
    acceptedQuantity: receipt.received_quantity,
    rejectedQuantity: 0,
    quarantineQuantity: 0,
    issuedQuantity: receipt.received_quantity,
    usedQuantity,
    unit: receipt.unit,
    storageCondition: receipt.storage_condition,
    warehouseLocation: '',
    storageArea: '',
    site: '',
    department: 'Warehouse',
    shift: '',
    qcStatus: qcMap[receipt.qc_status] || 'Quarantine',
    qaStatus: '',
    releaseStatus: '',
    samplingStatus: '',
    coaAvailable: receipt.coa_available ? 'Yes' : 'No',
    specificationNumber: '',
    specificationVersion: '',
    stpNumber: '',
    testParameter: '',
    testUnit: '',
    testResultSummary: '',
    remarks: receipt.remarks || 'Imported from warehouse receipt',
    effectiveDate: '',
    version: '1.0',
    changeReason,
    warehouseReceiptId: receiptId,
  };

  return createRawMaterialRecord(data, actor);
}

export async function fetchRawMaterialAuditTrail(recordId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(
      query(
        collection(getFirebaseFirestore(), 'audit_trail'),
        where('documentId', '==', recordId),
        limit(50),
      ),
    );
    if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const snap2 = await getDocs(
      query(
        collection(getFirebaseFirestore(), 'audit_trail'),
        where('recordId', '==', recordId),
        limit(50),
      ),
    );
    return snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function logRawMaterialExport(actor: RawMaterialActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminRawMaterialExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logRawMaterialExport CF failed (non-blocking)', e);
  }
}

export function mapReceiptToFormPartial(receipt: Awaited<ReturnType<typeof listReceipts>>[number]) {
  return {
    materialCode: receipt.material_code,
    materialName: receipt.material_name,
    vendorName: receipt.vendor_name,
    manufacturerName: receipt.manufacturer_name,
    supplierName: receipt.supplier_name,
    grnNumber: receipt.grn_number,
    arNumber: receipt.ar_number,
    materialLotNumber: receipt.batch_lot_number,
    mfgDate: receipt.mfg_date || '',
    expDate: receipt.exp_date || '',
    retestDate: receipt.retest_date || '',
    receivedQuantity: receipt.received_quantity,
    issuedQuantity: receipt.received_quantity,
    unit: receipt.unit,
    storageCondition: receipt.storage_condition,
    coaAvailable: receipt.coa_available ? 'Yes' as const : 'No' as const,
    warehouseReceiptId: receipt.id,
  };
}

export function materialTrendData(results: RawMaterialMonitoringRecord[], materialName: string) {
  return results
    .filter((r) => r.materialName === materialName)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((r) => ({
      date: r.createdAt.slice(0, 10),
      batch: r.batchNumber,
      value: Number(r.observedResult) || Number(r.usedQuantity) || 0,
      status: r.complianceStatus,
    }));
}
