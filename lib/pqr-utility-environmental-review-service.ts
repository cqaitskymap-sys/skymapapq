import {
  collection, doc, addDoc, getDoc, getDocs, updateDoc, query, where, limit, orderBy, writeBatch,
} from 'firebase/firestore';
import { getFirebaseFirestore, isFirebaseConfigured } from '@/lib/firebase';
import { downloadCsv } from '@/lib/export-utils';
import { createAuditLog, writeAuditTrail } from '@/lib/audit-trail';
import { ENVIRONMENTAL_LEGACY_COLLECTIONS, ENVIRONMENTAL_MONITORING_COLLECTION } from '@/lib/cpv-environmental-monitoring';
import { UTILITY_LEGACY_COLLECTIONS, UTILITY_MONITORING_COLLECTION } from '@/lib/cpv-utility-monitoring';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { fetchPqrOptions } from '@/lib/pqr-batch-review-service';
import {
  PQR_UTILITY_ENV_COLLECTIONS, PQR_UTILITY_ENV_MODULE,
  computeUtilityEnvCompliance, computeUtilityEnvSummary, generateUtilityEnvNarrative,
  normalizeUtilityEnvReviewRecord,
  type PqrUtilityEnvironmentalReviewRecord, type UtilityEnvReviewFormData,
} from '@/lib/pqr-utility-environmental-review-records';

export type PqrUtilityEnvActor = { id: string; name: string; role?: string };

export { fetchPqrOptions };
export {
  computeUtilityEnvSummary, generateUtilityEnvNarrative, buildUtilityEnvCharts,
  filterUtilityEnvReviewRecords,
} from '@/lib/pqr-utility-environmental-review-records';

const nowIso = () => new Date().toISOString();
const str = (v: unknown, fb = '') => (v === null || v === undefined ? fb : String(v));
const num = (v: unknown, fb = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

function buildReviewId(reviewType: string, system: string, param: string) {
  return `UER-${reviewType.slice(0, 3).toUpperCase()}-${system.slice(0, 6).replace(/\s+/g, '-')}-${param.slice(0, 8).replace(/\s+/g, '-')}-${Date.now().toString(36).toUpperCase()}`;
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
  for (const name of names) {
    const rows = await readCollection(name, max);
    if (rows.length) return rows;
  }
  return [];
}

async function logUtilityEnvAudit(
  actionType: string,
  actor: PqrUtilityEnvActor,
  detail?: unknown,
  recordId = 'utility-env-review',
  oldValue?: unknown,
) {
  try {
    await createAuditLog({
      moduleName: PQR_UTILITY_ENV_MODULE,
      collectionName: PQR_UTILITY_ENV_COLLECTIONS.review,
      recordId,
      actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      user: { id: actor.id, name: actor.name },
      status: 'Success',
    });
    await writeAuditTrail({
      collectionName: PQR_UTILITY_ENV_COLLECTIONS.review,
      documentId: recordId,
      action: actionType,
      oldValue: oldValue ?? null,
      newValue: detail,
      userId: actor.id,
      userName: actor.name,
      moduleName: PQR_UTILITY_ENV_MODULE,
    });
  } catch (e) {
    console.error('logUtilityEnvAudit failed', e);
  }
}

function inPeriod(dateStr: string, from: string, to: string): boolean {
  const d = dateStr.slice(0, 10);
  if (!from || !to || !d) return true;
  return d >= from && d <= to;
}

/**
 * Facility-wide utility/environmental monitoring is legitimately shared across products.
 * When the raw record carries no product code/name, include it (facility-wide monitoring).
 * When it does carry product fields, it must match the PQR product.
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

function parseObserved(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isTruthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v > 0;
  const s = str(v).toLowerCase().trim();
  return s === 'yes' || s === 'true' || s === 'y' || s === 'positive' || s === 'impacted';
}

/** Only honour explicit product-impact fields from the source. Never invent impact from a bare excursion. */
function hasExplicitImpact(raw: Record<string, unknown>): boolean {
  return isTruthyFlag(raw.impactOnProductQuality)
    || isTruthyFlag(raw.impact_on_product_quality)
    || isTruthyFlag(raw.productImpact)
    || isTruthyFlag(raw.product_impact)
    || isTruthyFlag(raw.impact_assessment)
    || isTruthyFlag(raw.impactAssessment);
}

/**
 * Resolve acceptance limits honestly. Prefer explicit lower/upper; otherwise fall back to
 * source action limits, then alert limits. Never fabricate an upper limit of 100.
 */
function resolveLimits(raw: Record<string, unknown>): { lower: number; upper: number } {
  const rawLower = raw.lowerLimit ?? raw.lower_limit;
  const rawUpper = raw.upperLimit ?? raw.upper_limit;
  const lowerNum = Number(rawLower);
  const upperNum = Number(rawUpper);
  const hasLower = rawLower !== null && rawLower !== undefined && rawLower !== '' && Number.isFinite(lowerNum);
  const hasUpper = rawUpper !== null && rawUpper !== undefined && rawUpper !== '' && Number.isFinite(upperNum);

  let lower = hasLower ? lowerNum : NaN;
  let upper = hasUpper ? upperNum : NaN;

  if (!hasLower) {
    const action = Number(raw.actionLimitLow ?? raw.action_limit_low);
    const alert = Number(raw.alertLimitLow ?? raw.alert_limit_low);
    lower = Number.isFinite(action) ? action : Number.isFinite(alert) ? alert : NaN;
  }
  if (!hasUpper) {
    const action = Number(raw.actionLimitHigh ?? raw.action_limit_high);
    const alert = Number(raw.alertLimitHigh ?? raw.alert_limit_high);
    upper = Number.isFinite(action) ? action : Number.isFinite(alert) ? alert : NaN;
  }

  return {
    lower: Number.isFinite(lower) ? lower : 0,
    upper: Number.isFinite(upper) ? upper : 0,
  };
}

/**
 * Bucket a monitoring record. OOS/OOT are treated as excursions. A "Complies" record whose
 * observed value falls outside configured (and non-degenerate) limits is also an excursion.
 */
function statusBucket(
  status: string,
  value: number | null,
  lower: number,
  upper: number,
): 'alert' | 'action' | 'excursion' | 'complies' {
  const s = status.toLowerCase().trim();
  if (s === 'excursion' || s === 'oos' || s === 'oot') return 'excursion';
  if (s === 'action') return 'action';
  if (s === 'alert') return 'alert';
  if (value != null && Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
    if (value < lower || value > upper) return 'excursion';
  }
  return 'complies';
}

interface GroupAcc {
  reviewType: 'Utility Review' | 'Environmental Review';
  systemAreaName: string;
  systemAreaCode: string;
  utilityType: string;
  cleanroomGrade: string;
  roomNumber: string;
  monitoringParameter: string;
  unit: string;
  criticality: string;
  values: number[];
  lowerLimit: number;
  upperLimit: number;
  alertCount: number;
  actionCount: number;
  excursionCount: number;
  oosCount: number;
  deviationCount: number;
  capaCount: number;
  changeControlCount: number;
  impactOnProduct: string;
  sourceIds: string[];
}

function groupKey(g: GroupAcc) {
  return `${g.reviewType}|${g.systemAreaName}|${g.monitoringParameter}|${g.utilityType}|${g.cleanroomGrade}`.toLowerCase();
}

function countLinked(
  systemName: string,
  param: string,
  records: Record<string, unknown>[],
  from: string,
  to: string,
): number {
  const sys = systemName.toLowerCase();
  const par = param.toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    const text = [
      r.title, r.description, r.systemName, r.system_name, r.areaName, r.area_name,
      r.utilitySystemName, r.parameter, r.parameterName, r.source,
    ].map((v) => str(v)).join(' ').toLowerCase();
    const match = (sys.length > 2 && text.includes(sys)) || (par.length > 2 && text.includes(par));
    if (!match) return false;
    const date = str(r.createdAt || r.created_at || r.reportedDate || r.reported_date || r.date).slice(0, 10);
    return inPeriod(date, from, to);
  }).length;
}

function accFromUtility(raw: Record<string, unknown>): GroupAcc | null {
  const param = str(raw.parameterName || raw.parameter_name);
  const system = str(raw.utilitySystemName || raw.utility_system_name || raw.samplingPoint || raw.sampling_point);
  if (!param || !system) return null;
  const status = str(raw.status, 'Complies');
  const val = parseObserved(raw.observedValue ?? raw.observed_value);
  const { lower, upper } = resolveLimits(raw);
  const bucket = statusBucket(status, val, lower, upper);
  const isOos = status.toLowerCase().trim() === 'oos';
  return {
    reviewType: 'Utility Review',
    systemAreaName: system,
    systemAreaCode: str(raw.utilitySystemCode || raw.utility_system_code || raw.parameterCode),
    utilityType: str(raw.utilityType || raw.utility_type, 'Other'),
    cleanroomGrade: 'Unclassified',
    roomNumber: str(raw.areaRoomNo || raw.area_room_no || raw.roomNumber),
    monitoringParameter: param,
    unit: str(raw.unit),
    criticality: str(raw.utilityCriticality || raw.utility_criticality || raw.criticality),
    values: val != null ? [val] : [],
    lowerLimit: lower,
    upperLimit: upper,
    alertCount: bucket === 'alert' ? 1 : 0,
    actionCount: bucket === 'action' ? 1 : 0,
    excursionCount: bucket === 'excursion' ? 1 : 0,
    oosCount: isOos ? 1 : 0,
    deviationCount: (raw.deviationRequired || raw.linkedDeviationNumber) ? 1 : 0,
    capaCount: (raw.capaRequired || raw.linkedCapaNumber) ? 1 : 0,
    changeControlCount: 0,
    impactOnProduct: hasExplicitImpact(raw) ? 'Yes' : 'No',
    sourceIds: [str(raw.id)],
  };
}

function accFromEnvironmental(raw: Record<string, unknown>): GroupAcc | null {
  const param = str(raw.parameterName || raw.parameter_name || raw.monitoringType || raw.monitoring_type);
  const system = str(raw.areaName || raw.area_name);
  if (!param || !system) return null;
  const status = str(raw.status, 'Complies');
  const val = parseObserved(raw.observedValue ?? raw.observed_value);
  const grade = str(raw.cleanroomGrade || raw.cleanroom_grade, 'Unclassified');
  const { lower, upper } = resolveLimits(raw);
  const bucket = statusBucket(status, val, lower, upper);
  const isOos = status.toLowerCase().trim() === 'oos';
  return {
    reviewType: 'Environmental Review',
    systemAreaName: system,
    systemAreaCode: str(raw.areaId || raw.area_id || raw.parameterCode),
    utilityType: 'Other',
    cleanroomGrade: grade,
    roomNumber: str(raw.roomNumber || raw.room_number),
    monitoringParameter: param,
    unit: str(raw.unit),
    criticality: str(raw.criticality),
    values: val != null ? [val] : [],
    lowerLimit: lower,
    upperLimit: upper,
    alertCount: bucket === 'alert' ? 1 : 0,
    actionCount: bucket === 'action' ? 1 : 0,
    excursionCount: bucket === 'excursion' ? 1 : 0,
    oosCount: isOos ? 1 : 0,
    deviationCount: (raw.deviationRequired || raw.linkedDeviationNumber) ? 1 : 0,
    capaCount: (raw.capaRequired || raw.linkedCapaNumber) ? 1 : 0,
    changeControlCount: 0,
    // Grade A/B excursion is a severe compliance finding, but product impact must be explicit.
    impactOnProduct: hasExplicitImpact(raw) ? 'Yes' : 'No',
    sourceIds: [str(raw.id)],
  };
}

function mergeAcc(base: GroupAcc, add: GroupAcc): GroupAcc {
  return {
    ...base,
    unit: base.unit || add.unit,
    criticality: base.criticality || add.criticality,
    values: [...base.values, ...add.values],
    lowerLimit: base.lowerLimit || add.lowerLimit,
    upperLimit: base.upperLimit || add.upperLimit,
    alertCount: base.alertCount + add.alertCount,
    actionCount: base.actionCount + add.actionCount,
    excursionCount: base.excursionCount + add.excursionCount,
    oosCount: base.oosCount + add.oosCount,
    deviationCount: base.deviationCount + add.deviationCount,
    capaCount: base.capaCount + add.capaCount,
    changeControlCount: base.changeControlCount + add.changeControlCount,
    impactOnProduct: base.impactOnProduct === 'Yes' || add.impactOnProduct === 'Yes' ? 'Yes' : 'No',
    sourceIds: [...base.sourceIds, ...add.sourceIds],
  };
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.round(Math.sqrt(variance) * 1000) / 1000;
}

function accToRecord(
  g: GroupAcc,
  pqr: PqrOption,
  deviations: Record<string, unknown>[],
  capas: Record<string, unknown>[],
  changeControls: Record<string, unknown>[],
  actor: PqrUtilityEnvActor,
): Omit<PqrUtilityEnvironmentalReviewRecord, 'id'> {
  const ts = nowIso();
  const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
  const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
  const min = g.values.length ? Math.min(...g.values) : null;
  const max = g.values.length ? Math.max(...g.values) : null;
  const avg = g.values.length ? g.values.reduce((a, b) => a + b, 0) / g.values.length : null;
  const linkedDev = countLinked(g.systemAreaName, g.monitoringParameter, deviations, from, to);
  const linkedCapa = countLinked(g.systemAreaName, g.monitoringParameter, capas, from, to);
  const linkedCc = countLinked(g.systemAreaName, g.monitoringParameter, changeControls, from, to);

  const partial: Partial<PqrUtilityEnvironmentalReviewRecord> = {
    reviewId: buildReviewId(g.reviewType, g.systemAreaName, g.monitoringParameter),
    pqrId: pqr.id,
    pqrNumber: pqr.pqrNumber,
    product: pqr.productName,
    productCode: pqr.productCode,
    reviewPeriodFrom: from,
    reviewPeriodTo: to,
    reviewType: g.reviewType,
    systemAreaName: g.systemAreaName,
    systemAreaCode: g.systemAreaCode,
    utilityType: g.utilityType,
    cleanroomGrade: g.cleanroomGrade,
    roomNumber: g.roomNumber,
    monitoringParameter: g.monitoringParameter,
    observedMinimum: min,
    observedMaximum: max,
    observedAverage: avg != null ? Math.round(avg * 1000) / 1000 : null,
    lowerLimit: g.lowerLimit,
    upperLimit: g.upperLimit,
    alertCount: g.alertCount,
    actionCount: g.actionCount,
    excursionCount: g.excursionCount,
    deviationCount: g.deviationCount + linkedDev,
    capaCount: g.capaCount + linkedCapa,
    changeControlCount: g.changeControlCount + linkedCc,
    impactOnProductQuality: g.impactOnProduct,
    conclusion: g.excursionCount === 0 ? 'Within limits' : 'Excursion(s) reviewed for impact',
    remarks: '',
    unit: g.unit,
    sampleCount: g.values.length,
    stdDeviation: stdDev(g.values),
    oosCount: g.oosCount,
    criticality: g.criticality,
    batchNumbers: [],
    attachmentUrls: [],
    sourceType: 'pull',
    sourceIds: g.sourceIds,
    createdAt: ts,
    updatedAt: ts,
    createdBy: actor.id,
    updatedBy: actor.id,
    createdByName: actor.name,
    updatedByName: actor.name,
    isDeleted: false,
  };
  const computed = computeUtilityEnvCompliance(partial);
  return { ...partial, ...computed } as Omit<PqrUtilityEnvironmentalReviewRecord, 'id'>;
}

async function commitInChunks(rows: Array<Omit<PqrUtilityEnvironmentalReviewRecord, 'id'>>, chunkSize = 400) {
  const db = getFirebaseFirestore();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const batch = writeBatch(db);
    chunk.forEach((record) => {
      batch.set(doc(collection(db, PQR_UTILITY_ENV_COLLECTIONS.review)), record);
    });
    await batch.commit();
  }
}

export async function fetchUtilityEnvReviewRecords(pqrId: string): Promise<PqrUtilityEnvironmentalReviewRecord[]> {
  if (!isFirebaseConfigured() || !pqrId) return [];
  try {
    let rows: PqrUtilityEnvironmentalReviewRecord[] = [];
    try {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.review),
        where('pqrId', '==', pqrId),
        where('isDeleted', '==', false),
      ));
      rows = snap.docs.map((d) => normalizeUtilityEnvReviewRecord({ id: d.id, ...d.data() }));
    } catch {
      const snap = await getDocs(query(
        collection(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.review),
        where('pqrId', '==', pqrId),
      ));
      rows = snap.docs
        .map((d) => normalizeUtilityEnvReviewRecord({ id: d.id, ...d.data() }))
        .filter((r) => !r.isDeleted);
    }
    return rows.sort((a, b) => a.systemAreaName.localeCompare(b.systemAreaName));
  } catch (e) {
    console.error('fetchUtilityEnvReviewRecords failed', e);
    return [];
  }
}

export async function pullUtilityEnvironmentalData(
  pqr: PqrOption,
  actor: PqrUtilityEnvActor,
): Promise<{ created: number; skipped: number; error?: string }> {
  if (!isFirebaseConfigured()) return { created: 0, skipped: 0, error: 'Firebase is not configured.' };

  try {
    await logUtilityEnvAudit('pull utility data', actor, { pqrId: pqr.id }, pqr.id);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';

    const [existing, utilityRaw, envRaw, deviations, capas, changeControls] = await Promise.all([
      fetchUtilityEnvReviewRecords(pqr.id),
      readFirst([UTILITY_MONITORING_COLLECTION, ...UTILITY_LEGACY_COLLECTIONS]),
      readFirst([ENVIRONMENTAL_MONITORING_COLLECTION, ...ENVIRONMENTAL_LEGACY_COLLECTIONS]),
      readFirst([PQR_UTILITY_ENV_COLLECTIONS.deviations]),
      readFirst([PQR_UTILITY_ENV_COLLECTIONS.capaRecords, 'capa']),
      readFirst([PQR_UTILITY_ENV_COLLECTIONS.changeControls, 'change_control']),
    ]);

    const existingKeys = new Set(existing.map((r) =>
      `${r.reviewType}|${r.systemAreaName}|${r.monitoringParameter}`.toLowerCase(),
    ));

    const groups = new Map<string, GroupAcc>();

    const processRaw = (raw: Record<string, unknown>, mapper: (r: Record<string, unknown>) => GroupAcc | null) => {
      if (raw.isDeleted) return;
      const date = str(raw.monitoringDate || raw.monitoring_date || raw.createdAt);
      if (!inPeriod(date, from, to)) return;
      // Facility-wide monitoring (no product fields) is included; product-scoped rows must match.
      if (!matchesProduct(raw, pqr)) return;
      const acc = mapper(raw);
      if (!acc) return;
      const key = groupKey(acc);
      const cur = groups.get(key);
      groups.set(key, cur ? mergeAcc(cur, acc) : acc);
    };

    utilityRaw.forEach((r) => processRaw(r, accFromUtility));
    envRaw.forEach((r) => processRaw(r, accFromEnvironmental));

    await logUtilityEnvAudit('pull environmental data', actor, { groups: groups.size }, pqr.id);

    let skipped = 0;
    const toCreate: Array<Omit<PqrUtilityEnvironmentalReviewRecord, 'id'>> = [];

    for (const g of Array.from(groups.values())) {
      const simpleKey = `${g.reviewType}|${g.systemAreaName}|${g.monitoringParameter}`.toLowerCase();
      if (existingKeys.has(simpleKey)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(simpleKey);
      toCreate.push(accToRecord(g, pqr, deviations, capas, changeControls, actor));
    }

    if (toCreate.length > 0) await commitInChunks(toCreate);

    await logUtilityEnvAudit('excursion summary generated', actor, { created: toCreate.length, skipped }, pqr.id);
    await logUtilityEnvAudit('risk calculated', actor, { created: toCreate.length }, pqr.id);
    return { created: toCreate.length, skipped };
  } catch (e) {
    console.error('pullUtilityEnvironmentalData failed', e);
    return { created: 0, skipped: 0, error: 'Unable to pull utility & environmental data. Please try again.' };
  }
}

export async function createUtilityEnvReviewRecord(
  pqr: PqrOption,
  data: UtilityEnvReviewFormData,
  actor: PqrUtilityEnvActor,
): Promise<{ id?: string; error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (data.productCode && pqr.productCode && data.productCode !== pqr.productCode) {
    return { error: 'Review product code must match the selected PQR product.' };
  }
  try {
    const existing = await fetchUtilityEnvReviewRecords(pqr.id);
    const key = `${data.reviewType}|${data.systemAreaName}|${data.monitoringParameter}`.toLowerCase();
    if (existing.some((r) => `${r.reviewType}|${r.systemAreaName}|${r.monitoringParameter}`.toLowerCase() === key)) {
      return { error: 'Duplicate review entry for this system/parameter under the same PQR.' };
    }

    const computed = computeUtilityEnvCompliance(data);
    const ts = nowIso();
    const record: Omit<PqrUtilityEnvironmentalReviewRecord, 'id'> = {
      reviewId: buildReviewId(data.reviewType, data.systemAreaName, data.monitoringParameter),
      pqrId: pqr.id,
      pqrNumber: pqr.pqrNumber,
      product: data.product,
      productCode: data.productCode,
      reviewPeriodFrom: data.reviewPeriodFrom,
      reviewPeriodTo: data.reviewPeriodTo,
      reviewType: data.reviewType,
      systemAreaName: data.systemAreaName,
      systemAreaCode: data.systemAreaCode,
      utilityType: data.utilityType,
      cleanroomGrade: data.cleanroomGrade,
      roomNumber: data.roomNumber,
      monitoringParameter: data.monitoringParameter,
      observedMinimum: data.observedMinimum ?? null,
      observedMaximum: data.observedMaximum ?? null,
      observedAverage: data.observedAverage ?? null,
      lowerLimit: data.lowerLimit,
      upperLimit: data.upperLimit,
      alertCount: data.alertCount,
      actionCount: data.actionCount,
      excursionCount: data.excursionCount,
      deviationCount: data.deviationCount,
      capaCount: data.capaCount,
      changeControlCount: data.changeControlCount,
      impactOnProductQuality: data.impactOnProductQuality,
      conclusion: data.conclusion,
      complianceStatus: computed.complianceStatus,
      complianceReasons: computed.complianceReasons,
      riskLevel: computed.riskLevel,
      remarks: data.remarks,
      batchNumbers: [],
      unit: '',
      sampleCount: 0,
      stdDeviation: null,
      oosCount: 0,
      criticality: '',
      attachmentUrls: [],
      sourceType: 'manual',
      sourceIds: [],
      createdAt: ts,
      updatedAt: ts,
      createdBy: actor.id,
      updatedBy: actor.id,
      createdByName: actor.name,
      updatedByName: actor.name,
      isDeleted: false,
    };
    const docRef = await addDoc(collection(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.review), record);
    await logUtilityEnvAudit('create review', actor, { system: data.systemAreaName, parameter: data.monitoringParameter }, docRef.id);
    await logUtilityEnvAudit('risk calculated', actor, computed, docRef.id);
    return { id: docRef.id };
  } catch (e) {
    console.error('createUtilityEnvReviewRecord failed', e);
    return { error: 'Unable to create utility & environmental review record.' };
  }
}

export async function updateUtilityEnvReviewRecord(
  id: string,
  data: UtilityEnvReviewFormData,
  actor: PqrUtilityEnvActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.review, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    const computed = computeUtilityEnvCompliance(data);
    await updateDoc(doc(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.review, id), {
      ...data,
      complianceStatus: computed.complianceStatus,
      complianceReasons: computed.complianceReasons,
      riskLevel: computed.riskLevel,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logUtilityEnvAudit('edit review', actor, { id }, id, oldValue);
    await logUtilityEnvAudit('risk calculated', actor, computed, id);
    return {};
  } catch (e) {
    console.error('updateUtilityEnvReviewRecord failed', e);
    return { error: 'Unable to update utility & environmental review record.' };
  }
}

export async function softDeleteUtilityEnvReviewRecord(id: string, actor: PqrUtilityEnvActor): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const existingSnap = await getDoc(doc(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.review, id));
    const oldValue = existingSnap.exists() ? existingSnap.data() : null;
    await updateDoc(doc(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.review, id), {
      isDeleted: true,
      updatedAt: nowIso(),
      updatedBy: actor.id,
      updatedByName: actor.name,
    });
    await logUtilityEnvAudit('delete review', actor, { id }, id, oldValue);
    return {};
  } catch (e) {
    console.error('softDeleteUtilityEnvReviewRecord failed', e);
    return { error: 'Unable to remove utility & environmental review record.' };
  }
}

export async function saveUtilityEnvSectionToPqr(
  pqrId: string,
  narrative: string,
  records: PqrUtilityEnvironmentalReviewRecord[],
  actor: PqrUtilityEnvActor,
): Promise<{ error?: string }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const summary = computeUtilityEnvSummary(records);
    const total = summary.totalUtilityRecords + summary.totalEnvironmentalRecords;
    const ts = nowIso();
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.sections),
      where('pqrId', '==', pqrId),
      where('sectionKey', '==', 'utility_environmental_review'),
    ));
    const payload = {
      pqrId,
      sectionKey: 'utility_environmental_review',
      sectionType: 'Utility & Environmental Review',
      sectionOrder: 23,
      sectionTitle: 'Utility & Environmental Monitoring Review',
      narrative,
      dataSummary: JSON.stringify(summary),
      included: true,
      status: total > 0 ? 'Completed' : 'Draft',
      updatedAt: ts,
      updatedBy: actor.id,
    };
    if (snap.empty) {
      await addDoc(collection(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.sections), {
        ...payload, createdAt: ts, createdBy: actor.id, isDeleted: false,
      });
    } else {
      await updateDoc(snap.docs[0].ref, payload);
    }

    try {
      await updateDoc(doc(getFirebaseFirestore(), PQR_UTILITY_ENV_COLLECTIONS.records, pqrId), {
        'scope.utilityEnvironmentalReview': true,
        updatedAt: ts,
        updatedBy: actor.id,
        updatedByName: actor.name,
      });
    } catch {
      // Legacy PQR documents may not support nested scope updates.
    }

    await logUtilityEnvAudit('section saved to PQR', actor, { pqrId, summary }, pqrId);
    return {};
  } catch (e) {
    console.error('saveUtilityEnvSectionToPqr failed', e);
    return { error: 'Unable to save utility & environmental section to PQR.' };
  }
}

export function getUtilityEnvReviewNarrative(records: PqrUtilityEnvironmentalReviewRecord[]): string {
  return generateUtilityEnvNarrative(computeUtilityEnvSummary(records), records);
}

export function exportUtilityEnvReviewCsv(records: PqrUtilityEnvironmentalReviewRecord[], pqrNumber?: string) {
  const headers = [
    'Sr. No.', 'PQR Number', 'Product', 'Product Code',
    'Review Type', 'System / Area', 'System / Area Code', 'Utility Type', 'Cleanroom Grade', 'Room No.',
    'Monitoring Parameter', 'Unit',
    'Observed Min', 'Observed Max', 'Observed Avg', 'Std Deviation', 'Sample Count',
    'Lower Limit', 'Upper Limit',
    'Alerts', 'Actions', 'Excursions', 'OOS',
    'Deviations', 'CAPA', 'Change Controls',
    'Impact On Product Quality', 'Compliance', 'Compliance Reasons', 'Risk', 'Criticality',
    'Conclusion', 'Remarks', 'Source',
  ];
  const rows = records.filter((r) => !r.isDeleted).map((r, i) => [
    i + 1,
    r.pqrNumber || pqrNumber || '',
    r.product,
    r.productCode,
    r.reviewType,
    r.systemAreaName,
    r.systemAreaCode,
    r.utilityType,
    r.cleanroomGrade,
    r.roomNumber,
    r.monitoringParameter,
    r.unit || '',
    r.observedMinimum ?? 'Data Not Available',
    r.observedMaximum ?? 'Data Not Available',
    r.observedAverage ?? 'Data Not Available',
    r.stdDeviation ?? 'Data Not Available',
    r.sampleCount ?? 0,
    r.lowerLimit,
    r.upperLimit,
    r.alertCount,
    r.actionCount,
    r.excursionCount,
    r.oosCount ?? 0,
    r.deviationCount,
    r.capaCount,
    r.changeControlCount,
    r.impactOnProductQuality,
    r.complianceStatus,
    (r.complianceReasons || []).join('; '),
    r.riskLevel,
    r.criticality || 'Data Not Available',
    r.conclusion,
    r.remarks,
    r.sourceType || 'manual',
  ]);
  downloadCsv(
    `pqr-utility-environmental-review-${(pqrNumber || 'export').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.csv`,
    headers,
    rows,
  );
}

function isUtilityEnvRelatedRecord(
  raw: Record<string, unknown>,
  systemNames: string[],
  parameterNames: string[],
): boolean {
  const systemList = systemNames.map((n) => n.toLowerCase()).filter((n) => n.length > 2);
  const paramList = parameterNames.map((n) => n.toLowerCase()).filter((n) => n.length > 2);
  const text = [
    raw.title, raw.description, raw.systemName, raw.system_name, raw.areaName, raw.area_name,
    raw.utilitySystemName, raw.parameter, raw.parameterName, raw.roomNumber, raw.source,
  ].map((v) => str(v)).join(' ').toLowerCase();
  const category = str(raw.category || raw.deviationType || raw.type || raw.source || raw.module).toLowerCase();
  const relatesBySystem = systemList.some((n) => text.includes(n));
  const relatesByParam = paramList.some((n) => text.includes(n));
  const relatesByCategory = category.includes('utility') || category.includes('environmental')
    || category.includes('environment') || category.includes('monitoring') || category.includes('hvac')
    || category.includes('water') || category.includes('area');
  return relatesBySystem || relatesByParam || relatesByCategory;
}

export async function fetchUtilityEnvQualityMetrics(
  pqr: PqrOption,
  records: PqrUtilityEnvironmentalReviewRecord[],
): Promise<{ utilityEnvDeviations: number; utilityEnvOos: number; utilityEnvCapa: number; utilityEnvChangeControls: number }> {
  const empty = { utilityEnvDeviations: 0, utilityEnvOos: 0, utilityEnvCapa: 0, utilityEnvChangeControls: 0 };
  if (!isFirebaseConfigured()) return empty;

  try {
    const systemNames = Array.from(new Set(records.flatMap((r) => [r.systemAreaName, r.roomNumber]).filter(Boolean)));
    const parameterNames = Array.from(new Set(records.map((r) => r.monitoringParameter).filter(Boolean)));
    const [deviations, oos, capas, changeControls] = await Promise.all([
      readFirst([PQR_UTILITY_ENV_COLLECTIONS.deviations]),
      readFirst([PQR_UTILITY_ENV_COLLECTIONS.oos, 'oos']),
      readFirst([PQR_UTILITY_ENV_COLLECTIONS.capaRecords, 'capa']),
      readFirst([PQR_UTILITY_ENV_COLLECTIONS.changeControls, 'change_control']),
    ]);

    const from = pqr.reviewPeriodFrom?.slice(0, 10) || '';
    const to = pqr.reviewPeriodTo?.slice(0, 10) || '';
    const within = (raw: Record<string, unknown>) => {
      const date = str(raw.createdAt || raw.created_at || raw.reportedDate || raw.reported_date || raw.date).slice(0, 10);
      return inPeriod(date, from, to);
    };
    const relevant = (rows: Record<string, unknown>[]) => rows.filter((r) =>
      !r.isDeleted && within(r) && isUtilityEnvRelatedRecord(r, systemNames, parameterNames),
    ).length;

    return {
      utilityEnvDeviations: relevant(deviations),
      utilityEnvOos: relevant(oos),
      utilityEnvCapa: relevant(capas),
      utilityEnvChangeControls: relevant(changeControls),
    };
  } catch (e) {
    console.error('fetchUtilityEnvQualityMetrics failed', e);
    return empty;
  }
}

export async function logUtilityEnvReviewView(actor: PqrUtilityEnvActor) {
  await logUtilityEnvAudit('utility environmental review viewed', actor);
}

export async function logUtilityEnvReviewExport(actor: PqrUtilityEnvActor, type: 'csv' | 'excel' = 'csv') {
  await logUtilityEnvAudit('export review', actor, { type });
}

export async function logUtilityEnvNarrativeEdit(actor: PqrUtilityEnvActor, pqrId: string) {
  await logUtilityEnvAudit('narrative edited', actor, { pqrId }, pqrId);
}

export async function recalculateAllUtilityEnvCompliance(
  pqrId: string,
  actor: PqrUtilityEnvActor,
): Promise<{ updated: number; error?: string }> {
  if (!isFirebaseConfigured()) return { updated: 0, error: 'Firebase is not configured.' };
  try {
    const records = await fetchUtilityEnvReviewRecords(pqrId);
    let updated = 0;
    const db = getFirebaseFirestore();
    for (let i = 0; i < records.length; i += 400) {
      const chunk = records.slice(i, i + 400);
      const batch = writeBatch(db);
      chunk.forEach((r) => {
        if (!r.id) return;
        const computed = computeUtilityEnvCompliance(r);
        batch.update(doc(db, PQR_UTILITY_ENV_COLLECTIONS.review, r.id), {
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
    await logUtilityEnvAudit('risk calculated', actor, { count: updated }, pqrId);
    return { updated };
  } catch (e) {
    console.error('recalculateAllUtilityEnvCompliance failed', e);
    return { updated: 0, error: 'Unable to recalculate utility & environmental compliance.' };
  }
}
