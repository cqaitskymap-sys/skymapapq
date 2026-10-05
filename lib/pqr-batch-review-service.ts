import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, orderBy, limit, writeBatch,
} from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { CPV_BATCH_COLLECTION } from '@/lib/cpv-batch-registration';
import { downloadCsv } from '@/lib/export-utils';
import {
  PQR_BATCH_REVIEW_COLLECTIONS, PQR_BATCH_REVIEW_MODULE,
  computeBatchSummary, generateBatchNarrative, buildBatchCharts,
  computeYieldPct, normalizeBatchReviewRecord,
  type BatchReviewFormData, type PqrBatchReviewRecord, type PqrBatchReviewSummary,
  type PqrOption,
} from '@/lib/pqr-batch-review-records';

export type PqrBatchReviewActor = { id: string; name: string; role?: string };

type LinkedCounts = {
  deviations: number;
  oos: number;
  capa: number;
  complaints: number;
  changeControls: number;
};

type LinkedIndex = {
  deviations: Map<string, number>;
  oos: Map<string, number>;
  capa: Map<string, number>;
  complaints: Map<string, number>;
  changeControls: Map<string, number>;
  yields: Map<string, { theoretical: number | null; actual: number | null; pct: number | null }>;
};

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

function buildBatchReviewId(batchNumber: string) {
  return `PBR-${batchNumber.toUpperCase().replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
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

async function logBatchReviewAudit(
  actionType: string,
  actor: PqrBatchReviewActor,
  detail?: unknown,
  recordId = 'batch-review',
  oldValue?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: PQR_BATCH_REVIEW_MODULE,
      collectionName: PQR_BATCH_REVIEW_COLLECTIONS.batchReview,
      recordId,
      actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_BATCH_REVIEW_COLLECTIONS.batchReview,
      documentId: recordId,
      action: actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_BATCH_REVIEW_MODULE,
    });
  } catch (e) {
    console.error('logBatchReviewAudit failed', e);
  }
}

function inPeriod(dateStr: string, from: string, to: string): boolean {
  if (!dateStr || !from || !to) return false;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d >= new Date(from) && d <= new Date(`${to}T23:59:59`);
}

function matchesProductCode(record: Record<string, unknown>, productCode: string, productName: string): boolean {
  const code = str(record.productCode || record.product_code).toLowerCase();
  const name = str(record.productName || record.product_name || record.product).toLowerCase();
  const qCode = productCode.toLowerCase();
  const qName = productName.toLowerCase();
  if (code && qCode && code === qCode) return true;
  if (name && qName && (name.includes(qName) || qName.includes(name))) return true;
  return false;
}

function normalizeBatchStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes('not release') || s.includes('unreleased') || s.includes('pending')) return 'Manufactured';
  if (s.includes('reject') && !s.includes('not reject')) return 'Rejected';
  if (s.includes('release')) return 'Released';
  if (s.includes('hold')) return 'Hold';
  if (s.includes('rework')) return 'Reworked';
  if (s.includes('reprocess')) return 'Reprocessed';
  if (s.includes('cancel')) return 'Cancelled';
  if (s.includes('qc')) return 'Under QC Testing';
  if (s.includes('qa')) return 'Under QA Review';
  if (s.includes('manufactur') || s.includes('planned') || s.includes('active')) return 'Manufactured';
  return raw || 'Manufactured';
}

function normalizeReleaseStatus(raw: string): string {
  const s = raw.toLowerCase();
  if (!s || s.includes('pending') || s.includes('not release') || s.includes('unreleased')) return 'Pending';
  if (s.includes('reject') && !s.includes('not reject')) return 'Rejected';
  if (s.includes('hold')) return 'On Hold';
  if (s.includes('n/a') || s.includes('not applicable')) return 'Not Applicable';
  if (s.includes('release')) return 'Released';
  return raw || 'Pending';
}

function mapPqrOption(raw: Record<string, unknown>): PqrOption {
  const from = str(raw.reviewPeriodFrom || raw.review_period_from);
  const to = str(raw.reviewPeriodTo || raw.review_period_to);
  const year = Number(raw.reviewYear || raw.review_year) || (from ? Number(from.slice(0, 4)) : undefined);
  return {
    id: str(raw.id),
    pqrNumber: str(raw.pqrNumber || raw.pqr_number),
    productName: str(raw.productName || raw.product_name || raw.product),
    productCode: str(raw.productCode || raw.product_code),
    genericName: str(raw.genericName || raw.generic_name),
    strength: str(raw.strength),
    dosageForm: str(raw.dosageForm || raw.dosage_form),
    reviewPeriodFrom: from,
    reviewPeriodTo: to,
    reviewYear: year,
    site: str(raw.site || raw.manufacturingSite || raw.manufacturing_site),
    status: str(raw.status),
  };
}

function batchKey(v: unknown): string {
  return str(v).trim().toLowerCase();
}

function bumpCount(map: Map<string, number>, key: string) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

async function buildLinkedIndex(): Promise<LinkedIndex> {
  const [deviations, oos, capa, complaints, changes, yields] = await Promise.all([
    readFirst([PQR_BATCH_REVIEW_COLLECTIONS.deviations], 400),
    readFirst([PQR_BATCH_REVIEW_COLLECTIONS.oosRecords, 'oos'], 400),
    readFirst([PQR_BATCH_REVIEW_COLLECTIONS.capaRecords, 'capa'], 400),
    readFirst([PQR_BATCH_REVIEW_COLLECTIONS.complaints], 300),
    readFirst([PQR_BATCH_REVIEW_COLLECTIONS.changeControls, 'change_control'], 300),
    readFirst([PQR_BATCH_REVIEW_COLLECTIONS.yieldMonitoring, 'cpv_yield_monitoring', 'cpv_yield'], 400),
  ]);

  const index: LinkedIndex = {
    deviations: new Map(),
    oos: new Map(),
    capa: new Map(),
    complaints: new Map(),
    changeControls: new Map(),
    yields: new Map(),
  };

  deviations.forEach((r) => {
    if (r.isDeleted) return;
    bumpCount(index.deviations, batchKey(r.batchNumber || r.batch_number || r.batchNo));
  });
  oos.forEach((r) => {
    if (r.isDeleted) return;
    bumpCount(index.oos, batchKey(r.batchNumber || r.batch_number || r.batchNo));
  });
  capa.forEach((r) => {
    if (r.isDeleted) return;
    bumpCount(index.capa, batchKey(r.batchNumber || r.batch_number || r.batchNo));
  });
  complaints.forEach((r) => {
    if (r.isDeleted) return;
    bumpCount(index.complaints, batchKey(r.batchNumber || r.batch_number || r.batchNo));
  });
  changes.forEach((r) => {
    if (r.isDeleted) return;
    bumpCount(index.changeControls, batchKey(r.batchNumber || r.batch_number || r.batchNo));
  });
  yields.forEach((r) => {
    if (r.isDeleted) return;
    const bn = batchKey(r.batchNumber || r.batch_number);
    if (!bn || index.yields.has(bn)) return;
    const theoretical = num(r.expectedYield ?? r.expected_yield ?? r.theoreticalYield ?? r.theoretical_quantity, NaN);
    const actual = num(r.actualYield ?? r.actual_yield ?? r.actualQuantity ?? r.actual_quantity, NaN);
    const pct = num(r.yieldPercent ?? r.yield_percent ?? r.yieldPercentage ?? r.yieldPct, NaN);
    index.yields.set(bn, {
      theoretical: Number.isFinite(theoretical) ? theoretical : null,
      actual: Number.isFinite(actual) ? actual : null,
      pct: Number.isFinite(pct) && pct > 0
        ? pct
        : computeYieldPct(
          Number.isFinite(theoretical) ? theoretical : null,
          Number.isFinite(actual) ? actual : null,
        ),
    });
  });

  return index;
}

function linkedFromIndex(index: LinkedIndex, batchNumber: string): LinkedCounts & {
  theoreticalYield: number | null;
  actualYield: number | null;
  yieldPct: number | null;
} {
  const key = batchKey(batchNumber);
  const y = index.yields.get(key);
  return {
    deviations: index.deviations.get(key) || 0,
    oos: index.oos.get(key) || 0,
    capa: index.capa.get(key) || 0,
    complaints: index.complaints.get(key) || 0,
    changeControls: index.changeControls.get(key) || 0,
    theoreticalYield: y?.theoretical ?? null,
    actualYield: y?.actual ?? null,
    yieldPct: y?.pct ?? null,
  };
}

function mapMasterToReview(
  raw: Record<string, unknown>,
  pqr: PqrOption,
  sourceType: 'batch_master' | 'cpv_batch',
  linked: ReturnType<typeof linkedFromIndex>,
  actor: PqrBatchReviewActor,
): Omit<PqrBatchReviewRecord, 'id'> {
  const ts = nowIso();
  const batchNumber = str(raw.batchNumber || raw.batch_number || raw.batchNo);
  const batchStatus = normalizeBatchStatus(str(raw.batchStatus || raw.batch_status || raw.status));
  const releaseStatus = normalizeReleaseStatus(str(raw.releaseStatus || raw.release_status));
  const theoretical = linked.theoreticalYield
    ?? (raw.theoreticalYield != null ? num(raw.theoreticalYield, NaN) : NaN);
  const actual = linked.actualYield
    ?? (raw.actualYield != null ? num(raw.actualYield, NaN) : NaN);
  const theoreticalYield = Number.isFinite(theoretical) ? theoretical : null;
  const actualYield = Number.isFinite(actual) ? actual : null;
  const yieldPct = linked.yieldPct ?? computeYieldPct(theoreticalYield, actualYield);

  return {
    batchReviewId: buildBatchReviewId(batchNumber),
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: pqr.productName,
    productCode: pqr.productCode,
    genericName: pqr.genericName || str(raw.genericName || raw.generic_name),
    strength: pqr.strength || str(raw.strength),
    dosageForm: pqr.dosageForm || str(raw.dosageForm || raw.dosage_form),
    reviewPeriodFrom: pqr.reviewPeriodFrom,
    reviewPeriodTo: pqr.reviewPeriodTo,
    batchNumber,
    semiFinishedBatchNumber: str(raw.semiFinishedBatchNumber || raw.semi_finished_batch_number),
    finishedProductBatchNumber: str(raw.finishedProductBatchNumber || raw.finished_product_batch_number),
    packingBatchNumber: str(raw.packingBatchNumber || raw.packing_batch_number),
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date || raw.mfg_date).slice(0, 10),
    expiryDate: str(raw.expiryDate || raw.expiry_date || raw.exp_date).slice(0, 10),
    batchSize: num(raw.batchSize ?? raw.batch_size, 0),
    batchSizeUnit: str(raw.batchSizeUnit || raw.batch_size_unit || raw.unit, 'Vials'),
    manufacturedFor: str(raw.manufacturedFor || raw.manufactured_for),
    customerName: str(raw.customerName || raw.customer_name),
    market: str(raw.market || pqr.site),
    batchStatus,
    releaseStatus,
    releaseDate: str(raw.releaseDate || raw.qaReleaseDate || raw.qa_release_date).slice(0, 10),
    qaReleasedBy: str(raw.qaReleasedBy || raw.qa_released_by),
    rejectionReason: batchStatus === 'Rejected' ? str(raw.statusChangeReason || raw.rejectionReason) : '',
    holdReason: batchStatus === 'Hold' ? str(raw.statusChangeReason || raw.holdReason) : '',
    reworkRequired: batchStatus === 'Reworked' || str(raw.reworkRequired).toLowerCase() === 'true',
    reprocessRequired: batchStatus === 'Reprocessed' || str(raw.reprocessRequired).toLowerCase() === 'true',
    linkedDeviationCount: linked.deviations,
    linkedOosCount: linked.oos,
    linkedCapaCount: linked.capa,
    linkedComplaintCount: linked.complaints,
    linkedChangeControlCount: linked.changeControls,
    theoreticalYield,
    actualYield,
    yieldPct,
    remarks: str(raw.remarks),
    sourceType,
    sourceId: str(raw.id),
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdByName: actor.name,
    updatedByName: actor.name,
    isDeleted: false,
  };
}

async function commitInChunks(rows: Array<Omit<PqrBatchReviewRecord, 'id'>>, chunkSize = 400) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(getFirebaseFirestore());
    chunk.forEach((record) => {
      const ref = doc(collection(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview));
      batch.set(ref, record);
    });
    await batch.commit();
  }
}

export async function fetchPqrOptions(): Promise<PqrOption[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const rows = await readFirst([PQR_BATCH_REVIEW_COLLECTIONS.records, PQR_BATCH_REVIEW_COLLECTIONS.recordsLegacy]);
    return rows
      .filter((r) => !r.isDeleted)
      .map(mapPqrOption)
      .filter((p) => p.id && p.pqrNumber && p.productName)
      .sort((a, b) => b.pqrNumber.localeCompare(a.pqrNumber));
  } catch (e) {
    console.error('fetchPqrOptions failed', e);
    return [];
  }
}

export async function fetchPqrById(pqrId: string): Promise<PqrOption | null> {
  if (!pqrId || !isFirebaseConfigured()) return null;
  try {
    for (const col of [PQR_BATCH_REVIEW_COLLECTIONS.records, PQR_BATCH_REVIEW_COLLECTIONS.recordsLegacy]) {
      const snap = await getDoc(doc(getFirebaseFirestore(), col, pqrId));
      if (snap.exists()) {
        const data = snap.data();
        if (data.isDeleted) continue;
        return mapPqrOption({ id: snap.id, ...data });
      }
    }
  } catch (e) {
    console.error('fetchPqrById direct read failed', e);
  }
  const options = await fetchPqrOptions();
  return options.find((p) => p.id === pqrId) || null;
}

function needsHydration(r: PqrBatchReviewRecord): boolean {
  return !r.batchReviewId
    || !r.product
    || !r.manufacturingDate
    || r.batchSize <= 0
    || (r.batchStatus || '').toLowerCase() === 'pending';
}

async function hydrateFromMaster(
  records: PqrBatchReviewRecord[],
  pqr: PqrOption | null,
): Promise<PqrBatchReviewRecord[]> {
  const needs = records.filter(needsHydration);
  if (!needs.length) return records;

  const [adminBatches, cpvBatches, index] = await Promise.all([
    readFirst([PQR_BATCH_REVIEW_COLLECTIONS.batches]),
    readCollection(CPV_BATCH_COLLECTION),
    buildLinkedIndex(),
  ]);
  const byNumber = new Map<string, Record<string, unknown>>();
  [...adminBatches, ...cpvBatches].forEach((raw) => {
    const bn = batchKey(raw.batchNumber || raw.batch_number);
    if (bn && !byNumber.has(bn)) byNumber.set(bn, raw);
  });

  return records.map((r) => {
    if (!needsHydration(r)) {
      const linked = linkedFromIndex(index, r.batchNumber);
      return {
        ...r,
        linkedDeviationCount: Math.max(r.linkedDeviationCount || 0, linked.deviations),
        linkedOosCount: Math.max(r.linkedOosCount || 0, linked.oos),
        linkedCapaCount: Math.max(r.linkedCapaCount || 0, linked.capa),
        linkedComplaintCount: Math.max(r.linkedComplaintCount || 0, linked.complaints),
        linkedChangeControlCount: Math.max(r.linkedChangeControlCount || 0, linked.changeControls),
        theoreticalYield: r.theoreticalYield ?? linked.theoreticalYield,
        actualYield: r.actualYield ?? linked.actualYield,
        yieldPct: r.yieldPct ?? linked.yieldPct ?? computeYieldPct(r.theoreticalYield, r.actualYield),
      };
    }
    const raw = byNumber.get(batchKey(r.batchNumber));
    if (!raw) {
      const linked = linkedFromIndex(index, r.batchNumber);
      return {
        ...r,
        product: r.product || pqr?.productName || '',
        productCode: r.productCode || pqr?.productCode || '',
        batchStatus: normalizeBatchStatus(str(r.batchStatus)),
        linkedDeviationCount: linked.deviations,
        linkedOosCount: linked.oos,
        linkedCapaCount: linked.capa,
        linkedComplaintCount: linked.complaints,
        linkedChangeControlCount: linked.changeControls,
        theoreticalYield: r.theoreticalYield ?? linked.theoreticalYield,
        actualYield: r.actualYield ?? linked.actualYield,
        yieldPct: r.yieldPct ?? linked.yieldPct,
      };
    }
    const linked = linkedFromIndex(index, r.batchNumber);
    const option = pqr || {
      id: r.pqrId,
      pqrNumber: r.pqrNumber,
      productName: r.product || str(raw.productName),
      productCode: r.productCode || str(raw.productCode),
      genericName: r.genericName,
      strength: r.strength,
      dosageForm: r.dosageForm,
      reviewPeriodFrom: r.reviewPeriodFrom,
      reviewPeriodTo: r.reviewPeriodTo,
    };
    const mapped = mapMasterToReview(raw, option, 'batch_master', linked, {
      id: r.updatedBy || 'system',
      name: r.updatedByName || 'System',
    });
    return {
      ...mapped,
      id: r.id,
      batchReviewId: r.batchReviewId || mapped.batchReviewId,
      createdAt: r.createdAt || mapped.createdAt,
      createdBy: r.createdBy || mapped.createdBy,
      createdByName: r.createdByName || mapped.createdByName,
      remarks: r.remarks || mapped.remarks,
      sourceId: r.sourceId || mapped.sourceId,
    };
  });
}

export async function fetchBatchReviewRecords(
  pqrId: string,
  options?: { hydrate?: boolean; pqr?: PqrOption | null },
): Promise<PqrBatchReviewRecord[]> {
  if (!isFirebaseConfigured() || !pqrId) return [];
  try {
    let rows: PqrBatchReviewRecord[] = [];
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview),
        where('pqrId', '==', pqrId),
        where('isDeleted', '==', false),
      ));
      rows = snap.docs.map((d) => normalizeBatchReviewRecord({ id: d.id, ...d.data() }));
    } catch {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview),
        where('pqrId', '==', pqrId),
      ));
      rows = snap.docs
        .map((d) => normalizeBatchReviewRecord({ id: d.id, ...d.data() }))
        .filter((r) => !r.isDeleted);
    }

    const seen = new Set<string>();
    rows = rows.filter((r) => {
      const key = batchKey(r.batchNumber);
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (options?.hydrate !== false) {
      rows = await hydrateFromMaster(rows, options?.pqr ?? null);
    }

    return rows.sort((a, b) => (a.manufacturingDate || '').localeCompare(b.manufacturingDate || ''));
  } catch (e) {
    console.error('fetchBatchReviewRecords failed', e);
    return [];
  }
}

export async function checkDuplicateBatch(pqrId: string, batchNumber: string, excludeId?: string): Promise<boolean> {
  const records = await fetchBatchReviewRecords(pqrId, { hydrate: false });
  return records.some((r) =>
    r.batchNumber.toLowerCase() === batchNumber.toLowerCase() && r.id !== excludeId,
  );
}

export async function pullBatchesFromMaster(
  pqr: PqrOption,
  actor: PqrBatchReviewActor,
): Promise<{ created: number; skipped: number; error?: string }> {
  if (!isFirebaseConfigured()) return { created: 0, skipped: 0, error: 'Firebase is not configured.' };
  if (!pqr.reviewPeriodFrom || !pqr.reviewPeriodTo) {
    return { created: 0, skipped: 0, error: 'PQR review period is missing. Update the PQR before pulling batches.' };
  }

  try {
    await logBatchReviewAudit('pull batches from master', actor, { pqrId: pqr.id }, pqr.id);

    const [adminBatches, cpvBatches, existing, index] = await Promise.all([
      readFirst([PQR_BATCH_REVIEW_COLLECTIONS.batches]),
      readCollection(CPV_BATCH_COLLECTION),
      fetchBatchReviewRecords(pqr.id, { hydrate: false }),
      buildLinkedIndex(),
    ]);

    const existingNumbers = new Set(existing.map((r) => r.batchNumber.toLowerCase()).filter(Boolean));
    const from = pqr.reviewPeriodFrom;
    const to = pqr.reviewPeriodTo;
    const candidates: Array<{ raw: Record<string, unknown>; source: 'batch_master' | 'cpv_batch' }> = [];
    const candidateKeys = new Set<string>();

    const consider = (raw: Record<string, unknown>, source: 'batch_master' | 'cpv_batch') => {
      if (raw.isDeleted) return;
      if (!matchesProductCode(raw, pqr.productCode, pqr.productName)) return;
      const mfg = str(raw.manufacturingDate || raw.manufacturing_date);
      const rel = str(raw.releaseDate || raw.qaReleaseDate || raw.qa_release_date);
      if (!inPeriod(mfg, from, to) && !inPeriod(rel, from, to)) return;
      const bn = batchKey(raw.batchNumber || raw.batch_number);
      if (!bn || existingNumbers.has(bn) || candidateKeys.has(bn)) return;
      candidateKeys.add(bn);
      candidates.push({ raw, source });
    };

    adminBatches.forEach((raw) => consider(raw, 'batch_master'));
    cpvBatches.forEach((raw) => consider(raw, 'cpv_batch'));

    const toCreate = candidates.map(({ raw, source }) => {
      const batchNumber = str(raw.batchNumber || raw.batch_number);
      const linked = linkedFromIndex(index, batchNumber);
      return mapMasterToReview(raw, pqr, source, linked, actor);
    });

    if (toCreate.length) await commitInChunks(toCreate);

    await logBatchReviewAudit(
      'pull batches from master completed',
      actor,
      { created: toCreate.length, skipped: existingNumbers.size },
      pqr.id,
    );
    return { created: toCreate.length, skipped: existing.length };
  } catch (e) {
    console.error('pullBatchesFromMaster failed', e);
    return { created: 0, skipped: 0, error: 'Unable to pull batches from Batch Master. Please try again.' };
  }
}

export async function refreshLinkedCountsForPqr(
  pqrId: string,
  actor: PqrBatchReviewActor,
): Promise<{ updated: number; error?: string }> {
  if (!isFirebaseConfigured()) return { updated: 0, error: 'Firebase is not configured.' };
  try {
    const [records, index] = await Promise.all([
      fetchBatchReviewRecords(pqrId, { hydrate: false }),
      buildLinkedIndex(),
    ]);
    let updated = 0;
    const db = getFirebaseFirestore();
    for (let i = 0; i < records.length; i += 400) {
      const chunk = records.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((r) => {
        if (!r.id) return;
        const linked = linkedFromIndex(index, r.batchNumber);
        batch.update(doc(db, PQR_BATCH_REVIEW_COLLECTIONS.batchReview, r.id), {
          linkedDeviationCount: linked.deviations,
          linkedOosCount: linked.oos,
          linkedCapaCount: linked.capa,
          linkedComplaintCount: linked.complaints,
          linkedChangeControlCount: linked.changeControls,
          theoreticalYield: r.theoreticalYield ?? linked.theoreticalYield,
          actualYield: r.actualYield ?? linked.actualYield,
          yieldPct: r.yieldPct ?? linked.yieldPct ?? computeYieldPct(r.theoreticalYield, r.actualYield),
          updatedAt: nowIso(),
          updatedBy: actor.id,
          updatedByName: actor.name,
        });
        updated += 1;
      });
      await batch.commit();
    }
    await logBatchReviewAudit('refresh linked quality counts', actor, { pqrId, updated }, pqrId);
    return { updated };
  } catch (e) {
    console.error('refreshLinkedCountsForPqr failed', e);
    return { updated: 0, error: 'Unable to refresh linked quality counts.' };
  }
}

export async function createBatchReviewRecord(
  pqr: PqrOption,
  data: BatchReviewFormData,
  actor: PqrBatchReviewActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };

  if (data.productCode && pqr.productCode && data.productCode !== pqr.productCode) {
    return { error: 'Batch product code must match the selected PQR product.' };
  }

  const mfg = data.manufacturingDate.length === 7 ? `${data.manufacturingDate}-01` : data.manufacturingDate;
  if (pqr.reviewPeriodFrom && pqr.reviewPeriodTo && !inPeriod(mfg, pqr.reviewPeriodFrom, pqr.reviewPeriodTo)) {
    return { error: 'Manufacturing date is outside the PQR review period.' };
  }

  const dup = await checkDuplicateBatch(pqr.id, data.batchNumber);
  if (dup) return { error: 'Duplicate batch number under this PQR is not allowed.' };

  try {
    const index = await buildLinkedIndex();
    const linked = linkedFromIndex(index, data.batchNumber);
    const theoreticalYield = data.theoreticalYield ?? linked.theoreticalYield;
    const actualYield = data.actualYield ?? linked.actualYield;
    const yieldPct = computeYieldPct(theoreticalYield, actualYield) ?? linked.yieldPct;
    const ts = nowIso();
    const record: Omit<PqrBatchReviewRecord, 'id'> = {
      batchReviewId: buildBatchReviewId(data.batchNumber),
      pqrId: pqr.id,
      pqrNumber: pqr.pqrNumber,
      product: data.product,
      productCode: data.productCode,
      genericName: data.genericName,
      strength: data.strength,
      dosageForm: data.dosageForm,
      reviewPeriodFrom: pqr.reviewPeriodFrom,
      reviewPeriodTo: pqr.reviewPeriodTo,
      batchNumber: data.batchNumber.trim(),
      semiFinishedBatchNumber: data.semiFinishedBatchNumber,
      finishedProductBatchNumber: data.finishedProductBatchNumber,
      packingBatchNumber: data.packingBatchNumber,
      manufacturingDate: mfg.slice(0, 10),
      expiryDate: (data.expiryDate.length === 7 ? `${data.expiryDate}-01` : data.expiryDate).slice(0, 10),
      batchSize: data.batchSize,
      batchSizeUnit: data.batchSizeUnit,
      manufacturedFor: data.manufacturedFor,
      customerName: data.customerName,
      market: data.market,
      batchStatus: data.batchStatus,
      releaseStatus: data.releaseStatus,
      releaseDate: data.releaseDate,
      qaReleasedBy: data.qaReleasedBy,
      rejectionReason: data.rejectionReason,
      holdReason: data.holdReason,
      reworkRequired: data.reworkRequired,
      reprocessRequired: data.reprocessRequired,
      linkedDeviationCount: linked.deviations,
      linkedOosCount: linked.oos,
      linkedCapaCount: linked.capa,
      linkedComplaintCount: linked.complaints,
      linkedChangeControlCount: linked.changeControls,
      theoreticalYield,
      actualYield,
      yieldPct,
      remarks: data.remarks,
      sourceType: 'manual',
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdByName: actor.name,
      updatedByName: actor.name,
      isDeleted: false,
    };

    const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview), record);
    await logBatchReviewAudit('create batch review record', actor, { batchNumber: data.batchNumber }, docRef.id);
    return { id: docRef.id };
  } catch (e) {
    console.error('createBatchReviewRecord failed', e);
    return { error: 'Unable to create batch review record.' };
  }
}

export async function updateBatchReviewRecord(
  id: string,
  pqr: PqrOption,
  data: BatchReviewFormData,
  actor: PqrBatchReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };

  const dup = await checkDuplicateBatch(pqr.id, data.batchNumber, id);
  if (dup) return { error: 'Duplicate batch number under this PQR is not allowed.' };

  const mfg = data.manufacturingDate.length === 7 ? `${data.manufacturingDate}-01` : data.manufacturingDate;
  if (pqr.reviewPeriodFrom && pqr.reviewPeriodTo && !inPeriod(mfg, pqr.reviewPeriodFrom, pqr.reviewPeriodTo)) {
    return { error: 'Manufacturing date is outside the PQR review period.' };
  }

  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    const index = await buildLinkedIndex();
    const linked = linkedFromIndex(index, data.batchNumber);
    const theoreticalYield = data.theoreticalYield ?? linked.theoreticalYield;
    const actualYield = data.actualYield ?? linked.actualYield;
    const yieldPct = computeYieldPct(theoreticalYield, actualYield) ?? linked.yieldPct;

    await updateDoc(doc(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview, id), {
      product: data.product,
      productCode: data.productCode,
      genericName: data.genericName,
      strength: data.strength,
      dosageForm: data.dosageForm,
      batchNumber: data.batchNumber.trim(),
      semiFinishedBatchNumber: data.semiFinishedBatchNumber,
      finishedProductBatchNumber: data.finishedProductBatchNumber,
      packingBatchNumber: data.packingBatchNumber,
      manufacturingDate: mfg.slice(0, 10),
      expiryDate: (data.expiryDate.length === 7 ? `${data.expiryDate}-01` : data.expiryDate).slice(0, 10),
      batchSize: data.batchSize,
      batchSizeUnit: data.batchSizeUnit,
      manufacturedFor: data.manufacturedFor,
      customerName: data.customerName,
      market: data.market,
      batchStatus: data.batchStatus,
      releaseStatus: data.releaseStatus,
      releaseDate: data.releaseDate,
      qaReleasedBy: data.qaReleasedBy,
      rejectionReason: data.rejectionReason,
      holdReason: data.holdReason,
      reworkRequired: data.reworkRequired,
      reprocessRequired: data.reprocessRequired,
      theoreticalYield,
      actualYield,
      yieldPct,
      remarks: data.remarks,
      linkedDeviationCount: linked.deviations,
      linkedOosCount: linked.oos,
      linkedCapaCount: linked.capa,
      linkedComplaintCount: linked.complaints,
      linkedChangeControlCount: linked.changeControls,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logBatchReviewAudit('edit batch review record', actor, { id, batchNumber: data.batchNumber }, id, oldValue);
    return {};
  } catch (e) {
    console.error('updateBatchReviewRecord failed', e);
    return { error: 'Unable to update batch review record.' };
  }
}

export async function softDeleteBatchReviewRecord(
  id: string,
  actor: PqrBatchReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    await updateDoc(doc(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.batchReview, id), {
      isDeleted: true,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logBatchReviewAudit('delete/soft delete batch record', actor, { id }, id, oldValue);
    return {};
  } catch (e) {
    console.error('softDeleteBatchReviewRecord failed', e);
    return { error: 'Unable to remove batch review record.' };
  }
}

export async function saveBatchSectionToPqr(
  pqrId: string,
  narrative: string,
  records: PqrBatchReviewRecord[],
  actor: PqrBatchReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const summary = computeBatchSummary(records);
    const ts = nowIso();

    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('sectionKey', '==', 'batch_manufacturing'),
    ));

    const payload = {
      narrative,
      dataSummary: JSON.stringify(summary),
      sectionType: 'Batch Review',
      included: true,
      status: summary.totalBatches > 0 ? 'Completed' : 'Draft',
      updatedAt: ts,
      updatedBy: actor.id,
    };

    if (snap.empty) {
      await addDoc(collection(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.sections), {
        pqrId,
        sectionKey: 'batch_manufacturing',
        sectionOrder: 5,
        sectionTitle: 'Batch Manufacturing Details',
        createdAt: ts,
        createdBy: actor.id,
        isDeleted: false,
        ...payload,
      });
    } else {
      await updateDoc(snap.docs[0].ref, payload);
    }

    try {
      await updateDoc(doc(getFirebaseFirestore(), PQR_BATCH_REVIEW_COLLECTIONS.records, pqrId), {
        'scope.batchReview': true,
        updatedAt: ts,
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
    } catch {
      // Legacy documents may not support nested scope updates.
    }

    await logBatchReviewAudit('section saved to PQR', actor, { pqrId, narrativeLength: narrative.length, summary }, pqrId);
    return {};
  } catch (e) {
    console.error('saveBatchSectionToPqr failed', e);
    return { error: 'Unable to save batch section to PQR.' };
  }
}

export function exportBatchReviewCsv(records: PqrBatchReviewRecord[], pqrNumber?: string) {
  const headers = [
    'Sr. No.', 'PQR Number', 'Product', 'Product Code', 'Batch No.',
    'Semi Finish Batch No.', 'Finished Product Batch No.', 'Packing Batch No.',
    'MFG Date', 'EXP Date', 'Batch Size', 'Unit', 'Manufactured For', 'Customer',
    'Batch Status', 'Release Status', 'Release Date',
    'Theoretical Yield', 'Actual Yield', 'Yield %',
    'Deviations', 'OOS', 'CAPA', 'Complaints', 'Change Controls',
    'Remarks', 'Source',
  ];
  const rows = records.filter((r) => !r.isDeleted).map((r, i) => [
    i + 1,
    r.pqrNumber || pqrNumber || '',
    r.product,
    r.productCode,
    r.batchNumber,
    r.semiFinishedBatchNumber,
    r.finishedProductBatchNumber,
    r.packingBatchNumber,
    r.manufacturingDate,
    r.expiryDate,
    r.batchSize,
    r.batchSizeUnit,
    r.manufacturedFor,
    r.customerName,
    r.batchStatus,
    r.releaseStatus,
    r.releaseDate,
    r.theoreticalYield ?? 'Data Not Available',
    r.actualYield ?? 'Data Not Available',
    r.yieldPct ?? 'Data Not Available',
    r.linkedDeviationCount,
    r.linkedOosCount,
    r.linkedCapaCount,
    r.linkedComplaintCount ?? 0,
    r.linkedChangeControlCount ?? 0,
    r.remarks,
    r.sourceType || 'manual',
  ]);
  downloadCsv(
    `pqr-batch-review-${(pqrNumber || 'export').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows,
  );
}

export function getBatchReviewSummary(records: PqrBatchReviewRecord[]): PqrBatchReviewSummary {
  return computeBatchSummary(records);
}

export function getBatchReviewNarrative(records: PqrBatchReviewRecord[]): string {
  return generateBatchNarrative(computeBatchSummary(records));
}

export { buildBatchCharts, computeBatchSummary, generateBatchNarrative };

export async function logBatchReviewView(actor: PqrBatchReviewActor) {
  await logBatchReviewAudit('batch review viewed', actor);
}

export async function logBatchReviewExport(actor: PqrBatchReviewActor, type: 'excel' | 'import' | 'csv') {
  await logBatchReviewAudit(
    type === 'import' ? 'import batch list' : 'export batch review',
    actor,
    { type },
  );
}

let narrativeAuditTimer: ReturnType<typeof setTimeout> | null = null;

export function logBatchReviewNarrativeEditDebounced(actor: PqrBatchReviewActor, pqrId: string) {
  if (narrativeAuditTimer) clearTimeout(narrativeAuditTimer);
  narrativeAuditTimer = setTimeout(() => {
    void logBatchReviewAudit('narrative edited', actor, { pqrId }, pqrId);
  }, 2000);
}

export async function logBatchReviewNarrativeEdit(actor: PqrBatchReviewActor, pqrId: string) {
  logBatchReviewNarrativeEditDebounced(actor, pqrId);
}

export async function logBatchReviewSummaryRecalc(actor: PqrBatchReviewActor, pqrId: string) {
  await logBatchReviewAudit('summary recalculated', actor, { pqrId }, pqrId);
}
