/**
 * CPV Utility Monitoring — client service.
 * Reads: Firestore. Writes: Cloud Functions only.
 */
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
import { fetchCpvBatches } from '@/lib/cpv-batch-registration-service';
import { listCpvRecords } from '@/lib/cpv-service';
import { listEquipment } from '@/lib/equipment-mgmt-service';
import {
  UTILITY_MONITORING_COLLECTION,
  UTILITY_LEGACY_COLLECTIONS,
  UTILITY_MASTER_COLLECTION,
  buildUtilityMonitoringId,
  parametersForUtilityType,
  type UtilityMonitoringFormData,
  type UtilityMonitoringRecord,
} from '@/lib/cpv-utility-monitoring';

export interface UtilityActor {
  id: string;
  name: string;
  role?: string;
}

export interface UtilitySystemOption {
  id: string;
  code: string;
  name: string;
  utilityType: string;
  samplingPoints: string[];
  areaRoomNo: string;
  department: string;
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

export function normalizeUtilityRecord(raw: Record<string, unknown>): UtilityMonitoringRecord {
  const batchNumber = str(raw.batchNumber || raw.batchNo || raw.batch_number);
  const parameterCode = str(raw.parameterCode || raw.parameter_code, 'PARAM');
  const samplingPoint = str(raw.samplingPoint || raw.sampling_point);
  return {
    id: str(raw.id),
    utilityMonitoringId: str(
      raw.utilityMonitoringId || raw.utility_monitoring_id,
      buildUtilityMonitoringId(batchNumber, parameterCode, samplingPoint),
    ),
    cpvProductId: str(raw.cpvProductId || raw.cpv_product_id),
    productName: str(raw.productName || raw.product_name),
    productCode: str(raw.productCode || raw.product_code),
    batchNumber,
    utilityType: str(raw.utilityType || raw.utility_type, 'Other') as UtilityMonitoringRecord['utilityType'],
    utilitySystemName: str(raw.utilitySystemName || raw.utility_system_name || raw.utilitySystem),
    utilitySystemCode: str(raw.utilitySystemCode || raw.utility_system_code),
    samplingPoint,
    areaRoomNo: str(raw.areaRoomNo || raw.area_room_no || raw.area),
    building: str(raw.building),
    site: str(raw.site),
    department: str(raw.department),
    shift: str(raw.shift),
    productionLine: str(raw.productionLine || raw.production_line),
    equipmentId: str(raw.equipmentId || raw.equipment_id),
    equipmentName: str(raw.equipmentName || raw.equipment_name),
    dataSource: str(raw.dataSource || raw.data_source, 'Manual') as UtilityMonitoringRecord['dataSource'],
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
    resultType: (str(raw.resultType || raw.result_type, 'Numeric') as UtilityMonitoringRecord['resultType']),
    monitoringDate: str(raw.monitoringDate || raw.monitoring_date || raw.recordedDate),
    monitoringTime: str(raw.monitoringTime || raw.monitoring_time || '00:00'),
    recordedBy: str(raw.recordedBy || raw.recorded_by),
    reviewedBy: str(raw.reviewedBy || raw.reviewed_by),
    reviewDate: str(raw.reviewDate || raw.review_date),
    remarks: str(raw.remarks),
    utilityCriticality: str(raw.utilityCriticality || raw.criticality, 'Major'),
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
    reviewStatus: (str(raw.reviewStatus || raw.review_status, 'Draft') as UtilityMonitoringRecord['reviewStatus']),
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

export async function fetchUtilityRecords(max = 500): Promise<UtilityMonitoringRecord[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    let primary: UtilityMonitoringRecord[] = [];
    try {
      primary = await getRecords<UtilityMonitoringRecord>(
        UTILITY_MONITORING_COLLECTION,
        [orderBy('monitoringDate', 'desc'), limit(max)],
      );
    } catch {
      primary = await getRecords<UtilityMonitoringRecord>(UTILITY_MONITORING_COLLECTION, [limit(max)]);
    }
    const normalized = primary
      .map((r) => normalizeUtilityRecord(r as unknown as Record<string, unknown>))
      .filter((r) => !r.isDeleted);
    if (normalized.length) {
      return normalized.sort((a, b) => `${b.monitoringDate}${b.monitoringTime}`.localeCompare(`${a.monitoringDate}${a.monitoringTime}`));
    }
    for (const legacyName of UTILITY_LEGACY_COLLECTIONS) {
      const legacy = await listCpvRecords<Record<string, unknown>>(legacyName, max);
      if (legacy.length) {
        return legacy.map((r) => normalizeUtilityRecord(r)).filter((r) => !r.isDeleted);
      }
    }
    return [];
  } catch (e) {
    console.error('fetchUtilityRecords failed', e);
    return [];
  }
}

export async function fetchUtilityRecordById(id: string): Promise<UtilityMonitoringRecord | null> {
  const record = await getRecord<UtilityMonitoringRecord>(UTILITY_MONITORING_COLLECTION, id);
  if (record) {
    const normalized = normalizeUtilityRecord(record as unknown as Record<string, unknown>);
    return normalized.isDeleted ? null : normalized;
  }
  const all = await fetchUtilityRecords();
  return all.find((r) => r.id === id) ?? null;
}

export async function fetchUtilityBatchesForProduct(productName: string) {
  const batches = await fetchCpvBatches();
  return batches.filter((b) => b.productName === productName || b.productCode === productName);
}

export async function fetchUtilityParameters(utilityType?: string): Promise<Parameter[]> {
  try {
    const all = await fetchParameters();
    let params = all.filter((p) => {
      const n = normalizeParameter(p);
      return n.parameterType === 'Utility Parameter' && n.status === 'Active';
    });
    if (utilityType) {
      const names = parametersForUtilityType(utilityType);
      const filtered = params.filter((p) => names.some((n) => p.parameterName?.includes(n) || n.includes(p.parameterName || '')));
      if (filtered.length) params = filtered;
    }
    return params;
  } catch {
    return [];
  }
}

export async function fetchUtilitySystems(): Promise<UtilitySystemOption[]> {
  const systems: UtilitySystemOption[] = [];
  if (isFirebaseConfigured()) {
    try {
      const rows = await getRecords<Record<string, unknown>>(UTILITY_MASTER_COLLECTION, [limit(200)]);
      rows.forEach((r) => {
        systems.push({
          id: str(r.id),
          code: str(r.utility_system_code || r.systemCode || r.code, str(r.id)),
          name: str(r.utility_system_name || r.systemName || r.name),
          utilityType: str(r.utility_type || r.utilityType, 'Other'),
          samplingPoints: Array.isArray(r.sampling_points) ? r.sampling_points as string[] : [str(r.sampling_point, 'Main')],
          areaRoomNo: str(r.area_room_no || r.areaRoomNo),
          department: str(r.department, 'Utilities'),
        });
      });
    } catch { /* optional */ }
  }
  try {
    const equipment = await listEquipment({});
    equipment.filter((e) =>
      ['Utility Equipment', 'HVAC', 'Water System', 'Compressed Air System'].includes(e.equipment_type),
    ).forEach((e) => {
      systems.push({
        id: e.id,
        code: e.equipment_id,
        name: e.equipment_name,
        utilityType: e.equipment_type === 'HVAC' ? 'HVAC'
          : e.equipment_type === 'Water System' ? 'Purified Water'
            : e.equipment_type === 'Compressed Air System' ? 'Compressed Air'
              : 'Other',
        samplingPoints: [e.area_room_no || 'Main'],
        areaRoomNo: e.area_room_no,
        department: e.department,
      });
    });
  } catch { /* optional */ }
  if (!systems.length) {
    return [
      { id: 'wfi-loop', code: 'WFI-01', name: 'WFI Distribution Loop', utilityType: 'Water for Injection', samplingPoints: ['Loop Return', 'Storage Tank'], areaRoomNo: 'Utility Block', department: 'Utilities' },
      { id: 'pw-loop', code: 'PW-01', name: 'Purified Water Loop', utilityType: 'Purified Water', samplingPoints: ['Loop Return'], areaRoomNo: 'Utility Block', department: 'Utilities' },
      { id: 'ca-header', code: 'CA-01', name: 'Compressed Air Header', utilityType: 'Compressed Air', samplingPoints: ['Production Header', 'Filling Room'], areaRoomNo: 'Production', department: 'Engineering' },
      { id: 'hvac-ahu', code: 'AHU-01', name: 'AHU Grade B Area', utilityType: 'HVAC', samplingPoints: ['Grade B Room', 'Grade A Room'], areaRoomNo: 'Grade B', department: 'Engineering' },
    ];
  }
  return systems;
}

export async function createUtilityRecord(
  data: UtilityMonitoringFormData,
  _actor: UtilityActor,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: UtilityMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    if (!data.changeReason || data.changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    const product = await fetchCpvProductById(data.cpvProductId);
    if (product && !isCpvProductOperational(product.cpvStatus)) {
      return { result: null, error: 'Selected CPV product is not operational for utility entry.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'createAdminUtilityRecord',
    );
    const result = await fn({
      ...data,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
      changeReason: data.changeReason,
    });
    return { result: normalizeUtilityRecord(result.data), error: null };
  } catch (e) {
    console.error('createUtilityRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to create utility record.') };
  }
}

export async function updateUtilityRecord(
  id: string,
  data: Partial<UtilityMonitoringFormData>,
  _actor: UtilityActor,
  existing: UtilityMonitoringRecord,
  qaOverride = false,
  options?: { esignConfirmed?: boolean },
): Promise<{ result: UtilityMonitoringRecord | null; error: string | null }> {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const changeReason = data.changeReason || existing.changeReason || '';
    if (!changeReason || changeReason.trim().length < 5) {
      return { result: null, error: 'Change reason (min 5 characters) is required.' };
    }
    if (existing.isLocked && existing.reviewStatus === 'Approved' && !qaOverride) {
      return { result: null, error: 'Approved utility record is locked. QA override required.' };
    }
    if (qaOverride && options?.esignConfirmed !== true) {
      return { result: null, error: 'Electronic signature confirmation required for QA override.' };
    }
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'updateAdminUtilityRecord',
    );
    const result = await fn({
      ...existing,
      ...data,
      id,
      changeReason,
      qaOverride,
      esignConfirmed: options?.esignConfirmed === true,
    });
    return { result: normalizeUtilityRecord(result.data), error: null };
  } catch (e) {
    console.error('updateUtilityRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to update utility record.') };
  }
}

export async function reviewUtilityRecord(
  id: string,
  _actor: UtilityActor,
  changeReason = 'Submitted for QA review',
) {
  if (!isFirebaseConfigured()) return { result: null, error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable<Record<string, unknown>, Record<string, unknown>>(
      getFirebaseFunctions(),
      'reviewAdminUtilityRecord',
    );
    const result = await fn({ id, changeReason });
    return { result: normalizeUtilityRecord(result.data), error: null };
  } catch (e) {
    console.error('reviewUtilityRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to submit review.') };
  }
}

export async function approveUtilityRecord(
  id: string,
  _actor: UtilityActor,
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
      'approveAdminUtilityRecord',
    );
    const result = await fn({ id, changeReason, esignConfirmed: true });
    return { result: normalizeUtilityRecord(result.data), error: null };
  } catch (e) {
    console.error('approveUtilityRecord failed', e);
    return { result: null, error: cfErrorMessage(e, 'Failed to approve utility record.') };
  }
}

export async function softDeleteUtilityRecord(
  id: string,
  _actor: UtilityActor,
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
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminUtilityRecord');
    await fn({ id, changeReason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    console.error('softDeleteUtilityRecord failed', e);
    return { error: cfErrorMessage(e, 'Failed to soft-delete utility record.') };
  }
}

export async function bulkCreateUtilityRecords(
  rows: UtilityMonitoringFormData[],
  _actor: UtilityActor,
  changeReason = 'Bulk utility entry',
): Promise<{ created: number; errors: string[] }> {
  if (!isFirebaseConfigured()) return { created: 0, errors: ['Firebase is not configured.'] };
  try {
    if (!changeReason || changeReason.trim().length < 5) {
      return { created: 0, errors: ['Change reason (min 5 characters) is required.'] };
    }
    const fn = httpsCallable<Record<string, unknown>, { created: number; errors: string[] }>(
      getFirebaseFunctions(),
      'bulkCreateAdminUtilityRecords',
    );
    const result = await fn({ rows, changeReason });
    return result.data;
  } catch (e) {
    console.error('bulkCreateUtilityRecords failed', e);
    return { created: 0, errors: [cfErrorMessage(e, 'Bulk create failed.')] };
  }
}

export async function fetchUtilityAuditTrail(recordId: string) {
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

export async function logUtilityExport(actor: UtilityActor, count: number) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminUtilityExport');
    await fn({ count, format: 'CSV', changeReason: `Export by ${actor.name}` });
  } catch (e) {
    console.warn('logUtilityExport CF failed (non-blocking)', e);
  }
}

export function utilityParameterTrendData(
  records: UtilityMonitoringRecord[],
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

export function buildUtilityExportRows(records: UtilityMonitoringRecord[]): {
  headers: string[];
  rows: (string | number)[][];
} {
  const headers = [
    'Utility ID', 'Product Code', 'Product', 'Batch', 'Utility Type', 'System', 'Sampling Point',
    'Parameter', 'Observed', 'Target', 'LSL', 'USL', 'Alert Low', 'Alert High', 'Action Low', 'Action High',
    'Unit', 'Status', 'Risk', 'Review Status', 'Building', 'Area/Room', 'Department', 'Shift',
    'Data Source', 'Sensor ID', 'Alarm', 'Monitoring Date', 'Deviation', 'CAPA', 'OOS',
  ];
  const rows = records.map((r) => [
    r.utilityMonitoringId,
    r.productCode,
    r.productName,
    r.batchNumber,
    r.utilityType,
    r.utilitySystemName,
    r.samplingPoint,
    r.parameterName,
    r.observedValue,
    r.targetValue ?? '',
    r.lowerLimit,
    r.upperLimit,
    r.alertLimitLow ?? '',
    r.alertLimitHigh ?? '',
    r.actionLimitLow ?? '',
    r.actionLimitHigh ?? '',
    r.unit,
    r.status,
    r.riskLevel,
    r.reviewStatus,
    r.building || '',
    r.areaRoomNo || '',
    r.department || '',
    r.shift || '',
    r.dataSource || 'Manual',
    r.sensorId || '',
    r.alarmStatus || '',
    `${r.monitoringDate} ${r.monitoringTime}`,
    r.linkedDeviationNumber || '',
    r.linkedCapaNumber || '',
    r.linkedOosNumber || (r.oosRequired ? 'Yes' : ''),
  ]);
  return { headers, rows };
}
