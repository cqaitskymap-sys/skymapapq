import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchParameters, normalizeParameter } from '@/lib/admin/parameter-service';
import type { Parameter } from '@/lib/admin/schemas';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatchById, fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS, type CppRecord } from '@/lib/cpv';
import {
  CPP_RESULTS_COLLECTION,
  CPP_MODULE_NAME,
  buildCppResultId,
  parameterMatchesCppProcessStage,
  type CppResultFormData,
  type CppResultRecord,
} from '@/lib/cpv-cpp-monitoring';

export interface CppActor {
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

function observedVal(v: unknown): string | number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return 0;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : trimmed;
  }
  return String(v);
}

function cfErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\(.*\)$/, '').trim() || fallback;
  }
  return fallback;
}

export function normalizeCppResult(raw: Record<string, unknown>): CppResultRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  return {
    id: str(raw.id),
    cppResultId: str(raw.cppResultId || raw.cpp_result_id, buildCppResultId(batchNumber, parameterCode)),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    productVersion: str(raw.productVersion),
    batchNumber,
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
    processStage: str(raw.processStage || raw.process_stage),
    processArea: str(raw.processArea || raw.process_area),
    equipmentId: str(raw.equipmentId),
    equipmentName: str(raw.equipmentName),
    machineId: str(raw.machineId),
    sensorId: str(raw.sensorId),
    site: str(raw.site),
    department: str(raw.department),
    shift: str(raw.shift),
    parameterId: str(raw.parameterId || raw.parameter_id),
    parameterCode,
    parameterName: str(raw.parameterName || raw.parameter_name),
    parameterCategory: str(raw.parameterCategory || raw.parameter_category),
    observedValue: observedVal(raw.observedValue ?? raw.observed_value),
    targetValue: num(raw.targetValue ?? raw.target_value ?? raw.target),
    lowerLimit: num(raw.lowerLimit ?? raw.lower_limit ?? raw.lsl),
    upperLimit: num(raw.upperLimit ?? raw.upper_limit ?? raw.usl),
    alertLimitLow: optionalNum(raw.alertLimitLow ?? raw.alert_limit_low),
    alertLimitHigh: optionalNum(raw.alertLimitHigh ?? raw.alert_limit_high),
    actionLimitLow: optionalNum(raw.actionLimitLow ?? raw.action_limit_low),
    actionLimitHigh: optionalNum(raw.actionLimitHigh ?? raw.action_limit_high),
    ucl: optionalNum(raw.ucl) ?? null,
    lcl: optionalNum(raw.lcl) ?? null,
    unit: str(raw.unit),
    resultType: (str(raw.resultType || raw.result_type, 'Numeric') as CppResultRecord['resultType']),
    frequency: str(raw.frequency, 'Per Batch'),
    criticality: (str(raw.criticality, 'Major') as CppResultRecord['criticality']),
    observationDateTime: str(raw.observationDateTime || raw.observation_date_time || raw.createdAt),
    recordedBy: str(raw.recordedBy || raw.recorded_by),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    remarks: str(raw.remarks),
    status: str(raw.status, 'Complies'),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as CppResultRecord['reviewStatus']),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
    changeReason: str(raw.changeReason),
  };
}

export async function fetchCppResults(max = 500): Promise<CppResultRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: CppResultRecord[] = [];
    try {
      primary = await getRecords<CppResultRecord>(CPP_RESULTS_COLLECTION, [orderBy('observationDateTime', 'desc'), limit(max)]);
    } catch {
      primary = await getRecords<CppResultRecord>(CPP_RESULTS_COLLECTION, [limit(max)]);
    }
    const normalized = primary
      .map((r) => normalizeCppResult(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) return normalized.sort((a, b) => b.observationDateTime.localeCompare(a.observationDateTime));
    const legacy = await listCpvRecords<CppRecord>(CPV_COLLECTIONS.cpp, max);
    return legacy.map((r) => normalizeCppResult({
      ...r,
      batchNumber: r.batchNo,
      parameterName: r.parameterName,
      lowerLimit: r.lsl,
      upperLimit: r.usl,
      targetValue: r.targetValue,
      observationDateTime: r.manufacturingDate,
      reviewStatus: 'Draft',
    }));
  } catch (e) {
    console.error('fetchCppResults failed', e);
    return [];
  }
}

export async function fetchCppResultById(id: string): Promise<CppResultRecord | null> {
  const record = await getRecord<CppResultRecord>(CPP_RESULTS_COLLECTION, id);
  if (record) {
    const n = normalizeCppResult(record as unknown as Record<string, unknown>);
    return n.isDeleted ? null : n;
  }
  const all = await fetchCppResults();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchCppParametersForProduct(
  productName: string,
  cpvProductId?: string,
  processStage?: string,
  processArea = '',
): Promise<Parameter[]> {
  try {
    const all = await fetchParameters();
    let cpp = all.filter((p) => {
      const n = normalizeParameter(p);
      return n.parameterType === 'CPP' && n.status === 'Active';
    });
    if (cpvProductId) {
      const product = await fetchCpvProductById(cpvProductId);
      const linked = product?.linkedCppParameterIds || [];
      if (linked.length) {
        const linkedParams = cpp.filter((p) =>
          linked.includes(p.id || '') || linked.includes(p.parameterId || ''),
        );
        if (linkedParams.length) cpp = linkedParams;
      }
    }
    const byProduct = cpp.filter((p) => {
      const link = p.productLink || p.product || '';
      return !link || link === productName || link === 'All Products';
    });
    let list = byProduct.length ? byProduct : cpp;
    if (processStage) {
      list = list.filter((p) => {
        const n = normalizeParameter(p);
        return parameterMatchesCppProcessStage(
          n.parameterName,
          processStage,
          n.processStage,
          processArea,
        );
      });
    }
    return list;
  } catch {
    return [];
  }
}

export async function fetchCppBatchesForProduct(productName: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) => b.productName === productName || b.productCode === productName);
}

export async function createCppResult(
  data: CppResultFormData,
  _actor: CppActor,
  autoDeviation = true,
): Promise<{ result: CppResultRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for CPP entry.' };
    }
    const batches = await fetchCppBatchesForProduct(data.productName);
    const batchMatch = batches.find((b) => b.batchNumber === data.batchNumber);
    if (batches.length && !batchMatch) return { result: null, error: 'Batch does not belong to selected product.' };
    if (batchMatch && ['Cancelled', 'Closed', 'Rejected', 'Archived'].includes(batchMatch.batchStatus)) {
      return { result: null, error: 'Closed, rejected, or archived batch — entry not allowed.' };
    }

    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminCppResult',
    );
    const result = await fn({ ...data, autoDeviation, changeReason: data.changeReason });
    return { result: normalizeCppResult(result.data), error: null };
  } catch (e) {
    console.error('createCppResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create CPP result.') };
  }
}

export async function updateCppResult(
  id: string,
  data: Partial<CppResultFormData>,
  _actor: CppActor,
  existing: CppResultRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: CppResultRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved CPP result is locked. QA override required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminCppResult',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { result: normalizeCppResult(result.data), error: null };
  } catch (e) {
    console.error('updateCppResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update CPP result.') };
  }
}

export async function reviewCppResult(
  id: string,
  _actor: CppActor,
  _existing: CppResultRecord,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminCppResult',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeCppResult(result.data), error: null };
  } catch (e) {
    console.error('reviewCppResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveCppResult(
  id: string,
  _actor: CppActor,
  _existing: CppResultRecord,
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
      'approveAdminCppResult',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeCppResult(result.data), error: null };
  } catch (e) {
    console.error('approveCppResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve CPP result.') };
  }
}

export async function bulkCreateCppResults(
  rows: CppResultFormData[],
  _actor: CppActor,
  changeReason = 'Bulk CPP entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminCppResults',
    );
    const result = await fn({ rows, changeReason });
    return result.data;
  } catch (e) {
    console.error('bulkCreateCppResults failed', e);
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function autofillFromBatch(batchId: string) {
  const batch = await fetchCpvBatchById(batchId);
  if (!batch) return null;
  return {
    cpvProductId: batch.cpvProductId,
    productName: batch.productName,
    productCode: batch.productCode,
    batchNumber: batch.batchNumber,
    manufacturingDate: batch.manufacturingDate,
  };
}

export async function fetchCppAuditTrail(recordId: string) {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('documentId', '==', recordId), limit(50)));
    if (!snap.empty) return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const snap2 = await getDocs(query(collection(getFirebaseFirestore(), 'audit_trail'), where('recordId', '==', recordId), limit(50)));
    return snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function logCppExport(actor: CppActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCppExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logCppExport CF failed (non-blocking)', e);
  }
}

export function parameterTrendData(results: CppResultRecord[], parameterName: string) {
  return results
    .filter((r) => r.parameterName === parameterName)
    .sort((a, b) => a.observationDateTime.localeCompare(b.observationDateTime))
    .map((r) => ({
      label: r.batchNumber,
      observed: Number(r.observedValue),
      target: r.targetValue,
      lsl: r.lowerLimit,
      usl: r.upperLimit,
      date: r.observationDateTime,
    }));
}

export function buildCppExportRows(results: CppResultRecord[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = [
    'CPP Result ID', 'Product Code', 'Product', 'Batch', 'Process Stage', 'Area',
    'Parameter Code', 'Parameter', 'Observed', 'Target', 'LSL', 'USL', 'UCL', 'LCL',
    'Unit', 'Status', 'Risk', 'Review Status', 'Equipment', 'Site', 'Shift',
    'Observation', 'Recorded By', 'Deviation', 'CAPA Required',
  ];
  const rows = results.map((r) => [
    r.cppResultId,
    r.productCode,
    r.productName,
    r.batchNumber,
    r.processStage,
    r.processArea || '',
    r.parameterCode,
    r.parameterName,
    r.observedValue,
    r.targetValue ?? '',
    r.lowerLimit,
    r.upperLimit,
    r.ucl ?? '',
    r.lcl ?? '',
    r.unit,
    r.status,
    r.riskLevel,
    r.reviewStatus,
    r.equipmentName || r.equipmentId || '',
    r.site || '',
    r.shift || '',
    r.observationDateTime,
    r.recordedBy,
    r.linkedDeviationNumber || '',
    r.capaRequired ? 'Yes' : 'No',
  ]);
  return { headers, rows };
}

/** @deprecated Module name retained for callers */
export const CPP_MODULE = CPP_MODULE_NAME;
