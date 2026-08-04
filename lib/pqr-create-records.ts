import { z } from 'zod';
import { normalizeRole } from '@/lib/permissions';

export const PQR_CREATE_MODULE = 'Create Annual PQR';

export const PQR_CREATE_COLLECTIONS = {
  records: 'pqr_records',
  recordsLegacy: 'pqr_documents',
  sections: 'pqr_sections',
  approvals: 'pqr_approvals',
  summaryConclusion: 'pqr_summary_conclusion',
  batchReview: 'pqr_batch_review',
  products: 'products',
  cpvProducts: 'cpv_products',
  batches: 'batches',
  cpvBatches: 'cpv_batches',
  rawMaterialMonitoring: 'raw_material_monitoring',
  packingMaterialMonitoring: 'packing_material_monitoring',
  cppResults: 'cpp_results',
  cqaResults: 'cqa_results',
  yieldMonitoring: 'yield_monitoring',
  stabilityMonitoring: 'stability_monitoring',
  holdTimeMonitoring: 'hold_time_monitoring',
  deviations: 'deviations',
  oosRecords: 'oos_records',
  capaRecords: 'capa_records',
  changeControls: 'change_controls',
  complaints: 'complaints',
  recalls: 'recalls',
  validationRecords: 'validation_records',
  equipmentMaster: 'equipment_master',
  vendors: 'vendors',
  profiles: 'profiles',
} as const;

export const PQR_CREATE_STATUSES = [
  'Draft', 'Data Collection', 'Generated', 'Under Review', 'QA Review',
  'Approval Pending', 'Approved', 'Rejected', 'Returned for Correction',
  'Archived', 'Cancelled', 'Closed',
] as const;

export const PQR_QUALITY_STATUSES = [
  'Satisfactory', 'Satisfactory With Observation', 'Needs Improvement', 'Unsatisfactory',
] as const;

export const PQR_RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

export const PQR_FREQUENCIES = ['Yearly', 'Half Yearly', 'Quarterly', 'Custom'] as const;

export const PQR_TYPES = ['Annual', 'Interim', 'Ad-hoc'] as const;

export type PqrCreateStatus = (typeof PQR_CREATE_STATUSES)[number];
export type PqrQualityStatus = (typeof PQR_QUALITY_STATUSES)[number];
export type PqrRiskLevel = (typeof PQR_RISK_LEVELS)[number];
export type PqrFrequency = (typeof PQR_FREQUENCIES)[number];
export type PqrType = (typeof PQR_TYPES)[number];

export const REVIEW_SCOPE_OPTIONS = [
  { key: 'batchReview', label: 'Batch Review', required: true },
  { key: 'rawMaterialReview', label: 'Raw Material Review', required: false },
  { key: 'packingMaterialReview', label: 'Packaging Material Review', required: false },
  { key: 'cppReview', label: 'Critical Process Parameter Review', required: false },
  { key: 'cqaReview', label: 'Critical Quality Attribute Review', required: false },
  { key: 'finishedProductReview', label: 'Finished Product Review', required: false },
  { key: 'yieldReview', label: 'Yield Review', required: false },
  { key: 'stabilityReview', label: 'Stability Review', required: false },
  { key: 'holdTimeReview', label: 'Hold Time Review', required: false },
  { key: 'deviationReview', label: 'Deviation Review', required: false },
  { key: 'oosReview', label: 'OOS / OOT Review', required: false },
  { key: 'capaReview', label: 'CAPA Review', required: false },
  { key: 'changeControlReview', label: 'Change Control Review', required: false },
  { key: 'complaintReview', label: 'Complaint Review', required: false },
  { key: 'recallReview', label: 'Recall Review', required: false },
  { key: 'validationReview', label: 'Validation / Cleaning Review', required: false },
  { key: 'equipmentReview', label: 'Equipment / Calibration / Maintenance', required: false },
  { key: 'vendorReview', label: 'Supplier / Vendor Review', required: false },
  { key: 'trendAnalysis', label: 'CPV / SPC / Trend Analysis', required: false },
  { key: 'conclusionRecommendation', label: 'Summary, Recommendations & Approval', required: true },
] as const;

export type ReviewScopeKey = (typeof REVIEW_SCOPE_OPTIONS)[number]['key'];

export type ReviewScope = Record<ReviewScopeKey, boolean>;

export const defaultReviewScope = (): ReviewScope =>
  REVIEW_SCOPE_OPTIONS.reduce((acc, o) => ({ ...acc, [o.key]: true }), {} as ReviewScope);

export const SCOPE_TO_SECTIONS: Partial<Record<ReviewScopeKey, string[]>> = {
  batchReview: ['batch_manufacturing', 'batch_failure', 'rework_reprocess'],
  rawMaterialReview: ['raw_material'],
  packingMaterialReview: ['packing_material'],
  cppReview: ['cpp_review'],
  cqaReview: ['in_process_cqa', 'cqa_review'],
  finishedProductReview: ['finished_product'],
  yieldReview: ['yield_review'],
  stabilityReview: ['stability_review'],
  deviationReview: ['deviation_review'],
  oosReview: ['oos_review'],
  capaReview: ['capa_review'],
  changeControlReview: ['change_control'],
  complaintReview: ['complaint_review'],
  recallReview: ['recall_review'],
  validationReview: ['validation_review'],
  equipmentReview: ['equipment_review'],
  vendorReview: ['technical_agreement', 'supply_chain'],
  trendAnalysis: ['trend_analysis'],
  conclusionRecommendation: ['summary', 'conclusion', 'summary_conclusion', 'approval_page'],
};

export const PQR_SECTION_DEFINITIONS = [
  { order: 1, key: 'cover_page', title: 'Cover Page' },
  { order: 2, key: 'product_details', title: 'Product Details' },
  { order: 3, key: 'review_objective', title: 'Review Objective' },
  { order: 4, key: 'scope', title: 'Scope' },
  { order: 5, key: 'batch_manufacturing', title: 'Batch Manufacturing Details' },
  { order: 6, key: 'raw_material', title: 'API / Raw Material Review' },
  { order: 7, key: 'packing_material', title: 'Packing Material Review' },
  { order: 8, key: 'cpp_review', title: 'Manufacturing Process Parameter Review' },
  { order: 9, key: 'in_process_cqa', title: 'In-Process Specification Review' },
  { order: 10, key: 'finished_product', title: 'Finished Product Specification Review' },
  { order: 11, key: 'trend_analysis', title: 'Trend Analysis' },
  { order: 12, key: 'yield_review', title: 'Yield Review' },
  { order: 13, key: 'batch_failure', title: 'Batch Failure / Rejection Review' },
  { order: 14, key: 'rework_reprocess', title: 'Rework / Reprocess Review' },
  { order: 15, key: 'mfg_testing_procedure', title: 'Manufacturing & Testing Procedure Review' },
  { order: 16, key: 'deviation_review', title: 'Deviation Review' },
  { order: 17, key: 'oos_review', title: 'OOS / OOT Review' },
  { order: 18, key: 'capa_review', title: 'CAPA Review' },
  { order: 19, key: 'change_control', title: 'Change Control Review' },
  { order: 20, key: 'stability_review', title: 'Stability Review' },
  { order: 21, key: 'validation_review', title: 'Validation & Qualification Review' },
  { order: 22, key: 'equipment_review', title: 'Equipment / Utility Qualification Review' },
  { order: 23, key: 'complaint_review', title: 'Market Complaint Review' },
  { order: 24, key: 'recall_review', title: 'Product Recall / Returned Goods Review' },
  { order: 25, key: 'technical_agreement', title: 'Technical Agreement Review' },
  { order: 26, key: 'supply_chain', title: 'Supply Chain Traceability Review' },
  { order: 27, key: 'cqa_review', title: 'CQA Review' },
  { order: 28, key: 'summary', title: 'Summary' },
  { order: 29, key: 'conclusion', title: 'Conclusion' },
  { order: 30, key: 'summary_conclusion', title: 'Summary & Conclusion' },
  { order: 31, key: 'revision_history', title: 'Revision History' },
  { order: 32, key: 'approval_page', title: 'Approval Page' },
] as const;

export const ALWAYS_INCLUDED_SECTIONS = [
  'cover_page', 'product_details', 'review_objective', 'scope',
  'mfg_testing_procedure', 'revision_history',
] as const;

export interface PqrProductOption {
  id: string;
  source: 'products' | 'cpv_products';
  productCode: string;
  productName: string;
  genericName: string;
  brandName: string;
  strength: string;
  dosageForm: string;
  productType: string;
  productVersion: string;
  routeOfAdministration: string;
  packSize: string;
  market: string;
  shelfLife: string;
  storageCondition: string;
  manufacturingSite: string;
  manufacturingLicenseNumber: string;
  mfrNumber: string;
  bmrNumber: string;
  bprNumber: string;
  specificationNumber: string;
  stpNumber: string;
  status: string;
  lifecycleStatus: string;
}

export interface PqrBatchOption {
  id: string;
  batchNumber: string;
  productName: string;
  productCode: string;
  batchSize: string;
  manufacturingDate: string;
  expiryDate: string;
  manufacturingSite: string;
  batchStatus: string;
  releaseStatus: string;
  batchType: string;
  source: string;
}

export interface PqrTeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  designation: string;
  status: string;
}

export interface PqrAttachmentMeta {
  fileName: string;
  url: string;
  path: string;
  uploadedAt: string;
  uploadedBy: string;
}

export interface PqrCollectedSummary {
  totalBatches: number;
  releasedBatches: number;
  rejectedBatches: number;
  rawMaterialLots: number;
  packingMaterialLots: number;
  cppRecords: number;
  cqaRecords: number;
  yieldRecords: number;
  stabilityRecords: number;
  holdTimeRecords: number;
  deviations: number;
  oos: number;
  oot: number;
  capa: number;
  changeControls: number;
  complaints: number;
  recalls: number;
  validationRecords: number;
  equipmentRecords: number;
  vendorRecords: number;
  riskRecords: number;
  averageCpk: number;
  openCriticalOos: number;
  openCriticalDeviations: number;
  openCapa: number;
}

export type DataLoadState = 'ok' | 'empty' | 'error' | 'loading';

export interface PqrCollectedData {
  summary: PqrCollectedSummary;
  loadState: DataLoadState;
  loadError?: string;
  batches: Record<string, unknown>[];
  rawMaterials: Record<string, unknown>[];
  packingMaterials: Record<string, unknown>[];
  cppResults: Record<string, unknown>[];
  cqaResults: Record<string, unknown>[];
  yieldRecords: Record<string, unknown>[];
  stabilityRecords: Record<string, unknown>[];
  holdTimeRecords: Record<string, unknown>[];
  deviations: Record<string, unknown>[];
  oosRecords: Record<string, unknown>[];
  capaRecords: Record<string, unknown>[];
  changeControls: Record<string, unknown>[];
  complaints: Record<string, unknown>[];
  recalls: Record<string, unknown>[];
  validationRecords: Record<string, unknown>[];
  equipmentRecords: Record<string, unknown>[];
  vendorRecords: Record<string, unknown>[];
  capabilityRecords: Record<string, unknown>[];
  riskRecords: Record<string, unknown>[];
}

export interface PqrSectionRecord {
  id?: string;
  pqrId: string;
  sectionKey: string;
  sectionOrder: number;
  sectionTitle: string;
  narrative: string;
  dataSummary?: string;
  included: boolean;
  status: 'Draft' | 'Reviewed' | 'Approved';
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  isDeleted: boolean;
}

export interface PqrCreateRecord {
  id?: string;
  pqrId: string;
  pqrNumber: string;
  pqrTitle: string;
  pqrType: PqrType;
  productId: string;
  productCode: string;
  productName: string;
  genericName: string;
  brandName: string;
  strength: string;
  dosageForm: string;
  routeOfAdministration: string;
  packSize: string;
  market: string;
  shelfLife: string;
  storageCondition: string;
  manufacturingSite: string;
  manufacturingLicenseNumber: string;
  mfrNumber: string;
  bmrNumber: string;
  bprNumber: string;
  specificationNumber: string;
  stpNumber: string;
  site: string;
  plant: string;
  department: string;
  reviewPeriodFrom: string;
  reviewPeriodTo: string;
  reviewYear: number;
  pqrFrequency: PqrFrequency;
  pqrOwner: string;
  qaReviewer: string;
  qcReviewer: string;
  productionReviewer: string;
  engineeringReviewer: string;
  regulatoryReviewer: string;
  finalApprover: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  dueDate: string;
  status: PqrCreateStatus;
  version: string;
  overallQualityStatus: PqrQualityStatus;
  overallRiskLevel: PqrRiskLevel;
  executiveSummary: string;
  conclusion: string;
  recommendations: string;
  remarks: string;
  description: string;
  reviewScope: ReviewScope;
  selectedBatchIds: string[];
  selectedBatchNumbers: string[];
  collectedSummary?: PqrCollectedSummary;
  attachments?: PqrAttachmentMeta[];
  qaOverride?: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  createdByName?: string;
  updatedByName?: string;
  isDeleted: boolean;
}

export interface PqrConflictCheck {
  overlap: boolean;
  duplicateNumber: boolean;
  activeDraft: boolean;
  existingPqrNumber?: string;
  existingPqrId?: string;
  existingStatus?: string;
  warning?: string;
}

export const reviewPeriodSchema = z.object({
  reviewPeriodFrom: z.string().min(1, 'Review period from is required'),
  reviewPeriodTo: z.string().min(1, 'Review period to is required'),
  reviewYear: z.number().min(2000).max(2100),
  pqrFrequency: z.enum(PQR_FREQUENCIES),
  dueDate: z.string().min(1, 'Due date is required'),
  allowFuture: z.boolean().optional(),
}).refine((d) => new Date(d.reviewPeriodTo) > new Date(d.reviewPeriodFrom), {
  message: 'Review period end must be after start',
  path: ['reviewPeriodTo'],
}).refine((d) => {
  if (d.allowFuture) return true;
  const to = new Date(d.reviewPeriodTo);
  const tomorrow = new Date();
  tomorrow.setHours(23, 59, 59, 999);
  return to <= tomorrow;
}, {
  message: 'Review period end cannot be in the future',
  path: ['reviewPeriodTo'],
});

const CREATE_ROLES = new Set([
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
]);

export function canCreateAnnualPqr(role?: string): boolean {
  return CREATE_ROLES.has(normalizeRole(role));
}

export function canEditAnnualPqr(role?: string): boolean {
  return canCreateAnnualPqr(role);
}

export function canSubmitAnnualPqr(role?: string): boolean {
  return canCreateAnnualPqr(role);
}

export function canExportAnnualPqr(role?: string): boolean {
  return ['super_admin', 'admin', 'head_qa', 'qa_manager', 'auditor'].includes(normalizeRole(role));
}

export function isAnnualPqrViewOnly(role?: string): boolean {
  const r = normalizeRole(role);
  return ['auditor', 'viewer', 'qc_manager', 'qc_executive',
    'production_manager', 'production_executive',
    'warehouse_manager', 'warehouse_executive',
    'engineering_manager', 'engineering_executive',
  ].includes(r);
}

export function qualityStatusColor(status: string): string {
  if (status === 'Satisfactory') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Satisfactory With Observation') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Needs Improvement') return 'bg-orange-50 text-orange-800 border-orange-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export function pqrCreateStatusColor(status: string): string {
  if (status === 'Draft') return 'bg-slate-100 text-slate-700 border-slate-200';
  if (status === 'Data Collection') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (status === 'Generated') return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (status === 'Under Review' || status === 'QA Review' || status === 'Approval Pending') return 'bg-amber-50 text-amber-800 border-amber-200';
  if (status === 'Approved' || status === 'Closed') return 'bg-green-50 text-green-700 border-green-200';
  if (status === 'Rejected' || status === 'Cancelled') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'Returned for Correction') return 'bg-purple-50 text-purple-700 border-purple-200';
  if (status === 'Archived') return 'bg-slate-50 text-slate-600 border-slate-300';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

export function riskLevelColor(level: string): string {
  if (level === 'Critical') return 'bg-red-900/10 text-red-900 border-red-300';
  if (level === 'High') return 'bg-red-50 text-red-700 border-red-200';
  if (level === 'Medium') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-green-50 text-green-700 border-green-200';
}

export const emptyCollectedSummary = (): PqrCollectedSummary => ({
  totalBatches: 0, releasedBatches: 0, rejectedBatches: 0,
  rawMaterialLots: 0, packingMaterialLots: 0, cppRecords: 0, cqaRecords: 0,
  yieldRecords: 0, stabilityRecords: 0, holdTimeRecords: 0,
  deviations: 0, oos: 0, oot: 0, capa: 0, changeControls: 0, complaints: 0, recalls: 0,
  validationRecords: 0, equipmentRecords: 0, vendorRecords: 0, riskRecords: 0,
  averageCpk: 0, openCriticalOos: 0, openCriticalDeviations: 0, openCapa: 0,
});

export const WIZARD_STEPS = [
  'Select Product',
  'Review Period',
  'Batch Selection',
  'Review Scope',
  'Collect & Preview Data',
  'Team & Generate Draft',
  'Edit Narratives',
  'Submit for Review',
] as const;
