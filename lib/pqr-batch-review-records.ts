import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';

export const PQR_BATCH_REVIEW_MODULE = 'PQR Batch Review';

export const PQR_BATCH_REVIEW_COLLECTIONS = {
  batchReview: 'pqr_batch_review',
  sections: 'pqr_sections',
  records: 'pqr_records',
  recordsLegacy: 'pqr_documents',
  batches: 'batches',
  cpvBatches: 'cpv_batches',
  deviations: 'deviations',
  oosRecords: 'oos_records',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
  complaints: 'complaints',
  yieldMonitoring: 'yield_monitoring',
} as const;

export const BATCH_REVIEW_STATUSES = [
  'Manufactured', 'Under QC Testing', 'Under QA Review', 'Released', 'Rejected',
  'Hold', 'Reworked', 'Reprocessed', 'Cancelled',
] as const;

export const BATCH_RELEASE_STATUSES = [
  'Released', 'Rejected', 'On Hold', 'Pending', 'Not Applicable',
] as const;

export type BatchReviewStatus = (typeof BATCH_REVIEW_STATUSES)[number];
export type BatchReleaseStatus = (typeof BATCH_RELEASE_STATUSES)[number];

export interface PqrOption {
  id: string;
  pqrNumber: string;
  productName: string;
  productCode: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  reviewYear?: number;
  site?: string;
  status?: string;
}

export interface PqrBatchReviewRecord {
  id?: string;
  batchReviewId: string;
  pqrId: string;
  pqrNumber: string;
  product: string;
  productCode: string;
  genericName: string;
  strength: string;
  dosageForm: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  batchNumber: string;
  semiFinishedBatchNumber: string;
  finishedProductBatchNumber: string;
  packingBatchNumber: string;
  manufacturingDate: string;
  expiryDate: string;
  batchSize: number;
  batchSizeUnit: string;
  manufacturedFor: string;
  customerName: string;
  market: string;
  batchStatus: BatchReviewStatus | string;
  releaseStatus: BatchReleaseStatus | string;
  releaseDate: string;
  qaReleasedBy: string;
  rejectionReason: string;
  holdReason: string;
  reworkRequired: boolean;
  reprocessRequired: boolean;
  linkedDeviationCount: number;
  linkedOosCount: number;
  linkedCapaCount: number;
  linkedComplaintCount?: number;
  linkedChangeControlCount?: number;
  theoreticalYield?: number | null;
  actualYield?: number | null;
  yieldPct?: number | null;
  remarks: string;
  sourceType?: 'manual' | 'batch_master' | 'cpv_batch';
  sourceId?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface PqrBatchReviewSummary {
  totalBatches: number;
  releasedBatches: number;
  rejectedBatches: number;
  holdBatches: number;
  reworkedBatches: number;
  reprocessedBatches: number;
  releasePct: number;
  rejectionPct: number;
  totalDeviations: number;
  totalOos: number;
  totalCapa: number;
  avgYieldPct: number | null;
}

export interface PqrBatchReviewCharts {
  statusDistribution: Array<{ name: string; value: number }>;
  monthlyManufacturing: Array<{ month: string; count: number }>;
  releaseRejectTrend: Array<{ month: string; released: number; rejected: number }>;
  productTrend: Array<{ product: string; count: number }>;
  manufacturedForTrend: Array<{ name: string; count: number }>;
}

export interface PqrBatchReviewFilters {
  pqrNumber?: string;
  product?: string;
  batchStatus?: string;
  releaseStatus?: string;
  manufacturedFor?: string;
  customer?: string;
  search?: string;
  mfgDateFrom?: string;
  mfgDateTo?: string;
  expDateFrom?: string;
  expDateTo?: string;
}

/** Modern PQR section navigation with optional pqrId context. */
export const PQR_SECTION_FLOW = [
  { key: 'dashboard', label: 'PQR Dashboard', href: '/pqr/dashboard' },
  { key: 'create', label: 'Create Annual PQR', href: '/pqr/create' },
  { key: 'batches', label: 'Batch Review', href: '/pqr/batches' },
  { key: 'materials', label: 'Material Review', href: '/pqr/materials' },
  { key: 'packaging', label: 'Packaging Review', href: '/pqr/packaging' },
  { key: 'equipment', label: 'Equipment Review', href: '/pqr/equipment-review' },
  { key: 'utility', label: 'Utility & Environmental Review', href: '/pqr/utility-review' },
  { key: 'stability', label: 'Stability Review', href: '/pqr/stability' },
  { key: 'summary', label: 'Summary & Conclusion', href: '/pqr/summary' },
  { key: 'approval', label: 'PQR Approval', href: '/pqr/approval' },
] as const;

export function pqrSectionHref(href: string, pqrId?: string): string {
  if (!pqrId || href === '/pqr/dashboard' || href === '/pqr/create') return href;
  const sep = href.includes('?') ? '&' : '?';
  return `${href}${sep}pqrId=${encodeURIComponent(pqrId)}`;
}

export const batchReviewFormSchema = z.object({
  pqrId: z.string().min(1, 'PQR selection is required'),
  product: z.string().min(1, 'Product is required'),
  productCode: z.string().min(1, 'Product code is required'),
  batchNumber: z.string().min(1, 'Batch number is required'),
  manufacturingDate: z.string().min(1, 'Manufacturing date is required'),
  expiryDate: z.string().min(1, 'Expiry date is required'),
  batchSize: z.coerce.number().positive('Batch size must be numeric'),
  batchSizeUnit: z.string().default('Vials'),
  genericName: z.string().default(''),
  strength: z.string().default(''),
  dosageForm: z.string().default(''),
  semiFinishedBatchNumber: z.string().default(''),
  finishedProductBatchNumber: z.string().default(''),
  packingBatchNumber: z.string().default(''),
  manufacturedFor: z.string().default(''),
  customerName: z.string().default(''),
  market: z.string().default(''),
  batchStatus: z.enum(BATCH_REVIEW_STATUSES).default('Manufactured'),
  releaseStatus: z.enum(BATCH_RELEASE_STATUSES).default('Pending'),
  releaseDate: z.string().default(''),
  qaReleasedBy: z.string().default(''),
  rejectionReason: z.string().default(''),
  holdReason: z.string().default(''),
  reworkRequired: z.boolean().default(false),
  reprocessRequired: z.boolean().default(false),
  theoreticalYield: z.coerce.number().nonnegative().optional().nullable(),
  actualYield: z.coerce.number().nonnegative().optional().nullable(),
  remarks: z.string().default(''),
}).refine((d) => {
  const mfg = d.manufacturingDate.length === 7 ? `${d.manufacturingDate}-01` : d.manufacturingDate;
  const exp = d.expiryDate.length === 7 ? `${d.expiryDate}-01` : d.expiryDate;
  return exp > mfg;
}, {
  message: 'Expiry date must be after manufacturing date',
  path: ['expiryDate'],
}).refine((d) => d.batchStatus !== 'Rejected' || d.rejectionReason.trim().length > 0, {
  message: 'Rejection reason is required for rejected batches',
  path: ['rejectionReason'],
}).refine((d) => d.batchStatus !== 'Hold' || d.holdReason.trim().length > 0, {
  message: 'Hold reason is required for hold batches',
  path: ['holdReason'],
}).refine((d) => {
  if (d.theoreticalYield == null || d.actualYield == null) return true;
  if (d.theoreticalYield <= 0) return true;
  return true;
}, { message: 'Invalid yield values', path: ['actualYield'] });

export type BatchReviewFormData = z.infer<typeof batchReviewFormSchema>;

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

const ADD_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'production_manager', 'production_executive',
]);

const EXPORT_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive', 'auditor',
]);

export function canViewBatchReview(role?: string): boolean {
  return VIEW_ROLES.has(normalizeRole(role));
}

export function canManageBatchReview(role?: string): boolean {
  return MANAGE_ROLES.has(normalizeRole(role));
}

export function canAddBatchReview(role?: string): boolean {
  return ADD_ROLES.has(normalizeRole(role));
}

export function canExportBatchReview(role?: string): boolean {
  return EXPORT_ROLES.has(normalizeRole(role));
}

export function isBatchReviewViewOnly(role?: string): boolean {
  const r = normalizeRole(role);
  return ['auditor', 'viewer', 'qc_manager', 'qc_executive',
    'warehouse_manager', 'warehouse_executive'].includes(r);
}

export function batchStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('release')) return 'bg-green-50 text-green-700 border-green-200';
  if (s.includes('reject')) return 'bg-red-50 text-red-700 border-red-200';
  if (s.includes('hold')) return 'bg-amber-50 text-amber-800 border-amber-200';
  if (s.includes('rework') || s.includes('reprocess')) return 'bg-orange-50 text-orange-800 border-orange-200';
  if (s.includes('cancel')) return 'bg-slate-100 text-slate-600 border-slate-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export function releaseStatusColor(status: string): string {
  const s = status.toLowerCase();
  if (s === 'released') return 'bg-green-50 text-green-700 border-green-200';
  if (s === 'rejected') return 'bg-red-50 text-red-700 border-red-200';
  if (s.includes('hold')) return 'bg-amber-50 text-amber-800 border-amber-200';
  if (s === 'pending') return 'bg-blue-50 text-blue-700 border-blue-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function strMatch(val: string, token: string): boolean {
  return String(val || '').toLowerCase().includes(token);
}

/** "Not Released" and "Pending Release" are not released. Rejected wins over released. */
export function statusMeansReleased(status: string): boolean {
  const value = String(status || '').toLowerCase();
  if (!value || value.includes('not release') || value.includes('unreleased') || value.includes('pending')) return false;
  if (value.includes('reject') || value.includes('hold') || value.includes('cancel')) return false;
  return value.includes('released') || value === 'release';
}

export function statusMeansRejected(status: string): boolean {
  const value = String(status || '').toLowerCase();
  if (!value || value.includes('not reject')) return false;
  return value.includes('reject');
}

export function isRejectedBatch(r: PqrBatchReviewRecord): boolean {
  return statusMeansRejected(r.batchStatus) || statusMeansRejected(r.releaseStatus);
}

export function isReleasedBatch(r: PqrBatchReviewRecord): boolean {
  if (isRejectedBatch(r)) return false;
  return statusMeansReleased(r.releaseStatus) || statusMeansReleased(r.batchStatus);
}

export function computeYieldPct(theoretical?: number | null, actual?: number | null): number | null {
  if (theoretical == null || actual == null) return null;
  if (!Number.isFinite(theoretical) || !Number.isFinite(actual) || theoretical <= 0) return null;
  return Math.round((actual / theoretical) * 1000) / 10;
}

export function computeBatchSummary(records: PqrBatchReviewRecord[]): PqrBatchReviewSummary {
  const active = records.filter((r) => !r.isDeleted);
  const total = active.length;
  const released = active.filter(isReleasedBatch).length;
  const rejected = active.filter(isRejectedBatch).length;
  const hold = active.filter((r) =>
    strMatch(r.batchStatus, 'hold') || strMatch(r.releaseStatus, 'hold'),
  ).length;
  const reworked = active.filter((r) => strMatch(r.batchStatus, 'rework') || r.reworkRequired).length;
  const reprocessed = active.filter((r) => strMatch(r.batchStatus, 'reprocess') || r.reprocessRequired).length;
  const yieldVals = active
    .map((r) => (r.yieldPct != null ? Number(r.yieldPct) : computeYieldPct(r.theoreticalYield, r.actualYield)))
    .filter((v): v is number => v != null && Number.isFinite(v) && v >= 0);

  return {
    totalBatches: total,
    releasedBatches: released,
    rejectedBatches: rejected,
    holdBatches: hold,
    reworkedBatches: reworked,
    reprocessedBatches: reprocessed,
    releasePct: total ? Math.round((released / total) * 1000) / 10 : 0,
    rejectionPct: total ? Math.round((rejected / total) * 1000) / 10 : 0,
    totalDeviations: active.reduce((s, r) => s + (r.linkedDeviationCount || 0), 0),
    totalOos: active.reduce((s, r) => s + (r.linkedOosCount || 0), 0),
    totalCapa: active.reduce((s, r) => s + (r.linkedCapaCount || 0), 0),
    avgYieldPct: yieldVals.length
      ? Math.round((yieldVals.reduce((a, b) => a + b, 0) / yieldVals.length) * 10) / 10
      : null,
  };
}

export function generateBatchNarrative(summary: PqrBatchReviewSummary): string {
  const parts: string[] = [];
  if (summary.totalBatches === 0) {
    return 'No batch manufacturing records were identified for the selected PQR review period.';
  }
  if (summary.rejectedBatches === 0 && summary.releasedBatches === summary.totalBatches) {
    parts.push('All batches manufactured during the review period were released and no batch was rejected.');
  } else if (summary.rejectedBatches > 0) {
    parts.push(`During the review period, ${summary.rejectedBatches} batches were rejected. Details are summarized in the batch review table.`);
  }
  if (summary.holdBatches > 0) {
    parts.push(`${summary.holdBatches} batches were kept on hold during the review period and were reviewed for quality impact.`);
  }
  if (summary.reworkedBatches === 0 && summary.reprocessedBatches === 0) {
    parts.push('No rework or reprocessing was performed during the review period.');
  } else {
    if (summary.reworkedBatches > 0) parts.push(`${summary.reworkedBatches} batch(es) underwent rework.`);
    if (summary.reprocessedBatches > 0) parts.push(`${summary.reprocessedBatches} batch(es) were reprocessed.`);
  }
  if (summary.totalDeviations > 0 || summary.totalOos > 0 || summary.totalCapa > 0) {
    parts.push(`Linked quality events: ${summary.totalDeviations} deviation(s), ${summary.totalOos} OOS, ${summary.totalCapa} CAPA.`);
  }
  if (summary.avgYieldPct != null) {
    parts.push(`Average batch yield was ${summary.avgYieldPct}%.`);
  }
  parts.push(`Total ${summary.totalBatches} batches manufactured with ${summary.releasePct}% release rate and ${summary.rejectionPct}% rejection rate.`);
  return parts.join(' ');
}

export function buildBatchCharts(records: PqrBatchReviewRecord[]): PqrBatchReviewCharts {
  const active = records.filter((r) => !r.isDeleted);
  const statusMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const releaseMap = new Map<string, { released: number; rejected: number }>();
  const productMap = new Map<string, number>();
  const mfgForMap = new Map<string, number>();

  active.forEach((r) => {
    statusMap.set(r.batchStatus || 'Unknown', (statusMap.get(r.batchStatus || 'Unknown') || 0) + 1);
    const month = (r.manufacturingDate || '').slice(0, 7) || 'Unknown';
    monthMap.set(month, (monthMap.get(month) || 0) + 1);
    const rm = releaseMap.get(month) || { released: 0, rejected: 0 };
    if (isReleasedBatch(r)) rm.released += 1;
    if (isRejectedBatch(r)) rm.rejected += 1;
    releaseMap.set(month, rm);
    productMap.set(r.product || 'Unknown', (productMap.get(r.product || 'Unknown') || 0) + 1);
    const mf = r.manufacturedFor || r.customerName || 'Internal';
    mfgForMap.set(mf, (mfgForMap.get(mf) || 0) + 1);
  });

  const sortEntries = (entries: [string, unknown][]) =>
    entries.sort(([a], [b]) => a.localeCompare(b)).slice(-8);

  return {
    statusDistribution: Array.from(statusMap.entries()).map(([name, value]) => ({ name, value })),
    monthlyManufacturing: sortEntries(Array.from(monthMap.entries())).map(([month, count]) => ({
      month, count: count as number,
    })),
    releaseRejectTrend: sortEntries(Array.from(releaseMap.entries())).map(([month, v]) => ({
      month, ...(v as { released: number; rejected: number }),
    })),
    productTrend: Array.from(productMap.entries()).map(([product, count]) => ({ product, count })),
    manufacturedForTrend: Array.from(mfgForMap.entries()).slice(0, 8).map(([name, count]) => ({ name, count })),
  };
}

/** Normalize incomplete create stubs / legacy rows into a usable record. */
export function normalizeBatchReviewRecord(raw: Record<string, unknown>): PqrBatchReviewRecord {
  const product = String(raw.product || raw.productName || raw.product_name || '');
  const batchStatusRaw = String(raw.batchStatus || raw.status || 'Manufactured');
  const releaseRaw = String(raw.releaseStatus || raw.release_status || 'Pending');
  const batchStatus = batchStatusRaw.toLowerCase() === 'pending' ? 'Manufactured' : batchStatusRaw;
  const theoretical = raw.theoreticalYield != null ? Number(raw.theoreticalYield) : null;
  const actual = raw.actualYield != null ? Number(raw.actualYield) : null;
  let yieldPct = raw.yieldPct != null ? Number(raw.yieldPct) : null;
  if ((yieldPct == null || !Number.isFinite(yieldPct)) && theoretical && theoretical > 0 && actual != null) {
    yieldPct = computeYieldPct(theoretical, actual);
  }
  return {
    id: String(raw.id || ''),
    batchReviewId: String(raw.batchReviewId || `PBR-${raw.id || 'X'}`),
    pqrId: String(raw.pqrId || raw.pqr_id || ''),
    pqrNumber: String(raw.pqrNumber || raw.pqr_number || ''),
    product,
    productCode: String(raw.productCode || raw.product_code || ''),
    genericName: String(raw.genericName || ''),
    strength: String(raw.strength || ''),
    dosageForm: String(raw.dosageForm || ''),
    reviewPeriodFrom: String(raw.reviewPeriodFrom || ''),
    reviewPeriodTo: String(raw.reviewPeriodTo || ''),
    batchNumber: String(raw.batchNumber || raw.batch_number || ''),
    semiFinishedBatchNumber: String(raw.semiFinishedBatchNumber || ''),
    finishedProductBatchNumber: String(raw.finishedProductBatchNumber || ''),
    packingBatchNumber: String(raw.packingBatchNumber || ''),
    manufacturingDate: String(raw.manufacturingDate || raw.manufacturing_date || '').slice(0, 10),
    expiryDate: String(raw.expiryDate || raw.expiry_date || '').slice(0, 10),
    batchSize: Number(raw.batchSize ?? raw.batch_size) || 0,
    batchSizeUnit: String(raw.batchSizeUnit || 'Vials'),
    manufacturedFor: String(raw.manufacturedFor || ''),
    customerName: String(raw.customerName || ''),
    market: String(raw.market || ''),
    batchStatus,
    releaseStatus: releaseRaw || 'Pending',
    releaseDate: String(raw.releaseDate || '').slice(0, 10),
    qaReleasedBy: String(raw.qaReleasedBy || ''),
    rejectionReason: String(raw.rejectionReason || ''),
    holdReason: String(raw.holdReason || ''),
    reworkRequired: Boolean(raw.reworkRequired),
    reprocessRequired: Boolean(raw.reprocessRequired),
    linkedDeviationCount: Number(raw.linkedDeviationCount) || 0,
    linkedOosCount: Number(raw.linkedOosCount) || 0,
    linkedCapaCount: Number(raw.linkedCapaCount) || 0,
    linkedComplaintCount: Number(raw.linkedComplaintCount) || 0,
    linkedChangeControlCount: Number(raw.linkedChangeControlCount) || 0,
    theoreticalYield: theoretical != null && Number.isFinite(theoretical) ? theoretical : null,
    actualYield: actual != null && Number.isFinite(actual) ? actual : null,
    yieldPct: yieldPct != null && Number.isFinite(yieldPct) ? yieldPct : null,
    remarks: String(raw.remarks || ''),
    sourceType: (raw.sourceType as PqrBatchReviewRecord['sourceType']) || 'manual',
    sourceId: String(raw.sourceId || raw.batchId || ''),
    createdAt: String(raw.createdAt || ''),
    updatedAt: String(raw.updatedAt || ''),
    createdBy: String(raw.createdBy || ''),
    updatedBy: String(raw.updatedBy || ''),
    createdByName: String(raw.createdByName || ''),
    updatedByName: String(raw.updatedByName || ''),
    isDeleted: Boolean(raw.isDeleted),
  };
}

export function filterBatchReviewRecords(
  records: PqrBatchReviewRecord[],
  filters: PqrBatchReviewFilters,
): PqrBatchReviewRecord[] {
  const search = (filters.search || '').trim().toLowerCase();
  return records.filter((r) => {
    if (r.isDeleted) return false;
    if (filters.batchStatus && filters.batchStatus !== 'all' && r.batchStatus !== filters.batchStatus) return false;
    if (filters.releaseStatus && filters.releaseStatus !== 'all' && r.releaseStatus !== filters.releaseStatus) return false;
    if (filters.manufacturedFor && !strMatch(r.manufacturedFor, filters.manufacturedFor.toLowerCase())
      && !strMatch(r.customerName, filters.manufacturedFor.toLowerCase())) return false;
    if (filters.product && !strMatch(r.product, filters.product.toLowerCase())
      && !strMatch(r.productCode, filters.product.toLowerCase())) return false;
    if (filters.mfgDateFrom && r.manufacturingDate && r.manufacturingDate < filters.mfgDateFrom) return false;
    if (filters.mfgDateTo && r.manufacturingDate && r.manufacturingDate > filters.mfgDateTo) return false;
    if (filters.expDateFrom && r.expiryDate && r.expiryDate < filters.expDateFrom) return false;
    if (filters.expDateTo && r.expiryDate && r.expiryDate > filters.expDateTo) return false;
    if (search) {
      const hay = [
        r.batchNumber, r.product, r.productCode, r.manufacturedFor, r.customerName,
        r.remarks, r.batchStatus, r.releaseStatus, r.semiFinishedBatchNumber,
        r.finishedProductBatchNumber,
      ].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export const emptyCharts = (): PqrBatchReviewCharts => ({
  statusDistribution: [],
  monthlyManufacturing: [],
  releaseRejectTrend: [],
  productTrend: [],
  manufacturedForTrend: [],
});

export const PQR_TABLE_COLUMNS = [
  'Sr. No.', 'Batch No.', 'Semi Finish Batch No.', 'Finished Product Batch No.',
  'MFG Date', 'EXP Date', 'Batch Size', 'Manufactured For', 'Status', 'Remarks',
] as const;
