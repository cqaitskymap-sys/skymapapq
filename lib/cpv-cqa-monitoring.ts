import { z } from 'zod';
import { CRITICALITY_OPTIONS, RESULT_TYPES } from '@/lib/admin/constants';
import { inOuterSpecificationBand } from '@/lib/cpv';

export const CQA_RESULTS_COLLECTION = 'cqa_results';
export const CQA_LEGACY_COLLECTION = 'cpv_cqa';
export const CQA_MODULE_NAME = 'CQA Monitoring';

export const CQA_TEST_STAGES = [
  'In-Process Testing',
  'Finished Product Testing',
  'Raw Material Testing',
] as const;

export type CqaTestStage = (typeof CQA_TEST_STAGES)[number];

/** Canonical CQA parameters allowed per test stage. */
export const CQA_STAGE_PARAMETERS: Record<CqaTestStage, readonly string[]> = {
  'In-Process Testing': [
    'Description',
    'pH',
    'Weight per mL',
    'Colour Index',
    'Viscosity',
    'Assay',
    'Preservative Content',
  ],
  'Finished Product Testing': [
    'Description',
    'Identification',
    'pH',
    'Extractable Vol (mL)',
    'Particulate Matter',
    'Bacterial Endotoxin Test',
    'Sterility',
    'Related Substance',
    'Assay',
    'Preservative Content',
  ],
  'Raw Material Testing': [
    'API Assay (ODB)',
    'Water/ LOD',
    'Relative Substance',
    'pH',
  ],
};

export const DEFAULT_CQA_PARAMETERS = Array.from(
  new Set(Object.values(CQA_STAGE_PARAMETERS).flat()),
) as readonly string[];

export const MICROBIOLOGY_CQA_PARAMETERS = [
  'Sterility',
  'Bacterial Endotoxin Test',
] as const;

export interface CqaStageParameterOption {
  id: string;
  parameterName: string;
  parameterCode: string;
  section: string;
  responsibility: string;
  specificationText: string;
  target: number;
  lsl: number;
  usl: number;
  unit: string;
  resultType: 'Numeric' | 'Pass/Fail' | 'Complies/Does Not Comply';
  criticality: 'Critical' | 'Major' | 'Minor';
}

export const CQA_RESULT_STATUSES = [
  'Complies', 'Alert', 'Action', 'OOT', 'OOS', 'Pass', 'Fail', 'Does Not Comply',
] as const;

export const CQA_REVIEW_STATUSES = ['Draft', 'Under Review', 'Approved'] as const;

const requiredText = z.string().trim().min(1, 'Required');

export const cqaResultFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  batchNumber: requiredText,
  manufacturingDate: requiredText,
  expiryDate: z.string().trim().default(''),
  testStage: requiredText,
  parameterId: z.string().trim().default(''),
  parameterCode: requiredText,
  parameterName: requiredText,
  subParameter: z.string().trim().default(''),
  parameterCategory: z.string().trim().default(''),
  responsibility: z.string().trim().default(''),
  specificationText: z.string().trim().default(''),
  specificationNumber: z.string().trim().default(''),
  stpNumber: z.string().trim().default(''),
  observedResult: z.union([z.coerce.number(), z.string().trim().min(1, 'Required')]),
  targetValue: z.coerce.number().optional(),
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  alertLimitLow: z.coerce.number().optional(),
  alertLimitHigh: z.coerce.number().optional(),
  actionLimitLow: z.coerce.number().optional(),
  actionLimitHigh: z.coerce.number().optional(),
  unit: requiredText,
  resultType: z.enum(RESULT_TYPES).default('Numeric'),
  criticality: z.enum(CRITICALITY_OPTIONS).default('Major'),
  testDate: requiredText,
  analyst: requiredText,
  reviewedBy: z.string().trim().default(''),
  reviewDate: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  productVersion: z.string().trim().default(''),
  specificationVersion: z.string().trim().default(''),
  testMethod: z.string().trim().default(''),
  site: z.string().trim().default(''),
  department: z.string().trim().default(''),
  shift: z.string().trim().default(''),
  equipmentId: z.string().trim().default(''),
  equipmentName: z.string().trim().default(''),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => d.lowerLimit < d.upperLimit, {
  message: 'Upper limit must be greater than lower limit',
  path: ['upperLimit'],
}).refine((d) => {
  const mfg = new Date(d.manufacturingDate);
  return !Number.isNaN(mfg.getTime());
}, { message: 'Invalid manufacturing date', path: ['manufacturingDate'] }).refine((d) => {
  const test = new Date(d.testDate);
  return !Number.isNaN(test.getTime());
}, { message: 'Invalid test date', path: ['testDate'] });

export type CqaResultFormData = z.infer<typeof cqaResultFormSchema>;

export interface CqaResultRecord extends Omit<CqaResultFormData, 'changeReason'>, Record<string, unknown> {
  id: string;
  cqaResultId: string;
  status: string;
  riskLevel: string;
  oosRequired: boolean;
  linkedOosNumber: string;
  deviationRequired: boolean;
  linkedDeviationNumber: string;
  capaRequired: boolean;
  linkedCapaNumber: string;
  reviewStatus: typeof CQA_REVIEW_STATUSES[number];
  isLocked: boolean;
  ucl?: number | null;
  lcl?: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
  changeReason?: string;
}

export interface CqaSummary {
  total: number;
  compliant: number;
  alert: number;
  action: number;
  oos: number;
  highRisk: number;
  criticalRisk: number;
  oosTriggered: number;
  capaSuggested: number;
}

export function buildCqaResultId(batchNumber: string, parameterCode: string): string {
  return `CQA-${batchNumber}-${parameterCode}`.replace(/\s+/g, '-').toUpperCase();
}

export function evaluateCqaStatus(
  observed: number | string,
  lsl: number,
  usl: number,
  resultType: string,
  alertLow?: number | null,
  alertHigh?: number | null,
  actionLow?: number | null,
  actionHigh?: number | null,
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
  if (alertLow == null && alertHigh == null && inOuterSpecificationBand(num, lsl, usl)) return 'OOT';
  return 'Complies';
}

export function evaluateCqaRiskLevel(
  status: string,
  criticality: string,
  oosCount: number,
  alertCount: number,
): string {
  if (oosCount >= 2) return 'Critical';
  if (alertCount >= 3) return 'Medium';
  if (status === 'OOS' || status === 'Fail' || status === 'Does Not Comply') {
    if (criticality === 'Critical') return 'Critical';
    if (criticality === 'Major') return 'High';
    return 'Medium';
  }
  if (status === 'Action' || status === 'Alert' || status === 'OOT') return 'Medium';
  return 'Low';
}

export function summarizeCqaResults(results: CqaResultRecord[]): CqaSummary {
  return {
    total: results.length,
    compliant: results.filter((r) => r.status === 'Complies' || r.status === 'Pass').length,
    alert: results.filter((r) => r.status === 'Alert' || r.status === 'OOT').length,
    action: results.filter((r) => r.status === 'Action').length,
    oos: results.filter((r) => r.status === 'OOS' || r.status === 'Fail' || r.status === 'Does Not Comply').length,
    highRisk: results.filter((r) => r.riskLevel === 'High').length,
    criticalRisk: results.filter((r) => r.riskLevel === 'Critical').length,
    oosTriggered: results.filter((r) => r.oosRequired || r.linkedOosNumber).length,
    capaSuggested: results.filter((r) => r.capaRequired).length,
  };
}

function trendPoints(results: CqaResultRecord[], parameterName: string) {
  return results
    .filter((r) => r.parameterName === parameterName)
    .sort((a, b) => a.testDate.localeCompare(b.testDate))
    .map((r) => ({
      label: r.batchNumber,
      observed: Number(r.observedResult),
      target: r.targetValue,
      lsl: r.lowerLimit,
      usl: r.upperLimit,
      date: r.testDate,
    }));
}

export function buildCqaChartSeries(results: CqaResultRecord[]) {
  const byMonth = new Map<string, { complies: number; total: number }>();
  results.forEach((r) => {
    const d = r.testDate || r.createdAt;
    const key = d ? d.slice(0, 7) : 'unknown';
    const entry = byMonth.get(key) || { complies: 0, total: 0 };
    entry.total += 1;
    if (r.status === 'Complies' || r.status === 'Pass') entry.complies += 1;
    byMonth.set(key, entry);
  });
  const complianceTrend = Array.from(byMonth.entries())
    .map(([month, v]) => ({ month, rate: v.total ? Math.round((v.complies / v.total) * 100) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const paramMap = new Map<string, number>();
  results.forEach((r) => {
    paramMap.set(r.parameterName, (paramMap.get(r.parameterName) || 0) + 1);
  });
  const parameterTrend = Array.from(paramMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const stageMap = new Map<string, number>();
  results.filter((r) => r.status === 'OOS' || r.status === 'Fail').forEach((r) => {
    stageMap.set(r.testStage, (stageMap.get(r.testStage) || 0) + 1);
  });
  const stageOos = Array.from(stageMap.entries()).map(([stage, count]) => ({ stage, count }));

  const batchMap = new Map<string, { ok: number; total: number }>();
  results.forEach((r) => {
    const e = batchMap.get(r.batchNumber) || { ok: 0, total: 0 };
    e.total += 1;
    if (r.status === 'Complies' || r.status === 'Pass') e.ok += 1;
    batchMap.set(r.batchNumber, e);
  });
  const batchHealth = Array.from(batchMap.entries())
    .map(([batch, v]) => ({ batch, health: v.total ? Math.round((v.ok / v.total) * 100) : 0 }))
    .slice(0, 10);

  const riskMap = new Map<string, number>();
  results.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  return {
    complianceTrend,
    parameterTrend,
    stageOos,
    batchHealth,
    riskDistribution,
    assayTrend: trendPoints(results, 'Assay'),
    phTrend: trendPoints(results, 'pH'),
    extractableVolumeTrend: trendPoints(results, 'Extractable Volume'),
    particulateMatterTrend: trendPoints(results, 'Particulate Matter >=10µm'),
  };
}

export function isMicrobiologyCqaParameter(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('sterility') || n.includes('endotoxin') || n.includes('microbial')
    || n.includes('microbiology') || MICROBIOLOGY_CQA_PARAMETERS.some((p) => p.toLowerCase() === n);
}

function normalizeCqaTestStageLabel(stage: string): string {
  return stage.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeCqaParameterLabel(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[()]/g, '');
}

/** Compare CQA test stage labels (e.g. "Finished Product" vs "Finished Product Testing"). */
export function cqaTestStagesMatch(a: string, b: string): boolean {
  const left = normalizeCqaTestStageLabel(a);
  const right = normalizeCqaTestStageLabel(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const stripTesting = (s: string) => s.replace(/ testing$/, '');
  return stripTesting(left) === stripTesting(right);
}

/** Aliases for matching stored / BMR parameter names to canonical stage parameters. */
export const CQA_PARAMETER_ALIASES: Record<string, readonly string[]> = {
  Description: ['description'],
  Identification: ['identification'],
  pH: ['ph'],
  'Weight per mL': ['weight per ml', 'weight/ml', 'weight per ml g/ml'],
  'Colour Index': ['colour index', 'colour index au'],
  Viscosity: ['viscosity'],
  Assay: ['assay', 'assay %'],
  'Preservative Content': ['preservative content', 'preservative methyl paraben', 'preservative propyl paraben', 'methyl paraben', 'propyl paraben'],
  'Extractable Vol (mL)': ['extractable vol ml', 'extractable volume', 'extractable volume ml'],
  'Particulate Matter': ['particulate matter', 'particulate matter visible', 'particulate matter ≥10', 'particulate matter >=10', 'particulate matter ≥25', 'particulate matter >=25', 'particles >=10', 'particles >=25'],
  'Bacterial Endotoxin Test': ['bacterial endotoxin test', 'bacterial endotoxin', 'bacterial endotoxin eu/mg'],
  Sterility: ['sterility'],
  'Related Substance': ['related substance', 'related substances', 'ondansetron imp. d', 'sum of all impurities', 'any secondary impurity'],
  'API Assay (ODB)': ['api assay odb', 'assay odb', 'assay odb %'],
  'Water/ LOD': ['water/ lod', 'water lod', 'water / lod'],
  'Relative Substance': ['relative substance', 'sum of related substances'],
};

/** Default mapping of CQA parameter names to applicable test stages. */
export const CQA_PARAMETER_STAGE_MAP: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(CQA_STAGE_PARAMETERS).flatMap(([stage, params]) =>
    params.map((param) => [param, [stage]]),
  ),
);

export function resolveCqaTestStage(testStage: string): CqaTestStage | null {
  const match = CQA_TEST_STAGES.find((stage) => cqaTestStagesMatch(stage, testStage));
  return match ?? null;
}

export function getCqaParametersForStage(testStage: string): readonly string[] {
  const stage = resolveCqaTestStage(testStage);
  return stage ? CQA_STAGE_PARAMETERS[stage] : [];
}

export function cqaParameterNamesMatch(canonicalName: string, candidateName: string): boolean {
  const left = normalizeCqaParameterLabel(canonicalName);
  const right = normalizeCqaParameterLabel(candidateName);
  if (!left || !right) return false;
  if (left === right) return true;

  const aliases = CQA_PARAMETER_ALIASES[canonicalName] || [];
  if (aliases.some((alias) => right === alias || right.includes(alias) || alias.includes(right))) return true;

  return left.includes(right) || right.includes(left);
}

export function parameterBelongsToCqaStage(parameterName: string, testStage: string): boolean {
  const stageParams = getCqaParametersForStage(testStage);
  return stageParams.some((param) => cqaParameterNamesMatch(param, parameterName));
}

function cqaStageResultType(name: string): CqaStageParameterOption['resultType'] {
  const lower = name.toLowerCase();
  if (lower === 'description' || lower === 'sterility') return 'Pass/Fail';
  if (lower === 'identification') return 'Complies/Does Not Comply';
  return 'Numeric';
}

function cqaStageCriticality(name: string): CqaStageParameterOption['criticality'] {
  const lower = name.toLowerCase();
  if (lower.includes('assay') || lower.includes('sterility') || lower.includes('endotoxin')) return 'Critical';
  return 'Major';
}

const CQA_STAGE_PARAMETER_DEFAULTS: Partial<Record<string, { target: number; lsl: number; usl: number; unit: string }>> = {
  pH: { target: 3.65, lsl: 3.3, usl: 4.0, unit: '' },
  Assay: { target: 100, lsl: 95, usl: 105, unit: '%' },
  'Weight per mL': { target: 1.025, lsl: 1.0, usl: 1.05, unit: 'g/mL' },
  'Colour Index': { target: 0.1, lsl: 0, usl: 0.2, unit: 'AU' },
  Viscosity: { target: 1, lsl: 0.8, usl: 1.2, unit: 'cP' },
  'Preservative Content': { target: 90, lsl: 80, usl: 100, unit: '%' },
  'Extractable Vol (mL)': { target: 2.1, lsl: 2.0, usl: 2.5, unit: 'mL' },
  'Bacterial Endotoxin Test': { target: 4.95, lsl: 0, usl: 9.9, unit: 'EU/mg' },
  'Related Substance': { target: 0.25, lsl: 0, usl: 0.5, unit: '%' },
  'API Assay (ODB)': { target: 100, lsl: 98, usl: 102, unit: '%' },
  'Water/ LOD': { target: 9.75, lsl: 9.0, usl: 10.5, unit: '%' },
  'Relative Substance': { target: 0.25, lsl: 0, usl: 0.5, unit: '%' },
};

export function buildCqaStageParameterOptions(testStage: string): CqaStageParameterOption[] {
  return getCqaParametersForStage(testStage).map((parameterName) => {
    const defaults = CQA_STAGE_PARAMETER_DEFAULTS[parameterName];
    const code = parameterName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24);
    return {
      id: `cqa-stage-${code}`,
      parameterName,
      parameterCode: `CQA_${code}`,
      section: testStage,
      responsibility: testStage === 'In-Process Testing' ? 'IPQA' : 'QA',
      specificationText: defaults ? `${defaults.lsl} – ${defaults.usl} ${defaults.unit}`.trim() : '',
      target: defaults?.target ?? 0,
      lsl: defaults?.lsl ?? 0,
      usl: defaults?.usl ?? 0,
      unit: defaults?.unit ?? '',
      resultType: cqaStageResultType(parameterName),
      criticality: cqaStageCriticality(parameterName),
    };
  });
}

export function parameterMatchesCqaTestStage(
  parameterName: string,
  testStage: string,
  processStage = '',
  explicitTestStage = '',
): boolean {
  if (!testStage) return true;
  if (explicitTestStage && cqaTestStagesMatch(explicitTestStage, testStage)) return true;
  if (processStage && cqaTestStagesMatch(processStage, testStage)) return true;
  return parameterBelongsToCqaStage(parameterName, testStage);
}
