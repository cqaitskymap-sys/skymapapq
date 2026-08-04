import { z } from 'zod';

export const HOLD_TIME_MONITORING_COLLECTION = 'hold_time_monitoring';
export const HOLD_TIME_MASTER_COLLECTION = 'hold_time_master';
export const HOLD_TIME_LEGACY_COLLECTIONS = ['cpv_hold_time'] as const;
export const HOLD_TIME_MODULE_NAME = 'Hold Time Monitoring';

export const HOLD_STAGES = [
  'Dispensing to Mixing',
  'Mixing to Filtration',
  'Filtration to Sterilization',
  'Sterilization to Filling',
  'Filling to Inspection',
  'Inspection to Packing',
  'Bulk Hold Time',
  'Sterile Bulk Hold Time',
  'Intermediate Hold Time',
  'Finished Product Hold Time',
  'Warehouse Hold Time',
  'Raw Material Hold',
  'Packaging Material Hold',
  'Equipment Hold',
  'Cleaning Hold',
  'Stability Hold',
  'Process Hold',
] as const;

export const BULK_HOLD_STAGES = [
  'Dispensing',
  'Mixing',
  'Filtration',
  'Sterilization',
  'Filling',
  'Inspection',
  'Packing',
] as const;

export const HOLD_MATERIAL_CATEGORIES = [
  'Raw Material',
  'Intermediate',
  'Bulk Product',
  'Finished Product',
  'Packaging Material',
  'Equipment',
  'Cleaning Hold',
  'Process',
  'Stability',
  'N/A',
] as const;

export const HOLD_TIME_UNITS = ['Minutes', 'Hours', 'Days'] as const;
export const HOLD_TIME_STATUSES = [
  'In Progress',
  'Complies',
  'Alert',
  'Action',
  'Near Expiry',
  'Exceeded',
  'Expired',
] as const;
export const HOLD_REVIEW_STATUSES = ['Draft', 'Under Review', 'Approved'] as const;
export const HOLD_TIMER_STATUSES = ['Not Started', 'Running', 'Paused', 'Completed', 'Expired'] as const;

export const DEFAULT_ALLOWED_HOLD_TIMES: Record<string, { allowed: number; unit: typeof HOLD_TIME_UNITS[number] }> = {
  'Dispensing to Mixing': { allowed: 4, unit: 'Hours' },
  'Mixing to Filtration': { allowed: 2, unit: 'Hours' },
  'Filtration to Sterilization': { allowed: 8, unit: 'Hours' },
  'Sterilization to Filling': { allowed: 12, unit: 'Hours' },
  'Filling to Inspection': { allowed: 6, unit: 'Hours' },
  'Inspection to Packing': { allowed: 4, unit: 'Hours' },
  'Bulk Hold Time': { allowed: 24, unit: 'Hours' },
  'Sterile Bulk Hold Time': { allowed: 24, unit: 'Hours' },
  'Intermediate Hold Time': { allowed: 48, unit: 'Hours' },
  'Finished Product Hold Time': { allowed: 72, unit: 'Hours' },
  'Warehouse Hold Time': { allowed: 30, unit: 'Days' },
  'Raw Material Hold': { allowed: 72, unit: 'Hours' },
  'Packaging Material Hold': { allowed: 48, unit: 'Hours' },
  'Equipment Hold': { allowed: 8, unit: 'Hours' },
  'Cleaning Hold': { allowed: 72, unit: 'Hours' },
  'Stability Hold': { allowed: 24, unit: 'Hours' },
  'Process Hold': { allowed: 12, unit: 'Hours' },
  Dispensing: { allowed: 4, unit: 'Hours' },
  Mixing: { allowed: 2, unit: 'Hours' },
  Filtration: { allowed: 8, unit: 'Hours' },
  Sterilization: { allowed: 12, unit: 'Hours' },
  Filling: { allowed: 6, unit: 'Hours' },
  Inspection: { allowed: 4, unit: 'Hours' },
  Packing: { allowed: 4, unit: 'Hours' },
};

const requiredText = z.string().trim().min(1, 'Required');
const optionalNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().optional(),
);

export const holdTimeMonitoringFormSchema = z.object({
  holdTimeCode: z.string().trim().default(''),
  studyNumber: z.string().trim().default(''),
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  productVersion: z.string().trim().default(''),
  material: z.string().trim().default(''),
  materialCategory: z.enum(HOLD_MATERIAL_CATEGORIES).default('N/A'),
  equipmentId: z.string().trim().default(''),
  equipmentName: z.string().trim().default(''),
  batchNumber: requiredText,
  manufacturingOrder: z.string().trim().default(''),
  manufacturingDate: requiredText,
  processStage: requiredText,
  operation: z.string().trim().default(''),
  holdStage: requiredText,
  department: z.string().trim().default(''),
  productionLine: z.string().trim().default(''),
  site: z.string().trim().default(''),
  storageLocation: z.string().trim().default(''),
  storageCondition: z.string().trim().default(''),
  temperature: optionalNum,
  humidity: optionalNum,
  temperatureLimitLow: optionalNum,
  temperatureLimitHigh: optionalNum,
  humidityLimitLow: optionalNum,
  humidityLimitHigh: optionalNum,
  startDateTime: requiredText,
  endDateTime: z.string().trim().default(''),
  allowedHoldTime: z.coerce.number().positive('Allowed hold time must be greater than 0'),
  holdTimeUnit: z.enum(HOLD_TIME_UNITS),
  effectiveDate: z.string().trim().default(''),
  reviewDate: z.string().trim().default(''),
  description: z.string().trim().default(''),
  reasonForHold: z.string().trim().default(''),
  extensionApproved: z.boolean().default(false),
  extensionReason: z.string().trim().default(''),
  approvedBy: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  autoDeviationRequired: z.boolean().default(true),
  timerStatus: z.enum(HOLD_TIMER_STATUSES).default('Not Started'),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => {
  const start = new Date(d.startDateTime);
  if (Number.isNaN(start.getTime())) return false;
  if (!d.endDateTime?.trim()) return true;
  const end = new Date(d.endDateTime);
  return !Number.isNaN(end.getTime()) && end > start;
}, { message: 'End date time must be after start date time', path: ['endDateTime'] });

export type HoldTimeMonitoringFormData = z.infer<typeof holdTimeMonitoringFormSchema>;

export interface HoldTimeMonitoringRecord extends HoldTimeMonitoringFormData, Record<string, unknown> {
  id: string;
  holdTimeId: string;
  actualHoldTime: number;
  elapsedTime: number;
  remainingTime: number;
  exceededTime: number;
  timeUtilizationPercent: number;
  difference: number;
  complianceStatus: typeof HOLD_TIME_STATUSES[number] | string;
  status: typeof HOLD_TIME_STATUSES[number] | string;
  riskLevel: string;
  nearExpiry: boolean;
  storageExcursion: boolean;
  temperatureExcursion: boolean;
  humidityExcursion: boolean;
  deviationRequired: boolean;
  linkedDeviationNumber: string;
  capaRequired: boolean;
  linkedCapaNumber: string;
  reviewStatus: typeof HOLD_REVIEW_STATUSES[number];
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface HoldTimeSummary {
  total: number;
  inProgress: number;
  compliant: number;
  alert: number;
  action: number;
  nearExpiry: number;
  exceeded: number;
  expired: number;
  highRisk: number;
  deviationTriggered: number;
  capaSuggested: number;
  storageExcursions: number;
}

export interface HoldTimeStats {
  count: number;
  mean: number;
  median: number;
  mode: number | null;
  variance: number;
  stdDev: number;
  min: number;
  max: number;
  cp: number | null;
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
  sigmaLevel: number | null;
}

export function buildHoldTimeId(batchNumber: string, holdStage: string): string {
  return `HT-${batchNumber}-${holdStage}`.replace(/\s+/g, '-').toUpperCase();
}

export function buildHoldTimeCode(batchNumber: string, holdStage: string): string {
  const year = new Date().getFullYear();
  return `HTC-${year}-${batchNumber}-${holdStage}`.replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}

export function unitToMinutes(unit: string): number {
  if (unit === 'Minutes') return 1;
  if (unit === 'Hours') return 60;
  if (unit === 'Days') return 1440;
  return 60;
}

export function minutesToUnit(minutes: number, unit: string): number {
  const factor = unitToMinutes(unit);
  return Math.round((minutes / factor) * 100) / 100;
}

export function resolveHoldEnd(startDateTime: string, endDateTime?: string | null, now = new Date()): Date | null {
  const start = new Date(startDateTime);
  if (Number.isNaN(start.getTime())) return null;
  if (endDateTime?.trim()) {
    const end = new Date(endDateTime);
    return Number.isNaN(end.getTime()) ? null : end;
  }
  return now;
}

export function calculateActualHoldTime(
  startDateTime: string,
  endDateTime: string | undefined | null,
  unit: string,
  now = new Date(),
): number {
  const start = new Date(startDateTime);
  const end = resolveHoldEnd(startDateTime, endDateTime, now);
  if (Number.isNaN(start.getTime()) || !end) return 0;
  const diffMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
  if (diffMinutes <= 0) return 0;
  return minutesToUnit(diffMinutes, unit);
}

export function calculateHoldDifference(allowed: number, actual: number): number {
  return Math.round((allowed - actual) * 100) / 100;
}

export function calculateRemainingTime(allowed: number, actual: number): number {
  return Math.max(0, Math.round((allowed - actual) * 100) / 100);
}

export function calculateExceededTime(allowed: number, actual: number): number {
  return Math.max(0, Math.round((actual - allowed) * 100) / 100);
}

export function calculateTimeUtilization(allowed: number, actual: number): number {
  if (!Number.isFinite(allowed) || allowed <= 0) return 0;
  return Math.round((actual / allowed) * 10000) / 100;
}

export function evaluateHoldTimeStatus(
  actual: number,
  allowed: number,
  options?: { endDateTime?: string; inProgress?: boolean },
): string {
  if (!Number.isFinite(actual) || !Number.isFinite(allowed) || allowed <= 0) return 'Exceeded';
  const inProgress = options?.inProgress === true || !options?.endDateTime?.trim();
  if (actual > allowed) return inProgress ? 'Expired' : 'Exceeded';
  if (actual >= allowed * 0.95) return inProgress ? 'Near Expiry' : 'Action';
  if (actual >= allowed * 0.8) return 'Alert';
  return inProgress ? 'In Progress' : 'Complies';
}

export function evaluateStorageExcursion(input: {
  temperature?: number | null;
  humidity?: number | null;
  temperatureLimitLow?: number | null;
  temperatureLimitHigh?: number | null;
  humidityLimitLow?: number | null;
  humidityLimitHigh?: number | null;
}): { temperatureExcursion: boolean; humidityExcursion: boolean; storageExcursion: boolean } {
  const temp = input.temperature;
  const humidity = input.humidity;
  const temperatureExcursion = (
    (temp != null && input.temperatureLimitLow != null && temp < input.temperatureLimitLow)
    || (temp != null && input.temperatureLimitHigh != null && temp > input.temperatureLimitHigh)
  );
  const humidityExcursion = (
    (humidity != null && input.humidityLimitLow != null && humidity < input.humidityLimitLow)
    || (humidity != null && input.humidityLimitHigh != null && humidity > input.humidityLimitHigh)
  );
  return {
    temperatureExcursion: Boolean(temperatureExcursion),
    humidityExcursion: Boolean(humidityExcursion),
    storageExcursion: Boolean(temperatureExcursion || humidityExcursion),
  };
}

export function evaluateHoldTimeRisk(
  record: Pick<HoldTimeMonitoringRecord, 'holdStage' | 'status' | 'complianceStatus' | 'materialCategory' | 'storageExcursion'>,
  exceededCount: number,
): string {
  const status = record.complianceStatus || record.status;
  if (exceededCount >= 3) return 'Critical';
  if (record.storageExcursion && ['Exceeded', 'Expired'].includes(String(status))) return 'Critical';
  if (status === 'Exceeded' && record.holdStage === 'Sterile Bulk Hold Time') return 'Critical';
  if (status === 'Expired' && ['Equipment', 'Cleaning Hold'].includes(String(record.materialCategory))) return 'Critical';
  if (['Exceeded', 'Expired'].includes(String(status))) return 'High';
  if (status === 'Action' || status === 'Near Expiry') return 'Medium';
  if (status === 'Alert' || record.storageExcursion) return 'Low';
  return 'Low';
}

export function buildHoldTimeComputedFields(
  data: Pick<
    HoldTimeMonitoringFormData,
    | 'startDateTime'
    | 'endDateTime'
    | 'allowedHoldTime'
    | 'holdTimeUnit'
    | 'temperature'
    | 'humidity'
    | 'temperatureLimitLow'
    | 'temperatureLimitHigh'
    | 'humidityLimitLow'
    | 'humidityLimitHigh'
  >,
  now = new Date(),
) {
  const inProgress = !data.endDateTime?.trim();
  const actualHoldTime = calculateActualHoldTime(data.startDateTime, data.endDateTime, data.holdTimeUnit, now);
  const elapsedTime = actualHoldTime;
  const remainingTime = calculateRemainingTime(data.allowedHoldTime, actualHoldTime);
  const exceededTime = calculateExceededTime(data.allowedHoldTime, actualHoldTime);
  const timeUtilizationPercent = calculateTimeUtilization(data.allowedHoldTime, actualHoldTime);
  const difference = calculateHoldDifference(data.allowedHoldTime, actualHoldTime);
  const status = evaluateHoldTimeStatus(actualHoldTime, data.allowedHoldTime, {
    endDateTime: data.endDateTime,
    inProgress,
  });
  const nearExpiry = remainingTime <= data.allowedHoldTime * 0.2 && remainingTime > 0;
  const excursions = evaluateStorageExcursion(data);
  return {
    actualHoldTime,
    elapsedTime,
    remainingTime,
    exceededTime,
    timeUtilizationPercent,
    difference,
    status,
    complianceStatus: status,
    nearExpiry,
    ...excursions,
  };
}

export function formatCountdown(remainingInUnit: number, unit: string): string {
  if (remainingInUnit <= 0) return 'Expired';
  const minutes = remainingInUnit * unitToMinutes(unit);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = Math.floor(minutes % 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function round(n: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function computeHoldTimeStats(
  values: number[],
  lsl = 0,
  usl?: number,
): HoldTimeStats {
  const sorted = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  const count = sorted.length;
  if (!count) {
    return {
      count: 0, mean: 0, median: 0, mode: null, variance: 0, stdDev: 0,
      min: 0, max: 0, cp: null, cpk: null, pp: null, ppk: null, sigmaLevel: null,
    };
  }
  const mean = sorted.reduce((s, v) => s + v, 0) / count;
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];
  const freq = new Map<number, number>();
  sorted.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
  let mode: number | null = null;
  let maxFreq = 0;
  freq.forEach((f, v) => {
    if (f > maxFreq) { maxFreq = f; mode = v; }
  });
  if (maxFreq <= 1) mode = null;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);
  const min = sorted[0];
  const max = sorted[count - 1];
  const upper = usl ?? Math.max(...sorted, lsl + 1);
  const cp = stdDev > 0 ? (upper - lsl) / (6 * stdDev) : null;
  const cpk = stdDev > 0
    ? Math.min((mean - lsl) / (3 * stdDev), (upper - mean) / (3 * stdDev))
    : null;
  const pp = cp;
  const ppk = cpk;
  const sigmaLevel = stdDev > 0 && cpk != null ? cpk * 3 : null;
  return {
    count,
    mean: round(mean),
    median: round(median),
    mode,
    variance: round(variance),
    stdDev: round(stdDev),
    min: round(min),
    max: round(max),
    cp: cp == null ? null : round(cp),
    cpk: cpk == null ? null : round(cpk),
    pp: pp == null ? null : round(pp),
    ppk: ppk == null ? null : round(ppk),
    sigmaLevel: sigmaLevel == null ? null : round(sigmaLevel),
  };
}

/** Western Electric Rule 1: point beyond 3σ */
export function detectWesternElectricViolations(values: number[]): number[] {
  if (values.length < 2) return [];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  if (stdDev <= 0) return [];
  return values
    .map((v, i) => (Math.abs(v - mean) > 3 * stdDev ? i : -1))
    .filter((i) => i >= 0);
}

/** Nelson Rule 1: one point beyond 3σ (same as WE1); Rule 2: 9 consecutive on same side of mean */
export function detectNelsonRuleViolations(values: number[]): { rule: string; indices: number[] }[] {
  const violations: { rule: string; indices: number[] }[] = [];
  if (values.length < 2) return violations;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const beyond3 = values
    .map((v, i) => (stdDev > 0 && Math.abs(v - mean) > 3 * stdDev ? i : -1))
    .filter((i) => i >= 0);
  if (beyond3.length) violations.push({ rule: 'Nelson 1 / WE 1', indices: beyond3 });
  let run: number[] = [];
  let side: 'above' | 'below' | null = null;
  values.forEach((v, i) => {
    const current = v >= mean ? 'above' : 'below';
    if (current === side) run.push(i);
    else { run = [i]; side = current; }
    if (run.length >= 9) violations.push({ rule: 'Nelson 2', indices: [...run] });
  });
  return violations;
}

export function computeEwma(values: number[], lambda = 0.2): number[] {
  if (!values.length) return [];
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    out.push(lambda * values[i] + (1 - lambda) * out[i - 1]);
  }
  return out.map((v) => round(v));
}

export function computeCusum(values: number[], target?: number): { high: number[]; low: number[] } {
  if (!values.length) return { high: [], low: [] };
  const mean = target ?? values.reduce((s, v) => s + v, 0) / values.length;
  const high: number[] = [];
  const low: number[] = [];
  let sh = 0;
  let sl = 0;
  values.forEach((v) => {
    sh = Math.max(0, sh + (v - mean));
    sl = Math.min(0, sl + (v - mean));
    high.push(round(sh));
    low.push(round(sl));
  });
  return { high, low };
}

export function summarizeHoldTimeRecords(records: HoldTimeMonitoringRecord[]): HoldTimeSummary {
  return {
    total: records.length,
    inProgress: records.filter((r) => r.status === 'In Progress').length,
    compliant: records.filter((r) => r.status === 'Complies' || r.complianceStatus === 'Complies').length,
    alert: records.filter((r) => r.status === 'Alert').length,
    action: records.filter((r) => r.status === 'Action').length,
    nearExpiry: records.filter((r) => r.status === 'Near Expiry' || r.nearExpiry).length,
    exceeded: records.filter((r) => r.status === 'Exceeded').length,
    expired: records.filter((r) => r.status === 'Expired').length,
    highRisk: records.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length,
    deviationTriggered: records.filter((r) => r.deviationRequired || r.linkedDeviationNumber).length,
    capaSuggested: records.filter((r) => r.capaRequired).length,
    storageExcursions: records.filter((r) => r.storageExcursion).length,
  };
}

export function buildHoldTimeChartSeries(records: HoldTimeMonitoringRecord[]) {
  const byMonth = new Map<string, { complies: number; total: number }>();
  records.forEach((r) => {
    const key = (r.startDateTime || r.createdAt).slice(0, 7);
    const e = byMonth.get(key) || { complies: 0, total: 0 };
    e.total += 1;
    if (r.status === 'Complies') e.complies += 1;
    byMonth.set(key, e);
  });
  const complianceTrend = Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, rate: v.total ? Math.round((v.complies / v.total) * 100) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const stageMap = new Map<string, { actual: number; allowed: number; count: number }>();
  records.forEach((r) => {
    const e = stageMap.get(r.holdStage) || { actual: 0, allowed: 0, count: 0 };
    e.actual += r.actualHoldTime;
    e.allowed += r.allowedHoldTime;
    e.count += 1;
    stageMap.set(r.holdStage, e);
  });
  const stageTrend = Array.from(stageMap.entries()).map(([stage, v]) => ({
    stage,
    actual: v.count ? Math.round((v.actual / v.count) * 100) / 100 : 0,
    allowed: v.count ? Math.round((v.allowed / v.count) * 100) / 100 : 0,
  }));

  const exceededByMonth = new Map<string, number>();
  records.filter((r) => r.status === 'Exceeded' || r.status === 'Expired').forEach((r) => {
    const key = (r.startDateTime || r.createdAt).slice(0, 7);
    exceededByMonth.set(key, (exceededByMonth.get(key) || 0) + 1);
  });
  const exceededTrend = Array.from(exceededByMonth.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const riskMap = new Map<string, number>();
  records.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  const monthlyAnalysis = complianceTrend.map((m) => ({
    month: m.month,
    compliance: m.rate,
    exceeded: exceededTrend.find((e) => e.month === m.month)?.count ?? 0,
  }));

  const utilizationTrend = records
    .slice()
    .sort((a, b) => a.startDateTime.localeCompare(b.startDateTime))
    .map((r) => ({
      label: r.batchNumber,
      utilization: r.timeUtilizationPercent || calculateTimeUtilization(r.allowedHoldTime, r.actualHoldTime),
    }));

  return { complianceTrend, stageTrend, exceededTrend, riskDistribution, monthlyAnalysis, utilizationTrend };
}

export function defaultAllowedForStage(stage: string) {
  return DEFAULT_ALLOWED_HOLD_TIMES[stage] || { allowed: 24, unit: 'Hours' as const };
}
