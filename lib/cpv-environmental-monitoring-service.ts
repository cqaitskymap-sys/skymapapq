/**
 * CPV Environmental Monitoring — client service.
 * Reads: Firestore. Writes: Cloud Functions only.
 */
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
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { CPV_COLLECTIONS } from '@/lib/cpv';
import { listAreas } from '@/lib/monitoring-mgmt-service';
import type { AreaRecord } from '@/lib/monitoring-mgmt-types';
import {
  ENVIRONMENTAL_MONITORING_COLLECTION,
  ENVIRONMENTAL_LEGACY_COLLECTIONS,
  buildEnvironmentalMonitoringId,
  parametersForMonitoringType,
  type EnvironmentalMonitoringFormData,
  type EnvironmentalMonitoringRecord,
} from '@/lib/cpv-environmental-monitoring';

export interface EnvironmentalActor {
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

export function normalizeEnvironmentalRecord(raw: Record<string, unknown>): EnvironmentalMonitoringRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  const areaName = str(raw.areaName || raw.area_name);
  return {
    id: str(raw.id),
    environmentalMonitoringId: str(
      raw.environmentalMonitoringId || raw.environmental_monitoring_id,
      buildEnvironmentalMonitoringId(batchNumber, parameterCode, areaName),
    ),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    batchNumber,
    areaName,
    areaId: str(raw.areaId || raw.area_doc_id || raw.area_id),
    roomNumber: str(raw.roomNumber || raw.room_number),
    cleanroomGrade: str(raw.cleanroomGrade || raw.cleanroom_grade, 'Unclassified') as EnvironmentalMonitoringRecord['cleanroomGrade'],
    isoClass: str(raw.isoClass || raw.iso_class, 'N/A') as EnvironmentalMonitoringRecord['isoClass'],
    processStage: str(raw.processStage || raw.process_stage, 'General Monitoring') as EnvironmentalMonitoringRecord['processStage'],
    monitoringType: str(raw.monitoringType || raw.monitoring_type, 'Temperature') as EnvironmentalMonitoringRecord['monitoringType'],
    samplingLocation: str(raw.samplingLocation || raw.sampling_location),
    monitoringPointCode: str(raw.monitoringPointCode || raw.monitoring_point_code),
    monitoringPointName: str(raw.monitoringPointName || raw.monitoring_point_name),
    building: str(raw.building),
    block: str(raw.block),
    floor: str(raw.floor),
    site: str(raw.site),
    department: str(raw.department),
    shift: str(raw.shift),
    zone: str(raw.zone),
    ahuId: str(raw.ahuId || raw.ahu_id),
    ahuName: str(raw.ahuName || raw.ahu_name),
    equipmentId: str(raw.equipmentId || raw.equipment_id),
    equipmentName: str(raw.equipmentName || raw.equipment_name),
    dataSource: str(raw.dataSource || raw.data_source, 'Manual') as EnvironmentalMonitoringRecord['dataSource'],
    sensorId: str(raw.sensorId || raw.sensor_id),
    alarmStatus: str(raw.alarmStatus || raw.alarm_status),
    communicationStatus: str(raw.communicationStatus || raw.communication_status, 'OK'),
    parameterId: str(raw.parameterId || raw.parameter_id),
    parameterCode,
    parameterName: str(raw.parameterName || raw.parameter_name),
    observedValue: observedVal(raw.observedValue ?? raw.observed_value),
    targetValue: optionalNum(raw.targetValue ?? raw.target_value ?? raw.target),
    lowerLimit: num(raw.lowerLimit ?? raw.lower_limit ?? raw.lsl),
    upperLimit: num(raw.upperLimit ?? raw.upper_limit ?? raw.usl),
    alertLimitLow: optionalNum(raw.alertLimitLow ?? raw.alert_limit_low),
    alertLimitHigh: optionalNum(raw.alertLimitHigh ?? raw.alert_limit_high),
    actionLimitLow: optionalNum(raw.actionLimitLow ?? raw.action_limit_low),
    actionLimitHigh: optionalNum(raw.actionLimitHigh ?? raw.action_limit_high),
    unit: str(raw.unit),
    resultType: (str(raw.resultType || raw.result_type, 'Numeric') as EnvironmentalMonitoringRecord['resultType']),
    monitoringDate: str(raw.monitoringDate || raw.monitoring_date),
    monitoringTime: str(raw.monitoringTime || raw.monitoring_time || '00:00'),
    recordedBy: str(raw.recordedBy || raw.recorded_by),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    remarks: str(raw.remarks),
    autoDeviationRequired: Boolean(raw.autoDeviationRequired ?? raw.auto_deviation_required ?? true),
    specificationNumber: str(raw.specificationNumber || raw.specification_number),
    version: str(raw.version, '1.0'),
    effectiveDate: str(raw.effectiveDate || raw.effective_date),
    description: str(raw.description),
    changeReason: str(raw.changeReason || raw.change_reason),
    status: str(raw.status, 'Complies'),
    riskLevel: str(raw.riskLevel || raw.risk_level, 'Low'),
    deviationRequired: Boolean(raw.deviationRequired || raw.deviation_required),
    linkedDeviationNumber: str(raw.linkedDeviationNumber || raw.linked_deviation_number),
    capaRequired: Boolean(raw.capaRequired || raw.capa_required),
    linkedCapaNumber: str(raw.linkedCapaNumber || raw.linked_capa_number),
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as EnvironmentalMonitoringRecord['reviewStatus']),
    isLocked: Boolean(raw.isLocked || raw.is_locked),
    oosRequired: Boolean(raw.oosRequired || raw.oos_required),
    linkedOosNumber: str(raw.linkedOosNumber || raw.linked_oos_number),
    createdAt: str(raw.createdAt || raw.created_at),
    updatedAt: str(raw.updatedAt || raw.updated_at),
    createdBy: str(raw.createdBy || raw.created_by),
    updatedBy: str(raw.updatedBy || raw.updated_by),
    createdByName: str(raw.createdByName),
    updatedByName: str(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export async function fetchEnvironmentalRecords(max = 500): Promise<EnvironmentalMonitoringRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: EnvironmentalMonitoringRecord[] = [];
    try {
      primary = await getRecords<EnvironmentalMonitoringRecord>(
        ENVIRONMENTAL_MONITORING_COLLECTION,
        [orderBy('monitoringDate', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<EnvironmentalMonitoringRecord>(ENVIRONMENTAL_MONITORING_COLLECTION, [limit(max)]);
    }
    const normalized = primary
      .map((r) => normalizeEnvironmentalRecord(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) {
      return normalized.sort((a, b) => `${b.monitoringDate}${b.monitoringTime}`.localeCompare(`${a.monitoringDate}${a.monitoringTime}`));
    }
    for (const legacyName of ENVIRONMENTAL_LEGACY_COLLECTIONS) {
      const legacy = await listCpvRecords<Record<string, unknown>>(legacyName, max);
      if (legacy.length) {
        return legacy
          .map((r) => normalizeEnvironmentalRecord(r))
          .filter((r) => !r.isDeleted);
      }
    }
    const cpvLegacy = await listCpvRecords<Record<string, unknown>>(CPV_COLLECTIONS.environment, max);
    if (cpvLegacy.length) {
      return cpvLegacy
        .map((r) => normalizeEnvironmentalRecord(r))
        .filter((r) => !r.isDeleted);
    }
    return [];
  } catch (e) {
    console.error('fetchEnvironmentalRecords failed', e);
    return [];
  }
}

export async function fetchEnvironmentalRecordById(id: string): Promise<EnvironmentalMonitoringRecord | null> {
  const record = await getRecord<EnvironmentalMonitoringRecord>(ENVIRONMENTAL_MONITORING_COLLECTION, id);
  if (record) {
    const normalized = normalizeEnvironmentalRecord(record as unknown as Record<string, unknown>);
    return normalized.isDeleted ? null : normalized;
  }
  const all = await fetchEnvironmentalRecords();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchEmBatchesForProduct(productName: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) => b.productName === productName || b.productCode === productName);
}

export async function fetchEnvironmentalParameters(monitoringType?: string): Promise<Parameter[]> {
  try {
    const all = await fetchParameters();
    let params = all.filter((p) => {
      const n = normalizeParameter(p);
      return n.parameterType === 'Environmental Parameter' && n.status === 'Active';
    });
    if (monitoringType) {
      const names = parametersForMonitoringType(monitoringType);
      const filtered = params.filter((p) => names.some((n) => p.parameterName?.includes(n) || n.includes(p.parameterName || '')));
      if (filtered.length) params = filtered;
    }
    return params;
  } catch {
    return [];
  }
}

export async function fetchAreaOptions(): Promise<AreaRecord[]> {
  try {
    const areas = await listAreas({ area_status: 'Active' });
    if (areas.length) return areas;
  } catch { /* optional */ }
  return [
    {
      id: 'grade-a-filling',
      area_code: 'GA-FILL',
      area_name: 'Grade A Filling Room',
      department: 'Production',
      room_number: 'FILL-01',
      cleanroom_grade: 'Grade A',
      process_area: 'Filling',
      monitoring_required: true,
      temperature_limit_lower: 18,
      temperature_limit_upper: 22,
      rh_limit_lower: 45,
      rh_limit_upper: 55,
      dp_limit_lower: 10,
      dp_limit_upper: 20,
      area_status: 'Active',
      remarks: '',
      created_by: 'system',
      created_by_name: 'System',
      updated_by: 'system',
      updated_by_name: 'System',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'grade-b-prep',
      area_code: 'GB-PREP',
      area_name: 'Grade B Preparation',
      department: 'Production',
      room_number: 'PREP-02',
      cleanroom_grade: 'Grade B',
      process_area: 'Preparation',
      monitoring_required: true,
      temperature_limit_lower: 18,
      temperature_limit_upper: 22,
      rh_limit_lower: 45,
      rh_limit_upper: 55,
      dp_limit_lower: 10,
      dp_limit_upper: 20,
      area_status: 'Active',
      remarks: '',
      created_by: 'system',
      created_by_name: 'System',
      updated_by: 'system',
      updated_by_name: 'System',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
}

export async function createEnvironmentalRecord(
  data: EnvironmentalMonitoringFormData,
  _actor: EnvironmentalActor,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: EnvironmentalMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for environmental entry.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminEnvironmentalRecord',
    );
    const result = await fn({
      ...data,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      changeReason: data.changeReason,
    });
    return { result: normalizeEnvironmentalRecord(result.data), error: null };
  } catch (e) {
    console.error('createEnvironmentalRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create environmental record.') };
  }
}

export async function updateEnvironmentalRecord(
  id: string,
  data: Partial<EnvironmentalMonitoringFormData>,
  _actor: EnvironmentalActor,
  existing: EnvironmentalMonitoringRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: EnvironmentalMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved environmental record is locked. QA override required.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminEnvironmentalRecord',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { result: normalizeEnvironmentalRecord(result.data), error: null };
  } catch (e) {
    console.error('updateEnvironmentalRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update environmental record.') };
  }
}

export async function reviewEnvironmentalRecord(
  id: string,
  _actor: EnvironmentalActor,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminEnvironmentalRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeEnvironmentalRecord(result.data), error: null };
  } catch (e) {
    console.error('reviewEnvironmentalRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveEnvironmentalRecord(
  id: string,
  _actor: EnvironmentalActor,
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
      'approveAdminEnvironmentalRecord',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeEnvironmentalRecord(result.data), error: null };
  } catch (e) {
    console.error('approveEnvironmentalRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve environmental record.') };
  }
}

export async function softDeleteEnvironmentalRecord(
  id: string,
  _actor: EnvironmentalActor,
  changeReason: string,
  options?: { esignConfirmed?: boolean },
): Promise<{ error: string | null }> {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { error: 'Change reason (min 5 characters) is required.' };
    }
    if (options?.esignConfirmed !== true) {
      return { error: 'Electronic signature confirmation required.' };
    }
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminEnvironmentalRecord');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    console.error('softDeleteEnvironmentalRecord failed', e);
    return { error: cfErrorMessage(e, 'Failed to soft-delete environmental record.') };
  }
}

export async function bulkCreateEnvironmentalRecords(
  rows: EnvironmentalMonitoringFormData[],
  _actor: EnvironmentalActor,
  changeReason = 'Bulk environmental entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { created: 0, errors: ['Change reason (min 5 characters) is required.'] };
    }
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminEnvironmentalRecords',
    );
    const result = await fn({ rows, changeReason });
    return result.data;
  } catch (e) {
    console.error('bulkCreateEnvironmentalRecords failed', e);
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function fetchEnvironmentalAuditTrail(recordId: string) {
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

export async function logEnvironmentalExport(actor: EnvironmentalActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminEnvironmentalExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logEnvironmentalExport CF failed (non-blocking)', e);
  }
}

export function environmentalParameterTrendData(
  records: EnvironmentalMonitoringRecord[],
  parameterName: string,
) {
  return records
    .filter((r) => r.parameterName === parameterName || r.parameterName.toLowerCase().includes(parameterName.toLowerCase()))
    .sort((a, b) => `${a.monitoringDate}${a.monitoringTime}`.localeCompare(`${b.monitoringDate}${b.monitoringTime}`))
    .map((r) => ({
      label: r.batchNumber,
      observed: Number(r.observedValue),
      target: r.targetValue,
      lsl: r.lowerLimit,
      usl: r.upperLimit,
      date: r.monitoringDate,
    }));
}
