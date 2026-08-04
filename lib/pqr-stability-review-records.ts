import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';
import {
  DEFAULT_STABILITY_LIMITS,
  DEFAULT_STABILITY_PARAMETERS,
  STABILITY_PULLING_INTERVALS,
  STABILITY_STORAGE_CONDITIONS,
  STABILITY_STUDY_TYPES,
  evaluateStabilityRisk,
  evaluateStabilityStatus,
  intervalToMonths,
} from '@/lib/cpv-stability-monitoring';

export const PQR_STABILITY_REVIEW_MODULE = 'PQR Stability Review';

export const PQR_STABILITY_REVIEW_COLLECTIONS = {
  review: 'pqr_stability_review',
  batchReview: 'pqr_batch_review',
  sections: 'pqr_sections',
  records: 'pqr_records',
  stabilityMonitoring: 'stability_monitoring',
  stabilityStudies: 'stability_studies',
  stabilitySchedules: 'stability_schedules',
  stabilityResults: 'stability_results',
  oosRecords: 'oos_records',
  deviations: 'deviations',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
} as const;

export const PQR_STABILITY_RESULT_STATUSES = [
  'Complies', 'OOT', 'OOS', 'Action', 'Under Review',
] as const;

export const PQR_STABILITY_COMPLIANCE_STATUSES = [
  'Complies', 'Observation', 'Critical Observation',
] as const;

export const PQR_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export type PqrStabilityResultStatus = (typeof PQR_STABILITY_RESULT_STATUSES)[number];
export type PqrStabilityComplianceStatus = (typeof PQR_STABILITY_COMPLIANCE_STATUSES)[number];

export interface PqrStabilityReviewRecord {
  id?: string;
  stabilityReviewId: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  batchNumber: string;
  studyNumber: string;
  studyType: string;
  storageCondition: string;
  pullingInterval: string;
  samplePullingDueDate: string;
  actualPullingDate: string;
  testDate: string;
  studyStartDate: string;
  parameterName: string;
  observedResult: string | number;
  lowerLimit: number;
  upperLimit: number;
  unit: string;
  resultStatus: string;
  samplePullStatus: string;
  ootCount: number;
  oosCount: number;
  capaCount: number;
  deviationCount?: number;
  changeControlCount?: number;
  complianceStatus: PqrStabilityComplianceStatus | string;
  complianceReasons: string[];
  riskLevel: string;
  impactOnShelfLife: string;
  impactOnProductQuality: string;
  conclusion: string;
  remarks: string;
  chamberId?: string;
  protocolNumber?: string;
  specificationVersion?: string;
  sourceType?: 'manual' | 'pull';
  sourceIds?: string[];
  attachmentUrls?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface PqrStabilityReviewSummary {
  totalStabilityStudies: number;
  totalStabilityBatches: number;
  longTermStudies: number;
  acceleratedStudies: number;
  intermediateStudies: number;
  samplesDue: number;
  samplesPulled: number;
  samplesMissed: number;
  compliantResults: number;
  ootResults: number;
  oosResults: number;
  capaLinked: number;
  highRiskStudies: number;
  criticalRiskStudies: number;
}

export interface PqrStabilityReviewCharts {
  assayTrend: Array<{ label: string; observed: number; lsl?: number; usl?: number }>;
  phTrend: Array<{ label: string; observed: number; lsl?: number; usl?: number }>;
  relatedSubstanceTrend: Array<{ label: string; observed: number; lsl?: number; usl?: number }>;
  preservativeTrend: Array<{ label: string; observed: number; lsl?: number; usl?: number }>;
  ootOosTrend: Array<{ month: string; oot: number; oos: number }>;
  storageConditionCompliance: Array<{ condition: string; rate: number }>;
  intervalCompliance: Array<{ interval: string; rate: number }>;
  riskDistribution: Array<{ level: string; count: number }>;
  samplePullingCompliance: Array<{ label: string; pulled: number; missed: number; due: number }>;
}

const numericParams = new Set(
  Object.entries(DEFAULT_STABILITY_LIMITS)
    .filter(([, v]) => v.resultType === 'Numeric')
    .map(([k]) => k),
);

export const stabilityReviewFormSchema = z.object({
  pqrId: z.string().min(1, 'PQR selection is required'),
  product: z.string().min(1, 'Product is required'),
  productCode: z.string().min(1, 'Product code is required'),
  batchNumber: z.string().min(1, 'Batch Number is required'),
  studyNumber: z.string().default(''),
  studyType: z.enum(STABILITY_STUDY_TYPES),
  storageCondition: z.enum(STABILITY_STORAGE_CONDITIONS),
  pullingInterval: z.enum(STABILITY_PULLING_INTERVALS),
  samplePullingDueDate: z.string().default(''),
  actualPullingDate: z.string().default(''),
  testDate: z.string().min(1, 'Test Date is required'),
  studyStartDate: z.string().default(''),
  parameterName: z.string().min(1, 'Parameter is required'),
  observedResult: z.union([z.coerce.number(), z.string().trim().min(1, 'Observed Result is required')]),
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  unit: z.string().default(''),
  resultStatus: z.enum(PQR_STABILITY_RESULT_STATUSES).default('Complies'),
  samplePullStatus: z.string().default('Pending'),
  ootCount: z.coerce.number().nonnegative().default(0),
  oosCount: z.coerce.number().nonnegative().default(0),
  capaCount: z.coerce.number().nonnegative().default(0),
  impactOnShelfLife: z.string().default('No'),
  impactOnProductQuality: z.string().default('No'),
  conclusion: z.string().default(''),
  remarks: z.string().default(''),
}).refine((d) => d.upperLimit > d.lowerLimit, {
  message: 'Upper Limit must be greater than Lower Limit', path: ['upperLimit'],
}).refine((d) => {
  if (!d.actualPullingDate || !d.studyStartDate) return true;
  return d.actualPullingDate >= d.studyStartDate;
}, { message: 'Actual Pulling Date cannot be before Study Start Date', path: ['actualPullingDate'] })
  .superRefine((d, ctx) => {
    if (numericParams.has(d.parameterName) && typeof d.observedResult === 'string') {
      const n = Number(d.observedResult);
      if (!Number.isFinite(n)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Observed Result must be numeric for this parameter',
          path: ['observedResult'],
        });
      }
    }
  });

export type StabilityReviewFormData = z.infer<typeof stabilityReviewFormSchema>;

export function autoResultStatus(
  observed: string | number,
  lower: number,
  upper: number,
  parameterName: string,
): PqrStabilityResultStatus {
  const lim = DEFAULT_STABILITY_LIMITS[parameterName];
  const resultType = lim?.resultType || 'Numeric';
  const status = evaluateStabilityStatus(
    observed,
    lower,
    upper,
    resultType,
    lim?.alertLow,
    lim?.alertHigh,
    lim?.actionLow,
    lim?.actionHigh,
  );
  if (status === 'Action') return 'Action';
  if (status === 'OOT') return 'OOT';
  if (status === 'OOS') return 'OOS';
  return 'Complies';
}

export function computeStabilityCompliance(record: Partial<PqrStabilityReviewRecord>): {
  complianceStatus: PqrStabilityComplianceStatus;
  complianceReasons: string[];
  riskLevel: string;
} {
  const reasons: string[] = [];
  const param = (record.parameterName || '').toLowerCase();
  const status = record.resultStatus || 'Complies';
  const oot = record.ootCount ?? 0;
  const oos = record.oosCount ?? 0;
  const capa = record.capaCount ?? 0;
  const pullStatus = (record.samplePullStatus || '').toLowerCase();
  const shelfImpact = (record.impactOnShelfLife || '').toLowerCase() === 'yes';
  const qualityImpact = (record.impactOnProductQuality || '').toLowerCase() === 'yes';

  if (status === 'OOS' || oos > 0) reasons.push('OOS observed');
  if (status === 'OOT' || oot > 0) reasons.push('OOT observed');
  if (pullStatus === 'missed') reasons.push('Sample pulling missed');
  if (pullStatus === 'missed' && record.remarks) reasons.push('Missed pull justified in remarks');
  if (capa > 0) reasons.push('CAPA linked');
  if (param.includes('sterility') && (status === 'OOS' || oos > 0)) reasons.push('Sterility failure');
  if (param.includes('endotoxin') && (status === 'OOS' || oos > 0)) reasons.push('Endotoxin failure');
  if (param.includes('assay') && (status === 'OOS' || oos > 0)) reasons.push('Assay failure');
  if (qualityImpact) reasons.push('Product quality impact identified');
  if (shelfImpact) reasons.push('Shelf life impact identified');

  let complianceStatus: PqrStabilityComplianceStatus = 'Complies';
  if (
    status === 'OOS' || oos > 0 || qualityImpact
    || param.includes('sterility') && (status === 'OOS' || oos > 0)
    || param.includes('endotoxin') && (status === 'OOS' || oos > 0)
    || param.includes('assay') && (status === 'OOS' || oos > 0)
  ) {
    complianceStatus = 'Critical Observation';
  } else if (
    (pullStatus === 'missed' && record.remarks)
    || status === 'OOT' || oot > 0
    || pullStatus === 'missed'
  ) {
    complianceStatus = 'Observation';
  } else if (status === 'Complies' && oot === 0 && oos === 0 && pullStatus !== 'missed') {
    complianceStatus = 'Complies';
  }

  const riskLevel = computeStabilityRisk(record, complianceStatus);
  return { complianceStatus, complianceReasons: reasons, riskLevel };
}

function computeStabilityRisk(
  record: Partial<PqrStabilityReviewRecord>,
  compliance: PqrStabilityComplianceStatus,
): string {
  const param = (record.parameterName || '').toLowerCase();
  const status = record.resultStatus || 'Complies';
  const oot = record.ootCount ?? 0;
  const oos = record.oosCount ?? 0;
  const shelfImpact = (record.impactOnShelfLife || '').toLowerCase() === 'yes';

  if (shelfImpact) return 'Critical';
  if (status === 'OOS' || oos > 0) return 'Critical';
  if (param.includes('sterility') && (status === 'OOS' || oos > 0)) return 'Critical';
  if (param.includes('endotoxin') && (status === 'OOS' || oos > 0)) return 'Critical';
  if (oot >= 2 || (record.ootCount ?? 0) >= 2) return 'High';
  if (status === 'OOT' || oot > 0) return 'Medium';
  if (compliance === 'Critical Observation') return 'Critical';
  if (compliance === 'Observation') return 'Medium';

  const riskFromEval = evaluateStabilityRisk(
    { status: status === 'Action' ? 'Action' : status, parameterName: record.parameterName || '', observedResult: record.observedResult ?? '' },
    oot,
  );
  return riskFromEval || 'Low';
}

/** A stability "study" is uniquely identified by its study number, else by batch+type+storage. */
function studyKeyOf(r: PqrStabilityReviewRecord): string {
  const num = (r.studyNumber || '').trim();
  if (num) return `sn:${num.toLowerCase()}`;
  return `bts:${r.batchNumber}|${r.studyType}|${r.storageCondition}`.toLowerCase();
}

export function computeStabilityReviewSummary(records: PqrStabilityReviewRecord[]): PqrStabilityReviewSummary {
  const active = records.filter((r) => !r.isDeleted);
  const studySet = new Set(active.map(studyKeyOf));
  const batchSet = new Set(active.map((r) => r.batchNumber).filter(Boolean));
  const uniqueStudiesOfType = (type: string) =>
    new Set(active.filter((r) => r.studyType === type).map(studyKeyOf)).size;

  return {
    totalStabilityStudies: studySet.size,
    totalStabilityBatches: batchSet.size,
    longTermStudies: uniqueStudiesOfType('Long Term'),
    acceleratedStudies: uniqueStudiesOfType('Accelerated'),
    intermediateStudies: uniqueStudiesOfType('Intermediate'),
    samplesDue: active.filter((r) => {
      const ps = (r.samplePullStatus || '').toLowerCase();
      return ps === 'pending' || ps === 'due soon' || (r.samplePullingDueDate && !r.actualPullingDate);
    }).length,
    samplesPulled: active.filter((r) => Boolean(r.actualPullingDate)).length,
    samplesMissed: active.filter((r) => (r.samplePullStatus || '').toLowerCase() === 'missed').length,
    compliantResults: active.filter((r) => r.resultStatus === 'Complies').length,
    ootResults: active.filter((r) => r.resultStatus === 'OOT' || r.ootCount > 0).length,
    oosResults: active.filter((r) => r.resultStatus === 'OOS' || r.oosCount > 0).length,
    capaLinked: active.reduce((s, r) => s + (r.capaCount || 0), 0),
    highRiskStudies: active.filter((r) => r.riskLevel === 'High').length,
    criticalRiskStudies: active.filter((r) => r.riskLevel === 'Critical').length,
  };
}

export function generateStabilityNarrative(
  summary: PqrStabilityReviewSummary,
  records: PqrStabilityReviewRecord[],
): string {
  if (records.length === 0) {
    return 'No stability study data was reviewed for the selected PQR period.';
  }
  const parts: string[] = [];
  const allComply = records.every((r) => r.resultStatus === 'Complies' && r.complianceStatus === 'Complies');
  if (allComply) {
    parts.push('Stability data reviewed during the period indicates that the product remains within approved specification.');
  }
  if (summary.oosResults === 0 && summary.ootResults === 0) {
    parts.push('No OOT/OOS was observed in stability studies during the review period.');
  } else if (summary.ootResults > 0 && summary.oosResults === 0) {
    parts.push('OOT trend was observed in stability data and evaluated for potential impact on product quality.');
  }
  if (summary.oosResults > 0) {
    parts.push('OOS was observed in stability study and investigated as per approved procedure.');
  }
  const shelfImpact = records.some((r) => (r.impactOnShelfLife || '').toLowerCase() === 'yes');
  if (!shelfImpact) {
    parts.push('No adverse impact on approved shelf life was identified based on reviewed stability data.');
  }
  parts.push(
    `Reviewed ${summary.totalStabilityStudies} stability studies across ${summary.totalStabilityBatches} batch(es) with ${summary.compliantResults} compliant result(s).`,
  );
  return parts.join(' ');
}

function trendFromRecords(
  records: PqrStabilityReviewRecord[],
  parameterName: string,
) {
  return records
    .filter((r) => r.parameterName === parameterName && Number.isFinite(Number(r.observedResult)))
    .sort((a, b) => intervalToMonths(a.pullingInterval) - intervalToMonths(b.pullingInterval))
    .map((r) => ({
      label: r.pullingInterval,
      observed: Number(r.observedResult),
      lsl: r.lowerLimit,
      usl: r.upperLimit,
    }));
}

export function buildStabilityReviewCharts(records: PqrStabilityReviewRecord[]): PqrStabilityReviewCharts {
  const active = records.filter((r) => !r.isDeleted);

  const byMonth = new Map<string, { oot: number; oos: number }>();
  active.forEach((r) => {
    const key = (r.testDate || r.createdAt || '').slice(0, 7);
    if (!key) return;
    const e = byMonth.get(key) || { oot: 0, oos: 0 };
    if (r.resultStatus === 'OOT' || r.ootCount > 0) e.oot += 1;
    if (r.resultStatus === 'OOS' || r.oosCount > 0) e.oos += 1;
    byMonth.set(key, e);
  });

  const condMap = new Map<string, { ok: number; total: number }>();
  active.forEach((r) => {
    const e = condMap.get(r.storageCondition) || { ok: 0, total: 0 };
    e.total += 1;
    if (r.resultStatus === 'Complies') e.ok += 1;
    condMap.set(r.storageCondition, e);
  });

  const intervalMap = new Map<string, { ok: number; total: number }>();
  active.forEach((r) => {
    const e = intervalMap.get(r.pullingInterval) || { ok: 0, total: 0 };
    e.total += 1;
    if (r.resultStatus === 'Complies') e.ok += 1;
    intervalMap.set(r.pullingInterval, e);
  });

  const riskMap = new Map<string, number>();
  active.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));

  const pullMap = new Map<string, { pulled: number; missed: number; due: number }>();
  active.forEach((r) => {
    const key = r.studyType || 'Study';
    const e = pullMap.get(key) || { pulled: 0, missed: 0, due: 0 };
    const ps = (r.samplePullStatus || '').toLowerCase();
    if (r.actualPullingDate) e.pulled += 1;
    else if (ps === 'missed') e.missed += 1;
    else e.due += 1;
    pullMap.set(key, e);
  });

  return {
    assayTrend: trendFromRecords(active, 'Assay'),
    phTrend: trendFromRecords(active, 'pH'),
    relatedSubstanceTrend: trendFromRecords(active, 'Related Substances'),
    preservativeTrend: trendFromRecords(active, 'Preservative Content'),
    ootOosTrend: Array.from(byMonth.entries())
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    storageConditionCompliance: Array.from(condMap.entries()).map(([condition, v]) => ({
      condition,
      rate: v.total ? Math.round((v.ok / v.total) * 100) : 0,
    })),
    intervalCompliance: Array.from(intervalMap.entries())
      .map(([interval, v]) => ({
        interval,
        rate: v.total ? Math.round((v.ok / v.total) * 100) : 0,
      }))
      .sort((a, b) => intervalToMonths(a.interval) - intervalToMonths(b.interval)),
    riskDistribution: Array.from(riskMap.entries()).map(([level, count]) => ({ level, count })),
    samplePullingCompliance: Array.from(pullMap.entries()).map(([label, v]) => ({ label, ...v })),
  };
}

const VIEW_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'qc_manager', 'qc_executive', 'warehouse_manager',
  'production_manager', 'production_executive', 'auditor', 'viewer',
]);

const MANAGE_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
]);

const PULL_ROLES = new Set([
  ...Array.from(MANAGE_ROLES), 'warehouse_manager',
]);

const ADD_ROLES = new Set([
  ...Array.from(MANAGE_ROLES), 'qc_manager', 'warehouse_manager',
]);

const UPDATE_TEST_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager', 'qc_executive',
]);

const UPDATE_PULL_ROLES = new Set([
  'super_admin', 'admin', 'warehouse_manager', 'qa_manager',
]);

const EXPORT_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'auditor',
]);

export function canViewStabilityReview(role?: string): boolean {
  return VIEW_ROLES.has(normalizeRole(role));
}

export function canManageStabilityReview(role?: string): boolean {
  return MANAGE_ROLES.has(normalizeRole(role));
}

export function canAddStabilityReview(role?: string): boolean {
  return ADD_ROLES.has(normalizeRole(role));
}

export function canPullStabilityReview(role?: string): boolean {
  return PULL_ROLES.has(normalizeRole(role));
}

export function canUpdateStabilityTestData(role?: string): boolean {
  return UPDATE_TEST_ROLES.has(normalizeRole(role));
}

export function canUpdateSamplePulling(role?: string): boolean {
  return UPDATE_PULL_ROLES.has(normalizeRole(role));
}

export function canExportStabilityReview(role?: string): boolean {
  return EXPORT_ROLES.has(normalizeRole(role));
}

export function resultStatusColor(status: string): string {
  if (status === 'Complies') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'OOT' || status === 'Action') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'OOS') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Under Review') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function complianceStatusColor(status: string): string {
  if (status === 'Complies') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Observation') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export function riskLevelColor(level: string): string {
  if (level === 'Critical') return 'bg-red-900/10 text-red-900 border-red-300';
  if (level === 'High') return 'bg-red-50 text-red-700 border-red-200';
  if (level === 'Medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-green-50 text-green-700 border-green-200';
}

export function storageConditionBadgeColor(): string {
  return 'bg-blue-50 text-blue-800 border-blue-200';
}

export function intervalBadgeColor(): string {
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

export interface PqrStabilityReviewFilters {
  studyType?: string;
  storageCondition?: string;
  pullingInterval?: string;
  resultStatus?: string;
  complianceStatus?: string;
  riskLevel?: string;
  parameter?: string;
  batch?: string;
  search?: string;
}

const S = (v: unknown, fb = ''): string => (v === null || v === undefined ? fb : String(v));
const N = (v: unknown, fb = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

function normalizeObserved(v: unknown): string | number {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const n = Number(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(n)) return n;
  return String(v);
}

export function normalizeStabilityReviewRecord(raw: Record<string, unknown>): PqrStabilityReviewRecord {
  const partial: Partial<PqrStabilityReviewRecord> = {
    parameterName: S(raw.parameterName),
    resultStatus: S(raw.resultStatus, 'Complies'),
    samplePullStatus: S(raw.samplePullStatus, 'Pending'),
    ootCount: N(raw.ootCount),
    oosCount: N(raw.oosCount),
    capaCount: N(raw.capaCount),
    impactOnShelfLife: S(raw.impactOnShelfLife, 'No'),
    impactOnProductQuality: S(raw.impactOnProductQuality, 'No'),
    remarks: S(raw.remarks),
  };
  const hasComputed = raw.complianceStatus && Array.isArray(raw.complianceReasons) && raw.riskLevel;
  const computed = hasComputed
    ? {
      complianceStatus: S(raw.complianceStatus) as PqrStabilityComplianceStatus,
      complianceReasons: raw.complianceReasons as string[],
      riskLevel: S(raw.riskLevel, 'Low'),
    }
    : computeStabilityCompliance(partial);

  return {
    id: S(raw.id) || undefined,
    stabilityReviewId: S(raw.stabilityReviewId, `STAB-REV-${S(raw.id, 'X')}`),
    pqrId: S(raw.pqrId),
    pqrNumber: S(raw.pqrNumber),
    product: S(raw.product || raw.productName),
    productCode: S(raw.productCode),
    batchNumber: S(raw.batchNumber),
    studyNumber: S(raw.studyNumber),
    studyType: S(raw.studyType),
    storageCondition: S(raw.storageCondition),
    pullingInterval: S(raw.pullingInterval),
    samplePullingDueDate: S(raw.samplePullingDueDate).slice(0, 10),
    actualPullingDate: S(raw.actualPullingDate).slice(0, 10),
    testDate: S(raw.testDate).slice(0, 10),
    studyStartDate: S(raw.studyStartDate).slice(0, 10),
    parameterName: S(raw.parameterName),
    observedResult: normalizeObserved(raw.observedResult),
    lowerLimit: N(raw.lowerLimit),
    upperLimit: N(raw.upperLimit),
    unit: S(raw.unit),
    resultStatus: S(raw.resultStatus, 'Complies'),
    samplePullStatus: S(raw.samplePullStatus, 'Pending'),
    ootCount: N(raw.ootCount),
    oosCount: N(raw.oosCount),
    capaCount: N(raw.capaCount),
    deviationCount: N(raw.deviationCount),
    changeControlCount: N(raw.changeControlCount),
    complianceStatus: computed.complianceStatus,
    complianceReasons: computed.complianceReasons,
    riskLevel: computed.riskLevel,
    impactOnShelfLife: S(raw.impactOnShelfLife, 'No'),
    impactOnProductQuality: S(raw.impactOnProductQuality, 'No'),
    conclusion: S(raw.conclusion),
    remarks: S(raw.remarks),
    chamberId: S(raw.chamberId) || undefined,
    protocolNumber: S(raw.protocolNumber) || undefined,
    specificationVersion: S(raw.specificationVersion) || undefined,
    sourceType: (raw.sourceType as PqrStabilityReviewRecord['sourceType']) || 'manual',
    sourceIds: Array.isArray(raw.sourceIds) ? (raw.sourceIds as unknown[]).map((s) => String(s)) : [],
    attachmentUrls: Array.isArray(raw.attachmentUrls) ? raw.attachmentUrls as string[] : [],
    createdAt: S(raw.createdAt),
    updatedAt: S(raw.updatedAt),
    createdBy: S(raw.createdBy),
    updatedBy: S(raw.updatedBy),
    createdByName: S(raw.createdByName),
    updatedByName: S(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function filterStabilityReviewRecords(
  records: PqrStabilityReviewRecord[],
  filters: PqrStabilityReviewFilters,
): PqrStabilityReviewRecord[] {
  const search = (filters.search || '').trim().toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    if (filters.studyType && filters.studyType !== 'all' && r.studyType !== filters.studyType) return false;
    if (filters.storageCondition && filters.storageCondition !== 'all' && r.storageCondition !== filters.storageCondition) return false;
    if (filters.pullingInterval && filters.pullingInterval !== 'all' && r.pullingInterval !== filters.pullingInterval) return false;
    if (filters.resultStatus && filters.resultStatus !== 'all' && r.resultStatus !== filters.resultStatus) return false;
    if (filters.complianceStatus && filters.complianceStatus !== 'all' && r.complianceStatus !== filters.complianceStatus) return false;
    if (filters.riskLevel && filters.riskLevel !== 'all' && r.riskLevel !== filters.riskLevel) return false;
    if (filters.parameter && filters.parameter !== 'all'
      && !r.parameterName.toLowerCase().includes(filters.parameter.toLowerCase())) return false;
    if (filters.batch && filters.batch !== 'all'
      && !r.batchNumber.toLowerCase().includes(filters.batch.toLowerCase())) return false;
    if (search) {
      const hay = [
        r.batchNumber, r.studyNumber, r.studyType, r.storageCondition, r.pullingInterval,
        r.parameterName, r.product, r.productCode, r.remarks, r.conclusion,
      ].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export { DEFAULT_STABILITY_PARAMETERS, DEFAULT_STABILITY_LIMITS, STABILITY_PULLING_INTERVALS, STABILITY_STORAGE_CONDITIONS, STABILITY_STUDY_TYPES };
