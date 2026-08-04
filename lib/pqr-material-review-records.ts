import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';

export const PQR_MATERIAL_REVIEW_MODULE = 'PQR Material Review';

export const PQR_MATERIAL_REVIEW_COLLECTIONS = {
  materialReview: 'pqr_material_review',
  batchReview: 'pqr_batch_review',
  sections: 'pqr_sections',
  records: 'pqr_records',
  recordsLegacy: 'pqr_documents',
  batches: 'batches',
  cpvBatches: 'cpv_batches',
  rawMaterialMonitoring: 'raw_material_monitoring',
  materialMaster: 'material_master',
  warehouseMaterials: 'warehouse_materials',
  vendors: 'vendors',
  approvedVendorList: 'approved_vendor_list',
  deviations: 'deviations',
  oosRecords: 'oos_records',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
  complaints: 'complaints',
} as const;

export const PQR_MATERIAL_TYPES = [
  'API', 'Raw Material', 'Excipient', 'Preservative', 'Solvent',
  'Buffer', 'pH Adjuster', 'Vehicle', 'Processing Aid', 'Intermediate', 'Other',
] as const;

export const PQR_QC_STATUSES = [
  'Approved', 'Rejected', 'Under Test', 'Quarantine', 'Retest Required',
] as const;

export const PQR_COMPLIANCE_STATUSES = ['Complies', 'Does Not Comply', 'Not Applicable'] as const;

export const PQR_AVL_STATUSES = ['Approved', 'Not Approved', 'Conditional Approved', 'Blocked'] as const;

export const PQR_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export type PqrMaterialType = (typeof PQR_MATERIAL_TYPES)[number];
export type PqrQcStatus = (typeof PQR_QC_STATUSES)[number];
export type PqrComplianceStatus = (typeof PQR_COMPLIANCE_STATUSES)[number];

export interface PqrMaterialReviewRecord {
  id?: string;
  materialReviewId: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  batchNumber: string;
  materialType: string;
  materialCode: string;
  materialName: string;
  materialGrade: string;
  manufacturerName: string;
  supplierName: string;
  vendorAvlStatus: string;
  grnNumber: string;
  arNumber: string;
  coaNumber: string;
  materialLotNumber: string;
  mfgDate: string;
  expDate: string;
  retestDate: string;
  receivedQuantity: number;
  issuedQuantity: number;
  usedQuantity: number;
  returnedQuantity?: number;
  rejectedQuantity?: number;
  unit: string;
  qcStatus: string;
  coaAvailable: 'Yes' | 'No';
  specificationNumber: string;
  stpNumber: string;
  complianceStatus: PqrComplianceStatus | string;
  complianceReasons: string[];
  riskLevel: string;
  remarks: string;
  varianceQty?: number | null;
  variancePct?: number | null;
  linkedDeviationCount?: number;
  linkedOosCount?: number;
  linkedCapaCount?: number;
  sourceType?: 'manual' | 'raw_material_monitoring' | 'warehouse' | 'material_master';
  sourceId?: string;
  attachmentUrls?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface VendorAvlRow {
  id: string;
  supplierName: string;
  manufacturerName: string;
  materialCount: number;
  avlStatus: string;
  compliantLots: number;
  nonCompliantLots: number;
}

export interface PqrMaterialReviewSummary {
  totalMaterialLots: number;
  totalApiLots: number;
  totalRawMaterialLots: number;
  approvedLots: number;
  rejectedLots: number;
  pendingLots: number;
  avlApprovedLots: number;
  nonCompliantLots: number;
  expiredMaterials: number;
  retestDueMaterials: number;
  materialOosCount: number;
  materialDeviationCount: number;
  materialCapaCount: number;
  acceptancePct: number;
  rejectionPct: number;
  uniqueMaterials: number;
  uniqueSuppliers: number;
}

export interface PqrMaterialReviewCharts {
  materialTypeDistribution: Array<{ name: string; value: number }>;
  approvedVsRejected: Array<{ name: string; value: number }>;
  vendorUsage: Array<{ vendor: string; count: number }>;
  avlComplianceTrend: Array<{ month: string; compliant: number; nonCompliant: number }>;
  riskDistribution: Array<{ name: string; value: number }>;
  retestDueTrend: Array<{ month: string; count: number }>;
}

export interface PqrMaterialReviewFilters {
  materialType?: string;
  qcStatus?: string;
  complianceStatus?: string;
  avlStatus?: string;
  riskLevel?: string;
  material?: string;
  batch?: string;
  manufacturer?: string;
  supplier?: string;
  search?: string;
}

export const materialReviewFormSchema = z.object({
  pqrId: z.string().min(1, 'PQR selection is required'),
  product: z.string().min(1, 'Product is required'),
  productCode: z.string().min(1, 'Product code is required'),
  batchNumber: z.string().default(''),
  materialType: z.enum(PQR_MATERIAL_TYPES),
  materialName: z.string().min(1, 'Material name is required'),
  materialCode: z.string().default(''),
  materialGrade: z.string().default(''),
  manufacturerName: z.string().min(1, 'Manufacturer is required'),
  supplierName: z.string().min(1, 'Supplier is required'),
  vendorAvlStatus: z.enum(PQR_AVL_STATUSES).default('Not Approved'),
  grnNumber: z.string().default(''),
  arNumber: z.string().min(1, 'AR Number is required'),
  coaNumber: z.string().default(''),
  materialLotNumber: z.string().default(''),
  mfgDate: z.string().default(''),
  expDate: z.string().default(''),
  retestDate: z.string().default(''),
  receivedQuantity: z.coerce.number().nonnegative().default(0),
  issuedQuantity: z.coerce.number().nonnegative().default(0),
  usedQuantity: z.coerce.number().nonnegative('Used quantity is required'),
  returnedQuantity: z.coerce.number().nonnegative().optional().nullable(),
  rejectedQuantity: z.coerce.number().nonnegative().optional().nullable(),
  unit: z.string().min(1, 'Unit is required'),
  qcStatus: z.enum(PQR_QC_STATUSES),
  coaAvailable: z.enum(['Yes', 'No']),
  specificationNumber: z.string().default(''),
  stpNumber: z.string().default(''),
  riskLevel: z.enum(PQR_RISK_LEVELS).default('Low'),
  remarks: z.string().default(''),
}).refine((d) => {
  const mfg = d.mfgDate.length === 7 ? `${d.mfgDate}-01` : d.mfgDate;
  const exp = d.expDate.length === 7 ? `${d.expDate}-01` : d.expDate;
  return !mfg || !exp || exp > mfg;
}, {
  message: 'EXP Date must be after MFG Date', path: ['expDate'],
}).refine((d) => d.usedQuantity <= d.issuedQuantity || d.issuedQuantity === 0, {
  message: 'Used Quantity cannot exceed Issued Quantity', path: ['usedQuantity'],
}).refine((d) => d.qcStatus !== 'Rejected' || (d.remarks || '').trim().length > 0, {
  message: 'Remarks / rejection reason required for rejected QC status',
  path: ['remarks'],
});

export type MaterialReviewFormData = z.infer<typeof materialReviewFormSchema>;

export function computeQuantityVariance(
  issued?: number | null,
  used?: number | null,
): { varianceQty: number | null; variancePct: number | null } {
  if (issued == null || used == null || !Number.isFinite(issued) || !Number.isFinite(used)) {
    return { varianceQty: null, variancePct: null };
  }
  if (issued <= 0) return { varianceQty: used - issued, variancePct: null };
  const varianceQty = Math.round((used - issued) * 1000) / 1000;
  const variancePct = Math.round(((used - issued) / issued) * 1000) / 10;
  return { varianceQty, variancePct };
}

export function computeMaterialCompliance(record: Partial<PqrMaterialReviewRecord>): {
  complianceStatus: PqrComplianceStatus;
  complianceReasons: string[];
  riskLevel: string;
} {
  const reasons: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (record.vendorAvlStatus && record.vendorAvlStatus !== 'Approved') reasons.push('Vendor not approved');
  if (record.qcStatus && record.qcStatus !== 'Approved') reasons.push('QC not approved');
  if (record.coaAvailable !== 'Yes') reasons.push('COA missing');

  if (record.expDate) {
    const exp = new Date(record.expDate.length === 7 ? `${record.expDate}-01` : record.expDate);
    if (!Number.isNaN(exp.getTime()) && exp < today) reasons.push('Material expired');
  }
  if (record.retestDate) {
    const retest = new Date(record.retestDate);
    if (!Number.isNaN(retest.getTime()) && retest < today) reasons.push('Retest overdue');
  }
  if (
    record.usedQuantity !== undefined && record.issuedQuantity !== undefined
    && record.issuedQuantity > 0 && record.usedQuantity > record.issuedQuantity
  ) {
    reasons.push('Quantity mismatch');
  }

  let riskLevel = 'Low';
  if (reasons.length >= 3 || record.qcStatus === 'Rejected') riskLevel = 'Critical';
  else if (reasons.length >= 2) riskLevel = 'High';
  else if (reasons.length === 1) riskLevel = 'Medium';
  if (record.riskLevel === 'Critical' || record.riskLevel === 'High') {
    const order = ['Low', 'Medium', 'High', 'Critical'];
    if (order.indexOf(record.riskLevel) > order.indexOf(riskLevel)) riskLevel = record.riskLevel;
  }

  return {
    complianceStatus: reasons.length === 0 ? 'Complies' : 'Does Not Comply',
    complianceReasons: reasons,
    riskLevel,
  };
}

export function computeMaterialSummary(
  records: PqrMaterialReviewRecord[],
  qualityMetrics?: {
    materialOosCount?: number;
    materialDeviationCount?: number;
    materialCapaCount?: number;
  },
): PqrMaterialReviewSummary {
  const active = records.filter((r) => !r.isDeleted);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const isApi = (t: string) => t === 'API' || t.toLowerCase().includes('active');
  const isRaw = (t: string) => [
    'Raw Material', 'Excipient', 'Preservative', 'Buffer', 'pH Adjuster',
    'Vehicle', 'Solvent', 'Processing Aid', 'Intermediate',
  ].includes(t);

  const approved = active.filter((r) => r.qcStatus === 'Approved').length;
  const rejected = active.filter((r) => r.qcStatus === 'Rejected').length;
  const pending = active.filter((r) =>
    ['Under Test', 'Quarantine', 'Retest Required'].includes(r.qcStatus),
  ).length;
  const total = active.length;

  return {
    totalMaterialLots: total,
    totalApiLots: active.filter((r) => isApi(r.materialType)).length,
    totalRawMaterialLots: active.filter((r) => isRaw(r.materialType)).length,
    approvedLots: approved,
    rejectedLots: rejected,
    pendingLots: pending,
    avlApprovedLots: active.filter((r) => r.vendorAvlStatus === 'Approved').length,
    nonCompliantLots: active.filter((r) => r.complianceStatus === 'Does Not Comply').length,
    expiredMaterials: active.filter((r) => r.expDate && new Date(r.expDate.length === 7 ? `${r.expDate}-01` : r.expDate) < today).length,
    retestDueMaterials: active.filter((r) => r.retestDate && new Date(r.retestDate) < today).length,
    materialOosCount: qualityMetrics?.materialOosCount ?? 0,
    materialDeviationCount: qualityMetrics?.materialDeviationCount ?? 0,
    materialCapaCount: qualityMetrics?.materialCapaCount ?? 0,
    acceptancePct: total ? Math.round((approved / total) * 1000) / 10 : 0,
    rejectionPct: total ? Math.round((rejected / total) * 1000) / 10 : 0,
    uniqueMaterials: new Set(active.map((r) => r.materialName.toLowerCase()).filter(Boolean)).size,
    uniqueSuppliers: new Set(active.map((r) => r.supplierName.toLowerCase()).filter(Boolean)).size,
  };
}

export function generateMaterialNarrative(
  summary: PqrMaterialReviewSummary,
  records: PqrMaterialReviewRecord[],
): string {
  const parts: string[] = [];
  if (summary.totalMaterialLots === 0) {
    return 'No material lots were recorded for the selected PQR review period.';
  }
  if (summary.nonCompliantLots === 0 && summary.rejectedLots === 0) {
    parts.push('All API and raw materials used during the review period were procured from approved vendors and complied with approved specifications.');
  }
  if (summary.rejectedLots === 0) {
    parts.push('No raw material rejection was observed during the review period.');
  } else {
    parts.push(`${summary.rejectedLots} material lot(s) were rejected during the review period.`);
  }
  if (summary.nonCompliantLots > 0) {
    parts.push('Non-compliant material lots were observed during the review period and reviewed for quality impact.');
  }
  const active = records.filter((r) => !r.isDeleted);
  const allVendorsApproved = active.length > 0 && active.every((r) => r.vendorAvlStatus === 'Approved');
  if (allVendorsApproved) {
    parts.push('All material suppliers/manufacturers were available in the approved vendor list.');
  }
  if (summary.materialDeviationCount > 0 || summary.materialOosCount > 0 || summary.materialCapaCount > 0) {
    parts.push(`Linked quality events: ${summary.materialDeviationCount} deviation(s), ${summary.materialOosCount} OOS, ${summary.materialCapaCount} CAPA.`);
  }
  parts.push(
    `Total ${summary.totalMaterialLots} material lots reviewed (${summary.totalApiLots} API, ${summary.totalRawMaterialLots} raw/excipient) with ${summary.acceptancePct}% acceptance and ${summary.rejectionPct}% rejection.`,
  );
  return parts.join(' ');
}

export function buildMaterialCharts(records: PqrMaterialReviewRecord[]): PqrMaterialReviewCharts {
  const active = records.filter((r) => !r.isDeleted);
  const typeMap = new Map<string, number>();
  const vendorMap = new Map<string, number>();
  const riskMap = new Map<string, number>();
  const avlMonth = new Map<string, { compliant: number; nonCompliant: number }>();
  const retestMonth = new Map<string, number>();

  active.forEach((r) => {
    typeMap.set(r.materialType || 'Unknown', (typeMap.get(r.materialType || 'Unknown') || 0) + 1);
    const vendor = r.supplierName || r.manufacturerName || 'Unknown';
    vendorMap.set(vendor, (vendorMap.get(vendor) || 0) + 1);
    riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1);
    const month = (r.mfgDate || '').slice(0, 7) || 'Unknown';
    const cur = avlMonth.get(month) || { compliant: 0, nonCompliant: 0 };
    if (r.complianceStatus === 'Complies') cur.compliant += 1;
    else cur.nonCompliant += 1;
    avlMonth.set(month, cur);
    if (r.retestDate) {
      const rm = r.retestDate.slice(0, 7);
      retestMonth.set(rm, (retestMonth.get(rm) || 0) + 1);
    }
  });

  return {
    materialTypeDistribution: Array.from(typeMap.entries()).map(([name, value]) => ({ name, value })),
    approvedVsRejected: [
      { name: 'Approved', value: active.filter((r) => r.qcStatus === 'Approved').length },
      { name: 'Rejected', value: active.filter((r) => r.qcStatus === 'Rejected').length },
      { name: 'Pending', value: active.filter((r) => ['Under Test', 'Quarantine', 'Retest Required'].includes(r.qcStatus)).length },
    ],
    vendorUsage: Array.from(vendorMap.entries()).slice(0, 8).map(([vendor, count]) => ({ vendor, count })),
    avlComplianceTrend: Array.from(avlMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, v]) => ({ month, ...v })),
    riskDistribution: Array.from(riskMap.entries()).map(([name, value]) => ({ name, value })),
    retestDueTrend: Array.from(retestMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, count]) => ({ month, count })),
  };
}

export function buildVendorAvlRows(records: PqrMaterialReviewRecord[]): VendorAvlRow[] {
  const map = new Map<string, VendorAvlRow>();
  records.filter((r) => !r.isDeleted).forEach((r) => {
    const key = `${r.supplierName}|${r.manufacturerName}`;
    const cur = map.get(key) || {
      id: key,
      supplierName: r.supplierName,
      manufacturerName: r.manufacturerName,
      materialCount: 0,
      avlStatus: r.vendorAvlStatus,
      compliantLots: 0,
      nonCompliantLots: 0,
    };
    cur.materialCount += 1;
    if (r.complianceStatus === 'Complies') cur.compliantLots += 1;
    else cur.nonCompliantLots += 1;
    if (r.vendorAvlStatus === 'Blocked' || r.vendorAvlStatus === 'Not Approved') {
      cur.avlStatus = r.vendorAvlStatus;
    }
    map.set(key, cur);
  });
  return Array.from(map.values());
}

export function normalizeMaterialReviewRecord(raw: Record<string, unknown>): PqrMaterialReviewRecord {
  const issued = Number(raw.issuedQuantity ?? raw.issued_quantity) || 0;
  const used = Number(raw.usedQuantity ?? raw.used_quantity) || 0;
  const variance = computeQuantityVariance(issued, used);
  const partial: Partial<PqrMaterialReviewRecord> = {
    vendorAvlStatus: String(raw.vendorAvlStatus || 'Not Approved'),
    qcStatus: String(raw.qcStatus || raw.status || 'Under Test'),
    coaAvailable: String(raw.coaAvailable || 'No') === 'Yes' ? 'Yes' : 'No',
    expDate: String(raw.expDate || '').slice(0, 10),
    retestDate: String(raw.retestDate || '').slice(0, 10),
    usedQuantity: used,
    issuedQuantity: issued,
    riskLevel: String(raw.riskLevel || 'Low'),
  };
  const compliance = raw.complianceStatus && Array.isArray(raw.complianceReasons)
    ? {
      complianceStatus: String(raw.complianceStatus),
      complianceReasons: raw.complianceReasons as string[],
      riskLevel: String(raw.riskLevel || computeMaterialCompliance(partial).riskLevel),
    }
    : computeMaterialCompliance(partial);

  return {
    id: String(raw.id || ''),
    materialReviewId: String(raw.materialReviewId || `PMR-${raw.id || 'X'}`),
    pqrId: String(raw.pqrId || raw.pqr_id || ''),
    pqrNumber: String(raw.pqrNumber || ''),
    product: String(raw.product || raw.productName || ''),
    productCode: String(raw.productCode || ''),
    batchNumber: String(raw.batchNumber || ''),
    materialType: String(raw.materialType || 'Raw Material'),
    materialCode: String(raw.materialCode || ''),
    materialName: String(raw.materialName || ''),
    materialGrade: String(raw.materialGrade || ''),
    manufacturerName: String(raw.manufacturerName || ''),
    supplierName: String(raw.supplierName || ''),
    vendorAvlStatus: String(raw.vendorAvlStatus || 'Not Approved'),
    grnNumber: String(raw.grnNumber || ''),
    arNumber: String(raw.arNumber || ''),
    coaNumber: String(raw.coaNumber || ''),
    materialLotNumber: String(raw.materialLotNumber || ''),
    mfgDate: String(raw.mfgDate || '').slice(0, 10),
    expDate: String(raw.expDate || '').slice(0, 10),
    retestDate: String(raw.retestDate || '').slice(0, 10),
    receivedQuantity: Number(raw.receivedQuantity) || 0,
    issuedQuantity: issued,
    usedQuantity: used,
    returnedQuantity: raw.returnedQuantity != null ? Number(raw.returnedQuantity) : 0,
    rejectedQuantity: raw.rejectedQuantity != null ? Number(raw.rejectedQuantity) : 0,
    unit: String(raw.unit || 'Kg'),
    qcStatus: String(raw.qcStatus || 'Under Test'),
    coaAvailable: String(raw.coaAvailable || 'No') === 'Yes' ? 'Yes' : 'No',
    specificationNumber: String(raw.specificationNumber || ''),
    stpNumber: String(raw.stpNumber || ''),
    complianceStatus: compliance.complianceStatus,
    complianceReasons: compliance.complianceReasons,
    riskLevel: compliance.riskLevel,
    remarks: String(raw.remarks || ''),
    varianceQty: variance.varianceQty,
    variancePct: variance.variancePct,
    linkedDeviationCount: Number(raw.linkedDeviationCount) || 0,
    linkedOosCount: Number(raw.linkedOosCount) || 0,
    linkedCapaCount: Number(raw.linkedCapaCount) || 0,
    sourceType: (raw.sourceType as PqrMaterialReviewRecord['sourceType']) || 'manual',
    sourceId: String(raw.sourceId || ''),
    attachmentUrls: Array.isArray(raw.attachmentUrls) ? raw.attachmentUrls as string[] : [],
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    createdBy: String(raw.createdBy || ''),
    updatedBy: String(raw.updatedBy || ''),
    createdByName: String(raw.createdByName || ''),
    updatedByName: String(raw.updatedByName || ''),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function filterMaterialReviewRecords(
  records: PqrMaterialReviewRecord[],
  filters: PqrMaterialReviewFilters,
): PqrMaterialReviewRecord[] {
  const search = (filters.search || '').trim().toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    if (filters.materialType && filters.materialType !== 'all' && r.materialType !== filters.materialType) return false;
    if (filters.qcStatus && filters.qcStatus !== 'all' && r.qcStatus !== filters.qcStatus) return false;
    if (filters.complianceStatus && filters.complianceStatus !== 'all' && r.complianceStatus !== filters.complianceStatus) return false;
    if (filters.avlStatus && filters.avlStatus !== 'all' && r.vendorAvlStatus !== filters.avlStatus) return false;
    if (filters.riskLevel && filters.riskLevel !== 'all' && r.riskLevel !== filters.riskLevel) return false;
    if (filters.material && !r.materialName.toLowerCase().includes(filters.material.toLowerCase())
      && !r.materialCode.toLowerCase().includes(filters.material.toLowerCase())) return false;
    if (filters.batch && !`${r.batchNumber} ${r.materialLotNumber}`.toLowerCase().includes(filters.batch.toLowerCase())) return false;
    if (filters.manufacturer && !r.manufacturerName.toLowerCase().includes(filters.manufacturer.toLowerCase())) return false;
    if (filters.supplier && !r.supplierName.toLowerCase().includes(filters.supplier.toLowerCase())) return false;
    if (search) {
      const hay = [
        r.materialName, r.materialCode, r.arNumber, r.batchNumber, r.materialLotNumber,
        r.supplierName, r.manufacturerName, r.remarks, r.grnNumber,
      ].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

const VIEW_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'qc_manager', 'qc_executive',
  'production_manager', 'production_executive',
  'warehouse_manager', 'warehouse_executive',
  'auditor', 'viewer',
]);

const MANAGE_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
]);

const QC_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qc_manager', 'qc_executive',
]);

const ADD_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'warehouse_manager', 'warehouse_executive',
]);

const EXPORT_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'auditor',
]);

export function canViewMaterialReview(role?: string): boolean {
  return VIEW_ROLES.has(normalizeRole(role));
}

export function canManageMaterialReview(role?: string): boolean {
  return MANAGE_ROLES.has(normalizeRole(role));
}

export function canUpdateMaterialQc(role?: string): boolean {
  return QC_ROLES.has(normalizeRole(role));
}

export function canAddMaterialReview(role?: string): boolean {
  return ADD_ROLES.has(normalizeRole(role));
}

export function canExportMaterialReview(role?: string): boolean {
  return EXPORT_ROLES.has(normalizeRole(role));
}

export function qcStatusColor(status: string): string {
  if (status === 'Approved') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Rejected') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Quarantine' || status === 'Retest Required') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export function avlStatusColor(status: string): string {
  if (status === 'Approved') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Conditional Approved') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Blocked' || status === 'Not Approved') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function complianceStatusColor(status: string): string {
  if (status === 'Complies') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Does Not Comply') return 'bg-red-50 text-red-700 border-red-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

export function riskLevelColor(level: string): string {
  if (level === 'Critical') return 'bg-red-900/10 text-red-900 border-red-300';
  if (level === 'High') return 'bg-red-50 text-red-700 border-red-200';
  if (level === 'Medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-green-50 text-green-700 border-green-200';
}

export function formatQty(value: number | null | undefined, unit?: string): string {
  if (value == null || !Number.isFinite(value)) return 'Data Not Available';
  return unit ? `${value} ${unit}` : String(value);
}

export function formatVariance(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return 'Data Not Available';
  return `${pct}%`;
}
