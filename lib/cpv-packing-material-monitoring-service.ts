/**
 * CPV Packing Material Monitoring — client service.
 * Reads: Firestore. Writes: Cloud Functions only.
 */
import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { getPackagingMaterials } from '@/lib/packaging-service';
import type { PackagingMaterial } from '@/lib/packaging-service';
import { listReceipts } from '@/lib/warehouse-mgmt-service';
import { listVendors } from '@/lib/vendor-mgmt-service';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import {
  PACKING_MATERIAL_MONITORING_COLLECTION,
  buildPackingMaterialMonitoringId,
  calculateBalanceQuantity,
  evaluateReconciliationStatus,
  type PackingMaterialMonitoringFormData,
  type PackingMaterialMonitoringRecord,
  type PackingMaterialAttachment,
} from '@/lib/cpv-packing-material-monitoring';

export interface PackingMaterialActor {
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

export function normalizePackingRecord(raw: Record<string, unknown>): PackingMaterialMonitoringRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const materialCode = str(raw.materialCode || raw.material_code, 'PM');
  const arNumber = str(raw.arNumber || raw.arNo || raw.ar_number);
  const issued = num(raw.issuedQuantity ?? raw.issued_quantity);
  const used = num(raw.usedQuantity ?? raw.used_quantity);
  const rejected = num(raw.rejectedQuantity ?? raw.rejected_quantity);
  const returned = num(raw.returnedQuantity ?? raw.returned_quantity);
  const balance = num(
    raw.balanceQuantity ?? raw.balance_quantity,
    calculateBalanceQuantity(issued, used, rejected, returned),
  );
  const reconciliationStatus = str(
    raw.reconciliationStatus || raw.reconciliation_status,
    evaluateReconciliationStatus(issued, used, rejected, returned),
  ) as PackingMaterialMonitoringRecord['reconciliationStatus'];
  const attachments = Array.isArray(raw.attachments) ? raw.attachments as PackingMaterialAttachment[] : [];

  return {
    id: str(raw.id),
    packingMaterialMonitoringId: str(
      raw.packingMaterialMonitoringId || raw.packing_material_monitoring_id,
      buildPackingMaterialMonitoringId(batchNumber, materialCode, arNumber),
    ),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    batchNumber,
    materialCode,
    materialName: str(raw.materialName || raw.material_name || raw.materialType),
    materialType: (str(raw.materialType || raw.material_type, 'Primary Packing Material') as PackingMaterialMonitoringRecord['materialType']),
    materialCategory: (str(raw.materialCategory || raw.material_category, 'Other') as PackingMaterialMonitoringRecord['materialCategory']),
    manufacturerName: str(raw.manufacturerName || raw.manufacturer_name),
    supplierName: str(raw.supplierName || raw.supplier_name),
    vendorId: str(raw.vendorId || raw.vendor_id),
    vendorName: str(raw.vendorName || raw.vendor_name || raw.vendor),
    vendorStatus: str(raw.vendorStatus || raw.vendor_status, 'Active'),
    avlStatus: str(raw.avlStatus || raw.avl_status, 'Approved'),
    vendorCode: str(raw.vendorCode || raw.vendor_code),
    grnNumber: str(raw.grnNumber || raw.grnNo || raw.grn_number),
    purchaseOrderNumber: str(raw.purchaseOrderNumber || raw.purchase_order_number),
    arNumber,
    coaNumber: str(raw.coaNumber || raw.coa_number),
    materialLotNumber: str(raw.materialLotNumber || raw.material_lot_number),
    supplierBatchNumber: str(raw.supplierBatchNumber || raw.supplier_batch_number),
    mfgDate: str(raw.mfgDate || raw.mfg_date),
    expDate: str(raw.expDate || raw.exp_date),
    retestDate: str(raw.retestDate || raw.retest_date),
    shelfLifeMonths: str(raw.shelfLifeMonths || raw.shelf_life_months),
    receivedQuantity: num(raw.receivedQuantity ?? raw.received_quantity),
    acceptedQuantity: num(raw.acceptedQuantity ?? raw.accepted_quantity),
    rejectedQuantity: rejected,
    quarantineQuantity: num(raw.quarantineQuantity ?? raw.quarantine_quantity),
    returnedQuantity: returned,
    issuedQuantity: issued,
    usedQuantity: used,
    balanceQuantity: balance,
    unit: str(raw.unit),
    storageCondition: str(raw.storageCondition || raw.storage_condition),
    warehouseLocation: str(raw.warehouseLocation || raw.warehouse_location),
    storageArea: str(raw.storageArea || raw.storage_area),
    site: str(raw.site),
    department: str(raw.department, 'Warehouse'),
    shift: str(raw.shift),
    qcStatus: (str(raw.qcStatus || raw.qc_status, 'Under Test') as PackingMaterialMonitoringRecord['qcStatus']),
    qaStatus: str(raw.qaStatus || raw.qa_status),
    releaseStatus: str(raw.releaseStatus || raw.release_status),
    samplingStatus: str(raw.samplingStatus || raw.sampling_status),
    coaAvailable: (str(raw.coaAvailable || raw.coa_available, 'No') as PackingMaterialMonitoringRecord['coaAvailable']),
    specificationNumber: str(raw.specificationNumber || raw.specification_number || raw.specificationNo),
    specificationVersion: str(raw.specificationVersion || raw.specification_version),
    artworkVersion: str(raw.artworkVersion || raw.artwork_version),
    barcode: str(raw.barcode),
    qrCode: str(raw.qrCode || raw.qr_code),
    rfid: str(raw.rfid),
    artworkVerified: str(raw.artworkVerified || raw.artwork_verified),
    barcodeVerified: str(raw.barcodeVerified || raw.barcode_verified),
    labelVerified: str(raw.labelVerified || raw.label_verified),
    packagingIntegrity: str(raw.packagingIntegrity || raw.packaging_integrity),
    damageInspection: str(raw.damageInspection || raw.damage_inspection),
    printingVerified: str(raw.printingVerified || raw.printing_verified),
    dimensionCheck: str(raw.dimensionCheck || raw.dimension_check),
    sealIntegrity: str(raw.sealIntegrity || raw.seal_integrity),
    stpNumber: str(raw.stpNumber || raw.stp_number || raw.stpNo),
    testParameter: str(raw.testParameter || raw.test_parameter),
    observedResult: ((): string | number | undefined => {
      const v = raw.observedResult ?? raw.observed_result;
      if (v === null || v === undefined) return undefined;
      if (typeof v === 'number' || typeof v === 'string') return v;
      return String(v);
    })(),
    lowerLimit: optionalNum(raw.lowerLimit ?? raw.lower_limit),
    upperLimit: optionalNum(raw.upperLimit ?? raw.upper_limit),
    testUnit: str(raw.testUnit || raw.test_unit),
    testResultSummary: str(raw.testResultSummary || raw.test_result_summary || raw.testResult),
    remarks: str(raw.remarks),
    effectiveDate: str(raw.effectiveDate || raw.effective_date),
    reviewDate: str(raw.reviewDate || raw.review_date),
    version: str(raw.version, '1.0'),
    description: str(raw.description),
    changeReason: str(raw.changeReason || raw.change_reason),
    reconciliationStatus,
    complianceStatus: str(raw.complianceStatus || raw.compliance_status || raw.status, 'Complies'),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    oosRequired: Boolean(raw.oosRequired || raw.oos_required),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as PackingMaterialMonitoringRecord['reviewStatus']),
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

export async function fetchPackingMaterialRecords(max = 500): Promise<PackingMaterialMonitoringRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: PackingMaterialMonitoringRecord[] = [];
    try {
      primary = await getRecords<PackingMaterialMonitoringRecord>(
        PACKING_MATERIAL_MONITORING_COLLECTION,
        [orderBy('createdAt', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<PackingMaterialMonitoringRecord>(
        PACKING_MATERIAL_MONITORING_COLLECTION,
        [limit(max)],
      );
    }
    const normalized = primary
      .map((r) => normalizePackingRecord(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) return normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const legacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.packingMaterials, max);
    return legacy
      .map((r) => normalizePackingRecord(r))
      .filter((r) => !r.isDeleted);
  } catch (e) {
    console.error('fetchPackingMaterialRecords failed', e);
    return [];
  }
}

export async function fetchPackingMaterialRecordById(id: string): Promise<PackingMaterialMonitoringRecord | null> {
  const record = await getRecord<PackingMaterialMonitoringRecord>(PACKING_MATERIAL_MONITORING_COLLECTION, id);
  if (record) {
    const n = normalizePackingRecord(record as unknown as Record<string, unknown>);
    return n.isDeleted ? null : n;
  }
  const all = await fetchPackingMaterialRecords();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchPackingMasterOptions(): Promise<PackagingMaterial[]> {
  try {
    return await getPackagingMaterials({ status: 'Active' });
  } catch {
    return [];
  }
}

export async function fetchPackingVendorOptions() {
  try {
    return await listVendors({});
  } catch {
    return [];
  }
}

export async function fetchPackingWarehouseReceipts() {
  try {
    return await listReceipts();
  } catch {
    return [];
  }
}

export async function fetchPmBatchesForProduct(productName: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) => b.productName === productName || b.productCode === productName);
}

export async function createPackingMaterialRecord(
  data: PackingMaterialMonitoringFormData & { warehouseReceiptId?: string },
  _actor: PackingMaterialActor,
  attachments: PackingMaterialAttachment[] = [],
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: PackingMaterialMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for packing material entry.' };
    }
    const batches = await fetchPmBatchesForProduct(data.productName);
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
      'createAdminPackingMaterialRecord',
    );
    const result = await fn({
      ...data,
      attachments,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      changeReason: data.changeReason,
      warehouseReceiptId: data.warehouseReceiptId || '',
    });
    return { result: normalizePackingRecord(result.data), error: null };
  } catch (e) {
    console.error('createPackingMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create packing material record.') };
  }
}

export async function updatePackingMaterialRecord(
  id: string,
  data: Partial<PackingMaterialMonitoringFormData>,
  _actor: PackingMaterialActor,
  existing: PackingMaterialMonitoringRecord,
  attachments?: PackingMaterialAttachment[],
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: PackingMaterialMonitoringRecord | null; error: string | null }> {
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
      'updateAdminPackingMaterialRecord',
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
    return { result: normalizePackingRecord(result.data), error: null };
  } catch (e) {
    console.error('updatePackingMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update packing material record.') };
  }
}

export async function reviewPackingMaterialRecord(
  id: string,
  _actor: PackingMaterialActor,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminPackingMaterialRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizePackingRecord(result.data), error: null };
  } catch (e) {
    console.error('reviewPackingMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approvePackingMaterialRecord(
  id: string,
  _actor: PackingMaterialActor,
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
      'approveAdminPackingMaterialRecord',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizePackingRecord(result.data), error: null };
  } catch (e) {
    console.error('approvePackingMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve packing material record.') };
  }
}

export async function softDeletePackingMaterialRecord(
  id: string,
  _actor: PackingMaterialActor,
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
      'softDeleteAdminPackingMaterialRecord',
    );
    await fn({ id, changeReason, esignConfirmed: true });
    return { result: { id } as PackingMaterialMonitoringRecord, error: null };
  } catch (e) {
    console.error('softDeletePackingMaterialRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to archive packing material record.') };
  }
}

export async function bulkCreatePackingMaterialRecords(
  rows: PackingMaterialMonitoringFormData[],
  _actor: PackingMaterialActor,
  changeReason = 'Bulk packing material entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { created: 0, errors: ['Change reason (min 5 characters) is required.'] };
    }
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminPackingMaterialRecords',
    );
    const result = await fn({ rows, changeReason });
    return result.data;
  } catch (e) {
    console.error('bulkCreatePackingMaterialRecords failed', e);
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function importPackingFromWarehouseReceipt(
  receiptId: string,
  cpvProductId: string,
  productName: string,
  productCode: string,
  batchNumber: string,
  usedQuantity: number,
  actor: PackingMaterialActor,
  changeReason = 'Imported from warehouse receipt',
): Promise<{ result: PackingMaterialMonitoringRecord | null; error: string | null }> {
  const receipts = await fetchPackingWarehouseReceipts();
  const receipt = receipts.find((r) => r.id === receiptId);
  if (!receipt) return { result: null, error: 'Warehouse receipt not found.' };

  const qcMap: Record<string, PackingMaterialMonitoringFormData['qcStatus']> = {
    Approved: 'Approved',
    Rejected: 'Rejected',
    'Under Test': 'Under Test',
    Quarantine: 'Quarantine',
    'Retest Required': 'Retest Required',
    Pending: 'Under Test',
  };

  const matType = receipt.material_type.includes('Primary') ? 'Primary Packing Material'
    : receipt.material_type.includes('Secondary') ? 'Secondary Packing Material'
      : receipt.material_type.includes('Tertiary') ? 'Tertiary Packing Material'
        : 'Primary Packing Material';

  const data: PackingMaterialMonitoringFormData & { warehouseReceiptId?: string } = {
    cpvProductId,
    productName,
    productCode,
    batchNumber,
    materialCode: receipt.material_code,
    materialName: receipt.material_name,
    materialType: matType as PackingMaterialMonitoringFormData['materialType'],
    materialCategory: 'Other',
    manufacturerName: receipt.manufacturer_name || receipt.vendor_name,
    supplierName: receipt.supplier_name || receipt.vendor_name,
    vendorId: receipt.vendor_doc_id || '',
    vendorName: receipt.vendor_name,
    vendorStatus: 'Active',
    avlStatus: 'Approved',
    vendorCode: '',
    grnNumber: receipt.grn_number,
    purchaseOrderNumber: '',
    arNumber: receipt.ar_number,
    coaNumber: '',
    materialLotNumber: receipt.batch_lot_number,
    supplierBatchNumber: '',
    mfgDate: receipt.mfg_date || new Date().toISOString().split('T')[0],
    expDate: receipt.exp_date || new Date().toISOString().split('T')[0],
    retestDate: '',
    shelfLifeMonths: '',
    receivedQuantity: receipt.received_quantity,
    acceptedQuantity: receipt.received_quantity,
    rejectedQuantity: 0,
    quarantineQuantity: 0,
    returnedQuantity: 0,
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
    artworkVersion: '',
    barcode: '',
    qrCode: '',
    rfid: '',
    artworkVerified: '',
    barcodeVerified: '',
    labelVerified: '',
    packagingIntegrity: '',
    damageInspection: '',
    printingVerified: '',
    dimensionCheck: '',
    sealIntegrity: '',
    stpNumber: '',
    testParameter: '',
    testUnit: '',
    testResultSummary: '',
    remarks: receipt.remarks || 'Imported from warehouse receipt',
    effectiveDate: '',
    reviewDate: '',
    version: '1.0',
    description: '',
    changeReason,
    warehouseReceiptId: receiptId,
  };

  return createPackingMaterialRecord(data, actor);
}

export async function fetchPackingMaterialAuditTrail(recordId: string) {
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

export async function logPackingMaterialExport(actor: PackingMaterialActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminPackingMaterialExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logPackingMaterialExport CF failed (non-blocking)', e);
  }
}

export function mapPackagingType(pmType: string): PackingMaterialMonitoringFormData['materialType'] {
  if (pmType.includes('Primary')) return 'Primary Packing Material';
  if (pmType.includes('Secondary')) return 'Secondary Packing Material';
  if (pmType.includes('Tertiary')) return 'Tertiary Packing Material';
  return 'Primary Packing Material';
}

export function mapPackagingCategory(category: string): PackingMaterialMonitoringFormData['materialCategory'] {
  const map: Record<string, PackingMaterialMonitoringFormData['materialCategory']> = {
    Vial: 'Vial', Label: 'Label', Carton: 'Carton', 'Rubber Stopper': 'Rubber Stopper',
    'Flip Off Seal': 'Flip Off Seal', 'Package Insert / Leaflet': 'Package Insert / Leaflet',
    'Shipper Box': 'Shipper Box', 'PVC Film': 'PVC Film', 'BOPP Tape': 'BOPP Tape',
    Bottle: 'Bottle', Cap: 'Cap', Closure: 'Closure', Foil: 'Foil', Blister: 'Blister',
    Insert: 'Insert', Leaflet: 'Leaflet', Tube: 'Tube', Sachet: 'Sachet', Pouch: 'Pouch',
    'Printed Material': 'Printed Material',
  };
  return map[category] || 'Other';
}
