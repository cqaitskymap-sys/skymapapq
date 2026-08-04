import { z } from 'zod';

export const TREND_ANALYSIS_COLLECTION = 'trend_analysis';
export const TREND_ANALYSIS_LEGACY = ['cpv_trends'] as const;
export const TREND_ANALYSIS_MODULE = 'Trend Analysis';

export const TREND_TYPES = [
  'CPP Trend',
  'CQA Trend',
  'Yield Trend',
  'Stability Trend',
  'Raw Material Trend',
  'Packing Material Trend',
  'Utility Trend',
  'Environmental Trend',
  'Hold Time Trend',
  'Combined Trend',
] as const;

export const DATA_SOURCES = [
  'CPP Results',
  'CQA Results',
  'Yield Monitoring',
  'Stability Monitoring',
  'Raw Material Monitoring',
  'Packing Material Monitoring',
  'Utility Monitoring',
  'Environmental Monitoring',
  'Hold Time Monitoring',
] as const;

export const PARAMETER_TYPES = [
  'CPP',
  'CQA',
  'Yield',
  'Stability',
  'Raw Material',
  'Packing Material',
  'Utility',
  'Environmental',
  'Hold Time',
] as const;

export const TREND_DIRECTIONS = [
  'Increasing',
  'Decreasing',
  'Stable',
  'Fluctuating',
  'No Data',
] as const;

export const TREND_STATUSES = [
  'Normal',
  'Alert',
  'OOT',
  'OOS',
  'Action Required',
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

export const DEFAULT_PQR_TRENDS = [
  'Assay Trend',
  'pH Trend',
  'Extractable Volume Trend',
  'Particulate Matter >=10µm Trend',
  'Particulate Matter >=25µm Trend',
  'Methyl Paraben Trend',
  'Propyl Paraben Trend',
  'Bulk Yield Trend',
  'Filling Yield Trend',
  'Packing Yield Trend',
  'Fill Volume Trend',
  'Sterilization Temperature Trend',
  'Filtration Pressure Trend',
  'Room Temperature Trend',
  'Relative Humidity Trend',
  'Differential Pressure Trend',
  'Hold Time Trend',
  'Stability Assay Trend',
  'Stability pH Trend',
] as const;

const requiredText = z.string().trim().min(1, 'Required');

export const trendAnalysisFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  trendType: z.enum(TREND_TYPES),
  dataSource: z.enum(DATA_SOURCES),
  parameterType: z.enum(PARAMETER_TYPES),
  parameterCode: requiredText,
  parameterName: requiredText,
  reviewPeriodFrom: requiredText,
  reviewPeriodTo: requiredText,
  conclusion: z.string().trim().default(''),
  recommendation: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => {
  const from = new Date(d.reviewPeriodFrom);
  const to = new Date(d.reviewPeriodTo);
  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to > from;
}, { message: 'Review period end must be after start', path: ['reviewPeriodTo'] });

export type TrendAnalysisFormData = z.infer<typeof trendAnalysisFormSchema>;

export interface TrendSourcePoint {
  batchNumber: string;
  value: number;
  date: string;
  lsl?: number;
  usl?: number;
  target?: number;
  alertLow?: number;
  alertHigh?: number;
  actionLow?: number;
  actionHigh?: number;
}

export interface TrendChartPoint extends TrendSourcePoint {
  label: string;
  mean: number;
  isOOS: boolean;
  isOOT: boolean;
  isAlert: boolean;
  isAction: boolean;
}

export interface TrendAnalysisRecord extends TrendAnalysisFormData, Record<string, unknown> {
  id: string;
  trendId: string;
  batchCount: number;
  dataPointsCount: number;
  mean: number;
  median: number;
  mode: number | null;
  minimumValue: number;
  maximumValue: number;
  range: number;
  variance: number;
  standardDeviation: number;
  movingAverage: number;
  weightedAverage: number;
  rollingAverage: number;
  regressionSlope: number;
  regressionIntercept: number;
  regressionR2: number;
  correlation: number;
  covariance: number;
  zScoreMean: number;
  sigmaLevel: number;
  cp: number;
  cpk: number;
  pp: number;
  ppk: number;
  ucl: number;
  lcl: number;
  ewmaLast: number;
  cusumHighLast: number;
  cusumLowLast: number;
  outlierCount: number;
  forecastNext: number;
  forecastSeries: number[];
  processDriftDetected: boolean;
  qualityDegradation: boolean;
  healthScore: number;
  confidenceScore: number;
  aiRecommendation: string;
  goldenBatchNumber: string;
  goldenBatchDelta: number;
  trendDirection: typeof TREND_DIRECTIONS[number];
  trendStatus: typeof TREND_STATUSES[number];
  riskLevel: typeof RISK_LEVELS[number];
  ootCount: number;
  oosCount: number;
  alertCount: number;
  actionCount: number;
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
  chartData: TrendChartPoint[];
  sourcePreview: TrendSourcePoint[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface TrendAnalysisSummary {
  total: number;
  normal: number;
  alert: number;
  oot: number;
  oos: number;
  actionRequired: number;
  highRisk: number;
  criticalRisk: number;
  capaSuggested: number;
}

export interface TrendCalculationResult {
  batchCount: number;
  dataPointsCount: number;
  mean: number;
  median: number;
  mode: number | null;
  minimumValue: number;
  maximumValue: number;
  range: number;
  variance: number;
  standardDeviation: number;
  movingAverage: number;
  weightedAverage: number;
  rollingAverage: number;
  regressionSlope: number;
  regressionIntercept: number;
  regressionR2: number;
  correlation: number;
  covariance: number;
  zScoreMean: number;
  sigmaLevel: number;
  cp: number;
  cpk: number;
  pp: number;
  ppk: number;
  ucl: number;
  lcl: number;
  ewmaLast: number;
  cusumHighLast: number;
  cusumLowLast: number;
  outlierCount: number;
  forecastNext: number;
  forecastSeries: number[];
  processDriftDetected: boolean;
  qualityDegradation: boolean;
  healthScore: number;
  confidenceScore: number;
  aiRecommendation: string;
  goldenBatchNumber: string;
  goldenBatchDelta: number;
  trendDirection: typeof TREND_DIRECTIONS[number];
  trendStatus: typeof TREND_STATUSES[number];
  riskLevel: typeof RISK_LEVELS[number];
  ootCount: number;
  oosCount: number;
  alertCount: number;
  actionCount: number;
  capaSuggested: boolean;
  deviationRequired: boolean;
  chartData: TrendChartPoint[];
  values: number[];
}

function round(n: number, d = 3): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** d) / 10 ** d;
}

export function buildTrendId(productCode: string, parameterCode: string): string {
  const year = new Date().getFullYear();
  return `TREND-${productCode}-${parameterCode}-${year}`.replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}

export function dataSourceForParameterType(type: typeof PARAMETER_TYPES[number]): typeof DATA_SOURCES[number] {
  const map: Record<string, typeof DATA_SOURCES[number]> = {
    CPP: 'CPP Results',
    CQA: 'CQA Results',
    Yield: 'Yield Monitoring',
    Stability: 'Stability Monitoring',
    'Raw Material': 'Raw Material Monitoring',
    'Packing Material': 'Packing Material Monitoring',
    Utility: 'Utility Monitoring',
    Environmental: 'Environmental Monitoring',
    'Hold Time': 'Hold Time Monitoring',
  };
  return map[type];
}

export function trendTypeForDataSource(source: typeof DATA_SOURCES[number]): typeof TREND_TYPES[number] {
  const map: Record<string, typeof TREND_TYPES[number]> = {
    'CPP Results': 'CPP Trend',
    'CQA Results': 'CQA Trend',
    'Yield Monitoring': 'Yield Trend',
    'Stability Monitoring': 'Stability Trend',
    'Raw Material Monitoring': 'Raw Material Trend',
    'Packing Material Monitoring': 'Packing Material Trend',
    'Utility Monitoring': 'Utility Trend',
    'Environmental Monitoring': 'Environmental Trend',
    'Hold Time Monitoring': 'Hold Time Trend',
  };
  return map[source] || 'Combined Trend';
}

export function parameterTypeForDataSource(source: typeof DATA_SOURCES[number]): typeof PARAMETER_TYPES[number] {
  const map: Record<string, typeof PARAMETER_TYPES[number]> = {
    'CPP Results': 'CPP',
    'CQA Results': 'CQA',
    'Yield Monitoring': 'Yield',
    'Stability Monitoring': 'Stability',
    'Raw Material Monitoring': 'Raw Material',
    'Packing Material Monitoring': 'Packing Material',
    'Utility Monitoring': 'Utility',
    'Environmental Monitoring': 'Environmental',
    'Hold Time Monitoring': 'Hold Time',
  };
  return map[source];
}

function isCriticalParameter(parameterName: string): boolean {
  const critical = ['Sterility', 'Assay', 'Bacterial Endotoxin', 'Fill Volume', 'pH', 'Endotoxin'];
  return critical.some((p) => parameterName.toLowerCase().includes(p.toLowerCase()));
}

function evaluatePointStatus(
  value: number,
  point: TrendSourcePoint,
): { isOOS: boolean; isOOT: boolean; isAlert: boolean; isAction: boolean } {
  const lsl = point.lsl;
  const usl = point.usl;
  let isOOS = false;
  let isAction = false;
  let isAlert = false;

  if (Number.isFinite(lsl) && value < (lsl as number)) isOOS = true;
  if (Number.isFinite(usl) && value > (usl as number)) isOOS = true;

  if (!isOOS) {
    const actionLow = point.actionLow;
    const actionHigh = point.actionHigh;
    const alertLow = point.alertLow;
    const alertHigh = point.alertHigh;
    if (Number.isFinite(actionLow) && value < actionLow!) isAction = true;
    if (Number.isFinite(actionHigh) && value > actionHigh!) isAction = true;
    if (!isAction) {
      if (Number.isFinite(alertLow) && value < alertLow!) isAlert = true;
      if (Number.isFinite(alertHigh) && value > alertHigh!) isAlert = true;
    }
  }

  return { isOOS, isOOT: false, isAlert, isAction };
}

function detectConsecutiveDirectionAlert(values: number[]): boolean {
  if (values.length < 3) return false;
  let streak = 0;
  let lastDir = 0;
  for (let i = 1; i < values.length; i++) {
    const dir = values[i] > values[i - 1] ? 1 : values[i] < values[i - 1] ? -1 : 0;
    if (dir !== 0 && dir === lastDir) streak += 1;
    else {
      streak = dir !== 0 ? 1 : 0;
      lastDir = dir;
    }
    if (streak >= 2) return true;
  }
  return false;
}

export function canCreateTrendForDataSource(
  role: string | undefined,
  dataSource: typeof DATA_SOURCES[number],
): boolean {
  if (!role) return false;
  if (['super_admin', 'admin'].includes(role)) return true;
  const qcSources: typeof DATA_SOURCES[number][] = [
    'CQA Results', 'Stability Monitoring', 'Raw Material Monitoring', 'Packing Material Monitoring',
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

function detectTrendDirection(values: number[]): typeof TREND_DIRECTIONS[number] {
  if (values.length < 3) return 'No Data';
  const n = values.length;
  const chunk = Math.max(1, Math.floor(n * 0.3));
  const first = values.slice(0, chunk);
  const last = values.slice(n - chunk);
  const firstMean = first.reduce((s, v) => s + v, 0) / first.length;
  const lastMean = last.reduce((s, v) => s + v, 0) / last.length;
  const overallMean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - overallMean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const range = Math.max(...values) - Math.min(...values);

  const allLastHigher = last.every((v) => v > firstMean);
  const allLastLower = last.every((v) => v < firstMean);

  if (lastMean > firstMean + sd * 0.25 && allLastHigher) return 'Increasing';
  if (lastMean < firstMean - sd * 0.25 && allLastLower) return 'Decreasing';
  if (sd <= range * 0.15 || sd < overallMean * 0.02) return 'Stable';
  return 'Fluctuating';
}

function detectOOT(
  value: number,
  point: TrendSourcePoint,
  direction: typeof TREND_DIRECTIONS[number],
  mean: number,
): boolean {
  const lsl = point.lsl;
  const usl = point.usl;
  if (!Number.isFinite(lsl) || !Number.isFinite(usl)) return false;
  const lslVal = lsl as number;
  const uslVal = usl as number;
  if (value < lslVal || value > uslVal) return false;
  const span = uslVal - lslVal;
  if (span <= 0) return false;
  const distToUpper = (uslVal - value) / span;
  const distToLower = (value - lslVal) / span;
  const nearLimit = distToUpper < 0.15 || distToLower < 0.15;
  const drifting = direction === 'Increasing' && distToUpper < 0.25
    || direction === 'Decreasing' && distToLower < 0.25;
  const awayFromMean = Math.abs(value - mean) > span * 0.2;
  return nearLimit && drifting && awayFromMean;
}

function evaluateTrendRisk(
  trendStatus: typeof TREND_STATUSES[number],
  parameterName: string,
): typeof RISK_LEVELS[number] {
  const critical = isCriticalParameter(parameterName);
  if (trendStatus === 'OOS') return critical ? 'Critical' : 'High';
  if (trendStatus === 'Action Required') return 'High';
  if (trendStatus === 'OOT') return critical ? 'Critical' : 'Medium';
  if (trendStatus === 'Alert') return 'Medium';
  return 'Low';
}

function linearRegression(values: number[]): { slope: number; intercept: number; r2: number } {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = values[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
    sumYY += y * y;
  }
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const ssTot = sumYY - (sumY * sumY) / n;
  const ssRes = values.reduce((s, y, i) => {
    const pred = intercept + slope * i;
    return s + (y - pred) ** 2;
  }, 0);
  const r2 = ssTot === 0 ? 1 : Math.max(0, Math.min(1, 1 - ssRes / ssTot));
  return { slope, intercept, r2 };
}

function computeEwma(values: number[], lambda = 0.2): number[] {
  if (!values.length) return [];
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(lambda * values[i] + (1 - lambda) * out[i - 1]);
  }
  return out;
}

function computeCusum(values: number[], mean: number, k = 0.5): { high: number[]; low: number[] } {
  const high: number[] = [];
  const low: number[] = [];
  let sh = 0;
  let sl = 0;
  values.forEach((v) => {
    sh = Math.max(0, sh + (v - mean) - k);
    sl = Math.max(0, sl + (mean - v) - k);
    high.push(round(sh));
    low.push(round(sl));
  });
  return { high, low };
}

function buildAiRecommendation(input: {
  direction: typeof TREND_DIRECTIONS[number];
  status: typeof TREND_STATUSES[number];
  drift: boolean;
  oos: number;
  oot: number;
  cpk: number;
  slope: number;
  parameterName: string;
  health: number;
}): string {
  const tips: string[] = [];
  if (input.oos > 0) tips.push(`${input.oos} OOS point(s) on ${input.parameterName} — initiate deviation investigation.`);
  if (input.oot > 0) tips.push(`${input.oot} OOT signal(s) — tighten monitoring and review control strategy.`);
  if (input.drift) tips.push('Process drift detected — compare against golden batch and evaluate special causes.');
  if (input.direction === 'Increasing' || input.direction === 'Decreasing') {
    tips.push(`${input.direction} trend (slope ${round(input.slope, 4)}) — forecast risk of specification breach.`);
  }
  if (input.cpk > 0 && input.cpk < 1.33) tips.push(`Cpk ${input.cpk} below pharma target (≥1.33) — reduce variation or re-center.`);
  if (input.status === 'Action Required') tips.push('Action limits breached — escalate to QA and consider CAPA.');
  if (!tips.length) tips.push(`Trend ${input.status} with health score ${input.health} — continue routine CPV monitoring.`);
  return tips.join(' ');
}

function emptyCalc(batchCount: number, values: number[]): TrendCalculationResult {
  return {
    batchCount,
    dataPointsCount: values.length,
    mean: 0,
    median: 0,
    mode: null,
    minimumValue: 0,
    maximumValue: 0,
    range: 0,
    variance: 0,
    standardDeviation: 0,
    movingAverage: 0,
    weightedAverage: 0,
    rollingAverage: 0,
    regressionSlope: 0,
    regressionIntercept: 0,
    regressionR2: 0,
    correlation: 0,
    covariance: 0,
    zScoreMean: 0,
    sigmaLevel: 0,
    cp: 0,
    cpk: 0,
    pp: 0,
    ppk: 0,
    ucl: 0,
    lcl: 0,
    ewmaLast: 0,
    cusumHighLast: 0,
    cusumLowLast: 0,
    outlierCount: 0,
    forecastNext: 0,
    forecastSeries: [],
    processDriftDetected: false,
    qualityDegradation: false,
    healthScore: 0,
    confidenceScore: 0,
    aiRecommendation: 'Insufficient data — collect at least 3 points.',
    goldenBatchNumber: '',
    goldenBatchDelta: 0,
    trendDirection: 'No Data',
    trendStatus: 'Insufficient Data',
    riskLevel: 'Low',
    ootCount: 0,
    oosCount: 0,
    alertCount: 0,
    actionCount: 0,
    capaSuggested: false,
    deviationRequired: false,
    chartData: [],
    values,
  };
}

export function calculateTrendAnalysis(points: TrendSourcePoint[], parameterName = ''): TrendCalculationResult {
  const sorted = points
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const values = sorted.map((p) => p.value);
  const batchCount = new Set(sorted.map((p) => p.batchNumber)).size;
  if (values.length < 3) return emptyCalc(batchCount, values);

  const n = values.length;
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
  const range = max - min;
  const variance = n > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);

  const window = Math.min(5, n);
  const recent = values.slice(-window);
  const movingAverage = recent.reduce((s, v) => s + v, 0) / recent.length;
  const weightSum = recent.reduce((s, _, i) => s + (i + 1), 0);
  const weightedAverage = recent.reduce((s, v, i) => s + v * (i + 1), 0) / weightSum;
  const rollingAverage = movingAverage;

  const { slope, intercept, r2 } = linearRegression(values);
  const xs = values.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const cov = values.reduce((s, y, i) => s + (xs[i] - xMean) * (y - mean), 0) / (n - 1 || 1);
  const xVar = xs.reduce((s, x) => s + (x - xMean) ** 2, 0) / (n - 1 || 1);
  const correlation = sd > 0 && xVar > 0 ? cov / (Math.sqrt(xVar) * sd) : 0;

  const direction = detectTrendDirection(values);
  const consecutiveAlert = detectConsecutiveDirectionAlert(values);
  const processDriftDetected = Math.abs(slope) > (sd || 1) * 0.05 && (direction === 'Increasing' || direction === 'Decreasing');

  let oosCount = 0;
  let ootCount = 0;
  let alertCount = 0;
  let actionCount = 0;

  const chartData: TrendChartPoint[] = sorted.map((p) => {
    const status = evaluatePointStatus(p.value, p);
    const isOOT = !status.isOOS && !status.isAction && detectOOT(p.value, p, direction, mean);
    if (status.isOOS) oosCount += 1;
    if (status.isAction) actionCount += 1;
    if (status.isAlert) alertCount += 1;
    if (isOOT) ootCount += 1;
    return {
      ...p,
      label: p.batchNumber || p.date.slice(0, 10),
      mean: round(mean),
      isOOS: status.isOOS,
      isOOT,
      isAlert: status.isAlert && !status.isOOS && !status.isAction,
      isAction: status.isAction,
    };
  });

  if (consecutiveAlert) alertCount += 1;

  let outlierCount = 0;
  if (n >= 4) {
    const q1 = sortedVals[Math.floor(n * 0.25)];
    const q3 = sortedVals[Math.floor(n * 0.75)];
    const iqr = q3 - q1;
    outlierCount = sortedVals.filter((v) => v < q1 - 1.5 * iqr || v > q3 + 1.5 * iqr).length;
  }

  const lslCandidates = sorted.map((p) => p.lsl).filter((v): v is number => Number.isFinite(v));
  const uslCandidates = sorted.map((p) => p.usl).filter((v): v is number => Number.isFinite(v));
  const lsl = lslCandidates.length ? Math.min(...lslCandidates) : NaN;
  const usl = uslCandidates.length ? Math.max(...uslCandidates) : NaN;
  let cp = 0;
  let cpk = 0;
  let pp = 0;
  let ppk = 0;
  if (Number.isFinite(lsl) && Number.isFinite(usl) && usl > lsl && sd > 0) {
    const withinSd = (() => {
      const mrs = values.slice(1).map((v, i) => Math.abs(v - values[i]));
      const mrBar = mrs.length ? mrs.reduce((s, v) => s + v, 0) / mrs.length : 0;
      return mrBar > 0 ? mrBar / 1.128 : sd;
    })();
    cp = (usl - lsl) / (6 * withinSd);
    cpk = Math.min((usl - mean) / (3 * withinSd), (mean - lsl) / (3 * withinSd));
    pp = (usl - lsl) / (6 * sd);
    ppk = Math.min((usl - mean) / (3 * sd), (mean - lsl) / (3 * sd));
  }

  const ucl = mean + 3 * sd;
  const lcl = mean - 3 * sd;
  const ewma = computeEwma(values);
  const cusum = computeCusum(values, mean, sd * 0.5 || 0.5);
  const forecastSeries = [1, 2, 3].map((h) => round(intercept + slope * (n - 1 + h)));
  const forecastNext = forecastSeries[0] || round(mean);

  const goldenSlice = sorted.slice(0, Math.max(1, Math.floor(n * 0.3)));
  const goldenIdx = goldenSlice.reduce((best, p, i) => {
    const d = Math.abs(p.value - mean);
    return d < Math.abs(goldenSlice[best].value - mean) ? i : best;
  }, 0);
  const golden = goldenSlice[goldenIdx];
  const goldenBatchNumber = golden?.batchNumber || '';
  const goldenBatchDelta = golden ? round(Math.abs(values[n - 1] - golden.value)) : 0;

  let trendStatus: typeof TREND_STATUSES[number] = 'Normal';
  if (oosCount > 0) trendStatus = 'OOS';
  else if (actionCount > 0) trendStatus = 'Action Required';
  else if (ootCount > 0) trendStatus = 'OOT';
  else if (alertCount > 0 || consecutiveAlert || processDriftDetected) trendStatus = 'Alert';

  const riskLevel = evaluateTrendRisk(trendStatus, parameterName);
  const capaSuggested = oosCount > 0 || (alertCount + ootCount) >= 2 || processDriftDetected;
  const deviationRequired = oosCount > 0 || trendStatus === 'Action Required';
  const qualityDegradation = processDriftDetected || ootCount > 0 || (cpk > 0 && cpk < 1.0);

  let healthScore = 100;
  if (oosCount) healthScore -= Math.min(40, oosCount * 15);
  if (ootCount) healthScore -= Math.min(25, ootCount * 8);
  if (alertCount) healthScore -= Math.min(15, alertCount * 3);
  if (processDriftDetected) healthScore -= 10;
  if (outlierCount) healthScore -= Math.min(10, outlierCount * 2);
  if (cpk > 0 && cpk < 1.33) healthScore -= 10;
  healthScore = Math.max(0, Math.min(100, healthScore));

  const confidenceScore = Math.max(20, Math.min(99, round(40 + Math.min(40, n * 2) + r2 * 20 - outlierCount * 2, 1)));
  const sigmaLevel = cpk > 0 ? round(cpk * 3) : (sd > 0 ? round(Math.abs(mean) / sd) : 0);
  const zScoreMean = sd > 0 ? round((values[n - 1] - mean) / sd) : 0;

  const aiRecommendation = buildAiRecommendation({
    direction, status: trendStatus, drift: processDriftDetected,
    oos: oosCount, oot: ootCount, cpk: round(cpk), slope, parameterName, health: healthScore,
  });

  return {
    batchCount,
    dataPointsCount: n,
    mean: round(mean),
    median: round(median),
    mode: mode == null ? null : round(mode),
    minimumValue: round(min),
    maximumValue: round(max),
    range: round(range),
    variance: round(variance),
    standardDeviation: round(sd),
    movingAverage: round(movingAverage),
    weightedAverage: round(weightedAverage),
    rollingAverage: round(rollingAverage),
    regressionSlope: round(slope, 6),
    regressionIntercept: round(intercept),
    regressionR2: round(r2, 4),
    correlation: round(correlation, 4),
    covariance: round(cov),
    zScoreMean,
    sigmaLevel,
    cp: round(cp),
    cpk: round(cpk),
    pp: round(pp),
    ppk: round(ppk),
    ucl: round(ucl),
    lcl: round(lcl),
    ewmaLast: round(ewma[ewma.length - 1] || mean),
    cusumHighLast: cusum.high[cusum.high.length - 1] || 0,
    cusumLowLast: cusum.low[cusum.low.length - 1] || 0,
    outlierCount,
    forecastNext,
    forecastSeries,
    processDriftDetected,
    qualityDegradation,
    healthScore: round(healthScore, 1),
    confidenceScore,
    aiRecommendation,
    goldenBatchNumber,
    goldenBatchDelta,
    trendDirection: direction,
    trendStatus,
    riskLevel,
    ootCount,
    oosCount,
    alertCount,
    actionCount,
    capaSuggested,
    deviationRequired,
    chartData,
    values,
  };
}

export function summarizeTrendAnalysis(records: TrendAnalysisRecord[]): TrendAnalysisSummary {
  return {
    total: records.length,
    normal: records.filter((r) => r.trendStatus === 'Normal').length,
    alert: records.filter((r) => r.trendStatus === 'Alert').length,
    oot: records.filter((r) => r.trendStatus === 'OOT').length,
    oos: records.filter((r) => r.trendStatus === 'OOS').length,
    actionRequired: records.filter((r) => r.trendStatus === 'Action Required').length,
    highRisk: records.filter((r) => r.riskLevel === 'High').length,
    criticalRisk: records.filter((r) => r.riskLevel === 'Critical').length,
    capaSuggested: records.filter((r) => r.capaSuggested).length,
  };
}

export function buildTrendAnalysisCharts(records: TrendAnalysisRecord[]) {
  const statusMap = new Map<string, number>();
  records.forEach((r) => statusMap.set(r.trendStatus, (statusMap.get(r.trendStatus) || 0) + 1));
  const statusDistribution = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

  const riskMap = new Map<string, number>();
  records.forEach((r) => riskMap.set(r.riskLevel, (riskMap.get(r.riskLevel) || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  const byMonth = new Map<string, { oos: number; oot: number }>();
  records.forEach((r) => {
    const key = (r.generatedDate || r.createdAt).slice(0, 7);
    const e = byMonth.get(key) || { oos: 0, oot: 0 };
    e.oos += r.oosCount;
    e.oot += r.ootCount;
    byMonth.set(key, e);
  });
  const monthlyOotOos = Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, oos: v.oos, oot: v.oot }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const paramMap = new Map<string, number>();
  records.forEach((r) => paramMap.set(r.parameterName, (paramMap.get(r.parameterName) || 0) + 1));
  const parameterTrendCount = Array.from(paramMap.entries())
    .map(([parameter, count]) => ({ parameter, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const productMap = new Map<string, { normal: number; issues: number }>();
  records.forEach((r) => {
    const e = productMap.get(r.productName) || { normal: 0, issues: 0 };
    if (r.trendStatus === 'Normal') e.normal += 1;
    else e.issues += 1;
    productMap.set(r.productName, e);
  });
  const productHealth = Array.from(productMap.entries()).map(([product, v]) => ({
    product,
    normal: v.normal,
    issues: v.issues,
  }));

  return { statusDistribution, riskDistribution, monthlyOotOos, parameterTrendCount, productHealth };
}
