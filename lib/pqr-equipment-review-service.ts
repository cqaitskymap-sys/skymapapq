import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, limit, orderBy, writeBatch,
} from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { EQUIPMENT_COLLECTIONS } from '@/lib/equipment-mgmt-types';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { fetchPqrOptions } from '@/lib/pqr-batch-review-service';
import {
  PQR_EQUIPMENT_REVIEW_COLLECTIONS, PQR_EQUIPMENT_REVIEW_MODULE,
  computeEquipmentCompliance, computeEquipmentSummary, generateEquipmentNarrative,
  inferEquipmentType, mapCalibrationStatus, mapEquipmentCategory, mapPmStatus,
  normalizeEquipmentReviewRecord,
  type EquipmentReviewFormData, type PqrEquipmentReviewRecord,
} from '@/lib/pqr-equipment-review-records';

export type PqrEquipmentReviewActor = { id: string; name: string; role?: string };

export { fetchPqrOptions };

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

function buildEquipmentReviewId(equipmentId: string) {
  return `PER-${(equipmentId || 'EQ').toUpperCase().replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

function toDateStr(v: unknown): string {
  const s = str(v).slice(0, 10);
  if (s.length === 7) return `${s}-01`;
  return s;
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

async function readMerged(names: string[], max = 500): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (const name of names) {
    const rows = await readCollection(name, max);
    all.push(...rows);
  }
  return all;
}

async function logEquipmentAudit(actionType: string, actor: PqrEquipmentReviewActor, detail?: unknown, recordId = 'equipment-review', oldValue?: unknown) {
  try {
    await createAuditLog({
      moduleName: PQR_EQUIPMENT_REVIEW_MODULE,
      collectionName: PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview,
      recordId,
      actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview,
      documentId: recordId,
      action: actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_EQUIPMENT_REVIEW_MODULE,
    });
  } catch (e) {
    console.error('logEquipmentAudit failed', e);
  }
}

function inPeriod(dateStr: string, from: string, to: string): boolean {
  const d = dateStr.slice(0, 10);
  if (!from || !to || !d) return true;
  return d >= from && d <= to;
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

function equipmentMatchesId(raw: Record<string, unknown>, eqId: string, docId: string): boolean {
  const candidates = [
    str(raw.equipment_id || raw.equipmentId).toLowerCase(),
    str(raw.equipment_doc_id || raw.equipmentDocId).toLowerCase(),
  ].filter(Boolean);
  const eq = eqId.toLowerCase();
  const dc = docId.toLowerCase();
  return candidates.some((c) => c === eq || c === dc);
}

async function commitInChunks(rows: Array<Omit<PqrEquipmentReviewRecord, 'id'>>, chunkSize = 400) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(getFirebaseFirestore());
    chunk.forEach((record) => {
      const refDoc = doc(collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview));
      batch.set(refDoc, record);
    });
    await batch.commit();
  }
}

/** Resolve batch numbers for the PQR from pqr_batch_review, else fall back to batch master by product + period. */
async function getBatchNumbersForPqr(pqr: PqrOption): Promise<string[]> {
  try {
    const batchReview = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.batchReview),
      where('pqrId', '==', pqr.id),
      where('isDeleted', '==', false),
    ));
    if (!batchReview.empty) {
      return Array.from(new Set(batchReview.docs.map((d) => str(d.data().batchNumber)).filter(Boolean)));
    }
  } catch {
    try {
      const batchReview = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.batchReview),
        where('pqrId', '==', pqr.id),
      ));
      return Array.from(new Set(
        batchReview.docs
          .filter((d) => !d.data().isDeleted)
          .map((d) => str(d.data().batchNumber))
          .filter(Boolean),
      ));
    } catch {
      // fall through to batch master
    }
  }

  const [batches, cpvBatches] = await Promise.all([
    readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.batches]),
    readCollection(PQR_EQUIPMENT_REVIEW_COLLECTIONS.cpvBatches),
  ]);
  const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
  const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
  return Array.from(new Set(
    [...batches, ...cpvBatches]
      .filter((b) => {
        if (b.isDeleted) return false;
        if (!matchesPqrProduct(b, pqr)) return false;
        if (!from || !to) return true;
        const mfg = str(b.manufacturingDate || b.manufacturing_date).slice(0, 10);
        if (!mfg) return true;
        return mfg >= from && mfg <= to;
      })
      .map((b) => str(b.batchNumber || b.batch_number))
      .filter(Boolean),
  ));
}

/** Qualification derived honestly: 'Not Required' when the equipment does not require qualification. */
function deriveQualification(
  eq: Record<string, unknown>,
  validations: Record<string, unknown>[],
  qualifications: Record<string, unknown>[],
): { status: string; iq: string; oq: string; pq: string } {
  if (eq.qualification_required === false || eq.qualificationRequired === false) {
    return { status: 'Not Required', iq: 'N/A', oq: 'N/A', pq: 'N/A' };
  }
  const masterStatus = str(eq.qualification_status || eq.qualificationStatus);
  if (masterStatus === 'Not Required') {
    return { status: 'Not Required', iq: 'N/A', oq: 'N/A', pq: 'N/A' };
  }
  if (masterStatus === 'Qualified') {
    return { status: 'Qualified', iq: 'Approved', oq: 'Approved', pq: 'Approved' };
  }
  const eqId = str(eq.equipment_id || eq.equipmentId || eq.id);
  const docId = str(eq.id);
  const related = [...validations, ...qualifications].filter((v) =>
    str(v.equipment_id || v.equipmentId || v.equipment_doc_id) === eqId
    || str(v.equipment_doc_id || v.equipmentDocId) === docId,
  );
  if (!related.length) {
    return {
      status: masterStatus === 'Not Qualified' ? 'Not Qualified' : 'Qualification Due',
      iq: 'Pending',
      oq: 'Pending',
      pq: 'Pending',
    };
  }
  const iq = related.find((v) => str(v.validationType || v.type).toUpperCase().includes('IQ'));
  const oq = related.find((v) => str(v.validationType || v.type).toUpperCase().includes('OQ'));
  const pq = related.find((v) => str(v.validationType || v.type).toUpperCase().includes('PQ'));
  const iqStatus = str(iq?.status || iq?.validationStatus, 'Pending');
  const oqStatus = str(oq?.status || oq?.validationStatus, 'Pending');
  const pqStatus = str(pq?.status || pq?.validationStatus, 'Pending');
  const isDone = (s: string) => s.toLowerCase().includes('approved') || s.toLowerCase().includes('complete') || s === 'N/A';
  const isAnyDone = (s: string) => s.toLowerCase().includes('approved') || s.toLowerCase().includes('complete');
  const allApproved = [iqStatus, oqStatus, pqStatus].every(isDone);
  const anyApproved = [iqStatus, oqStatus, pqStatus].some(isAnyDone);
  let status = masterStatus || 'Not Qualified';
  if (allApproved) status = 'Qualified';
  else if (anyApproved) status = 'Partially Qualified';
  else if (related.some((v) => str(v.status).toLowerCase().includes('due'))) status = 'Qualification Due';
  return { status, iq: iqStatus, oq: oqStatus, pq: pqStatus };
}

/** Historical calibration status for the review period based on calibration records + due dates. */
function deriveHistoricalCalibration(
  eq: Record<string, unknown>,
  calibrations: Record<string, unknown>[],
  from: string,
  to: string,
): { status: string; lastDate: string; nextDate: string } {
  const eqId = str(eq.equipment_id || eq.equipmentId);
  const docId = str(eq.id);
  const recs = calibrations
    .filter((c) => equipmentMatchesId(c, eqId, docId))
    .sort((a, b) => str(b.calibration_date || b.calibrationDate).localeCompare(str(a.calibration_date || a.calibrationDate)));
  const latest = recs[0];
  const lastDate = str(latest?.calibration_date || latest?.calibrationDate || eq.last_calibration_date || eq.lastCalibrationDate).slice(0, 10);
  const nextDate = str(latest?.calibration_due_date || latest?.calibrationDueDate || eq.calibration_due_date || eq.calibrationDueDate).slice(0, 10);

  if (eq.calibration_required === false || eq.calibrationRequired === false
    || str(eq.calibration_status).toLowerCase() === 'not required') {
    return { status: 'Not Calibrated', lastDate, nextDate };
  }
  if (latest && str(latest.calibration_status || latest.calibrationStatus).toLowerCase() === 'failed') {
    return { status: 'Calibration Overdue', lastDate, nextDate };
  }
  if (nextDate && from && to) {
    if (nextDate < from) return { status: 'Calibration Overdue', lastDate, nextDate };
    if (nextDate <= to) return { status: 'Calibration Due', lastDate, nextDate };
    return { status: lastDate ? 'Calibrated' : 'Not Calibrated', lastDate, nextDate };
  }
  return {
    status: mapCalibrationStatus(str(latest?.calibration_status || latest?.calibrationStatus || eq.calibration_status, 'Not Calibrated')),
    lastDate,
    nextDate,
  };
}

/** Historical PM status for the review period based on PM records + due dates. */
function deriveHistoricalPm(
  eq: Record<string, unknown>,
  pms: Record<string, unknown>[],
  from: string,
  to: string,
): { status: string; lastDate: string; nextDate: string } {
  const eqId = str(eq.equipment_id || eq.equipmentId);
  const docId = str(eq.id);
  const recs = pms
    .filter((p) => equipmentMatchesId(p, eqId, docId))
    .sort((a, b) => str(b.pm_date || b.pmDate).localeCompare(str(a.pm_date || a.pmDate)));
  const latest = recs[0];
  const lastDate = str(latest?.pm_date || latest?.pmDate).slice(0, 10);
  const nextDate = str(latest?.next_pm_due_date || latest?.nextPmDueDate || eq.pm_due_date || eq.pmDueDate).slice(0, 10);

  if (eq.pm_required === false || eq.pmRequired === false
    || str(eq.pm_status).toLowerCase() === 'not required') {
    return { status: 'Not Applicable', lastDate, nextDate };
  }
  if (latest && str(latest.pm_status || latest.pmStatus).toLowerCase() === 'failed') {
    return { status: 'Overdue', lastDate, nextDate };
  }
  if (nextDate && from && to) {
    if (nextDate < from) return { status: 'Overdue', lastDate, nextDate };
    if (nextDate <= to) return { status: 'Due', lastDate, nextDate };
    return { status: lastDate ? 'Completed' : 'Not Applicable', lastDate, nextDate };
  }
  return {
    status: mapPmStatus(str(latest?.pm_status || latest?.pmStatus || eq.pm_status, 'Not Applicable')),
    lastDate,
    nextDate,
  };
}

function deriveCleaningStatus(
  eq: Record<string, unknown>,
  cleaningValidations: Record<string, unknown>[],
): string {
  const eqId = str(eq.equipment_id || eq.equipmentId);
  const docId = str(eq.id);
  const recs = cleaningValidations
    .filter((c) => equipmentMatchesId(c, eqId, docId))
    .sort((a, b) => str(b.validation_date || b.validationDate || b.date).localeCompare(str(a.validation_date || a.validationDate || a.date)));
  const latest = recs[0];
  if (!latest) return '';
  return str(latest.status || latest.validationStatus || latest.cleaning_status || latest.cleaningStatus);
}

function deriveValidationStatus(
  eq: Record<string, unknown>,
  validations: Record<string, unknown>[],
): string {
  const eqId = str(eq.equipment_id || eq.equipmentId);
  const docId = str(eq.id);
  const recs = validations
    .filter((v) => equipmentMatchesId(v, eqId, docId))
    .sort((a, b) => str(b.updated_at || b.updatedAt || b.created_at).localeCompare(str(a.updated_at || a.updatedAt || a.created_at)));
  const latest = recs[0];
  if (!latest) return '';
  return str(latest.status || latest.validationStatus || latest.validation_status);
}

function countLinked(
  equipmentId: string,
  docId: string,
  records: Record<string, unknown>[],
  from: string,
  to: string,
): number {
  return records.filter((r) => {
    if (r.isDeleted) return false;
    const eid = str(r.equipment_id || r.equipmentId || r.equipment_doc_id || r.equipmentDocId);
    if (!eid) return false;
    if (eid.toLowerCase() !== equipmentId.toLowerCase() && eid.toLowerCase() !== docId.toLowerCase()) return false;
    const date = str(r.createdAt || r.created_at || r.reportedDate || r.date || r.breakdown_date).slice(0, 10);
    return inPeriod(date, from, to);
  }).length;
}

interface EquipmentReviewContext {
  calibrations: Record<string, unknown>[];
  pms: Record<string, unknown>[];
  breakdowns: Record<string, unknown>[];
  validations: Record<string, unknown>[];
  qualifications: Record<string, unknown>[];
  cleaningValidations: Record<string, unknown>[];
  deviations: Record<string, unknown>[];
  oos: Record<string, unknown>[];
  capas: Record<string, unknown>[];
  changeControls: Record<string, unknown>[];
  from: string;
  to: string;
}

interface EquipmentReviewMeta {
  batchesUsed: string[];
  usageCount: number;
  sourceType: PqrEquipmentReviewRecord['sourceType'];
}

function mapToEquipmentReviewRecord(
  eq: Record<string, unknown>,
  pqr: PqrOption,
  context: EquipmentReviewContext,
  meta: EquipmentReviewMeta,
  actor: PqrEquipmentReviewActor,
): Omit<PqrEquipmentReviewRecord, 'id'> {
  const ts = nowIso();
  const eqId = str(eq.equipment_id || eq.equipmentId);
  const docId = str(eq.id);
  const category = mapEquipmentCategory(str(eq.equipment_type || eq.equipmentType || eq.category));
  const eqName = str(eq.equipment_name || eq.equipmentName || eq.name);

  const qual = deriveQualification(eq, context.validations, context.qualifications);
  const cal = deriveHistoricalCalibration(eq, context.calibrations, context.from, context.to);
  const pm = deriveHistoricalPm(eq, context.pms, context.from, context.to);
  const cleaningStatus = deriveCleaningStatus(eq, context.cleaningValidations);
  const validationStatus = deriveValidationStatus(eq, context.validations);

  const eqBreakdowns = context.breakdowns.filter((b) => {
    if (!equipmentMatchesId(b, eqId, docId)) return false;
    return inPeriod(str(b.breakdown_date || b.breakdownDate), context.from, context.to);
  });
  const criticalBd = eqBreakdowns.some((b) =>
    b.impact_on_product_quality === true || b.impactOnProductQuality === true
    || str(b.severity).toLowerCase() === 'critical',
  );

  const linkedDeviations = countLinked(eqId, docId, context.deviations, context.from, context.to);
  const linkedOos = countLinked(eqId, docId, context.oos, context.from, context.to);
  const linkedCapa = countLinked(eqId, docId, context.capas, context.from, context.to);
  const linkedCc = countLinked(eqId, docId, context.changeControls, context.from, context.to);

  const partial: Partial<PqrEquipmentReviewRecord> = {
    equipmentReviewId: buildEquipmentReviewId(eqId || docId),
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: pqr.productName,
    productCode: pqr.productCode,
    batchNumber: meta.batchesUsed[0] || '',
    manufacturingLine: str(eq.manufacturing_line || eq.manufacturingLine || eq.line),
    equipmentId: eqId || docId,
    equipmentCode: eqId || docId,
    equipmentName: eqName,
    equipmentCategory: category,
    equipmentType: inferEquipmentType(eqName, category),
    department: str(eq.department),
    area: str(eq.area_room_no || eq.area || eq.location),
    modelNumber: str(eq.model || eq.modelNumber),
    serialNumber: str(eq.serial_no || eq.serialNumber),
    manufacturer: str(eq.make || eq.manufacturer),
    installationDate: toDateStr(eq.installation_date || eq.installationDate),
    qualificationStatus: qual.status,
    iqStatus: qual.iq,
    oqStatus: qual.oq,
    pqStatus: qual.pq,
    calibrationStatus: cal.status,
    lastCalibrationDate: cal.lastDate,
    nextCalibrationDate: cal.nextDate,
    pmStatus: pm.status,
    lastPmDate: pm.lastDate,
    nextPmDate: pm.nextDate,
    breakdownCount: eqBreakdowns.length,
    downtimeHours: eqBreakdowns.reduce((s, b) => s + num(b.downtime_hours || b.downtimeHours), 0),
    linkedDeviations,
    linkedCapa,
    linkedChangeControls: linkedCc,
    impactOnProduct: criticalBd ? 'Critical product impact' : eqBreakdowns.length ? 'Minor impact' : 'None',
    remarks: str(eq.remarks),
    batchesUsed: meta.batchesUsed,
    batchCount: meta.batchesUsed.length,
    usageCount: meta.usageCount,
    criticality: str(eq.criticality || eq.equipment_criticality || eq.risk_category),
    equipmentStatus: str(eq.equipment_status || eq.status),
    cleaningStatus,
    validationStatus,
    linkedOos,
    reviewPeriodFrom: context.from,
    reviewPeriodTo: context.to,
    attachmentUrls: [],
    sourceType: meta.sourceType,
    sourceId: docId,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdByName: actor.name,
    updatedByName: actor.name,
    isDeleted: false,
  };

  const computed = computeEquipmentCompliance(partial);
  return { ...partial, ...computed } as Omit<PqrEquipmentReviewRecord, 'id'>;
}

export async function fetchEquipmentReviewRecords(pqrId: string): Promise<PqrEquipmentReviewRecord[]> {
  if (!isFirebaseConfigured() || !pqrId) return [];
  try {
    let rows: PqrEquipmentReviewRecord[] = [];
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview),
        where('pqrId', '==', pqrId),
        where('isDeleted', '==', false),
      ));
      rows = snap.docs.map((d) => normalizeEquipmentReviewRecord({ id: d.id, ...d.data() }));
    } catch {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview),
        where('pqrId', '==', pqrId),
      ));
      rows = snap.docs
        .map((d) => normalizeEquipmentReviewRecord({ id: d.id, ...d.data() }))
        .filter((r) => !r.isDeleted);
    }
    return rows.sort((a, b) => a.equipmentName.localeCompare(b.equipmentName));
  } catch (e) {
    console.error('fetchEquipmentReviewRecords failed', e);
    return [];
  }
}

export async function pullEquipmentData(
  pqr: PqrOption,
  actor: PqrEquipmentReviewActor,
): Promise<{ created: number; skipped: number; error?: string }> {
  if (!isFirebaseConfigured()) return { created: 0, skipped: 0, error: 'Firebase is not configured.' };

  try {
    await logEquipmentAudit('pull equipment data', actor, { pqrId: pqr.id }, pqr.id);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';

    const [
      batchNumbers, existing, equipment, utility, usageLogs,
      calibrations, pms, breakdowns, validations, qualifications, cleaningValidations,
      deviations, oos, capas, changeControls,
    ] = await Promise.all([
      getBatchNumbersForPqr(pqr),
      fetchEquipmentReviewRecords(pqr.id),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentMaster, EQUIPMENT_COLLECTIONS.master]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.utilityEquipment]),
      readMerged([PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentUsageLogs, PQR_EQUIPMENT_REVIEW_COLLECTIONS.ebmrEquipmentUsage]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.calibrationRecords, PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentCalibration, EQUIPMENT_COLLECTIONS.calibration]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.pmRecords, PQR_EQUIPMENT_REVIEW_COLLECTIONS.preventiveMaintenance, EQUIPMENT_COLLECTIONS.pm]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.breakdownRecords, EQUIPMENT_COLLECTIONS.breakdown]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.validationRecords, 'validation']),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentQualification]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.cleaningValidation, 'cleaning_validation_records']),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.deviations]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.oosRecords, 'oos']),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.capaRecords, 'capa']),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.changeControls, 'change_control']),
    ]);

    const allEquipment = [...equipment, ...utility];
    const existingIds = new Set(existing.map((r) => (r.equipmentId || '').toLowerCase()).filter(Boolean));
    const batchSet = new Set(batchNumbers.map((b) => b.toLowerCase()));

    const context: EquipmentReviewContext = {
      calibrations, pms, breakdowns, validations, qualifications, cleaningValidations,
      deviations, oos, capas, changeControls, from, to,
    };

    // Build usage index keyed by equipment id (from usage logs matching PQR batches/product).
    const usageByEquipment = new Map<string, { batches: Set<string>; count: number }>();
    for (const u of usageLogs) {
      if (u.isDeleted) continue;
      const eid = str(u.equipment_id || u.equipmentId || u.equipment_doc_id || u.equipmentDocId).toLowerCase();
      if (!eid) continue;
      const rawBatch = str(u.batchNumber || u.batch_number || u.batchNo);
      const matchesBatch = !!rawBatch && batchSet.has(rawBatch.toLowerCase());
      const matchesProduct = matchesPqrProduct(u, pqr);
      const include = batchSet.size > 0 ? matchesBatch : matchesProduct;
      if (!include) continue;
      const cur = usageByEquipment.get(eid) || { batches: new Set<string>(), count: 0 };
      if (rawBatch) cur.batches.add(rawBatch);
      cur.count += 1;
      usageByEquipment.set(eid, cur);
    }

    type Target = { eq: Record<string, unknown>; meta: EquipmentReviewMeta };
    let targets: Target[] = [];

    if (usageByEquipment.size > 0) {
      // Usage/batch links exist: include only the equipment actually used.
      for (const eq of allEquipment) {
        const eid = str(eq.equipment_id || eq.equipmentId).toLowerCase();
        const did = str(eq.id).toLowerCase();
        const usage = usageByEquipment.get(eid) || usageByEquipment.get(did);
        if (!usage) continue;
        targets.push({
          eq,
          meta: { batchesUsed: Array.from(usage.batches), usageCount: usage.count, sourceType: 'equipment_usage' },
        });
      }
    }

    if (targets.length === 0) {
      // Product-linked equipment fields present on master.
      const productLinked = allEquipment.filter((eq) => matchesPqrProduct(eq, pqr));
      if (productLinked.length > 0) {
        targets = productLinked.map((eq) => ({
          eq,
          meta: { batchesUsed: [], usageCount: 0, sourceType: 'batch_linked' },
        }));
      }
    }

    if (targets.length === 0) {
      // Fallback: all active (non-Retired) equipment from master, without inventing batch links.
      targets = allEquipment
        .filter((eq) => str(eq.equipment_status || eq.status, 'Active') !== 'Retired')
        .map((eq) => ({
          eq,
          meta: { batchesUsed: [], usageCount: 0, sourceType: 'equipment_master' },
        }));
    }

    let skipped = 0;
    const toCreate: Array<Omit<PqrEquipmentReviewRecord, 'id'>> = [];
    const seen = new Set<string>();

    for (const { eq, meta } of targets) {
      const eqId = str(eq.equipment_id || eq.equipmentId || eq.id);
      if (!eqId) { skipped += 1; continue; }
      const key = eqId.toLowerCase();
      if (existingIds.has(key) || seen.has(key)) { skipped += 1; continue; }
      if (str(eq.equipment_status || eq.status, 'Active') === 'Retired') { skipped += 1; continue; }
      seen.add(key);
      toCreate.push(mapToEquipmentReviewRecord(eq, pqr, context, meta, actor));
    }

    if (toCreate.length) await commitInChunks(toCreate);

    await logEquipmentAudit('pull equipment data completed', actor, {
      created: toCreate.length, skipped, batchCount: batchNumbers.length,
    }, pqr.id);
    await logEquipmentAudit('compliance recalculated', actor, { created: toCreate.length }, pqr.id);
    await logEquipmentAudit('risk calculation', actor, { created: toCreate.length }, pqr.id);
    return { created: toCreate.length, skipped };
  } catch (e) {
    console.error('pullEquipmentData failed', e);
    return { created: 0, skipped: 0, error: 'Unable to pull equipment data. Please try again.' };
  }
}

function formToRecordFields(
  pqr: PqrOption,
  data: EquipmentReviewFormData,
): Omit<PqrEquipmentReviewRecord, 'id' | 'equipmentReviewId' | 'createdAt' | 'createdBy' | 'createdByName' | 'isDeleted'> {
  const computed = computeEquipmentCompliance(data);
  const batchNumber = data.batchNumber.trim();
  return {
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: data.product.trim(),
    productCode: data.productCode || pqr.productCode,
    batchNumber,
    manufacturingLine: data.manufacturingLine.trim(),
    equipmentId: data.equipmentId.trim(),
    equipmentCode: (data.equipmentCode || data.equipmentId).trim(),
    equipmentName: data.equipmentName.trim(),
    equipmentCategory: data.equipmentCategory,
    equipmentType: data.equipmentType,
    department: data.department,
    area: data.area,
    modelNumber: data.modelNumber,
    serialNumber: data.serialNumber,
    manufacturer: data.manufacturer,
    installationDate: toDateStr(data.installationDate),
    qualificationStatus: data.qualificationStatus,
    iqStatus: data.iqStatus,
    oqStatus: data.oqStatus,
    pqStatus: data.pqStatus,
    calibrationStatus: data.calibrationStatus,
    lastCalibrationDate: toDateStr(data.lastCalibrationDate),
    nextCalibrationDate: toDateStr(data.nextCalibrationDate),
    pmStatus: data.pmStatus,
    lastPmDate: toDateStr(data.lastPmDate),
    nextPmDate: toDateStr(data.nextPmDate),
    breakdownCount: data.breakdownCount,
    downtimeHours: data.downtimeHours,
    linkedDeviations: data.linkedDeviations,
    linkedCapa: data.linkedCapa,
    linkedChangeControls: data.linkedChangeControls,
    impactOnProduct: data.impactOnProduct,
    complianceStatus: computed.complianceStatus,
    complianceReasons: computed.complianceReasons,
    riskLevel: computed.riskLevel,
    remarks: data.remarks,
    batchesUsed: batchNumber ? [batchNumber] : [],
    batchCount: batchNumber ? 1 : 0,
    usageCount: 0,
    criticality: '',
    equipmentStatus: '',
    cleaningStatus: '',
    validationStatus: '',
    linkedOos: 0,
    reviewPeriodFrom: pqr.reviewPeriodFrom?.slice(0, 10) || '',
    reviewPeriodTo: pqr.reviewPeriodTo?.slice(0, 10) || '',
    attachmentUrls: [],
    sourceType: 'manual',
    updatedAt: nowIso(),
    updatedBy: '',
    updatedByName: '',
  };
}

export async function createEquipmentReviewRecord(
  pqr: PqrOption,
  data: EquipmentReviewFormData,
  actor: PqrEquipmentReviewActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (data.productCode && pqr.productCode && data.productCode !== pqr.productCode) {
    return { error: 'Equipment product code must match the selected PQR product.' };
  }
  try {
    const existing = await fetchEquipmentReviewRecords(pqr.id);
    if (existing.some((r) => r.equipmentId.toLowerCase() === data.equipmentId.trim().toLowerCase())) {
      return { error: 'Equipment already reviewed under this PQR.' };
    }
    const ts = nowIso();
    const fields = formToRecordFields(pqr, data);
    const record: Omit<PqrEquipmentReviewRecord, 'id'> = {
      equipmentReviewId: buildEquipmentReviewId(data.equipmentId),
      ...fields,
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdByName: actor.name,
      updatedByName: actor.name,
      isDeleted: false,
    };

    const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview), record);
    await logEquipmentAudit('create equipment review', actor, { equipmentId: data.equipmentId }, docRef.id);
    await logEquipmentAudit('compliance recalculated', actor, { complianceStatus: record.complianceStatus }, docRef.id);
    return { id: docRef.id };
  } catch (e) {
    console.error('createEquipmentReviewRecord failed', e);
    return { error: 'Unable to create equipment review record.' };
  }
}

export async function updateEquipmentReviewRecord(
  id: string,
  pqr: PqrOption,
  data: EquipmentReviewFormData,
  actor: PqrEquipmentReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    const computed = computeEquipmentCompliance(data);
    const batchNumber = data.batchNumber.trim();
    await updateDoc(doc(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview, id), {
      ...data,
      product: data.product.trim(),
      productCode: data.productCode || pqr.productCode,
      batchNumber,
      manufacturingLine: data.manufacturingLine.trim(),
      equipmentCode: (data.equipmentCode || data.equipmentId).trim(),
      installationDate: toDateStr(data.installationDate),
      lastCalibrationDate: toDateStr(data.lastCalibrationDate),
      nextCalibrationDate: toDateStr(data.nextCalibrationDate),
      lastPmDate: toDateStr(data.lastPmDate),
      nextPmDate: toDateStr(data.nextPmDate),
      batchesUsed: batchNumber ? [batchNumber] : [],
      batchCount: batchNumber ? 1 : 0,
      complianceStatus: computed.complianceStatus,
      complianceReasons: computed.complianceReasons,
      riskLevel: computed.riskLevel,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logEquipmentAudit('edit equipment review', actor, { id, equipmentId: data.equipmentId }, id, oldValue);
    await logEquipmentAudit('compliance recalculated', actor, computed, id);
    return {};
  } catch (e) {
    console.error('updateEquipmentReviewRecord failed', e);
    return { error: 'Unable to update equipment review record.' };
  }
}

export async function softDeleteEquipmentReviewRecord(id: string, actor: PqrEquipmentReviewActor): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    await updateDoc(doc(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview, id), {
      isDeleted: true,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logEquipmentAudit('delete equipment review', actor, { id }, id, oldValue);
    return {};
  } catch (e) {
    console.error('softDeleteEquipmentReviewRecord failed', e);
    return { error: 'Unable to remove equipment review record.' };
  }
}

export async function saveEquipmentSectionToPqr(
  pqrId: string,
  narrative: string,
  records: PqrEquipmentReviewRecord[],
  actor: PqrEquipmentReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const summary = computeEquipmentSummary(records);
    const ts = nowIso();
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('sectionKey', '==', 'equipment_review'),
    ));

    const payload = {
      pqrId,
      sectionKey: 'equipment_review',
      sectionType: 'Equipment Review',
      sectionOrder: 22,
      sectionTitle: 'Equipment / Utility Qualification Review',
      narrative,
      dataSummary: JSON.stringify(summary),
      included: true,
      status: summary.totalEquipmentReviewed > 0 ? 'Completed' : 'Draft',
      updatedAt: ts,
      updatedBy: actor.id,
    };

    if (snap.empty) {
      await addDoc(collection(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.sections), {
        ...payload,
        createdAt: ts,
        createdBy: actor.id,
        isDeleted: false,
      });
    } else {
      await updateDoc(snap.docs[0].ref, payload);
    }

    try {
      await updateDoc(doc(getFirebaseFirestore(), PQR_EQUIPMENT_REVIEW_COLLECTIONS.records, pqrId), {
        'scope.equipmentReview': true,
        updatedAt: ts,
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
    } catch {
      // Legacy documents may not support nested scope.
    }

    await logEquipmentAudit('section saved to PQR', actor, { pqrId, summary }, pqrId);
    return {};
  } catch (e) {
    console.error('saveEquipmentSectionToPqr failed', e);
    return { error: 'Unable to save equipment section to PQR.' };
  }
}

export function exportEquipmentReviewCsv(records: PqrEquipmentReviewRecord[], pqrNumber?: string) {
  const headers = [
    'Sr. No.', 'PQR Number', 'Product', 'Product Code', 'Batch Number', 'Manufacturing Line',
    'Equipment ID', 'Equipment Code', 'Equipment Name', 'Category', 'Type',
    'Department', 'Area', 'Model', 'Serial No.', 'Manufacturer', 'Installation Date',
    'Criticality', 'Equipment Status',
    'Qualification', 'IQ', 'OQ', 'PQ',
    'Calibration', 'Last Calibration', 'Next Calibration',
    'PM Status', 'Last PM', 'Next PM',
    'Cleaning Status', 'Validation Status',
    'Batches Used', 'Batch Count', 'Usage Count',
    'Breakdowns', 'Downtime (hrs)',
    'Linked Deviations', 'Linked OOS', 'Linked CAPA', 'Linked Change Controls',
    'Impact On Product', 'Compliance', 'Compliance Reasons', 'Risk', 'Remarks', 'Source',
  ];
  const rows = records.filter((r) => !r.isDeleted).map((r, i) => [
    i + 1,
    r.pqrNumber || pqrNumber || '',
    r.product,
    r.productCode,
    r.batchNumber || '',
    r.manufacturingLine || '',
    r.equipmentId,
    r.equipmentCode,
    r.equipmentName,
    r.equipmentCategory,
    r.equipmentType,
    r.department,
    r.area,
    r.modelNumber,
    r.serialNumber,
    r.manufacturer,
    r.installationDate,
    r.criticality || 'Data Not Available',
    r.equipmentStatus || 'Data Not Available',
    r.qualificationStatus,
    r.iqStatus,
    r.oqStatus,
    r.pqStatus,
    r.calibrationStatus,
    r.lastCalibrationDate,
    r.nextCalibrationDate,
    r.pmStatus,
    r.lastPmDate,
    r.nextPmDate,
    r.cleaningStatus || 'Data Not Available',
    r.validationStatus || 'Data Not Available',
    (r.batchesUsed || []).join('; '),
    r.batchCount ?? 0,
    r.usageCount ?? 0,
    r.breakdownCount,
    r.downtimeHours,
    r.linkedDeviations,
    r.linkedOos ?? 0,
    r.linkedCapa,
    r.linkedChangeControls,
    r.impactOnProduct,
    r.complianceStatus,
    (r.complianceReasons || []).join('; '),
    r.riskLevel,
    r.remarks,
    r.sourceType || 'manual',
  ]);
  downloadCsv(
    `pqr-equipment-review-${(pqrNumber || 'export').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows,
  );
}

export function getEquipmentReviewNarrative(records: PqrEquipmentReviewRecord[]): string {
  return generateEquipmentNarrative(computeEquipmentSummary(records), records);
}

export {
  computeEquipmentSummary, generateEquipmentNarrative, buildEquipmentCharts,
} from '@/lib/pqr-equipment-review-records';

function isEquipmentRelatedRecord(
  raw: Record<string, unknown>,
  equipmentIds: string[],
  equipmentNames: string[],
): boolean {
  const idSet = new Set(equipmentIds.map((e) => e.toLowerCase()).filter(Boolean));
  const nameList = equipmentNames.map((n) => n.toLowerCase()).filter(Boolean);
  const eid = str(raw.equipment_id || raw.equipmentId || raw.equipment_doc_id || raw.equipmentDocId).toLowerCase();
  const ename = str(raw.equipment_name || raw.equipmentName || raw.equipment).toLowerCase();
  const category = str(raw.category || raw.deviationType || raw.type || raw.source || raw.module).toLowerCase();
  const relatesById = eid.length > 0 && idSet.has(eid);
  const relatesByName = ename.length > 0 && nameList.some((n) => ename === n || ename.includes(n) || n.includes(ename));
  const relatesByCategory = category.includes('equipment') || category.includes('calibration') || category.includes('breakdown');
  return relatesById || relatesByName || relatesByCategory;
}

export async function fetchEquipmentQualityMetrics(
  pqr: PqrOption,
  records: PqrEquipmentReviewRecord[],
): Promise<{ equipmentDeviations: number; equipmentOos: number; equipmentCapa: number; equipmentChangeControls: number }> {
  const empty = { equipmentDeviations: 0, equipmentOos: 0, equipmentCapa: 0, equipmentChangeControls: 0 };
  if (!isFirebaseConfigured()) return empty;

  try {
    const equipmentIds = Array.from(new Set(records.flatMap((r) => [r.equipmentId, r.equipmentCode]).filter(Boolean)));
    const equipmentNames = Array.from(new Set(records.map((r) => r.equipmentName).filter(Boolean)));
    const [deviations, oos, capas, changeControls] = await Promise.all([
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.deviations]),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.oosRecords, 'oos']),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.capaRecords, 'capa']),
      readFirst([PQR_EQUIPMENT_REVIEW_COLLECTIONS.changeControls, 'change_control']),
    ]);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
    const within = (raw: Record<string, unknown>) => {
      const date = str(raw.createdAt || raw.created_at || raw.reportedDate || raw.reported_date || raw.date).slice(0, 10);
      return inPeriod(date, from, to);
    };
    const relevant = (rows: Record<string, unknown>[]) => rows.filter((r) =>
      !r.isDeleted && within(r) && isEquipmentRelatedRecord(r, equipmentIds, equipmentNames),
    ).length;

    return {
      equipmentDeviations: relevant(deviations),
      equipmentOos: relevant(oos),
      equipmentCapa: relevant(capas),
      equipmentChangeControls: relevant(changeControls),
    };
  } catch (e) {
    console.error('fetchEquipmentQualityMetrics failed', e);
    return empty;
  }
}

export async function logEquipmentReviewView(actor: PqrEquipmentReviewActor) {
  await logEquipmentAudit('equipment review viewed', actor);
}

export async function logEquipmentReviewExport(actor: PqrEquipmentReviewActor, type: 'excel' | 'import' | 'csv' = 'csv') {
  await logEquipmentAudit(type === 'import' ? 'import equipment list' : 'export equipment review', actor, { type });
}

export async function logEquipmentNarrativeEdit(actor: PqrEquipmentReviewActor, pqrId: string) {
  await logEquipmentAudit('narrative edited', actor, { pqrId }, pqrId);
}

export async function recalculateAllEquipmentCompliance(
  pqrId: string,
  actor: PqrEquipmentReviewActor,
): Promise<{ updated: number; error?: string }> {
  if (!isFirebaseConfigured()) return { updated: 0, error: 'Firebase is not configured.' };
  try {
    const records = await fetchEquipmentReviewRecords(pqrId);
    let updated = 0;
    const db = getFirebaseFirestore();
    for (let i = 0; i < records.length; i += 400) {
      const chunk = records.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((r) => {
        if (!r.id) return;
        const computed = computeEquipmentCompliance(r);
        batch.update(doc(db, PQR_EQUIPMENT_REVIEW_COLLECTIONS.equipmentReview, r.id), {
          complianceStatus: computed.complianceStatus,
          complianceReasons: computed.complianceReasons,
          riskLevel: computed.riskLevel,
          updatedAt: nowIso(),
          updatedBy: actor.id,
          updatedByName: actor.name,
        });
        updated += 1;
      });
      await batch.commit();
    }
    await logEquipmentAudit('compliance recalculated', actor, { count: updated }, pqrId);
    await logEquipmentAudit('risk calculation', actor, { count: updated }, pqrId);
    return { updated };
  } catch (e) {
    console.error('recalculateAllEquipmentCompliance failed', e);
    return { updated: 0, error: 'Unable to recalculate equipment compliance.' };
  }
}
