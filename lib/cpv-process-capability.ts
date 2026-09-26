import { z } from 'zod';

export const PROCESS_CAPABILITY_COLLECTION = 'process_capability';
export const PROCESS_CAPABILITY_LEGACY = ['cpv_capability'] as const;
export const PROCESS_CAPABILITY_MODULE = 'Process Capability';

export const PARAMETER_TYPES = ['CPP', 'CQA', 'Yield', 'Stability', 'Hold Time', 'Environmental', 'Utility'] as const;
export const DATA_SOURCES = [
  'CPP Results',
  'CQA Results',
  'Yield Monitoring',
  'Stability Monitoring',
  'Hold Time Monitoring',
  'Environmental Monitoring',
  'Utility Monitoring',
] as const;

export const CAPABILITY_STATUSES = [
  'Excellent',
  'Acceptable',
  'Needs Improvement',
  'Poor',
  'Not Capable',
  'Insufficient Data',
  'Cannot Calculate',
] as const;

export const WORKFLOW_STATUSES = [
  'Draft',
  'Calculated',
  'Under Review',
  'Approved',
  'Rejected',
  'Archived',
] as const;

export const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

const requiredText = z.string().trim().min(1, 'Required');
const optionalNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().optional(),
);

export const processCapabilityFormSchema = z.object({
  capabilityCode: z.string().trim().default(''),
  studyNumber: z.string().trim().default(''),
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
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
  site: z.string().trim().default(''),
  parameterType: z.enum(PARAMETER_TYPES),
  parameterCode: requiredText,
  parameterName: requiredText,
  dataSource: z.enum(DATA_SOURCES),
  reviewPeriodFrom: requiredText,
  reviewPeriodTo: requiredText,
  lowerSpecificationLimit: z.coerce.number(),
  upperSpecificationLimit: z.coerce.number(),
  targetValue: optionalNum,
  ucl: optionalNum,
  lcl: optionalNum,
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
}, { message: 'Review period end must be after start', path: ['reviewPeriodTo'] }).refine(
  (d) => d.lowerSpecificationLimit < d.upperSpecificationLimit,
  { message: 'USL must be greater than LSL', path: ['upperSpecificationLimit'] },
);

export type ProcessCapabilityFormData = z.infer<typeof processCapabilityFormSchema>;

export interface ProcessCapabilityRecord extends ProcessCapabilityFormData, Record<string, unknown> {
  id: string;
  capabilityId: string;
  batchCount: number;
  sampleCount: number;
  mean: number;
  median: number;
  mode: number | null;
  minimumValue: number;
  maximumValue: number;
  range: number;
  variance: number;
  standardDeviation: number;
  movingRangeBar: number;
  withinStandardDeviation: number;
  cp: number;
  cpk: number;
  cpu: number;
  cpl: number;
  pp: number;
  ppk: number;
  ppu: number;
  ppl: number;
  sigmaLevel: number;
  zScoreLsl: number;
  zScoreUsl: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  skewness: number;
  kurtosis: number;
  normalityPValue: number | null;
  outlierCount: number;
  processPerformanceIndex: number;
  capabilityStatus: typeof CAPABILITY_STATUSES[number] | string;
  riskLevel: typeof RISK_LEVELS[number] | string;
  healthScore: number;
  aiRecommendation: string;
  reviewedBy: string;
  reviewDate: string;
  approvedBy: string;
  approvalDate: string;
  status: typeof WORKFLOW_STATUSES[number];
  capaRecommended: boolean;
  deviationRequired: boolean;
  linkedRiskId: string;
  linkedDeviationNumber: string;
  linkedCapaNumber: string;
  isLocked: boolean;
  sourcePreview: number[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface ProcessCapabilitySummary {
  total: number;
  excellent: number;
  acceptable: number;
  needsImprovement: number;
  notCapable: number;
  insufficient: number;
  averageCpk: number;
  averagePpk: number;
  averageCp: number;
  averageSigma: number;
  averageHealthScore: number;
  highRisk: number;
  capaRecommended: number;
  lowCpk: number;
}

export interface CapabilityCalculationResult {
  batchCount: number;
  sampleCount: number;
  mean: number;
  median: number;
  mode: number | null;
  minimumValue: number;
  maximumValue: number;
  range: number;
  variance: number;
  standardDeviation: number;
  movingRangeBar: number;
  withinStandardDeviation: number;
  cp: number;
  cpk: number;
  cpu: number;
  cpl: number;
  pp: number;
  ppk: number;
  ppu: number;
  ppl: number;
  sigmaLevel: number;
  zScoreLsl: number;
  zScoreUsl: number;
  confidenceIntervalLow: number;
  confidenceIntervalHigh: number;
  skewness: number;
  kurtosis: number;
  normalityPValue: number | null;
  outlierCount: number;
  processPerformanceIndex: number;
  capabilityStatus: typeof CAPABILITY_STATUSES[number];
  riskLevel: typeof RISK_LEVELS[number];
  capaRecommended: boolean;
  deviationRequired: boolean;
  healthScore: number;
  aiRecommendation: string;
  values: number[];
  ewma: number[];
  cusumHigh: number[];
  cusumLow: number[];
  westernElectricIndices: number[];
}

function round(n: number, d = 4): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10 ** d) / 10 ** d;
}

export function buildCapabilityId(productCode: string, parameterCode: string): string {
  const year = new Date().getFullYear();
  return `PCAP-${productCode}-${parameterCode}-${year}`.replace(/\s+/g, '-').toUpperCase().slice(0, 80);
}

export function buildCapabilityCode(productCode: string, parameterCode: string): string {
  return `CAP-${productCode}-${parameterCode}`.replace(/\s+/g, '-').toUpperCase().slice(0, 60);
}

export function evaluateCapabilityStatus(cpk: number, sampleCount: number, canCalculate: boolean): typeof CAPABILITY_STATUSES[number] {
  if (sampleCount < 5) return 'Insufficient Data';
  if (!canCalculate) return 'Cannot Calculate';
  if (cpk >= 1.67) return 'Excellent';
  if (cpk >= 1.33) return 'Acceptable';
  if (cpk >= 1.0) return 'Needs Improvement';
  if (cpk >= 0.67) return 'Poor';
  return 'Not Capable';
}

export function evaluateCapabilityRisk(
  capabilityStatus: string,
  parameterType: string,
  parameterName: string,
  cpk = 0,
): typeof RISK_LEVELS[number] {
  const critical = ['Sterility', 'Assay', 'Bacterial Endotoxin', 'Fill Volume', 'pH'];
  const isCritical = critical.some((p) => parameterName.toLowerCase().includes(p.toLowerCase()));
  if (capabilityStatus === 'Not Capable' || capabilityStatus === 'Poor' || cpk < 1.0) {
    if (isCritical && (parameterType === 'CQA' || parameterType === 'CPP')) return 'Critical';
    return 'High';
  }
  if (capabilityStatus === 'Needs Improvement' || cpk < 1.33) return 'Medium';
  return 'Low';
}

function computeMode(sorted: number[]): number | null {
  const freq = new Map<number, number>();
  sorted.forEach((v) => freq.set(v, (freq.get(v) || 0) + 1));
  let mode: number | null = null;
  let max = 1;
  freq.forEach((f, v) => {
    if (f > max) { max = f; mode = v; }
  });
  return mode;
}

function computeSkewnessKurtosis(values: number[], mean: number, stdDev: number): { skewness: number; kurtosis: number } {
  const n = values.length;
  if (n < 3 || stdDev <= 0) return { skewness: 0, kurtosis: 0 };
  let m3 = 0;
  let m4 = 0;
  values.forEach((v) => {
    const d = (v - mean) / stdDev;
    m3 += d ** 3;
    m4 += d ** 4;
  });
  return {
    skewness: round(m3 / n),
    kurtosis: round(m4 / n - 3), // excess kurtosis
  };
}

/** Approximate Shapiro–Wilk via skewness/kurtosis heuristic; returns p-like score 0–1 */
function approximateNormalityP(skewness: number, kurtosis: number, n: number): number | null {
  if (n < 8) return null;
  const score = Math.exp(-0.5 * (skewness ** 2 + kurtosis ** 2));
  return round(Math.min(1, Math.max(0, score)));
}

function detectOutliersIqr(sorted: number[]): number {
  if (sorted.length < 4) return 0;
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  return sorted.filter((v) => v < low || v > high).length;
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

export function detectWesternElectricViolations(values: number[]): number[] {
  if (values.length < 2) return [];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  if (stdDev <= 0) return [];
  return values
    .map((v, i) => (Math.abs(v - mean) > 3 * stdDev ? i : -1))
    .filter((i) => i >= 0);
}

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
    if (run.length === 9) violations.push({ rule: 'Nelson 2', indices: [...run] });
  });
  return violations;
}

export function buildHistogramBins(values: number[], binCount = 10): Array<{ bin: string; count: number; mid: number }> {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return [];
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (min === max) return [{ bin: String(round(min, 2)), count: clean.length, mid: min }];
  const width = (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, i) => ({
    low: min + i * width,
    high: min + (i + 1) * width,
    count: 0,
  }));
  clean.forEach((v) => {
    let idx = Math.floor((v - min) / width);
    if (idx >= binCount) idx = binCount - 1;
    if (idx < 0) idx = 0;
    bins[idx].count += 1;
  });
  return bins.map((b) => ({
    bin: `${round(b.low, 2)}–${round(b.high, 2)}`,
    count: b.count,
    mid: round((b.low + b.high) / 2, 2),
  }));
}

export function buildIndividualsChart(values: number[]): Array<{ i: number; x: number; ucl: number; lcl: number; cl: number }> {
  if (!values.length) return [];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const mrs = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const mrBar = mrs.length ? mrs.reduce((s, v) => s + v, 0) / mrs.length : 0;
  const sigma = mrBar / 1.128;
  const ucl = mean + 3 * sigma;
  const lcl = mean - 3 * sigma;
  return values.map((x, i) => ({
    i: i + 1,
    x: round(x),
    ucl: round(ucl),
    lcl: round(lcl),
    cl: round(mean),
  }));
}

export function buildMovingRangeChart(values: number[]): Array<{ i: number; mr: number; ucl: number; cl: number }> {
  if (values.length < 2) return [];
  const mrs = values.slice(1).map((v, i) => Math.abs(v - values[i]));
  const mrBar = mrs.reduce((s, v) => s + v, 0) / mrs.length;
  const ucl = 3.267 * mrBar; // D4 for n=2
  return mrs.map((mr, i) => ({
    i: i + 2,
    mr: round(mr),
    ucl: round(ucl),
    cl: round(mrBar),
  }));
}

export function computeHealthScore(cpk: number, ppk: number, outlierCount: number, sampleCount: number): number {
  let score = Math.min(100, Math.max(0, (Math.min(cpk, ppk) / 1.67) * 100));
  if (outlierCount > 0) score -= Math.min(20, outlierCount * 5);
  if (sampleCount < 10) score -= 5;
  return round(Math.max(0, Math.min(100, score)), 1);
}

export function buildAiRecommendation(input: {
  cpk: number;
  ppk: number;
  cp: number;
  status: string;
  outlierCount: number;
  skewness: number;
  parameterName: string;
}): string {
  const tips: string[] = [];
  if (input.cpk < 1.0) tips.push(`Cpk ${input.cpk} indicates process not capable for ${input.parameterName} — investigate special causes and consider CAPA.`);
  else if (input.cpk < 1.33) tips.push(`Cpk ${input.cpk} is below pharma target (≥1.33). Reduce variation or center the process.`);
  if (input.cp - input.cpk > 0.3) tips.push('Cp ≫ Cpk suggests process centering issue — adjust mean toward target.');
  if (input.ppk < input.cpk) tips.push('Ppk < Cpk indicates long-term variation exceeds short-term — review process stability over time.');
  if (input.outlierCount > 0) tips.push(`${input.outlierCount} outlier(s) detected — review Western Electric / Nelson rules and source data.`);
  if (Math.abs(input.skewness) > 1) tips.push('Distribution skewness is elevated — verify normality before relying on capability indices.');
  if (!tips.length) tips.push(`Capability ${input.status} — continue routine monitoring and trend surveillance.`);
  return tips.join(' ');
}

export function calculateProcessCapability(
  values: number[],
  lsl: number,
  usl: number,
  batchIds: string[] = [],
  parameterType: typeof PARAMETER_TYPES[number] | string = 'CPP',
  parameterName = '',
  target?: number,
): CapabilityCalculationResult {
  const clean = values.filter(Number.isFinite);
  const batchCount = new Set(batchIds.filter(Boolean)).size;
  const empty: CapabilityCalculationResult = {
    batchCount,
    sampleCount: clean.length,
    mean: 0,
    median: 0,
    mode: null,
    minimumValue: 0,
    maximumValue: 0,
    range: 0,
    variance: 0,
    standardDeviation: 0,
    movingRangeBar: 0,
    withinStandardDeviation: 0,
    cp: 0,
    cpk: 0,
    cpu: 0,
    cpl: 0,
    pp: 0,
    ppk: 0,
    ppu: 0,
    ppl: 0,
    sigmaLevel: 0,
    zScoreLsl: 0,
    zScoreUsl: 0,
    confidenceIntervalLow: 0,
    confidenceIntervalHigh: 0,
    skewness: 0,
    kurtosis: 0,
    normalityPValue: null,
    outlierCount: 0,
    processPerformanceIndex: 0,
    capabilityStatus: 'Insufficient Data',
    riskLevel: 'Low',
    capaRecommended: false,
    deviationRequired: false,
    healthScore: 0,
    aiRecommendation: 'Insufficient data for capability analysis (minimum 5 samples).',
    values: clean,
    ewma: [],
    cusumHigh: [],
    cusumLow: [],
    westernElectricIndices: [],
  };

  if (clean.length < 5) return empty;
  if (!Number.isFinite(lsl) || !Number.isFinite(usl) || lsl >= usl) {
    return { ...empty, capabilityStatus: 'Cannot Calculate', aiRecommendation: 'Cannot calculate — invalid LSL/USL.' };
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const n = clean.length;
  const mean = clean.reduce((s, v) => s + v, 0) / n;
  const mid = Math.floor(n / 2);
  const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const mode = computeMode(sorted);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Overall (sample) SD for Pp/Ppk — ASTM E2281 / ISO 22514 style
  const overallVariance = n > 1
    ? clean.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)
    : 0;
  const overallSd = Math.sqrt(overallVariance);

  // Within-subgroup estimate for Cp/Cpk via moving range (individuals, d2=1.128)
  const movingRanges = clean.slice(1).map((v, i) => Math.abs(v - clean[i]));
  const mrBar = movingRanges.length
    ? movingRanges.reduce((s, v) => s + v, 0) / movingRanges.length
    : 0;
  const withinSd = mrBar > 0 ? mrBar / 1.128 : overallSd;

  const { skewness, kurtosis } = computeSkewnessKurtosis(clean, mean, overallSd || withinSd);
  const normalityPValue = approximateNormalityP(skewness, kurtosis, n);
  const outlierCount = detectOutliersIqr(sorted);
  const ewma = computeEwma(clean);
  const cusum = computeCusum(clean, target ?? mean);
  const westernElectricIndices = detectWesternElectricViolations(clean);

  const se = overallSd / Math.sqrt(n);
  const confidenceIntervalLow = mean - 1.96 * se;
  const confidenceIntervalHigh = mean + 1.96 * se;

  if (overallSd === 0 && withinSd === 0) {
    const withinSpec = mean >= lsl && mean <= usl;
    const cpk = withinSpec ? 2 : 0;
    const status = evaluateCapabilityStatus(cpk, n, true);
    const healthScore = computeHealthScore(cpk, cpk, outlierCount, n);
    return {
      batchCount: batchCount || n,
      sampleCount: n,
      mean: round(mean),
      median: round(median),
      mode,
      minimumValue: round(min),
      maximumValue: round(max),
      range: round(max - min),
      variance: 0,
      standardDeviation: 0,
      movingRangeBar: 0,
      withinStandardDeviation: 0,
      cp: withinSpec ? 2 : 0,
      cpk,
      cpu: withinSpec ? 2 : 0,
      cpl: withinSpec ? 2 : 0,
      pp: withinSpec ? 2 : 0,
      ppk: cpk,
      ppu: withinSpec ? 2 : 0,
      ppl: withinSpec ? 2 : 0,
      sigmaLevel: round(cpk * 3),
      zScoreLsl: 0,
      zScoreUsl: 0,
      confidenceIntervalLow: round(mean),
      confidenceIntervalHigh: round(mean),
      skewness: 0,
      kurtosis: 0,
      normalityPValue,
      outlierCount,
      processPerformanceIndex: cpk,
      capabilityStatus: status,
      riskLevel: evaluateCapabilityRisk(status, parameterType, parameterName, cpk),
      capaRecommended: cpk < 1.0,
      deviationRequired: cpk < 1.0,
      healthScore,
      aiRecommendation: buildAiRecommendation({
        cpk, ppk: cpk, cp: withinSpec ? 2 : 0, status, outlierCount, skewness: 0, parameterName,
      }),
      values: clean,
      ewma,
      cusumHigh: cusum.high,
      cusumLow: cusum.low,
      westernElectricIndices,
    };
  }

  const cp = withinSd > 0 ? (usl - lsl) / (6 * withinSd) : 0;
  const cpu = withinSd > 0 ? (usl - mean) / (3 * withinSd) : 0;
  const cpl = withinSd > 0 ? (mean - lsl) / (3 * withinSd) : 0;
  const cpk = Math.min(cpu, cpl);
  const pp = overallSd > 0 ? (usl - lsl) / (6 * overallSd) : 0;
  const ppu = overallSd > 0 ? (usl - mean) / (3 * overallSd) : 0;
  const ppl = overallSd > 0 ? (mean - lsl) / (3 * overallSd) : 0;
  const ppk = Math.min(ppu, ppl);
  const status = evaluateCapabilityStatus(cpk, n, true);
  const healthScore = computeHealthScore(cpk, ppk, outlierCount, n);
  const zScoreLsl = overallSd > 0 ? (mean - lsl) / overallSd : 0;
  const zScoreUsl = overallSd > 0 ? (usl - mean) / overallSd : 0;
  const processPerformanceIndex = round(Math.min(ppk, cpk));

  return {
    batchCount: batchCount || n,
    sampleCount: n,
    mean: round(mean),
    median: round(median),
    mode: mode == null ? null : round(mode),
    minimumValue: round(min),
    maximumValue: round(max),
    range: round(max - min),
    variance: round(overallVariance),
    standardDeviation: round(overallSd),
    movingRangeBar: round(mrBar),
    withinStandardDeviation: round(withinSd),
    cp: round(cp),
    cpk: round(cpk),
    cpu: round(cpu),
    cpl: round(cpl),
    pp: round(pp),
    ppk: round(ppk),
    ppu: round(ppu),
    ppl: round(ppl),
    sigmaLevel: round(cpk * 3),
    zScoreLsl: round(zScoreLsl),
    zScoreUsl: round(zScoreUsl),
    confidenceIntervalLow: round(confidenceIntervalLow),
    confidenceIntervalHigh: round(confidenceIntervalHigh),
    skewness,
    kurtosis,
    normalityPValue,
    outlierCount,
    processPerformanceIndex,
    capabilityStatus: status,
    riskLevel: evaluateCapabilityRisk(status, parameterType, parameterName, cpk),
    capaRecommended: cpk < 1.0,
    deviationRequired: cpk < 1.0 || status === 'Not Capable',
    healthScore,
    aiRecommendation: buildAiRecommendation({
      cpk: round(cpk),
      ppk: round(ppk),
      cp: round(cp),
      status,
      outlierCount,
      skewness,
      parameterName,
    }),
    values: clean,
    ewma,
    cusumHigh: cusum.high,
    cusumLow: cusum.low,
    westernElectricIndices,
  };
}

export function summarizeProcessCapability(records: ProcessCapabilityRecord[]): ProcessCapabilitySummary {
  const valid = records.filter((r) => r.cpk > 0 && r.capabilityStatus !== 'Insufficient Data' && r.capabilityStatus !== 'Cannot Calculate');
  const avg = (field: 'cpk' | 'ppk' | 'cp' | 'sigmaLevel' | 'healthScore') => valid.length
    ? round(valid.reduce((s, r) => s + Number(r[field] || 0), 0) / valid.length)
    : 0;
  return {
    total: records.length,
    excellent: records.filter((r) => r.capabilityStatus === 'Excellent').length,
    acceptable: records.filter((r) => r.capabilityStatus === 'Acceptable').length,
    needsImprovement: records.filter((r) => r.capabilityStatus === 'Needs Improvement').length,
    notCapable: records.filter((r) => r.capabilityStatus === 'Not Capable' || r.capabilityStatus === 'Poor').length,
    insufficient: records.filter((r) => r.capabilityStatus === 'Insufficient Data').length,
    averageCpk: avg('cpk'),
    averagePpk: avg('ppk'),
    averageCp: avg('cp'),
    averageSigma: avg('sigmaLevel'),
    averageHealthScore: avg('healthScore'),
    highRisk: records.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length,
    capaRecommended: records.filter((r) => r.capaRecommended).length,
    lowCpk: records.filter((r) => r.cpk > 0 && r.cpk < 1.33).length,
  };
}

export function buildProcessCapabilityCharts(records: ProcessCapabilityRecord[]) {
  const cpkByParameter = records
    .filter((r) => r.cpk > 0)
    .map((r) => ({ name: r.parameterName, cpk: r.cpk, ppk: r.ppk, cp: r.cp }))
    .slice(0, 15);

  const statusMap = new Map<string, number>();
  records.forEach((r) => statusMap.set(r.capabilityStatus, (statusMap.get(r.capabilityStatus) || 0) + 1));
  const statusDistribution = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

  const riskMap = new Map<string, number>();
  records.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  const byMonth = new Map<string, { cpk: number; count: number }>();
  records.forEach((r) => {
    const key = (r.reviewPeriodTo || r.createdAt).slice(0, 7);
    const e = byMonth.get(key) || { cpk: 0, count: 0 };
    if (r.cpk > 0) { e.cpk += r.cpk; e.count += 1; }
    byMonth.set(key, e);
  });
  const monthlyCpk = Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, cpk: v.count ? round(v.cpk / v.count) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const cpVsCpk = records.filter((r) => r.cp > 0).slice(0, 12).map((r) => ({
    parameter: r.parameterName,
    cp: r.cp,
    cpk: r.cpk,
  }));

  const parameterTrend = records
    .filter((r) => r.cpk > 0)
    .sort((a, b) => (a.reviewPeriodTo || a.createdAt).localeCompare(b.reviewPeriodTo || b.createdAt))
    .slice(-12)
    .map((r) => ({
      label: `${r.parameterName}`.slice(0, 20),
      cpk: r.cpk,
      ppk: r.ppk,
    }));

  const sigmaTrend = records
    .filter((r) => r.sigmaLevel > 0)
    .sort((a, b) => (a.reviewPeriodTo || a.createdAt).localeCompare(b.reviewPeriodTo || b.createdAt))
    .slice(-12)
    .map((r) => ({ label: r.parameterName.slice(0, 16), sigma: r.sigmaLevel }));

  const healthTrend = records
    .filter((r) => r.healthScore > 0)
    .sort((a, b) => (a.reviewPeriodTo || a.createdAt).localeCompare(b.reviewPeriodTo || b.createdAt))
    .slice(-12)
    .map((r) => ({ label: r.parameterName.slice(0, 16), score: r.healthScore }));

  return {
    cpkByParameter, statusDistribution, riskDistribution, monthlyCpk, cpVsCpk, parameterTrend, sigmaTrend, healthTrend,
  };
}

/** Simple linear forecast of next Cpk from historical series */
export function forecastNextCpk(history: number[]): { next: number; slope: number } {
  if (history.length < 2) return { next: history[0] || 0, slope: 0 };
  const n = history.length;
  const xs = history.map((_, i) => i + 1);
  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = history.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - xMean) * (history[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;
  return { next: round(intercept + slope * (n + 1)), slope: round(slope) };
}

export function goldenBatchComparison(
  values: number[],
  batchIds: string[],
): { goldenBatch: string; goldenMean: number; currentMean: number; delta: number } | null {
  if (!values.length || values.length !== batchIds.length) return null;
  const byBatch = new Map<string, number[]>();
  values.forEach((v, i) => {
    const b = batchIds[i] || `B${i}`;
    const arr = byBatch.get(b) || [];
    arr.push(v);
    byBatch.set(b, arr);
  });
  if (byBatch.size < 2) return null;
  let goldenBatch = '';
  let bestScore = -Infinity;
  let bestMean = -Infinity;
  byBatch.forEach((vals, batch) => {
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const score = sd === 0 ? Infinity : 1 / (sd / Math.abs(mean || 1));
    if (score > bestScore || (score === bestScore && mean > bestMean)) {
      bestScore = score;
      bestMean = mean;
      goldenBatch = batch;
    }
  });
  if (!goldenBatch) return null;
  const goldenVals = byBatch.get(goldenBatch) || [];
  const gMean = goldenVals.reduce((s, v) => s + v, 0) / goldenVals.length;
  const currentMean = values.reduce((s, v) => s + v, 0) / values.length;
  return {
    goldenBatch,
    goldenMean: round(gMean),
    currentMean: round(currentMean),
    delta: round(currentMean - gMean),
  };
}

export function dataSourceForType(type: typeof PARAMETER_TYPES[number]): typeof DATA_SOURCES[number] {
  const map: Record<string, typeof DATA_SOURCES[number]> = {
    CPP: 'CPP Results',
    CQA: 'CQA Results',
    Yield: 'Yield Monitoring',
    Stability: 'Stability Monitoring',
    'Hold Time': 'Hold Time Monitoring',
    Environmental: 'Environmental Monitoring',
    Utility: 'Utility Monitoring',
  };
  return map[type] || 'CPP Results';
}
