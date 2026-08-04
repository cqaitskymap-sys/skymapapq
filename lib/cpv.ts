import { z } from 'zod';

export const CPV_COLLECTIONS = {
  cpp: 'cpv_cpp',
  yield: 'cpv_yield',
  utility: 'cpv_utility',
  cqa: 'cpv_cqa',
  cqaAssay: 'cpv_cqa_assay',
  cqaPhysical: 'cpv_cqa_physical',
  cqaSterility: 'cpv_cqa_sterility',
  cqaPreservative: 'cpv_cqa_preservative',
  cqaParticulate: 'cpv_cqa_particulate',
  capability: 'cpv_capability',
  trends: 'cpv_trends',
  controlCharts: 'cpv_control_charts',
  risk: 'cpv_risk_assessment',
  annualReview: 'cpv_annual_review',
  audit: 'cpv_audit_trail',
  batches: 'cpv_batches',
  rawMaterials: 'cpv_raw_materials',
  packingMaterials: 'cpv_packing_materials',
  utilityMonitoring: 'cpv_utility_monitoring',
  environment: 'cpv_environment_monitoring',
  yieldMonitoring: 'cpv_yield_monitoring',
  stability: 'cpv_stability_studies',
  holdTime: 'cpv_hold_time',
  alerts: 'cpv_alerts',
} as const;

export type CpvStatus = 'Complies' | 'OOT' | 'OOS';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

const requiredText = z.string().trim().min(1, 'Required');
const finiteNumber = z.coerce.number().finite();

export const cppSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  manufacturingDate: requiredText,
  processStage: requiredText,
  parameterName: requiredText,
  observedValue: finiteNumber,
  targetValue: finiteNumber,
  lsl: finiteNumber,
  usl: finiteNumber,
  unit: requiredText,
  recordedBy: requiredText,
  reviewedBy: z.string().trim(),
}).refine((value) => value.lsl < value.usl, {
  message: 'USL must be greater than LSL',
  path: ['usl'],
});

export const cqaSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  testDate: requiredText,
  testParameter: requiredText,
  observedValue: finiteNumber,
  target: finiteNumber,
  lsl: finiteNumber,
  usl: finiteNumber,
  unit: requiredText,
  recordedBy: requiredText,
  reviewedBy: z.string().trim().optional(),
}).refine((value) => value.lsl <= value.usl, {
  message: 'USL must be greater than or equal to LSL',
  path: ['usl'],
});

export const yieldSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  manufacturingDate: requiredText,
  bulkYield: finiteNumber.min(0).max(100),
  fillingYield: finiteNumber.min(0).max(100),
  packingYield: finiteNumber.min(0).max(100),
  lowerLimit: finiteNumber,
  upperLimit: finiteNumber,
  observedValue: finiteNumber,
  recordedBy: requiredText,
}).refine((value) => value.lowerLimit < value.upperLimit, {
  message: 'Upper limit must be greater than lower limit',
  path: ['upperLimit'],
});

export const utilitySchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  manufacturingDate: requiredText,
  hvacTemperature: finiteNumber,
  relativeHumidity: finiteNumber,
  differentialPressure: finiteNumber,
  compressedAirPressure: finiteNumber,
  wfiConductivity: finiteNumber,
  loopTemperature: finiteNumber,
  recordedBy: requiredText,
});

export const assaySchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  assayPercent: finiteNumber,
  observedValue: finiteNumber,
  lowerLimit: finiteNumber,
  upperLimit: finiteNumber,
  recordedBy: requiredText,
}).refine((value) => value.lowerLimit < value.upperLimit, {
  message: 'Upper limit must be greater than lower limit',
  path: ['upperLimit'],
});

export const physicalSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  testDate: requiredText,
  ph: finiteNumber,
  extractableVolume: finiteNumber,
  colour: requiredText,
  description: requiredText,
  clarity: requiredText,
  status: z.enum(['Complies', 'OOT', 'OOS']),
  recordedBy: requiredText,
});

export const sterilitySchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  testDate: requiredText,
  result: requiredText,
  passFail: z.enum(['Pass', 'Fail']),
  mediaLotNo: requiredText,
  analyst: requiredText,
});

export const preservativeSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  methylParaben: finiteNumber,
  propylParaben: finiteNumber,
  observedValue: finiteNumber,
  lsl: finiteNumber,
  usl: finiteNumber,
  unit: requiredText,
  recordedBy: requiredText,
}).refine((value) => value.lsl < value.usl, {
  message: 'USL must be greater than LSL',
  path: ['usl'],
});

export const particulateSchema = z.object({
  productName: requiredText,
  batchNo: requiredText,
  particles10Micron: finiteNumber.min(0),
  particles25Micron: finiteNumber.min(0),
  observedValue: finiteNumber.min(0),
  limit: finiteNumber.min(0),
  recordedBy: requiredText,
});

export const riskSchema = z.object({
  riskId: z.string().trim().optional(),
  productName: requiredText,
  batchNo: z.string().trim().optional().default(''),
  factor: requiredText,
  riskDescription: requiredText,
  severity: z.coerce.number().int().min(1).max(5),
  occurrence: z.coerce.number().int().min(1).max(5),
  detectability: z.coerce.number().int().min(1).max(5),
  mitigation: z.string().trim().optional().default(''),
  owner: requiredText,
  dueDate: z.string().trim().optional().default(''),
});

export type CppInput = z.infer<typeof cppSchema>;
export type CqaInput = z.infer<typeof cqaSchema>;
export type YieldInput = z.infer<typeof yieldSchema>;
export type UtilityInput = z.infer<typeof utilitySchema>;
export type AssayInput = z.infer<typeof assaySchema>;
export type PhysicalInput = z.infer<typeof physicalSchema>;
export type SterilityInput = z.infer<typeof sterilitySchema>;
export type PreservativeInput = z.infer<typeof preservativeSchema>;
export type ParticulateInput = z.infer<typeof particulateSchema>;
export type RiskInput = z.infer<typeof riskSchema>;

export interface CpvRecordMeta {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByName: string;
  version: number;
}

export interface CppRecord extends CppInput, Partial<CpvRecordMeta> {
  status: CpvStatus;
  deviationPercent: number;
}

export interface CqaRecord extends CqaInput, Partial<CpvRecordMeta> {
  status: CpvStatus;
  deviationPercent: number;
  batchId?: string | null;
  batchLinked?: boolean;
  pqrId?: string | null;
  pqr_id?: string | null;
}

export interface YieldRecord extends YieldInput, Partial<CpvRecordMeta> {
  status: CpvStatus;
}

export interface UtilityRecord extends UtilityInput, Partial<CpvRecordMeta> {
  status: CpvStatus;
  parameterStatuses: Record<keyof typeof UTILITY_LIMITS, CpvStatus>;
}

export interface AssayRecord extends AssayInput, Partial<CpvRecordMeta> {
  status: CpvStatus;
}

export interface PhysicalRecord extends PhysicalInput, Partial<CpvRecordMeta> {}

export interface SterilityRecord extends SterilityInput, Partial<CpvRecordMeta> {
  status: 'Pass' | 'Fail';
}

export interface PreservativeRecord extends PreservativeInput, Partial<CpvRecordMeta> {
  status: CpvStatus;
}

export interface ParticulateRecord extends ParticulateInput, Partial<CpvRecordMeta> {
  status: CpvStatus;
}

export interface RiskRecord extends RiskInput, Partial<CpvRecordMeta> {
  rpn: number;
  riskLevel: RiskLevel;
  status?: string;
  manufacturingDate?: string;
  /** @deprecated legacy field — use occurrence */
  likelihood?: number;
  /** @deprecated legacy field — use riskDescription */
  rationale?: string;
}

export interface CapabilityResult {
  count: number;
  mean: number;
  median: number;
  range: number;
  variance: number;
  standardDeviation: number;
  cp: number;
  cpk: number;
  cpu: number;
  cpl: number;
  pp: number;
  ppk: number;
  sigmaLevel: number;
  performanceIndex: number;
  status: 'Excellent' | 'Acceptable' | 'Needs Improvement' | 'Insufficient Data';
}

export type CapabilityStatus = CapabilityResult['status'];

export function capabilityStatusTone(status: CapabilityStatus): 'green' | 'amber' | 'red' {
  if (status === 'Excellent') return 'green';
  if (status === 'Acceptable') return 'amber';
  return 'red';
}

export const YIELD_PARAMETERS = ['Bulk Yield', 'Filling Yield', 'Packing Yield'] as const;

export const PROCESS_PARAMETERS = [
  'Fill Volume', 'Mixing Time', 'Mixing RPM', 'Mixing Temperature',
  'Sterilization Time', 'Sterilization Temperature', 'Filtration Pressure',
  'Hold Time', 'Nitrogen Pressure',
] as const;

export const UTILITY_PARAMETERS = [
  'Room Temperature', 'Relative Humidity', 'Differential Pressure',
] as const;

export const CPP_PARAMETERS = [
  ...YIELD_PARAMETERS,
  ...PROCESS_PARAMETERS,
  ...UTILITY_PARAMETERS,
];

/** @deprecated use PROCESS_PARAMETERS */
export const PROCESS_PARAMETERS_LEGACY = PROCESS_PARAMETERS;

export const PARAMETER_SPECS: Record<string, { target: number; lsl: number; usl: number; unit: string }> = {
  'Fill Volume': { target: 2.15, lsl: 2.1, usl: 2.2, unit: 'mL' },
  'Mixing Time': { target: 15, lsl: 12, usl: 18, unit: 'min' },
  'Mixing RPM': { target: 325, lsl: 250, usl: 400, unit: 'RPM' },
  'Mixing Temperature': { target: 25, lsl: 23, usl: 27, unit: '°C' },
  'Sterilization Time': { target: 30, lsl: 30, usl: 60, unit: 'min' },
  'Sterilization Temperature': { target: 121, lsl: 121, usl: 130, unit: '°C' },
  'Filtration Pressure': { target: 3.0, lsl: 2.0, usl: 4.0, unit: 'bar' },
  'Hold Time': { target: 6, lsl: 0, usl: 12, unit: 'hr' },
  'Bulk Hold Time': { target: 6, lsl: 0, usl: 12, unit: 'hr' },
  'Nitrogen Pressure': { target: 2.75, lsl: 2.0, usl: 3.5, unit: 'kg/cm²' },
  'Filling Speed': { target: 412.5, lsl: 275, usl: 550, unit: 'ampoules/min' },
  'Filtration Yield': { target: 98, lsl: 96, usl: 100, unit: '%' },
  'Bulk Yield': { target: 98, lsl: 96, usl: 100, unit: '%' },
  'Filling Yield': { target: 98.5, lsl: 97, usl: 100, unit: '%' },
  'Packing Yield': { target: 99.5, lsl: 98, usl: 100, unit: '%' },
  'Room Temperature': { target: 22, lsl: 0, usl: 25, unit: '°C' },
  'Relative Humidity': { target: 40, lsl: 0, usl: 55, unit: '%' },
};

export function displayCpvStatus(status: CpvStatus | string): 'Pass' | 'OOT' | 'OOS' {
  if (status === 'Complies' || status === 'Within Limit' || status === 'Pass') return 'Pass';
  if (status === 'OOT') return 'OOT';
  return 'OOS';
}


export const UTILITY_LIMITS = {
  hvacTemperature: { label: 'Room Temperature', lsl: 18, usl: 25, unit: '°C' },
  relativeHumidity: { label: 'Relative Humidity', lsl: 30, usl: 65, unit: '%' },
  differentialPressure: { label: 'Differential Pressure', lsl: 10, usl: 20, unit: 'Pa' },
  compressedAirPressure: { label: 'Compressed Air Pressure', lsl: 5, usl: 7, unit: 'bar' },
  wfiConductivity: { label: 'WFI Conductivity', lsl: 0, usl: 1.3, unit: 'µS/cm' },
  loopTemperature: { label: 'Loop Temperature', lsl: 70, usl: 85, unit: '°C' },
} as const;

export const CQA_PARAMETERS = [
  'Assay',
  'pH',
  'Extractable Volume',
  'Description',
  'Colour',
  'Colour Index',
  'Sterility',
  'Bacterial Endotoxin',
  'Total Viable Count',
  'Particles >=10µm',
  'Particles >=25µm',
  'Methyl Paraben',
  'Propyl Paraben',
  'Ondansetron Imp. D',
  'Any Secondary Impurity',
  'Sum of All Impurities',
] as const;

export type CqaParameterName = (typeof CQA_PARAMETERS)[number];
export type CqaParameterType = 'numeric' | 'qualitative' | 'limit';

export const CQA_PARAMETER_SPECS: Record<CqaParameterName, {
  target: number;
  lsl: number;
  usl: number;
  unit: string;
  type: CqaParameterType;
}> = {
  Assay: { target: 100, lsl: 95, usl: 105, unit: '%', type: 'numeric' },
  pH: { target: 3.65, lsl: 3.3, usl: 4.0, unit: '', type: 'numeric' },
  'Extractable Volume': { target: 2.1, lsl: 2.0, usl: 2.5, unit: 'mL', type: 'numeric' },
  Description: { target: 1, lsl: 1, usl: 1, unit: 'Pass/Fail', type: 'qualitative' },
  Colour: { target: 1, lsl: 1, usl: 1, unit: 'Pass/Fail', type: 'qualitative' },
  'Colour Index': { target: 0.1, lsl: 0, usl: 0.2, unit: 'AU', type: 'limit' },
  Sterility: { target: 1, lsl: 1, usl: 1, unit: 'Pass/Fail', type: 'qualitative' },
  'Bacterial Endotoxin': { target: 4.95, lsl: 0, usl: 9.9, unit: 'EU/mg', type: 'numeric' },
  'Total Viable Count': { target: 5, lsl: 0, usl: 10, unit: 'CFU/100 mL', type: 'limit' },
  'Particles >=10µm': { target: 3000, lsl: 0, usl: 6000, unit: '/mL', type: 'limit' },
  'Particles >=25µm': { target: 300, lsl: 0, usl: 600, unit: '/mL', type: 'limit' },
  'Methyl Paraben': { target: 90, lsl: 80, usl: 100, unit: '%', type: 'numeric' },
  'Propyl Paraben': { target: 90, lsl: 80, usl: 100, unit: '%', type: 'numeric' },
  'Ondansetron Imp. D': { target: 0.06, lsl: 0, usl: 0.12, unit: '%', type: 'limit' },
  'Any Secondary Impurity': { target: 0.1, lsl: 0, usl: 0.2, unit: '%', type: 'limit' },
  'Sum of All Impurities': { target: 0.25, lsl: 0, usl: 0.5, unit: '%', type: 'limit' },
};

export function isQualitativeCqaParameter(parameter: string): boolean {
  const spec = CQA_PARAMETER_SPECS[parameter as CqaParameterName];
  return spec?.type === 'qualitative';
}

export function classifyCqaStatus(
  parameter: string,
  observed: number,
  target: number,
  lsl: number,
  usl: number,
): CpvStatus {
  const spec = CQA_PARAMETER_SPECS[parameter as CqaParameterName];
  if (spec?.type === 'qualitative') {
    return observed >= 1 ? 'Complies' : 'OOS';
  }
  return classifySpecification(observed, target, lsl, usl);
}

export const RISK_SOURCES = [
  'CPP Drift',
  'CQA Drift',
  'OOT',
  'OOS',
  'Deviation',
  'CAPA',
  'Equipment Failure',
  'Utility Failure',
  'Vendor Issues',
] as const;

export type RiskSource = (typeof RISK_SOURCES)[number];

/** @deprecated use RISK_SOURCES */
export const RISK_FACTORS = RISK_SOURCES;

const round = (value: number, digits = 3) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

export function classifySpecification(
  observed: number,
  target: number,
  lsl: number,
  usl: number,
): CpvStatus {
  if (observed < lsl || observed > usl) return 'OOS';
  const tolerance = usl - lsl;
  const warningBand = tolerance * 0.1;
  if (observed <= lsl + warningBand || observed >= usl - warningBand) return 'OOT';
  return 'Complies';
}

export function deviationPercent(observed: number, target: number) {
  return target === 0 ? 0 : round(((observed - target) / Math.abs(target)) * 100, 2);
}

export function classifyUtility(input: UtilityInput) {
  const parameterStatuses = Object.fromEntries(
    Object.entries(UTILITY_LIMITS).map(([key, limits]) => [
      key,
      classifySpecification(
        input[key as keyof typeof UTILITY_LIMITS],
        (limits.lsl + limits.usl) / 2,
        limits.lsl,
        limits.usl,
      ),
    ]),
  ) as Record<keyof typeof UTILITY_LIMITS, CpvStatus>;
  const statuses = Object.values(parameterStatuses);
  const status: CpvStatus = statuses.includes('OOS') ? 'OOS' : statuses.includes('OOT') ? 'OOT' : 'Complies';
  return { status, parameterStatuses };
}

export function calculateCapability(values: number[], lsl: number, usl: number): CapabilityResult {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2 || lsl >= usl) {
    return {
      count: clean.length, mean: 0, median: 0, range: 0, variance: 0,
      standardDeviation: 0, cp: 0, cpk: 0, cpu: 0, cpl: 0, pp: 0,
      ppk: 0, sigmaLevel: 0, performanceIndex: 0, status: 'Insufficient Data',
    };
  }

  const sorted = [...clean].sort((a, b) => a - b);
  const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  const variance = clean.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (clean.length - 1);
  const standardDeviation = Math.sqrt(variance);
  const movingRanges = clean.slice(1).map((value, index) => Math.abs(value - clean[index]));
  const averageMovingRange = movingRanges.length
    ? movingRanges.reduce((sum, value) => sum + value, 0) / movingRanges.length
    : standardDeviation * 1.128;
  const withinSigma = (averageMovingRange / 1.128) || Number.EPSILON;
  const overallSigma = standardDeviation || Number.EPSILON;
  const cp = (usl - lsl) / (6 * withinSigma);
  const cpu = (usl - mean) / (3 * withinSigma);
  const cpl = (mean - lsl) / (3 * withinSigma);
  const cpk = Math.min(cpu, cpl);
  const pp = (usl - lsl) / (6 * overallSigma);
  const ppu = (usl - mean) / (3 * overallSigma);
  const ppl = (mean - lsl) / (3 * overallSigma);
  const ppk = Math.min(ppu, ppl);
  const status: CapabilityStatus = cpk > 1.33 ? 'Excellent' : cpk >= 1 ? 'Acceptable' : 'Needs Improvement';

  return {
    count: clean.length,
    mean: round(mean),
    median: round(median),
    range: round(sorted[sorted.length - 1] - sorted[0]),
    variance: round(variance),
    standardDeviation: round(standardDeviation),
    cp: round(cp),
    cpk: round(cpk),
    cpu: round(cpu),
    cpl: round(cpl),
    pp: round(pp),
    ppk: round(ppk),
    sigmaLevel: round(cpk * 3),
    performanceIndex: round(Math.min(2, Math.max(0, cpk)) * 50, 1),
    status,
  };
}

export function calculateControlLimits(values: number[]) {
  const clean = values.filter(Number.isFinite);
  const mean = clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : 0;
  const movingRanges = clean.slice(1).map((value, index) => Math.abs(value - clean[index]));
  const mrBar = movingRanges.length
    ? movingRanges.reduce((sum, value) => sum + value, 0) / movingRanges.length
    : 0;
  const sigma = mrBar / 1.128;
  const ucl = mean + (3 * sigma);
  const lcl = mean - (3 * sigma);
  return {
    centerLine: round(mean),
    ucl: round(ucl),
    lcl: round(lcl),
    mrCenterLine: round(mrBar),
    mrUcl: round(mrBar * 3.267),
    points: clean.map((value, index) => ({
      index: index + 1,
      value,
      movingRange: index === 0 ? 0 : Math.abs(value - clean[index - 1]),
      outOfControl: value > ucl || value < lcl,
    })),
  };
}

export function calculateRisk(occurrence: number, severity: number, detectability: number) {
  const rpn = occurrence * severity * detectability;
  const riskLevel: RiskLevel = rpn >= 80 ? 'Critical' : rpn >= 50 ? 'High' : rpn >= 20 ? 'Medium' : 'Low';
  return { rpn, riskLevel };
}

export function riskOccurrence(record: Pick<RiskRecord, 'occurrence' | 'likelihood'>): number {
  return record.occurrence ?? record.likelihood ?? 1;
}

export function riskDescriptionText(record: Pick<RiskRecord, 'riskDescription' | 'rationale'>): string {
  return record.riskDescription || record.rationale || '';
}

export function generateRiskId(existingCount: number): string {
  const year = new Date().getFullYear();
  return `RISK-${year}-${String(existingCount + 1).padStart(4, '0')}`;
}

export function matrixCellLevel(severity: number, occurrence: number): RiskLevel {
  const score = severity * occurrence;
  if (score >= 20) return 'Critical';
  if (score >= 12) return 'High';
  if (score >= 6) return 'Medium';
  return 'Low';
}

export function calculateAiRiskScore(input: {
  oot: number;
  oos: number;
  deviations: number;
  averageCpk: number;
  yieldTrend: number;
  controlViolations: number;
}) {
  const score =
    Math.min(input.oot * 3, 18) +
    Math.min(input.oos * 8, 32) +
    Math.min(input.deviations * 2, 14) +
    Math.max(0, 1.33 - input.averageCpk) * 18 +
    Math.max(0, -input.yieldTrend) * 2 +
    Math.min(input.controlViolations * 5, 15);
  return round(Math.min(100, Math.max(0, score)), 1);
}

export const cpvPermissions = {
  canEnterCpp: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'production', 'production_manager', 'engineering', 'engineering_manager'].includes(role || ''),
  canEnterCqa: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'qc', 'qc_manager'].includes(role || ''),
  canReview: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canConfigure: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canView: (role?: string) => Boolean(role),
  isReadOnly: (role?: string) => ['viewer', 'auditor'].includes(role || ''),
  canViewCpvProducts: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'viewer', 'auditor',
  ].includes(role || ''),
  canManageCpvProducts: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canActivateCpvProducts: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canImportExportCpvProducts: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewCpvBatches: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'viewer', 'auditor',
  ].includes(role || ''),
  canManageCpvBatches: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'production', 'production_manager'].includes(role || ''),
  canReleaseHoldRejectBatch: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportCpvBatches: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canUpdateBatchManufacturing: (role?: string) => ['super_admin', 'admin', 'production', 'production_manager'].includes(role || ''),
  canUpdateBatchQc: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'qc', 'qc_manager'].includes(role || ''),
  canReviewCpp: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportCpp: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewCpp: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'production', 'production_manager', 'engineering', 'engineering_manager',
    'qc', 'qc_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  isCppViewOnly: (role?: string) => ['qc', 'qc_manager', 'viewer', 'auditor'].includes(role || ''),
  canReviewCqa: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportCqa: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewCqa: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'microbiology', 'production', 'production_manager',
    'viewer', 'auditor',
  ].includes(role || ''),
  isCqaViewOnly: (role?: string) => ['production', 'production_manager', 'viewer', 'auditor'].includes(role || ''),
  canEnterMicrobiologyCqa: (role?: string) => ['super_admin', 'admin', 'microbiology'].includes(role || ''),
  isCqaMicrobiologyOnly: (role?: string) => role === 'microbiology',
  canReviewRawMaterial: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportRawMaterial: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewRawMaterial: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'warehouse', 'warehouse_manager',
    'production', 'production_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateRawMaterial: (role?: string) => [
    'super_admin', 'admin', 'warehouse', 'warehouse_manager', 'qc', 'qc_manager',
  ].includes(role || ''),
  canUpdateRawMaterialQc: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'qc', 'qc_manager'].includes(role || ''),
  isRawMaterialViewOnly: (role?: string) => ['production', 'production_manager', 'viewer', 'auditor'].includes(role || ''),
  canReviewPackingMaterial: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportPackingMaterial: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewPackingMaterial: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'warehouse', 'warehouse_manager',
    'production', 'production_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreatePackingMaterial: (role?: string) => [
    'super_admin', 'admin', 'warehouse', 'warehouse_manager', 'qc', 'qc_manager',
  ].includes(role || ''),
  canUpdatePackingMaterialQc: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'qc', 'qc_manager'].includes(role || ''),
  isPackingMaterialViewOnly: (role?: string) => ['production', 'production_manager', 'viewer', 'auditor'].includes(role || ''),
  canReviewUtility: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportUtility: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewUtility: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'engineering', 'engineering_manager', 'qc', 'qc_manager', 'microbiology',
    'production', 'production_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateUtility: (role?: string) => [
    'super_admin', 'admin', 'engineering', 'engineering_manager', 'qc', 'qc_manager', 'microbiology',
  ].includes(role || ''),
  isUtilityViewOnly: (role?: string) => ['production', 'production_manager', 'viewer', 'auditor'].includes(role || ''),
  canReviewEnvironmental: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportEnvironmental: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewEnvironmental: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'microbiology', 'engineering', 'engineering_manager',
    'production', 'production_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateEnvironmental: (role?: string) => [
    'super_admin', 'admin', 'qc', 'qc_manager', 'microbiology',
  ].includes(role || ''),
  isEnvironmentalViewOnly: (role?: string) => ['production', 'production_manager', 'engineering', 'engineering_manager', 'viewer', 'auditor'].includes(role || ''),
  canReviewYield: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportYield: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewYield: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'production', 'production_manager', 'warehouse', 'warehouse_manager',
    'qc', 'qc_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateYield: (role?: string) => [
    'super_admin', 'admin', 'production', 'production_manager',
  ].includes(role || ''),
  isYieldViewOnly: (role?: string) => ['qc', 'qc_manager', 'warehouse', 'warehouse_manager', 'viewer', 'auditor'].includes(role || ''),
  canViewStability: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'production', 'production_manager', 'warehouse', 'warehouse_manager',
    'qc', 'qc_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateStability: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canEnterStabilityResults: (role?: string) => [
    'super_admin', 'admin', 'qc', 'qc_manager',
  ].includes(role || ''),
  canUpdateStabilityPull: (role?: string) => [
    'super_admin', 'admin', 'warehouse', 'warehouse_manager',
  ].includes(role || ''),
  canReviewStability: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportStability: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  isStabilityViewOnly: (role?: string) => [
    'production', 'production_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canViewHoldTime: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'production', 'production_manager', 'qc', 'qc_manager',
    'viewer', 'auditor',
  ].includes(role || ''),
  canCreateHoldTime: (role?: string) => [
    'super_admin', 'admin', 'production', 'production_manager',
  ].includes(role || ''),
  canEditHoldTime: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canReviewHoldTime: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportHoldTime: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  isHoldTimeViewOnly: (role?: string) => ['qc', 'qc_manager', 'viewer', 'auditor'].includes(role || ''),
  canViewProcessCapability: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'production', 'production_manager', 'qc', 'qc_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateProcessCapability: (role?: string) => [
    'super_admin', 'admin', 'qc', 'qc_manager',
  ].includes(role || ''),
  canEditProcessCapability: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canReviewProcessCapability: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportProcessCapability: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  isProcessCapabilityViewOnly: (role?: string) => [
    'production', 'production_manager', 'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canViewTrendAnalysis: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'production', 'production_manager', 'qc', 'qc_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateTrendAnalysis: (role?: string) => [
    'super_admin', 'admin', 'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager',
  ].includes(role || ''),
  canEditTrendAnalysis: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canReviewTrendAnalysis: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportTrendAnalysis: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  isTrendAnalysisViewOnly: (role?: string) => ['viewer', 'auditor'].includes(role || ''),
  canViewSpc: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'production', 'production_manager', 'qc', 'qc_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateSpc: (role?: string) => [
    'super_admin', 'admin', 'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager',
  ].includes(role || ''),
  canEditSpc: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canReviewSpc: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportSpc: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  isSpcViewOnly: (role?: string) => ['viewer', 'auditor'].includes(role || ''),
  canViewRiskAssessment: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateRiskAssessment: (role?: string) => [
    'super_admin', 'admin', 'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager',
  ].includes(role || ''),
  canEditRiskAssessment: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canReviewRiskAssessment: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canCloseRiskAssessment: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canImportExportRiskAssessment: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  isRiskAssessmentViewOnly: (role?: string) => ['viewer', 'auditor'].includes(role || ''),
  canViewAnnualReview: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canCreateAnnualReview: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
  ].includes(role || ''),
  canEditAnnualReview: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canReviewAnnualReview: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'qc', 'qc_manager',
    'production', 'production_manager', 'engineering', 'engineering_manager',
  ].includes(role || ''),
  canApproveAnnualReview: (role?: string) => ['super_admin', 'admin', 'head_qa', 'qa_manager'].includes(role || ''),
  canExportAnnualReview: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  isAnnualReviewViewOnly: (role?: string) => ['viewer', 'auditor'].includes(role || ''),
  canViewReportsAnalytics: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canGenerateReports: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager',
  ].includes(role || ''),
  canExportReports: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'auditor',
  ].includes(role || ''),
  canArchiveReports: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canViewManagementAnalytics: (role?: string) => [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa',
  ].includes(role || ''),
  isReportsViewOnly: (role?: string) => ['viewer'].includes(role || ''),
  canViewAlerts: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
    'qc', 'qc_manager', 'production', 'production_manager',
    'engineering', 'engineering_manager', 'viewer', 'auditor',
  ].includes(role || ''),
  canManageAlerts: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'].includes(role || ''),
  canConfigureAlertRules: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canExportAlerts: (role?: string) => ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'auditor'].includes(role || ''),
  isAlertsViewOnly: (role?: string) => ['viewer', 'auditor'].includes(role || ''),
  canViewCpvConfiguration: (role?: string) => [
    'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'auditor', 'viewer',
  ].includes(role || ''),
  canEditCpvConfiguration: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canImportExportCpvConfiguration: (role?: string) => ['super_admin', 'admin'].includes(role || ''),
  canApproveCpvConfiguration: (role?: string) => ['super_admin', 'head_qa'].includes(role || ''),
  isCpvConfigurationViewOnly: (role?: string) => ['auditor', 'viewer'].includes(role || ''),
  canViewAiAnalytics: (role?: string) => [
    'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa', 'auditor', 'viewer',
  ].includes(role || ''),
  canManageAiRecommendations: (role?: string) => ['super_admin', 'admin', 'head_qa'].includes(role || ''),
  canExportAiAnalytics: (role?: string) => ['super_admin', 'admin', 'head_qa', 'qa_manager', 'auditor'].includes(role || ''),
  isAiAnalyticsViewOnly: (role?: string) => ['auditor', 'viewer'].includes(role || ''),
};
