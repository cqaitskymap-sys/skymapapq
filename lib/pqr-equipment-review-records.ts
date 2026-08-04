import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';

export const PQR_EQUIPMENT_REVIEW_MODULE = 'PQR Equipment Review';

export const PQR_EQUIPMENT_REVIEW_COLLECTIONS = {
  equipmentReview: 'pqr_equipment_review',
  batchReview: 'pqr_batch_review',
  batches: 'batches',
  cpvBatches: 'cpv_batches',
  sections: 'pqr_sections',
  records: 'pqr_records',
  recordsLegacy: 'pqr_documents',
  equipmentMaster: 'equipment_master',
  equipmentQualification: 'equipment_qualification',
  equipmentCalibration: 'equipment_calibration',
  calibrationRecords: 'calibration_records',
  preventiveMaintenance: 'preventive_maintenance',
  pmRecords: 'pm_records',
  breakdownRecords: 'breakdown_records',
  equipmentUsageLogs: 'equipment_usage_logs',
  ebmrEquipmentUsage: 'ebmr_equipment_usage',
  utilityEquipment: 'utility_equipment',
  validationRecords: 'validation_records',
  cleaningValidation: 'cleaning_validation',
  deviations: 'deviations',
  oosRecords: 'oos_records',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
} as const;

export const PQR_EQUIPMENT_CATEGORIES = [
  'Manufacturing Equipment', 'Packing Equipment', 'Utility Equipment',
  'QC Laboratory Equipment', 'Microbiology Equipment', 'Warehouse Equipment',
  'HVAC Equipment', 'Water System Equipment',
] as const;

export const PQR_EQUIPMENT_TYPES = [
  'Mixing Vessel', 'Storage Vessel', 'Holding Tank', 'Filtration Unit', 'Autoclave',
  'Vial Washing Machine', 'Depyrogenation Tunnel', 'Filling Machine', 'Sealing Machine',
  'Visual Inspection Machine', 'Packing Line', 'HVAC Unit', 'WFI System',
  'Purified Water System', 'Compressed Air System', 'HPLC', 'GC', 'UV Spectrophotometer',
  'Balance', 'pH Meter', 'Other',
] as const;

export const PQR_QUALIFICATION_STATUSES = [
  'Qualified', 'Partially Qualified', 'Qualification Due', 'Not Qualified', 'Not Required',
] as const;

/** Equipment Master types (from equipment-mgmt-types) aligned into PQR categories where possible. */
export const EQUIPMENT_MASTER_TYPES = [
  'Manufacturing Equipment', 'Packing Equipment', 'QC Instrument', 'Utility Equipment',
  'IT System', 'HVAC', 'Water System', 'Compressed Air System',
] as const;

export const PQR_CALIBRATION_STATUSES = [
  'Calibrated', 'Calibration Due', 'Calibration Overdue', 'Not Calibrated',
] as const;

export const PQR_PM_STATUSES = ['Completed', 'Due', 'Overdue', 'Not Applicable'] as const;

export const PQR_EQUIPMENT_COMPLIANCE_STATUSES = [
  'Complies', 'Observation', 'Major Observation', 'Critical Observation',
] as const;

export const PQR_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export type PqrEquipmentCategory = (typeof PQR_EQUIPMENT_CATEGORIES)[number];
export type PqrQualificationStatus = (typeof PQR_QUALIFICATION_STATUSES)[number];
export type PqrCalibrationStatus = (typeof PQR_CALIBRATION_STATUSES)[number];
export type PqrPmStatus = (typeof PQR_PM_STATUSES)[number];
export type PqrEquipmentComplianceStatus = (typeof PQR_EQUIPMENT_COMPLIANCE_STATUSES)[number];

export interface PqrEquipmentReviewRecord {
  id?: string;
  equipmentReviewId: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  equipmentCategory: string;
  equipmentType: string;
  department: string;
  area: string;
  modelNumber: string;
  serialNumber: string;
  manufacturer: string;
  installationDate: string;
  qualificationStatus: string;
  iqStatus: string;
  oqStatus: string;
  pqStatus: string;
  calibrationStatus: string;
  lastCalibrationDate: string;
  nextCalibrationDate: string;
  pmStatus: string;
  lastPmDate: string;
  nextPmDate: string;
  breakdownCount: number;
  downtimeHours: number;
  linkedDeviations: number;
  linkedCapa: number;
  linkedChangeControls: number;
  impactOnProduct: string;
  riskLevel: string;
  complianceStatus: PqrEquipmentComplianceStatus | string;
  complianceReasons: string[];
  remarks: string;
  batchesUsed?: string[];
  batchCount?: number;
  usageCount?: number;
  criticality?: string;
  equipmentStatus?: string;
  cleaningStatus?: string;
  validationStatus?: string;
  linkedOos?: number;
  reviewPeriodFrom?: string;
  reviewPeriodTo?: string;
  attachmentUrls?: string[];
  sourceType?: 'manual' | 'equipment_master' | 'pull' | 'equipment_usage' | 'batch_linked';
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface PqrEquipmentReviewSummary {
  totalEquipmentReviewed: number;
  qualifiedEquipment: number;
  qualificationDue: number;
  calibrationDue: number;
  calibrationOverdue: number;
  pmDue: number;
  pmOverdue: number;
  breakdownCount: number;
  equipmentDeviations: number;
  equipmentCapa: number;
  equipmentChangeControls: number;
  criticalEquipmentRisks: number;
  totalDowntimeHours?: number;
  cleaningIssues?: number;
  validationIssues?: number;
  linkedOos?: number;
}

export interface PqrEquipmentReviewFilters {
  category?: string;
  qualification?: string;
  calibration?: string;
  pm?: string;
  risk?: string;
  department?: string;
  criticality?: string;
  name?: string;
  search?: string;
}

export interface PqrEquipmentReviewCharts {
  qualificationStatus: Array<{ name: string; value: number }>;
  calibrationComplianceTrend: Array<{ month: string; compliant: number; nonCompliant: number }>;
  pmComplianceTrend: Array<{ month: string; completed: number; overdue: number }>;
  breakdownTrend: Array<{ month: string; count: number }>;
  riskDistribution: Array<{ name: string; value: number }>;
  categoryReview: Array<{ name: string; value: number }>;
  downtimeTrend: Array<{ month: string; hours: number }>;
}

export const equipmentReviewFormSchema = z.object({
  pqrId: z.string().min(1, 'PQR selection is required'),
  product: z.string().min(1, 'Product is required'),
  productCode: z.string().min(1, 'Product code is required'),
  equipmentId: z.string().min(1, 'Equipment ID is required'),
  equipmentCode: z.string().default(''),
  equipmentName: z.string().min(1, 'Equipment name is required'),
  equipmentCategory: z.enum(PQR_EQUIPMENT_CATEGORIES),
  equipmentType: z.enum(PQR_EQUIPMENT_TYPES).default('Other'),
  department: z.string().default(''),
  area: z.string().default(''),
  modelNumber: z.string().default(''),
  serialNumber: z.string().default(''),
  manufacturer: z.string().default(''),
  installationDate: z.string().default(''),
  qualificationStatus: z.enum(PQR_QUALIFICATION_STATUSES),
  iqStatus: z.string().default(''),
  oqStatus: z.string().default(''),
  pqStatus: z.string().default(''),
  calibrationStatus: z.enum(PQR_CALIBRATION_STATUSES),
  lastCalibrationDate: z.string().default(''),
  nextCalibrationDate: z.string().default(''),
  pmStatus: z.enum(PQR_PM_STATUSES),
  lastPmDate: z.string().default(''),
  nextPmDate: z.string().default(''),
  breakdownCount: z.coerce.number().nonnegative().default(0),
  downtimeHours: z.coerce.number().nonnegative().default(0),
  linkedDeviations: z.coerce.number().nonnegative().default(0),
  linkedCapa: z.coerce.number().nonnegative().default(0),
  linkedChangeControls: z.coerce.number().nonnegative().default(0),
  impactOnProduct: z.string().default('None'),
  riskLevel: z.enum(PQR_RISK_LEVELS).default('Low'),
  remarks: z.string().default(''),
}).refine((d) => !d.lastCalibrationDate || !d.nextCalibrationDate || d.nextCalibrationDate > d.lastCalibrationDate, {
  message: 'Next Calibration Date must be after Last Calibration Date', path: ['nextCalibrationDate'],
}).refine((d) => !d.lastPmDate || !d.nextPmDate || d.nextPmDate > d.lastPmDate, {
  message: 'Next PM Date must be after Last PM Date', path: ['nextPmDate'],
});

export type EquipmentReviewFormData = z.infer<typeof equipmentReviewFormSchema>;

export function mapEquipmentCategory(rawType: string): PqrEquipmentCategory {
  const t = rawType.toLowerCase();
  if (t.includes('pack')) return 'Packing Equipment';
  // Equipment Master types: HVAC, Water System, Compressed Air, QC Instrument, IT System, Utility.
  if (t.includes('hvac')) return 'HVAC Equipment';
  if (t.includes('water') || t.includes('wfi') || t.includes('purified')) return 'Water System Equipment';
  if (t.includes('compressed air') || t.includes('compressed')) return 'Utility Equipment';
  if (t.includes('qc') || t.includes('laboratory') || t.includes('instrument')) return 'QC Laboratory Equipment';
  if (t.includes('it system') || t.includes('it ') || t === 'it') return 'Utility Equipment';
  if (t.includes('utility')) return 'Utility Equipment';
  if (t.includes('micro')) return 'Microbiology Equipment';
  if (t.includes('warehouse')) return 'Warehouse Equipment';
  if (t.includes('manufactur') || t.includes('production')) return 'Manufacturing Equipment';
  const match = PQR_EQUIPMENT_CATEGORIES.find((c) => c.toLowerCase() === t);
  return match || 'Manufacturing Equipment';
}

export function mapCalibrationStatus(raw: string): PqrCalibrationStatus {
  const s = raw.toLowerCase().trim();
  if (s === 'calibrated') return 'Calibrated';
  if (s === 'overdue' || s === 'failed') return 'Calibration Overdue';
  if (s === 'due') return 'Calibration Due';
  if (s === 'not required' || s === 'not calibrated' || s === 'n/a') return 'Not Calibrated';
  return 'Not Calibrated';
}

export function mapPmStatus(raw: string): PqrPmStatus {
  const s = raw.toLowerCase().trim();
  if (s === 'completed') return 'Completed';
  if (s === 'overdue' || s === 'failed') return 'Overdue';
  if (s === 'due') return 'Due';
  if (s === 'not required' || s === 'not applicable' || s === 'n/a') return 'Not Applicable';
  return 'Not Applicable';
}

export function inferEquipmentType(name: string, category: string): string {
  const n = name.toLowerCase();
  const rules: Array<[string[], string]> = [
    [['hplc'], 'HPLC'], [['gc ', ' gc'], 'GC'], [['uv', 'spectro'], 'UV Spectrophotometer'],
    [['balance', 'weigh'], 'Balance'], [['ph meter', 'ph-meter'], 'pH Meter'],
    [['filling', 'fill machine'], 'Filling Machine'], [['sealing', 'seal machine'], 'Sealing Machine'],
    [['vial wash'], 'Vial Washing Machine'], [['depyro', 'tunnel'], 'Depyrogenation Tunnel'],
    [['autoclave'], 'Autoclave'], [['hvac', 'air handling'], 'HVAC Unit'],
    [['wfi', 'water for injection'], 'WFI System'], [['purified water', 'pw system'], 'Purified Water System'],
    [['compressed air', 'air system'], 'Compressed Air System'], [['packing line', 'pack line'], 'Packing Line'],
    [['mixing', 'mixer'], 'Mixing Vessel'], [['storage', 'tank'], 'Storage Vessel'],
    [['holding'], 'Holding Tank'], [['filter', 'filtration'], 'Filtration Unit'],
    [['visual inspect'], 'Visual Inspection Machine'],
  ];
  for (const [keys, type] of rules) {
    if (keys.some((k) => n.includes(k))) return type;
  }
  if (category.includes('Water')) return 'WFI System';
  if (category.includes('HVAC')) return 'HVAC Unit';
  return 'Other';
}

export function computeEquipmentCompliance(
  record: Partial<PqrEquipmentReviewRecord>,
): { complianceStatus: PqrEquipmentComplianceStatus; complianceReasons: string[]; riskLevel: string } {
  const reasons: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const qual = record.qualificationStatus;
  const cal = record.calibrationStatus;
  const pm = record.pmStatus;
  // 'Not Required' qualification is treated like Qualified (equipment that does not require qualification).
  const qualAcceptable = qual === 'Qualified' || qual === 'Not Required';
  const cleaning = (record.cleaningStatus || '').toLowerCase();
  const cleaningOverdue = cleaning.includes('overdue') || cleaning.includes('fail');
  const breakdowns = record.breakdownCount ?? 0;
  const criticalBreakdown = breakdowns > 0 && (record.impactOnProduct || '').toLowerCase().includes('critical');
  const linkedCriticalDev = (record.linkedDeviations ?? 0) > 0 && (record.impactOnProduct || '').toLowerCase().includes('critical');

  if (qual === 'Not Qualified') reasons.push('Equipment not qualified');
  if (cal === 'Calibration Overdue') reasons.push('Calibration overdue');
  if (pm === 'Overdue') reasons.push('PM overdue');
  if (cleaningOverdue) reasons.push('Cleaning validation overdue');
  if (breakdowns > 3) reasons.push('Multiple breakdowns');
  if (criticalBreakdown) reasons.push('Critical breakdown');
  if (linkedCriticalDev) reasons.push('Critical deviation linked');

  let complianceStatus: PqrEquipmentComplianceStatus = 'Complies';
  if (qual === 'Not Qualified' || criticalBreakdown || linkedCriticalDev) {
    complianceStatus = 'Critical Observation';
  } else if (cal === 'Calibration Overdue' || pm === 'Overdue' || cleaningOverdue || breakdowns > 1) {
    complianceStatus = 'Major Observation';
  } else if (cal === 'Calibration Due' || pm === 'Due' || qual === 'Qualification Due' || qual === 'Partially Qualified') {
    complianceStatus = 'Observation';
  } else if (
    qualAcceptable && cal !== 'Calibration Overdue' && (pm === 'Completed' || pm === 'Not Applicable')
    && !cleaningOverdue && breakdowns <= 1 && !criticalBreakdown
  ) {
    complianceStatus = 'Complies';
  } else if (reasons.length > 0) {
    complianceStatus = 'Major Observation';
  }

  const riskLevel = computeEquipmentRisk(record, complianceStatus);
  return { complianceStatus, complianceReasons: reasons, riskLevel };
}

function computeEquipmentRisk(
  record: Partial<PqrEquipmentReviewRecord>,
  compliance: PqrEquipmentComplianceStatus,
): string {
  if ((record.impactOnProduct || '').toLowerCase().includes('critical')) return 'Critical';
  if (record.qualificationStatus === 'Not Qualified' || record.qualificationStatus === 'Qualification Due') return 'Critical';
  if ((record.breakdownCount ?? 0) > 3) return 'High';
  if (record.pmStatus === 'Overdue') return 'High';
  if (record.calibrationStatus === 'Calibration Overdue') return 'High';
  if (record.calibrationStatus === 'Calibration Due' || record.pmStatus === 'Due') return 'Medium';
  if (
    (record.qualificationStatus === 'Qualified' || record.qualificationStatus === 'Not Required')
    && record.calibrationStatus !== 'Calibration Overdue'
    && record.pmStatus !== 'Overdue'
  ) return 'Low';
  if (compliance === 'Critical Observation') return 'Critical';
  if (compliance === 'Major Observation') return 'High';
  return 'Medium';
}

export function computeEquipmentSummary(
  records: PqrEquipmentReviewRecord[],
  linkedMetrics?: {
    equipmentDeviations?: number;
    equipmentCapa?: number;
    equipmentChangeControls?: number;
    equipmentOos?: number;
  },
): PqrEquipmentReviewSummary {
  const active = records.filter((r) => !r.isDeleted);
  const cleaningIssues = active.filter((r) => {
    const c = (r.cleaningStatus || '').toLowerCase();
    return c.includes('overdue') || c.includes('fail') || c.includes('not clean');
  }).length;
  const validationIssues = active.filter((r) => {
    const v = (r.validationStatus || '').toLowerCase();
    return v.includes('overdue') || v.includes('fail') || v.includes('expired') || v.includes('not valid');
  }).length;
  return {
    totalEquipmentReviewed: active.length,
    qualifiedEquipment: active.filter((r) => r.qualificationStatus === 'Qualified' || r.qualificationStatus === 'Not Required').length,
    qualificationDue: active.filter((r) => ['Qualification Due', 'Partially Qualified'].includes(r.qualificationStatus)).length,
    calibrationDue: active.filter((r) => r.calibrationStatus === 'Calibration Due').length,
    calibrationOverdue: active.filter((r) => r.calibrationStatus === 'Calibration Overdue').length,
    pmDue: active.filter((r) => r.pmStatus === 'Due').length,
    pmOverdue: active.filter((r) => r.pmStatus === 'Overdue').length,
    breakdownCount: active.reduce((s, r) => s + (r.breakdownCount || 0), 0),
    equipmentDeviations: linkedMetrics?.equipmentDeviations ?? active.reduce((s, r) => s + (r.linkedDeviations || 0), 0),
    equipmentCapa: linkedMetrics?.equipmentCapa ?? active.reduce((s, r) => s + (r.linkedCapa || 0), 0),
    equipmentChangeControls: linkedMetrics?.equipmentChangeControls ?? active.reduce((s, r) => s + (r.linkedChangeControls || 0), 0),
    criticalEquipmentRisks: active.filter((r) => r.riskLevel === 'Critical').length,
    totalDowntimeHours: Math.round(active.reduce((s, r) => s + (r.downtimeHours || 0), 0) * 10) / 10,
    cleaningIssues,
    validationIssues,
    linkedOos: linkedMetrics?.equipmentOos ?? active.reduce((s, r) => s + (r.linkedOos || 0), 0),
  };
}

export function generateEquipmentNarrative(
  summary: PqrEquipmentReviewSummary,
  records: PqrEquipmentReviewRecord[],
): string {
  const parts: string[] = [];
  if (summary.totalEquipmentReviewed === 0) {
    return 'No equipment records were reviewed for the selected PQR review period.';
  }
  const active = records.filter((r) => !r.isDeleted);
  const allCompliant = active.length > 0 && active.every((r) => r.complianceStatus === 'Complies');
  if (allCompliant) {
    parts.push('All equipment used during the review period remained qualified, calibrated and maintained as per approved procedures.');
  }
  if (summary.breakdownCount <= 1) {
    parts.push('No significant equipment breakdown affecting product quality was reported during the review period.');
  } else {
    const dt = summary.totalDowntimeHours ? ` totalling ${summary.totalDowntimeHours} downtime hour(s)` : '';
    parts.push(`${summary.breakdownCount} equipment breakdown(s)${dt} were recorded and reviewed during the review period.`);
  }
  if (summary.calibrationOverdue > 0) {
    parts.push(`${summary.calibrationOverdue} equipment calibration activity(ies) exceeded the planned schedule and were reviewed for quality impact.`);
  }
  if (summary.pmOverdue > 0) {
    parts.push(`${summary.pmOverdue} preventive maintenance activity(ies) were overdue and reviewed for quality impact.`);
  } else if (active.some((r) => r.pmStatus === 'Completed')) {
    parts.push('Preventive maintenance activities were completed as per approved maintenance schedule.');
  }
  if ((summary.cleaningIssues || 0) > 0) {
    parts.push(`${summary.cleaningIssues} equipment cleaning validation issue(s) were observed and reviewed.`);
  }
  if ((summary.validationIssues || 0) > 0) {
    parts.push(`${summary.validationIssues} equipment validation status issue(s) were reviewed for continued suitability.`);
  }
  if (summary.equipmentDeviations > 0 || (summary.linkedOos || 0) > 0 || summary.equipmentCapa > 0 || summary.equipmentChangeControls > 0) {
    parts.push(`Linked quality events: ${summary.equipmentDeviations} deviation(s), ${summary.linkedOos || 0} OOS, ${summary.equipmentCapa} CAPA, ${summary.equipmentChangeControls} change control(s).`);
  }
  parts.push(`Total ${summary.totalEquipmentReviewed} equipment items reviewed (${summary.qualifiedEquipment} qualified, ${summary.criticalEquipmentRisks} critical risk).`);
  return parts.join(' ');
}

export function buildEquipmentCharts(records: PqrEquipmentReviewRecord[]): PqrEquipmentReviewCharts {
  const active = records.filter((r) => !r.isDeleted);
  const qualMap = new Map<string, number>();
  const riskMap = new Map<string, number>();
  const catMap = new Map<string, number>();
  const calMonth = new Map<string, { compliant: number; nonCompliant: number }>();
  const pmMonth = new Map<string, { completed: number; overdue: number }>();
  const bdMonth = new Map<string, number>();
  const dtMonth = new Map<string, number>();

  active.forEach((r) => {
    qualMap.set(r.qualificationStatus, (qualMap.get(r.qualificationStatus) || 0) + 1);
    riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1);
    catMap.set(r.equipmentCategory, (catMap.get(r.equipmentCategory) || 0) + 1);
    const month = r.lastCalibrationDate?.slice(0, 7) || r.lastPmDate?.slice(0, 7) || 'Unknown';
    const cal = calMonth.get(month) || { compliant: 0, nonCompliant: 0 };
    if (r.calibrationStatus === 'Calibrated') cal.compliant += 1;
    else cal.nonCompliant += 1;
    calMonth.set(month, cal);
    const pm = pmMonth.get(month) || { completed: 0, overdue: 0 };
    if (r.pmStatus === 'Completed') pm.completed += 1;
    if (r.pmStatus === 'Overdue') pm.overdue += 1;
    pmMonth.set(month, pm);
    if (r.breakdownCount > 0) {
      bdMonth.set(month, (bdMonth.get(month) || 0) + r.breakdownCount);
      dtMonth.set(month, (dtMonth.get(month) || 0) + (r.downtimeHours || 0));
    }
  });

  return {
    qualificationStatus: Array.from(qualMap.entries()).map(([name, value]) => ({ name, value })),
    calibrationComplianceTrend: Array.from(calMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, v]) => ({ month, ...v })),
    pmComplianceTrend: Array.from(pmMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, v]) => ({ month, ...v })),
    breakdownTrend: Array.from(bdMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, count]) => ({ month, count })),
    riskDistribution: Array.from(riskMap.entries()).map(([name, value]) => ({ name, value })),
    categoryReview: Array.from(catMap.entries()).map(([name, value]) => ({ name, value })),
    downtimeTrend: Array.from(dtMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, hours]) => ({ month, hours })),
  };
}

const VIEW_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'engineering_manager', 'engineering_executive', 'maintenance', 'validation',
  'production_manager', 'production_executive',
  'qc_manager', 'qc_executive', 'warehouse_manager',
  'regulatory_affairs', 'department_head', 'auditor', 'viewer',
]);

const MANAGE_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'engineering_manager', 'maintenance', 'validation',
]);

const ADD_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'engineering_manager', 'maintenance', 'validation', 'production_manager',
]);

const EXPORT_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'auditor',
]);

export function canViewEquipmentReview(role?: string): boolean {
  return VIEW_ROLES.has(normalizeRole(role));
}

export function canManageEquipmentReview(role?: string): boolean {
  return MANAGE_ROLES.has(normalizeRole(role));
}

export function canAddEquipmentReview(role?: string): boolean {
  return ADD_ROLES.has(normalizeRole(role));
}

export function canExportEquipmentReview(role?: string): boolean {
  return EXPORT_ROLES.has(normalizeRole(role));
}

const S = (v: unknown, fb = ''): string => (v === null || v === undefined ? fb : String(v));
const N = (v: unknown, fb = 0): number => { const n = Number(v); return Number.isFinite(n) ? n : fb; };

export function normalizeEquipmentReviewRecord(raw: Record<string, unknown>): PqrEquipmentReviewRecord {
  const partial: Partial<PqrEquipmentReviewRecord> = {
    qualificationStatus: S(raw.qualificationStatus, 'Qualification Due'),
    calibrationStatus: S(raw.calibrationStatus, 'Not Calibrated'),
    pmStatus: S(raw.pmStatus, 'Not Applicable'),
    breakdownCount: N(raw.breakdownCount),
    downtimeHours: N(raw.downtimeHours),
    linkedDeviations: N(raw.linkedDeviations),
    impactOnProduct: S(raw.impactOnProduct, 'None'),
    cleaningStatus: S(raw.cleaningStatus),
    validationStatus: S(raw.validationStatus),
  };
  const hasComputed = raw.complianceStatus && Array.isArray(raw.complianceReasons) && raw.riskLevel;
  const computed = hasComputed
    ? {
      complianceStatus: S(raw.complianceStatus) as PqrEquipmentComplianceStatus,
      complianceReasons: raw.complianceReasons as string[],
      riskLevel: S(raw.riskLevel, 'Low'),
    }
    : computeEquipmentCompliance(partial);

  const batchesUsed = Array.isArray(raw.batchesUsed) ? (raw.batchesUsed as string[]).map((b) => String(b)).filter(Boolean) : [];

  return {
    id: S(raw.id),
    equipmentReviewId: S(raw.equipmentReviewId, `PER-${S(raw.id, 'X')}`),
    pqrId: S(raw.pqrId),
    pqrNumber: S(raw.pqrNumber),
    product: S(raw.product || raw.productName),
    productCode: S(raw.productCode),
    equipmentId: S(raw.equipmentId),
    equipmentCode: S(raw.equipmentCode || raw.equipmentId),
    equipmentName: S(raw.equipmentName),
    equipmentCategory: S(raw.equipmentCategory, 'Manufacturing Equipment'),
    equipmentType: S(raw.equipmentType, 'Other'),
    department: S(raw.department),
    area: S(raw.area),
    modelNumber: S(raw.modelNumber),
    serialNumber: S(raw.serialNumber),
    manufacturer: S(raw.manufacturer),
    installationDate: S(raw.installationDate).slice(0, 10),
    qualificationStatus: S(raw.qualificationStatus, 'Qualification Due'),
    iqStatus: S(raw.iqStatus),
    oqStatus: S(raw.oqStatus),
    pqStatus: S(raw.pqStatus),
    calibrationStatus: S(raw.calibrationStatus, 'Not Calibrated'),
    lastCalibrationDate: S(raw.lastCalibrationDate).slice(0, 10),
    nextCalibrationDate: S(raw.nextCalibrationDate).slice(0, 10),
    pmStatus: S(raw.pmStatus, 'Not Applicable'),
    lastPmDate: S(raw.lastPmDate).slice(0, 10),
    nextPmDate: S(raw.nextPmDate).slice(0, 10),
    breakdownCount: N(raw.breakdownCount),
    downtimeHours: N(raw.downtimeHours),
    linkedDeviations: N(raw.linkedDeviations),
    linkedCapa: N(raw.linkedCapa),
    linkedChangeControls: N(raw.linkedChangeControls),
    impactOnProduct: S(raw.impactOnProduct, 'None'),
    riskLevel: computed.riskLevel,
    complianceStatus: computed.complianceStatus,
    complianceReasons: computed.complianceReasons,
    remarks: S(raw.remarks),
    batchesUsed,
    batchCount: N(raw.batchCount, batchesUsed.length),
    usageCount: N(raw.usageCount),
    criticality: S(raw.criticality),
    equipmentStatus: S(raw.equipmentStatus),
    cleaningStatus: S(raw.cleaningStatus),
    validationStatus: S(raw.validationStatus),
    linkedOos: N(raw.linkedOos),
    reviewPeriodFrom: S(raw.reviewPeriodFrom).slice(0, 10),
    reviewPeriodTo: S(raw.reviewPeriodTo).slice(0, 10),
    attachmentUrls: Array.isArray(raw.attachmentUrls) ? raw.attachmentUrls as string[] : [],
    sourceType: (raw.sourceType as PqrEquipmentReviewRecord['sourceType']) || 'manual',
    sourceId: S(raw.sourceId),
    createdAt: S(raw.createdAt),
    updatedAt: S(raw.updatedAt),
    createdBy: S(raw.createdBy),
    updatedBy: S(raw.updatedBy),
    createdByName: S(raw.createdByName),
    updatedByName: S(raw.updatedByName),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function filterEquipmentReviewRecords(
  records: PqrEquipmentReviewRecord[],
  filters: PqrEquipmentReviewFilters,
): PqrEquipmentReviewRecord[] {
  const search = (filters.search || filters.name || '').trim().toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    if (filters.category && filters.category !== 'all' && r.equipmentCategory !== filters.category) return false;
    if (filters.qualification && filters.qualification !== 'all' && r.qualificationStatus !== filters.qualification) return false;
    if (filters.calibration && filters.calibration !== 'all' && r.calibrationStatus !== filters.calibration) return false;
    if (filters.pm && filters.pm !== 'all' && r.pmStatus !== filters.pm) return false;
    if (filters.risk && filters.risk !== 'all' && r.riskLevel !== filters.risk) return false;
    if (filters.department && filters.department !== 'all'
      && !r.department.toLowerCase().includes(filters.department.toLowerCase())) return false;
    if (filters.criticality && filters.criticality !== 'all'
      && (r.criticality || '').toLowerCase() !== filters.criticality.toLowerCase()) return false;
    if (search) {
      const hay = [
        r.equipmentName, r.equipmentId, r.equipmentCode, r.equipmentCategory,
        r.equipmentType, r.department, r.area, r.manufacturer, r.modelNumber,
        r.serialNumber, r.remarks,
      ].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export function qualificationStatusColor(status: string): string {
  if (status === 'Qualified') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Not Required') return 'bg-slate-50 text-slate-600 border-slate-200';
  if (status === 'Partially Qualified') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Qualification Due') return 'bg-orange-50 text-orange-800 border-orange-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export function calibrationStatusColor(status: string): string {
  if (status === 'Calibrated') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Calibration Due') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Calibration Overdue') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function pmStatusColor(status: string): string {
  if (status === 'Completed') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Due') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Overdue') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function equipmentComplianceColor(status: string): string {
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

export const MANUFACTURING_CATEGORIES = ['Manufacturing Equipment'];
export const PACKING_CATEGORIES = ['Packing Equipment'];
export const UTILITY_CATEGORIES = ['Utility Equipment', 'HVAC Equipment', 'Water System Equipment'];
export const QC_CATEGORIES = ['QC Laboratory Equipment', 'Microbiology Equipment'];
