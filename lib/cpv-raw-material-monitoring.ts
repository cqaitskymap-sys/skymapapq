import { z } from 'zod';
import { QC_STATUSES, COA_AVAILABLE_OPTIONS } from '@/lib/material-schemas';

export const RAW_MATERIAL_MONITORING_COLLECTION = 'raw_material_monitoring';
export const RAW_MATERIAL_LEGACY_COLLECTION = 'cpv_raw_materials';
export const RAW_MATERIAL_MODULE_NAME = 'Raw Material Monitoring';
export const RAW_MATERIAL_STORAGE_MODULE = 'cpv/raw-material-monitoring';

export const RM_MATERIAL_TYPES = [
  'API', 'Excipient', 'Preservative', 'Solvent', 'Buffer',
  'pH Adjuster', 'Vehicle', 'Raw Material', 'Other',
] as const;

export const RM_QC_STATUSES = QC_STATUSES;
export const RM_COMPLIANCE_STATUSES = [
  'Complies', 'Does Not Comply', 'Alert', 'Action', 'OOS', 'OOT',
] as const;

export const DEFAULT_RM_MATERIALS = [
  'Amikacin Sulphate IP', 'Methyl Paraben IP', 'Propyl Paraben IP',
  'Sodium Metabisulphite IP', 'Trisodium Citrate IP', 'Sulphuric Acid IP',
  'Water for Injection IP',
] as const;

const requiredText = z.string().trim().min(1, 'Required');
const optionalNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.coerce.number().optional(),
);

function parseComparableDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  const dt = new Date(trimmed);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export const rawMaterialMonitoringFormSchema = z.object({
  cpvProductId: requiredText,
  productName: requiredText,
  productCode: requiredText,
  batchNumber: requiredText,
  materialCode: requiredText,
  materialName: requiredText,
  materialType: z.enum(RM_MATERIAL_TYPES),
  materialGrade: z.string().trim().default(''),
  materialCategory: z.string().trim().default(''),
  manufacturerName: requiredText,
  supplierName: requiredText,
  vendorId: z.string().trim().default(''),
  vendorName: requiredText,
  vendorStatus: z.string().trim().default('Active'),
  avlStatus: z.string().trim().default('Approved'),
  vendorCode: z.string().trim().default(''),
  pharmacopoeiaStandard: z.string().trim().default(''),
  grnNumber: z.string().trim().default(''),
  purchaseOrderNumber: z.string().trim().default(''),
  arNumber: requiredText,
  coaNumber: z.string().trim().default(''),
  materialLotNumber: z.string().trim().default(''),
  supplierBatchNumber: z.string().trim().default(''),
  mfgDate: requiredText,
  expDate: requiredText,
  retestDate: z.string().trim().default(''),
  shelfLifeMonths: z.string().trim().default(''),
  receivedQuantity: z.coerce.number().min(0).default(0),
  acceptedQuantity: z.coerce.number().min(0).default(0),
  rejectedQuantity: z.coerce.number().min(0).default(0),
  quarantineQuantity: z.coerce.number().min(0).default(0),
  issuedQuantity: z.coerce.number().min(0).default(0),
  usedQuantity: z.coerce.number().min(0, 'Required'),
  unit: requiredText,
  storageCondition: z.string().trim().default(''),
  warehouseLocation: z.string().trim().default(''),
  storageArea: z.string().trim().default(''),
  site: z.string().trim().default(''),
  department: z.string().trim().default('Warehouse'),
  shift: z.string().trim().default(''),
  qcStatus: z.enum(RM_QC_STATUSES),
  qaStatus: z.string().trim().default(''),
  releaseStatus: z.string().trim().default(''),
  samplingStatus: z.string().trim().default(''),
  coaAvailable: z.enum(COA_AVAILABLE_OPTIONS),
  specificationNumber: z.string().trim().default(''),
  specificationVersion: z.string().trim().default(''),
  stpNumber: z.string().trim().default(''),
  testParameter: z.string().trim().default(''),
  observedResult: z.union([z.coerce.number(), z.string()]).optional(),
  lowerLimit: optionalNum,
  upperLimit: optionalNum,
  testUnit: z.string().trim().optional().default(''),
  testResultSummary: z.string().trim().default(''),
  remarks: z.string().trim().default(''),
  effectiveDate: z.string().trim().default(''),
  version: z.string().trim().default('1.0'),
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).refine((d) => {
  const mfg = parseComparableDate(d.mfgDate);
  const exp = parseComparableDate(d.expDate);
  return !!mfg && !!exp && exp > mfg;
}, { message: 'EXP date must be after MFG date', path: ['expDate'] }).refine((d) => d.usedQuantity <= d.issuedQuantity || d.issuedQuantity === 0, {
  message: 'Used quantity cannot exceed standard quantity',
  path: ['usedQuantity'],
}).refine((d) => {
  if (!d.testParameter || d.lowerLimit == null || d.upperLimit == null) return true;
  return d.lowerLimit < d.upperLimit;
}, { message: 'Upper limit must be greater than lower limit', path: ['upperLimit'] });

export type RawMaterialMonitoringFormData = z.infer<typeof rawMaterialMonitoringFormSchema>;

export interface RawMaterialAttachment {
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  category?: string;
}

export interface RawMaterialMonitoringRecord extends RawMaterialMonitoringFormData, Record<string, unknown> {
  id: string;
  rawMaterialMonitoringId: string;
  complianceStatus: string;
  riskLevel: string;
  deviationRequired: boolean;
  linkedDeviationNumber: string;
  oosRequired: boolean;
  linkedOosNumber: string;
  capaRequired: boolean;
  linkedCapaNumber: string;
  reviewStatus: 'Draft' | 'Under Review' | 'Approved';
  isLocked: boolean;
  attachments: RawMaterialAttachment[];
  warehouseReceiptId: string;
  changeReason: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface RawMaterialSummary {
  total: number;
  apiLots: number;
  excipientLots: number;
  approvedLots: number;
  rejectedLots: number;
  avlCompliant: number;
  nonCompliant: number;
  expiredRetestDue: number;
  highRisk: number;
  oosTriggered: number;
}

function parseDate(d: string): Date | null {
  if (!d) return null;
  const trimmed = d.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  const dt = new Date(trimmed);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function isMaterialExpired(expDate: string): boolean {
  const exp = parseDate(expDate);
  if (!exp) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp < today;
}

export function isRetestOverdue(retestDate: string): boolean {
  if (!retestDate) return false;
  const rt = parseDate(retestDate);
  if (!rt) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rt < today;
}

export function evaluateTestResultStatus(
  observed: number | string | undefined,
  lower?: number,
  upper?: number,
): string | null {
  if (observed === undefined || observed === '' || lower == null || upper == null) return null;
  const num = Number(observed);
  if (!Number.isFinite(num)) return 'Does Not Comply';
  if (num < lower || num > upper) return 'OOS';
  const range = upper - lower;
  if (range > 0) {
    const alertLow = lower + range * 0.1;
    const alertHigh = upper - range * 0.1;
    if (num < alertLow || num > alertHigh) return 'OOT';
  }
  return 'Complies';
}

export function evaluateRawMaterialCompliance(input: {
  vendorStatus: string;
  avlStatus: string;
  qcStatus: string;
  coaAvailable: string;
  expDate: string;
  retestDate?: string;
  usedQuantity: number;
  issuedQuantity: number;
  testParameter?: string;
  observedResult?: number | string;
  lowerLimit?: number;
  upperLimit?: number;
}): string {
  const vendorOk = input.vendorStatus === 'Active';
  const avlOk = ['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(input.avlStatus);
  const qcOk = input.qcStatus === 'Approved';
  const coaOk = input.coaAvailable === 'Yes';
  const notExpired = !isMaterialExpired(input.expDate);
  const retestOk = !isRetestOverdue(input.retestDate || '');
  const qtyOk = input.issuedQuantity === 0 || input.usedQuantity <= input.issuedQuantity;

  const testStatus = input.testParameter
    ? evaluateTestResultStatus(input.observedResult, input.lowerLimit, input.upperLimit)
    : null;

  if (!vendorOk || !avlOk || !qcOk || !coaOk || !notExpired || !retestOk || !qtyOk) {
    return 'Does Not Comply';
  }
  if (testStatus === 'OOS') return 'OOS';
  if (testStatus === 'OOT' || testStatus === 'Alert') return 'OOT';
  if (testStatus === 'Action') return 'Action';
  if (testStatus === 'Does Not Comply') return 'Does Not Comply';
  return 'Complies';
}

export function evaluateRawMaterialRisk(
  record: Pick<RawMaterialMonitoringRecord, 'expDate' | 'retestDate' | 'avlStatus' | 'vendorStatus' | 'qcStatus' | 'coaAvailable' | 'usedQuantity' | 'issuedQuantity' | 'complianceStatus'>,
  issueCount: number,
): string {
  if (isMaterialExpired(record.expDate)) return 'Critical';
  if (record.qcStatus === 'Rejected') return 'Critical';
  if (issueCount >= 3) return 'High';
  if (!['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(record.avlStatus)) return 'High';
  if (record.coaAvailable !== 'Yes') return 'Medium';
  if (record.issuedQuantity > 0 && record.usedQuantity > record.issuedQuantity) return 'Medium';
  if (isRetestOverdue(record.retestDate || '')) return 'High';
  if (record.complianceStatus === 'OOS') return 'High';
  if (['OOT', 'Alert', 'Action'].includes(record.complianceStatus)) return 'Medium';
  return 'Low';
}

export function buildRawMaterialMonitoringId(batchNumber: string, materialCode: string, arNumber: string): string {
  return `RM-${batchNumber}-${materialCode}-${arNumber}`.replace(/\s+/g, '-').toUpperCase();
}

export function summarizeRawMaterialRecords(records: RawMaterialMonitoringRecord[]): RawMaterialSummary {
  return {
    total: records.length,
    apiLots: records.filter((r) => r.materialType === 'API').length,
    excipientLots: records.filter((r) => r.materialType === 'Excipient').length,
    approvedLots: records.filter((r) => r.qcStatus === 'Approved').length,
    rejectedLots: records.filter((r) => r.qcStatus === 'Rejected').length,
    avlCompliant: records.filter((r) => ['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(r.avlStatus)).length,
    nonCompliant: records.filter((r) => r.complianceStatus !== 'Complies').length,
    expiredRetestDue: records.filter((r) => isMaterialExpired(r.expDate) || isRetestOverdue(r.retestDate || '')).length,
    highRisk: records.filter((r) => r.riskLevel === 'High' || r.riskLevel === 'Critical').length,
    oosTriggered: records.filter((r) => r.oosRequired || r.linkedOosNumber).length,
  };
}

export function buildRawMaterialChartSeries(records: RawMaterialMonitoringRecord[]) {
  const byMonth = new Map<string, number>();
  records.forEach((r) => {
    const key = (r.createdAt || '').slice(0, 7) || 'unknown';
    byMonth.set(key, (byMonth.get(key) || 0) + Number(r.usedQuantity || 0));
  });
  const usageTrend = Array.from(byMonth.entries())
    .map(([month, qty]) => ({ month, quantity: qty }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const vendorMap = new Map<string, number>();
  records.forEach((r) => vendorMap.set(r.vendorName, (vendorMap.get(r.vendorName) || 0) + 1));
  const vendorTrend = Array.from(vendorMap.entries())
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const approved = records.filter((r) => r.qcStatus === 'Approved').length;
  const rejected = records.filter((r) => r.qcStatus === 'Rejected').length;
  const approvedVsRejected = [
    { status: 'Approved', count: approved },
    { status: 'Rejected', count: rejected },
    { status: 'Other', count: records.length - approved - rejected },
  ];

  const avlByMonth = new Map<string, { ok: number; total: number }>();
  records.forEach((r) => {
    const key = (r.createdAt || '').slice(0, 7) || 'unknown';
    const e = avlByMonth.get(key) || { ok: 0, total: 0 };
    e.total += 1;
    if (['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(r.avlStatus)) e.ok += 1;
    avlByMonth.set(key, e);
  });
  const avlComplianceTrend = Array.from(avlByMonth.entries())
    .map(([month, v]) => ({ month, rate: v.total ? Math.round((v.ok / v.total) * 100) : 0 }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const riskMap = new Map<string, number>();
  records.forEach((r) => riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1));
  const riskDistribution = Array.from(riskMap.entries()).map(([level, count]) => ({ level, count }));

  const retestByMonth = new Map<string, number>();
  records.filter((r) => isRetestOverdue(r.retestDate || '')).forEach((r) => {
    const key = (r.retestDate || '').slice(0, 7) || 'unknown';
    retestByMonth.set(key, (retestByMonth.get(key) || 0) + 1);
  });
  const retestDueTrend = Array.from(retestByMonth.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const materialUsage = new Map<string, number>();
  records.forEach((r) => materialUsage.set(r.materialName, (materialUsage.get(r.materialName) || 0) + Number(r.usedQuantity || 0)));
  const materialUsageTrend = Array.from(materialUsage.entries())
    .map(([material, quantity]) => ({ material, quantity }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  return {
    usageTrend, vendorTrend, approvedVsRejected, avlComplianceTrend,
    riskDistribution, retestDueTrend, materialUsageTrend,
  };
}
