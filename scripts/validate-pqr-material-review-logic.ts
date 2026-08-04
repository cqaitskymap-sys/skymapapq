/**
 * Pure-logic checks for PQR Material Review.
 * Run: npx tsx scripts/validate-pqr-material-review-logic.ts
 */
import {
  canAddMaterialReview,
  canExportMaterialReview,
  canManageMaterialReview,
  canViewMaterialReview,
  computeMaterialCompliance,
  computeMaterialSummary,
  computeQuantityVariance,
  filterMaterialReviewRecords,
  generateMaterialNarrative,
  materialReviewFormSchema,
  normalizeMaterialReviewRecord,
  type PqrMaterialReviewRecord,
} from '../lib/pqr-material-review-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(canViewMaterialReview('qa'), 'qa can view via normalizeRole');
assert(canViewMaterialReview('QA Manager'), 'QA Manager can view');
assert(canManageMaterialReview('head_qa'), 'head_qa can manage');
assert(canAddMaterialReview('warehouse_manager'), 'warehouse can add');
assert(canExportMaterialReview('auditor'), 'auditor can export');
assert(!canManageMaterialReview('viewer'), 'viewer cannot manage');

const ok = materialReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  materialType: 'API',
  materialName: 'API-X',
  manufacturerName: 'Mfg Co',
  supplierName: 'Supplier Co',
  arNumber: 'AR-001',
  usedQuantity: 10,
  issuedQuantity: 12,
  unit: 'Kg',
  qcStatus: 'Approved',
  coaAvailable: 'Yes',
  vendorAvlStatus: 'Approved',
  mfgDate: '2025-01-01',
  expDate: '2026-01-01',
});
assert(ok.success, 'valid material form');

const badQty = materialReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  materialType: 'API',
  materialName: 'API-X',
  manufacturerName: 'Mfg Co',
  supplierName: 'Supplier Co',
  arNumber: 'AR-002',
  usedQuantity: 20,
  issuedQuantity: 10,
  unit: 'Kg',
  qcStatus: 'Approved',
  coaAvailable: 'Yes',
});
assert(!badQty.success, 'used > issued fails');

const rejectedNeedsRemark = materialReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  materialType: 'Raw Material',
  materialName: 'Excipient',
  manufacturerName: 'Mfg Co',
  supplierName: 'Supplier Co',
  arNumber: 'AR-003',
  usedQuantity: 5,
  issuedQuantity: 5,
  unit: 'Kg',
  qcStatus: 'Rejected',
  coaAvailable: 'No',
  remarks: '',
});
assert(!rejectedNeedsRemark.success, 'rejected requires remarks');

const variance = computeQuantityVariance(100, 95);
assert(variance.varianceQty === -5, 'variance qty');
assert(variance.variancePct === -5, 'variance pct');
assert(computeQuantityVariance(0, 5).variancePct === null, 'zero issued variance pct unavailable');
assert(computeQuantityVariance(null, 5).varianceQty === null, 'missing issued unavailable');

const compliance = computeMaterialCompliance({
  vendorAvlStatus: 'Not Approved',
  qcStatus: 'Under Test',
  coaAvailable: 'No',
  issuedQuantity: 10,
  usedQuantity: 10,
});
assert(compliance.complianceStatus === 'Does Not Comply', 'non-compliant');
assert(compliance.complianceReasons.length >= 2, 'multiple reasons');

const stub = normalizeMaterialReviewRecord({
  id: 'm1',
  pqrId: 'p1',
  productName: 'Prod',
  materialName: 'API-X',
  arNumber: 'AR-9',
  issuedQuantity: 100,
  usedQuantity: 90,
  qcStatus: 'Approved',
  vendorAvlStatus: 'Approved',
  coaAvailable: 'Yes',
});
assert(stub.product === 'Prod', 'normalize product');
assert(stub.variancePct === -10, 'normalize variance');

const records: PqrMaterialReviewRecord[] = [
  stub,
  normalizeMaterialReviewRecord({
    id: 'm2',
    pqrId: 'p1',
    product: 'Prod',
    materialName: 'Excipient-Y',
    materialType: 'Excipient',
    arNumber: 'AR-10',
    qcStatus: 'Rejected',
    vendorAvlStatus: 'Approved',
    coaAvailable: 'Yes',
    issuedQuantity: 50,
    usedQuantity: 50,
  }),
];

const summary = computeMaterialSummary(records, {
  materialOosCount: 1,
  materialDeviationCount: 2,
  materialCapaCount: 1,
});
assert(summary.totalMaterialLots === 2, 'summary total');
assert(summary.rejectedLots === 1, 'summary rejected');
assert(summary.materialCapaCount === 1, 'summary capa');
assert(summary.acceptancePct === 50, 'acceptance pct');

const narrative = generateMaterialNarrative(summary, records);
assert(narrative.toLowerCase().includes('rejected'), 'narrative mentions rejection');
assert(narrative.includes('CAPA'), 'narrative mentions CAPA');

const filtered = filterMaterialReviewRecords(records, { search: 'Excipient', materialType: 'all' });
assert(filtered.length === 1 && filtered[0].materialName === 'Excipient-Y', 'search filter');

console.log('PQR material review logic validation passed.');
