import { z } from 'zod';
import {
  runSpcAnalysis,
  type SpcObservation,
  type SpcChartResult,
  type SpcRuleViolation,
} from '@/lib/cpv-spc';

export const CONTROL_CHARTS_COLLECTION = 'control_charts';
export const SPC_VIOLATIONS_COLLECTION = 'spc_rule_violations';
export const CONTROL_CHARTS_LEGACY = ['cpv_control_charts'] as const;
export const SPC_MODULE = 'Statistical Process Control';

export const CHART_TYPES = [
  'Individuals Chart',
  'Moving Range Chart',
  'X-Bar Chart',
  'R Chart',
  'S Chart',
  'X-Bar R Chart',
  'EWMA Chart',
  'CUSUM Chart',
  'Run Chart',
  'P Chart',
  'NP Chart',
  'C Chart',
  'U Chart',
] as const;

export const DATA_SOURCES = [
  'CPP Results',
  'CQA Results',
  'Yield Monitoring',
  'Stability Monitoring',
  'Utility Monitoring',
  'Environmental Monitoring',
  'Hold Time Monitoring',
] as const;

export const PARAMETER_TYPES = [
  'CPP',
  'CQA',
  'Yield',
  'Stability',
  'Utility',
  'Environmental',
  'Hold Time',
] as const;

export const SPC_STATUSES = [
  'In Control',
  'Out Of Control',
  'Warning',
  'Insufficient Data',
] as const;

export const WORKFLOW_STATUSES = [
  'Draft',
  'Generated',
  'Under Review',
  'Approved',
  'Rejected',
  'Archived',
] as const;

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;
export const VIOLATION_SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

const requiredText = z.string().trim().min(1, 'Required');

export const spcFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  spcCode: z.string().trim().default(''),
  studyNumber: z.string().trim().default(''),
  productVersion: z.string().trim().default(''),
  batchNumber: z.string().trim().default(''),
  manufacturingOrder: z.string().trim().default(''),
  process: z.string().trim().default(''),
  processStep: z.string().trim().default(''),
  equipmentId: z.string().trim().default(''),
  equipmentName: z.string().trim().default(''),
  machine: z.string().trim().default(''),
  department: z.string().trim().default(''),
  productionLine: z.string().trim().default(''),
  operator: z.string().trim().default(''),
  shift: z.string().trim().default(''),
  site: z.string().trim().default(''),
  chartType: z.enum(CHART_TYPES),
  dataSource: z.enum(DATA_SOURCES),
  parameterType: z.enum(PARAMETER_TYPES),
  parameterCode: requiredText,
  parameterName: requiredText,
  reviewPeriodFrom: requiredText,
  reviewPeriodTo: requiredText,
  subgroupSize: z.coerce.number().int().min(2).max(10).default(4),
  sampleSize: z.coerce.number().int().min(1).max(100).default(1),
  samplingFrequency: z.string().trim().default(''),
  targetValue: z.coerce.number().optional(),
  effectiveDate: z.string().trim().default(''),
  description: z.string().trim().default(''),
  conclusion: z.string().trim().default(''),
  recommendation: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => {
  const from = new Date(d.reviewPeriodFrom);
  const to = new Date(d.reviewPeriodTo);
  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to > from;
}, { message: 'Review period end must be after start', path: ['reviewPeriodTo'] });

export type SpcFormData = z.infer<typeof spcFormSchema>;

export interface SpcSourcePoint {
  batchNumber: string;
  value: number;
  date: string;
  lsl?: number;
  usl?: number;
  target?: number;
}

export interface SpcChartPoint {
  index: number;
  label: string;
  batchNumber: string;
  date: string;
  value: number;
  movingRange: number;
  centerLine: number;
  ucl: number;
  lcl: number;
  outOfControl: boolean;
  violated: boolean;
}

export interface SpcRuleViolationRecord {
  violationId: string;
  spcRecordId: string;
  product: string;
  batchNumber: string;
  parameter: string;
  violationType: string;
  dataPointValue: number;
  dataPointDate: string;
  ruleDescription: string;
  severity: typeof VIOLATION_SEVERITIES[number];
  actionRequired: boolean;
}

export interface SpcRecord extends SpcFormData, Record<string, unknown> {
  id: string;
  spcRecordId: string;
  batchCount: number;
  dataPointsCount: number;
  mean: number;
  median: number;
  mode: number | null;
  range: number;
  variance: number;
  centerLine: number;
  upperControlLimit: number;
  lowerControlLimit: number;
  upperSpecificationLimit: number;
  lowerSpecificationLimit: number;
  movingRangeAverage: number;
  averageRange: number;
  standardDeviation: number;
  cp: number;
  cpk: number;
  cpu: number;
  cpl: number;
  pp: number;
  ppk: number;
  sigmaLevel: number;
  zScoreMean: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  skewness: number;
  kurtosis: number;
  outlierCount: number;
  ewmaLast: number;
  cusumHighLast: number;
  cusumLowLast: number;
  ewmaData: SpcChartPoint[];
  cusumHighData: SpcChartPoint[];
  cusumLowData: SpcChartPoint[];
  sChartData: SpcChartPoint[];
  processDriftDetected: boolean;
  specialCauseVariation: boolean;
  commonCauseOnly: boolean;
  healthScore: number;
  confidenceScore: number;
  aiRecommendation: string;
  goldenBatchNumber: string;
  goldenBatchDelta: number;
  forecastNext: number;
  westernElectricCount: number;
  nelsonRuleCount: number;
  spcStatus: typeof SPC_STATUSES[number];
  ruleViolationsCount: number;
  outOfControlPoints: number;
  riskLevel: typeof RISK_LEVELS[number];
  capaSuggested: boolean;
  deviationRequired: boolean;
  generatedBy: string;
  generatedDate: string;
  reviewedBy: string;
  reviewDate: string;
  approvedBy: string;
  approvalDate: string;
  status: typeof WORKFLOW_STATUSES[number];
  linkedRiskId: string;
  linkedDeviationNumber: string;
  linkedCapaNumber: string;
  isLocked: boolean;
  chartData: SpcChartPoint[];
  movingRangeData: SpcChartPoint[];
  xbarChartData: SpcChartPoint[];
  rChartData: SpcChartPoint[];
  violations: SpcRuleViolationRecord[];
  sourcePreview: SpcSourcePoint[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface SpcSummary {
  total: number;
  inControl: number;
  outOfControl: number;
  warning: number;
  insufficient: number;
  ruleViolations: number;
  highRisk: number;
  criticalRisk: number;
  capaSuggested: number;
}

export interface SpcCalculationResult {
  batchCount: number;
  dataPointsCount: number;
  mean: number;
  median: number;
  mode: number | null;
  range: number;
  variance: number;
  centerLine: number;
  upperControlLimit: number;
  lowerControlLimit: number;
  upperSpecificationLimit: number;
  lowerSpecificationLimit: number;
  movingRangeAverage: number;
  averageRange: number;
  standardDeviation: number;
  cp: number;
  cpk: number;
  cpu: number;
  cpl: number;
  pp: number;
  ppk: number;
  sigmaLevel: number;
  zScoreMean: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  skewness: number;
  kurtosis: number;
  outlierCount: number;
  ewmaLast: number;
  cusumHighLast: number;
  cusumLowLast: number;
  ewmaData: SpcChartPoint[];
  cusumHighData: SpcChartPoint[];
  cusumLowData: SpcChartPoint[];
  sChartData: SpcChartPoint[];
  processDriftDetected: boolean;
  specialCauseVariation: boolean;
  commonCauseOnly: boolean;
  healthScore: number;
  confidenceScore: number;
  aiRecommendation: string;
  goldenBatchNumber: string;
  goldenBatchDelta: number;
  forecastNext: number;
  westernElectricCount: number;
  nelsonRuleCount: number;
  spcStatus: typeof SPC_STATUSES[number];
  ruleViolationsCount: number;
  outOfControlPoints: number;
  riskLevel: typeof RISK_LEVELS[number];
  capaSuggested: boolean;
  deviationRequired: boolean;
  chartData: SpcChartPoint[];
  movingRangeData: SpcChartPoint[];
  xbarChartData: SpcChartPoint[];
  rChartData: SpcChartPoint[];
  violations: SpcRuleViolationRecord[];
}

function round(n: number, d = 3): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** d) / 10 ** d;
}

export function buildSpcRecordId(productCode: string, parameterCode: string): string {
  const year = new Date().getFullYear();
  return `SPC-${productCode}-${parameterCode}-${year}`.replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}

export function buildViolationId(index: number): string {
  return `SPCV-${Date.now()}-${index}`.slice(0, 40);
}

export function dataSourceForParameterType(type: typeof PARAMETER_TYPES[number]): typeof DATA_SOURCES[number] {
  const map: Record<string, typeof DATA_SOURCES[number]> = {
    CPP: 'CPP Results',
    CQA: 'CQA Results',
    Yield: 'Yield Monitoring',
    Stability: 'Stability Monitoring',
    Utility: 'Utility Monitoring',
    Environmental: 'Environmental Monitoring',
    'Hold Time': 'Hold Time Monitoring',
  };
  return map[type];
}

export function parameterTypeForDataSource(source: typeof DATA_SOURCES[number]): typeof PARAMETER_TYPES[number] {
  const map: Record<string, typeof PARAMETER_TYPES[number]> = {
    'CPP Results': 'CPP',
    'CQA Results': 'CQA',
    'Yield Monitoring': 'Yield',
    'Stability Monitoring': 'Stability',
    'Utility Monitoring': 'Utility',
    'Environmental Monitoring': 'Environmental',
    'Hold Time Monitoring': 'Hold Time',
  };
  return map[source];
}

function isCriticalParameter(name: string): boolean {
  const critical = ['Sterility', 'Assay', 'Bacterial Endotoxin', 'Fill Volume', 'pH'];
  return critical.some((p) => name.toLowerCase().includes(p.toLowerCase()));
}

function toObservations(
  points: SpcSourcePoint[],
  productName: string,
  parameterName: string,
): SpcObservation[] {
  return points.map((p) => ({
    id: `${p.batchNumber}-${p.date}`,
    source: 'cpp' as const,
    product: productName,
    batch: p.batchNumber,
    date: p.date,
    parameter: parameterName,
    value: p.value,
    lsl: p.lsl,
    usl: p.usl,
    unit: '',
  }));
}

export function canCreateSpcForDataSource(
  role: string | undefined,
  dataSource: typeof DATA_SOURCES[number],
): boolean {
  if (!role) return false;
  if (['super_admin', 'admin'].includes(role)) return true;
  const qcSources: typeof DATA_SOURCES[number][] = [
    'CQA Results', 'Stability Monitoring',
  ];
  const productionSources: typeof DATA_SOURCES[number][] = [
    'CPP Results', 'Yield Monitoring', 'Hold Time Monitoring',
  ];
  const engineeringSources: typeof DATA_SOURCES[number][] = [
    'Utility Monitoring', 'Environmental Monitoring',
  ];
  if (['qc', 'qc_manager'].includes(role) && qcSources.includes(dataSource)) return true;
  if (['production', 'production_manager'].includes(role) && productionSources.includes(dataSource)) return true;
  if (['engineering', 'engineering_manager'].includes(role) && engineeringSources.includes(dataSource)) return true;
  return false;
}

function detectExtendedRules(
  values: number[],
  batches: string[],
  dates: string[],
  limits: { centerLine: number; ucl: number; lcl: number },
): SpcRuleViolation[] {
  const violations: SpcRuleViolation[] = [];
  const cl = limits.centerLine;
  const span = limits.ucl - limits.lcl;

  for (let i = 2; i < values.length && span > 0; i++) {
    const window = values.slice(i - 2, i + 1);
    const nearUpper = window.filter((v) => (limits.ucl - v) / span < 0.15).length;
    const nearLower = window.filter((v) => (v - limits.lcl) / span < 0.15).length;
    if (nearUpper >= 2 || nearLower >= 2) {
      violations.push({
        rule: 7,
        ruleName: '2 of 3 near control limit',
        description: 'Two of three consecutive points near upper or lower control limit',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart: 'individuals',
      });
    }
  }

  for (let i = 5; i < values.length; i++) {
    const window = values.slice(i - 5, i + 1);
    let inc = true;
    let dec = true;
    for (let j = 1; j < window.length; j++) {
      if (window[j] <= window[j - 1]) inc = false;
      if (window[j] >= window[j - 1]) dec = false;
    }
    if (inc || dec) {
      violations.push({
        rule: 5,
        ruleName: '6 consecutive trend',
        description: 'Six consecutive points increasing or decreasing',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart: 'individuals',
      });
    }
  }

  for (let i = 6; i < values.length; i++) {
    const window = values.slice(i - 6, i + 1);
    const allAbove = window.every((v) => v > cl);
    const allBelow = window.every((v) => v < cl);
    if (allAbove || allBelow) {
      violations.push({
        rule: 6,
        ruleName: '7 consecutive same side',
        description: 'Seven consecutive points above or below center line',
        pointIndex: i + 1,
        batch: batches[i] || `Point ${i + 1}`,
        chart: 'individuals',
      });
    }
  }

  return violations;
}

function mapChartPoints(
  result: SpcChartResult,
  dates: string[],
): SpcChartPoint[] {
  return result.points.map((p, idx) => ({
    index: p.index,
    label: p.batch,
    batchNumber: p.batch,
    date: dates[idx] || '',
    value: p.value,
    movingRange: p.movingRange,
    centerLine: result.limits.centerLine,
    ucl: result.limits.ucl,
    lcl: result.limits.lcl,
    outOfControl: p.outOfControl,
    violated: p.specialCause,
  }));
}

function violationSeverity(
  violation: SpcRuleViolation,
  ooc: boolean,
  critical: boolean,
): typeof VIOLATION_SEVERITIES[number] {
  if (ooc && critical) return 'Critical';
  if (ooc || violation.rule === 1) return 'High';
  if (violation.rule <= 3) return 'Medium';
  return 'Low';
}

function mapViolations(
  allViolations: SpcRuleViolation[],
  points: SpcChartPoint[],
  dates: string[],
  product: string,
  parameter: string,
  spcRecordId: string,
): SpcRuleViolationRecord[] {
  const seen = new Set<string>();
  const records: SpcRuleViolationRecord[] = [];
  allViolations.forEach((v, i) => {
    const key = `${v.chart}-${v.pointIndex}-${v.rule}`;
    if (seen.has(key)) return;
    seen.add(key);
    const point = points.find((p) => p.index === v.pointIndex);
    const ooc = point?.outOfControl ?? false;
    const critical = isCriticalParameter(parameter);
    records.push({
      violationId: buildViolationId(i),
      spcRecordId,
      product,
      batchNumber: v.batch,
      parameter,
      violationType: v.ruleName,
      dataPointValue: point?.value ?? 0,
      dataPointDate: dates[v.pointIndex - 1] || '',
      ruleDescription: v.description,
      severity: violationSeverity(v, ooc, critical),
      actionRequired: ooc || v.rule <= 2,
    });
  });
  return records;
}

function evaluateSpcRisk(
  status: typeof SPC_STATUSES[number],
  parameterName: string,
): typeof RISK_LEVELS[number] {
  const critical = isCriticalParameter(parameterName);
  if (status === 'Out Of Control') return critical ? 'Critical' : 'High';
  if (status === 'Warning') return 'Medium';
  return 'Low';
}

export function calculateSpcAnalysis(
  points: SpcSourcePoint[],
  form: Pick<SpcFormData, 'productName' | 'parameterName' | 'subgroupSize'>,
  spcRecordId = 'preview',
): SpcCalculationResult {
  const sorted = points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const values = sorted.map((p) => p.value);
  const batches = sorted.map((p) => p.batchNumber);
  const dates = sorted.map((p) => p.date);
  const batchCount = new Set(batches).size;
  const lslPoint = sorted.find((p) => Number.isFinite(p.lsl));
  const uslPoint = sorted.find((p) => Number.isFinite(p.usl));
  const lsl = lslPoint?.lsl ?? 0;
  const usl = uslPoint?.usl ?? 0;

  const empty: SpcCalculationResult = {
    batchCount,
    dataPointsCount: values.length,
    mean: 0,
    median: 0,
    mode: null,
    range: 0,
    variance: 0,
    centerLine: 0,
    upperControlLimit: 0,
    lowerControlLimit: 0,
    upperSpecificationLimit: Number.isFinite(usl) ? usl : 0,
    lowerSpecificationLimit: Number.isFinite(lsl) ? lsl : 0,
    movingRangeAverage: 0,
    averageRange: 0,
    standardDeviation: 0,
    cp: 0,
    cpk: 0,
    cpu: 0,
    cpl: 0,
    pp: 0,
    ppk: 0,
    sigmaLevel: 0,
    zScoreMean: 0,
    confidenceIntervalLow: 0,
    confidenceIntervalHigh: 0,
    skewness: 0,
    kurtosis: 0,
    outlierCount: 0,
    ewmaLast: 0,
    cusumHighLast: 0,
    cusumLowLast: 0,
    ewmaData: [],
    cusumHighData: [],
    cusumLowData: [],
    sChartData: [],
    processDriftDetected: false,
    specialCauseVariation: false,
    commonCauseOnly: true,
    healthScore: 0,
    confidenceScore: 0,
    aiRecommendation: 'Insufficient data — collect at least 5 points for SPC.',
    goldenBatchNumber: '',
    goldenBatchDelta: 0,
    forecastNext: 0,
    westernElectricCount: 0,
    nelsonRuleCount: 0,
    spcStatus: 'Insufficient Data',
    ruleViolationsCount: 0,
    outOfControlPoints: 0,
    riskLevel: 'Low',
    capaSuggested: false,
    deviationRequired: false,
    chartData: [],
    movingRangeData: [],
    xbarChartData: [],
    rChartData: [],
    violations: [],
  };

  if (values.length < 5) return empty;

  const n = values.length;
  const observations = toObservations(sorted, form.productName, form.parameterName);
  const analysis = runSpcAnalysis(observations, form.subgroupSize || 4);

  const individuals = analysis.individuals;
  const mrValues = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const mrBar = mrValues.length ? mrValues.reduce((s, v) => s + v, 0) / mrValues.length : 0;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const sortedVals = [...values].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sortedVals[mid] : (sortedVals[mid - 1] + sortedVals[mid]) / 2;
  const freq = new Map<number, number>();
  sortedVals.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
  let mode: number | null = null;
  let maxF = 1;
  freq.forEach((f, v) => { if (f > maxF) { maxF = f; mode = v; } });
  const min = sortedVals[0];
  const max = sortedVals[n - 1];
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);

  // I-chart: UCL/LCL = X̄ ± 2.66 × MR̄ (equivalent to 3σ with σ = MR̄/d2, d2=1.128)
  if (mrBar > 0) {
    individuals.limits = {
      centerLine: round(mean),
      ucl: round(mean + 2.66 * mrBar),
      lcl: round(mean - 2.66 * mrBar),
    };
  } else {
    individuals.limits = { centerLine: round(mean), ucl: round(mean), lcl: round(mean) };
  }

  const extended = detectExtendedRules(values, batches, dates, individuals.limits);
  const allViolations = [...individuals.violations, ...extended];
  individuals.violations = allViolations;

  const chartData = mapChartPoints(individuals, dates);
  const movingRangeData = mapChartPoints(analysis.movingRange, dates.slice(1));
  const xbarChartData = mapChartPoints(analysis.xbar, []);
  const rChartData = mapChartPoints(analysis.rChart, []);

  chartData.forEach((p) => {
    const v = values[p.index - 1];
    if (v != null) {
      p.outOfControl = v > individuals.limits.ucl || v < individuals.limits.lcl;
      p.violated = p.outOfControl || allViolations.some((vi) => vi.pointIndex === p.index);
    }
  });

  // EWMA (λ=0.2)
  const lambda = 0.2;
  const ewmaVals: number[] = [values[0]];
  for (let i = 1; i < n; i++) ewmaVals.push(lambda * values[i] + (1 - lambda) * ewmaVals[i - 1]);
  const ewmaSigma = sd * Math.sqrt(lambda / (2 - lambda));
  const ewmaData: SpcChartPoint[] = ewmaVals.map((v, i) => ({
    index: i + 1,
    label: batches[i],
    batchNumber: batches[i],
    date: dates[i],
    value: round(v),
    movingRange: 0,
    centerLine: round(mean),
    ucl: round(mean + 3 * ewmaSigma),
    lcl: round(mean - 3 * ewmaSigma),
    outOfControl: v > mean + 3 * ewmaSigma || v < mean - 3 * ewmaSigma,
    violated: false,
  }));

  // CUSUM
  const k = (sd || 1) * 0.5;
  let sh = 0;
  let sl = 0;
  const cusumHighData: SpcChartPoint[] = [];
  const cusumLowData: SpcChartPoint[] = [];
  values.forEach((v, i) => {
    sh = Math.max(0, sh + (v - mean) - k);
    sl = Math.max(0, sl + (mean - v) - k);
    const h = 5 * (sd || 1);
    cusumHighData.push({
      index: i + 1, label: batches[i], batchNumber: batches[i], date: dates[i],
      value: round(sh), movingRange: 0, centerLine: 0, ucl: round(h), lcl: 0,
      outOfControl: sh > h, violated: sh > h,
    });
    cusumLowData.push({
      index: i + 1, label: batches[i], batchNumber: batches[i], date: dates[i],
      value: round(sl), movingRange: 0, centerLine: 0, ucl: round(h), lcl: 0,
      outOfControl: sl > h, violated: sl > h,
    });
  });

  // S-chart from subgroups (use within-subgroup SD when enough points)
  const subgroupSize = Math.min(Math.max(2, form.subgroupSize || 4), 10);
  const sChartData: SpcChartPoint[] = [];
  for (let i = 0; i + subgroupSize <= n; i += subgroupSize) {
    const group = values.slice(i, i + subgroupSize);
    const gMean = group.reduce((s, v) => s + v, 0) / group.length;
    const gVar = group.reduce((s, v) => s + (v - gMean) ** 2, 0) / (group.length - 1);
    const s = Math.sqrt(gVar);
    const idx = Math.floor(i / subgroupSize) + 1;
    sChartData.push({
      index: idx,
      label: `SG${idx}`,
      batchNumber: batches[i],
      date: dates[i],
      value: round(s),
      movingRange: 0,
      centerLine: round(sd),
      ucl: round(sd * 2),
      lcl: 0,
      outOfControl: s > sd * 2,
      violated: s > sd * 2,
    });
  }

  const outOfControlPoints = chartData.filter((p) => p.outOfControl).length;
  const violations = mapViolations(
    [...allViolations, ...analysis.movingRange.violations, ...analysis.xbar.violations, ...analysis.rChart.violations],
    chartData,
    dates,
    form.productName,
    form.parameterName,
    spcRecordId,
  );

  const westernElectricCount = violations.filter((v) => /Rule [1-4]|Western|Beyond 3|2 of 3|4 of 5|8 consecutive/.test(v.violationType)).length;
  const nelsonRuleCount = violations.filter((v) => /Nelson|trend|Alternating|Stratification|Mixture|same side|near control/i.test(v.violationType)).length;

  let outlierCount = 0;
  if (n >= 4) {
    const q1 = sortedVals[Math.floor(n * 0.25)];
    const q3 = sortedVals[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    outlierCount = sortedVals.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;
  }

  let m3 = 0;
  let m4 = 0;
  if (sd > 0) {
    values.forEach((v) => {
      const d = (v - mean) / sd;
      m3 += d ** 3;
      m4 += d ** 4;
    });
  }
  const skewness = round(m3 / n);
  const kurtosis = round(m4 / n - 3);
  const se = sd / Math.sqrt(n);
  const confidenceIntervalLow = round(mean - 1.96 * se);
  const confidenceIntervalHigh = round(mean + 1.96 * se);

  const withinSd = mrBar > 0 ? mrBar / 1.128 : sd;
  let cp = 0; let cpu = 0; let cpl = 0; let cpk = 0; let pp = 0; let ppk = 0;
  if (Number.isFinite(lsl) && Number.isFinite(usl) && usl > lsl && withinSd > 0) {
    cp = (usl - lsl) / (6 * withinSd);
    cpu = (usl - mean) / (3 * withinSd);
    cpl = (mean - lsl) / (3 * withinSd);
    cpk = Math.min(cpu, cpl);
    pp = sd > 0 ? (usl - lsl) / (6 * sd) : 0;
    ppk = sd > 0 ? Math.min((usl - mean) / (3 * sd), (mean - lsl) / (3 * sd)) : 0;
  }

  // Drift: regression slope vs SD
  let sumX = 0; let sumY = 0; let sumXY = 0; let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += values[i]; sumXY += i * values[i]; sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const processDriftDetected = Math.abs(slope) > (sd || 1) * 0.05;
  const specialCauseVariation = outOfControlPoints > 0 || violations.length > 0;
  const commonCauseOnly = !specialCauseVariation;

  const goldenSlice = sorted.slice(0, Math.max(1, Math.floor(n * 0.3)));
  const goldenIdx = goldenSlice.reduce((best, p, i) => (
    Math.abs(p.value - mean) < Math.abs(goldenSlice[best].value - mean) ? i : best
  ), 0);
  const golden = goldenSlice[goldenIdx];

  let spcStatus: typeof SPC_STATUSES[number] = 'In Control';
  if (outOfControlPoints > 0) spcStatus = 'Out Of Control';
  else if (violations.length > 0 || processDriftDetected) spcStatus = 'Warning';

  const capaSuggested = outOfControlPoints > 0
    || violations.filter((v) => v.severity === 'Critical' || v.severity === 'High').length > 0;
  const deviationRequired = outOfControlPoints > 0 || spcStatus === 'Out Of Control';

  let healthScore = 100;
  if (outOfControlPoints) healthScore -= Math.min(40, outOfControlPoints * 12);
  if (violations.length) healthScore -= Math.min(25, violations.length * 3);
  if (processDriftDetected) healthScore -= 10;
  if (cpk > 0 && cpk < 1.33) healthScore -= 10;
  healthScore = Math.max(0, Math.min(100, healthScore));
  const confidenceScore = Math.max(20, Math.min(99, round(45 + Math.min(35, n) + (commonCauseOnly ? 10 : 0) - outlierCount * 2, 1)));

  const tips: string[] = [];
  if (outOfControlPoints > 0) tips.push(`${outOfControlPoints} OOC point(s) — investigate special causes and consider deviation.`);
  if (westernElectricCount > 0) tips.push(`${westernElectricCount} Western Electric signal(s) detected.`);
  if (nelsonRuleCount > 0) tips.push(`${nelsonRuleCount} Nelson rule signal(s) detected.`);
  if (processDriftDetected) tips.push(`Process drift detected (slope ${round(slope, 4)}) — compare to golden batch.`);
  if (cpk > 0 && cpk < 1.33) tips.push(`Cpk ${round(cpk)} below target (≥1.33).`);
  if (!tips.length) tips.push(`Process In Control — health ${round(healthScore, 1)}. Continue routine SPC monitoring.`);

  return {
    batchCount,
    dataPointsCount: n,
    mean: round(mean),
    median: round(median),
    mode: mode == null ? null : round(mode),
    range: round(max - min),
    variance: round(variance),
    centerLine: individuals.limits.centerLine,
    upperControlLimit: individuals.limits.ucl,
    lowerControlLimit: individuals.limits.lcl,
    upperSpecificationLimit: usl,
    lowerSpecificationLimit: lsl,
    movingRangeAverage: round(mrBar),
    averageRange: round(analysis.rChart.limits.centerLine),
    standardDeviation: round(sd),
    cp: round(cp),
    cpk: round(cpk),
    cpu: round(cpu),
    cpl: round(cpl),
    pp: round(pp),
    ppk: round(ppk),
    sigmaLevel: cpk > 0 ? round(cpk * 3) : (sd > 0 ? round(Math.abs(mean) / sd) : 0),
    zScoreMean: sd > 0 ? round((values[n - 1] - mean) / sd) : 0,
    confidenceIntervalLow,
    confidenceIntervalHigh,
    skewness,
    kurtosis,
    outlierCount,
    ewmaLast: round(ewmaVals[ewmaVals.length - 1] || mean),
    cusumHighLast: cusumHighData[cusumHighData.length - 1]?.value || 0,
    cusumLowLast: cusumLowData[cusumLowData.length - 1]?.value || 0,
    ewmaData: ewmaData.slice(0, 100),
    cusumHighData: cusumHighData.slice(0, 100),
    cusumLowData: cusumLowData.slice(0, 100),
    sChartData: sChartData.slice(0, 50),
    processDriftDetected,
    specialCauseVariation,
    commonCauseOnly,
    healthScore: round(healthScore, 1),
    confidenceScore,
    aiRecommendation: tips.join(' '),
    goldenBatchNumber: golden?.batchNumber || '',
    goldenBatchDelta: golden ? round(Math.abs(values[n - 1] - golden.value)) : 0,
    forecastNext: round(intercept + slope * n),
    westernElectricCount,
    nelsonRuleCount,
    spcStatus,
    ruleViolationsCount: violations.length,
    outOfControlPoints,
    riskLevel: evaluateSpcRisk(spcStatus, form.parameterName),
    capaSuggested,
    deviationRequired,
    chartData,
    movingRangeData,
    xbarChartData,
    rChartData,
    violations,
  };
}

export function summarizeSpcRecords(records: SpcRecord[]): SpcSummary {
  return {
    total: records.length,
    inControl: records.filter((r) => r.spcStatus === 'In Control').length,
    outOfControl: records.filter((r) => r.spcStatus === 'Out Of Control').length,
    warning: records.filter((r) => r.spcStatus === 'Warning').length,
    insufficient: records.filter((r) => r.spcStatus === 'Insufficient Data').length,
    ruleViolations: records.reduce((s, r) => s + r.ruleViolationsCount, 0),
    highRisk: records.filter((r) => r.riskLevel === 'High').length,
    criticalRisk: records.filter((r) => r.riskLevel === 'Critical').length,
    capaSuggested: records.filter((r) => r.capaSuggested).length,
  };
}

export function buildSpcCharts(records: SpcRecord[]) {
  const statusMap = new Map<string, number>();
  records.forEach((r) => statusMap.set(r.spcStatus, (statusMap.get(r.spcStatus) || 0) + 1));
  const statusDistribution = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

  const riskMap = new Map<string, number>();
  records.forEach((r) => riskMap.set(r.riskLevel, (riskMap.get(r.riskLevel) || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  const byMonth = new Map<string, number>();
  records.forEach((r) => {
    const key = (r.generatedDate || r.createdAt).slice(0, 7);
    byMonth.set(key, (byMonth.get(key) || 0) + r.ruleViolationsCount);
  });
  const violationTrend = Array.from(byMonth.entries())
    .map(([month, count]) => ({ month, violations: count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const paramMap = new Map<string, { ok: number; issues: number }>();
  records.forEach((r) => {
    const e = paramMap.get(r.parameterName) || { ok: 0, issues: 0 };
    if (r.spcStatus === 'In Control') e.ok += 1;
    else e.issues += 1;
    paramMap.set(r.parameterName, e);
  });
  const parameterHealth = Array.from(paramMap.entries()).map(([parameter, v]) => ({
    parameter,
    ok: v.ok,
    issues: v.issues,
  }));

  const productMap = new Map<string, { ok: number; issues: number }>();
  records.forEach((r) => {
    const e = productMap.get(r.productName) || { ok: 0, issues: 0 };
    if (r.spcStatus === 'In Control') e.ok += 1;
    else e.issues += 1;
    productMap.set(r.productName, e);
  });
  const productHealth = Array.from(productMap.entries()).map(([product, v]) => ({
    product,
    ok: v.ok,
    issues: v.issues,
  }));

  return { statusDistribution, riskDistribution, violationTrend, parameterHealth, productHealth };
}
