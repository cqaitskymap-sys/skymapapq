import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import {
  STABILITY_STUDIES_COLLECTION,
  STABILITY_SCHEDULES_COLLECTION,
  STABILITY_RESULTS_COLLECTION,
  STABILITY_LEGACY_COLLECTIONS,
  STABILITY_MONITORING_COLLECTION,
  STABILITY_MODULE_NAME,
  INTERVALS_BY_STUDY_TYPE,
  buildStabilityStudyNumber,
  buildStabilityMonitoringId,
  evaluateStabilityStatus,
  evaluateStabilityRisk,
  computeScheduleStatus,
  computeParameterSlope,
  intervalToMonths,
  addMonthsToDate,
  defaultLimitsForParameter,
  mapDefaultParameterFields,
  DEFAULT_STABILITY_PARAMETERS,
  type StabilityStudyFormData,
  type StabilityStudyRecord,
  type StabilityScheduleRecord,
  type StabilityResultFormData,
  type StabilityResultRecord,
  type StabilityAttachment,
} from '@/lib/cpv-stability-monitoring';

export interface StabilityActor {
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
    const message = String((e as { message?: string }).message || '');
    if (message) return message.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '').trim() || fallback;
  }
  return fallback;
}

function normalizeStudy(raw: Record<string, unknown>): StabilityStudyRecord {
  const batchNumber = str(raw.batchNumber || raw.batch_number);
  const studyType = str(raw.studyType || raw.study_type, 'Long Term');
  return {
    id: str(raw.id),
    stabilityMonitoringId: str(raw.stabilityMonitoringId || raw.stability_monitoring_id),
    stabilityStudyNumber: str(raw.stabilityStudyNumber || raw.stability_study_number, buildStabilityStudyNumber(batchNumber, studyType)),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    productVersion: str(raw.productVersion || raw.product_version),
    strength: str(raw.strength),
    dosageForm: str(raw.dosageForm || raw.dosage_form),
    packSize: str(raw.packSize || raw.pack_size),
    packagingType: str(raw.packagingType || raw.packaging_type),
    shelfLifeMonths: optionalNum(raw.shelfLifeMonths ?? raw.shelf_life_months),
    batchNumber,
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
    expiryDate: str(raw.expiryDate || raw.expiry_date),
    studyType: studyType as StabilityStudyRecord['studyType'],
    storageCondition: (str(raw.storageCondition || raw.storage_condition, '25°C / 60% RH') as StabilityStudyRecord['storageCondition']),
    studyStartDate: str(raw.studyStartDate || raw.study_start_date || raw.study_initiation_date),
    studyEndDate: str(raw.studyEndDate || raw.study_end_date),
    protocolVersion: str(raw.protocolVersion || raw.protocol_version),
    specificationVersion: str(raw.specificationVersion || raw.specification_version),
    site: str(raw.site),
    department: str(raw.department),
    chamberId: str(raw.chamberId || raw.chamber_id),
    chamberName: str(raw.chamberName || raw.chamber_name),
    studyStatus: (str(raw.studyStatus || raw.study_status || raw.status, 'Ongoing') as StabilityStudyRecord['studyStatus']),
    remarks: str(raw.remarks),
    changeReason: str(raw.changeReason || raw.change_reason),
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

function normalizeSchedule(raw: Record<string, unknown>): StabilityScheduleRecord {
  const dueDate = str(raw.samplePullingDueDate || raw.sample_pulling_due_date || raw.scheduled_date);
  const actualPull = str(raw.actualPullingDate || raw.actual_pulling_date || raw.actualSamplePullingDate);
  const resultEntry = str(raw.resultEntryStatus || raw.result_entry_status, 'Pending');
  const cancelled = str(raw.scheduleStatus) === 'Cancelled';
  const scheduleStatus = str(
    raw.scheduleStatus || raw.schedule_status,
    computeScheduleStatus(dueDate, actualPull, resultEntry, cancelled),
  );
  return {
    id: str(raw.id),
    studyId: str(raw.studyId || raw.study_id),
    stabilityStudyNumber: str(raw.stabilityStudyNumber || raw.stability_study_number || raw.study_number),
    batchNumber: str(raw.batchNumber || raw.batch_number),
    studyType: str(raw.studyType || raw.study_type),
    storageCondition: str(raw.storageCondition || raw.storage_condition),
    interval: str(raw.interval || raw.pullingInterval || raw.pulling_interval),
    samplePullingDueDate: dueDate,
    actualPullingDate: actualPull,
    scheduleStatus,
    resultEntryStatus: resultEntry,
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    isDeleted: Boolean(raw.isDeleted),
  };
}

function normalizeResult(raw: Record<string, unknown>): StabilityResultRecord {
  const batchNumber = str(raw.batchNumber || raw.batch_number);
  const interval = str(raw.pullingInterval || raw.pulling_interval || raw.interval);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  const lower = num(raw.lowerLimit ?? raw.lower_limit ?? raw.lsl);
  const upper = num(raw.upperLimit ?? raw.upper_limit ?? raw.usl);
  const resultType = str(raw.resultType || raw.result_type, 'Numeric');
  const observed = raw.observedResult ?? raw.observed_result ?? raw.observedValue;
  const status = str(
    raw.status || raw.result_status,
    evaluateStabilityStatus(
      observed as number | string,
      lower,
      upper,
      resultType,
      num(raw.alertLimitLow ?? raw.alert_limit_low),
      num(raw.alertLimitHigh ?? raw.alert_limit_high),
      num(raw.actionLimitLow ?? raw.action_limit_low),
      num(raw.actionLimitHigh ?? raw.action_limit_high),
    ),
  );
  const attachments = Array.isArray(raw.attachments) ? raw.attachments as StabilityAttachment[] : [];
  return {
    id: str(raw.id),
    stabilityMonitoringId: str(
      raw.stabilityMonitoringId || raw.stability_monitoring_id,
      buildStabilityMonitoringId(batchNumber, interval, parameterCode),
    ),
    studyId: str(raw.studyId || raw.study_id),
    scheduleId: str(raw.scheduleId || raw.schedule_id),
    stabilityStudyNumber: str(raw.stabilityStudyNumber || raw.stability_study_number || raw.study_number),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    batchNumber,
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
    expiryDate: str(raw.expiryDate || raw.expiry_date),
    studyType: (str(raw.studyType || raw.study_type, 'Long Term') as StabilityResultRecord['studyType']),
    storageCondition: (str(raw.storageCondition || raw.storage_condition, '25°C / 60% RH') as StabilityResultRecord['storageCondition']),
    pullingInterval: (interval as StabilityResultRecord['pullingInterval']),
    samplePullingDueDate: str(raw.samplePullingDueDate || raw.sample_pulling_due_date),
    actualSamplePullingDate: str(raw.actualSamplePullingDate || raw.actual_sample_pulling_date),
    testDate: str(raw.testDate || raw.test_date),
    parameterCode,
    parameterName: str(raw.parameterName || raw.parameter_name),
    observedResult: observed as number | string,
    targetValue: optionalNum(raw.targetValue ?? raw.target_value ?? raw.target),
    lowerLimit: lower,
    upperLimit: upper,
    alertLimitLow: optionalNum(raw.alertLimitLow ?? raw.alert_limit_low),
    alertLimitHigh: optionalNum(raw.alertLimitHigh ?? raw.alert_limit_high),
    actionLimitLow: optionalNum(raw.actionLimitLow ?? raw.action_limit_low),
    actionLimitHigh: optionalNum(raw.actionLimitHigh ?? raw.action_limit_high),
    unit: str(raw.unit),
    resultType: (resultType as StabilityResultRecord['resultType']),
    analyst: str(raw.analyst || raw.analyst_name),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    chamberId: str(raw.chamberId || raw.chamber_id),
    chamberName: str(raw.chamberName || raw.chamber_name),
    remarks: str(raw.remarks),
    changeReason: str(raw.changeReason || raw.change_reason),
    status,
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    ootRequired: Boolean(raw.ootRequired || raw.oot_required || status === 'OOT'),
    oosRequired: Boolean(raw.oosRequired || raw.oos_required || status === 'OOS'),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as StabilityResultRecord['reviewStatus']),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    attachments,
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function buildStabilityComputedFields(
  data: Pick<StabilityResultFormData, 'observedResult' | 'lowerLimit' | 'upperLimit' | 'resultType' | 'alertLimitLow' | 'alertLimitHigh' | 'actionLimitLow' | 'actionLimitHigh' | 'parameterName'>,
) {
  const status = evaluateStabilityStatus(
    data.observedResult,
    data.lowerLimit,
    data.upperLimit,
    data.resultType,
    data.alertLimitLow,
    data.alertLimitHigh,
    data.actionLimitLow,
    data.actionLimitHigh,
  );
  return {
    status,
    ootRequired: status === 'OOT',
    oosRequired: status === 'OOS',
  };
}

async function fetchFromCollection<T>(
  collectionName: string,
  normalize: (raw: Record<string, unknown>) => T,
  max = 500,
): Promise<T[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let rows: Record<string, unknown>[] = [];
    try {
      rows = await getRecords<Record<string, unknown>>(collectionName, [orderBy('createdAt', 'desc'), limit(max)]);
    } catch {
      rows = await getRecords<Record<string, unknown>>(collectionName, [limit(max)]);
    }
    const normalized = rows
      .map((r) => normalize(r))
      .filter((r) => !(r as { isDeleted?: boolean }).isDeleted);
    if (normalized.length) return normalized.sort((a, b) => {
      const aDate = (a as { createdAt?: string }).createdAt || '';
      const bDate = (b as { createdAt?: string }).createdAt || '';
      return bDate.localeCompare(aDate);
    });
    return [];
  } catch (e) {
    console.error(`fetchFromCollection ${collectionName} failed`, e);
    return [];
  }
}

export async function fetchStabilityStudies(max = 500): Promise<StabilityStudyRecord[]> {
  const primary = await fetchFromCollection(STABILITY_STUDIES_COLLECTION, normalizeStudy, max);
  if (primary.length) return primary;
  for (const legacy of STABILITY_LEGACY_COLLECTIONS) {
    const legacyRows = await listCpvRecords<Record<string, unknown>>(legacy, max);
    if (legacyRows.length) return legacyRows.map((r) => normalizeStudy(r));
  }
  const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.stability, max);
  return cpvLegacy.map((r) => normalizeStudy(r));
}

export async function fetchStabilitySchedules(studyId?: string, max = 500): Promise<StabilityScheduleRecord[]> {
  const all = await fetchFromCollection(STABILITY_SCHEDULES_COLLECTION, normalizeSchedule, max);
  if (!studyId) return all;
  return all.filter((s) => s.studyId === studyId);
}

export async function fetchStabilityResults(max = 500): Promise<StabilityResultRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: StabilityResultRecord[] = [];
    try {
      const rows = await getRecords<Record<string, unknown>>(
        STABILITY_RESULTS_COLLECTION,
        [orderBy('testDate', 'desc'), limit(max)],
      );
      primary = rows.map((r) => normalizeResult(r)).filter((r) => !r.isDeleted);
    } catch {
      primary = await fetchFromCollection(STABILITY_RESULTS_COLLECTION, normalizeResult, max);
    }
    if (!primary.length) {
      const legacy = await listCpvRecords<Record<string, unknown>>(STABILITY_MONITORING_COLLECTION, max);
      if (legacy.length) primary = legacy.map((r) => normalizeResult(r));
    }
    primary.sort((a, b) => (b.testDate || b.createdAt).localeCompare(a.testDate || a.createdAt));
    return primary;
  } catch (e) {
    console.error('fetchStabilityResults failed', e);
    return [];
  }
}

export async function fetchStabilityStudyById(id: string): Promise<StabilityStudyRecord | null> {
  const record = await getRecord<Record<string, unknown>>(STABILITY_STUDIES_COLLECTION, id);
  if (record) return normalizeStudy(record);
  const all = await fetchStabilityStudies();
  return all.find((s) => s.id === id) ?? null;
}

export async function fetchStabilityResultById(id: string): Promise<StabilityResultRecord | null> {
  const record = await getRecord<Record<string, unknown>>(STABILITY_RESULTS_COLLECTION, id);
  if (record) return normalizeResult(record);
  const all = await fetchStabilityResults();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchStabilityBatchesForProduct(productName: string, productId?: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) =>
    b.productName === productName
    || b.productCode === productName
    || (productId && b.cpvProductId === productId),
  );
}

export async function createStabilityStudy(
  data: StabilityStudyFormData,
  _actor: StabilityActor,
): Promise<{ result: StabilityStudyRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (data.changeReason.trim().length < 5) return { result: null, error: 'Change reason (min 5 characters) is required.' };
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) return { result: null, error: 'Selected CPV product is not operational.' };
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'createAdminStabilityStudy');
    const result = await fn(data);
    return { result: normalizeStudy(result.data), error: null };
  } catch (e) {
    console.error('createStabilityStudy failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create stability study.') };
  }
}

export async function updateStabilityStudy(
  id: string,
  data: Partial<StabilityStudyFormData>,
  _actor: StabilityActor,
  existing: StabilityStudyRecord,
): Promise<{ result: StabilityStudyRecord | null; error: string | null }> {
  try {
    const changeReason = data.changeReason || existing.changeReason;
    if (!changeReason || changeReason.trim().length < 5) return { result: null, error: 'Change reason (min 5 characters) is required.' };
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'updateAdminStabilityStudy');
    const result = await fn({ ...existing, ...data, id, changeReason });
    return { result: normalizeStudy(result.data), error: null };
  } catch (e) {
    console.error('updateStabilityStudy failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update stability study.') };
  }
}

export async function generateStabilitySchedule(
  studyId: string,
  intervals: string[],
  _actor: StabilityActor,
  changeReason = 'Generate stability schedule',
): Promise<{ schedules: StabilityScheduleRecord[]; error: string | null }> {
  if (!isFirebaseConfigured()) return { schedules: [], error: 'Firebase is not configured.' };
  try {
    if (changeReason.trim().length < 5) return { schedules: [], error: 'Change reason (min 5 characters) is required.' };
    const fn = httpsCallable<Record<string, unknown>, { schedules: Record<string, unknown>[] }>(getFirebaseFunctions(), 'generateAdminStabilitySchedule');
    const result = await fn({ studyId, intervals, changeReason });
    return { schedules: result.data.schedules.map(normalizeSchedule), error: null };
  } catch (e) {
    console.error('generateStabilitySchedule failed', e);
    return { schedules: [], error: cfErrorMessage(e, 'Failed to generate schedule.') };
  }
}

export async function updateSchedulePull(
  scheduleId: string,
  actualPullingDate: string,
  _actor: StabilityActor,
  changeReason = 'Update sample pull',
): Promise<{ result: StabilityScheduleRecord | null; error: string | null }> {
  try {
    if (changeReason.trim().length < 5) return { result: null, error: 'Change reason (min 5 characters) is required.' };
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'updateAdminStabilityPull');
    const result = await fn({ scheduleId, actualPullingDate, changeReason });
    return { result: normalizeSchedule(result.data), error: null };
  } catch (e) {
    console.error('updateSchedulePull failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update sample pull.') };
  }
}

export async function refreshScheduleStatuses(_actor: StabilityActor): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const fn = httpsCallable(getFirebaseFunctions(), 'refreshAdminStabilitySchedules');
  await fn({});
}

export async function createStabilityResult(
  data: StabilityResultFormData,
  _actor: StabilityActor,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: StabilityResultRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (data.changeReason.trim().length < 5) return { result: null, error: 'Change reason (min 5 characters) is required.' };
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) return { result: null, error: 'Selected CPV product is not operational.' };
    if (qaOverride && options?.esignConfirmed !== true) return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'createAdminStabilityResult');
    const result = await fn({ ...data, qaOverride, esignConfirmed: options?.esignConfirmed === true });
    return { result: normalizeResult(result.data), error: null };
  } catch (e) {
    console.error('createStabilityResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create stability result.') };
  }
}

export async function updateStabilityResult(
  id: string,
  data: Partial<StabilityResultFormData>,
  _actor: StabilityActor,
  existing: StabilityResultRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: StabilityResultRecord | null; error: string | null }> {
  try {
    const changeReason = data.changeReason || existing.changeReason;
    if (!changeReason || changeReason.trim().length < 5) return { result: null, error: 'Change reason (min 5 characters) is required.' };
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) return { result: null, error: 'Approved stability result is locked. QA override required.' };
    if (qaOverride && options?.esignConfirmed !== true) return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'updateAdminStabilityResult');
    const result = await fn({ ...existing, ...data, id, changeReason, qaOverride, esignConfirmed: options?.esignConfirmed === true });
    return { result: normalizeResult(result.data), error: null };
  } catch (e) {
    console.error('updateStabilityResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update stability result.') };
  }
}

export async function reviewStabilityResult(id: string, _actor: StabilityActor, changeReason = 'Submitted for QA review') {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'reviewAdminStabilityResult');
    const result = await fn({ id, changeReason });
    return { result: normalizeResult(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to submit stability review.') };
  }
}

export async function approveStabilityResult(
  id: string,
  _actor: StabilityActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  if (!changeReason || changeReason.trim().length < 5) return { result: null, error: 'Change reason (min 5 characters) is required.' };
  if (options?.esignConfirmed !== true) return { result: null, error: 'Electronic signature confirmation required.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'approveAdminStabilityResult');
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeResult(result.data), error: null };
  } catch (e) {
    return { result: null, error: cfErrorMessage(e, 'Failed to approve stability result.') };
  }
}

export async function bulkCreateStabilityResults(
  rows: StabilityResultFormData[],
  _actor: StabilityActor,
  changeReason = 'Bulk stability result entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  if (!changeReason || changeReason.trim().length < 5) return { created: 0, errors: ['Change reason (min 5 characters) is required.'] };
  try {
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(getFirebaseFunctions(), 'bulkCreateAdminStabilityResults');
    return (await fn({ rows, changeReason })).data;
  } catch (e) {
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function fetchStabilityAuditTrail(recordId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('documentId', '==', recordId), limit(50)));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function logStabilityExport(actor: StabilityActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminStabilityExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logStabilityExport CF failed (non-blocking)', e);
  }
}

export async function updateStabilityAttachments(
  id: string,
  attachments: StabilityAttachment[],
  _actor: StabilityActor,
  existing: StabilityResultRecord,
  changeReason = 'Update stability attachments',
) {
  try {
    if (changeReason.trim().length < 5) return { result: null, error: 'Change reason (min 5 characters) is required.' };
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(getFirebaseFunctions(), 'updateAdminStabilityAttachments');
    const result = await fn({ id, attachments, changeReason, existing });
    return { result: normalizeResult(result.data), error: null };
  } catch (e) {
    console.error('updateStabilityAttachments failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update attachments.') };
  }
}

export async function softDeleteStabilityResult(
  id: string,
  _actor: StabilityActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
): Promise<{ error: string | null }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  if (!changeReason || changeReason.trim().length < 5) return { error: 'Change reason (min 5 characters) is required.' };
  if (options?.esignConfirmed !== true) return { error: 'Electronic signature confirmation required.' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminStabilityResult');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    return { error: cfErrorMessage(e, 'Failed to archive stability result.') };
  }
}

export function stabilityParameterTrendData(results: StabilityResultRecord[], parameterName: string) {
  return results
    .filter((r) => r.parameterName === parameterName && Number.isFinite(Number(r.observedResult)))
    .sort((a, b) => intervalToMonths(a.pullingInterval) - intervalToMonths(b.pullingInterval))
    .map((r) => ({
      label: r.pullingInterval,
      observed: Number(r.observedResult),
      target: r.targetValue,
      lsl: r.lowerLimit,
      usl: r.upperLimit,
    }));
}

export function defaultStabilityParameters() {
  return DEFAULT_STABILITY_PARAMETERS.map((name) => mapDefaultParameterFields(name));
}
