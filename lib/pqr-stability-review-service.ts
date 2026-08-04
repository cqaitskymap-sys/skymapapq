import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, limit, orderBy, writeBatch,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getFirebaseFirestore, getFirebaseStorage, isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import {
  DEFAULT_STABILITY_LIMITS,
  STABILITY_LEGACY_COLLECTIONS,
  STABILITY_MONITORING_COLLECTION,
  STABILITY_RESULTS_COLLECTION,
  STABILITY_SCHEDULES_COLLECTION,
  STABILITY_STUDIES_COLLECTION,
  computeScheduleStatus,
} from '@/lib/cpv-stability-monitoring';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { fetchPqrOptions } from '@/lib/pqr-batch-review-service';
import {
  PQR_STABILITY_REVIEW_COLLECTIONS,
  PQR_STABILITY_REVIEW_MODULE,
  autoResultStatus,
  computeStabilityCompliance,
  computeStabilityReviewSummary,
  generateStabilityNarrative,
  normalizeStabilityReviewRecord,
  type PqrStabilityReviewRecord,
  type StabilityReviewFormData,
} from '@/lib/pqr-stability-review-records';

export type PqrStabilityReviewActor = { id: string; name: string; role?: string };

export { fetchPqrOptions };
export {
  computeStabilityReviewSummary,
  generateStabilityNarrative,
  buildStabilityReviewCharts,
  filterStabilityReviewRecords,
  normalizeStabilityReviewRecord,
} from '@/lib/pqr-stability-review-records';

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXT = ['pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx'];
const ALLOWED_ATTACHMENT_MIME = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

function buildStabilityReviewId(batch: string, interval: string, param: string) {
  return `STAB-REV-${batch.slice(0, 8)}-${interval.replace(/\s+/g, '')}-${param.slice(0, 6).replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
}

async function readCollection(name: string, max = 1000): Promise<Record<string, unknown>[]> {
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

async function readFirst(names: string[], max = 1000): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const rows = await readCollection(name, max);
    rows.forEach((r) => {
      const id = str(r.id);
      if (id && seen.has(id)) return;
      if (id) seen.add(id);
      out.push(r);
    });
  }
  return out;
}

async function logStabilityReviewAudit(
  actionType: string,
  actor: PqrStabilityReviewActor,
  detail?: unknown,
  recordId = 'stability-review',
  oldValue?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: PQR_STABILITY_REVIEW_MODULE,
      collectionName: PQR_STABILITY_REVIEW_COLLECTIONS.review,
      recordId,
      actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_STABILITY_REVIEW_COLLECTIONS.review,
      documentId: recordId,
      action: actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_STABILITY_REVIEW_MODULE,
    });
  } catch (e) {
    console.error('logStabilityReviewAudit failed', e);
  }
}

function inPeriod(dateStr: string, from: string, to: string): boolean {
  const d = dateStr.slice(0, 10);
  if (!from || !to || !d) return true;
  return d >= from && d <= to;
}

/**
 * Product scoping. Facility/product-neutral stability rows (no product fields) are included;
 * rows carrying product fields must match the PQR product.
 */
function matchesProduct(raw: Record<string, unknown>, pqr: PqrOption): boolean {
  const code = str(raw.productCode || raw.product_code).toLowerCase();
  const name = str(raw.productName || raw.product_name || raw.product).toLowerCase();
  if (!code && !name) return true;
  const pqrCode = (pqr.productCode || '').toLowerCase();
  const pqrName = (pqr.productName || '').toLowerCase();
  if (code && pqrCode && code === pqrCode) return true;
  if (name && pqrName && (name === pqrName || name.includes(pqrName) || pqrName.includes(name))) return true;
  return false;
}

function isTruthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v > 0;
  const s = str(v).toLowerCase().trim();
  return s === 'yes' || s === 'true' || s === 'y' || s === 'positive' || s === 'impacted';
}

/** Only honour explicit product-impact fields from the source. Never invent impact from an excursion/OOS alone. */
function hasExplicitImpact(raw: Record<string, unknown>): boolean {
  return isTruthyFlag(raw.impactOnProductQuality)
    || isTruthyFlag(raw.impact_on_product_quality)
    || isTruthyFlag(raw.productImpact)
    || isTruthyFlag(raw.product_impact)
    || isTruthyFlag(raw.impact_assessment)
    || isTruthyFlag(raw.impactAssessment);
}

/**
 * Resolve acceptance limits honestly. Prefer explicit source lower/upper. Otherwise, if the
 * parameter is a known system-configured parameter, use its configured default (legitimate config).
 * When neither source nor config provides limits, return limitsAvailable=false so callers do not
 * invent OOS/OOT against fabricated bounds (never invent an arbitrary upper of 100).
 */
function resolveStabilityLimits(
  raw: Record<string, unknown>,
  param: string,
): { lower: number; upper: number; unit: string; limitsAvailable: boolean } {
  const rawLower = raw.lowerLimit ?? raw.lower_limit;
  const rawUpper = raw.upperLimit ?? raw.upper_limit;
  const lowerNum = Number(rawLower);
  const upperNum = Number(rawUpper);
  const hasLower = rawLower !== null && rawLower !== undefined && rawLower !== '' && Number.isFinite(lowerNum);
  const hasUpper = rawUpper !== null && rawUpper !== undefined && rawUpper !== '' && Number.isFinite(upperNum);

  const cfg = DEFAULT_STABILITY_LIMITS[param];
  if (hasLower || hasUpper || cfg) {
    const lower = hasLower ? lowerNum : (cfg ? cfg.lower : 0);
    const upper = hasUpper ? upperNum : (cfg ? cfg.upper : (hasLower ? lowerNum : 0));
    const unit = str(raw.unit) || (cfg ? cfg.unit : '');
    return { lower, upper, unit, limitsAvailable: true };
  }
  return { lower: 0, upper: 0, unit: str(raw.unit), limitsAvailable: false };
}

function resolveResultStatus(
  raw: Record<string, unknown>,
  observed: string | number,
  lower: number,
  upper: number,
  param: string,
  limitsAvailable: boolean,
): string {
  const explicit = str(raw.status || raw.resultStatus || raw.result_status);
  if (explicit) return explicit;
  if (!limitsAvailable) return 'Complies';
  return autoResultStatus(observed, lower, upper, param);
}

function parseObserved(v: unknown): string | number {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') return v;
  return String(v);
}

function groupKey(batch: string, studyType: string, storage: string, interval: string, param: string) {
  return `${batch}|${studyType}|${storage}|${interval}|${param}`.toLowerCase();
}

interface PullAcc {
  batchNumber: string;
  studyNumber: string;
  studyType: string;
  storageCondition: string;
  pullingInterval: string;
  samplePullingDueDate: string;
  actualPullingDate: string;
  testDate: string;
  studyStartDate: string;
  parameterName: string;
  observedResult: string | number;
  lowerLimit: number;
  upperLimit: number;
  unit: string;
  resultStatus: string;
  samplePullStatus: string;
  ootCount: number;
  oosCount: number;
  capaCount: number;
  impactOnProductQuality: string;
  chamberId: string;
  protocolNumber: string;
  specificationVersion: string;
  sourceIds: string[];
}

function countLinked(
  batch: string,
  param: string,
  records: Record<string, unknown>[],
  from: string,
  to: string,
): number {
  const b = batch.toLowerCase();
  const p = param.toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    const text = [
      r.title, r.description, r.source, r.module, r.batchNumber, r.batch_number,
      r.parameterName, r.parameter_name, r.category, r.type,
    ].map((v) => str(v)).join(' ').toLowerCase();
    const match = text.includes('stability')
      || (b.length > 1 && text.includes(b))
      || (p.length > 2 && text.includes(p));
    if (!match) return false;
    const date = str(r.createdAt || r.created_at || r.reportedDate || r.reported_date || r.date).slice(0, 10);
    return inPeriod(date, from, to);
  }).length;
}

function mergeAcc(base: PullAcc, add: PullAcc): PullAcc {
  const latest = (add.testDate || '') >= (base.testDate || '') ? add : base;
  return {
    ...latest,
    ootCount: base.ootCount + add.ootCount,
    oosCount: base.oosCount + add.oosCount,
    capaCount: base.capaCount + add.capaCount,
    impactOnProductQuality: base.impactOnProductQuality === 'Yes' || add.impactOnProductQuality === 'Yes' ? 'Yes' : 'No',
    sourceIds: [...base.sourceIds, ...add.sourceIds],
    samplePullingDueDate: add.samplePullingDueDate || base.samplePullingDueDate,
    actualPullingDate: add.actualPullingDate || base.actualPullingDate,
    samplePullStatus: add.samplePullStatus || base.samplePullStatus,
    chamberId: latest.chamberId || base.chamberId,
    protocolNumber: latest.protocolNumber || base.protocolNumber,
    specificationVersion: latest.specificationVersion || base.specificationVersion,
  };
}

function accFromResult(
  raw: Record<string, unknown>,
  scheduleMap: Map<string, Record<string, unknown>>,
  studyMap: Map<string, Record<string, unknown>>,
): PullAcc | null {
  const batch = str(raw.batchNumber || raw.batch_number);
  const studyType = str(raw.studyType || raw.study_type);
  const storage = str(raw.storageCondition || raw.storage_condition);
  const interval = str(raw.pullingInterval || raw.pulling_interval || raw.interval, 'Initial');
  const param = str(raw.parameterName || raw.parameter_name);
  if (!batch || !param) return null;

  const studyKey = `${batch}|${studyType}|${storage}`.toLowerCase();
  const study = studyMap.get(studyKey) || studyMap.get(str(raw.studyId || raw.study_id));
  const schedKey = `${batch}|${studyType}|${storage}|${interval}`.toLowerCase();
  const sched = scheduleMap.get(schedKey) || scheduleMap.get(str(raw.scheduleId || raw.schedule_id));

  const { lower, upper, unit, limitsAvailable } = resolveStabilityLimits(raw, param);
  const observed = parseObserved(raw.observedResult ?? raw.observed_result ?? raw.result);
  const status = resolveResultStatus(raw, observed, lower, upper, param, limitsAvailable);

  const dueDate = str(sched?.samplePullingDueDate || sched?.sample_pulling_due_date || raw.samplePullingDueDate);
  const actualPull = str(sched?.actualPullingDate || sched?.actual_pulling_date || raw.actualSamplePullingDate || raw.actual_pulling_date);
  const pullStatus = str(
    sched?.scheduleStatus || sched?.schedule_status,
    computeScheduleStatus(dueDate, actualPull, str(raw.reviewStatus, 'Pending')),
  );

  return {
    batchNumber: batch,
    studyNumber: str(raw.stabilityStudyNumber || raw.stability_study_number || study?.stabilityStudyNumber),
    studyType,
    storageCondition: storage,
    pullingInterval: interval,
    samplePullingDueDate: dueDate,
    actualPullingDate: actualPull,
    testDate: str(raw.testDate || raw.test_date || raw.createdAt).slice(0, 10),
    studyStartDate: str(study?.studyStartDate || study?.study_start_date || raw.studyStartDate),
    parameterName: param,
    observedResult: observed,
    lowerLimit: lower,
    upperLimit: upper,
    unit,
    resultStatus: status,
    samplePullStatus: pullStatus,
    ootCount: status === 'OOT' || status === 'Action' ? 1 : 0,
    oosCount: status === 'OOS' ? 1 : 0,
    capaCount: raw.capaRequired || raw.linkedCapaNumber ? 1 : 0,
    impactOnProductQuality: hasExplicitImpact(raw) ? 'Yes' : 'No',
    chamberId: str(
      raw.chamberId || raw.chamber_id || study?.chamberId || study?.chamber_id || sched?.chamberId,
    ),
    protocolNumber: str(
      raw.protocolNumber || raw.protocol_number || study?.protocolNumber || study?.protocol_number
      || study?.protocolVersion || study?.protocol_version,
    ),
    specificationVersion: str(
      raw.specificationVersion || raw.specification_version || study?.specificationVersion
      || study?.specification_version || raw.specification || raw.specVersion,
    ),
    sourceIds: [str(raw.id)],
  };
}

function accFromMonitoring(raw: Record<string, unknown>): PullAcc | null {
  const batch = str(raw.batchNumber || raw.batch_number || raw.batchNo);
  const param = str(raw.parameterName || raw.parameter_name || raw.parameter);
  if (!batch || !param) return null;
  const studyType = str(raw.studyType || raw.study_type);
  const storage = str(raw.storageCondition || raw.storage_condition);
  const interval = str(raw.pullingInterval || raw.interval || raw.timePoint, 'Initial');
  const { lower, upper, unit, limitsAvailable } = resolveStabilityLimits(raw, param);
  const observed = parseObserved(raw.observedResult ?? raw.observed_value ?? raw.result);
  const status = resolveResultStatus(raw, observed, lower, upper, param, limitsAvailable);
  return {
    batchNumber: batch,
    studyNumber: str(raw.stabilityStudyNumber || raw.study_number),
    studyType,
    storageCondition: storage,
    pullingInterval: interval,
    samplePullingDueDate: str(raw.samplePullingDueDate || raw.due_date),
    actualPullingDate: str(raw.actualPullingDate || raw.actual_pull_date),
    testDate: str(raw.testDate || raw.monitoring_date || raw.createdAt).slice(0, 10),
    studyStartDate: str(raw.studyStartDate || raw.study_start_date),
    parameterName: param,
    observedResult: observed,
    lowerLimit: lower,
    upperLimit: upper,
    unit,
    resultStatus: status,
    samplePullStatus: str(raw.scheduleStatus, 'Pending'),
    ootCount: status === 'OOT' || status === 'Action' ? 1 : 0,
    oosCount: status === 'OOS' ? 1 : 0,
    capaCount: 0,
    impactOnProductQuality: hasExplicitImpact(raw) ? 'Yes' : 'No',
    chamberId: str(raw.chamberId || raw.chamber_id),
    protocolNumber: str(raw.protocolNumber || raw.protocol_number || raw.protocolVersion),
    specificationVersion: str(raw.specificationVersion || raw.specification_version || raw.specification),
    sourceIds: [str(raw.id)],
  };
}

function accToRecord(
  g: PullAcc,
  pqr: PqrOption,
  deviations: Record<string, unknown>[],
  capas: Record<string, unknown>[],
  changeControls: Record<string, unknown>[],
  actor: PqrStabilityReviewActor,
): Omit<PqrStabilityReviewRecord, 'id'> {
  const ts = nowIso();
  const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
  const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
  const linkedDev = countLinked(g.batchNumber, g.parameterName, deviations, from, to);
  const linkedCapa = countLinked(g.batchNumber, g.parameterName, capas, from, to);
  const linkedCc = countLinked(g.batchNumber, g.parameterName, changeControls, from, to);

  const partial: Partial<PqrStabilityReviewRecord> = {
    stabilityReviewId: buildStabilityReviewId(g.batchNumber, g.pullingInterval, g.parameterName),
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: pqr.productName,
    productCode: pqr.productCode,
    batchNumber: g.batchNumber,
    studyNumber: g.studyNumber,
    studyType: g.studyType,
    storageCondition: g.storageCondition,
    pullingInterval: g.pullingInterval,
    samplePullingDueDate: g.samplePullingDueDate,
    actualPullingDate: g.actualPullingDate,
    testDate: g.testDate,
    studyStartDate: g.studyStartDate,
    parameterName: g.parameterName,
    observedResult: g.observedResult,
    lowerLimit: g.lowerLimit,
    upperLimit: g.upperLimit,
    unit: g.unit,
    resultStatus: g.resultStatus,
    samplePullStatus: g.samplePullStatus,
    ootCount: g.ootCount,
    oosCount: g.oosCount,
    capaCount: g.capaCount + linkedCapa,
    deviationCount: linkedDev,
    changeControlCount: linkedCc,
    impactOnShelfLife: 'No',
    // Product-quality impact is only set when the source explicitly declares it — never inferred from OOS alone.
    impactOnProductQuality: g.impactOnProductQuality === 'Yes' ? 'Yes' : 'No',
    conclusion: g.resultStatus === 'Complies' ? 'Within specification' : 'Reviewed for impact',
    remarks: '',
    chamberId: g.chamberId || undefined,
    protocolNumber: g.protocolNumber || undefined,
    specificationVersion: g.specificationVersion || undefined,
    sourceType: 'pull',
    sourceIds: g.sourceIds,
    attachmentUrls: [],
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdByName: actor.name,
    updatedByName: actor.name,
    isDeleted: false,
  };
  const computed = computeStabilityCompliance(partial);
  return { ...partial, ...computed } as Omit<PqrStabilityReviewRecord, 'id'>;
}

function formToPartial(data: StabilityReviewFormData): Partial<PqrStabilityReviewRecord> {
  const resultStatus = data.resultStatus === 'Under Review'
    ? data.resultStatus
    : autoResultStatus(data.observedResult, data.lowerLimit, data.upperLimit, data.parameterName);
  return {
    batchNumber: data.batchNumber,
    studyNumber: data.studyNumber,
    studyType: data.studyType,
    storageCondition: data.storageCondition,
    pullingInterval: data.pullingInterval,
    samplePullingDueDate: data.samplePullingDueDate,
    actualPullingDate: data.actualPullingDate,
    testDate: data.testDate,
    studyStartDate: data.studyStartDate,
    parameterName: data.parameterName,
    observedResult: data.observedResult,
    lowerLimit: data.lowerLimit,
    upperLimit: data.upperLimit,
    unit: data.unit,
    resultStatus,
    samplePullStatus: data.samplePullStatus,
    ootCount: resultStatus === 'OOT' || resultStatus === 'Action' ? Math.max(data.ootCount, 1) : data.ootCount,
    oosCount: resultStatus === 'OOS' ? Math.max(data.oosCount, 1) : data.oosCount,
    capaCount: data.capaCount,
    impactOnShelfLife: data.impactOnShelfLife,
    impactOnProductQuality: data.impactOnProductQuality,
    conclusion: data.conclusion,
    remarks: data.remarks,
  };
}

function intervalToMonthsSafe(interval: string): number {
  if (interval === 'Initial') return 0;
  const match = interval.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function commitInChunks(rows: Array<Omit<PqrStabilityReviewRecord, 'id'>>, chunkSize = 400) {
  const db = getFirebaseFirestore();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach((record) => {
      batch.set(doc(collection(db, PQR_STABILITY_REVIEW_COLLECTIONS.review)), record);
    });
    await batch.commit();
  }
}

/** Resolve batch numbers for the PQR from pqr_batch_review when available. */
async function getBatchNumbersForPqr(pqr: PqrOption): Promise<string[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.batchReview),
      where('pqrId', '==', pqr.id),
      where('isDeleted', '==', false),
    ));
    return Array.from(new Set(snap.docs.map((d) => str(d.data().batchNumber)).filter(Boolean)));
  } catch {
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.batchReview),
        where('pqrId', '==', pqr.id),
      ));
      return Array.from(new Set(
        snap.docs
          .filter((d) => !d.data().isDeleted)
          .map((d) => str(d.data().batchNumber))
          .filter(Boolean),
      ));
    } catch {
      return [];
    }
  }
}

export async function fetchStabilityReviewRecords(pqrId: string): Promise<PqrStabilityReviewRecord[]> {
  if (!isFirebaseConfigured() || !pqrId) return [];
  try {
    let rows: PqrStabilityReviewRecord[] = [];
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review),
        where('pqrId', '==', pqrId),
        where('isDeleted', '==', false),
      ));
      rows = snap.docs.map((d) => normalizeStabilityReviewRecord({ id: d.id, ...d.data() }));
    } catch {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review),
        where('pqrId', '==', pqrId),
      ));
      rows = snap.docs
        .map((d) => normalizeStabilityReviewRecord({ id: d.id, ...d.data() }))
        .filter((r) => !r.isDeleted);
    }
    return rows.sort((a, b) =>
      a.batchNumber.localeCompare(b.batchNumber)
      || intervalToMonthsSafe(a.pullingInterval) - intervalToMonthsSafe(b.pullingInterval));
  } catch (e) {
    console.error('fetchStabilityReviewRecords failed', e);
    return [];
  }
}

export async function pullStabilityReviewData(
  pqr: PqrOption,
  actor: PqrStabilityReviewActor,
): Promise<{ created: number; skipped: number; error?: string }> {
  if (!isFirebaseConfigured()) return { created: 0, skipped: 0, error: 'Firebase is not configured.' };

  try {
    await logStabilityReviewAudit('pull stability data', actor, { pqrId: pqr.id }, pqr.id);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';

    const [
      batchNumbers, existing, resultsRaw, schedulesRaw, studiesRaw, monitoringRaw,
      deviations, capas, changeControls,
    ] = await Promise.all([
      getBatchNumbersForPqr(pqr),
      fetchStabilityReviewRecords(pqr.id),
      readFirst([STABILITY_RESULTS_COLLECTION, ...STABILITY_LEGACY_COLLECTIONS]),
      readFirst([STABILITY_SCHEDULES_COLLECTION]),
      readFirst([STABILITY_STUDIES_COLLECTION, ...STABILITY_LEGACY_COLLECTIONS]),
      readFirst([STABILITY_MONITORING_COLLECTION, ...STABILITY_LEGACY_COLLECTIONS]),
      readFirst([PQR_STABILITY_REVIEW_COLLECTIONS.deviations]),
      readFirst([PQR_STABILITY_REVIEW_COLLECTIONS.capaRecords, 'capa']),
      readFirst([PQR_STABILITY_REVIEW_COLLECTIONS.changeControls, 'change_control']),
    ]);

    const batchSet = new Set(batchNumbers.map((b) => b.toLowerCase()));
    const existingKeys = new Set(existing.map((r) =>
      groupKey(r.batchNumber, r.studyType, r.storageCondition, r.pullingInterval, r.parameterName),
    ));

    const studyMap = new Map<string, Record<string, unknown>>();
    studiesRaw.filter((s) => !s.isDeleted).forEach((s) => {
      const batch = str(s.batchNumber || s.batch_number);
      const studyType = str(s.studyType || s.study_type);
      const storage = str(s.storageCondition || s.storage_condition);
      studyMap.set(`${batch}|${studyType}|${storage}`.toLowerCase(), s);
      if (s.id) studyMap.set(str(s.id), s);
    });

    const scheduleMap = new Map<string, Record<string, unknown>>();
    schedulesRaw.filter((s) => !s.isDeleted).forEach((s) => {
      const batch = str(s.batchNumber || s.batch_number);
      const studyType = str(s.studyType || s.study_type);
      const storage = str(s.storageCondition || s.storage_condition);
      const interval = str(s.interval || s.pullingInterval || s.pulling_interval);
      scheduleMap.set(`${batch}|${studyType}|${storage}|${interval}`.toLowerCase(), s);
      if (s.id) scheduleMap.set(str(s.id), s);
    });

    // Scope: when the PQR has explicit batches, only include results for those batches (and product
    // must still match where product fields are present). Otherwise fall back to product matching.
    const includeRaw = (raw: Record<string, unknown>): boolean => {
      const productOk = matchesProduct(raw, pqr);
      if (batchSet.size > 0) {
        const b = str(raw.batchNumber || raw.batch_number || raw.batchNo).toLowerCase();
        if (!b || !batchSet.has(b)) return false;
        return productOk;
      }
      return productOk;
    };

    const groups = new Map<string, PullAcc>();

    const processResult = (raw: Record<string, unknown>) => {
      if (raw.isDeleted) return;
      const testDate = str(raw.testDate || raw.test_date || raw.createdAt);
      if (!inPeriod(testDate, from, to)) return;
      if (!includeRaw(raw)) return;
      const acc = accFromResult(raw, scheduleMap, studyMap);
      if (!acc) return;
      const key = groupKey(acc.batchNumber, acc.studyType, acc.storageCondition, acc.pullingInterval, acc.parameterName);
      const cur = groups.get(key);
      groups.set(key, cur ? mergeAcc(cur, acc) : acc);
    };

    resultsRaw.forEach(processResult);
    if (groups.size === 0) {
      monitoringRaw.forEach((raw) => {
        if (raw.isDeleted) return;
        const testDate = str(raw.testDate || raw.monitoring_date || raw.createdAt);
        if (!inPeriod(testDate, from, to)) return;
        if (!includeRaw(raw)) return;
        const acc = accFromMonitoring(raw);
        if (!acc) return;
        const key = groupKey(acc.batchNumber, acc.studyType, acc.storageCondition, acc.pullingInterval, acc.parameterName);
        const cur = groups.get(key);
        groups.set(key, cur ? mergeAcc(cur, acc) : acc);
      });
    }

    await logStabilityReviewAudit('sample pulling review', actor, { groups: groups.size }, pqr.id);

    let skipped = 0;
    const toCreate: Array<Omit<PqrStabilityReviewRecord, 'id'>> = [];

    for (const g of Array.from(groups.values())) {
      const key = groupKey(g.batchNumber, g.studyType, g.storageCondition, g.pullingInterval, g.parameterName);
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      toCreate.push(accToRecord(g, pqr, deviations, capas, changeControls, actor));
    }

    if (toCreate.length > 0) await commitInChunks(toCreate);

    await logStabilityReviewAudit('OOT/OOS summary generated', actor, {
      created: toCreate.length, skipped, batchCount: batchNumbers.length,
    }, pqr.id);
    await logStabilityReviewAudit('risk calculated', actor, { created: toCreate.length }, pqr.id);
    return { created: toCreate.length, skipped };
  } catch (e) {
    console.error('pullStabilityReviewData failed', e);
    return { created: 0, skipped: 0, error: 'Unable to pull stability data. Please try again.' };
  }
}

export async function createStabilityReviewRecord(
  pqr: PqrOption,
  data: StabilityReviewFormData,
  actor: PqrStabilityReviewActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (data.productCode && pqr.productCode && data.productCode !== pqr.productCode) {
    return { error: 'Stability record product code must match the selected PQR product.' };
  }
  try {
    const existing = await fetchStabilityReviewRecords(pqr.id);
    const key = groupKey(data.batchNumber, data.studyType, data.storageCondition, data.pullingInterval, data.parameterName);
    if (existing.some((r) => groupKey(r.batchNumber, r.studyType, r.storageCondition, r.pullingInterval, r.parameterName) === key)) {
      return { error: 'Duplicate stability review entry for this batch/interval/parameter under the same PQR.' };
    }

    const partial = formToPartial(data);
    const computed = computeStabilityCompliance(partial);
    const ts = nowIso();
    const record: Omit<PqrStabilityReviewRecord, 'id'> = {
      stabilityReviewId: buildStabilityReviewId(data.batchNumber, data.pullingInterval, data.parameterName),
      pqrId: pqr.id,
      pqrNumber: pqr.pqrNumber,
      product: data.product,
      productCode: data.productCode,
      ...partial,
      complianceStatus: computed.complianceStatus,
      complianceReasons: computed.complianceReasons,
      riskLevel: computed.riskLevel,
      sourceType: 'manual',
      sourceIds: [],
      attachmentUrls: [],
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdByName: actor.name,
      updatedByName: actor.name,
      isDeleted: false,
    } as Omit<PqrStabilityReviewRecord, 'id'>;
    const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review), record);
    await logStabilityReviewAudit('create stability review', actor, { batch: data.batchNumber }, docRef.id);
    await logStabilityReviewAudit('risk calculated', actor, computed, docRef.id);
    return { id: docRef.id };
  } catch (e) {
    console.error('createStabilityReviewRecord failed', e);
    return { error: 'Unable to create stability review record.' };
  }
}

export async function updateStabilityReviewRecord(
  id: string,
  data: StabilityReviewFormData,
  actor: PqrStabilityReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    const partial = formToPartial(data);
    const computed = computeStabilityCompliance(partial);
    await updateDoc(doc(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review, id), {
      ...partial,
      complianceStatus: computed.complianceStatus,
      complianceReasons: computed.complianceReasons,
      riskLevel: computed.riskLevel,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logStabilityReviewAudit('edit stability review', actor, { id }, id, oldValue);
    await logStabilityReviewAudit('risk calculated', actor, computed, id);
    return {};
  } catch (e) {
    console.error('updateStabilityReviewRecord failed', e);
    return { error: 'Unable to update stability review record.' };
  }
}

export async function softDeleteStabilityReviewRecord(
  id: string,
  actor: PqrStabilityReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    await updateDoc(doc(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review, id), {
      isDeleted: true,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logStabilityReviewAudit('delete stability review', actor, { id }, id, oldValue);
    return {};
  } catch (e) {
    console.error('softDeleteStabilityReviewRecord failed', e);
    return { error: 'Unable to remove stability review record.' };
  }
}

export async function saveStabilitySectionToPqr(
  pqrId: string,
  narrative: string,
  records: PqrStabilityReviewRecord[],
  actor: PqrStabilityReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const summary = computeStabilityReviewSummary(records);
    const active = records.filter((r) => !r.isDeleted);
    const ts = nowIso();
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('sectionKey', '==', 'stability_review'),
    ));
    const payload = {
      pqrId,
      sectionKey: 'stability_review',
      sectionType: 'Stability Review',
      sectionOrder: 24,
      sectionTitle: 'Stability Review',
      narrative,
      dataSummary: JSON.stringify(summary),
      included: true,
      status: active.length > 0 ? 'Completed' : 'Draft',
      updatedAt: ts,
      updatedBy: actor.id,
    };
    if (snap.empty) {
      await addDoc(collection(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.sections), {
        ...payload, createdAt: ts, createdBy: actor.id, isDeleted: false,
      });
    } else {
      await updateDoc(snap.docs[0].ref, payload);
    }

    try {
      await updateDoc(doc(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.records, pqrId), {
        'scope.stabilityReview': true,
        updatedAt: ts,
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
    } catch {
      // Legacy PQR documents may not support nested scope updates.
    }

    await logStabilityReviewAudit('section saved to PQR', actor, { pqrId, summary }, pqrId);
    return {};
  } catch (e) {
    console.error('saveStabilitySectionToPqr failed', e);
    return { error: 'Unable to save stability section to PQR.' };
  }
}

export async function uploadStabilityReviewAttachment(
  pqrId: string,
  recordId: string,
  file: File,
  actor: PqrStabilityReviewActor,
): Promise<{ url?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { error: 'File exceeds the 10 MB size limit.' };
  }
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const typeOk = ALLOWED_ATTACHMENT_MIME.includes(file.type) || ALLOWED_ATTACHMENT_EXT.includes(ext);
  if (!typeOk) {
    return { error: 'Unsupported file type. Allowed: PDF, PNG, JPEG, DOC, DOCX.' };
  }
  try {
    const path = `pqr/${pqrId}/stability-review/${recordId}/${Date.now()}_${file.name}`;
    const storageRef = ref(getFirebaseStorage(), path);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);

    const docRef = doc(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review, recordId);
    const snap = await getDoc(docRef);
    const existing = (snap.data()?.attachmentUrls as string[] | undefined) || [];
    await updateDoc(docRef, {
      attachmentUrls: [...existing, url],
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });

    await logStabilityReviewAudit('attachment uploaded', actor, { recordId, fileName: file.name }, recordId);
    return { url };
  } catch (e) {
    console.error('uploadStabilityReviewAttachment failed', e);
    return { error: 'Unable to upload attachment. Please try again.' };
  }
}

export async function deleteStabilityReviewAttachment(
  pqrId: string,
  recordId: string,
  url: string,
  actor: PqrStabilityReviewActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const docRef = doc(getFirebaseFirestore(), PQR_STABILITY_REVIEW_COLLECTIONS.review, recordId);
    const snap = await getDoc(docRef);
    const existing = (snap.data()?.attachmentUrls as string[] | undefined) || [];
    await updateDoc(docRef, {
      attachmentUrls: existing.filter((u) => u !== url),
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logStabilityReviewAudit('attachment deleted', actor, { recordId, url }, recordId);
    return {};
  } catch (e) {
    console.error('deleteStabilityReviewAttachment failed', e);
    return { error: 'Unable to remove attachment. Please try again.' };
  }
}

export function getStabilityReviewNarrative(records: PqrStabilityReviewRecord[]): string {
  return generateStabilityNarrative(computeStabilityReviewSummary(records), records);
}

export function exportStabilityReviewCsv(records: PqrStabilityReviewRecord[], pqrNumber?: string) {
  const headers = [
    'Sr. No.', 'PQR Number', 'Product', 'Product Code',
    'Batch Number', 'Study Number', 'Study Type', 'Storage Condition', 'Pulling Interval',
    'Sample Pull Due Date', 'Actual Pulling Date', 'Test Date', 'Study Start Date',
    'Parameter', 'Observed Result', 'Lower Limit', 'Upper Limit', 'Unit',
    'Result Status', 'Sample Pull Status',
    'OOT Count', 'OOS Count', 'CAPA Count', 'Deviation Count', 'Change Control Count',
    'Impact On Shelf Life', 'Impact On Product Quality',
    'Compliance', 'Compliance Reasons', 'Risk',
    'Conclusion', 'Remarks', 'Source',
  ];
  const rows = records.filter((r) => !r.isDeleted).map((r, i) => [
    i + 1,
    r.pqrNumber || pqrNumber || '',
    r.product,
    r.productCode,
    r.batchNumber,
    r.studyNumber || 'Data Not Available',
    r.studyType || 'Data Not Available',
    r.storageCondition || 'Data Not Available',
    r.pullingInterval,
    r.samplePullingDueDate || 'Data Not Available',
    r.actualPullingDate || 'Data Not Available',
    r.testDate,
    r.studyStartDate || 'Data Not Available',
    r.parameterName,
    r.observedResult === '' || r.observedResult === null || r.observedResult === undefined ? 'Data Not Available' : r.observedResult,
    r.lowerLimit,
    r.upperLimit,
    r.unit || '',
    r.resultStatus,
    r.samplePullStatus,
    r.ootCount,
    r.oosCount,
    r.capaCount,
    r.deviationCount ?? 0,
    r.changeControlCount ?? 0,
    r.impactOnShelfLife,
    r.impactOnProductQuality,
    r.complianceStatus,
    (r.complianceReasons || []).join('; '),
    r.riskLevel,
    r.conclusion,
    r.remarks,
    r.sourceType || 'manual',
  ]);
  downloadCsv(
    `pqr-stability-review-${(pqrNumber || 'export').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows,
  );
}

function isStabilityRelatedRecord(
  raw: Record<string, unknown>,
  batchNumbers: string[],
  parameterNames: string[],
): boolean {
  const batchList = batchNumbers.map((b) => b.toLowerCase()).filter(Boolean);
  const paramList = parameterNames.map((p) => p.toLowerCase()).filter((p) => p.length > 2);
  const text = [
    raw.title, raw.description, raw.source, raw.module, raw.batchNumber, raw.batch_number,
    raw.parameterName, raw.parameter_name, raw.category, raw.type,
  ].map((v) => str(v)).join(' ').toLowerCase();
  const category = str(raw.category || raw.deviationType || raw.type || raw.source || raw.module).toLowerCase();
  const relatesByBatch = batchList.some((b) => b.length > 1 && text.includes(b));
  const relatesByParam = paramList.some((p) => text.includes(p));
  const relatesByCategory = category.includes('stability');
  return relatesByBatch || relatesByParam || relatesByCategory;
}

export async function fetchStabilityQualityMetrics(
  pqr: PqrOption,
  records: PqrStabilityReviewRecord[],
): Promise<{ stabilityDeviations: number; stabilityOos: number; stabilityCapa: number; stabilityChangeControls: number }> {
  const empty = { stabilityDeviations: 0, stabilityOos: 0, stabilityCapa: 0, stabilityChangeControls: 0 };
  if (!isFirebaseConfigured()) return empty;

  try {
    const batchNumbers = Array.from(new Set(records.map((r) => r.batchNumber).filter(Boolean)));
    const parameterNames = Array.from(new Set(records.map((r) => r.parameterName).filter(Boolean)));
    const [deviations, oos, capas, changeControls] = await Promise.all([
      readFirst([PQR_STABILITY_REVIEW_COLLECTIONS.deviations]),
      readFirst([PQR_STABILITY_REVIEW_COLLECTIONS.oosRecords, 'oos']),
      readFirst([PQR_STABILITY_REVIEW_COLLECTIONS.capaRecords, 'capa']),
      readFirst([PQR_STABILITY_REVIEW_COLLECTIONS.changeControls, 'change_control']),
    ]);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
    const within = (raw: Record<string, unknown>) => {
      const date = str(raw.createdAt || raw.created_at || raw.reportedDate || raw.reported_date || raw.date).slice(0, 10);
      return inPeriod(date, from, to);
    };
    const relevant = (rows: Record<string, unknown>[]) => rows.filter((r) =>
      !r.isDeleted && within(r) && isStabilityRelatedRecord(r, batchNumbers, parameterNames),
    ).length;

    return {
      stabilityDeviations: relevant(deviations),
      stabilityOos: relevant(oos),
      stabilityCapa: relevant(capas),
      stabilityChangeControls: relevant(changeControls),
    };
  } catch (e) {
    console.error('fetchStabilityQualityMetrics failed', e);
    return empty;
  }
}

export async function recalculateAllStabilityCompliance(
  pqrId: string,
  actor: PqrStabilityReviewActor,
): Promise<{ updated: number; error?: string }> {
  if (!isFirebaseConfigured()) return { updated: 0, error: 'Firebase is not configured.' };
  try {
    const records = await fetchStabilityReviewRecords(pqrId);
    let updated = 0;
    const db = getFirebaseFirestore();
    for (let i = 0; i < records.length; i += 400) {
      const chunk = records.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((r) => {
        if (!r.id) return;
        const computed = computeStabilityCompliance(r);
        batch.update(doc(db, PQR_STABILITY_REVIEW_COLLECTIONS.review, r.id), {
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
    await logStabilityReviewAudit('risk calculated', actor, { count: updated }, pqrId);
    return { updated };
  } catch (e) {
    console.error('recalculateAllStabilityCompliance failed', e);
    return { updated: 0, error: 'Unable to recalculate stability compliance.' };
  }
}

export async function logStabilityReviewView(actor: PqrStabilityReviewActor) {
  await logStabilityReviewAudit('stability review viewed', actor);
}

export async function logStabilityReviewExport(actor: PqrStabilityReviewActor, type: 'csv' | 'excel' = 'csv') {
  await logStabilityReviewAudit('export review', actor, { type });
}

export async function logStabilityNarrativeEdit(actor: PqrStabilityReviewActor, pqrId: string) {
  await logStabilityReviewAudit('narrative edited', actor, { pqrId }, pqrId);
}

export async function logStabilityImportPlaceholder(actor: PqrStabilityReviewActor) {
  await logStabilityReviewAudit('import stability data placeholder', actor);
}
