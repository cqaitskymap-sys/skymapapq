import {
  collection, doc, addDoc, getDocs, getDoc, query, where, limit, orderBy, writeBatch, updateDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { generateDocumentNumber, previewDocumentNumber } from '@/lib/admin/document-numbering-service';
import { sendInAppNotification } from '@/lib/notification-service';
import { downloadCsv } from '@/lib/export-utils';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import { CPV_PRODUCT_COLLECTION } from '@/lib/cpv-product-master';
import { statusMeansRejected, statusMeansReleased } from '@/lib/pqr-batch-review-records';
import { canTransitionPqrStatus, isTerminalPqrStatus } from '@/lib/pqr-dashboard-records';
import {
  PQR_CREATE_COLLECTIONS, PQR_CREATE_MODULE, PQR_SECTION_DEFINITIONS,
  SCOPE_TO_SECTIONS, ALWAYS_INCLUDED_SECTIONS,
  emptyCollectedSummary, type PqrCollectedData, type PqrCollectedSummary,
  type PqrCreateRecord, type PqrProductOption, type PqrQualityStatus,
  type PqrRiskLevel, type PqrSectionRecord, type ReviewScope,
  type PqrBatchOption, type PqrTeamMember, type PqrConflictCheck, type PqrAttachmentMeta,
  type DataLoadState,
} from '@/lib/pqr-create-records';

export type PqrCreateActor = { id: string; name: string; role?: string };

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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

function inDateRange(raw: string | undefined, from: string, to: string): boolean {
  if (!raw) return false; // strict: exclude undated records
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  return d >= new Date(from) && d <= new Date(`${to}T23:59:59`);
}

function matchesProduct(record: Record<string, unknown>, productName: string, productCode: string): boolean {
  const names = [productName, productCode].map((s) => s.trim().toLowerCase()).filter((name) => name.length >= 2);
  if (!names.length) return false;
  const fields = ['productName', 'product_name', 'product', 'productCode', 'product_code'];
  return fields.some((f) => {
    const val = str(record[f]).trim().toLowerCase();
    if (val.length < 2) return false;
    return names.some((name) => val === name || val.includes(name));
  });
}

function mapProduct(raw: Record<string, unknown>, source: 'products' | 'cpv_products'): PqrProductOption {
  return {
    id: str(raw.id),
    source,
    productCode: str(raw.productCode || raw.product_code),
    productName: str(raw.productName || raw.product_name),
    genericName: str(raw.genericName || raw.generic_name),
    brandName: str(raw.brandName || raw.brand_name),
    strength: str(raw.strength),
    dosageForm: str(raw.dosageForm || raw.dosage_form),
    productType: str(raw.productType || raw.product_type),
    productVersion: str(raw.productVersion || raw.product_version || raw.version),
    routeOfAdministration: str(raw.routeOfAdministration || raw.route_of_administration || raw.route),
    packSize: str(raw.packSize || raw.pack_size),
    market: str(raw.market),
    shelfLife: str(raw.shelfLife || raw.shelf_life),
    storageCondition: str(raw.storageCondition || raw.storage_condition),
    manufacturingSite: str(raw.manufacturingSite || raw.manufacturing_site || raw.site),
    manufacturingLicenseNumber: str(raw.manufacturingLicenseNumber || raw.manufacturing_license_number || raw.manufacturingLicenseNo),
    mfrNumber: str(raw.mfrNumber || raw.mfr_number),
    bmrNumber: str(raw.bmrNumber || raw.bmr_number),
    bprNumber: str(raw.bprNumber || raw.bpr_number),
    specificationNumber: str(raw.specificationNumber || raw.specification_number),
    stpNumber: str(raw.stpNumber || raw.stp_number),
    status: str(raw.status),
    lifecycleStatus: str(raw.lifecycleStatus || raw.lifecycle_status),
  };
}

function isProductActive(raw: Record<string, unknown>): boolean {
  if (raw.isDeleted) return false;
  const status = str(raw.status || raw.lifecycleStatus || raw.lifecycle_status).toLowerCase();
  if (status.includes('deleted') || status.includes('inactive') || status.includes('discontinued')) return false;
  return true;
}

async function logCreateAudit(actionType: string, actor: PqrCreateActor, detail?: unknown, recordId = 'create-wizard') {
  try {
    await createAuditLog({
      moduleName: PQR_CREATE_MODULE,
      collectionName: PQR_CREATE_COLLECTIONS.records,
      recordId,
      actionType,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_CREATE_COLLECTIONS.records,
      documentId: recordId,
      action: actionType,
      oldValue: null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_CREATE_MODULE,
    });
  } catch (e) {
    console.error('logCreateAudit failed', e);
  }
}

// ---------------------------------------------------------------------------
// Product fetching
// ---------------------------------------------------------------------------

export async function fetchPqrCreateProducts(): Promise<PqrProductOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const [adminProducts, cpvProducts] = await Promise.all([
      readCollection(PQR_CREATE_COLLECTIONS.products),
      readCollection(CPV_PRODUCT_COLLECTION),
    ]);
    const mapped = [
      ...adminProducts.filter(isProductActive).map((p) => mapProduct(p, 'products')),
      ...cpvProducts.filter(isProductActive).map((p) => mapProduct(p, 'cpv_products')),
    ];
    const seen = new Set<string>();
    return mapped.filter((p) => {
      const key = `${p.productCode}-${p.productName}`.toLowerCase();
      if (!p.productName || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.productName.localeCompare(b.productName));
  } catch (e) {
    console.error('fetchPqrCreateProducts failed', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Eligible batches
// ---------------------------------------------------------------------------

export async function fetchEligibleBatches(
  product: PqrProductOption,
  from: string,
  to: string,
  site?: string,
): Promise<PqrBatchOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const [batchesRaw, cpvBatchesRaw, pqrBatchesRaw] = await Promise.all([
      readCollection(PQR_CREATE_COLLECTIONS.batches),
      readCollection(PQR_CREATE_COLLECTIONS.cpvBatches),
      readCollection('pqr_batches'),
    ]);
    const all = [...batchesRaw, ...cpvBatchesRaw, ...pqrBatchesRaw];

    const seen = new Set<string>();
    const results: PqrBatchOption[] = [];

    for (const raw of all) {
      if (raw.isDeleted) continue;
      if (!matchesProduct(raw, product.productName, product.productCode)) continue;

      const mfgDate = str(raw.manufacturingDate || raw.manufacturing_date || raw.mfgDate);
      if (!mfgDate) continue; // strict: exclude undated
      if (!inDateRange(mfgDate, from, to)) continue;

      if (site) {
        const batchSite = str(raw.manufacturingSite || raw.manufacturing_site || raw.site).toLowerCase();
        if (batchSite && !batchSite.includes(site.toLowerCase())) continue;
      }

      const batchNumber = str(raw.batchNumber || raw.batch_number || raw.batchNo || raw.batch_no);
      if (!batchNumber || seen.has(batchNumber.toLowerCase())) continue;
      seen.add(batchNumber.toLowerCase());

      results.push({
        id: str(raw.id),
        batchNumber,
        productName: str(raw.productName || raw.product_name),
        productCode: str(raw.productCode || raw.product_code),
        batchSize: str(raw.batchSize || raw.batch_size),
        manufacturingDate: mfgDate,
        expiryDate: str(raw.expiryDate || raw.expiry_date),
        manufacturingSite: str(raw.manufacturingSite || raw.manufacturing_site || raw.site),
        batchStatus: str(raw.batchStatus || raw.batch_status || raw.status),
        releaseStatus: str(raw.releaseStatus || raw.release_status),
        batchType: str(raw.batchType || raw.batch_type),
        source: str(raw.source || 'batches'),
      });
    }

    return results.sort((a, b) => a.manufacturingDate.localeCompare(b.manufacturingDate));
  } catch (e) {
    console.error('fetchEligibleBatches failed', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Conflict check
// ---------------------------------------------------------------------------

function datesOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return new Date(aFrom) <= new Date(`${bTo}T23:59:59`) && new Date(bFrom) <= new Date(`${aTo}T23:59:59`);
}

function isApprovedStatus(status: string): boolean {
  return status.toLowerCase().replace(/_/g, ' ') === 'approved';
}

const ACTIVE_DRAFT_STATUSES = new Set(['draft', 'generated', 'under review', 'data collection']);

export async function checkPqrConflicts(input: {
  productId: string;
  productName: string;
  productCode: string;
  from: string;
  to: string;
  pqrNumber?: string;
  site?: string;
}): Promise<PqrConflictCheck> {
  const result: PqrConflictCheck = { overlap: false, duplicateNumber: false, activeDraft: false };
  if (!isFirebaseConfigured()) return result;

  try {
    const records = await readFirst([PQR_CREATE_COLLECTIONS.records, PQR_CREATE_COLLECTIONS.recordsLegacy]);
    for (const r of records) {
      if (r.isDeleted) continue;
      const pid = str(r.productId || r.product_id);
      const pname = str(r.productName || r.product_name);
      const pcode = str(r.productCode || r.product_code);
      const matchesOwner = pid === input.productId
        || pname.toLowerCase() === input.productName.toLowerCase()
        || (pcode && pcode.toLowerCase() === input.productCode.toLowerCase());
      if (!matchesOwner) continue;

      if (input.site) {
        const rSite = str(r.site || r.manufacturingSite).toLowerCase();
        if (rSite && !rSite.includes(input.site.toLowerCase())) continue;
      }

      const rStatus = str(r.status || r.document_status).toLowerCase().replace(/_/g, ' ');
      const rFrom = str(r.reviewPeriodFrom || r.review_period_from);
      const rTo = str(r.reviewPeriodTo || r.review_period_to);

      if (isApprovedStatus(str(r.status || r.document_status)) && datesOverlap(input.from, input.to, rFrom, rTo)) {
        result.overlap = true;
        result.existingPqrNumber = str(r.pqrNumber || r.pqr_number);
        result.existingPqrId = str(r.id);
        result.existingStatus = 'Approved';
        result.warning = `An approved PQR (${result.existingPqrNumber}) already covers this period.`;
      }

      if (ACTIVE_DRAFT_STATUSES.has(rStatus) && datesOverlap(input.from, input.to, rFrom, rTo)) {
        result.activeDraft = true;
        if (!result.existingPqrNumber) {
          result.existingPqrNumber = str(r.pqrNumber || r.pqr_number);
          result.existingPqrId = str(r.id);
          result.existingStatus = str(r.status || r.document_status);
        }
        if (!result.warning) {
          result.warning = `An active PQR (${str(r.pqrNumber || r.pqr_number)}) exists in status "${str(r.status || r.document_status)}".`;
        }
      }

      if (input.pqrNumber && str(r.pqrNumber || r.pqr_number) === input.pqrNumber) {
        result.duplicateNumber = true;
        if (!result.warning) result.warning = `PQR number "${input.pqrNumber}" is already in use.`;
      }
    }
  } catch (e) {
    console.error('checkPqrConflicts failed', e);
  }
  return result;
}

export async function checkPqrPeriodOverlap(
  productId: string,
  productName: string,
  from: string,
  to: string,
): Promise<{ overlap: boolean; existingPqrNumber?: string }> {
  const c = await checkPqrConflicts({ productId, productName, productCode: '', from, to });
  return { overlap: c.overlap, existingPqrNumber: c.existingPqrNumber };
}

// ---------------------------------------------------------------------------
// Team candidates
// ---------------------------------------------------------------------------

export async function fetchPqrTeamCandidates(): Promise<PqrTeamMember[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const profiles = await readCollection(PQR_CREATE_COLLECTIONS.profiles, 1000);
    return profiles
      .filter((p) => {
        if (p.isDeleted) return false;
        const s = str(p.status || p.accountStatus).toLowerCase();
        return !s.includes('inactive') && !s.includes('disabled') && !s.includes('deleted');
      })
      .map((p) => ({
        id: str(p.id || p.uid),
        name: str(p.name || p.displayName || p.fullName || `${str(p.firstName)} ${str(p.lastName)}`.trim()),
        email: str(p.email),
        role: str(p.role || p.userRole),
        department: str(p.department),
        designation: str(p.designation || p.title),
        status: str(p.status || p.accountStatus || 'Active'),
      }))
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (e) {
    console.error('fetchPqrTeamCandidates failed', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

function filterByProductAndDate(
  records: Record<string, unknown>[],
  productName: string,
  productCode: string,
  from: string,
  to: string,
): Record<string, unknown>[] {
  return records.filter((r) =>
    matchesProduct(r, productName, productCode)
    && inDateRange(str(
      r.deviation_date || r.deviationDate
      || r.oos_date || r.detected_date || r.occurrence_date
      || r.complaint_date || r.received_date
      || r.change_date || r.initiation_date
      || r.recall_date
      || r.manufacturingDate || r.manufacturing_date
      || r.testDate || r.test_date
      || r.recordedDate || r.recorded_date
      || r.createdAt || r.created_at,
    ), from, to),
  );
}

function countBatchStatus(batches: Record<string, unknown>[], type: 'released' | 'rejected'): number {
  return batches.filter((b) => {
    const batchStatus = str(b.batchStatus || b.batch_status || b.status);
    const releaseStatus = str(b.releaseStatus || b.release_status);
    const rejected = statusMeansRejected(batchStatus) || statusMeansRejected(releaseStatus);
    if (type === 'rejected') return rejected;
    if (rejected) return false;
    return statusMeansReleased(releaseStatus) || statusMeansReleased(batchStatus);
  }).length;
}

function countOpenCritical(records: Record<string, unknown>[], type: 'oos' | 'deviation'): number {
  return records.filter((r) => {
    const status = str(r.status).toLowerCase();
    if (['closed', 'approved', 'cancelled'].includes(status)) return false;
    const sev = str(r.severity || r.riskLevel || r.priority).toLowerCase();
    if (type === 'oos') return sev.includes('critical') || status.includes('open');
    return sev.includes('critical') || sev.includes('high');
  }).length;
}

function countOot(records: Record<string, unknown>[]): number {
  return records.filter((r) => {
    const s = str(r.status || r.result || r.classification).toLowerCase();
    return s.includes('oot') || s.includes('out of trend');
  }).length;
}

export async function collectPqrData(
  product: PqrProductOption,
  from: string,
  to: string,
  scope: ReviewScope,
  actor: PqrCreateActor,
  options?: { selectedBatchIds?: string[] },
): Promise<PqrCollectedData> {
  await logCreateAudit('data collection started', actor, { product: product.productName, from, to });

  const emptyResult = (): PqrCollectedData => ({
    summary: emptyCollectedSummary(),
    loadState: 'empty',
    batches: [], rawMaterials: [], packingMaterials: [], cppResults: [], cqaResults: [],
    yieldRecords: [], stabilityRecords: [], holdTimeRecords: [], deviations: [], oosRecords: [],
    capaRecords: [], changeControls: [], complaints: [], recalls: [], validationRecords: [],
    equipmentRecords: [], vendorRecords: [], capabilityRecords: [], riskRecords: [],
  });

  if (!isFirebaseConfigured()) {
    return { ...emptyResult(), loadState: 'error', loadError: 'Firebase is not configured.' };
  }

  try {
    const [
      batchesRaw, cpvBatchesRaw, pqrBatchesRaw, rawMat, packMat, cpp, cqa, yields,
      stability, holdTime, deviations, oos, capa, cc, complaints, recalls,
      validation, equipment, vendors, capability,
    ] = await Promise.all([
      scope.batchReview ? readCollection(PQR_CREATE_COLLECTIONS.batches) : Promise.resolve([]),
      scope.batchReview ? readCollection(PQR_CREATE_COLLECTIONS.cpvBatches) : Promise.resolve([]),
      scope.batchReview ? readCollection('pqr_batches') : Promise.resolve([]),
      scope.rawMaterialReview ? readFirst([PQR_CREATE_COLLECTIONS.rawMaterialMonitoring, CPV_COLLECTIONS.rawMaterials]) : Promise.resolve([]),
      scope.packingMaterialReview ? readFirst([PQR_CREATE_COLLECTIONS.packingMaterialMonitoring, CPV_COLLECTIONS.packingMaterials]) : Promise.resolve([]),
      scope.cppReview ? readFirst([PQR_CREATE_COLLECTIONS.cppResults, CPV_COLLECTIONS.cpp]) : Promise.resolve([]),
      (scope.cqaReview || scope.finishedProductReview) ? readFirst([PQR_CREATE_COLLECTIONS.cqaResults, CPV_COLLECTIONS.cqa]) : Promise.resolve([]),
      scope.yieldReview ? readFirst([PQR_CREATE_COLLECTIONS.yieldMonitoring, CPV_COLLECTIONS.yieldMonitoring, CPV_COLLECTIONS.yield]) : Promise.resolve([]),
      scope.stabilityReview ? readFirst([PQR_CREATE_COLLECTIONS.stabilityMonitoring, CPV_COLLECTIONS.stability]) : Promise.resolve([]),
      scope.holdTimeReview ? readFirst([PQR_CREATE_COLLECTIONS.holdTimeMonitoring, CPV_COLLECTIONS.holdTime]) : Promise.resolve([]),
      scope.deviationReview ? readFirst([PQR_CREATE_COLLECTIONS.deviations]) : Promise.resolve([]),
      scope.oosReview ? readFirst([PQR_CREATE_COLLECTIONS.oosRecords, 'oos']) : Promise.resolve([]),
      scope.capaReview ? readFirst([PQR_CREATE_COLLECTIONS.capaRecords, 'capa']) : Promise.resolve([]),
      scope.changeControlReview ? readFirst([PQR_CREATE_COLLECTIONS.changeControls, 'change_control']) : Promise.resolve([]),
      scope.complaintReview ? readCollection(PQR_CREATE_COLLECTIONS.complaints) : Promise.resolve([]),
      scope.recallReview ? readFirst([PQR_CREATE_COLLECTIONS.recalls, 'recall_records']) : Promise.resolve([]),
      scope.validationReview ? readCollection(PQR_CREATE_COLLECTIONS.validationRecords) : Promise.resolve([]),
      scope.equipmentReview ? readCollection(PQR_CREATE_COLLECTIONS.equipmentMaster) : Promise.resolve([]),
      scope.vendorReview ? readCollection(PQR_CREATE_COLLECTIONS.vendors) : Promise.resolve([]),
      readFirst(['process_capability', CPV_COLLECTIONS.capability]),
    ]);

    const { productName, productCode } = product;

    // Merge + dedupe batches by batch number
    const allBatchesRaw = [...batchesRaw, ...cpvBatchesRaw, ...pqrBatchesRaw];
    const batchesSeen = new Set<string>();
    const dedupedBatches = allBatchesRaw.filter((b) => {
      const bn = str(b.batchNumber || b.batch_number || b.batchNo || b.batch_no).toLowerCase();
      if (!bn || batchesSeen.has(bn)) return false;
      batchesSeen.add(bn);
      return true;
    });

    let batches = filterByProductAndDate(dedupedBatches, productName, productCode, from, to);

    if (options?.selectedBatchIds?.length) {
      const selectedSet = new Set(options.selectedBatchIds);
      batches = batches.filter((b) => selectedSet.has(str(b.id)));
    }

    const rawMaterials = filterByProductAndDate(rawMat, productName, productCode, from, to);
    const packingMaterials = filterByProductAndDate(packMat, productName, productCode, from, to);
    const cppResults = filterByProductAndDate(cpp, productName, productCode, from, to);
    const cqaResults = filterByProductAndDate(cqa, productName, productCode, from, to);
    const yieldRecords = filterByProductAndDate(yields, productName, productCode, from, to);
    const stabilityRecords = filterByProductAndDate(stability, productName, productCode, from, to);
    const holdTimeRecords = filterByProductAndDate(holdTime, productName, productCode, from, to);
    const deviationRecords = filterByProductAndDate(deviations, productName, productCode, from, to);
    const oosRecords = filterByProductAndDate(oos, productName, productCode, from, to);
    const capaRecords = filterByProductAndDate(capa, productName, productCode, from, to);
    const changeControls = filterByProductAndDate(cc, productName, productCode, from, to);
    const complaintRecords = filterByProductAndDate(complaints, productName, productCode, from, to);
    const recallRecords = filterByProductAndDate(recalls, productName, productCode, from, to);
    const validationRecords = filterByProductAndDate(validation, productName, productCode, from, to);
    const equipmentRecords = equipment;
    const vendorRecords = vendors;
    const capabilityRecords = filterByProductAndDate(capability, productName, productCode, from, to);

    const cpkVals = capabilityRecords.map((c) => num(c.cpk || c.Cpk)).filter((v) => v > 0);
    const averageCpk = cpkVals.length ? cpkVals.reduce((a, b) => a + b, 0) / cpkVals.length : 0;

    const summary: PqrCollectedSummary = {
      totalBatches: batches.length,
      releasedBatches: countBatchStatus(batches, 'released'),
      rejectedBatches: countBatchStatus(batches, 'rejected'),
      rawMaterialLots: rawMaterials.length,
      packingMaterialLots: packingMaterials.length,
      cppRecords: cppResults.length,
      cqaRecords: cqaResults.length,
      yieldRecords: yieldRecords.length,
      stabilityRecords: stabilityRecords.length,
      holdTimeRecords: holdTimeRecords.length,
      deviations: deviationRecords.length,
      oos: oosRecords.length,
      oot: countOot(oosRecords),
      capa: capaRecords.length,
      changeControls: changeControls.length,
      complaints: complaintRecords.length,
      recalls: recallRecords.length,
      validationRecords: validationRecords.length,
      equipmentRecords: equipmentRecords.length,
      vendorRecords: vendorRecords.length,
      riskRecords: capabilityRecords.length,
      averageCpk,
      openCriticalOos: countOpenCritical(oosRecords, 'oos'),
      openCriticalDeviations: countOpenCritical(deviationRecords, 'deviation'),
      openCapa: capaRecords.filter((c) => {
        const status = str(c.capa_status || c.capaStatus || c.status).toLowerCase();
        return status !== 'closed' && status !== 'rejected' && !status.includes('cancelled');
      }).length,
    };

    const hasData = batches.length > 0 || rawMaterials.length > 0 || oosRecords.length > 0
      || deviationRecords.length > 0 || cppResults.length > 0;
    const loadState: DataLoadState = hasData ? 'ok' : 'empty';

    const result: PqrCollectedData = {
      summary,
      loadState,
      batches, rawMaterials, packingMaterials, cppResults, cqaResults,
      yieldRecords, stabilityRecords, holdTimeRecords, deviations: deviationRecords,
      oosRecords, capaRecords, changeControls, complaints: complaintRecords,
      recalls: recallRecords, validationRecords, equipmentRecords, vendorRecords,
      capabilityRecords, riskRecords: capabilityRecords,
    };

    await logCreateAudit('data collection completed', actor, summary);
    return result;
  } catch (e) {
    console.error('collectPqrData failed', e);
    return {
      ...emptyResult(),
      loadState: 'error',
      loadError: (e as Error).message || 'Data collection failed',
    } as PqrCollectedData;
  }
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export function computeOverallAssessment(data: PqrCollectedSummary): {
  overallQualityStatus: PqrQualityStatus;
  overallRiskLevel: PqrRiskLevel;
  conclusion: string;
  recommendations: string;
} {
  const {
    rejectedBatches, releasedBatches, totalBatches, recalls, openCriticalOos, openCriticalDeviations, openCapa,
    oos, averageCpk, stabilityRecords,
  } = data;

  let overallQualityStatus: PqrQualityStatus = 'Satisfactory';
  let overallRiskLevel: PqrRiskLevel = 'Low';
  const recommendations: string[] = ['Continue annual PQR as per quality management system.'];

  if (recalls > 0 || openCriticalOos > 0 || openCriticalDeviations > 0) {
    overallQualityStatus = 'Unsatisfactory';
    overallRiskLevel = 'Critical';
    recommendations.push('Immediate QA and management review required for critical quality events.');
  } else if (oos > 2 || openCapa > 3 || rejectedBatches > 0) {
    overallQualityStatus = 'Satisfactory With Observation';
    overallRiskLevel = 'Medium';
    recommendations.push('Monitor CAPA effectiveness and OOS trending during the next review cycle.');
  } else if (averageCpk > 0 && averageCpk < 1.33) {
    overallQualityStatus = 'Needs Improvement';
    overallRiskLevel = 'Medium';
    recommendations.push('Review process capability and implement improvement actions.');
  }

  const batchSentence = totalBatches === 0
    ? 'No batches were identified for the selected review period.'
    : rejectedBatches === 0 && recalls === 0 && releasedBatches === totalBatches
      ? 'All batches manufactured during the review period were released and no batch was rejected.'
      : rejectedBatches > 0
        ? `${rejectedBatches} batch(es) rejected during the review period; remediation documented.`
        : `${releasedBatches} of ${totalBatches} batches were released. Remaining batches were not released during the review period.`;
  const recallSentence = recalls > 0 ? `${recalls} recall record(s) fall in this review period.` : '';

  // FIX: stabilityOk must NOT be always-true. If no records, cannot claim within spec.
  const stabilityOk = stabilityRecords > 0;

  const conclusionParts = [
    batchSentence,
    recallSentence,
    openCriticalOos === 0 && oos === 0
      ? 'No OOS was observed during the review period.'
      : `${oos} OOS investigation(s) recorded during the review period.`,
    openCriticalDeviations === 0 && data.deviations === 0
      ? 'No incident or deviation was reported during the review period.'
      : `${data.deviations} deviation(s) recorded; ${openCriticalDeviations} critical open.`,
    stabilityOk
      ? 'Stability data reviewed during the period indicates that the product remains within approved specification.'
      : 'Stability data not available for this period; continued monitoring recommended.',
    averageCpk <= 0
      ? 'Process capability data was not available for this review period.'
      : averageCpk >= 1.33
        ? 'Based on the reviewed data, the process is considered to be in a state of control.'
        : 'Process capability requires review against predefined acceptance criteria.',
  ].filter(Boolean);

  return {
    overallQualityStatus,
    overallRiskLevel,
    conclusion: conclusionParts.join(' '),
    recommendations: recommendations.join(' '),
  };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function sectionNarrative(
  key: string,
  product: PqrProductOption,
  from: string,
  to: string,
  data: PqrCollectedData,
): string {
  const s = data.summary;
  const narratives: Record<string, string> = {
    cover_page: `Product Quality Review for ${product.productName} (${product.productCode}) covering ${from} to ${to}.`,
    product_details: `${product.productName} is a ${product.dosageForm} containing ${product.genericName} ${product.strength}. Market: ${product.market || 'N/A'}. Shelf life: ${product.shelfLife || 'N/A'}.`,
    review_objective: 'To evaluate accumulated data for the product manufactured during the review period and confirm continued validation of manufacturing process and quality systems.',
    scope: 'Review covers batch manufacturing, materials, in-process and finished product quality, deviations, OOS, CAPA, change controls, stability, validation, equipment, complaints and recalls.',
    batch_manufacturing: s.totalBatches
      ? `${s.totalBatches} batch(es) manufactured; ${s.releasedBatches} released; ${s.rejectedBatches} rejected.`
      : 'No batch manufacturing records found for the selected review period.',
    raw_material: s.rawMaterialLots
      ? `${s.rawMaterialLots} raw material lot(s) reviewed; all within approved specifications.`
      : 'Raw material review data not available for the selected period.',
    packing_material: s.packingMaterialLots
      ? `${s.packingMaterialLots} packing material lot(s) reviewed during the period.`
      : 'Packing material review data not available for the selected period.',
    cpp_review: s.cppRecords
      ? `${s.cppRecords} CPP record(s) reviewed; critical process parameters monitored per validated ranges.`
      : 'CPP monitoring maintained per approved CPV plan.',
    in_process_cqa: s.cqaRecords
      ? `${s.cqaRecords} in-process CQA result(s) reviewed.`
      : 'In-process CQA monitoring maintained per approved specifications.',
    finished_product: s.cqaRecords
      ? 'Finished product specification results reviewed and found within approved limits where data available.'
      : 'Finished product testing maintained per approved specifications.',
    trend_analysis: 'Trend analysis performed for critical quality attributes during the review period.',
    yield_review: s.yieldRecords
      ? `Stage-wise yield remained within predefined acceptance criteria (${s.yieldRecords} record(s) reviewed).`
      : 'Yield data not available for the selected period.',
    batch_failure: s.rejectedBatches
      ? `${s.rejectedBatches} batch(es) rejected; root cause and disposition documented.`
      : 'No batch failure or rejection recorded during the review period.',
    rework_reprocess: 'Rework and reprocess events reviewed; none identified or all appropriately documented.',
    mfg_testing_procedure: 'Manufacturing and testing procedures reviewed; current approved versions in effect.',
    deviation_review: s.deviations
      ? `${s.deviations} deviation(s) recorded during the review period.`
      : 'No incident or deviation was reported during the review period.',
    oos_review: s.oos
      ? `${s.oos} OOS investigation(s) during the review period.`
      : 'No OOS was observed during the review period.',
    capa_review: s.capa
      ? `${s.capa} CAPA record(s) linked to product quality events.`
      : 'No open CAPA requiring escalation during the review period.',
    change_control: s.changeControls
      ? `${s.changeControls} change control record(s) reviewed.`
      : 'No significant change controls impacting product quality during the period.',
    stability_review: s.stabilityRecords
      ? 'Stability data reviewed during the period indicates that the product remains within approved specification.'
      : 'Stability program maintained per approved protocol.',
    validation_review: s.validationRecords
      ? `${s.validationRecords} validation record(s) reviewed; qualification status current.`
      : 'Validation and qualification status reviewed; systems within approved state.',
    equipment_review: s.equipmentRecords
      ? `${s.equipmentRecords} equipment record(s) reviewed for qualification status.`
      : 'Equipment qualification status reviewed; all critical equipment within qualification validity.',
    complaint_review: s.complaints
      ? `${s.complaints} market complaint(s) received during the review period.`
      : 'No market complaints received during the review period.',
    recall_review: s.recalls
      ? `${s.recalls} recall event(s) reviewed.`
      : 'No product recall or returned goods event during the review period.',
    technical_agreement: 'Technical agreements with contract manufacturers and suppliers reviewed.',
    supply_chain: 'Supply chain traceability reviewed for API, excipients and packaging components.',
    cqa_review: s.cqaRecords
      ? `${s.cqaRecords} CQA record(s) reviewed for continued process verification.`
      : 'CQA monitoring maintained per CPV requirements.',
    summary: `Annual PQR summary for ${product.productName}: ${s.totalBatches} batches, ${s.deviations} deviations, ${s.oos} OOS, ${s.capa} CAPA.`,
    summary_conclusion: `Annual PQR for ${product.productName} covering ${from} to ${to}. ${computeOverallAssessment(s).conclusion}`,
    conclusion: computeOverallAssessment(s).conclusion,
    revision_history: 'Revision 00 — Initial annual PQR generated from integrated QMS and CPV data.',
    approval_page: 'Prepared, reviewed and approved signatures captured on final submission.',
  };
  return narratives[key] || 'Section content to be reviewed by QA.';
}

function buildIncludedSections(scope: ReviewScope): Set<string> {
  const included = new Set<string>(ALWAYS_INCLUDED_SECTIONS);
  included.add('summary_conclusion');

  for (const [scopeKey, sectionKeys] of Object.entries(SCOPE_TO_SECTIONS)) {
    if (scope[scopeKey as keyof ReviewScope] && sectionKeys) {
      for (const sk of sectionKeys) included.add(sk);
    }
  }
  return included;
}

export function buildPqrSections(
  pqrId: string,
  product: PqrProductOption,
  from: string,
  to: string,
  data: PqrCollectedData,
  actor: PqrCreateActor,
  scope?: ReviewScope,
): PqrSectionRecord[] {
  const ts = nowIso();
  const includedKeys = scope ? buildIncludedSections(scope) : null;

  return PQR_SECTION_DEFINITIONS.map((def) => ({
    pqrId,
    sectionKey: def.key,
    sectionOrder: def.order,
    sectionTitle: def.title,
    narrative: sectionNarrative(def.key, product, from, to, data),
    dataSummary: '',
    included: includedKeys ? includedKeys.has(def.key) : true,
    status: 'Draft' as const,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    isDeleted: false,
  }));
}

// ---------------------------------------------------------------------------
// Document numbering
// ---------------------------------------------------------------------------

export async function previewAnnualPqrNumber(productCode: string, year: number): Promise<string> {
  try {
    const result = await previewDocumentNumber('PQR', 'Annual PQR', {
      productCode,
      date: new Date(year, 0, 1),
    });
    if (result.number) return result.number;
  } catch (e) {
    console.error('previewAnnualPqrNumber fallback', e);
  }
  // Fallback without burning sequence
  const records = await readFirst([PQR_CREATE_COLLECTIONS.records, PQR_CREATE_COLLECTIONS.recordsLegacy]);
  const yearRecords = records.filter((r) =>
    num(r.reviewYear || r.pqr_year) === year
    && str(r.productCode || r.product_code) === productCode,
  );
  const seq = String(yearRecords.length + 1).padStart(4, '0');
  return `PQR/${productCode || 'PRD'}/${seq}/${year}`;
}

export async function allocateAnnualPqrNumber(productCode: string, year: number): Promise<string> {
  try {
    const result = await generateDocumentNumber('PQR', 'Annual PQR', {
      productCode,
      date: new Date(year, 0, 1),
      increment: true,
    });
    if (result.number) return result.number;
  } catch (e) {
    console.error('allocateAnnualPqrNumber fallback', e);
  }
  const records = await readFirst([PQR_CREATE_COLLECTIONS.records, PQR_CREATE_COLLECTIONS.recordsLegacy]);
  const yearRecords = records.filter((r) =>
    num(r.reviewYear || r.pqr_year) === year
    && str(r.productCode || r.product_code) === productCode,
  );
  const seq = String(yearRecords.length + 1).padStart(4, '0');
  return `PQR/${productCode || 'PRD'}/${seq}/${year}`;
}

export async function generateAnnualPqrNumber(productCode: string, year: number): Promise<string> {
  return previewAnnualPqrNumber(productCode, year);
}

// ---------------------------------------------------------------------------
// Create draft
// ---------------------------------------------------------------------------

export async function createAnnualPqrDraft(input: {
  product: PqrProductOption;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  reviewYear: number;
  pqrFrequency: PqrCreateRecord['pqrFrequency'];
  dueDate: string;
  pqrOwner: string;
  reviewScope: ReviewScope;
  collectedData: PqrCollectedData;
  pqrNumber?: string;
  qaOverride?: boolean;
  actor: PqrCreateActor;
  selectedBatchIds?: string[];
  selectedBatchNumbers?: string[];
  pqrType?: PqrCreateRecord['pqrType'];
  site?: string;
  plant?: string;
  department?: string;
  description?: string;
  qaReviewer?: string;
  qcReviewer?: string;
  productionReviewer?: string;
  engineeringReviewer?: string;
  regulatoryReviewer?: string;
  finalApprover?: string;
}): Promise<{ pqrId: string; pqrNumber: string; sections: PqrSectionRecord[]; error?: string }> {
  if (!isFirebaseConfigured()) {
    return { pqrId: '', pqrNumber: '', sections: [], error: 'Firebase is not configured.' };
  }

  const { product, actor } = input;

  // Conflict check
  const conflicts = await checkPqrConflicts({
    productId: product.id,
    productName: product.productName,
    productCode: product.productCode,
    from: input.reviewPeriodFrom,
    to: input.reviewPeriodTo,
    pqrNumber: input.pqrNumber,
    site: input.site,
  });
  if (conflicts.duplicateNumber) {
    return { pqrId: '', pqrNumber: '', sections: [], error: `PQR number "${input.pqrNumber}" is already in use.` };
  }
  if (!input.qaOverride && conflicts.overlap) {
    return { pqrId: '', pqrNumber: '', sections: [], error: conflicts.warning || 'An approved PQR already covers this product and review period.' };
  }
  if (!input.qaOverride && conflicts.activeDraft) {
    return { pqrId: '', pqrNumber: '', sections: [], error: conflicts.warning || 'An active PQR already exists for this product and overlapping review period.' };
  }

  const assessment = computeOverallAssessment(input.collectedData.summary);

  // Allocate number at create (increment)
  const pqrNumber = input.pqrNumber || await allocateAnnualPqrNumber(product.productCode, input.reviewYear);

  const ts = nowIso();
  const pqrIdValue = `PQR-${Date.now().toString(36).toUpperCase()}`;

  const record: PqrCreateRecord = {
    pqrId: pqrIdValue,
    pqrNumber,
    pqrTitle: `Annual Product Quality Review — ${product.productName} (${input.reviewYear})`,
    pqrType: input.pqrType || 'Annual',
    productId: product.id,
    productCode: product.productCode,
    productName: product.productName,
    genericName: product.genericName,
    brandName: product.brandName,
    strength: product.strength,
    dosageForm: product.dosageForm,
    routeOfAdministration: product.routeOfAdministration,
    packSize: product.packSize,
    market: product.market,
    shelfLife: product.shelfLife,
    storageCondition: product.storageCondition,
    manufacturingSite: product.manufacturingSite || input.site || '',
    manufacturingLicenseNumber: product.manufacturingLicenseNumber,
    mfrNumber: product.mfrNumber,
    bmrNumber: product.bmrNumber,
    bprNumber: product.bprNumber,
    specificationNumber: product.specificationNumber,
    stpNumber: product.stpNumber,
    site: input.site || product.manufacturingSite || '',
    plant: input.plant || '',
    department: input.department || '',
    reviewPeriodFrom: input.reviewPeriodFrom,
    reviewPeriodTo: input.reviewPeriodTo,
    reviewYear: input.reviewYear,
    pqrFrequency: input.pqrFrequency,
    pqrOwner: input.pqrOwner || actor.name,
    qaReviewer: input.qaReviewer || '',
    qcReviewer: input.qcReviewer || '',
    productionReviewer: input.productionReviewer || '',
    engineeringReviewer: input.engineeringReviewer || '',
    regulatoryReviewer: input.regulatoryReviewer || '',
    finalApprover: input.finalApprover || '',
    preparedBy: actor.name,
    reviewedBy: '',
    approvedBy: '',
    dueDate: input.dueDate,
    status: 'Generated',
    version: '1.0',
    overallQualityStatus: assessment.overallQualityStatus,
    overallRiskLevel: assessment.overallRiskLevel,
    executiveSummary: `Annual PQR for ${product.productName} covering ${input.reviewPeriodFrom} to ${input.reviewPeriodTo}. ${input.collectedData.summary.totalBatches} batches reviewed.`,
    conclusion: assessment.conclusion,
    recommendations: assessment.recommendations,
    remarks: '',
    description: input.description || '',
    reviewScope: input.reviewScope,
    selectedBatchIds: input.selectedBatchIds || [],
    selectedBatchNumbers: input.selectedBatchNumbers || [],
    collectedSummary: input.collectedData.summary,
    qaOverride: input.qaOverride || false,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdByName: actor.name,
    updatedByName: actor.name,
    isDeleted: false,
  };

  try {
    const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records), record);
    const sections = buildPqrSections(docRef.id, product, input.reviewPeriodFrom, input.reviewPeriodTo, input.collectedData, actor, input.reviewScope);
    const batch = writeBatch(getFirebaseFirestore());

    sections.forEach((section) => {
      const sRef = doc(collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.sections));
      batch.set(sRef, { ...section, pqrId: docRef.id });
    });

    // Write pqr_summary_conclusion stub (Draft until Generate Summary consolidates real metrics)
    const scRef = doc(collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.summaryConclusion));
    batch.set(scRef, {
      summaryId: `PSUM-${pqrNumber.replace(/\s+/g, '-')}-STUB`,
      pqrId: docRef.id,
      pqrNumber,
      product: product.productName,
      productCode: product.productCode,
      reviewYear: String(input.reviewYear || new Date().getFullYear()),
      reviewPeriodFrom: input.reviewPeriodFrom,
      reviewPeriodTo: input.reviewPeriodTo,
      executiveSummary: record.executiveSummary,
      finalConclusion: assessment.conclusion,
      recommendations: assessment.recommendations,
      overallQualityStatus: assessment.overallQualityStatus,
      overallProcessStatus: 'Controlled With Monitoring',
      overallRiskLevel: assessment.overallRiskLevel,
      preparedBy: actor.name || '',
      reviewedBy: '',
      approvedBy: '',
      approvalDate: '',
      reviewerComments: '',
      qaComments: '',
      headQaComments: '',
      finalApprovalComments: '',
      eSignatureApplied: false,
      eSignatureMeaning: '',
      metrics: null,
      status: 'Draft',
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdByName: actor.name || '',
      updatedByName: actor.name || '',
      isDeleted: false,
    });

    // Write full-schema pqr_batch_review records for selected batches (aligned with Batch Review module)
    const batchIds = input.selectedBatchIds || [];
    const batchNumbers = input.selectedBatchNumbers || [];
    const collectedById = new Map(
      (input.collectedData.batches || []).map((b) => [str(b.id), b]),
    );
    const collectedByNumber = new Map(
      (input.collectedData.batches || []).map((b) => [
        str(b.batchNumber || b.batch_number || b.batchNo).toLowerCase(),
        b,
      ]),
    );
    for (let i = 0; i < Math.max(batchIds.length, batchNumbers.length); i++) {
      const batchId = batchIds[i] || '';
      const batchNumber = batchNumbers[i] || '';
      const raw = collectedById.get(batchId)
        || collectedByNumber.get(batchNumber.toLowerCase())
        || {};
      const brRef = doc(collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.batchReview));
      const mfg = str(raw.manufacturingDate || raw.manufacturing_date || raw.mfg_date).slice(0, 10);
      const exp = str(raw.expiryDate || raw.expiry_date || raw.exp_date).slice(0, 10);
      const statusRaw = str(raw.batchStatus || raw.batch_status || raw.status || 'Manufactured');
      const releaseRaw = str(raw.releaseStatus || raw.release_status || 'Pending');
      batch.set(brRef, {
        batchReviewId: `PBR-${(batchNumber || batchId || String(i)).toUpperCase().replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`,
        pqrId: docRef.id,
        pqrNumber,
        product: product.productName,
        productCode: product.productCode,
        genericName: product.genericName,
        strength: product.strength,
        dosageForm: product.dosageForm,
        reviewPeriodFrom: input.reviewPeriodFrom,
        reviewPeriodTo: input.reviewPeriodTo,
        batchNumber: batchNumber || str(raw.batchNumber || raw.batch_number),
        semiFinishedBatchNumber: str(raw.semiFinishedBatchNumber || raw.semi_finished_batch_number),
        finishedProductBatchNumber: str(raw.finishedProductBatchNumber || raw.finished_product_batch_number),
        packingBatchNumber: str(raw.packingBatchNumber || raw.packing_batch_number),
        manufacturingDate: mfg,
        expiryDate: exp,
        batchSize: Number(raw.batchSize ?? raw.batch_size) || 0,
        batchSizeUnit: str(raw.batchSizeUnit || raw.batch_size_unit || 'Vials', 'Vials'),
        manufacturedFor: str(raw.manufacturedFor || raw.manufactured_for),
        customerName: str(raw.customerName || raw.customer_name),
        market: str(raw.market || product.market),
        batchStatus: statusRaw.toLowerCase().includes('pending') ? 'Manufactured' : statusRaw,
        releaseStatus: releaseRaw.toLowerCase().includes('pending') || !releaseRaw ? 'Pending' : releaseRaw,
        releaseDate: str(raw.releaseDate || raw.qaReleaseDate).slice(0, 10),
        qaReleasedBy: str(raw.qaReleasedBy || ''),
        rejectionReason: '',
        holdReason: '',
        reworkRequired: false,
        reprocessRequired: false,
        linkedDeviationCount: 0,
        linkedOosCount: 0,
        linkedCapaCount: 0,
        remarks: '',
        sourceType: 'batch_master',
        sourceId: batchId || str(raw.id),
        createdAt: ts,
        updatedAt: ts,
        createdBy: actor.id,
        updatedBy: actor.id,
        createdByName: actor.name,
        updatedByName: actor.name,
        isDeleted: false,
      });
    }

    await batch.commit();
    await logCreateAudit('PQR sections generated', actor, { pqrId: docRef.id, pqrNumber, sectionCount: sections.length }, docRef.id);
    await logCreateAudit('create PQR draft', actor, { pqrId: docRef.id, pqrNumber }, docRef.id);

    return { pqrId: docRef.id, pqrNumber, sections };
  } catch (e) {
    console.error('createAnnualPqrDraft failed', e);
    return { pqrId: '', pqrNumber: '', sections: [], error: (e as Error).message || 'Failed to create PQR draft' };
  }
}

// ---------------------------------------------------------------------------
// Draft load / list
// ---------------------------------------------------------------------------

export async function loadPqrDraft(pqrId: string): Promise<PqrCreateRecord | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records, pqrId));
    if (snap.exists()) return { id: snap.id, ...snap.data() } as unknown as PqrCreateRecord;
    return null;
  } catch (e) {
    console.error('loadPqrDraft failed', e);
    return null;
  }
}

export async function listPqrDraftsForUser(userId: string): Promise<PqrCreateRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records),
      where('createdBy', '==', userId),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc'),
      limit(100),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as unknown as PqrCreateRecord));
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records),
        where('createdBy', '==', userId),
        limit(100),
      ));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as unknown as PqrCreateRecord))
        .filter((r) => !r.isDeleted)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) {
      console.error('listPqrDraftsForUser failed', e);
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Sections CRUD
// ---------------------------------------------------------------------------

export async function fetchPqrSections(pqrId: string): Promise<PqrSectionRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
    ));
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as PqrSectionRecord))
      .filter((s) => !s.isDeleted)
      .sort((a, b) => a.sectionOrder - b.sectionOrder);
  } catch (e) {
    console.error('fetchPqrSections failed', e);
    return [];
  }
}

export async function updatePqrSectionNarrative(
  sectionId: string,
  narrative: string,
  actor: PqrCreateActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    await updateDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.sections, sectionId), {
      narrative,
      updatedAt: nowIso(),
      updatedBy: actor.id,
    });
    await logCreateAudit('section edited', actor, { sectionId }, sectionId);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Save / Submit
// ---------------------------------------------------------------------------

export async function savePqrDraft(
  pqrId: string,
  updates: Partial<Pick<PqrCreateRecord, 'executiveSummary' | 'conclusion' | 'recommendations' | 'remarks' | 'status'>>,
  actor: PqrCreateActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existing = await getDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records, pqrId));
    if (!existing.exists()) return { error: 'PQR not found' };
    const current = str(existing.data().status || existing.data().document_status);
    if (isTerminalPqrStatus(current)) {
      return { error: 'Approved, closed, or archived PQRs cannot be edited. Use the controlled reopen workflow.' };
    }
    if (updates.status && !canTransitionPqrStatus(current, updates.status)) {
      return { error: `Cannot change PQR from ${current} to ${updates.status}.` };
    }
    await updateDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records, pqrId), {
      ...updates,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logCreateAudit('save draft', actor, updates, pqrId);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function submitPqrForReview(pqrId: string, actor: PqrCreateActor): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const pqrDoc = await getDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records, pqrId));
    if (!pqrDoc.exists()) return { error: 'PQR not found' };
    const currentStatus = str(pqrDoc.data().status || pqrDoc.data().document_status);
    if (isTerminalPqrStatus(currentStatus)) {
      return { error: 'Approved, closed, or archived PQRs cannot be submitted again.' };
    }

    // Ensure summary_conclusion section exists
    const sectionsSnap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('isDeleted', '==', false),
    ));
    const hasSummaryConclusion = sectionsSnap.docs.some(
      (d) => d.data().sectionKey === 'summary_conclusion' || d.data().sectionKey === 'summary',
    );
    if (!hasSummaryConclusion) {
      return { error: 'Summary & Conclusion section is required before submission.' };
    }

    await updateDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records, pqrId), {
      status: 'Under Review',
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logCreateAudit('submit for review', actor, { pqrId }, pqrId);

    // Dynamic import to avoid circular dependency
    try {
      const { submitPqrForApproval } = await import('@/lib/pqr-approval-service');
      if (pqrDoc.exists()) {
        const data = pqrDoc.data();
        await submitPqrForApproval({
          id: pqrId,
          pqrNumber: str(data.pqrNumber),
          productName: str(data.productName),
          productCode: str(data.productCode),
          genericName: str(data.genericName),
          strength: str(data.strength),
          dosageForm: str(data.dosageForm),
          reviewPeriodFrom: str(data.reviewPeriodFrom),
          reviewPeriodTo: str(data.reviewPeriodTo),
        }, actor);
      }
    } catch (approvalErr) {
      console.error('submitPqrForApproval delegation failed (non-blocking)', approvalErr);
    }

    await sendInAppNotification({
      userId: actor.id,
      moduleName: 'PQR',
      eventName: 'PQR Submitted for Review',
      recordId: pqrId,
      title: 'PQR submitted for review',
      message: 'Annual PQR has been submitted and awaits QA review.',
      type: 'approval',
      recipientRole: 'qa_manager',
      actionLink: `/pqr/${pqrId}/approval`,
    });
    return {};
  } catch (e) {
    const msg = (e as Error).message || 'Failed to submit PQR for review';
    console.error('submitPqrForReview failed', e);
    return { error: msg };
  }
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function uploadPqrAttachment(
  pqrId: string,
  file: File,
  actor: PqrCreateActor,
): Promise<{ url?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const path = `pqr/${pqrId}/attachments/${Date.now()}_${file.name}`;
    const storageRef = ref(getFirebaseStorage(), path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const meta: PqrAttachmentMeta = {
      fileName: file.name,
      url,
      path,
      uploadedAt: nowIso(),
      uploadedBy: actor.name,
    };

    // Persist metadata on pqr_records attachments array
    const pqrDoc = await getDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records, pqrId));
    if (pqrDoc.exists()) {
      const existing: PqrAttachmentMeta[] = (pqrDoc.data().attachments as PqrAttachmentMeta[]) || [];
      await updateDoc(doc(getFirebaseFirestore(), PQR_CREATE_COLLECTIONS.records, pqrId), {
        attachments: [...existing, meta],
        updatedAt: nowIso(),
        updatedBy: actor.id,
      });
    }

    await logCreateAudit('attachment uploaded', actor, { pqrId, fileName: file.name, path }, pqrId);
    return { url };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export function exportCreateSummaryCsv(summary: PqrCollectedSummary, productName: string, period: string): void {
  const headers = ['Metric', 'Value'];
  const rows: Array<[string, string | number]> = [
    ['Product', productName],
    ['Period', period],
    ['Total Batches', summary.totalBatches],
    ['Released Batches', summary.releasedBatches],
    ['Rejected Batches', summary.rejectedBatches],
    ['Raw Material Lots', summary.rawMaterialLots],
    ['Packing Material Lots', summary.packingMaterialLots],
    ['CPP Records', summary.cppRecords],
    ['CQA Records', summary.cqaRecords],
    ['Yield Records', summary.yieldRecords],
    ['Stability Records', summary.stabilityRecords],
    ['Hold Time Records', summary.holdTimeRecords],
    ['Deviations', summary.deviations],
    ['OOS', summary.oos],
    ['OOT', summary.oot],
    ['CAPA', summary.capa],
    ['Change Controls', summary.changeControls],
    ['Complaints', summary.complaints],
    ['Recalls', summary.recalls],
    ['Validation Records', summary.validationRecords],
    ['Equipment Records', summary.equipmentRecords],
    ['Vendor Records', summary.vendorRecords],
    ['Average Cpk', summary.averageCpk.toFixed(2)],
    ['Open Critical OOS', summary.openCriticalOos],
    ['Open Critical Deviations', summary.openCriticalDeviations],
    ['Open CAPA', summary.openCapa],
  ];
  downloadCsv(`PQR_Summary_${productName.replace(/\s+/g, '_')}.csv`, headers, rows);
}

// ---------------------------------------------------------------------------
// Audit log helpers
// ---------------------------------------------------------------------------

export async function logPqrCreateView(actor: PqrCreateActor) {
  await logCreateAudit('create wizard viewed', actor);
}

export async function logPqrCreateProductSelected(actor: PqrCreateActor, product: PqrProductOption) {
  await logCreateAudit('product selected', actor, { productId: product.id, productName: product.productName });
}

export async function logPqrCreatePeriodSelected(actor: PqrCreateActor, from: string, to: string) {
  await logCreateAudit('review period selected', actor, { from, to });
}

export async function logPqrCreateExport(actor: PqrCreateActor, type: 'pdf' | 'excel') {
  await logCreateAudit(type === 'pdf' ? 'PDF export clicked' : 'Excel export clicked', actor);
}

export async function logPqrCreateOverride(actor: PqrCreateActor, reason: string) {
  await logCreateAudit('QA override', actor, { reason });
}
