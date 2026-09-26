/**
 * CPV Raw Material Monitoring — privileged Cloud Functions.
 * CF-only writes, review/approve with e-sign, dual audit, compliance evaluation.
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

const COLLECTION = 'raw_material_monitoring';
const MODULE = 'Raw Material Monitoring';

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
  'API', 'Excipient', 'Preservative', 'Solvent', 'Buffer',
  'pH Adjuster', 'Vehicle', 'Raw Material', 'Other',
] as const;
const QC_STATUSES = ['Approved', 'Rejected', 'Under Test', 'Quarantine', 'Retest Required'] as const;
const COA_OPTIONS = ['Yes', 'No'] as const;

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Raw Material Monitoring view access required');
  }
}

function assertEnter(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ENTER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Raw Material Monitoring entry access required');
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
  return `RM-${batchNumber}-${materialCode}-${arNumber}`.replace(/\s+/g, '-').toUpperCase();
}

function isExpired(expDate: string): boolean {
  const exp = toComparableDate(expDate);
  if (!exp) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return exp < today;
}

function isRetestOverdue(retestDate: string): boolean {
  if (!retestDate) return false;
  const rt = toComparableDate(retestDate);
  if (!rt) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return rt < today;
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
  retestDate?: string;
  usedQuantity: number;
  issuedQuantity: number;
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
  const retestOk = !isRetestOverdue(input.retestDate || '');
  const qtyOk = input.issuedQuantity === 0 || input.usedQuantity <= input.issuedQuantity;
  const testStatus = input.testParameter
    ? evaluateTestStatus(input.observedResult, input.lowerLimit, input.upperLimit)
    : null;

  if (!vendorOk || !avlOk || !qcOk || !coaOk || !notExpired || !retestOk || !qtyOk) {
    return 'Does Not Comply';
  }
  if (testStatus === 'OOS') return 'OOS';
  if (testStatus === 'OOT' || testStatus === 'Alert') return 'OOT';
  if (testStatus === 'Does Not Comply') return 'Does Not Comply';
  return 'Complies';
}

function evaluateRisk(
  input: {
    expDate: string;
    retestDate?: string;
    avlStatus: string;
    qcStatus: string;
    coaAvailable: string;
    usedQuantity: number;
    issuedQuantity: number;
    complianceStatus: string;
  },
  issueCount: number,
): string {
  if (isExpired(input.expDate)) return 'Critical';
  if (input.qcStatus === 'Rejected') return 'Critical';
  if (issueCount >= 3) return 'High';
  if (!['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(input.avlStatus)) return 'High';
  if (input.coaAvailable !== 'Yes') return 'Medium';
  if (input.issuedQuantity > 0 && input.usedQuantity > input.issuedQuantity) return 'Medium';
  if (isRetestOverdue(input.retestDate || '')) return 'High';
  if (input.complianceStatus === 'OOS') return 'High';
  if (['OOT', 'Alert', 'Action'].includes(input.complianceStatus)) return 'Medium';
  return 'Low';
}

function writeRmAudit(
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
    auditId: `AUD-RM-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-raw-material-admin',
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
    type: 'cpv_raw_material',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: `/cpv/raw-material-monitoring/${input.recordId}`,
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
  const materialType = optionalString(data.materialType ?? existing?.materialType, 'Material type', 40) || 'API';
  if (!MATERIAL_TYPES.includes(materialType as typeof MATERIAL_TYPES[number])) {
    throw new HttpsError('invalid-argument', `Invalid material type: ${materialType}`);
  }
  const qcStatus = optionalString(data.qcStatus ?? existing?.qcStatus, 'QC status', 40) || 'Under Test';
  if (!QC_STATUSES.includes(qcStatus as typeof QC_STATUSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid QC status: ${qcStatus}`);
  }
  const coaAvailable = optionalString(data.coaAvailable ?? existing?.coaAvailable, 'COA', 10) || 'No';
  if (!COA_OPTIONS.includes(coaAvailable as typeof COA_OPTIONS[number])) {
    throw new HttpsError('invalid-argument', `Invalid COA option: ${coaAvailable}`);
  }

  const mfgDate = optionalString(data.mfgDate ?? existing?.mfgDate, 'MFG date', 40);
  const expDate = optionalString(data.expDate ?? existing?.expDate, 'EXP date', 40);
  if (mfgDate && expDate) {
    const mfg = toComparableDate(mfgDate);
    const exp = toComparableDate(expDate);
    if (!mfg || !exp || !(exp > mfg)) {
      throw new HttpsError('invalid-argument', 'EXP date must be after MFG date');
    }
  }

  const usedQuantity = asNonNegNumber(data.usedQuantity ?? existing?.usedQuantity ?? 0, 'Used quantity');
  const issuedQuantity = asNonNegNumber(data.issuedQuantity ?? existing?.issuedQuantity ?? 0, 'Issued quantity');
  if (issuedQuantity > 0 && usedQuantity > issuedQuantity) {
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

  return {
    recordType: 'raw_material_monitoring',
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    batchNumber,
    materialCode,
    materialName: requiredString(data.materialName ?? existing?.materialName, 'Material name', 200),
    materialType,
    materialGrade: optionalString(data.materialGrade ?? existing?.materialGrade, 'Grade', 80),
    materialCategory: optionalString(
      data.materialCategory ?? existing?.materialCategory ?? materialType,
      'Category',
      80,
    ),
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
    pharmacopoeiaStandard: optionalString(
      data.pharmacopoeiaStandard ?? existing?.pharmacopoeiaStandard,
      'Pharmacopoeia',
      80,
    ),
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
    rejectedQuantity: asNonNegNumber(
      data.rejectedQuantity ?? existing?.rejectedQuantity ?? 0,
      'Rejected quantity',
    ),
    quarantineQuantity: asNonNegNumber(
      data.quarantineQuantity ?? existing?.quarantineQuantity ?? 0,
      'Quarantine quantity',
    ),
    issuedQuantity,
    usedQuantity,
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
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    warehouseReceiptId: optionalString(
      data.warehouseReceiptId ?? existing?.warehouseReceiptId,
      'Warehouse receipt',
      120,
    ),
    rawMaterialMonitoringId: buildId(batchNumber, materialCode, arNumber),
    batchNo: batchNumber,
    apiName: requiredString(data.materialName ?? existing?.materialName, 'Material name', 200),
    vendor: requiredString(data.vendorName ?? existing?.vendorName, 'Vendor name', 200),
    grnNo: optionalString(data.grnNumber ?? existing?.grnNumber, 'GRN', 80),
    arNo: arNumber,
    assay: observedResult ?? null,
    lsl: lowerLimit ?? null,
    usl: upperLimit ?? null,
  };
}

function assertUsageAllowed(payload: ReturnType<typeof sanitizePayload>, qaOverride: boolean) {
  if (qaOverride) return;
  if (isExpired(payload.expDate)) {
    throw new HttpsError('failed-precondition', 'Material is expired — QA override required');
  }
  if (isRetestOverdue(payload.retestDate)) {
    throw new HttpsError('failed-precondition', 'Retest date overdue — QA override required');
  }
  const avlOk = ['Approved', 'Conditional Approved', 'Conditionally Approved'].includes(payload.avlStatus);
  if (!avlOk) {
    throw new HttpsError('failed-precondition', 'Vendor/AVL not approved — QA override required');
  }
}

export const createAdminRawMaterialRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
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
    retestDate: payload.retestDate,
    usedQuantity: payload.usedQuantity,
    issuedQuantity: payload.issuedQuantity,
    testParameter: payload.testParameter,
    observedResult: payload.observedResult ?? undefined,
    lowerLimit: payload.lowerLimit ?? undefined,
    upperLimit: payload.upperLimit ?? undefined,
  });
  const issueCount = await countIssues(firestore, payload.materialCode, payload.batchNumber);
  const riskLevel = evaluateRisk({
    expDate: payload.expDate,
    retestDate: payload.retestDate,
    avlStatus: payload.avlStatus,
    qcStatus: payload.qcStatus,
    coaAvailable: payload.coaAvailable,
    usedQuantity: payload.usedQuantity,
    issuedQuantity: payload.issuedQuantity,
    complianceStatus,
  }, issueCount);

  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const attachments = Array.isArray(data.attachments) ? data.attachments : [];
  const record = {
    ...payload,
    id: ref.id,
    complianceStatus,
    status: complianceStatus,
    riskLevel,
    capaRequired: issueCount >= 3,
    deviationRequired: payload.qcStatus === 'Rejected',
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
  writeRmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.rawMaterialMonitoringId,
    actionType: 'Raw Material Registered',
    description: `Registered ${payload.materialName} AR ${payload.arNumber} → ${complianceStatus}`,
    newValue: { complianceStatus, riskLevel, qcStatus: payload.qcStatus },
    reason,
    now,
    esign: qaOverride,
  });
  if (complianceStatus === 'OOS') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'OOS Detected',
      title: 'Raw Material OOS',
      message: `${payload.materialName} on batch ${payload.batchNumber}: OOS`,
      now,
    });
  } else if (complianceStatus === 'OOT') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'OOT Detected',
      title: 'Raw Material OOT',
      message: `${payload.materialName} on batch ${payload.batchNumber}: OOT`,
      now,
    });
  } else if (payload.qcStatus === 'Rejected') {
    notify(firestore, batch, {
      targetUid: actorUid,
      recordId: ref.id,
      eventName: 'Material Rejected',
      title: 'Raw Material Rejected',
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

export const updateAdminRawMaterialRecord = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const qaOverride = data.qaOverride === true;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Raw material record not found');
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
    retestDate: payload.retestDate,
    usedQuantity: payload.usedQuantity,
    issuedQuantity: payload.issuedQuantity,
    testParameter: payload.testParameter,
    observedResult: payload.observedResult ?? undefined,
    lowerLimit: payload.lowerLimit ?? undefined,
    upperLimit: payload.upperLimit ?? undefined,
  });
  const issueCount = await countIssues(firestore, payload.materialCode, payload.batchNumber);
  const riskLevel = evaluateRisk({
    expDate: payload.expDate,
    retestDate: payload.retestDate,
    avlStatus: payload.avlStatus,
    qcStatus: payload.qcStatus,
    coaAvailable: payload.coaAvailable,
    usedQuantity: payload.usedQuantity,
    issuedQuantity: payload.issuedQuantity,
    complianceStatus,
  }, issueCount);

  const now = new Date().toISOString();
  const attachments = Array.isArray(data.attachments)
    ? data.attachments
    : (existing.attachments || []);
  const updates = {
    ...payload,
    complianceStatus,
    status: complianceStatus,
    riskLevel,
    capaRequired: issueCount >= 3,
    deviationRequired: payload.qcStatus === 'Rejected',
    oosRequired: complianceStatus === 'OOS',
    attachments,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeRmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.rawMaterialMonitoringId,
    actionType: qaOverride ? 'Raw Material QA Override' : 'Raw Material Updated',
    description: `Updated ${payload.materialName} → ${complianceStatus}`,
    oldValue: { complianceStatus: existing.complianceStatus, qcStatus: existing.qcStatus },
    newValue: { complianceStatus, qcStatus: payload.qcStatus },
    reason,
    now,
    esign: qaOverride,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const reviewAdminRawMaterialRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReviewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason || 'Submitted for QA review');
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Raw material record not found');
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
  writeRmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.rawMaterialMonitoringId || ''),
    actionType: 'Raw Material Review Submitted',
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
    title: 'Raw Material Review Pending',
    message: `${existing.materialName} (${existing.arNumber}) awaiting approval`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const approveAdminRawMaterialRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Raw material record not found');
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
  writeRmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.rawMaterialMonitoringId || ''),
    actionType: 'Raw Material Approved',
    description: `Approved and locked ${existing.rawMaterialMonitoringId}`,
    oldValue: existing.reviewStatus,
    newValue: 'Approved',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const bulkCreateAdminRawMaterialRecords = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEnter(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason || 'Bulk raw material entry');
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
        retestDate: payload.retestDate,
        usedQuantity: payload.usedQuantity,
        issuedQuantity: payload.issuedQuantity,
        testParameter: payload.testParameter,
        observedResult: payload.observedResult ?? undefined,
        lowerLimit: payload.lowerLimit ?? undefined,
        upperLimit: payload.upperLimit ?? undefined,
      });
      const issueCount = await countIssues(firestore, payload.materialCode, payload.batchNumber);
      const riskLevel = evaluateRisk({
        expDate: payload.expDate,
        retestDate: payload.retestDate,
        avlStatus: payload.avlStatus,
        qcStatus: payload.qcStatus,
        coaAvailable: payload.coaAvailable,
        usedQuantity: payload.usedQuantity,
        issuedQuantity: payload.issuedQuantity,
        complianceStatus,
      }, issueCount);
      const ref = firestore.collection(COLLECTION).doc();
      const record = {
        ...payload,
        id: ref.id,
        complianceStatus,
        status: complianceStatus,
        riskLevel,
        capaRequired: issueCount >= 3,
        deviationRequired: payload.qcStatus === 'Rejected',
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
      writeRmAudit(batch, firestore, {
        actorUid,
        actorName,
        recordId: ref.id,
        documentNumber: payload.rawMaterialMonitoringId,
        actionType: 'Raw Material Registered',
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
    writeRmAudit(batch, firestore, {
      actorUid,
      actorName,
      recordId: 'bulk',
      actionType: 'Raw Material Bulk Entry',
      description: `Bulk created ${created} raw material records`,
      newValue: { created, errors: errors.length },
      reason,
      now,
    });
    await batch.commit();
  }

  return { created, errors };
});

export const softDeleteAdminRawMaterialRecord = onCall(async (request) => {
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
    throw new HttpsError('not-found', 'Raw material record not found');
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
  writeRmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.rawMaterialMonitoringId || ''),
    actionType: 'Raw Material Archived',
    description: `Soft-deleted ${existing.rawMaterialMonitoringId}`,
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminRawMaterialExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const batch = firestore.batch();
  writeRmAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Raw Material Export',
    description: `Exported ${count} records (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
