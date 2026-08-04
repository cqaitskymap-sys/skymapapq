/**
 * Pure-logic checks for PQR Packaging Review.
 * Run: npx tsx scripts/validate-pqr-packaging-review-logic.ts
 */
import {
  canAddPackagingReview,
  canExportPackagingReview,
  canManagePackagingReview,
  canViewPackagingReview,
  computePackagingReconciliation,
  computePackagingSummary,
  filterPackagingReviewRecords,
  generatePackagingNarrative,
  packagingReviewFormSchema,
  normalizePackagingReviewRecord,
  type PqrPackagingReviewRecord,
} from '../lib/pqr-packaging-review-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(canViewPackagingReview('qa'), 'qa can view via normalizeRole');
assert(canViewPackagingReview('QA Manager'), 'QA Manager can view');
assert(canManagePackagingReview('head_qa'), 'head_qa can manage');
assert(canAddPackagingReview('warehouse_manager'), 'warehouse can add');
assert(canExportPackagingReview('auditor'), 'auditor can export');
assert(!canManagePackagingReview('viewer'), 'viewer cannot manage');

const ok = packagingReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  packagingMaterialType: 'Primary Packaging Material',
  packagingMaterialCategory: 'Glass Vial',
  materialName: 'Vial 10ml',
  manufacturerName: 'Mfg Co',
  supplierName: 'Supplier Co',
  arNumber: 'AR-001',
  usedQuantity: 10,
  issuedQuantity: 12,
  unit: 'Nos',
  qcStatus: 'Approved',
  coaAvailable: 'Yes',
  vendorAvlStatus: 'Approved',
  mfgDate: '2025-01-01',
  expDate: '2026-01-01',
});
assert(ok.success, 'valid packaging form');

const badQty = packagingReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  packagingMaterialType: 'Primary Packaging Material',
  packagingMaterialCategory: 'Label',
  materialName: 'Label A',
  manufacturerName: 'Mfg Co',
  supplierName: 'Supplier Co',
  arNumber: 'AR-002',
  usedQuantity: 20,
  issuedQuantity: 10,
  unit: 'Nos',
  qcStatus: 'Approved',
  coaAvailable: 'Yes',
});
assert(!badQty.success, 'used > issued fails');

const rejectedNeedsRemark = packagingReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  packagingMaterialType: 'Secondary Packaging Material',
  packagingMaterialCategory: 'Carton',
  materialName: 'Carton Box',
  manufacturerName: 'Mfg Co',
  supplierName: 'Supplier Co',
  arNumber: 'AR-003',
  usedQuantity: 5,
  issuedQuantity: 5,
  unit: 'Nos',
  qcStatus: 'Rejected',
  coaAvailable: 'No',
  remarks: '',
});
assert(!rejectedNeedsRemark.success, 'rejected requires remarks');

const reconMatched = computePackagingReconciliation({
  issuedQuantity: 100,
  usedQuantity: 90,
  rejectedQuantity: 5,
  returnedQuantity: 5,
});
assert(reconMatched.balanceQuantity === 0, 'recon balance zero');
assert(reconMatched.reconciliationStatus === 'Matched', 'recon matched');

const reconMismatch = computePackagingReconciliation({
  issuedQuantity: 100,
  usedQuantity: 80,
  rejectedQuantity: 5,
  returnedQuantity: 5,
});
assert(reconMismatch.reconciliationStatus === 'Mismatch', 'recon mismatch');
assert(reconMismatch.rejectionPct === 5, 'rejection pct');

const stub = normalizePackagingReviewRecord({
  id: 'pk1',
  pqrId: 'p1',
  productName: 'Prod',
  materialName: 'Vial 10ml',
  arNumber: 'AR-9',
  issuedQuantity: 100,
  usedQuantity: 90,
  rejectedQuantity: 5,
  returnedQuantity: 5,
  qcStatus: 'Approved',
  vendorAvlStatus: 'Approved',
  coaAvailable: 'Yes',
});
assert(stub.product === 'Prod', 'normalize product');
assert(stub.reconciliationStatus === 'Matched', 'normalize recon matched');
assert(stub.balanceQuantity === 0, 'normalize balance');

const records: PqrPackagingReviewRecord[] = [
  stub,
  normalizePackagingReviewRecord({
    id: 'pk2',
    pqrId: 'p1',
    product: 'Prod',
    materialName: 'Label B',
    packagingMaterialType: 'Secondary Packaging Material',
    packagingMaterialCategory: 'Label',
    arNumber: 'AR-10',
    qcStatus: 'Rejected',
    vendorAvlStatus: 'Approved',
    coaAvailable: 'Yes',
    issuedQuantity: 50,
    usedQuantity: 50,
    remarks: 'Print defect',
  }),
];

const summary = computePackagingSummary(records, {
  packagingOosCount: 1,
  packagingDeviationCount: 2,
  packagingCapaCount: 1,
});
assert(summary.totalPackagingLots === 2, 'summary total');
assert(summary.rejectedLots === 1, 'summary rejected');
assert(summary.packagingOosCount === 1, 'summary oos');
assert(summary.acceptancePct === 50, 'acceptance pct');
assert(summary.uniqueMaterials === 2, 'unique materials');

const narrative = generatePackagingNarrative(summary, records);
assert(narrative.toLowerCase().includes('rejected'), 'narrative mentions rejection');
assert(narrative.includes('OOS'), 'narrative mentions OOS');

const filtered = filterPackagingReviewRecords(records, { search: 'Label', packagingType: 'all' });
assert(filtered.length === 1 && filtered[0].materialName === 'Label B', 'search filter');

console.log('PQR packaging review logic validation passed.');
