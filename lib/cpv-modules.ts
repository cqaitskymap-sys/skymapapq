import { z } from 'zod';
import { classifySpecification, deviationPercent, type CpvStatus } from '@/lib/cpv';

const requiredText = z.string().trim().min(1, 'Required');
const finiteNumber = z.coerce.number().finite();
const optionalText = z.string().trim().optional().default('');

/** Firestore collection names aligned with GMP CPV data model */
export const CPV_MODULE_COLLECTIONS = {
  batches: 'cpv_batches',
  rawMaterials: 'cpv_raw_materials',
  packingMaterials: 'cpv_packing_materials',
  utilityMonitoring: 'cpv_utility_monitoring',
  environment: 'cpv_environment_monitoring',
  yieldMonitoring: 'cpv_yield_monitoring',
  stability: 'cpv_stability_studies',
  holdTime: 'cpv_hold_time',
  alerts: 'cpv_alerts',
} as const satisfies Partial<Record<string, string>>;

export const BATCH_STATUSES = ['Open', 'Under Review', 'Approved', 'Rejected'] as const;
export const SHIFTS = ['A', 'B', 'C'] as const;
export const STABILITY_CONDITIONS = ['25°C / 60% RH', '30°C / 75% RH', '40°C / 75% RH'] as const;
export const STABILITY_TIMEPOINTS = ['0 Month', '3 Month', '6 Month', '9 Month', '12 Month', '18 Month', '24 Month'] as const;
export const YIELD_STAGES = ['Bulk Yield', 'Filling Yield', 'Packing Yield'] as const;
export const UTILITY_TYPES = ['Purified Water', 'WFI', 'Compressed Air', 'Nitrogen', 'Steam'] as const;
export const UTILITY_PARAMS = ['Conductivity', 'TOC', 'Microbial Count', 'Pressure', 'Temperature'] as const;
export const EM_GRADES = ['A', 'B', 'C', 'D'] as const;
export const PACKING_TYPES = ['Vial', 'Ampoule', 'Rubber Stopper', 'Flip Off Seal', 'Carton', 'Label'] as const;
export const ALERT_TYPES = ['Limit Exceeded', 'Cpk Low', 'Trend Deteriorating', 'OOT', 'Risk High'] as const;
export const ALERT_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

export const batchSchema = z.object({
  batchNumber: requiredText,
  productName: requiredText,
  productCode: optionalText,
  manufacturingDate: requiredText,
  expiryDate: requiredText,
  batchSize: requiredText,
  market: optionalText,
  shift: z.enum(SHIFTS).default('A'),
  manufacturingLine: optionalText,
  bmrNumber: optionalText,
  status: z.enum(BATCH_STATUSES).default('Open'),
  recordedBy: requiredText,
  reviewedBy: optionalText,
  approvedBy: optionalText,
});

export const rawMaterialSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  apiName: requiredText,
  vendor: requiredText,
  grnNo: requiredText,
  arNo: requiredText,
  coaNumber: optionalText,
  assay: finiteNumber,
  impurity: finiteNumber,
  waterContent: finiteNumber,
  particleSize: optionalText,
  lsl: finiteNumber.default(95),
  usl: finiteNumber.default(105),
  recordedBy: requiredText,
});

export const packingMaterialSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  materialType: z.enum(PACKING_TYPES),
  vendor: requiredText,
  grnNo: requiredText,
  arNo: requiredText,
  testResult: requiredText,
  status: z.enum(['Pass', 'Fail', 'Pending']).default('Pass'),
  recordedBy: requiredText,
});

export const utilityMonitoringSchema = z.object({
  utilityType: z.enum(UTILITY_TYPES),
  parameterName: z.enum(UTILITY_PARAMS),
  observedValue: finiteNumber,
  lsl: finiteNumber,
  usl: finiteNumber,
  unit: requiredText,
  recordedDate: requiredText,
  recordedBy: requiredText,
  batchNo: optionalText,
  productName: optionalText,
});

export const environmentSchema = z.object({
  area: requiredText,
  grade: z.enum(EM_GRADES),
  recordedDate: requiredText,
  temperature: finiteNumber,
  humidity: finiteNumber,
  differentialPressure: finiteNumber,
  viableCountAir: finiteNumber.min(0),
  viableCountSettle: finiteNumber.min(0),
  viableCountContact: finiteNumber.min(0),
  tempLsl: finiteNumber.default(18),
  tempUsl: finiteNumber.default(25),
  humidityLsl: finiteNumber.default(30),
  humidityUsl: finiteNumber.default(65),
  recordedBy: requiredText,
});

export const yieldMonitoringSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  stage: z.enum(YIELD_STAGES),
  expectedYield: finiteNumber.min(0),
  actualYield: finiteNumber.min(0),
  recordedBy: requiredText,
  manufacturingDate: optionalText,
});

export const stabilitySchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  condition: z.enum(STABILITY_CONDITIONS),
  timePoint: z.enum(STABILITY_TIMEPOINTS),
  parameterName: z.enum(['Assay', 'pH', 'Related Substance', 'Endotoxin']),
  observedValue: finiteNumber,
  lsl: finiteNumber,
  usl: finiteNumber,
  unit: requiredText,
  recordedBy: requiredText,
  testDate: requiredText,
});

export const holdTimeSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  stage: requiredText,
  allowedTime: finiteNumber.min(0),
  actualTime: finiteNumber.min(0),
  unit: z.string().trim().default('hr'),
  recordedBy: requiredText,
  manufacturingDate: optionalText,
});

export type BatchInput = z.infer<typeof batchSchema>;
export type RawMaterialInput = z.infer<typeof rawMaterialSchema>;
export type PackingMaterialInput = z.infer<typeof packingMaterialSchema>;
export type UtilityMonitoringInput = z.infer<typeof utilityMonitoringSchema>;
export type EnvironmentInput = z.infer<typeof environmentSchema>;
export type YieldMonitoringInput = z.infer<typeof yieldMonitoringSchema>;
export type StabilityInput = z.infer<typeof stabilitySchema>;
export type HoldTimeInput = z.infer<typeof holdTimeSchema>;

export interface CpvModuleMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string;
  version: number;
}

export interface BatchRecord extends BatchInput, Partial<CpvModuleMeta> {}
export interface RawMaterialRecord extends RawMaterialInput, Partial<CpvModuleMeta> {
  status: CpvStatus;
  vendorScore: number;
}
export interface PackingMaterialRecord extends PackingMaterialInput, Partial<CpvModuleMeta> {}
export interface UtilityMonitoringRecord extends UtilityMonitoringInput, Partial<CpvModuleMeta> {
  status: CpvStatus;
}
export interface EnvironmentRecord extends EnvironmentInput, Partial<CpvModuleMeta> {
  status: CpvStatus;
}
export interface YieldMonitoringRecord extends YieldMonitoringInput, Partial<CpvModuleMeta> {
  yieldPercent: number;
  variancePercent: number;
  status: CpvStatus;
}
export interface StabilityRecord extends StabilityInput, Partial<CpvModuleMeta> {
  status: CpvStatus;
}
export interface HoldTimeRecord extends HoldTimeInput, Partial<CpvModuleMeta> {
  status: 'Pass' | 'Fail';
  variancePercent: number;
}

export interface CpvAlertRecord {
  id: string;
  alertType: (typeof ALERT_TYPES)[number];
  severity: (typeof ALERT_SEVERITIES)[number];
  module: string;
  productName: string;
  batchNo: string;
  parameterName: string;
  message: string;
  observedValue?: number;
  limit?: number;
  status: 'Open' | 'Acknowledged' | 'Closed';
  createdAt: string;
  recordId?: string;
}

export function calculateYieldMetrics(expected: number, actual: number) {
  const yieldPercent = expected === 0 ? 0 : Number(((actual / expected) * 100).toFixed(2));
  const variancePercent = expected === 0 ? 0 : Number((((actual - expected) / expected) * 100).toFixed(2));
  const status: CpvStatus = yieldPercent >= 95 ? 'Complies' : yieldPercent >= 90 ? 'OOT' : 'OOS';
  return { yieldPercent, variancePercent, status };
}

export function calculateHoldTimeStatus(allowed: number, actual: number): 'Pass' | 'Fail' {
  return actual <= allowed ? 'Pass' : 'Fail';
}

export function calculateVendorScore(records: RawMaterialRecord[], vendor: string): number {
  const vendorRecords = records.filter((r) => r.vendor === vendor);
  if (!vendorRecords.length) return 0;
  const passCount = vendorRecords.filter((r) => r.status === 'Complies').length;
  return Number(((passCount / vendorRecords.length) * 100).toFixed(1));
}

export function classifyEnvironment(input: EnvironmentInput): CpvStatus {
  const tempStatus = classifySpecification(input.temperature, (input.tempLsl + input.tempUsl) / 2, input.tempLsl, input.tempUsl);
  const humidityStatus = classifySpecification(input.humidity, (input.humidityLsl + input.humidityUsl) / 2, input.humidityLsl, input.humidityUsl);
  if (tempStatus === 'OOS' || humidityStatus === 'OOS') return 'OOS';
  if (tempStatus === 'OOT' || humidityStatus === 'OOT') return 'OOT';
  return 'Complies';
}

export function buildTrendPoints<T extends Record<string, unknown>>(
  records: T[],
  valueKey: keyof T,
  labelKey: keyof T = 'batchNo' as keyof T,
  limit = 24,
) {
  return records.slice(0, limit).reverse().map((r, i) => ({
    label: String(r[labelKey] || i + 1),
    value: Number(r[valueKey]) || 0,
  }));
}

export const UTILITY_DEFAULTS: Record<string, { lsl: number; usl: number; unit: string }> = {
  'Purified Water|Conductivity': { lsl: 0, usl: 1.3, unit: 'µS/cm' },
  'Purified Water|TOC': { lsl: 0, usl: 500, unit: 'ppb' },
  'WFI|Conductivity': { lsl: 0, usl: 1.3, unit: 'µS/cm' },
  'WFI|TOC': { lsl: 0, usl: 500, unit: 'ppb' },
  'WFI|Microbial Count': { lsl: 0, usl: 10, unit: 'CFU/100mL' },
  'Compressed Air|Pressure': { lsl: 5, usl: 7, unit: 'bar' },
  'Nitrogen|Pressure': { lsl: 4, usl: 6, unit: 'bar' },
  'Steam|Temperature': { lsl: 121, usl: 123, unit: '°C' },
  'Steam|Pressure': { lsl: 1.0, usl: 1.5, unit: 'bar' },
};

export function resolveUtilityDefaults(utilityType: string, parameterName: string) {
  return UTILITY_DEFAULTS[`${utilityType}|${parameterName}`] ?? { lsl: 0, usl: 100, unit: '' };
}

export function rawMaterialStatus(assay: number, lsl: number, usl: number): CpvStatus {
  return classifySpecification(assay, (lsl + usl) / 2, lsl, usl);
}

export function stabilityStatus(observed: number, lsl: number, usl: number): CpvStatus {
  return classifySpecification(observed, (lsl + usl) / 2, lsl, usl);
}

export { deviationPercent };
