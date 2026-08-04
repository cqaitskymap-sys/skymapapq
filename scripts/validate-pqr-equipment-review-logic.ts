/**
 * Pure-logic checks for PQR Equipment Review.
 * Run: npx tsx scripts/validate-pqr-equipment-review-logic.ts
 */
import {
  canAddEquipmentReview,
  canExportEquipmentReview,
  canManageEquipmentReview,
  canViewEquipmentReview,
  computeEquipmentCompliance,
  computeEquipmentSummary,
  equipmentReviewFormSchema,
  filterEquipmentReviewRecords,
  generateEquipmentNarrative,
  normalizeEquipmentReviewRecord,
  type PqrEquipmentReviewRecord,
} from '../lib/pqr-equipment-review-records';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// --- Role checks (via normalizeRole) ---
assert(canViewEquipmentReview('qa'), 'qa can view via normalizeRole');
assert(canViewEquipmentReview('QA Manager'), 'QA Manager can view');
assert(canViewEquipmentReview('head_qa'), 'head_qa can view');
assert(canViewEquipmentReview('viewer'), 'viewer can view');
assert(canManageEquipmentReview('head_qa'), 'head_qa can manage');
assert(canManageEquipmentReview('engineering'), 'engineering (→engineering_manager) can manage');
assert(canManageEquipmentReview('maintenance'), 'maintenance can manage');
assert(canAddEquipmentReview('production'), 'production (→production_manager) can add');
assert(canExportEquipmentReview('auditor'), 'auditor can export');
assert(!canManageEquipmentReview('viewer'), 'viewer cannot manage');
assert(!canExportEquipmentReview('production'), 'production cannot export');

// --- Form schema valid / invalid ---
const okForm = equipmentReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  equipmentId: 'EQ-001',
  equipmentName: 'Autoclave 1',
  equipmentCategory: 'Manufacturing Equipment',
  equipmentType: 'Autoclave',
  qualificationStatus: 'Qualified',
  calibrationStatus: 'Calibrated',
  pmStatus: 'Completed',
  lastCalibrationDate: '2025-01-01',
  nextCalibrationDate: '2026-01-01',
});
assert(okForm.success, 'valid equipment form');

const badCal = equipmentReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  equipmentId: 'EQ-002',
  equipmentName: 'Balance 1',
  equipmentCategory: 'QC Laboratory Equipment',
  equipmentType: 'Balance',
  qualificationStatus: 'Qualified',
  calibrationStatus: 'Calibrated',
  pmStatus: 'Not Applicable',
  lastCalibrationDate: '2026-01-01',
  nextCalibrationDate: '2025-01-01',
});
assert(!badCal.success, 'next cal before last cal fails');

const notRequiredForm = equipmentReviewFormSchema.safeParse({
  pqrId: 'p1',
  product: 'Product A',
  productCode: 'PA-01',
  equipmentId: 'EQ-003',
  equipmentName: 'Work Bench',
  equipmentCategory: 'Manufacturing Equipment',
  equipmentType: 'Other',
  qualificationStatus: 'Not Required',
  calibrationStatus: 'Not Calibrated',
  pmStatus: 'Not Applicable',
});
assert(notRequiredForm.success, "'Not Required' qualification accepted by schema");

// --- computeEquipmentCompliance scenarios ---
const notQualified = computeEquipmentCompliance({
  qualificationStatus: 'Not Qualified',
  calibrationStatus: 'Calibrated',
  pmStatus: 'Completed',
});
assert(notQualified.complianceStatus === 'Critical Observation', 'Not Qualified → Critical Observation');
assert(notQualified.riskLevel === 'Critical', 'Not Qualified → Critical risk');

const complies = computeEquipmentCompliance({
  qualificationStatus: 'Qualified',
  calibrationStatus: 'Calibrated',
  pmStatus: 'Completed',
  breakdownCount: 0,
});
assert(complies.complianceStatus === 'Complies', 'Calibrated+Qualified+Completed → Complies');

const notRequiredComplies = computeEquipmentCompliance({
  qualificationStatus: 'Not Required',
  calibrationStatus: 'Calibrated',
  pmStatus: 'Not Applicable',
  breakdownCount: 0,
});
assert(notRequiredComplies.complianceStatus === 'Complies', "Not Required qualification treated like Qualified → Complies");

const calOverdue = computeEquipmentCompliance({
  qualificationStatus: 'Qualified',
  calibrationStatus: 'Calibration Overdue',
  pmStatus: 'Completed',
});
assert(calOverdue.complianceStatus === 'Major Observation', 'Calibration Overdue → Major Observation');

// --- normalizeEquipmentReviewRecord ---
const stub = normalizeEquipmentReviewRecord({
  id: 'eq1',
  pqrId: 'p1',
  productName: 'Prod',
  equipmentId: 'EQ-100',
  equipmentName: 'Filling Machine',
  equipmentCategory: 'Manufacturing Equipment',
  qualificationStatus: 'Qualified',
  calibrationStatus: 'Calibrated',
  pmStatus: 'Completed',
  batchesUsed: ['B1', 'B2'],
});
assert(stub.product === 'Prod', 'normalize product');
assert(stub.complianceStatus === 'Complies', 'normalize computes compliance');
assert(stub.batchCount === 2, 'normalize batch count from batchesUsed');

const records: PqrEquipmentReviewRecord[] = [
  stub,
  normalizeEquipmentReviewRecord({
    id: 'eq2',
    pqrId: 'p1',
    product: 'Prod',
    equipmentId: 'EQ-200',
    equipmentName: 'HVAC Unit A',
    equipmentCategory: 'HVAC Equipment',
    department: 'Engineering',
    qualificationStatus: 'Not Qualified',
    calibrationStatus: 'Calibration Overdue',
    pmStatus: 'Overdue',
    breakdownCount: 2,
    downtimeHours: 5,
    criticality: 'High',
    linkedOos: 1,
  }),
];

// --- filterEquipmentReviewRecords ---
const searchFiltered = filterEquipmentReviewRecords(records, { search: 'HVAC', category: 'all' });
assert(searchFiltered.length === 1 && searchFiltered[0].equipmentName === 'HVAC Unit A', 'search filter');

const catFiltered = filterEquipmentReviewRecords(records, { category: 'HVAC Equipment' });
assert(catFiltered.length === 1 && catFiltered[0].equipmentId === 'EQ-200', 'category filter');

const critFiltered = filterEquipmentReviewRecords(records, { criticality: 'High' });
assert(critFiltered.length === 1 && critFiltered[0].equipmentId === 'EQ-200', 'criticality filter');

const deptFiltered = filterEquipmentReviewRecords(records, { department: 'Engineering' });
assert(deptFiltered.length === 1 && deptFiltered[0].equipmentId === 'EQ-200', 'department filter');

// --- summary totals ---
const summary = computeEquipmentSummary(records, { equipmentOos: 1 });
assert(summary.totalEquipmentReviewed === 2, 'summary total');
assert(summary.qualifiedEquipment === 1, 'summary qualified');
assert(summary.calibrationOverdue === 1, 'summary calibration overdue');
assert(summary.pmOverdue === 1, 'summary pm overdue');
assert(summary.breakdownCount === 2, 'summary breakdown count');
assert(summary.totalDowntimeHours === 5, 'summary downtime hours');
assert(summary.criticalEquipmentRisks === 1, 'summary critical risks');
assert(summary.linkedOos === 1, 'summary linked oos');

const narrative = generateEquipmentNarrative(summary, records);
assert(narrative.toLowerCase().includes('calibration'), 'narrative mentions calibration');
assert(narrative.toLowerCase().includes('breakdown'), 'narrative mentions breakdown');

console.log('PQR Equipment Review logic validation passed.');
