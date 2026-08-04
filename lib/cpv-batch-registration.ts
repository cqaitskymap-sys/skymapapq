import { z } from 'zod';
import {
  BATCH_STATUSES,
  RELEASE_STATUSES,
  BATCH_SIZE_UNITS,
  BATCH_STATUS_TRANSITIONS,
} from '@/lib/admin/constants';
import { CPV_REVIEW_FREQUENCIES } from '@/lib/cpv-product-master';

export const CPV_BATCH_COLLECTION = 'cpv_batches';
export const CPV_BATCH_MODULE = 'CPV Batch Registration';

export const CPV_BATCH_STATUSES = BATCH_STATUSES;
export const CPV_RELEASE_STATUSES = RELEASE_STATUSES;
export const CPV_BATCH_STATUS_TRANSITIONS = BATCH_STATUS_TRANSITIONS;

const requiredText = z.string().trim().min(1, 'Required');
const optionalText = z.string().trim().default('');

/** Normalizes stored date to YYYY-MM for month inputs (legacy YYYY-MM-DD supported). */
export function toMonthYearValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 7);
  return trimmed;
}

/** @deprecated Use toMonthYearValue */
export const toExpiryMonthValue = toMonthYearValue;

/** First day of month for comparisons. */
export function monthYearComparableStart(value: string): Date | null {
  const monthValue = toMonthYearValue(value);
  if (/^\d{4}-\d{2}$/.test(monthValue)) {
    const [y, m] = monthValue.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Last day of month for comparisons (handles YYYY-MM and full dates). */
export function monthYearComparableEnd(value: string): Date | null {
  const monthValue = toMonthYearValue(value);
  if (/^\d{4}-\d{2}$/.test(monthValue)) {
    const [y, m] = monthValue.split('-').map(Number);
    return new Date(y, m, 0);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** @deprecated Use monthYearComparableEnd */
export const expiryComparableEnd = monthYearComparableEnd;

/** Display month-year as MM-YYYY. */
export function formatMonthYear(value: string): string {
  const ym = toMonthYearValue(value);
  if (!/^\d{4}-\d{2}$/.test(ym)) return value;
  const [y, m] = ym.split('-');
  return `${m}-${y}`;
}

/** @deprecated Use formatMonthYear */
export const formatExpiryMonthYear = formatMonthYear;

export const cpvBatchFormSchema = z.object({
  cpvProductId: requiredText,
  batchNumber: requiredText,
  batchCode: optionalText,
  productCode: requiredText,
  productName: requiredText,
  productVersion: optionalText,
  productCategory: optionalText,
  genericName: optionalText,
  strength: optionalText,
  dosageForm: optionalText,
  packSize: optionalText,
  market: optionalText,
  batchSize: z.coerce.number().positive('Batch size must be numeric'),
  targetBatchSize: optionalText,
  actualBatchSize: optionalText,
  batchSizeUnit: z.enum(BATCH_SIZE_UNITS).default('Vials'),
  manufacturingDate: requiredText,
  expiryDate: requiredText,
  retestDate: optionalText,
  shelfLifeMonths: optionalText,
  manufacturingEndDate: optionalText,
  packagingStartDate: optionalText,
  packagingEndDate: optionalText,
  manufacturingSite: requiredText,
  plant: optionalText,
  manufacturingLine: optionalText,
  department: optionalText,
  shift: z.string().trim().default('A'),
  campaign: optionalText,
  manufacturingOrderNumber: optionalText,
  workOrderNumber: optionalText,
  mfrNumber: optionalText,
  bmrNumber: optionalText,
  bprNumber: optionalText,
  semiFinishedBatchNumber: optionalText,
  finishedProductBatchNumber: optionalText,
  packingBatchNumber: optionalText,
  manufacturedFor: optionalText,
  customerName: optionalText,
  goldenBatchNumber: optionalText,
  cpvReviewPeriod: z.enum(CPV_REVIEW_FREQUENCIES).default('Yearly'),
  batchStatus: z.enum(CPV_BATCH_STATUSES).default('Planned'),
  releaseStatus: z.enum(CPV_RELEASE_STATUSES).default('Pending'),
  qaReleaseDate: optionalText,
  qaReleasedBy: optionalText,
  statusChangeReason: optionalText,
  description: optionalText,
  remarks: optionalText,
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
}).superRefine((data, ctx) => {
  const mfgYm = toMonthYearValue(data.manufacturingDate);
  const expYm = toMonthYearValue(data.expiryDate);
  if (/^\d{4}-\d{2}$/.test(mfgYm) && /^\d{4}-\d{2}$/.test(expYm) && expYm <= mfgYm) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Expiry month must be after manufacturing month',
      path: ['expiryDate'],
    });
  }
  if (data.batchStatus === 'Rejected' && !data.statusChangeReason.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Rejection reason is required',
      path: ['statusChangeReason'],
    });
  }
  if (data.batchStatus === 'Hold' && !data.statusChangeReason.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Hold reason is required',
      path: ['statusChangeReason'],
    });
  }
});

export type CpvBatchFormData = z.infer<typeof cpvBatchFormSchema>;

export interface CpvBatchRecord extends Omit<CpvBatchFormData, 'changeReason'>, Record<string, unknown> {
  id: string;
  cpvBatchId: string;
  specificationNumber?: string;
  stpNumber?: string;
  equipmentIds?: string[];
  operatorIds?: string[];
  linkedCppParameterIds?: string[];
  linkedCqaParameterIds?: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
  status?: string;
  changeReason?: string;
  recordType?: string;
}

export interface CpvBatchSummary {
  total: number;
  planned: number;
  manufacturing: number;
  qcTesting: number;
  qaReview: number;
  released: number;
  rejected: number;
  hold: number;
  dueForReview: number;
}

export function buildCpvBatchId(batchNumber: string): string {
  return `CPV-BATCH-${batchNumber.toUpperCase().replace(/\s+/g, '-')}`;
}

export function isBatchFieldLocked(batchStatus: string): boolean {
  return batchStatus === 'Released' || batchStatus === 'Archived' || batchStatus === 'Closed';
}

export function allowedBatchTransitions(from: string): readonly string[] {
  return CPV_BATCH_STATUS_TRANSITIONS[from] || [];
}

export function summarizeCpvBatches(batches: CpvBatchRecord[]): CpvBatchSummary {
  const today = new Date().toISOString().split('T')[0];
  const statusOf = (batch: CpvBatchRecord) => String(batch.batchStatus);
  return {
    total: batches.length,
    planned: batches.filter((b) => ['Planned', 'Scheduled'].includes(statusOf(b))).length,
    manufacturing: batches.filter((b) => statusOf(b) === 'Manufacturing').length,
    qcTesting: batches.filter((b) => ['Testing', 'Sampling', 'Under QC Testing'].includes(statusOf(b))).length,
    qaReview: batches.filter((b) => ['Under Review', 'Under QA Review'].includes(statusOf(b))).length,
    released: batches.filter((b) => statusOf(b) === 'Released').length,
    rejected: batches.filter((b) => statusOf(b) === 'Rejected').length,
    hold: batches.filter((b) => statusOf(b) === 'Hold').length,
    dueForReview: batches.filter((b) => {
      if (['Cancelled', 'Closed', 'Archived'].includes(statusOf(b))) return false;
      const expiryEnd = monthYearComparableEnd(b.expiryDate);
      const due = b.qaReleaseDate || (expiryEnd ? expiryEnd.toISOString().slice(0, 10) : b.expiryDate);
      return due && due <= today && statusOf(b) !== 'Released';
    }).length,
  };
}
