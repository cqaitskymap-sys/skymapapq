import { z } from 'zod';
import { DOSAGE_FORMS, MARKET_OPTIONS } from '@/lib/admin/constants';

export const CPV_PRODUCT_COLLECTION = 'cpv_products';
export const CPV_PRODUCT_MODULE = 'CPV Product Master';

export const CPV_PRODUCT_STATUSES = [
  'Draft',
  'Under Review',
  'Approved',
  'Active',
  'Inactive',
  'Obsolete',
  'Archived',
  'Discontinued',
] as const;

export const CPV_REVIEW_FREQUENCIES = [
  'Monthly',
  'Quarterly',
  'Half Yearly',
  'Yearly',
] as const;

export const CPV_LIFECYCLE_STATUSES = [
  'Development',
  'Technology Transfer',
  'Validation',
  'Commercial',
  'Discontinued',
] as const;

const requiredText = z.string().trim().min(1, 'Required');
const optionalText = z.string().trim().default('');

export const cpvProductFormSchema = z.object({
  adminProductId: requiredText,
  productCode: requiredText,
  productName: requiredText,
  genericName: optionalText,
  brandName: optionalText,
  productCategory: optionalText,
  productFamily: optionalText,
  strength: requiredText,
  dosageForm: requiredText,
  routeOfAdministration: optionalText,
  packSize: optionalText,
  packType: optionalText,
  market: optionalText,
  manufacturingSite: optionalText,
  businessUnit: optionalText,
  department: optionalText,
  productOwner: optionalText,
  lifecycleStatus: optionalText,
  developmentStage: optionalText,
  validationStatus: optionalText,
  marketStatus: optionalText,
  version: optionalText,
  revision: optionalText,
  effectiveDate: optionalText,
  reviewDate: optionalText,
  expiryDate: optionalText,
  description: optionalText,
  manufacturingProcess: optionalText,
  productionLine: optionalText,
  manufacturingArea: optionalText,
  packagingProcess: optionalText,
  shelfLife: optionalText,
  storageCondition: optionalText,
  standardBatchSize: optionalText,
  manufacturingLicenseNumber: optionalText,
  mfrNumber: optionalText,
  bmrNumber: optionalText,
  bprNumber: optionalText,
  specificationNumber: optionalText,
  specificationVersion: optionalText,
  stpNumber: optionalText,
  upperSpecificationLimit: optionalText,
  lowerSpecificationLimit: optionalText,
  targetValue: optionalText,
  samplingPlan: optionalText,
  testingFrequency: optionalText,
  cpvStatus: z.enum(CPV_PRODUCT_STATUSES).default('Draft'),
  cpvStartDate: requiredText,
  cpvReviewFrequency: z.enum(CPV_REVIEW_FREQUENCIES),
  cpvOwner: requiredText,
  qaReviewer: optionalText,
  remarks: optionalText,
  changeReason: z.string().trim().min(5, 'Change reason must be at least 5 characters'),
  linkedCppParameterIds: z.array(z.string()).default([]),
  linkedCqaParameterIds: z.array(z.string()).default([]),
});

export type CpvProductFormData = z.infer<typeof cpvProductFormSchema>;

export interface CpvProductRecord extends Omit<CpvProductFormData, 'changeReason'>, Record<string, unknown> {
  id: string;
  cpvProductId: string;
  nextReviewDueDate?: string;
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

export interface LinkedParameterRow {
  id: string;
  parameterCode: string;
  parameterName: string;
  parameterType: string;
  processStage: string;
  lsl: string;
  usl: string;
  target: string;
  unit: string;
  criticality: string;
  status: string;
}

export interface CpvProductSummary {
  total: number;
  active: number;
  inactive: number;
  underReview: number;
  draft: number;
  withoutCppLink: number;
  withoutCqaLink: number;
  dueForReview: number;
}

export function buildCpvProductId(productCode: string): string {
  return `CPV-${productCode.toUpperCase().replace(/\s+/g, '-')}`;
}

export function computeNextReviewDueDate(
  startDate: string,
  frequency: typeof CPV_REVIEW_FREQUENCIES[number],
  fromDate?: string,
): string {
  const base = fromDate || startDate;
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) return '';
  const months =
    frequency === 'Monthly' ? 1
      : frequency === 'Quarterly' ? 3
        : frequency === 'Half Yearly' ? 6
          : 12;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

/** Products that may receive new CPV monitoring / batch activity. */
export function isCpvProductOperational(status: string): boolean {
  const s = status.toLowerCase();
  return s === 'active' || s === 'under review' || s === 'approved';
}

export function summarizeCpvProducts(products: CpvProductRecord[]): CpvProductSummary {
  const today = new Date().toISOString().split('T')[0];
  return {
    total: products.length,
    active: products.filter((p) => p.cpvStatus === 'Active').length,
    inactive: products.filter((p) => p.cpvStatus === 'Inactive').length,
    underReview: products.filter((p) => p.cpvStatus === 'Under Review' || p.cpvStatus === 'Approved').length,
    draft: products.filter((p) => p.cpvStatus === 'Draft').length,
    withoutCppLink: products.filter((p) => !p.linkedCppParameterIds?.length).length,
    withoutCqaLink: products.filter((p) => !p.linkedCqaParameterIds?.length).length,
    dueForReview: products.filter((p) => {
      if (!isCpvProductOperational(p.cpvStatus)) return false;
      const due = p.nextReviewDueDate || computeNextReviewDueDate(p.cpvStartDate, p.cpvReviewFrequency);
      return due && due <= today;
    }).length,
  };
}

export const DOSAGE_FORM_FILTER_OPTIONS = [...DOSAGE_FORMS];
export const MARKET_FILTER_OPTIONS = [...MARKET_OPTIONS];
