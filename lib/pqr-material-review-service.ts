import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, limit, orderBy, writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { downloadCsv } from '@/lib/export-utils';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import { CPV_BATCH_COLLECTION } from '@/lib/cpv-batch-registration';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { fetchPqrOptions } from '@/lib/pqr-batch-review-service';
import {
  PQR_MATERIAL_REVIEW_COLLECTIONS, PQR_MATERIAL_REVIEW_MODULE,
  computeMaterialCompliance, computeMaterialSummary, computeQuantityVariance,
  generateMaterialNarrative, normalizeMaterialReviewRecord,
  type MaterialReviewFormData, type PqrMaterialReviewRecord,
} from '@/lib/pqr-material-review-records';

export type PqrMaterialReviewActor = { id: string; name: string; role?: string };

export { fetchPqrOptions };

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function buildMaterialReviewId(materialName: string, arNumber: string) {
  const mat = (materialName || 'MAT').slice(0, 8).toUpperCase().replace(/\s+/g, '-');
  const ar = (arNumber || 'AR').toUpperCase().replace(/\s+/g, '-');
  return `PMR-${mat}-${ar}-${Date.now().toString(36).toUpperCase()}`;
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

async function logMaterialAudit(
  actionType: string,
  actor: PqrMaterialReviewActor,
  detail?: unknown,
  recordId = 'material-review',
  oldValue?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: PQR_MATERIAL_REVIEW_MODULE,
      collectionName: PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview,
      recordId,
      actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview,
      documentId: recordId,
      action: actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_MATERIAL_REVIEW_MODULE,
    });
  } catch (e) {
    console.error('logMaterialAudit failed', e);
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

function mapToReviewRecord(
  raw: Record<string, unknown>,
  pqr: PqrOption,
  batchNumber: string,
  sourceType: 'raw_material_monitoring' | 'warehouse' | 'material_master',
  vendorAvlStatus: string,
  actor: PqrMaterialReviewActor,
): Omit<PqrMaterialReviewRecord, 'id'> {
  const ts = nowIso();
  const issued = numOrNull(raw.issuedQuantity ?? raw.issued_quantity ?? raw.issuedQty) ?? 0;
  const usedRaw = numOrNull(raw.usedQuantity ?? raw.used_quantity ?? raw.usedQty ?? raw.consumed_quantity);
  const used = usedRaw ?? 0;
  const received = numOrNull(raw.receivedQuantity ?? raw.received_quantity ?? raw.receivedQty) ?? 0;
  const variance = computeQuantityVariance(issued, used);
  const qcStatus = normalizeQcStatus(str(raw.qcStatus || raw.qc_status || raw.releaseStatus || raw.status));
  const coaAvailable = (() => {
    const c = str(raw.coaAvailable || raw.coa_available || raw.coaNumber || raw.coa_number);
    if (!c) return 'No' as const;
    if (c.toLowerCase() === 'no' || c.toLowerCase() === 'false') return 'No' as const;
    return 'Yes' as const;
  })();

  const partial: Partial<PqrMaterialReviewRecord> = {
    materialReviewId: buildMaterialReviewId(
      str(raw.materialName || raw.material_name),
      str(raw.arNumber || raw.ar_number || raw.arNo),
    ),
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: pqr.productName,
    productCode: pqr.productCode,
    batchNumber: batchNumber || str(raw.batchNumber || raw.batch_number),
    materialType: str(raw.materialType || raw.material_type, 'Raw Material'),
    materialCode: str(raw.materialCode || raw.material_code),
    materialName: str(raw.materialName || raw.material_name),
    materialGrade: str(raw.materialGrade || raw.grade || raw.material_grade),
    manufacturerName: str(raw.manufacturerName || raw.manufacturer_name || raw.manufacturer),
    supplierName: str(raw.supplierName || raw.supplier_name || raw.vendorName || raw.vendor_name),
    vendorAvlStatus,
    grnNumber: str(raw.grnNumber || raw.grn_number || raw.grnNo),
    arNumber: str(raw.arNumber || raw.ar_number || raw.arNo),
    coaNumber: str(raw.coaNumber || raw.coa_number),
    materialLotNumber: str(raw.materialLotNumber || raw.lotNo || raw.lot_number || raw.lotNumber),
    mfgDate: toDateStr(raw.mfgDate || raw.manufacturingDate || raw.manufacturing_date),
    expDate: toDateStr(raw.expDate || raw.expiryDate || raw.expiry_date),
    retestDate: toDateStr(raw.retestDate || raw.retest_date),
    receivedQuantity: received,
    issuedQuantity: issued,
    usedQuantity: used,
    returnedQuantity: num(raw.returnedQuantity || raw.returned_quantity),
    rejectedQuantity: num(raw.rejectedQuantity || raw.rejected_quantity),
    unit: str(raw.unit || raw.uom, 'Kg'),
    qcStatus,
    coaAvailable,
    specificationNumber: str(raw.specificationNumber || raw.specificationNo || raw.specification_number),
    stpNumber: str(raw.stpNumber || raw.stpNo || raw.stp_number),
    varianceQty: variance.varianceQty,
    variancePct: variance.variancePct,
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

  const compliance = computeMaterialCompliance(partial);
  return {
    ...partial,
    ...compliance,
  } as Omit<PqrMaterialReviewRecord, 'id'>;
}

async function commitInChunks(rows: Array<Omit<PqrMaterialReviewRecord, 'id'>>, chunkSize = 400) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(getFirebaseFirestore());
    chunk.forEach((record) => {
      const refDoc = doc(collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview));
      batch.set(refDoc, record);
    });
    await batch.commit();
  }
}

export async function fetchMaterialReviewRecords(pqrId: string): Promise<PqrMaterialReviewRecord[]> {
  if (!isFirebaseConfigured() || !pqrId) return [];
  try {
    let rows: PqrMaterialReviewRecord[] = [];
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview),
        where('pqrId', '==', pqrId),
        where('isDeleted', '==', false),
      ));
      rows = snap.docs.map((d) => normalizeMaterialReviewRecord({ id: d.id, ...d.data() }));
    } catch {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview),
        where('pqrId', '==', pqrId),
      ));
      rows = snap.docs
        .map((d) => normalizeMaterialReviewRecord({ id: d.id, ...d.data() }))
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
    console.error('fetchMaterialReviewRecords failed', e);
    return [];
  }
}

async function getBatchNumbersForPqr(pqr: PqrOption): Promise<string[]> {
  try {
    const batchReview = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.batchReview),
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
        collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.batchReview),
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
    readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.batches]),
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

export async function pullMaterialData(
  pqr: PqrOption,
  actor: PqrMaterialReviewActor,
): Promise<{ created: number; skipped: number; error?: string }> {
  if (!isFirebaseConfigured()) return { created: 0, skipped: 0, error: 'Firebase is not configured.' };

  try {
    await logMaterialAudit('pull material data', actor, { pqrId: pqr.id }, pqr.id);

    const [batchNumbers, existing, rawMonitoring, warehouse, materialMaster, vendors, avl] = await Promise.all([
      getBatchNumbersForPqr(pqr),
      fetchMaterialReviewRecords(pqr.id),
      readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.rawMaterialMonitoring, CPV_COLLECTIONS.rawMaterials]),
      readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.warehouseMaterials]),
      readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.materialMaster]),
      readCollection(PQR_MATERIAL_REVIEW_COLLECTIONS.vendors),
      readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.approvedVendorList, 'vendor_avl']),
    ]);

    const existingAr = new Set(existing.map((r) => `${r.arNumber}|${r.materialName}`.toLowerCase()));
    const batchSet = new Set(batchNumbers.map((b) => b.toLowerCase()));
    const candidates: Array<{
      raw: Record<string, unknown>;
      batchNumber: string;
      source: 'raw_material_monitoring' | 'warehouse' | 'material_master';
    }> = [];
    const candidateKeys = new Set<string>();

    const consider = (
      raw: Record<string, unknown>,
      source: 'raw_material_monitoring' | 'warehouse' | 'material_master',
      requireBatch: boolean,
    ) => {
      if (raw.isDeleted) return;
      const bn = str(raw.batchNumber || raw.batch_number || raw.batchNo);
      if (batchSet.size > 0) {
        if (bn && !batchSet.has(bn.toLowerCase())) return;
        if (!bn && requireBatch && !matchesPqrProduct(raw, pqr)) return;
        if (!bn && !requireBatch && !matchesPqrProduct(raw, pqr)) return;
      } else if (!matchesPqrProduct(raw, pqr)) {
        return;
      }
      const ar = str(raw.arNumber || raw.ar_number || raw.arNo);
      const matName = str(raw.materialName || raw.material_name);
      if (!matName) return;
      const key = `${ar}|${matName}|${str(raw.materialLotNumber || raw.lotNo || raw.lot_number)}`.toLowerCase();
      if (candidateKeys.has(key) || existingAr.has(`${ar}|${matName}`.toLowerCase())) return;
      candidateKeys.add(key);
      candidates.push({ raw, batchNumber: bn, source });
    };

    rawMonitoring.forEach((raw) => consider(raw, 'raw_material_monitoring', true));
    warehouse.forEach((raw) => consider(raw, 'warehouse', false));
    // Material master enrichment only when linked to product and no monitoring rows found for product
    if (!candidates.length) {
      materialMaster.forEach((raw) => consider(raw, 'material_master', false));
    }

    const toCreate = candidates.map(({ raw, batchNumber, source }) => {
      const supplier = str(raw.supplierName || raw.supplier_name || raw.vendorName);
      const manufacturer = str(raw.manufacturerName || raw.manufacturer_name || raw.manufacturer);
      const avlStatus = resolveVendorAvlSync(supplier, manufacturer, vendors, avl);
      return mapToReviewRecord(raw, pqr, batchNumber, source, avlStatus, actor);
    }).filter((r) => r.materialName);

    if (toCreate.length) await commitInChunks(toCreate);

    await logMaterialAudit('pull material data completed', actor, {
      created: toCreate.length,
      skipped: existing.length,
      batchCount: batchNumbers.length,
    }, pqr.id);
    return { created: toCreate.length, skipped: existing.length };
  } catch (e) {
    console.error('pullMaterialData failed', e);
    return { created: 0, skipped: 0, error: 'Unable to pull material data. Please try again.' };
  }
}

export async function checkDuplicateAr(
  pqrId: string,
  arNumber: string,
  materialName: string,
  excludeId?: string,
): Promise<boolean> {
  const records = await fetchMaterialReviewRecords(pqrId);
  return records.some((r) =>
    r.arNumber.toLowerCase() === arNumber.toLowerCase()
    && r.materialName.toLowerCase() === materialName.toLowerCase()
    && r.id !== excludeId,
  );
}

export async function createMaterialReviewRecord(
  pqr: PqrOption,
  data: MaterialReviewFormData,
  actor: PqrMaterialReviewActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (data.productCode && pqr.productCode && data.productCode !== pqr.productCode) {
    return { error: 'Material product code must match the selected PQR product.' };
  }
  if (await checkDuplicateAr(pqr.id, data.arNumber, data.materialName)) {
    return { error: 'Duplicate AR Number for this material under the same PQR.' };
  }

  try {
    const variance = computeQuantityVariance(data.issuedQuantity, data.usedQuantity);
    const compliance = computeMaterialCompliance({
      vendorAvlStatus: data.vendorAvlStatus,
      qcStatus: data.qcStatus,
      coaAvailable: data.coaAvailable,
      expDate: data.expDate,
      retestDate: data.retestDate,
      usedQuantity: data.usedQuantity,
      issuedQuantity: data.issuedQuantity,
      riskLevel: data.riskLevel,
      remarks: data.remarks,
    });
    const ts = nowIso();
    const record: Omit<PqrMaterialReviewRecord, 'id'> = {
      materialReviewId: buildMaterialReviewId(data.materialName, data.arNumber),
      pqrId: pqr.id,
      pqrNumber: pqr.pqrNumber,
      product: data.product,
      productCode: data.productCode,
      batchNumber: data.batchNumber,
      materialType: data.materialType,
      materialCode: data.materialCode,
      materialName: data.materialName.trim(),
      materialGrade: data.materialGrade,
      manufacturerName: data.manufacturerName.trim(),
      supplierName: data.supplierName.trim(),
      vendorAvlStatus: data.vendorAvlStatus,
      grnNumber: data.grnNumber,
      arNumber: data.arNumber.trim(),
      coaNumber: data.coaNumber,
      materialLotNumber: data.materialLotNumber,
      mfgDate: toDateStr(data.mfgDate),
      expDate: toDateStr(data.expDate),
      retestDate: toDateStr(data.retestDate),
      receivedQuantity: data.receivedQuantity,
      issuedQuantity: data.issuedQuantity,
      usedQuantity: data.usedQuantity,
      returnedQuantity: data.returnedQuantity ?? 0,
      rejectedQuantity: data.rejectedQuantity ?? 0,
      unit: data.unit,
      qcStatus: data.qcStatus,
      coaAvailable: data.coaAvailable,
      specificationNumber: data.specificationNumber,
      stpNumber: data.stpNumber,
      complianceStatus: compliance.complianceStatus,
      complianceReasons: compliance.complianceReasons,
      riskLevel: compliance.riskLevel,
      varianceQty: variance.varianceQty,
      variancePct: variance.variancePct,
      remarks: data.remarks,
      sourceType: 'manual',
      attachmentUrls: [],
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdByName: actor.name,
      updatedByName: actor.name,
      isDeleted: false,
    };

    const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview), record);
    await logMaterialAudit('create material review record', actor, { arNumber: data.arNumber }, docRef.id);
    return { id: docRef.id };
  } catch (e) {
    console.error('createMaterialReviewRecord failed', e);
    return { error: 'Unable to create material review record.' };
  }
}

export async function updateMaterialReviewRecord(
  id: string,
  pqr: PqrOption,
  data: MaterialReviewFormData,
  actor: PqrMaterialReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (await checkDuplicateAr(pqr.id, data.arNumber, data.materialName, id)) {
    return { error: 'Duplicate AR Number for this material under the same PQR.' };
  }

  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    const variance = computeQuantityVariance(data.issuedQuantity, data.usedQuantity);
    const compliance = computeMaterialCompliance({
      vendorAvlStatus: data.vendorAvlStatus,
      qcStatus: data.qcStatus,
      coaAvailable: data.coaAvailable,
      expDate: data.expDate,
      retestDate: data.retestDate,
      usedQuantity: data.usedQuantity,
      issuedQuantity: data.issuedQuantity,
      riskLevel: data.riskLevel,
      remarks: data.remarks,
    });
    await updateDoc(doc(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview, id), {
      product: data.product,
      productCode: data.productCode,
      batchNumber: data.batchNumber,
      materialType: data.materialType,
      materialCode: data.materialCode,
      materialName: data.materialName.trim(),
      materialGrade: data.materialGrade,
      manufacturerName: data.manufacturerName.trim(),
      supplierName: data.supplierName.trim(),
      vendorAvlStatus: data.vendorAvlStatus,
      grnNumber: data.grnNumber,
      arNumber: data.arNumber.trim(),
      coaNumber: data.coaNumber,
      materialLotNumber: data.materialLotNumber,
      mfgDate: toDateStr(data.mfgDate),
      expDate: toDateStr(data.expDate),
      retestDate: toDateStr(data.retestDate),
      receivedQuantity: data.receivedQuantity,
      issuedQuantity: data.issuedQuantity,
      usedQuantity: data.usedQuantity,
      returnedQuantity: data.returnedQuantity ?? 0,
      rejectedQuantity: data.rejectedQuantity ?? 0,
      unit: data.unit,
      qcStatus: data.qcStatus,
      coaAvailable: data.coaAvailable,
      specificationNumber: data.specificationNumber,
      stpNumber: data.stpNumber,
      remarks: data.remarks,
      complianceStatus: compliance.complianceStatus,
      complianceReasons: compliance.complianceReasons,
      riskLevel: compliance.riskLevel,
      varianceQty: variance.varianceQty,
      variancePct: variance.variancePct,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logMaterialAudit('edit material review record', actor, { id, arNumber: data.arNumber }, id, oldValue);
    return {};
  } catch (e) {
    console.error('updateMaterialReviewRecord failed', e);
    return { error: 'Unable to update material review record.' };
  }
}

export async function softDeleteMaterialReviewRecord(
  id: string,
  actor: PqrMaterialReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    await updateDoc(doc(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview, id), {
      isDeleted: true,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logMaterialAudit('delete/soft delete material record', actor, { id }, id, oldValue);
    return {};
  } catch (e) {
    console.error('softDeleteMaterialReviewRecord failed', e);
    return { error: 'Unable to remove material review record.' };
  }
}

export async function saveMaterialSectionToPqr(
  pqrId: string,
  narrative: string,
  records: PqrMaterialReviewRecord[],
  actor: PqrMaterialReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const summary = computeMaterialSummary(records);
    const ts = nowIso();
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('sectionKey', '==', 'raw_material'),
    ));

    const payload = {
      pqrId,
      sectionKey: 'raw_material',
      sectionType: 'Material Review',
      sectionOrder: 6,
      sectionTitle: 'API / Raw Material Review',
      narrative,
      dataSummary: JSON.stringify(summary),
      included: true,
      status: summary.totalMaterialLots > 0 ? 'Completed' : 'Draft',
      updatedAt: ts,
      updatedBy: actor.id,
    };

    if (snap.empty) {
      await addDoc(collection(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.sections), {
        ...payload,
        createdAt: ts,
        createdBy: actor.id,
        isDeleted: false,
      });
    } else {
      await updateDoc(snap.docs[0].ref, payload);
    }

    try {
      await updateDoc(doc(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.records, pqrId), {
        'scope.rawMaterialReview': true,
        updatedAt: ts,
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
    } catch {
      // Legacy documents may not support nested scope.
    }

    await logMaterialAudit('section saved to PQR', actor, { pqrId, summary }, pqrId);
    return {};
  } catch (e) {
    console.error('saveMaterialSectionToPqr failed', e);
    return { error: 'Unable to save material section to PQR.' };
  }
}

export async function uploadMaterialAttachment(
  pqrId: string,
  recordId: string,
  file: File,
  actor: PqrMaterialReviewActor,
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
    const path = `pqr/${pqrId}/material-review/${recordId}/${Date.now()}_${safeName}`;
    const storageRef = ref(getFirebaseStorage(), path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const docRef = doc(getFirebaseFirestore(), PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview, recordId);
    const snap = await getDoc(docRef);
    const existing = (snap.data()?.attachmentUrls as string[] | undefined) || [];
    await updateDoc(docRef, {
      attachmentUrls: [...existing, url],
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });

    await logMaterialAudit('attachment uploaded', actor, { recordId, fileName: file.name }, recordId);
    return { url };
  } catch (e) {
    console.error('uploadMaterialAttachment failed', e);
    return { error: 'Unable to upload attachment.' };
  }
}

export function exportMaterialReviewCsv(records: PqrMaterialReviewRecord[], pqrNumber?: string) {
  const headers = [
    'Sr. No.', 'PQR Number', 'Product', 'Product Code', 'Batch Number',
    'Material Type', 'Material Code', 'Material Name', 'Grade',
    'Manufacturer', 'Supplier', 'AVL Status',
    'GRN', 'AR No.', 'COA No.', 'Lot No.',
    'MFG Date', 'EXP Date', 'Retest Date',
    'Received Qty', 'Issued Qty', 'Used Qty', 'Returned Qty', 'Rejected Qty', 'Unit',
    'Variance Qty', 'Variance %',
    'QC Status', 'COA Available', 'Specification', 'STP',
    'Compliance', 'Risk', 'Remarks', 'Source',
  ];
  const rows = records.filter((r) => !r.isDeleted).map((r, i) => [
    i + 1,
    r.pqrNumber || pqrNumber || '',
    r.product,
    r.productCode,
    r.batchNumber,
    r.materialType,
    r.materialCode,
    r.materialName,
    r.materialGrade,
    r.manufacturerName,
    r.supplierName,
    r.vendorAvlStatus,
    r.grnNumber,
    r.arNumber,
    r.coaNumber,
    r.materialLotNumber,
    r.mfgDate,
    r.expDate,
    r.retestDate,
    r.receivedQuantity,
    r.issuedQuantity,
    r.usedQuantity,
    r.returnedQuantity ?? 0,
    r.rejectedQuantity ?? 0,
    r.unit,
    r.varianceQty ?? 'Data Not Available',
    r.variancePct ?? 'Data Not Available',
    r.qcStatus,
    r.coaAvailable,
    r.specificationNumber,
    r.stpNumber,
    r.complianceStatus,
    r.riskLevel,
    r.remarks,
    r.sourceType || 'manual',
  ]);
  downloadCsv(
    `pqr-material-review-${(pqrNumber || 'export').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows,
  );
}

export function getMaterialReviewNarrative(records: PqrMaterialReviewRecord[]): string {
  return generateMaterialNarrative(computeMaterialSummary(records), records);
}

export {
  computeMaterialSummary, generateMaterialNarrative, buildMaterialCharts, buildVendorAvlRows,
} from '@/lib/pqr-material-review-records';

export async function logMaterialReviewView(actor: PqrMaterialReviewActor) {
  await logMaterialAudit('material review viewed', actor);
}

export async function logMaterialReviewExport(actor: PqrMaterialReviewActor, type: 'excel' | 'import' | 'csv') {
  await logMaterialAudit(
    type === 'import' ? 'import material list' : 'export material review',
    actor,
    { type },
  );
}

let narrativeAuditTimer: ReturnType<typeof setTimeout> | null = null;

export function logMaterialNarrativeEdit(actor: PqrMaterialReviewActor, pqrId: string) {
  if (narrativeAuditTimer) clearTimeout(narrativeAuditTimer);
  narrativeAuditTimer = setTimeout(() => {
    void logMaterialAudit('narrative edited', actor, { pqrId }, pqrId);
  }, 2000);
}

function isMaterialRelatedRecord(
  raw: Record<string, unknown>,
  batchNumbers: string[],
  materialNames: string[],
): boolean {
  const batchSet = new Set(batchNumbers.map((b) => b.toLowerCase()).filter(Boolean));
  const materialList = materialNames.map((m) => m.toLowerCase()).filter(Boolean);
  const category = str(raw.category || raw.deviationType || raw.type || raw.oosType || raw.module).toLowerCase();
  const materialName = str(raw.materialName || raw.material_name || raw.rawMaterial || raw.itemName).toLowerCase();
  const batchNumber = str(raw.batchNumber || raw.batch_number || raw.batchNo).toLowerCase();
  const relatesByCategory = category.includes('material') || category.includes('raw') || category.includes('api');
  const relatesByMaterial = materialName.length > 0 && materialList.some((m) =>
    materialName === m || materialName.includes(m) || m.includes(materialName),
  );
  const relatesByBatch = batchNumber.length > 0 && batchSet.has(batchNumber);
  return relatesByCategory || relatesByMaterial || relatesByBatch;
}

export async function fetchMaterialQualityMetrics(
  pqr: PqrOption,
  records: PqrMaterialReviewRecord[],
): Promise<{ materialOosCount: number; materialDeviationCount: number; materialCapaCount: number }> {
  const empty = { materialOosCount: 0, materialDeviationCount: 0, materialCapaCount: 0 };
  if (!isFirebaseConfigured()) return empty;

  try {
    const batchNumbers = Array.from(new Set(records.map((r) => r.batchNumber).filter(Boolean)));
    const materialNames = Array.from(new Set(records.map((r) => r.materialName).filter(Boolean)));
    const [deviations, oosRecords, capaRecords] = await Promise.all([
      readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.deviations]),
      readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.oosRecords, 'oos']),
      readFirst([PQR_MATERIAL_REVIEW_COLLECTIONS.capaRecords, 'capa']),
    ]);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
    const inPeriod = (raw: Record<string, unknown>) => {
      const date = str(raw.createdAt || raw.created_at || raw.reportedDate || raw.reported_date || raw.date).slice(0, 10);
      if (!from || !to || !date) return true;
      return date >= from && date <= to;
    };

    return {
      materialOosCount: oosRecords.filter((r) =>
        !r.isDeleted && inPeriod(r) && isMaterialRelatedRecord(r, batchNumbers, materialNames),
      ).length,
      materialDeviationCount: deviations.filter((r) =>
        !r.isDeleted && inPeriod(r) && isMaterialRelatedRecord(r, batchNumbers, materialNames),
      ).length,
      materialCapaCount: capaRecords.filter((r) =>
        !r.isDeleted && inPeriod(r) && isMaterialRelatedRecord(r, batchNumbers, materialNames),
      ).length,
    };
  } catch (e) {
    console.error('fetchMaterialQualityMetrics failed', e);
    return empty;
  }
}

export async function recalculateAllCompliance(
  pqrId: string,
  actor: PqrMaterialReviewActor,
): Promise<{ updated: number; error?: string }> {
  if (!isFirebaseConfigured()) return { updated: 0, error: 'Firebase is not configured.' };
  try {
    const records = await fetchMaterialReviewRecords(pqrId);
    let updated = 0;
    const db = getFirebaseFirestore();
    for (let i = 0; i < records.length; i += 400) {
      const chunk = records.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((r) => {
        if (!r.id) return;
        const compliance = computeMaterialCompliance(r);
        const variance = computeQuantityVariance(r.issuedQuantity, r.usedQuantity);
        batch.update(doc(db, PQR_MATERIAL_REVIEW_COLLECTIONS.materialReview, r.id), {
          complianceStatus: compliance.complianceStatus,
          complianceReasons: compliance.complianceReasons,
          riskLevel: compliance.riskLevel,
          varianceQty: variance.varianceQty,
          variancePct: variance.variancePct,
          updatedAt: nowIso(),
          updatedBy: actor.id,
          updatedByName: actor.name,
        });
        updated += 1;
      });
      await batch.commit();
    }
    await logMaterialAudit('compliance recalculated', actor, { count: updated }, pqrId);
    return { updated };
  } catch (e) {
    console.error('recalculateAllCompliance failed', e);
    return { updated: 0, error: 'Unable to recalculate compliance.' };
  }
}
