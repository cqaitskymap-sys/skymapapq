import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, limit, orderBy, writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import { CPV_BATCH_COLLECTION } from '@/lib/cpv-batch-registration';
import { PACKING_MATERIAL_LEGACY_COLLECTION, PACKING_MATERIAL_MONITORING_COLLECTION } from '@/lib/cpv-packing-material-monitoring';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { fetchPqrOptions } from '@/lib/pqr-batch-review-service';
import {
  PQR_PACKAGING_REVIEW_COLLECTIONS, PQR_PACKAGING_REVIEW_MODULE,
  computePackagingCompliance, computePackagingSummary, computePackagingReconciliation,
  generatePackagingNarrative, inferPackagingType, normalizePackagingCategory,
  normalizePackagingReviewRecord,
  type PackagingReviewFormData, type PqrPackagingReviewRecord,
} from '@/lib/pqr-packaging-review-records';

export type PqrPackagingReviewActor = { id: string; name: string; role?: string };

export { fetchPqrOptions };

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function buildPackagingReviewId(materialName: string, arNumber: string) {
  const mat = (materialName || 'PKG').slice(0, 8).toUpperCase().replace(/\s+/g, '-');
  const ar = (arNumber || 'AR').toUpperCase().replace(/\s+/g, '-');
  return `PPR-${mat}-${ar}-${Date.now().toString(36).toUpperCase()}`;
}

function toDateStr(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (s.length === 7) return `${s}-01`;
  return s;
}

function normalizeQcStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (!s) return 'Under Test';
  if (s.includes('reject')) return 'Rejected';
  if (s.includes('approv') || s.includes('release')) return 'Approved';
  if (s.includes('quarant')) return 'Quarantine';
  if (s.includes('retest')) return 'Retest Required';
  if (s.includes('test') || s.includes('pending') || s.includes('progress')) return 'Under Test';
  return raw || 'Under Test';
}

function normalizeCoaAvailable(raw: Record<string, unknown>): 'Yes' | 'No' {
  const c = str(raw.coaAvailable || raw.coa_available || raw.coaNumber || raw.coa_number);
  if (!c) return 'No';
  if (c.toLowerCase() === 'no' || c.toLowerCase() === 'false') return 'No';
  return 'Yes';
}

async function readCollection(name: string, max = 500): Promise<Record<string, unknown>[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), name), orderBy('createdAt', 'desc'), limit(max)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), name), limit(max)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.error(`readCollection ${name}`, e);
      return [];
    }
  }
}

async function readFirst(names: string[], max = 500): Promise<Record<string, unknown>[]> {
  for (const name of names) {
    const rows = await readCollection(name, max);
    if (rows.length) return rows;
  }
  return [];
}

async function logPackagingAudit(
  actionType: string,
  actor: PqrPackagingReviewActor,
  detail?: unknown,
  recordId = 'packaging-review',
  oldValue?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: PQR_PACKAGING_REVIEW_MODULE,
      collectionName: PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview,
      recordId,
      actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview,
      documentId: recordId,
      action: actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_PACKAGING_REVIEW_MODULE,
    });
  } catch (e) {
    console.error('logPackagingAudit failed', e);
  }
}

function resolveVendorAvlSync(
  supplierName: string,
  manufacturerName: string,
  vendors: Record<string, unknown>[],
  avl: Record<string, unknown>[],
): string {
  const name = (supplierName || manufacturerName).toLowerCase();
  if (!name) return 'Not Approved';
  const match = [...vendors, ...avl].find((v) => {
    const vn = str(v.vendorName || v.supplierName || v.manufacturerName || v.name).toLowerCase();
    return vn && (vn === name || name.includes(vn) || vn.includes(name));
  });
  if (!match) return 'Not Approved';
  const status = str(match.avlStatus || match.avl_status || match.status, 'Not Approved');
  if (status.toLowerCase().includes('approved') && !status.toLowerCase().includes('not') && !status.toLowerCase().includes('conditional')) {
    return 'Approved';
  }
  if (status.toLowerCase().includes('conditional')) return 'Conditional Approved';
  if (status.toLowerCase().includes('block')) return 'Blocked';
  return status || 'Not Approved';
}

function mapPackagingType(raw: Record<string, unknown>, category: string, materialName: string): string {
  const t = str(raw.packagingMaterialType || raw.materialType || raw.material_type || raw.packaging_type);
  if (t.includes('Primary')) return 'Primary Packaging Material';
  if (t.includes('Secondary')) return 'Secondary Packaging Material';
  if (t.includes('Tertiary')) return 'Tertiary Packaging Material';
  return inferPackagingType(category, materialName);
}

function isPackingWarehouseRecord(raw: Record<string, unknown>): boolean {
  const type = str(raw.materialType || raw.material_type || raw.category).toLowerCase();
  return type.includes('pack') || type.includes('packaging') || type.includes('label') || type.includes('carton');
}

function mapToPackagingRecord(
  raw: Record<string, unknown>,
  pqr: PqrOption,
  batchNumber: string,
  sourceType: 'packing_material_monitoring' | 'warehouse' | 'packing_material_master',
  vendorAvlStatus: string,
  actor: PqrPackagingReviewActor,
): Omit<PqrPackagingReviewRecord, 'id'> {
  const ts = nowIso();
  const materialName = str(raw.materialName || raw.material_name || raw.packagingMaterial);
  const category = normalizePackagingCategory(str(raw.packagingMaterialCategory || raw.materialCategory || raw.material_category || raw.category));
  const packagingMaterialType = mapPackagingType(raw, category, materialName);
  const issuedQuantity = numOrNull(raw.issuedQuantity ?? raw.issued_quantity ?? raw.issuedQty ?? raw.quantityIssued) ?? 0;
  const usedQuantity = numOrNull(raw.usedQuantity ?? raw.used_quantity ?? raw.usedQty ?? raw.quantityUsed) ?? 0;
  const rejectedQuantity = num(raw.rejectedQuantity || raw.rejected_quantity || raw.rejectedQty || raw.quantityRejected);
  const returnedQuantity = num(raw.returnedQuantity || raw.returned_quantity || raw.returnedQty || raw.quantityReturned);
  const receivedQuantity = numOrNull(raw.receivedQuantity ?? raw.received_quantity ?? raw.receivedQty ?? raw.quantityReceived) ?? 0;
  const qcStatus = normalizeQcStatus(str(raw.qcStatus || raw.qc_status || raw.releaseStatus || raw.status));
  const coaAvailable = normalizeCoaAvailable(raw);

  const partial: Partial<PqrPackagingReviewRecord> = {
    packagingReviewId: buildPackagingReviewId(materialName, str(raw.arNumber || raw.ar_number || raw.arNo || raw.arNo)),
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: pqr.productName,
    productCode: pqr.productCode,
    batchNumber: batchNumber || str(raw.batchNumber || raw.batch_number || raw.batchNo),
    packagingMaterialType,
    packagingMaterialCategory: category,
    materialCode: str(raw.materialCode || raw.material_code),
    materialName,
    manufacturerName: str(raw.manufacturerName || raw.manufacturer_name || raw.manufacturer),
    supplierName: str(raw.supplierName || raw.supplier_name || raw.vendorName || raw.vendor_name),
    vendorAvlStatus,
    grnNumber: str(raw.grnNumber || raw.grn_number || raw.grnNo),
    arNumber: str(raw.arNumber || raw.ar_number || raw.arNo),
    coaNumber: str(raw.coaNumber || raw.coa_number),
    materialLotNumber: str(raw.materialLotNumber || raw.lotNo || raw.lot_number || raw.lotNumber),
    mfgDate: toDateStr(raw.mfgDate || raw.manufacturingDate || raw.manufacturing_date),
    expDate: toDateStr(raw.expDate || raw.expiryDate || raw.expiry_date),
    receivedQuantity,
    issuedQuantity,
    usedQuantity,
    rejectedQuantity,
    returnedQuantity,
    unit: str(raw.unit || raw.uom, 'Nos'),
    qcStatus,
    coaAvailable,
    specificationNumber: str(raw.specificationNumber || raw.specificationNo || raw.specification_number),
    stpNumber: str(raw.stpNumber || raw.stpNo || raw.stp_number),
    remarks: str(raw.remarks),
    sourceType,
    sourceId: str(raw.id),
    attachmentUrls: [],
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdByName: actor.name,
    updatedByName: actor.name,
    isDeleted: false,
  };

  const computed = computePackagingCompliance(partial);
  return { ...partial, ...computed } as Omit<PqrPackagingReviewRecord, 'id'>;
}

async function commitInChunks(rows: Array<Omit<PqrPackagingReviewRecord, 'id'>>, chunkSize = 400) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(getFirebaseFirestore());
    chunk.forEach((record) => {
      const refDoc = doc(collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview));
      batch.set(refDoc, record);
    });
    await batch.commit();
  }
}

export async function fetchPackagingReviewRecords(pqrId: string): Promise<PqrPackagingReviewRecord[]> {
  if (!isFirebaseConfigured() || !pqrId) return [];
  try {
    let rows: PqrPackagingReviewRecord[] = [];
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview),
        where('pqrId', '==', pqrId),
        where('isDeleted', '==', false),
      ));
      rows = snap.docs.map((d) => normalizePackagingReviewRecord({ id: d.id, ...d.data() }));
    } catch {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview),
        where('pqrId', '==', pqrId),
      ));
      rows = snap.docs
        .map((d) => normalizePackagingReviewRecord({ id: d.id, ...d.data() }))
        .filter((r) => !r.isDeleted);
    }

    const seen = new Set<string>();
    return rows
      .filter((r) => {
        const key = `${r.arNumber}|${r.materialName}|${r.materialLotNumber}`.toLowerCase();
        if (!r.arNumber && !r.materialName) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.materialName.localeCompare(b.materialName));
  } catch (e) {
    console.error('fetchPackagingReviewRecords failed', e);
    return [];
  }
}

async function getBatchNumbersForPqr(pqr: PqrOption): Promise<string[]> {
  try {
    const batchReview = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.batchReview),
      where('pqrId', '==', pqr.id),
      where('isDeleted', '==', false),
    ));
    if (!batchReview.empty) {
      return Array.from(new Set(
        batchReview.docs.map((d) => str(d.data().batchNumber)).filter(Boolean),
      ));
    }
  } catch {
    try {
      const batchReview = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.batchReview),
        where('pqrId', '==', pqr.id),
      ));
      return Array.from(new Set(
        batchReview.docs
          .filter((d) => !d.data().isDeleted)
          .map((d) => str(d.data().batchNumber))
          .filter(Boolean),
      ));
    } catch {
      // fall through
    }
  }

  const [batches, cpvBatches] = await Promise.all([
    readFirst([PQR_PACKAGING_REVIEW_COLLECTIONS.batches]),
    readCollection(CPV_BATCH_COLLECTION),
  ]);
  const from = pqr.reviewPeriodFrom;
  const to = pqr.reviewPeriodTo;
  return Array.from(new Set(
    [...batches, ...cpvBatches]
      .filter((b) => {
        if (b.isDeleted) return false;
        const code = str(b.productCode || b.product_code).toLowerCase();
        const name = str(b.productName || b.product_name || b.product).toLowerCase();
        const productOk = (code && code === pqr.productCode.toLowerCase())
          || (name && pqr.productName && name.includes(pqr.productName.toLowerCase()));
        if (!productOk) return false;
        if (!from || !to) return true;
        const mfg = str(b.manufacturingDate || b.manufacturing_date).slice(0, 10);
        if (!mfg) return true;
        return mfg >= from && mfg <= to;
      })
      .map((b) => str(b.batchNumber || b.batch_number))
      .filter(Boolean),
  ));
}

function matchesPqrProduct(raw: Record<string, unknown>, pqr: PqrOption): boolean {
  const code = str(raw.productCode || raw.product_code).toLowerCase();
  const name = str(raw.productName || raw.product_name || raw.product).toLowerCase();
  if (code && pqr.productCode && code === pqr.productCode.toLowerCase()) return true;
  if (name && pqr.productName && (name.includes(pqr.productName.toLowerCase()) || pqr.productName.toLowerCase().includes(name))) {
    return true;
  }
  return false;
}

export async function pullPackagingData(
  pqr: PqrOption,
  actor: PqrPackagingReviewActor,
): Promise<{ created: number; skipped: number; error?: string }> {
  if (!isFirebaseConfigured()) return { created: 0, skipped: 0, error: 'Firebase is not configured.' };

  try {
    await logPackagingAudit('pull packaging data', actor, { pqrId: pqr.id }, pqr.id);

    const [batchNumbers, existing, packingMonitoring, warehouse, packingMaster, vendors, avl] = await Promise.all([
      getBatchNumbersForPqr(pqr),
      fetchPackagingReviewRecords(pqr.id),
      readFirst([
        PACKING_MATERIAL_MONITORING_COLLECTION,
        PACKING_MATERIAL_LEGACY_COLLECTION,
        CPV_COLLECTIONS.packingMaterials,
        PQR_PACKAGING_REVIEW_COLLECTIONS.packingMaterialMonitoring,
      ]),
      readFirst([PQR_PACKAGING_REVIEW_COLLECTIONS.warehouseMaterials]),
      readFirst([PQR_PACKAGING_REVIEW_COLLECTIONS.packingMaterialMaster]),
      readCollection(PQR_PACKAGING_REVIEW_COLLECTIONS.vendors),
      readFirst([PQR_PACKAGING_REVIEW_COLLECTIONS.approvedVendorList, 'vendor_avl']),
    ]);

    const existingKeys = new Set(existing.map((r) =>
      `${r.arNumber}|${r.materialName}|${r.materialLotNumber}`.toLowerCase(),
    ));
    const batchSet = new Set(batchNumbers.map((b) => b.toLowerCase()));
    const candidates: Array<{
      raw: Record<string, unknown>;
      batchNumber: string;
      source: 'packing_material_monitoring' | 'warehouse' | 'packing_material_master';
    }> = [];
    const candidateKeys = new Set<string>();

    const consider = (
      raw: Record<string, unknown>,
      source: 'packing_material_monitoring' | 'warehouse' | 'packing_material_master',
      requireBatch: boolean,
      filterWarehouse = false,
    ) => {
      if (raw.isDeleted) return;
      if (filterWarehouse && !isPackingWarehouseRecord(raw)) return;
      const bn = str(raw.batchNumber || raw.batch_number || raw.batchNo);
      if (batchSet.size > 0) {
        if (bn && !batchSet.has(bn.toLowerCase())) return;
        if (!bn && requireBatch && !matchesPqrProduct(raw, pqr)) return;
        if (!bn && !requireBatch && !matchesPqrProduct(raw, pqr)) return;
      } else if (!matchesPqrProduct(raw, pqr)) {
        return;
      }
      const ar = str(raw.arNumber || raw.ar_number || raw.arNo);
      const matName = str(raw.materialName || raw.material_name || raw.packagingMaterial);
      if (!matName) return;
      const lot = str(raw.materialLotNumber || raw.lotNo || raw.lot_number || raw.lotNumber);
      const key = `${ar}|${matName}|${lot}`.toLowerCase();
      if (candidateKeys.has(key) || existingKeys.has(key)) return;
      candidateKeys.add(key);
      candidates.push({ raw, batchNumber: bn, source });
    };

    packingMonitoring.forEach((raw) => consider(raw, 'packing_material_monitoring', true));
    warehouse.forEach((raw) => consider(raw, 'warehouse', false, true));
    if (!candidates.length) {
      packingMaster.forEach((raw) => consider(raw, 'packing_material_master', false));
    }

    const toCreate = candidates.map(({ raw, batchNumber, source }) => {
      const supplier = str(raw.supplierName || raw.supplier_name || raw.vendorName);
      const manufacturer = str(raw.manufacturerName || raw.manufacturer_name || raw.manufacturer);
      const avlStatus = resolveVendorAvlSync(supplier, manufacturer, vendors, avl);
      return mapToPackagingRecord(raw, pqr, batchNumber, source, avlStatus, actor);
    }).filter((r) => r.materialName);

    if (toCreate.length) await commitInChunks(toCreate);

    await logPackagingAudit('pull packaging data completed', actor, {
      created: toCreate.length,
      skipped: existing.length,
      batchCount: batchNumbers.length,
    }, pqr.id);
    await logPackagingAudit('vendor AVL checked', actor, { created: toCreate.length }, pqr.id);
    await logPackagingAudit('reconciliation recalculated', actor, { created: toCreate.length }, pqr.id);
    return { created: toCreate.length, skipped: existing.length };
  } catch (e) {
    console.error('pullPackagingData failed', e);
    return { created: 0, skipped: 0, error: 'Unable to pull packaging data. Please try again.' };
  }
}

async function checkDuplicatePackagingAr(
  pqrId: string,
  arNumber: string,
  materialName: string,
  materialLotNumber: string,
  excludeId?: string,
): Promise<boolean> {
  const records = await fetchPackagingReviewRecords(pqrId);
  return records.some((r) =>
    r.arNumber.toLowerCase() === arNumber.toLowerCase()
    && r.materialName.toLowerCase() === materialName.toLowerCase()
    && r.materialLotNumber.toLowerCase() === (materialLotNumber || '').toLowerCase()
    && r.id !== excludeId,
  );
}

function formToRecordFields(
  pqr: PqrOption,
  data: PackagingReviewFormData,
  existingRecords: PqrPackagingReviewRecord[],
): Omit<PqrPackagingReviewRecord, 'id' | 'packagingReviewId' | 'createdAt' | 'createdBy' | 'createdByName' | 'isDeleted'> {
  const complianceInput = {
    vendorAvlStatus: data.vendorAvlStatus,
    qcStatus: data.qcStatus,
    coaAvailable: data.coaAvailable,
    expDate: toDateStr(data.expDate),
    issuedQuantity: data.issuedQuantity,
    usedQuantity: data.usedQuantity,
    rejectedQuantity: data.rejectedQuantity ?? 0,
    returnedQuantity: data.returnedQuantity ?? 0,
    packagingMaterialCategory: data.packagingMaterialCategory,
    materialName: data.materialName,
    riskLevel: data.riskLevel,
    remarks: data.remarks,
  };
  const computed = computePackagingCompliance(complianceInput, existingRecords);
  return {
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: data.product,
    productCode: data.productCode,
    batchNumber: data.batchNumber,
    packagingMaterialType: data.packagingMaterialType,
    packagingMaterialCategory: data.packagingMaterialCategory,
    materialCode: data.materialCode,
    materialName: data.materialName.trim(),
    manufacturerName: data.manufacturerName.trim(),
    supplierName: data.supplierName.trim(),
    vendorAvlStatus: data.vendorAvlStatus,
    grnNumber: data.grnNumber,
    arNumber: data.arNumber.trim(),
    coaNumber: data.coaNumber,
    materialLotNumber: data.materialLotNumber,
    mfgDate: toDateStr(data.mfgDate),
    expDate: toDateStr(data.expDate),
    receivedQuantity: data.receivedQuantity,
    issuedQuantity: data.issuedQuantity,
    usedQuantity: data.usedQuantity,
    rejectedQuantity: data.rejectedQuantity ?? 0,
    returnedQuantity: data.returnedQuantity ?? 0,
    balanceQuantity: computed.balanceQuantity,
    unit: data.unit,
    qcStatus: data.qcStatus,
    coaAvailable: data.coaAvailable,
    specificationNumber: data.specificationNumber,
    stpNumber: data.stpNumber,
    reconciliationStatus: computed.reconciliationStatus,
    complianceStatus: computed.complianceStatus,
    complianceReasons: computed.complianceReasons,
    riskLevel: computed.riskLevel,
    rejectionPct: computed.rejectionPct,
    variancePct: computed.variancePct,
    remarks: data.remarks,
    sourceType: 'manual',
    attachmentUrls: [],
    updatedAt: nowIso(),
    updatedBy: '',
    updatedByName: '',
  };
}

export async function createPackagingReviewRecord(
  pqr: PqrOption,
  data: PackagingReviewFormData,
  actor: PqrPackagingReviewActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (data.productCode && pqr.productCode && data.productCode !== pqr.productCode) {
    return { error: 'Packaging product code must match the selected PQR product.' };
  }
  if (await checkDuplicatePackagingAr(pqr.id, data.arNumber, data.materialName, data.materialLotNumber)) {
    return { error: 'Duplicate AR Number for this packaging material and lot under the same PQR.' };
  }

  try {
    const existing = await fetchPackagingReviewRecords(pqr.id);
    const ts = nowIso();
    const fields = formToRecordFields(pqr, data, existing);
    const record: Omit<PqrPackagingReviewRecord, 'id'> = {
      packagingReviewId: buildPackagingReviewId(data.materialName, data.arNumber),
      ...fields,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdByName: actor.name,
      updatedByName: actor.name,
      isDeleted: false,
    };

    const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview), record);
    await logPackagingAudit('create packaging review record', actor, { arNumber: data.arNumber }, docRef.id);
    await logPackagingAudit('compliance recalculated', actor, { complianceStatus: record.complianceStatus }, docRef.id);
    await logPackagingAudit('reconciliation recalculated', actor, { reconciliationStatus: record.reconciliationStatus }, docRef.id);
    return { id: docRef.id };
  } catch (e) {
    console.error('createPackagingReviewRecord failed', e);
    return { error: 'Unable to create packaging review record.' };
  }
}

export async function updatePackagingReviewRecord(
  id: string,
  pqr: PqrOption,
  data: PackagingReviewFormData,
  actor: PqrPackagingReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (await checkDuplicatePackagingAr(pqr.id, data.arNumber, data.materialName, data.materialLotNumber, id)) {
    return { error: 'Duplicate AR Number for this packaging material and lot under the same PQR.' };
  }

  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    const existing = await fetchPackagingReviewRecords(pqr.id);
    const fields = formToRecordFields(pqr, data, existing);
    await updateDoc(doc(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview, id), {
      ...fields,
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logPackagingAudit('edit packaging review record', actor, { id, arNumber: data.arNumber }, id, oldValue);
    await logPackagingAudit('compliance recalculated', actor, { complianceStatus: fields.complianceStatus }, id);
    await logPackagingAudit('reconciliation recalculated', actor, { reconciliationStatus: fields.reconciliationStatus }, id);
    return {};
  } catch (e) {
    console.error('updatePackagingReviewRecord failed', e);
    return { error: 'Unable to update packaging review record.' };
  }
}

export async function softDeletePackagingReviewRecord(
  id: string,
  actor: PqrPackagingReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    await updateDoc(doc(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview, id), {
      isDeleted: true,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logPackagingAudit('delete/soft delete packaging record', actor, { id }, id, oldValue);
    return {};
  } catch (e) {
    console.error('softDeletePackagingReviewRecord failed', e);
    return { error: 'Unable to remove packaging review record.' };
  }
}

export async function savePackagingSectionToPqr(
  pqrId: string,
  narrative: string,
  records: PqrPackagingReviewRecord[],
  actor: PqrPackagingReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const summary = computePackagingSummary(records);
    const ts = nowIso();
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('sectionKey', '==', 'packing_material'),
    ));

    const payload = {
      pqrId,
      sectionKey: 'packing_material',
      sectionType: 'Packaging Review',
      sectionOrder: 7,
      sectionTitle: 'Packing Material Review',
      narrative,
      dataSummary: JSON.stringify(summary),
      included: true,
      status: summary.totalPackagingLots > 0 ? 'Completed' : 'Draft',
      updatedAt: ts,
      updatedBy: actor.id,
    };

    if (snap.empty) {
      await addDoc(collection(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.sections), {
        ...payload,
        createdAt: ts,
        createdBy: actor.id,
        isDeleted: false,
      });
    } else {
      await updateDoc(snap.docs[0].ref, payload);
    }

    try {
      await updateDoc(doc(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.records, pqrId), {
        'scope.packingMaterialReview': true,
        updatedAt: ts,
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
    } catch {
      // Legacy documents may not support nested scope.
    }

    await logPackagingAudit('section saved to PQR', actor, { pqrId, summary }, pqrId);
    return {};
  } catch (e) {
    console.error('savePackagingSectionToPqr failed', e);
    return { error: 'Unable to save packaging section to PQR.' };
  }
}

export async function uploadPackagingAttachment(
  pqrId: string,
  recordId: string,
  file: File,
  actor: PqrPackagingReviewActor,
): Promise<{ url?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  const allowed = [
    'application/pdf', 'image/png', 'image/jpeg', 'image/jpg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (file.size > 10 * 1024 * 1024) return { error: 'File size must be 10 MB or less.' };
  if (file.type && !allowed.includes(file.type)) {
    return { error: 'Unsupported file type. Use PDF, image, or Word documents.' };
  }
  try {
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `pqr/${pqrId}/packaging-review/${recordId}/${Date.now()}_${safeName}`;
    const storageRef = ref(getFirebaseStorage(), path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const docRef = doc(getFirebaseFirestore(), PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview, recordId);
    const snap = await getDoc(docRef);
    const existing = (snap.data()?.attachmentUrls as string[] | undefined) || [];
    await updateDoc(docRef, {
      attachmentUrls: [...existing, url],
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });

    await logPackagingAudit('attachment uploaded', actor, { recordId, fileName: file.name }, recordId);
    return { url };
  } catch (e) {
    console.error('uploadPackagingAttachment failed', e);
    return { error: 'Unable to upload attachment.' };
  }
}

export function exportPackagingReviewCsv(records: PqrPackagingReviewRecord[], pqrNumber?: string) {
  const headers = [
    'Sr. No.', 'PQR Number', 'Product', 'Product Code', 'Batch Number',
    'Packaging Type', 'Category', 'Material Code', 'Material Name',
    'Manufacturer', 'Supplier', 'AVL Status',
    'GRN', 'AR No.', 'COA No.', 'Lot No.',
    'MFG Date', 'EXP Date',
    'Received Qty', 'Issued Qty', 'Used Qty', 'Rejected Qty', 'Returned Qty', 'Balance Qty', 'Unit',
    'Rejection %', 'Variance %',
    'QC Status', 'COA Available', 'Specification', 'STP',
    'Reconciliation', 'Compliance', 'Compliance Reasons', 'Risk', 'Remarks', 'Source',
  ];
  const rows = records.filter((r) => !r.isDeleted).map((r, i) => [
    i + 1,
    r.pqrNumber || pqrNumber || '',
    r.product,
    r.productCode,
    r.batchNumber,
    r.packagingMaterialType,
    r.packagingMaterialCategory,
    r.materialCode,
    r.materialName,
    r.manufacturerName,
    r.supplierName,
    r.vendorAvlStatus,
    r.grnNumber,
    r.arNumber,
    r.coaNumber,
    r.materialLotNumber,
    r.mfgDate,
    r.expDate,
    r.receivedQuantity,
    r.issuedQuantity,
    r.usedQuantity,
    r.rejectedQuantity,
    r.returnedQuantity,
    r.balanceQuantity,
    r.unit,
    r.rejectionPct ?? 'Data Not Available',
    r.variancePct ?? 'Data Not Available',
    r.qcStatus,
    r.coaAvailable,
    r.specificationNumber,
    r.stpNumber,
    r.reconciliationStatus,
    r.complianceStatus,
    (r.complianceReasons || []).join('; '),
    r.riskLevel,
    r.remarks,
    r.sourceType || 'manual',
  ]);
  downloadCsv(
    `pqr-packaging-review-${(pqrNumber || 'export').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows,
  );
}

export function getPackagingReviewNarrative(records: PqrPackagingReviewRecord[]): string {
  return generatePackagingNarrative(computePackagingSummary(records), records);
}

export {
  computePackagingSummary, generatePackagingNarrative, buildPackagingCharts, buildPackagingVendorAvlRows,
} from '@/lib/pqr-packaging-review-records';

export async function logPackagingReviewView(actor: PqrPackagingReviewActor) {
  await logPackagingAudit('packaging review viewed', actor);
}

export async function logPackagingReviewExport(actor: PqrPackagingReviewActor, type: 'excel' | 'import' | 'csv') {
  await logPackagingAudit(
    type === 'import' ? 'import packaging list' : 'export packaging review',
    actor,
    { type },
  );
}

let narrativeAuditTimer: ReturnType<typeof setTimeout> | null = null;

export function logPackagingNarrativeEdit(actor: PqrPackagingReviewActor, pqrId: string) {
  if (narrativeAuditTimer) clearTimeout(narrativeAuditTimer);
  narrativeAuditTimer = setTimeout(() => {
    void logPackagingAudit('narrative edited', actor, { pqrId }, pqrId);
  }, 2000);
}

function isPackagingRelatedRecord(
  raw: Record<string, unknown>,
  batchNumbers: string[],
  materialNames: string[],
): boolean {
  const batchSet = new Set(batchNumbers.map((b) => b.toLowerCase()).filter(Boolean));
  const materialList = materialNames.map((m) => m.toLowerCase()).filter(Boolean);
  const category = str(raw.category || raw.deviationType || raw.type || raw.oosType || raw.module || raw.source).toLowerCase();
  const materialName = str(raw.materialName || raw.material_name || raw.itemName || raw.packagingMaterial).toLowerCase();
  const batchNumber = str(raw.batchNumber || raw.batch_number || raw.batchNo).toLowerCase();
  const relatesByCategory = category.includes('pack') || category.includes('label') || category.includes('carton');
  const relatesByMaterial = materialName.length > 0 && materialList.some((m) =>
    materialName === m || materialName.includes(m) || m.includes(materialName),
  );
  const relatesByBatch = batchNumber.length > 0 && batchSet.has(batchNumber);
  return relatesByCategory || relatesByMaterial || relatesByBatch;
}

export async function fetchPackagingQualityMetrics(
  pqr: PqrOption,
  records: PqrPackagingReviewRecord[],
): Promise<{ packagingDeviationCount: number; packagingCapaCount: number; packagingOosCount: number }> {
  const empty = { packagingDeviationCount: 0, packagingCapaCount: 0, packagingOosCount: 0 };
  if (!isFirebaseConfigured()) return empty;

  try {
    const batchNumbers = Array.from(new Set(records.map((r) => r.batchNumber).filter(Boolean)));
    const materialNames = Array.from(new Set(records.map((r) => r.materialName).filter(Boolean)));
    const [deviations, oosRecords, capaRecords] = await Promise.all([
      readFirst([PQR_PACKAGING_REVIEW_COLLECTIONS.deviations]),
      readFirst([PQR_PACKAGING_REVIEW_COLLECTIONS.oosRecords, 'oos']),
      readFirst([PQR_PACKAGING_REVIEW_COLLECTIONS.capaRecords, 'capa']),
    ]);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
    const inPeriod = (raw: Record<string, unknown>) => {
      const date = str(raw.createdAt || raw.created_at || raw.reportedDate || raw.reported_date || raw.date).slice(0, 10);
      if (!from || !to || !date) return true;
      return date >= from && date <= to;
    };

    return {
      packagingOosCount: oosRecords.filter((r) =>
        !r.isDeleted && inPeriod(r) && isPackagingRelatedRecord(r, batchNumbers, materialNames),
      ).length,
      packagingDeviationCount: deviations.filter((r) =>
        !r.isDeleted && inPeriod(r) && isPackagingRelatedRecord(r, batchNumbers, materialNames),
      ).length,
      packagingCapaCount: capaRecords.filter((r) =>
        !r.isDeleted && inPeriod(r) && isPackagingRelatedRecord(r, batchNumbers, materialNames),
      ).length,
    };
  } catch (e) {
    console.error('fetchPackagingQualityMetrics failed', e);
    return empty;
  }
}

export async function recalculateAllPackagingCompliance(
  pqrId: string,
  actor: PqrPackagingReviewActor,
): Promise<{ updated: number; error?: string }> {
  if (!isFirebaseConfigured()) return { updated: 0, error: 'Firebase is not configured.' };
  try {
    const records = await fetchPackagingReviewRecords(pqrId);
    let updated = 0;
    const db = getFirebaseFirestore();
    for (let i = 0; i < records.length; i += 400) {
      const chunk = records.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((r) => {
        if (!r.id) return;
        const computed = computePackagingCompliance({
          vendorAvlStatus: r.vendorAvlStatus,
          qcStatus: r.qcStatus,
          coaAvailable: r.coaAvailable,
          expDate: r.expDate,
          issuedQuantity: r.issuedQuantity,
          usedQuantity: r.usedQuantity,
          rejectedQuantity: r.rejectedQuantity,
          returnedQuantity: r.returnedQuantity,
          packagingMaterialCategory: r.packagingMaterialCategory,
          materialName: r.materialName,
          riskLevel: r.riskLevel,
          remarks: r.remarks,
        }, records);
        batch.update(doc(db, PQR_PACKAGING_REVIEW_COLLECTIONS.packagingReview, r.id), {
          complianceStatus: computed.complianceStatus,
          complianceReasons: computed.complianceReasons,
          riskLevel: computed.riskLevel,
          balanceQuantity: computed.balanceQuantity,
          reconciliationStatus: computed.reconciliationStatus,
          rejectionPct: computed.rejectionPct,
          variancePct: computed.variancePct,
          updatedAt: nowIso(),
          updatedBy: actor.id,
          updatedByName: actor.name,
        });
        updated += 1;
      });
      await batch.commit();
    }
    await logPackagingAudit('compliance recalculated', actor, { count: updated }, pqrId);
    await logPackagingAudit('reconciliation recalculated', actor, { count: updated }, pqrId);
    return { updated };
  } catch (e) {
    console.error('recalculateAllPackagingCompliance failed', e);
    return { updated: 0, error: 'Unable to recalculate packaging compliance.' };
  }
}
