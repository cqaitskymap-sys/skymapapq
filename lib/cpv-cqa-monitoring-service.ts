import {
  collection, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { getRecord, getRecords } from '@/lib/firestore';
import { fetchParameters, normalizeParameter } from '@/lib/admin/parameter-service';
import type { Parameter } from '@/lib/admin/schemas';
import { fetchCpvProductById } from '@/lib/cpv-product-master-service';
import { isCpvProductOperational } from '@/lib/cpv-product-master';
import { fetchCpvBatchById, fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS, type CqaRecord } from '@/lib/cpv';
import {
  CQA_RESULTS_COLLECTION,
  CQA_MODULE_NAME,
  buildCqaResultId,
  parameterMatchesCqaTestStage,
  type CqaResultFormData,
  type CqaResultRecord,
} from '@/lib/cpv-cqa-monitoring';

export interface CqaActor {
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

export function normalizeCqaResult(raw: Record<string, unknown>): CqaResultRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  return {
    id: str(raw.id),
    cqaResultId: str(raw.cqaResultId || raw.cqa_result_id, buildCqaResultId(batchNumber, parameterCode)),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    productVersion: str(raw.productVersion),
    batchNumber,
    manufacturingDate: str(raw.manufacturingDate || raw.manufacturing_date),
    expiryDate: str(raw.expiryDate || raw.expiry_date),
    testStage: str(raw.testStage || raw.test_stage),
    parameterId: str(raw.parameterId || raw.parameter_id),
    parameterCode,
    parameterName: str(raw.parameterName || raw.parameter_name || raw.testParameter),
    subParameter: str(raw.subParameter || raw.sub_parameter || raw.subparameter),
    parameterCategory: str(raw.parameterCategory || raw.parameter_category),
    responsibility: str(raw.responsibility),
    specificationText: str(raw.specificationText || raw.specification_text),
    specificationNumber: str(raw.specificationNumber || raw.specification_number),
    specificationVersion: str(raw.specificationVersion),
    stpNumber: str(raw.stpNumber || raw.stp_number),
    testMethod: str(raw.testMethod),
    observedResult: observedVal(raw.observedResult ?? raw.observed_result ?? raw.observedValue ?? raw.observed_value),
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
    resultType: (str(raw.resultType || raw.result_type, 'Numeric') as CqaResultRecord['resultType']),
    criticality: (str(raw.criticality, 'Major') as CqaResultRecord['criticality']),
    testDate: str(raw.testDate || raw.test_date || raw.createdAt),
    analyst: str(raw.analyst || raw.recordedBy || raw.recorded_by),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    remarks: str(raw.remarks),
    site: str(raw.site),
    department: str(raw.department),
    shift: str(raw.shift),
    equipmentId: str(raw.equipmentId),
    equipmentName: str(raw.equipmentName),
    status: str(raw.status, 'Complies'),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    oosRequired: Boolean(raw.oosRequired || raw.oos_required),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as CqaResultRecord['reviewStatus']),
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

export async function fetchCqaResults(max = 500): Promise<CqaResultRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: CqaResultRecord[] = [];
    try {
      primary = await getRecords<CqaResultRecord>(CQA_RESULTS_COLLECTION, [orderBy('testDate', 'desc'), limit(max)]);
    } catch {
      primary = await getRecords<CqaResultRecord>(CQA_RESULTS_COLLECTION, [limit(max)]);
    }
    const normalized = primary
      .map((r) => normalizeCqaResult(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) return normalized.sort((a, b) => b.testDate.localeCompare(a.testDate));
    const legacy = await listCpvRecords<CqaRecord>(CPV_COLLECTIONS.cqa, max);
    return legacy.map((r) => normalizeCqaResult({
      ...r,
      batchNumber: r.batchNo,
      parameterName: r.testParameter,
      lowerLimit: r.lsl,
      upperLimit: r.usl,
      targetValue: r.target,
      testDate: r.testDate,
      analyst: r.recordedBy,
      reviewStatus: 'Draft',
    }));
  } catch (e) {
    console.error('fetchCqaResults failed', e);
    return [];
  }
}

export async function fetchCqaResultById(id: string): Promise<CqaResultRecord | null> {
  const record = await getRecord<CqaResultRecord>(CQA_RESULTS_COLLECTION, id);
  if (record) {
    const n = normalizeCqaResult(record as unknown as Record<string, unknown>);
    return n.isDeleted ? null : n;
  }
  const all = await fetchCqaResults();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchCqaParametersForProduct(
  productName: string,
  cpvProductId?: string,
  microbiologyOnly = false,
  testStage?: string,
): Promise<Parameter[]> {
  try {
    const all = await fetchParameters();
    let cqa = all.filter((p) => {
      const n = normalizeParameter(p);
      return n.parameterType === 'CQA' && n.status === 'Active';
    });
    if (cpvProductId) {
      const product = await fetchCpvProductById(cpvProductId);
      const linked = product?.linkedCqaParameterIds || [];
      if (linked.length) {
        cqa = cqa.filter((p) => linked.includes(p.id || ''));
      }
    }
    const byProduct = cqa.filter((p) => {
      const link = p.productLink || p.product || '';
      return !link || link === productName || link === 'All Products';
    });
    let list = byProduct.length ? byProduct : cqa;
    if (microbiologyOnly) {
      list = list.filter((p) => {
        const name = normalizeParameter(p).parameterName.toLowerCase();
        return name.includes('sterility') || name.includes('endotoxin');
      });
    }
    if (testStage) {
      const explicitStage = testStage;
      list = list.filter((p) => {
        const n = normalizeParameter(p);
        return parameterMatchesCqaTestStage(
          n.parameterName,
          testStage,
          n.processStage,
          explicitStage,
        );
      });
    }
    return list;
  } catch {
    return [];
  }
}

export async function fetchCqaBatchesForProduct(productName: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) => b.productName === productName || b.productCode === productName);
}

export async function createCqaResult(
  data: CqaResultFormData,
  _actor: CqaActor,
  autoOos = true,
): Promise<{ result: CqaResultRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for CQA entry.' };
    }
    const batches = await fetchCqaBatchesForProduct(data.productName);
    const batchMatch = batches.find((b) => b.batchNumber === data.batchNumber);
    if (batches.length && !batchMatch) return { result: null, error: 'Batch does not belong to selected product.' };
    if (batchMatch && ['Cancelled', 'Closed', 'Rejected', 'Archived'].includes(batchMatch.batchStatus)) {
      return { result: null, error: 'Closed, rejected, or archived batch — entry not allowed.' };
    }

    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminCqaResult',
    );
    const result = await fn({ ...data, autoOos, changeReason: data.changeReason });
    return { result: normalizeCqaResult(result.data), error: null };
  } catch (e) {
    console.error('createCqaResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create CQA result.') };
  }
}

export async function updateCqaResult(
  id: string,
  data: Partial<CqaResultFormData>,
  _actor: CqaActor,
  existing: CqaResultRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: CqaResultRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved CQA result is locked. QA override required.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminCqaResult',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { result: normalizeCqaResult(result.data), error: null };
  } catch (e) {
    console.error('updateCqaResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update CQA result.') };
  }
}

export async function reviewCqaResult(
  id: string,
  _actor: CqaActor,
  _existing: CqaResultRecord,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminCqaResult',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeCqaResult(result.data), error: null };
  } catch (e) {
    console.error('reviewCqaResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveCqaResult(
  id: string,
  _actor: CqaActor,
  _existing: CqaResultRecord,
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
      'approveAdminCqaResult',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeCqaResult(result.data), error: null };
  } catch (e) {
    console.error('approveCqaResult failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve CQA result.') };
  }
}

export async function bulkCreateCqaResults(
  rows: CqaResultFormData[],
  _actor: CqaActor,
  changeReason = 'Bulk CQA entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminCqaResults',
    );
    const result = await fn({ rows, changeReason });
    return result.data;
  } catch (e) {
    console.error('bulkCreateCqaResults failed', e);
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

export async function fetchCqaAuditTrail(recordId: string) {
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

export async function logCqaExport(actor: CqaActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCqaExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logCqaExport CF failed (non-blocking)', e);
  }
}

export function parameterTrendData(results: CqaResultRecord[], parameterName: string) {
  return results
    .filter((r) => r.parameterName === parameterName)
    .sort((a, b) => a.testDate.localeCompare(b.testDate))
    .map((r) => ({
      label: r.batchNumber,
      observed: Number(r.observedResult),
      target: r.targetValue,
      lsl: r.lowerLimit,
      usl: r.upperLimit,
      date: r.testDate,
    }));
}

export function buildCqaExportRows(results: CqaResultRecord[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = [
    'CQA Result ID', 'Product Code', 'Product', 'Batch', 'Test Stage',
    'Parameter Code', 'Parameter', 'Observed', 'Target', 'LSL', 'USL', 'UCL', 'LCL',
    'Unit', 'Status', 'Risk', 'Review Status', 'Spec No', 'STP', 'Analyst',
    'Test Date', 'Site', 'OOS Ref', 'Deviation', 'CAPA Required',
  ];
  const rows = results.map((r) => [
    r.cqaResultId,
    r.productCode,
    r.productName,
    r.batchNumber,
    r.testStage,
    r.parameterCode,
    r.parameterName,
    r.observedResult,
    r.targetValue ?? '',
    r.lowerLimit,
    r.upperLimit,
    r.ucl ?? '',
    r.lcl ?? '',
    r.unit,
    r.status,
    r.riskLevel,
    r.reviewStatus,
    r.specificationNumber || '',
    r.stpNumber || '',
    r.analyst,
    r.testDate,
    r.site || '',
    r.linkedOosNumber || '',
    r.linkedDeviationNumber || '',
    r.capaRequired ? 'Yes' : 'No',
  ]);
  return { headers, rows };
}

/** @deprecated Module name retained for callers */
export const CQA_MODULE = CQA_MODULE_NAME;
