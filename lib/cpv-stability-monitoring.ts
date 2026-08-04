import { z } from 'zod';
import { RESULT_TYPES } from '@/lib/admin/constants';

export const STABILITY_STUDIES_COLLECTION = 'stability_studies';
export const STABILITY_SCHEDULES_COLLECTION = 'stability_schedules';
export const STABILITY_RESULTS_COLLECTION = 'stability_results';
export const STABILITY_MONITORING_COLLECTION = 'stability_monitoring';
export const STABILITY_LEGACY_COLLECTIONS = ['cpv_stability_studies', 'stability_monitoring'] as const;
export const STABILITY_MODULE_NAME = 'Stability Monitoring';
export const STABILITY_STORAGE_MODULE = 'cpv/stability-monitoring';

export const STABILITY_STUDY_TYPES = [
  'Long Term', 'Accelerated', 'Intermediate', 'Ongoing',
  'Validation Batch', 'PV Batch', 'Commercial Batch', 'Photostability', 'In-use Stability',
] as const;

export const STABILITY_STORAGE_CONDITIONS = [
  '25°C / 60% RH', '30°C / 65% RH', '30°C / 75% RH', '40°C / 75% RH', 'Other',
] as const;

export const STABILITY_PULLING_INTERVALS = [
  'Initial', '1 Month', '2 Month', '3 Month', '6 Month', '9 Month', '12 Month',
  '18 Month', '24 Month', '36 Month', '48 Month', '60 Month',
] as const;

export const STABILITY_SCHEDULE_STATUSES = [
  'Pending', 'Due Soon', 'Pulled', 'Testing Completed', 'Missed', 'Cancelled',
] as const;

export const STABILITY_RESULT_STATUSES = ['Complies', 'OOT', 'Action', 'OOS'] as const;
export const STABILITY_REVIEW_STATUSES = ['Draft', 'Under Review', 'Approved'] as const;
export const STABILITY_STUDY_STATUSES = ['Ongoing', 'Completed', 'Cancelled'] as const;

export const DEFAULT_STABILITY_PARAMETERS = [
  'Description', 'Appearance', 'Colour', 'Clarity', 'pH', 'Assay', 'Related Substances',
  'Sterility', 'Bacterial Endotoxin', 'Particulate Matter', 'Extractable Volume',
  'Methyl Paraben Assay', 'Propyl Paraben Assay', 'Preservative Content',
] as const;

export const INTERVALS_BY_STUDY_TYPE: Record<string, string[]> = {
  'Long Term': ['Initial', '3 Month', '6 Month', '9 Month', '12 Month', '18 Month', '24 Month', '36 Month', '48 Month', '60 Month'],
  'Accelerated': ['Initial', '1 Month', '3 Month', '6 Month'],
  'Intermediate': ['Initial', '1 Month', '3 Month', '6 Month', '9 Month', '12 Month'],
  'Ongoing': ['Initial', '3 Month', '6 Month', '12 Month'],
  'Validation Batch': ['Initial', '3 Month', '6 Month'],
  'PV Batch': ['Initial', '3 Month', '6 Month', '12 Month'],
  'Commercial Batch': ['Initial', '3 Month', '6 Month', '9 Month', '12 Month', '18 Month', '24 Month', '36 Month', '48 Month', '60 Month'],
  'Photostability': ['Initial', '1 Month', '2 Month', '3 Month', '6 Month'],
  'In-use Stability': ['Initial', '1 Month', '2 Month', '3 Month', '6 Month'],
};

export const DEFAULT_STABILITY_LIMITS: Record<string, {
  target: number; lower: number; upper: number; unit: string; resultType: string;
  alertLow?: number; alertHigh?: number; actionLow?: number; actionHigh?: number;
}> = {
  Description: { target: 0, lower: 0, upper: 1, unit: '', resultType: 'Complies/Does Not Comply' },
  Appearance: { target: 0, lower: 0, upper: 1, unit: '', resultType: 'Complies/Does Not Comply' },
  Colour: { target: 0, lower: 0, upper: 1, unit: '', resultType: 'Complies/Does Not Comply' },
  Clarity: { target: 0, lower: 0, upper: 1, unit: '', resultType: 'Complies/Does Not Comply' },
  pH: { target: 7.0, lower: 6.8, upper: 7.2, unit: '', resultType: 'Numeric', alertLow: 6.85, alertHigh: 7.15 },
  Assay: { target: 100, lower: 90, upper: 110, unit: '%', resultType: 'Numeric', alertLow: 92, alertHigh: 108, actionLow: 88, actionHigh: 112 },
  'Related Substances': { target: 0, lower: 0, upper: 2, unit: '%', resultType: 'Numeric', alertHigh: 1.5, actionHigh: 1.8 },
  Sterility: { target: 0, lower: 0, upper: 1, unit: '', resultType: 'Pass/Fail' },
  'Bacterial Endotoxin': { target: 0.5, lower: 0, upper: 1, unit: 'EU/mL', resultType: 'Numeric', alertHigh: 0.8, actionHigh: 0.9 },
  'Particulate Matter': { target: 0, lower: 0, upper: 6000, unit: 'particles', resultType: 'Numeric', alertHigh: 5000 },
  'Extractable Volume': { target: 2, lower: 1.9, upper: 2.1, unit: 'mL', resultType: 'Numeric', alertLow: 1.95, alertHigh: 2.05 },
  'Methyl Paraben Assay': { target: 100, lower: 90, upper: 110, unit: '%', resultType: 'Numeric', alertLow: 92, alertHigh: 108 },
  'Propyl Paraben Assay': { target: 100, lower: 90, upper: 110, unit: '%', resultType: 'Numeric', alertLow: 92, alertHigh: 108 },
  'Preservative Content': { target: 100, lower: 80, upper: 120, unit: '%', resultType: 'Numeric', alertLow: 85, alertHigh: 115 },
};

const requiredText = z.string().trim().min(1, 'Required');
const optionalNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().optional(),
);

export const stabilityStudyFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  productVersion: z.string().trim().default(''),
  strength: z.string().trim().default(''),
  dosageForm: z.string().trim().default(''),
  packSize: z.string().trim().default(''),
  packagingType: z.string().trim().default(''),
  shelfLifeMonths: optionalNum,
  batchNumber: requiredText,
  manufacturingDate: requiredText,
  expiryDate: requiredText,
  studyType: z.enum(STABILITY_STUDY_TYPES),
  storageCondition: z.enum(STABILITY_STORAGE_CONDITIONS),
  studyStartDate: requiredText,
  studyEndDate: z.string().trim().default(''),
  protocolVersion: z.string().trim().default(''),
  specificationVersion: z.string().trim().default(''),
  site: z.string().trim().default(''),
  department: z.string().trim().default(''),
  chamberId: z.string().trim().default(''),
  chamberName: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => {
  const start = new Date(d.studyStartDate);
  const mfg = new Date(d.manufacturingDate);
  return !Number.isNaN(start.getTime()) && !Number.isNaN(mfg.getTime()) && start >= mfg;
}, { message: 'Study start date cannot be before manufacturing date', path: ['studyStartDate'] });

export type StabilityStudyFormData = z.infer<typeof stabilityStudyFormSchema>;

export const stabilityResultFormSchema = z.object({
  studyId: requiredText,
  stabilityStudyNumber: requiredText,
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  batchNumber: requiredText,
  manufacturingDate: requiredText,
  expiryDate: requiredText,
  studyType: z.enum(STABILITY_STUDY_TYPES),
  storageCondition: z.enum(STABILITY_STORAGE_CONDITIONS),
  pullingInterval: z.enum(STABILITY_PULLING_INTERVALS),
  samplePullingDueDate: z.string().trim().default(''),
  actualSamplePullingDate: z.string().trim().default(''),
  testDate: requiredText,
  parameterCode: requiredText,
  parameterName: requiredText,
  observedResult: z.union([z.coerce.number(), z.string().trim().min(1, 'Required')]),
  targetValue: optionalNum,
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  alertLimitLow: optionalNum,
  alertLimitHigh: optionalNum,
  actionLimitLow: optionalNum,
  actionLimitHigh: optionalNum,
  unit: z.string().trim().default(''),
  resultType: z.enum(RESULT_TYPES).default('Numeric'),
  analyst: requiredText,
  reviewedBy: z.string().trim().default(''),
  reviewDate: z.string().trim().default(''),
  chamberId: z.string().trim().default(''),
  chamberName: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => d.lowerLimit < d.upperLimit, {
  message: 'Upper limit must be greater than lower limit',
  path: ['upperLimit'],
}).refine((d) => {
  if (!d.actualSamplePullingDate) return true;
  const pull = new Date(d.actualSamplePullingDate);
  const start = new Date(d.manufacturingDate);
  return !Number.isNaN(pull.getTime()) && pull >= start;
}, { message: 'Actual pulling date cannot be before study start / manufacturing date', path: ['actualSamplePullingDate'] });

export type StabilityResultFormData = z.infer<typeof stabilityResultFormSchema>;

export interface StabilityAttachment {
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  category?: string;
}

export interface StabilityStudyRecord extends StabilityStudyFormData, Record<string, unknown> {
  id: string;
  stabilityMonitoringId: string;
  stabilityStudyNumber: string;
  studyStatus: typeof STABILITY_STUDY_STATUSES[number];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface StabilityScheduleRecord {
  id: string;
  studyId: string;
  stabilityStudyNumber: string;
  batchNumber: string;
  studyType: string;
  storageCondition: string;
  interval: string;
  samplePullingDueDate: string;
  actualPullingDate: string;
  scheduleStatus: typeof STABILITY_SCHEDULE_STATUSES[number] | string;
  resultEntryStatus: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  isDeleted: boolean;
}

export interface StabilityResultRecord extends StabilityResultFormData, Record<string, unknown> {
  id: string;
  stabilityMonitoringId: string;
  scheduleId: string;
  status: string;
  riskLevel: string;
  ootRequired: boolean;
  oosRequired: boolean;
  linkedOosNumber: string;
  deviationRequired: boolean;
  linkedDeviationNumber: string;
  capaRequired: boolean;
  linkedCapaNumber: string;
  reviewStatus: typeof STABILITY_REVIEW_STATUSES[number];
  isLocked: boolean;
  attachments: StabilityAttachment[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface StabilitySummary {
  totalStudies: number;
  ongoingStudies: number;
  completedStudies: number;
  samplesDue: number;
  samplesMissed: number;
  compliantResults: number;
  ootResults: number;
  oosResults: number;
  highRiskStudies: number;
  capaSuggested: number;
}

export function intervalToMonths(interval: string): number {
  if (interval === 'Initial') return 0;
  const match = interval.match(/^(\d+)\s*Month/i);
  return match ? parseInt(match[1], 10) : 0;
}

export function addMonthsToDate(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

export function buildStabilityStudyNumber(batchNumber: string, studyType: string): string {
  const year = new Date().getFullYear();
  return `STAB-CPV-${year}-${batchNumber}-${studyType}`.replace(/\s+/g, '-').toUpperCase().slice(0, 60);
}

export function buildStabilityMonitoringId(
  batchNumber: string,
  interval: string,
  parameterCode: string,
): string {
  return `STB-${batchNumber}-${interval}-${parameterCode}`.replace(/\s+/g, '-').toUpperCase();
}

export function evaluateStabilityStatus(
  observed: number | string,
  lower: number,
  upper: number,
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
  if (!Number.isFinite(num)) {
    const v = String(observed).toLowerCase();
    if (v === 'pass' || v === 'complies') return 'Complies';
    if (v === 'fail' || v.includes('not comply')) return 'OOS';
    return 'Complies';
  }
  if (num < lower || num > upper) return 'OOS';
  if (Number.isFinite(actionLow) && num < Number(actionLow)) return 'Action';
  if (Number.isFinite(actionHigh) && num > Number(actionHigh)) return 'Action';
  if (Number.isFinite(alertLow) && num < Number(alertLow)) return 'OOT';
  if (Number.isFinite(alertHigh) && num > Number(alertHigh)) return 'OOT';
  if (!Number.isFinite(alertLow) && !Number.isFinite(alertHigh)) {
    const range = upper - lower;
    if (range > 0) {
      const innerLow = lower + range * 0.1;
      const innerHigh = upper - range * 0.1;
      if (num < innerLow || num > innerHigh) return 'OOT';
    }
  }
  return 'Complies';
}

export function predictShelfLifeMonths(
  results: StabilityResultRecord[],
  parameterName: string,
  lowerLimit: number,
): number | null {
  const points = results
    .filter((r) => r.parameterName === parameterName && Number.isFinite(Number(r.observedResult)))
    .map((r) => ({ x: intervalToMonths(r.pullingInterval), y: Number(r.observedResult) }))
    .filter((point) => Number.isFinite(point.x))
    .sort((a, b) => a.x - b.x);
  if (points.length < 2) return null;
  const n = points.length;
  const sumX = points.reduce((sum, point) => sum + point.x, 0);
  const sumY = points.reduce((sum, point) => sum + point.y, 0);
  const sumXY = points.reduce((sum, point) => sum + point.x * point.y, 0);
  const sumXX = points.reduce((sum, point) => sum + point.x * point.x, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denominator;
  if (!Number.isFinite(slope) || slope >= 0) return null;
  const intercept = (sumY - slope * sumX) / n;
  const month = (lowerLimit - intercept) / slope;
  return Number.isFinite(month) && month >= 0 ? Math.round(month) : null;
}

export function computeScheduleStatus(
  dueDate: string,
  actualPullDate: string,
  resultEntryStatus: string,
  cancelled = false,
): typeof STABILITY_SCHEDULE_STATUSES[number] {
  if (cancelled) return 'Cancelled';
  if (resultEntryStatus === 'Completed') return 'Testing Completed';
  if (actualPullDate) return 'Pulled';
  const today = new Date().toISOString().split('T')[0];
  if (dueDate && dueDate < today) return 'Missed';
  if (dueDate) {
    const due = new Date(dueDate);
    const now = new Date(today);
    const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays <= 7 && diffDays >= 0) return 'Due Soon';
  }
  return 'Pending';
}

export function evaluateStabilityRisk(
  record: Pick<StabilityResultRecord, 'status' | 'parameterName' | 'observedResult'>,
  ootCount: number,
  slopes?: { assay?: number; ph?: number },
): string {
  const param = record.parameterName.toLowerCase();
  if (record.status === 'OOS') {
    if (param.includes('sterility') || param.includes('endotoxin')) return 'Critical';
    return 'Critical';
  }
  if (ootCount >= 2) return 'Critical';
  if (record.status === 'OOT') return 'High';
  if (param.includes('assay') && slopes?.assay != null && slopes.assay < -0.5) {
    return slopes.assay < -1 ? 'High' : 'Medium';
  }
  if (param === 'ph' && slopes?.ph != null && Math.abs(slopes.ph) > 0.05) return 'Medium';
  if (record.status === 'Action') return 'High';
  return 'Low';
}

export function computeParameterSlope(
  results: StabilityResultRecord[],
  parameterName: string,
): number | undefined {
  const points = results
    .filter((r) => r.parameterName === parameterName && Number.isFinite(Number(r.observedResult)))
    .sort((a, b) => intervalToMonths(a.pullingInterval) - intervalToMonths(b.pullingInterval));
  if (points.length < 2) return undefined;
  const first = Number(points[0].observedResult);
  const last = Number(points[points.length - 1].observedResult);
  const months = intervalToMonths(points[points.length - 1].pullingInterval) - intervalToMonths(points[0].pullingInterval);
  if (months <= 0) return undefined;
  return (last - first) / months;
}

export function computeAssaySlope(results: StabilityResultRecord[]): number | undefined {
  return computeParameterSlope(results, 'Assay');
}

export function summarizeStability(
  studies: StabilityStudyRecord[],
  schedules: StabilityScheduleRecord[],
  results: StabilityResultRecord[],
): StabilitySummary {
  return {
    totalStudies: studies.length,
    ongoingStudies: studies.filter((s) => s.studyStatus === 'Ongoing').length,
    completedStudies: studies.filter((s) => s.studyStatus === 'Completed').length,
    samplesDue: schedules.filter((s) => s.scheduleStatus === 'Due Soon' || s.scheduleStatus === 'Pending').length,
    samplesMissed: schedules.filter((s) => s.scheduleStatus === 'Missed').length,
    compliantResults: results.filter((r) => r.status === 'Complies').length,
    ootResults: results.filter((r) => r.status === 'OOT').length,
    oosResults: results.filter((r) => r.status === 'OOS').length,
    highRiskStudies: results.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length,
    capaSuggested: results.filter((r) => r.capaRequired).length,
  };
}

function trendPoints(results: StabilityResultRecord[], parameterName: string) {
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

export function buildStabilityChartSeries(
  results: StabilityResultRecord[],
  schedules: StabilityScheduleRecord[],
) {
  const byMonth = new Map<string, { oot: number; oos: number; total: number }>();
  results.forEach((r) => {
    const key = (r.testDate || r.createdAt).slice(0, 7);
    const e = byMonth.get(key) || { oot: 0, oos: 0, total: 0 };
    e.total += 1;
    if (r.status === 'OOT') e.oot += 1;
    if (r.status === 'OOS') e.oos += 1;
    byMonth.set(key, e);
  });
  const ootOosTrend = Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, oot: v.oot, oos: v.oos }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const condMap = new Map<string, number>();
  results.filter((r) => r.status !== 'Complies').forEach((r) => {
    condMap.set(r.storageCondition, (condMap.get(r.storageCondition) || 0) + 1);
  });
  const storageConditionTrend = Array.from(condMap.entries()).map(([condition, count]) => ({ condition, count }));

  const intervalMap = new Map<string, { ok: number; total: number }>();
  results.forEach((r) => {
    const e = intervalMap.get(r.pullingInterval) || { ok: 0, total: 0 };
    e.total += 1;
    if (r.status === 'Complies') e.ok += 1;
    intervalMap.set(r.pullingInterval, e);
  });
  const intervalCompliance = Array.from(intervalMap.entries())
    .map(([interval, v]) => ({
      interval,
      rate: v.total ? Math.round((v.ok / v.total) * 100) : 0,
    }))
    .sort((a, b) => intervalToMonths(a.interval) - intervalToMonths(b.interval));

  const riskMap = new Map<string, number>();
  results.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  const batchMap = new Map<string, { ok: number; total: number }>();
  results.forEach((r) => {
    const e = batchMap.get(r.batchNumber) || { ok: 0, total: 0 };
    e.total += 1;
    if (r.status === 'Complies') e.ok += 1;
    batchMap.set(r.batchNumber, e);
  });
  const batchSummary = Array.from(batchMap.entries())
    .map(([batch, v]) => ({ batch, compliance: v.total ? Math.round((v.ok / v.total) * 100) : 0 }))
    .slice(0, 12);

  return {
    assayTrend: trendPoints(results, 'Assay'),
    phTrend: trendPoints(results, 'pH'),
    relatedSubstanceTrend: trendPoints(results, 'Related Substances'),
    preservativeTrend: trendPoints(results, 'Preservative Content'),
    ootOosTrend,
    storageConditionTrend,
    intervalCompliance,
    riskDistribution,
    batchSummary,
    scheduleDue: schedules.filter((s) => s.scheduleStatus === 'Due Soon').length,
    scheduleMissed: schedules.filter((s) => s.scheduleStatus === 'Missed').length,
  };
}

export function defaultLimitsForParameter(name: string) {
  return DEFAULT_STABILITY_LIMITS[name] || {
    target: 0, lower: 0, upper: 100, unit: '', resultType: 'Numeric',
  };
}

export function mapDefaultParameterFields(name: string) {
  const lim = defaultLimitsForParameter(name);
  return {
    name,
    code: name.replace(/\s+/g, '_').toUpperCase(),
    target: lim.target,
    lower: lim.lower,
    upper: lim.upper,
    unit: lim.unit,
    resultType: lim.resultType,
    alertLimitLow: lim.alertLow,
    alertLimitHigh: lim.alertHigh,
    actionLimitLow: lim.actionLow,
    actionLimitHigh: lim.actionHigh,
  };
}
