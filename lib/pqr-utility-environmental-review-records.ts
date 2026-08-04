import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';
import { CLEANROOM_GRADES } from '@/lib/cpv-environmental-monitoring';
import { UTILITY_TYPES } from '@/lib/cpv-utility-monitoring';

export const PQR_UTILITY_ENV_MODULE = 'PQR Utility & Environmental Review';

export const PQR_UTILITY_ENV_COLLECTIONS = {
  review: 'pqr_utility_environmental_review',
  batchReview: 'pqr_batch_review',
  sections: 'pqr_sections',
  records: 'pqr_records',
  utilityMonitoring: 'utility_monitoring',
  environmentalMonitoring: 'environmental_monitoring',
  areaMaster: 'area_master',
  utilityMaster: 'utility_master',
  equipmentMaster: 'equipment_master',
  deviations: 'deviations',
  oos: 'oos_records',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
  riskAssessment: 'risk_assessment',
  alerts: 'alerts',
} as const;

export const PQR_REVIEW_TYPES = ['Utility Review', 'Environmental Review'] as const;

export const PQR_ENV_PARAMETERS = [
  'Temperature', 'Relative Humidity', 'Differential Pressure',
  'Non-Viable Particle Count', 'Viable Particle Count', 'Settle Plate',
  'Active Air Sampling', 'Surface Monitoring', 'Personnel Monitoring',
] as const;

export const PQR_COMPLIANCE_STATUSES = [
  'Complies', 'Observation', 'Major Observation', 'Critical Observation',
] as const;

export const PQR_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export type PqrReviewType = (typeof PQR_REVIEW_TYPES)[number];
export type PqrComplianceStatus = (typeof PQR_COMPLIANCE_STATUSES)[number];

export interface PqrUtilityEnvironmentalReviewRecord {
  id?: string;
  reviewId: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  reviewType: string;
  systemAreaName: string;
  systemAreaCode: string;
  utilityType: string;
  cleanroomGrade: string;
  roomNumber: string;
  monitoringParameter: string;
  observedMinimum: number | null;
  observedMaximum: number | null;
  observedAverage: number | null;
  lowerLimit: number;
  upperLimit: number;
  alertCount: number;
  actionCount: number;
  excursionCount: number;
  deviationCount: number;
  capaCount: number;
  changeControlCount: number;
  complianceStatus: PqrComplianceStatus | string;
  complianceReasons: string[];
  riskLevel: string;
  impactOnProductQuality: string;
  conclusion: string;
  remarks: string;
  batchNumbers?: string[];
  unit?: string;
  sampleCount?: number;
  stdDeviation?: number | null;
  oosCount?: number;
  criticality?: string;
  attachmentUrls?: string[];
  sourceType?: 'manual' | 'pull';
  sourceIds?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface PqrUtilityEnvSummary {
  totalUtilityRecords: number;
  totalEnvironmentalRecords: number;
  compliantRecords: number;
  alertRecords: number;
  actionRecords: number;
  excursionRecords: number;
  gradeAExcursions: number;
  wfiExcursions: number;
  hvacExcursions: number;
  deviationCount: number;
  capaCount: number;
  changeControlCount: number;
  oosCount: number;
  openCriticalRisks: number;
}

export interface PqrUtilityEnvReviewFilters {
  reviewType?: string;
  utilityType?: string;
  cleanroomGrade?: string;
  complianceStatus?: string;
  riskLevel?: string;
  parameter?: string;
  system?: string;
  search?: string;
}

export interface PqrUtilityEnvCharts {
  utilityComplianceTrend: Array<{ month: string; compliant: number; nonCompliant: number }>;
  environmentalComplianceTrend: Array<{ month: string; compliant: number; nonCompliant: number }>;
  temperatureTrend: Array<{ month: string; value: number }>;
  rhTrend: Array<{ month: string; value: number }>;
  differentialPressureTrend: Array<{ month: string; value: number }>;
  wfiConductivityTrend: Array<{ month: string; value: number }>;
  wfiTocTrend: Array<{ month: string; value: number }>;
  microbialTrend: Array<{ month: string; value: number }>;
  excursionTrend: Array<{ month: string; count: number }>;
  areaExcursionDistribution: Array<{ area: string; count: number }>;
  riskDistribution: Array<{ name: string; value: number }>;
}

export const utilityEnvReviewFormSchema = z.object({
  pqrId: z.string().min(1, 'PQR selection is required'),
  product: z.string().min(1, 'Product is required'),
  productCode: z.string().min(1, 'Product code is required'),
  reviewPeriodFrom: z.string().min(1),
  reviewPeriodTo: z.string().min(1),
  reviewType: z.enum(PQR_REVIEW_TYPES),
  systemAreaName: z.string().min(1, 'System / Area Name is required'),
  systemAreaCode: z.string().default(''),
  utilityType: z.enum(UTILITY_TYPES).default('Other'),
  cleanroomGrade: z.enum(CLEANROOM_GRADES).default('Unclassified'),
  roomNumber: z.string().default(''),
  monitoringParameter: z.string().min(1, 'Parameter is required'),
  observedMinimum: z.coerce.number().nullable().optional(),
  observedMaximum: z.coerce.number().nullable().optional(),
  observedAverage: z.coerce.number().nullable().optional(),
  lowerLimit: z.coerce.number(),
  upperLimit: z.coerce.number(),
  alertCount: z.coerce.number().nonnegative().default(0),
  actionCount: z.coerce.number().nonnegative().default(0),
  excursionCount: z.coerce.number().nonnegative().default(0),
  deviationCount: z.coerce.number().nonnegative().default(0),
  capaCount: z.coerce.number().nonnegative().default(0),
  changeControlCount: z.coerce.number().nonnegative().default(0),
  impactOnProductQuality: z.string().default('No'),
  conclusion: z.string().default(''),
  remarks: z.string().default(''),
}).refine((d) => d.upperLimit > d.lowerLimit, {
  message: 'Upper Limit must be greater than Lower Limit', path: ['upperLimit'],
}).refine((d) => !d.reviewPeriodFrom || !d.reviewPeriodTo || d.reviewPeriodTo >= d.reviewPeriodFrom, {
  message: 'Review Period To must be after Review Period From', path: ['reviewPeriodTo'],
});

export type UtilityEnvReviewFormData = z.infer<typeof utilityEnvReviewFormSchema>;

export function computeUtilityEnvCompliance(record: Partial<PqrUtilityEnvironmentalReviewRecord>): {
  complianceStatus: PqrComplianceStatus;
  complianceReasons: string[];
  riskLevel: string;
} {
  const reasons: string[] = [];
  const grade = record.cleanroomGrade || '';
  const param = (record.monitoringParameter || '').toLowerCase();
  const utility = record.utilityType || '';
  const impact = (record.impactOnProductQuality || '').toLowerCase() === 'yes';
  const excursions = record.excursionCount ?? 0;
  const alerts = record.alertCount ?? 0;
  const actions = record.actionCount ?? 0;

  if (excursions > 0 && ['Grade A', 'Grade B'].includes(grade)) reasons.push('Grade A/B environmental excursion');
  if (utility === 'Water for Injection' && excursions > 0 && (param.includes('microbial') || param.includes('endotoxin'))) {
    reasons.push('WFI microbial/endotoxin failure');
  }
  if (utility === 'HVAC' && excursions > 0 && param.includes('differential pressure')) {
    reasons.push('HVAC differential pressure critical failure');
  }
  if (utility === 'Compressed Air' && excursions > 0) reasons.push('Compressed air contamination');
  if (excursions > 0) reasons.push('Excursion occurred');
  if (actions > 0) reasons.push('Action limit exceeded');
  if (alerts > 0 && excursions === 0) reasons.push('Alert count exists');
  if (impact) reasons.push('Product quality impact');

  let complianceStatus: PqrComplianceStatus = 'Complies';
  if (impact || reasons.some((r) => r.includes('Grade A/B') || r.includes('WFI') || r.includes('HVAC differential'))) {
    complianceStatus = 'Critical Observation';
  } else if (excursions > 0 || actions > 0) {
    complianceStatus = 'Major Observation';
  } else if (alerts > 0) {
    complianceStatus = 'Observation';
  } else if (excursions === 0 && alerts === 0 && actions === 0) {
    complianceStatus = 'Complies';
  }

  const riskLevel = computeUtilityEnvRisk(record, complianceStatus);
  return { complianceStatus, complianceReasons: reasons, riskLevel };
}

function computeUtilityEnvRisk(
  record: Partial<PqrUtilityEnvironmentalReviewRecord>,
  compliance: PqrComplianceStatus,
): string {
  const grade = record.cleanroomGrade || '';
  const param = (record.monitoringParameter || '').toLowerCase();
  const utility = record.utilityType || '';
  const excursions = record.excursionCount ?? 0;
  const alerts = record.alertCount ?? 0;
  const impact = (record.impactOnProductQuality || '').toLowerCase() === 'yes';

  if (impact) return 'Critical';
  if (excursions > 0 && ['Grade A', 'Grade B'].includes(grade)) return 'Critical';
  if (utility === 'Water for Injection' && excursions > 0 && (param.includes('microbial') || param.includes('endotoxin'))) return 'Critical';
  if (utility === 'Compressed Air' && excursions > 0) return 'High';
  if (excursions > 0) return 'High';
  if (alerts >= 3) return 'Medium';
  if (compliance === 'Critical Observation') return 'Critical';
  if (compliance === 'Major Observation') return 'High';
  if (compliance === 'Observation') return 'Medium';
  return 'Low';
}

export function computeUtilityEnvSummary(records: PqrUtilityEnvironmentalReviewRecord[]): PqrUtilityEnvSummary {
  const active = records.filter((r) => !r.isDeleted);
  const utility = active.filter((r) => r.reviewType === 'Utility Review');
  const env = active.filter((r) => r.reviewType === 'Environmental Review');
  return {
    totalUtilityRecords: utility.length,
    totalEnvironmentalRecords: env.length,
    compliantRecords: active.filter((r) => r.complianceStatus === 'Complies').length,
    alertRecords: active.reduce((s, r) => s + r.alertCount, 0),
    actionRecords: active.reduce((s, r) => s + r.actionCount, 0),
    excursionRecords: active.reduce((s, r) => s + r.excursionCount, 0),
    gradeAExcursions: active.filter((r) => r.excursionCount > 0 && ['Grade A', 'Grade B'].includes(r.cleanroomGrade)).length,
    wfiExcursions: active.filter((r) => r.excursionCount > 0 && (r.utilityType === 'Water for Injection' || r.monitoringParameter.toLowerCase().includes('wfi'))).length,
    hvacExcursions: active.filter((r) => r.excursionCount > 0 && r.utilityType === 'HVAC').length,
    deviationCount: active.reduce((s, r) => s + r.deviationCount, 0),
    capaCount: active.reduce((s, r) => s + r.capaCount, 0),
    changeControlCount: active.reduce((s, r) => s + (r.changeControlCount || 0), 0),
    oosCount: active.reduce((s, r) => s + (r.oosCount || 0), 0),
    openCriticalRisks: active.filter((r) => r.riskLevel === 'Critical').length,
  };
}

export function generateUtilityEnvNarrative(summary: PqrUtilityEnvSummary, records: PqrUtilityEnvironmentalReviewRecord[]): string {
  const parts: string[] = [];
  const active = records.filter((r) => !r.isDeleted);
  if (active.length === 0) return 'No utility or environmental monitoring data was reviewed for the selected PQR period.';

  const utilityRecords = active.filter((r) => r.reviewType === 'Utility Review');
  if (summary.totalUtilityRecords > 0 && utilityRecords.every((r) => r.complianceStatus === 'Complies')) {
    parts.push('All utilities reviewed during the period were found within the approved acceptance criteria.');
  }

  if (summary.excursionRecords === 0) {
    parts.push('No significant utility or environmental monitoring excursion was observed during the review period.');
  } else {
    parts.push(`${summary.excursionRecords} utility/environmental excursion(s) were observed during the review period and were evaluated for impact on product quality.`);
    if (summary.gradeAExcursions > 0) {
      parts.push(`${summary.gradeAExcursions} excursion(s) were associated with Grade A/B classified areas and reviewed for sterility assurance impact.`);
    }
    if (summary.wfiExcursions > 0) {
      parts.push(`${summary.wfiExcursions} Water for Injection related excursion(s) were reviewed for microbial/endotoxin impact.`);
    }
  }

  const anyImpact = active.some((r) => (r.impactOnProductQuality || '').toLowerCase() === 'yes');
  if (anyImpact) {
    parts.push('At least one excursion was assessed as having a potential impact on product quality and was escalated through the quality system.');
  } else {
    parts.push('Based on the available monitoring records, no adverse impact on product quality was identified.');
  }

  if (summary.deviationCount > 0 || summary.oosCount > 0 || summary.capaCount > 0 || summary.changeControlCount > 0) {
    parts.push(`Linked quality events: ${summary.deviationCount} deviation(s), ${summary.oosCount} OOS, ${summary.capaCount} CAPA, ${summary.changeControlCount} change control(s).`);
  }

  parts.push(`Reviewed ${summary.totalUtilityRecords} utility and ${summary.totalEnvironmentalRecords} environmental parameter summaries.`);
  return parts.join(' ');
}

export function buildUtilityEnvCharts(records: PqrUtilityEnvironmentalReviewRecord[]): PqrUtilityEnvCharts {
  const active = records.filter((r) => !r.isDeleted);
  const utilMonth = new Map<string, { compliant: number; nonCompliant: number }>();
  const envMonth = new Map<string, { compliant: number; nonCompliant: number }>();
  const excursionMonth = new Map<string, number>();
  const areaMap = new Map<string, number>();
  const riskMap = new Map<string, number>();

  const paramTrend = (match: string) => {
    const map = new Map<string, { sum: number; n: number }>();
    active.filter((r) => r.monitoringParameter.toLowerCase().includes(match.toLowerCase()) && r.observedAverage != null)
      .forEach((r) => {
        const m = r.reviewPeriodFrom?.slice(0, 7) || 'Unknown';
        const cur = map.get(m) || { sum: 0, n: 0 };
        cur.sum += r.observedAverage ?? 0;
        cur.n += 1;
        map.set(m, cur);
      });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, v]) => ({ month, value: v.n ? Math.round((v.sum / v.n) * 100) / 100 : 0 }));
  };

  active.forEach((r) => {
    const month = r.reviewPeriodFrom?.slice(0, 7) || 'Unknown';
    const bucket = r.reviewType === 'Utility Review' ? utilMonth : envMonth;
    const cur = bucket.get(month) || { compliant: 0, nonCompliant: 0 };
    if (r.complianceStatus === 'Complies') cur.compliant += 1;
    else cur.nonCompliant += 1;
    bucket.set(month, cur);
    if (r.excursionCount > 0) {
      excursionMonth.set(month, (excursionMonth.get(month) || 0) + r.excursionCount);
      areaMap.set(r.systemAreaName, (areaMap.get(r.systemAreaName) || 0) + r.excursionCount);
    }
    riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1);
  });

  return {
    utilityComplianceTrend: Array.from(utilMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, v]) => ({ month, ...v })),
    environmentalComplianceTrend: Array.from(envMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, v]) => ({ month, ...v })),
    temperatureTrend: paramTrend('temperature'),
    rhTrend: paramTrend('humidity'),
    differentialPressureTrend: paramTrend('differential pressure'),
    wfiConductivityTrend: paramTrend('wfi conductivity'),
    wfiTocTrend: paramTrend('wfi toc'),
    microbialTrend: paramTrend('microbial'),
    excursionTrend: Array.from(excursionMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([month, count]) => ({ month, count })),
    areaExcursionDistribution: Array.from(areaMap.entries()).slice(0, 8).map(([area, count]) => ({ area, count })),
    riskDistribution: Array.from(riskMap.entries()).map(([name, value]) => ({ name, value })),
  };
}

const VIEW_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'qc_manager', 'qc_executive', 'engineering_manager', 'maintenance',
  'production_manager', 'production_executive', 'validation', 'auditor', 'viewer',
]);

const MANAGE_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'engineering_manager', 'maintenance', 'validation',
]);

const ADD_ROLES = new Set([
  ...Array.from(MANAGE_ROLES), 'production_manager', 'qc_manager',
]);

const EXPORT_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'auditor',
]);

export function canViewUtilityEnvReview(role?: string): boolean {
  return VIEW_ROLES.has(normalizeRole(role));
}

export function canManageUtilityEnvReview(role?: string): boolean {
  return MANAGE_ROLES.has(normalizeRole(role));
}

export function canAddUtilityEnvReview(role?: string): boolean {
  return ADD_ROLES.has(normalizeRole(role));
}

export function canExportUtilityEnvReview(role?: string): boolean {
  return EXPORT_ROLES.has(normalizeRole(role));
}

export function complianceStatusColor(status: string): string {
  if (status === 'Complies') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Observation') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'Major Observation') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export function riskLevelColor(level: string): string {
  if (level === 'Critical') return 'bg-red-900/10 text-red-900 border-red-300';
  if (level === 'High') return 'bg-red-50 text-red-700 border-red-200';
  if (level === 'Medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-green-50 text-green-700 border-green-200';
}

export function gradeBadgeColor(grade: string): string {
  if (grade === 'Grade A') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
  if (grade === 'Grade B') return 'bg-green-50 text-green-700 border-green-200';
  if (grade === 'Grade C') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function excursionBadgeColor(count: number): string {
  if (count === 0) return 'bg-green-50 text-green-700 border-green-200';
  if (count <= 2) return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

const S = (v: unknown, fb = ''): string => (v === null || v === undefined ? fb : String(v));
const N = (v: unknown, fb = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : fb; };
const NOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeUtilityEnvReviewRecord(raw: Record<string, unknown>): PqrUtilityEnvironmentalReviewRecord {
  const partial: Partial<PqrUtilityEnvironmentalReviewRecord> = {
    reviewType: S(raw.reviewType, 'Utility Review'),
    cleanroomGrade: S(raw.cleanroomGrade, 'Unclassified'),
    utilityType: S(raw.utilityType, 'Other'),
    monitoringParameter: S(raw.monitoringParameter),
    impactOnProductQuality: S(raw.impactOnProductQuality, 'No'),
    alertCount: N(raw.alertCount),
    actionCount: N(raw.actionCount),
    excursionCount: N(raw.excursionCount),
  };
  const hasComputed = raw.complianceStatus && Array.isArray(raw.complianceReasons) && raw.riskLevel;
  const computed = hasComputed
    ? {
      complianceStatus: S(raw.complianceStatus) as PqrComplianceStatus,
      complianceReasons: raw.complianceReasons as string[],
      riskLevel: S(raw.riskLevel, 'Low'),
    }
    : computeUtilityEnvCompliance(partial);

  const batchNumbers = Array.isArray(raw.batchNumbers)
    ? (raw.batchNumbers as unknown[]).map((b) => String(b)).filter(Boolean)
    : [];

  return {
    id: S(raw.id) || undefined,
    reviewId: S(raw.reviewId, `UER-${S(raw.id, 'X')}`),
    pqrId: S(raw.pqrId),
    pqrNumber: S(raw.pqrNumber),
    product: S(raw.product || raw.productName),
    productCode: S(raw.productCode),
    reviewPeriodFrom: S(raw.reviewPeriodFrom).slice(0, 10),
    reviewPeriodTo: S(raw.reviewPeriodTo).slice(0, 10),
    reviewType: S(raw.reviewType, 'Utility Review'),
    systemAreaName: S(raw.systemAreaName),
    systemAreaCode: S(raw.systemAreaCode),
    utilityType: S(raw.utilityType, 'Other'),
    cleanroomGrade: S(raw.cleanroomGrade, 'Unclassified'),
    roomNumber: S(raw.roomNumber),
    monitoringParameter: S(raw.monitoringParameter),
    observedMinimum: NOrNull(raw.observedMinimum),
    observedMaximum: NOrNull(raw.observedMaximum),
    observedAverage: NOrNull(raw.observedAverage),
    lowerLimit: N(raw.lowerLimit),
    upperLimit: N(raw.upperLimit),
    alertCount: N(raw.alertCount),
    actionCount: N(raw.actionCount),
    excursionCount: N(raw.excursionCount),
    deviationCount: N(raw.deviationCount),
    capaCount: N(raw.capaCount),
    changeControlCount: N(raw.changeControlCount),
    complianceStatus: computed.complianceStatus,
    complianceReasons: computed.complianceReasons,
    riskLevel: computed.riskLevel,
    impactOnProductQuality: S(raw.impactOnProductQuality, 'No'),
    conclusion: S(raw.conclusion),
    remarks: S(raw.remarks),
    batchNumbers,
    unit: S(raw.unit),
    sampleCount: N(raw.sampleCount),
    stdDeviation: NOrNull(raw.stdDeviation),
    oosCount: N(raw.oosCount),
    criticality: S(raw.criticality),
    attachmentUrls: Array.isArray(raw.attachmentUrls) ? raw.attachmentUrls as string[] : [],
    sourceType: (raw.sourceType as PqrUtilityEnvironmentalReviewRecord['sourceType']) || 'manual',
    sourceIds: Array.isArray(raw.sourceIds) ? (raw.sourceIds as unknown[]).map((s) => String(s)) : [],
    createdAt: S(raw.createdAt),
    updatedAt: S(raw.updatedAt),
    createdBy: S(raw.createdBy),
    updatedBy: S(raw.updatedBy),
    createdByName: S(raw.createdByName),
    updatedByName: S(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function filterUtilityEnvReviewRecords(
  records: PqrUtilityEnvironmentalReviewRecord[],
  filters: PqrUtilityEnvReviewFilters,
): PqrUtilityEnvironmentalReviewRecord[] {
  const search = (filters.search || '').trim().toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    if (filters.reviewType && filters.reviewType !== 'all' && r.reviewType !== filters.reviewType) return false;
    if (filters.utilityType && filters.utilityType !== 'all' && r.utilityType !== filters.utilityType) return false;
    if (filters.cleanroomGrade && filters.cleanroomGrade !== 'all' && r.cleanroomGrade !== filters.cleanroomGrade) return false;
    if (filters.complianceStatus && filters.complianceStatus !== 'all' && r.complianceStatus !== filters.complianceStatus) return false;
    if (filters.riskLevel && filters.riskLevel !== 'all' && r.riskLevel !== filters.riskLevel) return false;
    if (filters.parameter && filters.parameter !== 'all'
      && !r.monitoringParameter.toLowerCase().includes(filters.parameter.toLowerCase())) return false;
    if (filters.system && filters.system !== 'all'
      && !r.systemAreaName.toLowerCase().includes(filters.system.toLowerCase())) return false;
    if (search) {
      const hay = [
        r.systemAreaName, r.systemAreaCode, r.monitoringParameter, r.utilityType,
        r.cleanroomGrade, r.roomNumber, r.product, r.productCode, r.remarks, r.conclusion,
      ].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}
