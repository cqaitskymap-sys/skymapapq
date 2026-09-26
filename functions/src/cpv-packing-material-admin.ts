/**
 * CPV Packing Material Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, reconciliation + compliance.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';
import { assertCpvBatchForProduct } from './cpv-batch-guard';


function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 500): string {
  if (value == null) return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} must be a string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function requiredReason(value: unknown): string {
  const reason = requiredString(value, 'Change reason', 2000);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

function asNonNegNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpsError('invalid-argument', `${field} must be a non-negative number`);
  }
  return n;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toComparableDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}$/.test(trimmed)) {
    const [y, m] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, 1);
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

const COLLECTION = 'packing_material_monitoring';
const MODULE = 'Packing Material Monitoring';

const ENTER_ROLES = [
  'super_admin', 'admin', 'warehouse', 'warehouse_manager', 'qc', 'qc_manager',
];
const QC_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'qc', 'qc_manager',
];
const REVIEW_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...ENTER_ROLES,
  ...REVIEW_ROLES,
  'production', 'production_manager', 'viewer', 'auditor',
];

const MATERIAL_TYPES = [
  'Primary Packing Material',
  'Secondary Packing Material',
  'Tertiary Packing Material',
] as const;

const MATERIAL_CATEGORIES = [
  'Vial', 'Rubber Stopper', 'Flip Off Seal', 'Label', 'Carton',
  'Package Insert / Leaflet', 'Shipper Box', 'PVC Film', 'BOPP Tape',
  'Bottle', 'Cap', 'Closure', 'Foil', 'Blister', 'Insert', 'Leaflet',
  'Tube', 'Sachet', 'Pouch', 'Printed Material', 'Other',
] as const;

const QC_STATUSES = ['Approved', 'Rejected', 'Under Test', 'Quarantine', 'Retest Required'] as const;
const COA_OPTIONS = ['Yes', 'No'] as const;
const YES_NO_NA = ['Yes', 'No', 'N/A', 'Pass', 'Fail', 'Pending', ''] as const;
const LABEL_CATEGORIES = ['Label', 'Package Insert / Leaflet', 'Insert', 'Leaflet', 'Printed Material', 'Carton'];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Packing Material Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Packing Material Monitoring entry access required');
  }
}

function assertQc(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !QC_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QC/QA access required for quality fields');
  }
}

function assertReviewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !REVIEW_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QA review/approve access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const snap = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = snap.data();
  return {
    firestore,
    actor,
    actorRole: String(actor?.role || ''),
    actorName: String(actor?.full_name || actor?.email || request.auth.uid),
    actorUid: request.auth.uid,
  };
}

function buildId(batchNumber: string, materialCode: string, arNumber: string): string {
  return `PM-${batchNumber}-${materialCode}-${arNumber}`.replace(/\s+/g, '-').toUpperCase();
}

function isExpired(expDate: string): boolean {
  const exp = toComparableDate(expDate);
  if (!exp) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp < today;
}

function calculateBalance(issued: number, used: number, rejected: number, returned: number): number {
  return issued - used - rejected - returned;
}

function evaluateReconciliation(
  issued: number,
  used: number,
  rejected: number,
  returned: number,
): string {
  if (issued === 0 && used === 0 && rejected === 0 && returned === 0) return 'Not Applicable';
  return calculateBalance(issued, used, rejected, returned) === 0 ? 'Matched' : 'Mismatch';
}

function evaluateTestStatus(
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

function evaluateCompliance(input: {
  vendorStatus: string;
  avlStatus: string;
  qcStatus: string;
  coaAvailable: string;
  expDate: string;
  usedQuantity: number;
  issuedQuantity: number;
  reconciliationStatus: string;
  artworkVerified?: string;
  barcodeVerified?: string;
  packagingIntegrity?: string;
  testParameter?: string;
  observedResult?: number | string;
  lowerLimit?: number;
  upperLimit?: number;
}): string {
  const vendorOk = input.vendorStatus === 'Active';
  const avlOk = ['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(input.avlStatus);
  const qcOk = input.qcStatus === 'Approved';
  const coaOk = input.coaAvailable === 'Yes';
  const notExpired = !isExpired(input.expDate);
  const qtyOk = input.usedQuantity <= input.issuedQuantity;
  const reconOk = input.reconciliationStatus === 'Matched' || input.reconciliationStatus === 'Not Applicable';
  const artworkOk = !input.artworkVerified || ['Yes', 'Pass', 'N/A', ''].includes(input.artworkVerified);
  const barcodeOk = !input.barcodeVerified || ['Yes', 'Pass', 'N/A', ''].includes(input.barcodeVerified);
  const integrityOk = !input.packagingIntegrity || ['Yes', 'Pass', 'N/A', ''].includes(input.packagingIntegrity);

  const testStatus = input.testParameter
    ? evaluateTestStatus(input.observedResult, input.lowerLimit, input.upperLimit)
    : null;

  if (!vendorOk || !avlOk || !qcOk || !coaOk || !notExpired || !qtyOk || !reconOk
    || !artworkOk || !barcodeOk || !integrityOk) {
    return 'Does Not Comply';
  }
  if (testStatus === 'OOS') return 'OOS';
  if (testStatus === 'OOT') return 'OOT';
  if (testStatus === 'Does Not Comply') return 'Does Not Comply';
  return 'Complies';
}

function evaluateRisk(
  input: {
    expDate: string;
    avlStatus: string;
    qcStatus: string;
    coaAvailable: string;
    reconciliationStatus: string;
    materialCategory: string;
    complianceStatus: string;
    artworkVerified?: string;
    barcodeVerified?: string;
  },
  issueCount: number,
): string {
  const labelMismatch = LABEL_CATEGORIES.includes(input.materialCategory)
    && input.reconciliationStatus === 'Mismatch';
  const artworkFail = ['No', 'Fail'].includes(String(input.artworkVerified || ''));
  const barcodeFail = ['No', 'Fail'].includes(String(input.barcodeVerified || ''));
  if (isExpired(input.expDate) || input.qcStatus === 'Rejected' || labelMismatch || artworkFail || barcodeFail) {
    return 'Critical';
  }
  if (issueCount >= 3) return 'High';
  if (!['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(input.avlStatus)) return 'High';
  if (input.reconciliationStatus === 'Mismatch') return 'High';
  if (input.coaAvailable !== 'Yes') return 'Medium';
  if (['OOS', 'OOT', 'Alert', 'Action'].includes(input.complianceStatus)) return input.complianceStatus === 'OOS' ? 'High' : 'Medium';
  return 'Low';
}

function writePmAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    documentNumber?: string;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    now: string;
    esign?: boolean;
  },
) {
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-PM-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'CPV',
    subModule: MODULE,
    collectionName: COLLECTION,
    recordId: input.recordId,
    documentId: input.recordId,
    documentNumber: input.documentNumber || '',
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason || '',
    performedBy: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    electronicSignature: input.esign === true,
    createdAt: input.now,
    source: 'cpv-packing-material-admin',
    immutable: true,
    appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE,
    action: input.actionType,
    recordId: input.recordId,
    description: input.description,
    performedBy: input.actorName,
    userId: input.actorUid,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
    status: 'Success',
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE,
    actionType: input.actionType,
    actionDescription: input.description,
    recordId: input.recordId,
    documentNumber: input.documentNumber || '',
    userId: input.actorUid,
    userName: input.actorName,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
    status: 'Success',
  });
}

function notify(
  firestore: Firestore,
  batch: WriteBatch,
  input: {
    targetUid: string;
    recordId: string;
    eventName: string;
    title: string;
    message: string;
    now: string;
  },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid,
    title: input.title,
    message: input.message,
    type: 'cpv_packing_material',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/packing-material-monitoring/${input.recordId}`,
    read: false,
    createdAt: input.now,
  });
}

async function assertOperationalProduct(firestore: Firestore, productId: string) {
  const snap = await firestore.collection('cpv_products').doc(productId).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'CPV product not found');
  }
  const status = String(snap.data()?.cpvStatus || '');
  if (!['Active', 'Under Review', 'Approved'].includes(status)) {
    throw new HttpsError('failed-precondition', 'Selected CPV product is not operational');
  }
  return snap.data() || {};
}

async function findDuplicate(
  firestore: Firestore,
  materialCode: string,
  arNumber: string,
  excludeId?: string,
) {
  const snap = await firestore
    .collection(COLLECTION)
    .where('materialCode', '==', materialCode)
    .where('arNumber', '==', arNumber)
    .limit(10)
    .get();
  return snap.docs.find((d) => d.id !== excludeId && d.data()?.isDeleted !== true);
}

async function countIssues(firestore: Firestore, materialCode: string, batchNumber: string): Promise<number> {
  try {
    const snap = await firestore
      .collection(COLLECTION)
      .where('materialCode', '==', materialCode)
      .where('batchNumber', '==', batchNumber)
      .limit(100)
      .get();
    return snap.docs.filter((d) =>
      String(d.data()?.complianceStatus || '') !== 'Complies' && d.data()?.isDeleted !== true,
    ).length;
  } catch {
    return 0;
  }
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const materialType = optionalString(data.materialType ?? existing?.materialType, 'Material type', 80)
    || 'Primary Packing Material';
  if (!MATERIAL_TYPES.includes(materialType as typeof MATERIAL_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid material type: ${materialType}`);
  }
  const materialCategory = optionalString(
    data.materialCategory ?? existing?.materialCategory,
    'Material category',
    80,
  ) || 'Other';
  if (!MATERIAL_CATEGORIES.includes(materialCategory as typeof MATERIAL_CATEGORIES[number])) {
    throw new HttpsError('invalid-argument', `Invalid material category: ${materialCategory}`);
  }
  const qcStatus = optionalString(data.qcStatus ?? existing?.qcStatus, 'QC status', 40) || 'Under Test';
  if (!QC_STATUSES.includes(qcStatus as typeof QC_STATUSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid QC status: ${qcStatus}`);
  }
  const coaAvailable = optionalString(data.coaAvailable ?? existing?.coaAvailable, 'COA', 10) || 'No';
  if (!COA_OPTIONS.includes(coaAvailable as typeof COA_OPTIONS[number])) {
    throw new HttpsError('invalid-argument', `Invalid COA option: ${coaAvailable}`);
  }

  const mfgDate = requiredString(data.mfgDate ?? existing?.mfgDate, 'MFG date', 40);
  const expDate = requiredString(data.expDate ?? existing?.expDate, 'EXP date', 40);
  const mfg = toComparableDate(mfgDate);
  const exp = toComparableDate(expDate);
  if (!mfg || !exp || !(exp > mfg)) {
    throw new HttpsError('invalid-argument', 'EXP date must be after MFG date');
  }

  const issuedQuantity = asNonNegNumber(data.issuedQuantity ?? existing?.issuedQuantity ?? 0, 'Issued quantity');
  const usedQuantity = asNonNegNumber(data.usedQuantity ?? existing?.usedQuantity ?? 0, 'Used quantity');
  const rejectedQuantity = asNonNegNumber(data.rejectedQuantity ?? existing?.rejectedQuantity ?? 0, 'Rejected quantity');
  const returnedQuantity = asNonNegNumber(data.returnedQuantity ?? existing?.returnedQuantity ?? 0, 'Returned quantity');
  if (usedQuantity > issuedQuantity) {
    throw new HttpsError('invalid-argument', 'Used quantity cannot exceed standard/issued quantity');
  }

  const lowerLimit = optionalFiniteNumber(data.lowerLimit ?? existing?.lowerLimit);
  const upperLimit = optionalFiniteNumber(data.upperLimit ?? existing?.upperLimit);
  if (lowerLimit != null && upperLimit != null && lowerLimit >= upperLimit) {
    throw new HttpsError('invalid-argument', 'Upper limit must be greater than lower limit');
  }

  let observedResult: string | number | undefined;
  const observedRaw = data.observedResult ?? existing?.observedResult;
  if (observedRaw !== undefined && observedRaw !== null && observedRaw !== '') {
    if (typeof observedRaw === 'number' && Number.isFinite(observedRaw)) {
      observedResult = observedRaw;
    } else {
      const s = String(observedRaw).trim();
      const n = Number(s);
      observedResult = Number.isFinite(n) ? n : s;
    }
  }

  const batchNumber = requiredString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80);
  const materialCode = requiredString(data.materialCode ?? existing?.materialCode, 'Material code', 80);
  const arNumber = requiredString(data.arNumber ?? existing?.arNumber, 'AR number', 80);

  const artworkVerified = optionalString(
    data.artworkVerified ?? existing?.artworkVerified,
    'Artwork verified',
    40,
  );
  const barcodeVerified = optionalString(
    data.barcodeVerified ?? existing?.barcodeVerified,
    'Barcode verified',
    40,
  );
  const packagingIntegrity = optionalString(
    data.packagingIntegrity ?? existing?.packagingIntegrity,
    'Packaging integrity',
    40,
  );

  for (const [label, val] of [
    ['Artwork verified', artworkVerified],
    ['Barcode verified', barcodeVerified],
    ['Packaging integrity', packagingIntegrity],
  ] as const) {
    if (val && !YES_NO_NA.includes(val as typeof YES_NO_NA[number])) {
      throw new HttpsError('invalid-argument', `Invalid ${label}: ${val}`);
    }
  }

  const balanceQuantity = calculateBalance(issuedQuantity, usedQuantity, rejectedQuantity, returnedQuantity);
  const reconciliationStatus = evaluateReconciliation(issuedQuantity, usedQuantity, rejectedQuantity, returnedQuantity);

  return {
    recordType: 'packing_material_monitoring',
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    batchNumber,
    materialCode,
    materialName: requiredString(data.materialName ?? existing?.materialName, 'Material name', 200),
    materialType,
    materialCategory,
    manufacturerName: requiredString(
      data.manufacturerName ?? existing?.manufacturerName,
      'Manufacturer',
      200,
    ),
    supplierName: requiredString(data.supplierName ?? existing?.supplierName, 'Supplier', 200),
    vendorId: optionalString(data.vendorId ?? existing?.vendorId, 'Vendor id', 120),
    vendorName: requiredString(data.vendorName ?? existing?.vendorName, 'Vendor name', 200),
    vendorStatus: optionalString(data.vendorStatus ?? existing?.vendorStatus, 'Vendor status', 40) || 'Active',
    avlStatus: optionalString(data.avlStatus ?? existing?.avlStatus, 'AVL status', 40) || 'Approved',
    vendorCode: optionalString(data.vendorCode ?? existing?.vendorCode, 'Vendor code', 80),
    grnNumber: optionalString(data.grnNumber ?? existing?.grnNumber, 'GRN', 80),
    purchaseOrderNumber: optionalString(
      data.purchaseOrderNumber ?? existing?.purchaseOrderNumber,
      'PO number',
      80,
    ),
    arNumber,
    coaNumber: optionalString(data.coaNumber ?? existing?.coaNumber, 'COA number', 80),
    materialLotNumber: optionalString(
      data.materialLotNumber ?? existing?.materialLotNumber,
      'Lot number',
      80,
    ),
    supplierBatchNumber: optionalString(
      data.supplierBatchNumber ?? existing?.supplierBatchNumber,
      'Supplier batch',
      80,
    ),
    mfgDate,
    expDate,
    retestDate: optionalString(data.retestDate ?? existing?.retestDate, 'Retest date', 40),
    shelfLifeMonths: optionalString(data.shelfLifeMonths ?? existing?.shelfLifeMonths, 'Shelf life', 40),
    receivedQuantity: asNonNegNumber(
      data.receivedQuantity ?? existing?.receivedQuantity ?? 0,
      'Received quantity',
    ),
    acceptedQuantity: asNonNegNumber(
      data.acceptedQuantity ?? existing?.acceptedQuantity ?? 0,
      'Accepted quantity',
    ),
    rejectedQuantity,
    quarantineQuantity: asNonNegNumber(
      data.quarantineQuantity ?? existing?.quarantineQuantity ?? 0,
      'Quarantine quantity',
    ),
    returnedQuantity,
    issuedQuantity,
    usedQuantity,
    balanceQuantity,
    reconciliationStatus,
    unit: requiredString(data.unit ?? existing?.unit, 'Unit', 40),
    storageCondition: optionalString(
      data.storageCondition ?? existing?.storageCondition,
      'Storage condition',
      200,
    ),
    warehouseLocation: optionalString(
      data.warehouseLocation ?? existing?.warehouseLocation,
      'Warehouse location',
      120,
    ),
    storageArea: optionalString(data.storageArea ?? existing?.storageArea, 'Storage area', 120),
    site: optionalString(data.site ?? existing?.site, 'Site', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120) || 'Warehouse',
    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40),
    qcStatus,
    qaStatus: optionalString(data.qaStatus ?? existing?.qaStatus, 'QA status', 40),
    releaseStatus: optionalString(data.releaseStatus ?? existing?.releaseStatus, 'Release status', 40),
    samplingStatus: optionalString(data.samplingStatus ?? existing?.samplingStatus, 'Sampling status', 40),
    coaAvailable,
    specificationNumber: optionalString(
      data.specificationNumber ?? existing?.specificationNumber,
      'Specification',
      80,
    ),
    specificationVersion: optionalString(
      data.specificationVersion ?? existing?.specificationVersion,
      'Spec version',
      40,
    ),
    artworkVersion: optionalString(data.artworkVersion ?? existing?.artworkVersion, 'Artwork version', 80),
    barcode: optionalString(data.barcode ?? existing?.barcode, 'Barcode', 120),
    qrCode: optionalString(data.qrCode ?? existing?.qrCode, 'QR code', 120),
    rfid: optionalString(data.rfid ?? existing?.rfid, 'RFID', 120),
    artworkVerified,
    barcodeVerified,
    labelVerified: optionalString(data.labelVerified ?? existing?.labelVerified, 'Label verified', 40),
    packagingIntegrity,
    damageInspection: optionalString(
      data.damageInspection ?? existing?.damageInspection,
      'Damage inspection',
      40,
    ),
    printingVerified: optionalString(
      data.printingVerified ?? existing?.printingVerified,
      'Printing verified',
      40,
    ),
    dimensionCheck: optionalString(data.dimensionCheck ?? existing?.dimensionCheck, 'Dimension check', 40),
    sealIntegrity: optionalString(data.sealIntegrity ?? existing?.sealIntegrity, 'Seal integrity', 40),
    stpNumber: optionalString(data.stpNumber ?? existing?.stpNumber, 'STP', 80),
    testParameter: optionalString(data.testParameter ?? existing?.testParameter, 'Test parameter', 120),
    observedResult: observedResult ?? null,
    lowerLimit: lowerLimit ?? null,
    upperLimit: upperLimit ?? null,
    testUnit: optionalString(data.testUnit ?? existing?.testUnit, 'Test unit', 40),
    testResultSummary: optionalString(
      data.testResultSummary ?? existing?.testResultSummary,
      'Test summary',
      2000,
    ),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    reviewDate: optionalString(data.reviewDate ?? existing?.reviewDate, 'Review date', 40),
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    warehouseReceiptId: optionalString(
      data.warehouseReceiptId ?? existing?.warehouseReceiptId,
      'Warehouse receipt',
      120,
    ),
    packingMaterialMonitoringId: buildId(batchNumber, materialCode, arNumber),
    batchNo: batchNumber,
    vendor: requiredString(data.vendorName ?? existing?.vendorName, 'Vendor name', 200),
    grnNo: optionalString(data.grnNumber ?? existing?.grnNumber, 'GRN', 80),
    arNo: arNumber,
    testResult: optionalString(
      data.testResultSummary ?? existing?.testResultSummary,
      'Test summary',
      2000,
    ),
  };
}

function assertUsageAllowed(payload: ReturnType<typeof sanitizePayload>, qaOverride: boolean) {
  if (qaOverride) return;
  if (isExpired(payload.expDate)) {
    throw new HttpsError('failed-precondition', 'Material is expired — QA override required');
  }
  const avlOk = ['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(payload.avlStatus);
  if (!avlOk) {
    throw new HttpsError('failed-precondition', 'Vendor/AVL not approved — QA override required');
  }
}

export const createAdminPackingMaterialRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  if (qaOverride) {
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  }
  const cpvProductId = requiredString(data.cpvProductId, 'CPV product', 120);
  await assertOperationalProduct(firestore, cpvProductId);
  const payload = sanitizePayload(data);
  await assertCpvBatchForProduct(firestore, cpvProductId, payload.batchNumber);
  assertUsageAllowed(payload, qaOverride);
  if (await findDuplicate(firestore, payload.materialCode, payload.arNumber)) {
    throw new HttpsError('already-exists', 'Duplicate AR number for this material');
  }

  const complianceStatus = evaluateCompliance({
    vendorStatus: payload.vendorStatus,
    avlStatus: payload.avlStatus,
    qcStatus: payload.qcStatus,
    coaAvailable: payload.coaAvailable,
    expDate: payload.expDate,
    usedQuantity: payload.usedQuantity,
    issuedQuantity: payload.issuedQuantity,
    reconciliationStatus: payload.reconciliationStatus,
    artworkVerified: payload.artworkVerified,
    barcodeVerified: payload.barcodeVerified,
    packagingIntegrity: payload.packagingIntegrity,
    testParameter: payload.testParameter,
    observedResult: payload.observedResult ?? undefined,
    lowerLimit: payload.lowerLimit ?? undefined,
    upperLimit: payload.upperLimit ?? undefined,
  });
  const issueCount = await countIssues(firestore, payload.materialCode, payload.batchNumber);
  const riskLevel = evaluateRisk({
    expDate: payload.expDate,
    avlStatus: payload.avlStatus,
    qcStatus: payload.qcStatus,
    coaAvailable: payload.coaAvailable,
    reconciliationStatus: payload.reconciliationStatus,
    materialCategory: payload.materialCategory,
    complianceStatus,
    artworkVerified: payload.artworkVerified,
    barcodeVerified: payload.barcodeVerified,
  }, issueCount);

  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const deviationRequired = payload.qcStatus === 'Rejected' || payload.reconciliationStatus === 'Mismatch'
    || ['No', 'Fail'].includes(payload.artworkVerified) || ['No', 'Fail'].includes(payload.barcodeVerified);
  const record = {
    ...payload,
    id: ref.id,
    complianceStatus,
    status: complianceStatus,
    riskLevel,
    capaRequired: issueCount >= 3,
    deviationRequired,
    oosRequired: complianceStatus === 'OOS',
    linkedDeviationNumber: '',
    linkedOosNumber: '',
    linkedCapaNumber: '',
    reviewStatus: 'Draft' as const,
    isLocked: false,
    attachments,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdByName: actorName,
    updatedByName: actorName,
    isDeleted: false,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.set(ref, record);
  writePmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.packingMaterialMonitoringId,
    actionType: 'Packing Material Registered',
    description: `Registered ${payload.materialName} AR ${payload.arNumber} → ${complianceStatus}`,
    newValue: {
      complianceStatus,
      riskLevel,
      reconciliationStatus: payload.reconciliationStatus,
      balanceQuantity: payload.balanceQuantity,
    },
    reason,
    now,
    esign: qaOverride,
  });

  if (complianceStatus === 'OOS') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'OOS Detected',
      title: 'Packing Material OOS',
      message: `${payload.materialName} on batch ${payload.batchNumber}: OOS`,
      now,
    });
  } else if (complianceStatus === 'OOT') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'OOT Detected',
      title: 'Packing Material OOT',
      message: `${payload.materialName} on batch ${payload.batchNumber}: OOT`,
      now,
    });
  }
  if (['No', 'Fail'].includes(payload.artworkVerified)) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Artwork Mismatch',
      title: 'Artwork Verification Failed',
      message: `Artwork mismatch for ${payload.materialName} AR ${payload.arNumber}`,
      now,
    });
  }
  if (['No', 'Fail'].includes(payload.barcodeVerified)) {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Barcode Mismatch',
      title: 'Barcode Verification Failed',
      message: `Barcode mismatch for ${payload.materialName} AR ${payload.arNumber}`,
      now,
    });
  }
  if (payload.qcStatus === 'Rejected') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Material Rejected',
      title: 'Packing Material Rejected',
      message: `${payload.materialName} AR ${payload.arNumber} rejected`,
      now,
    });
  }
  if (payload.coaAvailable !== 'Yes') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'COA Missing',
      title: 'COA Missing',
      message: `COA not available for ${payload.materialName} AR ${payload.arNumber}`,
      now,
    });
  }
  await batch.commit();
  return record;
});

export const updateAdminPackingMaterialRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Packing material record not found');
  }
  const existing = snap.data() || {};

  if (existing.isLocked === true && existing.reviewStatus === 'Approved') {
    if (!qaOverride) {
      throw new HttpsError('failed-precondition', 'Approved record is locked. QA override required.');
    }
    assertReviewer(actor, actorRole);
    if (data.esignConfirmed !== true) {
      throw new HttpsError('failed-precondition', 'Electronic signature required for QA override');
    }
  } else {
    assertEnter(actor, actorRole);
    if (data.qcStatus !== undefined && String(data.qcStatus) !== String(existing.qcStatus || '')) {
      assertQc(actor, actorRole);
    }
  }

  const payload = sanitizePayload(data, existing);
  assertUsageAllowed(payload, qaOverride);
  if (await findDuplicate(firestore, payload.materialCode, payload.arNumber, id)) {
    throw new HttpsError('already-exists', 'Duplicate AR number for this material');
  }

  const complianceStatus = evaluateCompliance({
    vendorStatus: payload.vendorStatus,
    avlStatus: payload.avlStatus,
    qcStatus: payload.qcStatus,
    coaAvailable: payload.coaAvailable,
    expDate: payload.expDate,
    usedQuantity: payload.usedQuantity,
    issuedQuantity: payload.issuedQuantity,
    reconciliationStatus: payload.reconciliationStatus,
    artworkVerified: payload.artworkVerified,
    barcodeVerified: payload.barcodeVerified,
    packagingIntegrity: payload.packagingIntegrity,
    testParameter: payload.testParameter,
    observedResult: payload.observedResult ?? undefined,
    lowerLimit: payload.lowerLimit ?? undefined,
    upperLimit: payload.upperLimit ?? undefined,
  });
  const issueCount = await countIssues(firestore, payload.materialCode, payload.batchNumber);
  const riskLevel = evaluateRisk({
    expDate: payload.expDate,
    avlStatus: payload.avlStatus,
    qcStatus: payload.qcStatus,
    coaAvailable: payload.coaAvailable,
    reconciliationStatus: payload.reconciliationStatus,
    materialCategory: payload.materialCategory,
    complianceStatus,
    artworkVerified: payload.artworkVerified,
    barcodeVerified: payload.barcodeVerified,
  }, issueCount);

  const now = new Date().toISOString();
  const attachments = Array.isArray(data.attachments)
    ? data.attachments
    : (existing.attachments || []);
  const deviationRequired = payload.qcStatus === 'Rejected' || payload.reconciliationStatus === 'Mismatch'
    || ['No', 'Fail'].includes(payload.artworkVerified) || ['No', 'Fail'].includes(payload.barcodeVerified);
  const updates = {
    ...payload,
    complianceStatus,
    status: complianceStatus,
    riskLevel,
    capaRequired: issueCount >= 3,
    deviationRequired,
    oosRequired: complianceStatus === 'OOS',
    attachments,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writePmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.packingMaterialMonitoringId,
    actionType: qaOverride ? 'Packing Material QA Override' : 'Packing Material Updated',
    description: `Updated ${payload.materialName} → ${complianceStatus}`,
    oldValue: {
      complianceStatus: existing.complianceStatus,
      reconciliationStatus: existing.reconciliationStatus,
    },
    newValue: {
      complianceStatus,
      reconciliationStatus: payload.reconciliationStatus,
      balanceQuantity: payload.balanceQuantity,
    },
    reason,
    now,
    esign: qaOverride,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminPackingMaterialRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Packing material record not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Approved records cannot be reopened via review');
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Under Review',
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writePmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.packingMaterialMonitoringId || ''),
    actionType: 'Packing Material Review Submitted',
    description: 'Submitted for QA review',
    oldValue: existing.reviewStatus,
    newValue: 'Under Review',
    reason,
    now,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: id,
    eventName: 'Workflow Pending',
    title: 'Packing Material Review Pending',
    message: `${existing.materialName} (${existing.arNumber}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminPackingMaterialRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to approve');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Packing material record not found');
  }
  const existing = snap.data() || {};
  if (!['Draft', 'Under Review'].includes(String(existing.reviewStatus))) {
    throw new HttpsError('failed-precondition', `Cannot approve from status ${existing.reviewStatus}`);
  }
  const now = new Date().toISOString();
  const updates = {
    reviewStatus: 'Approved',
    isLocked: true,
    qaStatus: 'Approved',
    releaseStatus: String(existing.qcStatus) === 'Approved' ? 'Released' : String(existing.releaseStatus || 'Pending'),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writePmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.packingMaterialMonitoringId || ''),
    actionType: 'Packing Material Approved',
    description: `Approved and locked ${existing.packingMaterialMonitoringId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminPackingMaterialRecords = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk packing material entry');
  const rows = Array.isArray(data.rows) ? data.rows as Record<string, unknown>[] : [];
  if (!rows.length) throw new HttpsError('invalid-argument', 'No rows provided');
  if (rows.length > 100) throw new HttpsError('invalid-argument', 'Bulk limited to 100 rows');

  let created = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    try {
      const cpvProductId = requiredString(row.cpvProductId, 'CPV product', 120);
      await assertOperationalProduct(firestore, cpvProductId);
      const payload = sanitizePayload(row);
      await assertCpvBatchForProduct(firestore, cpvProductId, payload.batchNumber);
      assertUsageAllowed(payload, false);
      if (await findDuplicate(firestore, payload.materialCode, payload.arNumber)) {
        errors.push(`${payload.materialName}: duplicate AR`);
        continue;
      }
      const complianceStatus = evaluateCompliance({
        vendorStatus: payload.vendorStatus,
        avlStatus: payload.avlStatus,
        qcStatus: payload.qcStatus,
        coaAvailable: payload.coaAvailable,
        expDate: payload.expDate,
        usedQuantity: payload.usedQuantity,
        issuedQuantity: payload.issuedQuantity,
        reconciliationStatus: payload.reconciliationStatus,
        artworkVerified: payload.artworkVerified,
        barcodeVerified: payload.barcodeVerified,
        packagingIntegrity: payload.packagingIntegrity,
        testParameter: payload.testParameter,
        observedResult: payload.observedResult ?? undefined,
        lowerLimit: payload.lowerLimit ?? undefined,
        upperLimit: payload.upperLimit ?? undefined,
      });
      const issueCount = await countIssues(firestore, payload.materialCode, payload.batchNumber);
      const riskLevel = evaluateRisk({
        expDate: payload.expDate,
        avlStatus: payload.avlStatus,
        qcStatus: payload.qcStatus,
        coaAvailable: payload.coaAvailable,
        reconciliationStatus: payload.reconciliationStatus,
        materialCategory: payload.materialCategory,
        complianceStatus,
        artworkVerified: payload.artworkVerified,
        barcodeVerified: payload.barcodeVerified,
      }, issueCount);
      const ref = firestore.collection(COLLECTION).doc();
      const deviationRequired = payload.qcStatus === 'Rejected' || payload.reconciliationStatus === 'Mismatch';
      const record = {
        ...payload,
        id: ref.id,
        complianceStatus,
        status: complianceStatus,
        riskLevel,
        capaRequired: issueCount >= 3,
        deviationRequired,
        oosRequired: complianceStatus === 'OOS',
        linkedDeviationNumber: '',
        linkedOosNumber: '',
        linkedCapaNumber: '',
        reviewStatus: 'Draft' as const,
        isLocked: false,
        attachments: [],
        createdAt: now,
        updatedAt: now,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdByName: actorName,
        updatedByName: actorName,
        isDeleted: false,
        changeReason: reason,
      };
      const batch = firestore.batch();
      batch.set(ref, record);
      writePmAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.packingMaterialMonitoringId,
        actionType: 'Packing Material Registered',
        description: `Bulk registered ${payload.materialName}`,
        newValue: { complianceStatus },
        reason,
        now,
      });
      await batch.commit();
      created += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Unknown bulk error');
    }
  }

  if (created > 0) {
    const batch = firestore.batch();
    writePmAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: 'bulk',
      actionType: 'Packing Material Bulk Entry',
      description: `Bulk created ${created} packing material records`,
      newValue: { created, errors: errors.length },
      reason,
      now,
    });
    await batch.commit();
  }

  return { created, errors };
});

export const softDeleteAdminPackingMaterialRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to archive');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Packing material record not found');
  }
  const existing = snap.data() || {};
  if (existing.reviewStatus === 'Approved') {
    throw new HttpsError('failed-precondition', 'Cannot delete approved records. Use QA override to amend.');
  }
  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    deletedAt: now,
    deletedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writePmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.packingMaterialMonitoringId || ''),
    actionType: 'Packing Material Archived',
    description: `Soft-deleted ${existing.packingMaterialMonitoringId}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminPackingMaterialExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const batch = firestore.batch();
  writePmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Packing Material Export',
    description: `Exported ${count} records (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
