import { z } from 'zod';
import { RESULT_TYPES } from '@/lib/admin/constants';

export const UTILITY_MONITORING_COLLECTION = 'utility_monitoring';
export const UTILITY_LEGACY_COLLECTIONS = ['cpv_utility_monitoring', 'cpv_utility'] as const;
export const UTILITY_MASTER_COLLECTION = 'utility_master';
export const UTILITY_MODULE_NAME = 'Utility Monitoring';

export const UTILITY_TYPES = [
  'Purified Water',
  'Water for Injection',
  'Clean Steam',
  'Compressed Air',
  'Nitrogen',
  'HVAC',
  'Chilled Water',
  'Cooling Water',
  'Vacuum',
  'Electricity',
  'Gas',
  'Temperature',
  'Humidity',
  'Differential Pressure',
  'Boiler Steam',
  'Other',
] as const;

export const UTILITY_STATUSES = ['Complies', 'Alert', 'Action', 'Excursion', 'OOS', 'OOT'] as const;
export const UTILITY_REVIEW_STATUSES = ['Draft', 'Under Review', 'Approved'] as const;
export const UTILITY_DATA_SOURCES = ['Manual', 'IoT', 'PLC', 'SCADA', 'OPC-UA', 'MQTT'] as const;

export const DEFAULT_UTILITY_PARAMETERS = [
  'WFI Conductivity', 'WFI TOC', 'WFI Microbial Count', 'WFI Endotoxin', 'WFI Temperature',
  'Purified Water Conductivity', 'Purified Water TOC', 'Purified Water Microbial Count',
  'Compressed Air Pressure', 'Compressed Air Dew Point', 'Compressed Air Oil Content', 'Compressed Air Particle Count',
  'Nitrogen Pressure', 'Nitrogen Purity',
  'Clean Steam Pressure', 'Clean Steam Temperature',
  'HVAC Temperature', 'HVAC Relative Humidity', 'Differential Pressure', 'Air Changes Per Hour',
] as const;

const requiredText = z.string().trim().min(1, 'Required');
const optionalNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().optional(),
);

export const utilityMonitoringFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  batchNumber: requiredText,
  utilityType: z.enum(UTILITY_TYPES),
  utilitySystemName: requiredText,
  utilitySystemCode: z.string().trim().default(''),
  samplingPoint: requiredText,
  areaRoomNo: z.string().trim().default(''),
  building: z.string().trim().default(''),
  site: z.string().trim().default(''),
  department: z.string().trim().default(''),
  shift: z.string().trim().default(''),
  productionLine: z.string().trim().default(''),
  equipmentId: z.string().trim().default(''),
  equipmentName: z.string().trim().default(''),
  dataSource: z.enum(UTILITY_DATA_SOURCES).default('Manual'),
  sensorId: z.string().trim().default(''),
  alarmStatus: z.string().trim().default(''),
  communicationStatus: z.string().trim().default('OK'),
  parameterId: z.string().trim().default(''),
  parameterCode: requiredText,
  parameterName: requiredText,
  observedValue: z.union([z.coerce.number(), z.string().trim().min(1, 'Required')]),
  targetValue: optionalNum,
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  alertLimitLow: optionalNum,
  alertLimitHigh: optionalNum,
  actionLimitLow: optionalNum,
  actionLimitHigh: optionalNum,
  unit: requiredText,
  resultType: z.enum(RESULT_TYPES).default('Numeric'),
  monitoringDate: requiredText,
  monitoringTime: requiredText,
  recordedBy: requiredText,
  reviewedBy: z.string().trim().default(''),
  reviewDate: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  utilityCriticality: z.string().trim().default('Major'),
  autoDeviationRequired: z.boolean().default(true),
  specificationNumber: z.string().trim().default(''),
  version: z.string().trim().default('1.0'),
  effectiveDate: z.string().trim().default(''),
  description: z.string().trim().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => d.lowerLimit < d.upperLimit, {
  message: 'Upper limit must be greater than lower limit',
  path: ['upperLimit'],
});

export type UtilityMonitoringFormData = z.infer<typeof utilityMonitoringFormSchema>;

export type UtilityMonitoringSaveData = UtilityMonitoringFormData;

export interface UtilityMonitoringRecord extends UtilityMonitoringFormData, Record<string, unknown> {
  id: string;
  utilityMonitoringId: string;
  status: typeof UTILITY_STATUSES[number] | string;
  riskLevel: string;
  deviationRequired: boolean;
  linkedDeviationNumber: string;
  capaRequired: boolean;
  linkedCapaNumber: string;
  reviewStatus: typeof UTILITY_REVIEW_STATUSES[number];
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
  oosRequired?: boolean;
  linkedOosNumber?: string;
}

export interface UtilitySummary {
  total: number;
  compliant: number;
  alert: number;
  action: number;
  excursion: number;
  criticalExcursions: number;
  deviationTriggered: number;
  capaSuggested: number;
  wfiAlerts: number;
  hvacAlerts: number;
}

export function buildUtilityMonitoringId(
  batchNumber: string,
  parameterCode: string,
  samplingPoint: string,
): string {
  return `UT-${batchNumber}-${parameterCode}-${samplingPoint}`.replace(/\s+/g, '-').toUpperCase();
}

export function evaluateUtilityStatus(
  observed: number | string,
  lsl: number,
  usl: number,
  resultType: string,
  alertLow?: number,
  alertHigh?: number,
  actionLow?: number,
  actionHigh?: number,
): string {
  if (resultType === 'Pass/Fail') {
    const v = String(observed).toLowerCase();
    return v === 'pass' ? 'Complies' : 'OOS';
  }
  if (resultType === 'Complies/Does Not Comply') {
    const v = String(observed).toLowerCase();
    return v.includes('comply') && !v.includes('not') ? 'Complies' : 'OOS';
  }
  const num = Number(observed);
  if (!Number.isFinite(num)) return 'OOS';
  if (num < lsl || num > usl) return 'OOS';
  if (actionLow != null && Number.isFinite(actionLow) && num < actionLow) return 'Action';
  if (actionHigh != null && Number.isFinite(actionHigh) && num > actionHigh) return 'Action';
  if (alertLow != null && Number.isFinite(alertLow) && num < alertLow) return 'Alert';
  if (alertHigh != null && Number.isFinite(alertHigh) && num > alertHigh) return 'Alert';
  if (alertLow == null && alertHigh == null) {
    const range = usl - lsl;
    if (range > 0) {
      const bandLow = lsl + range * 0.1;
      const bandHigh = usl - range * 0.1;
      if (num < bandLow || num > bandHigh) return 'OOT';
    }
  }
  return 'Complies';
}

export function isCriticalUtilityType(utilityType: string): boolean {
  return ['Water for Injection', 'Clean Steam', 'HVAC', 'Purified Water'].includes(utilityType);
}

export function evaluateUtilityRisk(
  record: Pick<UtilityMonitoringRecord, 'utilityType' | 'parameterName' | 'status' | 'samplingPoint' | 'areaRoomNo' | 'utilityCriticality'> & {
    alarmStatus?: string;
    communicationStatus?: string;
  },
  failureCount: number,
): string {
  if (['Sensor Failure', 'Communication Failure', 'PLC Failure'].includes(String(record.alarmStatus || ''))) {
    return 'Critical';
  }
  if (record.communicationStatus === 'Disconnected' || record.communicationStatus === 'Failed') {
    return 'High';
  }
  if (failureCount >= 3) return 'High';

  const param = record.parameterName.toLowerCase();
  const wfiType = record.utilityType === 'Water for Injection' || record.utilityType.includes('WFI');
  if (wfiType && (param.includes('microbial') || param.includes('endotoxin')) && ['OOS', 'Excursion'].includes(record.status)) {
    return 'Critical';
  }

  if (record.utilityType === 'Compressed Air'
    && (param.includes('oil') || param.includes('particle'))
    && ['OOS', 'Excursion', 'Action', 'Alert', 'OOT'].includes(record.status)) {
    return 'High';
  }

  const sterileHint = /grade\s*[ab]/i.test(record.areaRoomNo || '') || /grade\s*[ab]/i.test(record.samplingPoint || '');
  if (record.utilityType === 'HVAC'
    && (param.includes('differential pressure') || param.includes('pressure'))
    && ['OOS', 'Excursion'].includes(record.status)
    && sterileHint) {
    return 'Critical';
  }

  const critical = record.utilityCriticality === 'Critical' || isCriticalUtilityType(record.utilityType);
  if (critical && ['OOS', 'Excursion'].includes(record.status)) return 'High';

  if (['OOS', 'Excursion', 'Action'].includes(record.status)) return 'Medium';
  if (['Alert', 'OOT'].includes(record.status)) return 'Low';
  return 'Low';
}

export function summarizeUtilityRecords(records: UtilityMonitoringRecord[]): UtilitySummary {
  const nonCompliant = (s: string) => ['Alert', 'Action', 'Excursion', 'OOS', 'OOT'].includes(s);
  return {
    total: records.length,
    compliant: records.filter((r) => r.status === 'Complies').length,
    alert: records.filter((r) => r.status === 'Alert' || r.status === 'OOT').length,
    action: records.filter((r) => r.status === 'Action').length,
    excursion: records.filter((r) => r.status === 'Excursion' || r.status === 'OOS').length,
    criticalExcursions: records.filter((r) =>
      ['Excursion', 'OOS'].includes(r.status) && (r.riskLevel === 'Critical' || r.riskLevel === 'High'),
    ).length,
    deviationTriggered: records.filter((r) => r.deviationRequired || r.linkedDeviationNumber).length,
    capaSuggested: records.filter((r) => r.capaRequired).length,
    wfiAlerts: records.filter((r) => (r.utilityType === 'Water for Injection' || r.parameterName.startsWith('WFI')) && nonCompliant(r.status)).length,
    hvacAlerts: records.filter((r) => r.utilityType === 'HVAC' && nonCompliant(r.status)).length,
  };
}

export function buildUtilityChartSeries(records: UtilityMonitoringRecord[]) {
  const byMonth = new Map<string, { ok: number; total: number }>();
  records.forEach((r) => {
    const key = (r.monitoringDate || r.createdAt || '').slice(0, 7) || 'unknown';
    const e = byMonth.get(key) || { ok: 0, total: 0 };
    e.total += 1;
    if (r.status === 'Complies') e.ok += 1;
    byMonth.set(key, e);
  });
  const complianceTrend = Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, rate: v.total ? Math.round((v.ok / v.total) * 100) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const typeExcursion = new Map<string, number>();
  records.filter((r) => ['Excursion', 'OOS', 'Action'].includes(r.status)).forEach((r) => {
    typeExcursion.set(r.utilityType, (typeExcursion.get(r.utilityType) || 0) + 1);
  });
  const utilityTypeExcursionTrend = Array.from(typeExcursion.entries())
    .map(([type, count]) => ({ type, count }));

  const pointMap = new Map<string, number>();
  records.forEach((r) => pointMap.set(r.samplingPoint, (pointMap.get(r.samplingPoint) || 0) + 1));
  const samplingPointTrend = Array.from(pointMap.entries())
    .map(([point, count]) => ({ point, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const riskMap = new Map<string, number>();
  records.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  function paramTrend(paramMatch: string) {
    return records
      .filter((r) => r.parameterName.toLowerCase().includes(paramMatch.toLowerCase()))
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

  return {
    complianceTrend,
    utilityTypeExcursionTrend,
    samplingPointTrend,
    riskDistribution,
    wfiConductivityTrend: paramTrend('wfi conductivity'),
    wfiTocTrend: paramTrend('wfi toc'),
    compressedAirPressureTrend: paramTrend('compressed air pressure'),
    hvacTempRhTrend: records
      .filter((r) => r.parameterName.toLowerCase().includes('hvac temperature') || r.parameterName.toLowerCase().includes('relative humidity'))
      .map((r) => ({
        label: r.monitoringDate,
        observed: Number(r.observedValue),
        parameter: r.parameterName,
      })),
    differentialPressureTrend: paramTrend('differential pressure'),
  };
}

export function parametersForUtilityType(utilityType: string): readonly string[] {
  const map: Record<string, string[]> = {
    'Water for Injection': ['WFI Conductivity', 'WFI TOC', 'WFI Microbial Count', 'WFI Endotoxin', 'WFI Temperature'],
    'Purified Water': ['Purified Water Conductivity', 'Purified Water TOC', 'Purified Water Microbial Count'],
    'Compressed Air': ['Compressed Air Pressure', 'Compressed Air Dew Point', 'Compressed Air Oil Content', 'Compressed Air Particle Count'],
    'Nitrogen': ['Nitrogen Pressure', 'Nitrogen Purity'],
    'Clean Steam': ['Clean Steam Pressure', 'Clean Steam Temperature'],
    'HVAC': ['HVAC Temperature', 'HVAC Relative Humidity', 'Differential Pressure', 'Air Changes Per Hour'],
  };
  return map[utilityType] || DEFAULT_UTILITY_PARAMETERS.slice();
}
