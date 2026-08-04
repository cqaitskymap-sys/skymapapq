import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';

export const PQR_PACKAGING_REVIEW_MODULE = 'PQR Packaging Review';

export const PQR_PACKAGING_REVIEW_COLLECTIONS = {
  packagingReview: 'pqr_packaging_review',
  batchReview: 'pqr_batch_review',
  sections: 'pqr_sections',
  records: 'pqr_records',
  recordsLegacy: 'pqr_documents',
  batches: 'batches',
  cpvBatches: 'cpv_batches',
  packingMaterialMonitoring: 'packing_material_monitoring',
  packingMaterialMaster: 'packing_material_master',
  warehouseMaterials: 'warehouse_materials',
  vendors: 'vendors',
  approvedVendorList: 'approved_vendor_list',
  deviations: 'deviations',
  oosRecords: 'oos_records',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
  complaints: 'complaints',
} as const;

export const PQR_PACKAGING_TYPES = [
  'Primary Packaging Material',
  'Secondary Packaging Material',
  'Tertiary Packaging Material',
] as const;

export const PQR_PACKAGING_CATEGORIES = [
  'Glass Vial', 'Ampoule', 'Bottle', 'Blister', 'Rubber Stopper', 'Flip Off Seal',
  'Cap', 'Closure', 'Label', 'Carton', 'Package Insert / Leaflet',
  'Shipper Box', 'PVC Film', 'BOPP Tape', 'Tube', 'Other',
] as const;

export const PQR_QC_STATUSES = [
  'Approved', 'Rejected', 'Under Test', 'Quarantine', 'Retest Required',
] as const;

export const PQR_RECONCILIATION_STATUSES = ['Matched', 'Mismatch', 'Not Applicable'] as const;

export const PQR_COMPLIANCE_STATUSES = ['Complies', 'Does Not Comply', 'Not Applicable'] as const;

export const PQR_AVL_STATUSES = ['Approved', 'Not Approved', 'Conditional Approved', 'Blocked'] as const;

export const PQR_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export const LABEL_CATEGORIES = ['Label', 'Package Insert / Leaflet'];

export type PqrPackagingType = (typeof PQR_PACKAGING_TYPES)[number];
export type PqrPackagingCategory = (typeof PQR_PACKAGING_CATEGORIES)[number];
export type PqrQcStatus = (typeof PQR_QC_STATUSES)[number];
export type PqrReconciliationStatus = (typeof PQR_RECONCILIATION_STATUSES)[number];
export type PqrComplianceStatus = (typeof PQR_COMPLIANCE_STATUSES)[number];

export interface PqrPackagingReviewRecord {
  id?: string;
  packagingReviewId: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  batchNumber: string;
  packagingMaterialType: string;
  packagingMaterialCategory: string;
  materialCode: string;
  materialName: string;
  manufacturerName: string;
  supplierName: string;
  vendorAvlStatus: string;
  grnNumber: string;
  arNumber: string;
  coaNumber: string;
  materialLotNumber: string;
  mfgDate: string;
  expDate: string;
  receivedQuantity: number;
  issuedQuantity: number;
  usedQuantity: number;
  rejectedQuantity: number;
  returnedQuantity: number;
  balanceQuantity: number;
  unit: string;
  qcStatus: string;
  coaAvailable: 'Yes' | 'No';
  specificationNumber: string;
  stpNumber: string;
  reconciliationStatus: PqrReconciliationStatus | string;
  complianceStatus: PqrComplianceStatus | string;
  complianceReasons: string[];
  riskLevel: string;
  remarks: string;
  rejectionPct?: number | null;
  variancePct?: number | null;
  linkedOosCount?: number;
  sourceType?: 'manual' | 'packing_material_monitoring' | 'warehouse' | 'packing_material_master';
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

export interface PackagingVendorAvlRow {
  id: string;
  supplierName: string;
  manufacturerName: string;
  materialCount: number;
  avlStatus: string;
  compliantLots: number;
  nonCompliantLots: number;
}

export interface PqrPackagingReviewSummary {
  totalPackagingLots: number;
  primaryPackagingLots: number;
  secondaryPackagingLots: number;
  tertiaryPackagingLots: number;
  approvedLots: number;
  rejectedLots: number;
  pendingLots: number;
  avlApprovedLots: number;
  nonCompliantLots: number;
  reconciliationMismatchCount: number;
  expiredMaterials: number;
  packagingDeviationCount: number;
  packagingCapaCount: number;
  packagingOosCount: number;
  acceptancePct: number;
  rejectionPct: number;
  uniqueMaterials: number;
  uniqueSuppliers: number;
  totalRejectedQty: number;
}

export interface PqrPackagingReviewCharts {
  packagingTypeDistribution: Array<{ name: string; value: number }>;
  approvedVsRejected: Array<{ name: string; value: number }>;
  vendorUsage: Array<{ vendor: string; count: number }>;
  avlComplianceTrend: Array<{ month: string; compliant: number; nonCompliant: number }>;
  reconciliationMismatchTrend: Array<{ month: string; count: number }>;
  riskDistribution: Array<{ name: string; value: number }>;
  labelReconciliationTrend: Array<{ month: string; matched: number; mismatch: number }>;
}

export interface PqrPackagingReviewFilters {
  packagingType?: string;
  category?: string;
  qcStatus?: string;
  complianceStatus?: string;
  reconciliationStatus?: string;
  avlStatus?: string;
  riskLevel?: string;
  material?: string;
  batch?: string;
  manufacturer?: string;
  supplier?: string;
  search?: string;
}

export const packagingReviewFormSchema = z.object({
  pqrId: z.string().min(1, 'PQR selection is required'),
  product: z.string().min(1, 'Product is required'),
  productCode: z.string().min(1, 'Product code is required'),
  batchNumber: z.string().default(''),
  packagingMaterialType: z.enum(PQR_PACKAGING_TYPES),
  packagingMaterialCategory: z.enum(PQR_PACKAGING_CATEGORIES),
  materialName: z.string().min(1, 'Material name is required'),
  materialCode: z.string().default(''),
  manufacturerName: z.string().min(1, 'Manufacturer is required'),
  supplierName: z.string().min(1, 'Supplier is required'),
  vendorAvlStatus: z.enum(PQR_AVL_STATUSES).default('Not Approved'),
  grnNumber: z.string().default(''),
  arNumber: z.string().min(1, 'AR Number is required'),
  coaNumber: z.string().default(''),
  materialLotNumber: z.string().default(''),
  mfgDate: z.string().default(''),
  expDate: z.string().default(''),
  receivedQuantity: z.coerce.number().nonnegative().default(0),
  issuedQuantity: z.coerce.number().nonnegative('Issued quantity is required'),
  usedQuantity: z.coerce.number().nonnegative('Used quantity is required'),
  rejectedQuantity: z.coerce.number().nonnegative('Rejected quantity cannot be negative').default(0),
  returnedQuantity: z.coerce.number().nonnegative('Returned quantity cannot be negative').default(0),
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
}).refine((d) => (d.usedQuantity + d.rejectedQuantity + d.returnedQuantity) <= d.issuedQuantity || d.issuedQuantity === 0, {
  message: 'Used + Rejected + Returned cannot exceed Issued Quantity',
  path: ['rejectedQuantity'],
}).refine((d) => d.qcStatus !== 'Rejected' || (d.remarks || '').trim().length > 0, {
  message: 'Remarks / rejection reason required for rejected QC status',
  path: ['remarks'],
});

export type PackagingReviewFormData = z.infer<typeof packagingReviewFormSchema>;

export function computePackagingReconciliation(record: {
  issuedQuantity: number;
  usedQuantity: number;
  rejectedQuantity: number;
  returnedQuantity: number;
}): { balanceQuantity: number; reconciliationStatus: PqrReconciliationStatus; rejectionPct: number | null; variancePct: number | null } {
  const issued = Number(record.issuedQuantity) || 0;
  const used = Number(record.usedQuantity) || 0;
  const rejected = Number(record.rejectedQuantity) || 0;
  const returned = Number(record.returnedQuantity) || 0;
  const balanceQuantity = Math.round((issued - used - rejected - returned) * 1000) / 1000;
  const reconciliationStatus: PqrReconciliationStatus = Math.abs(balanceQuantity) < 0.0001 ? 'Matched' : 'Mismatch';
  const rejectionPct = issued > 0 ? Math.round((rejected / issued) * 1000) / 10 : null;
  const variancePct = issued > 0 ? Math.round(((used - issued) / issued) * 1000) / 10 : null;
  return { balanceQuantity, reconciliationStatus, rejectionPct, variancePct };
}

export function inferPackagingType(category: string, materialName: string): PqrPackagingType {
  const cat = category.toLowerCase();
  const name = materialName.toLowerCase();
  const primary = ['glass vial', 'vial', 'ampoule', 'bottle', 'blister', 'rubber stopper', 'flip off seal', 'stopper', 'seal', 'cap', 'closure', 'tube'];
  const secondary = ['label', 'carton', 'package insert', 'leaflet'];
  const tertiary = ['shipper', 'pvc film', 'bopp tape', 'tape', 'film', 'pallet'];
  if (primary.some((k) => cat.includes(k) || name.includes(k))) return 'Primary Packaging Material';
  if (secondary.some((k) => cat.includes(k) || name.includes(k))) return 'Secondary Packaging Material';
  if (tertiary.some((k) => cat.includes(k) || name.includes(k))) return 'Tertiary Packaging Material';
  return 'Secondary Packaging Material';
}

export function normalizePackagingCategory(raw: string): PqrPackagingCategory {
  const v = raw.trim().toLowerCase();
  if (v.includes('ampoule')) return 'Ampoule';
  if (v.includes('blister')) return 'Blister';
  if (v.includes('bottle')) return 'Bottle';
  if (v.includes('vial')) return 'Glass Vial';
  if (v.includes('stopper')) return 'Rubber Stopper';
  if (v.includes('flip') || (v.includes('seal') && !v.includes('closure'))) return 'Flip Off Seal';
  if (v.includes('cap') || v.includes('closure')) return 'Cap';
  if (v.includes('tube')) return 'Tube';
  if (v.includes('insert') || v.includes('leaflet')) return 'Package Insert / Leaflet';
  if (v.includes('shipper')) return 'Shipper Box';
  if (v.includes('pvc')) return 'PVC Film';
  if (v.includes('bopp') || v.includes('tape')) return 'BOPP Tape';
  if (v.includes('label')) return 'Label';
  if (v.includes('carton')) return 'Carton';
  const match = PQR_PACKAGING_CATEGORIES.find((c) => c.toLowerCase() === v);
  return match || 'Other';
}

export function computePackagingCompliance(
  record: Partial<PqrPackagingReviewRecord>,
  allRecords: PqrPackagingReviewRecord[] = [],
): {
  complianceStatus: PqrComplianceStatus;
  complianceReasons: string[];
  riskLevel: string;
  balanceQuantity: number;
  reconciliationStatus: PqrReconciliationStatus;
  rejectionPct: number | null;
  variancePct: number | null;
} {
  const reasons: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const recon = computePackagingReconciliation({
    issuedQuantity: record.issuedQuantity ?? 0,
    usedQuantity: record.usedQuantity ?? 0,
    rejectedQuantity: record.rejectedQuantity ?? 0,
    returnedQuantity: record.returnedQuantity ?? 0,
  });

  if (record.vendorAvlStatus && record.vendorAvlStatus !== 'Approved') reasons.push('Vendor not approved');
  if (record.qcStatus && record.qcStatus !== 'Approved') reasons.push('QC not approved');
  if (record.coaAvailable !== 'Yes') reasons.push('COA missing');

  if (record.expDate) {
    const exp = new Date(record.expDate.length === 7 ? `${record.expDate}-01` : record.expDate);
    if (!Number.isNaN(exp.getTime()) && exp < today) reasons.push('Material expired');
  }
  if (
    record.usedQuantity !== undefined && record.issuedQuantity !== undefined
    && record.issuedQuantity > 0 && record.usedQuantity > record.issuedQuantity
  ) {
    reasons.push('Quantity mismatch');
  }
  if (recon.reconciliationStatus === 'Mismatch') reasons.push('Reconciliation mismatch');

  const riskLevel = computePackagingRisk(record, reasons, recon, allRecords);

  return {
    complianceStatus: reasons.length === 0 ? 'Complies' : 'Does Not Comply',
    complianceReasons: reasons,
    riskLevel,
    balanceQuantity: recon.balanceQuantity,
    reconciliationStatus: recon.reconciliationStatus,
    rejectionPct: recon.rejectionPct,
    variancePct: recon.variancePct,
  };
}

function computePackagingRisk(
  record: Partial<PqrPackagingReviewRecord>,
  reasons: string[],
  recon: { reconciliationStatus: PqrReconciliationStatus },
  allRecords: PqrPackagingReviewRecord[],
): string {
  const risks: string[] = [];
  if (reasons.includes('Material expired')) risks.push('Critical');
  if (record.qcStatus === 'Rejected') risks.push('Critical');
  if (
    recon.reconciliationStatus === 'Mismatch'
    && LABEL_CATEGORIES.some((c) => record.packagingMaterialCategory === c || (record.materialName || '').toLowerCase().includes('label'))
  ) {
    risks.push('Critical');
  }
  if (reasons.includes('Vendor not approved')) risks.push('High');
  if (reasons.includes('Reconciliation mismatch')) risks.push('High');
  if (reasons.includes('COA missing')) risks.push('Medium');

  const issueCount = allRecords.filter((r) =>
    r.materialName === record.materialName && r.complianceStatus === 'Does Not Comply',
  ).length;
  if (issueCount >= 3) risks.push('High');

  if (risks.includes('Critical')) return 'Critical';
  if (risks.includes('High')) return 'High';
  if (risks.includes('Medium')) return 'Medium';
  return reasons.length === 0 ? 'Low' : 'Medium';
}

export function computePackagingSummary(
  records: PqrPackagingReviewRecord[],
  qualityMetrics?: {
    packagingDeviationCount?: number;
    packagingCapaCount?: number;
    packagingOosCount?: number;
  },
): PqrPackagingReviewSummary {
  const active = records.filter((r) => !r.isDeleted);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const approved = active.filter((r) => r.qcStatus === 'Approved').length;
  const rejected = active.filter((r) => r.qcStatus === 'Rejected').length;
  const pending = active.filter((r) =>
    ['Under Test', 'Quarantine', 'Retest Required'].includes(r.qcStatus),
  ).length;
  const total = active.length;

  return {
    totalPackagingLots: total,
    primaryPackagingLots: active.filter((r) => r.packagingMaterialType === 'Primary Packaging Material').length,
    secondaryPackagingLots: active.filter((r) => r.packagingMaterialType === 'Secondary Packaging Material').length,
    tertiaryPackagingLots: active.filter((r) => r.packagingMaterialType === 'Tertiary Packaging Material').length,
    approvedLots: approved,
    rejectedLots: rejected,
    pendingLots: pending,
    avlApprovedLots: active.filter((r) => r.vendorAvlStatus === 'Approved').length,
    nonCompliantLots: active.filter((r) => r.complianceStatus === 'Does Not Comply').length,
    reconciliationMismatchCount: active.filter((r) => r.reconciliationStatus === 'Mismatch').length,
    expiredMaterials: active.filter((r) => r.expDate && new Date(r.expDate.length === 7 ? `${r.expDate}-01` : r.expDate) < today).length,
    packagingDeviationCount: qualityMetrics?.packagingDeviationCount ?? 0,
    packagingCapaCount: qualityMetrics?.packagingCapaCount ?? 0,
    packagingOosCount: qualityMetrics?.packagingOosCount ?? 0,
    acceptancePct: total ? Math.round((approved / total) * 1000) / 10 : 0,
    rejectionPct: total ? Math.round((rejected / total) * 1000) / 10 : 0,
    uniqueMaterials: new Set(active.map((r) => r.materialName.toLowerCase()).filter(Boolean)).size,
    uniqueSuppliers: new Set(active.map((r) => r.supplierName.toLowerCase()).filter(Boolean)).size,
    totalRejectedQty: active.reduce((s, r) => s + (Number(r.rejectedQuantity) || 0), 0),
  };
}

export function generatePackagingNarrative(
  summary: PqrPackagingReviewSummary,
  records: PqrPackagingReviewRecord[],
): string {
  const parts: string[] = [];
  if (summary.totalPackagingLots === 0) {
    return 'No packaging material lots were recorded for the selected PQR review period.';
  }
  if (summary.nonCompliantLots === 0 && summary.rejectedLots === 0) {
    parts.push('All packaging materials used during the review period were procured from approved vendors and complied with approved specifications.');
  }
  if (summary.rejectedLots === 0) {
    parts.push('No packaging material rejection was observed during the review period.');
  } else {
    parts.push(`${summary.rejectedLots} packaging material lot(s) were rejected during the review period.`);
  }
  if (summary.reconciliationMismatchCount === 0) {
    parts.push('Packaging material reconciliation was found satisfactory during the review period.');
  } else {
    parts.push('Packaging material reconciliation mismatch was observed and reviewed for quality impact.');
  }
  const active = records.filter((r) => !r.isDeleted);
  const allVendorsApproved = active.length > 0 && active.every((r) => r.vendorAvlStatus === 'Approved');
  if (allVendorsApproved) {
    parts.push('All packaging material suppliers/manufacturers were available in the approved vendor list.');
  }
  if (summary.packagingDeviationCount > 0 || summary.packagingOosCount > 0 || summary.packagingCapaCount > 0) {
    parts.push(`Linked quality events: ${summary.packagingDeviationCount} deviation(s), ${summary.packagingOosCount} OOS, ${summary.packagingCapaCount} CAPA.`);
  }
  parts.push(
    `Total ${summary.totalPackagingLots} packaging lots reviewed (${summary.primaryPackagingLots} primary, ${summary.secondaryPackagingLots} secondary, ${summary.tertiaryPackagingLots} tertiary) with ${summary.acceptancePct}% acceptance.`,
  );
  return parts.join(' ');
}

export function buildPackagingCharts(records: PqrPackagingReviewRecord[]): PqrPackagingReviewCharts {
  const active = records.filter((r) => !r.isDeleted);
  const typeMap = new Map<string, number>();
  const vendorMap = new Map<string, number>();
  const riskMap = new Map<string, number>();
  const avlMonth = new Map<string, { compliant: number; nonCompliant: number }>();
  const mismatchMonth = new Map<string, number>();
  const labelMonth = new Map<string, { matched: number; mismatch: number }>();

  active.forEach((r) => {
    typeMap.set(r.packagingMaterialType || 'Unknown', (typeMap.get(r.packagingMaterialType || 'Unknown') || 0) + 1);
    const vendor = r.supplierName || r.manufacturerName || 'Unknown';
    vendorMap.set(vendor, (vendorMap.get(vendor) || 0) + 1);
    riskMap.set(r.riskLevel || 'Low', (riskMap.get(r.riskLevel || 'Low') || 0) + 1);
    const month = (r.mfgDate || '').slice(0, 7) || 'Unknown';
    const cur = avlMonth.get(month) || { compliant: 0, nonCompliant: 0 };
    if (r.complianceStatus === 'Complies') cur.compliant += 1;
    else cur.nonCompliant += 1;
    avlMonth.set(month, cur);
    if (r.reconciliationStatus === 'Mismatch') {
      mismatchMonth.set(month, (mismatchMonth.get(month) || 0) + 1);
    }
    const isLabel = LABEL_CATEGORIES.includes(r.packagingMaterialCategory) || r.materialName.toLowerCase().includes('label');
    if (isLabel) {
      const lm = labelMonth.get(month) || { matched: 0, mismatch: 0 };
      if (r.reconciliationStatus === 'Matched') lm.matched += 1;
      else lm.mismatch += 1;
      labelMonth.set(month, lm);
    }
  });

  return {
    packagingTypeDistribution: Array.from(typeMap.entries()).map(([name, value]) => ({ name, value })),
    approvedVsRejected: [
      { name: 'Approved', value: active.filter((r) => r.qcStatus === 'Approved').length },
      { name: 'Rejected', value: active.filter((r) => r.qcStatus === 'Rejected').length },
      { name: 'Pending', value: active.filter((r) => ['Under Test', 'Quarantine', 'Retest Required'].includes(r.qcStatus)).length },
    ],
    vendorUsage: Array.from(vendorMap.entries()).slice(0, 8).map(([vendor, count]) => ({ vendor, count })),
    avlComplianceTrend: Array.from(avlMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, v]) => ({ month, ...v })),
    reconciliationMismatchTrend: Array.from(mismatchMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, count]) => ({ month, count })),
    riskDistribution: Array.from(riskMap.entries()).map(([name, value]) => ({ name, value })),
    labelReconciliationTrend: Array.from(labelMonth.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(-6)
      .map(([month, v]) => ({ month, ...v })),
  };
}

export function buildPackagingVendorAvlRows(records: PqrPackagingReviewRecord[]): PackagingVendorAvlRow[] {
  const map = new Map<string, PackagingVendorAvlRow>();
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

export function normalizePackagingReviewRecord(raw: Record<string, unknown>): PqrPackagingReviewRecord {
  const issued = Number(raw.issuedQuantity) || 0;
  const used = Number(raw.usedQuantity) || 0;
  const rejected = Number(raw.rejectedQuantity) || 0;
  const returned = Number(raw.returnedQuantity) || 0;
  const partial: Partial<PqrPackagingReviewRecord> = {
    vendorAvlStatus: String(raw.vendorAvlStatus || 'Not Approved'),
    qcStatus: String(raw.qcStatus || 'Under Test'),
    coaAvailable: String(raw.coaAvailable || 'No') === 'Yes' ? 'Yes' : 'No',
    expDate: String(raw.expDate || '').slice(0, 10),
    issuedQuantity: issued,
    usedQuantity: used,
    rejectedQuantity: rejected,
    returnedQuantity: returned,
    packagingMaterialCategory: String(raw.packagingMaterialCategory || 'Other'),
    materialName: String(raw.materialName || ''),
    riskLevel: String(raw.riskLevel || 'Low'),
  };
  const computed = raw.complianceStatus && Array.isArray(raw.complianceReasons) && raw.reconciliationStatus != null
    ? {
      complianceStatus: String(raw.complianceStatus),
      complianceReasons: raw.complianceReasons as string[],
      riskLevel: String(raw.riskLevel || 'Low'),
      balanceQuantity: Number(raw.balanceQuantity) || computePackagingReconciliation(partial as never).balanceQuantity,
      reconciliationStatus: String(raw.reconciliationStatus),
      rejectionPct: raw.rejectionPct != null ? Number(raw.rejectionPct) : computePackagingReconciliation(partial as never).rejectionPct,
      variancePct: raw.variancePct != null ? Number(raw.variancePct) : computePackagingReconciliation(partial as never).variancePct,
    }
    : computePackagingCompliance(partial);

  return {
    id: String(raw.id || ''),
    packagingReviewId: String(raw.packagingReviewId || `PPR-${raw.id || 'X'}`),
    pqrId: String(raw.pqrId || ''),
    pqrNumber: String(raw.pqrNumber || ''),
    product: String(raw.product || raw.productName || ''),
    productCode: String(raw.productCode || ''),
    batchNumber: String(raw.batchNumber || ''),
    packagingMaterialType: String(raw.packagingMaterialType || 'Secondary Packaging Material'),
    packagingMaterialCategory: String(raw.packagingMaterialCategory || 'Other'),
    materialCode: String(raw.materialCode || ''),
    materialName: String(raw.materialName || ''),
    manufacturerName: String(raw.manufacturerName || ''),
    supplierName: String(raw.supplierName || ''),
    vendorAvlStatus: String(raw.vendorAvlStatus || 'Not Approved'),
    grnNumber: String(raw.grnNumber || ''),
    arNumber: String(raw.arNumber || ''),
    coaNumber: String(raw.coaNumber || ''),
    materialLotNumber: String(raw.materialLotNumber || ''),
    mfgDate: String(raw.mfgDate || '').slice(0, 10),
    expDate: String(raw.expDate || '').slice(0, 10),
    receivedQuantity: Number(raw.receivedQuantity) || 0,
    issuedQuantity: issued,
    usedQuantity: used,
    rejectedQuantity: rejected,
    returnedQuantity: returned,
    balanceQuantity: computed.balanceQuantity,
    unit: String(raw.unit || 'Nos'),
    qcStatus: String(raw.qcStatus || 'Under Test'),
    coaAvailable: String(raw.coaAvailable || 'No') === 'Yes' ? 'Yes' : 'No',
    specificationNumber: String(raw.specificationNumber || ''),
    stpNumber: String(raw.stpNumber || ''),
    reconciliationStatus: computed.reconciliationStatus,
    complianceStatus: computed.complianceStatus,
    complianceReasons: computed.complianceReasons,
    riskLevel: computed.riskLevel,
    remarks: String(raw.remarks || ''),
    rejectionPct: computed.rejectionPct,
    variancePct: computed.variancePct,
    linkedOosCount: Number(raw.linkedOosCount) || 0,
    sourceType: (raw.sourceType as PqrPackagingReviewRecord['sourceType']) || 'manual',
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

export function filterPackagingReviewRecords(
  records: PqrPackagingReviewRecord[],
  filters: PqrPackagingReviewFilters,
): PqrPackagingReviewRecord[] {
  const search = (filters.search || '').trim().toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    if (filters.packagingType && filters.packagingType !== 'all' && r.packagingMaterialType !== filters.packagingType) return false;
    if (filters.category && filters.category !== 'all' && r.packagingMaterialCategory !== filters.category) return false;
    if (filters.qcStatus && filters.qcStatus !== 'all' && r.qcStatus !== filters.qcStatus) return false;
    if (filters.complianceStatus && filters.complianceStatus !== 'all' && r.complianceStatus !== filters.complianceStatus) return false;
    if (filters.reconciliationStatus && filters.reconciliationStatus !== 'all' && r.reconciliationStatus !== filters.reconciliationStatus) return false;
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
        r.supplierName, r.manufacturerName, r.remarks, r.packagingMaterialCategory,
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

export function canViewPackagingReview(role?: string): boolean {
  return VIEW_ROLES.has(normalizeRole(role));
}

export function canManagePackagingReview(role?: string): boolean {
  return MANAGE_ROLES.has(normalizeRole(role));
}

export function canUpdatePackagingQc(role?: string): boolean {
  return QC_ROLES.has(normalizeRole(role));
}

export function canAddPackagingReview(role?: string): boolean {
  return ADD_ROLES.has(normalizeRole(role));
}

export function canExportPackagingReview(role?: string): boolean {
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

export function reconciliationStatusColor(status: string): string {
  if (status === 'Matched') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Mismatch') return 'bg-red-50 text-red-700 border-red-200';
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

export function formatPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Data Not Available';
  return `${value}%`;
}
