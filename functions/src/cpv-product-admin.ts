/**
 * CPV Product Master — privileged Cloud Functions.
 * CF-only writes, dual audit, change reason, e-sign gate for critical status changes.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';

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

const COLLECTION = 'cpv_products';
const MODULE = 'CPV Product Master';

const EDITOR_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const ACTIVATOR_ROLES = ['super_admin', 'admin'];
const VIEWER_ROLES = [
  ...EDITOR_ROLES,
  'qc', 'qc_manager', 'production', 'production_manager',
  'auditor', 'viewer',
];

const CPV_STATUSES = [
  'Draft', 'Under Review', 'Approved', 'Active', 'Inactive', 'Obsolete', 'Archived', 'Discontinued',
] as const;

const REVIEW_FREQUENCIES = ['Monthly', 'Quarterly', 'Half Yearly', 'Yearly'] as const;

const CRITICAL_STATUS_ACTIONS = new Set([
  'Active', 'Inactive', 'Obsolete', 'Archived', 'Approved',
]);

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Product Master view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Product Master edit access required');
  }
}

function assertActivator(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ACTIVATOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Product activation access required');
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

function buildCpvProductId(productCode: string): string {
  return `CPV-${productCode.toUpperCase().replace(/\s+/g, '-')}`;
}

function computeNextReviewDueDate(startDate: string, frequency: string): string {
  const d = new Date(startDate);
  if (Number.isNaN(d.getTime())) return '';
  const months =
    frequency === 'Monthly' ? 1
      : frequency === 'Quarterly' ? 3
        : frequency === 'Half Yearly' ? 6
          : 12;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().split('T')[0];
}

function writeCpvProductAudit(
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
    auditId: `AUD-CPVP-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-product-admin',
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
  if (!input.targetUid) return;
  batch.set(firestore.collection('notifications').doc(), {
    notificationId: `NTF-CPVP-${Date.now().toString(36).toUpperCase()}`,
    userId: input.targetUid,
    recipientUserId: input.targetUid,
    title: input.title,
    message: input.message,
    type: 'info',
    moduleName: MODULE,
    eventName: input.eventName,
    recordId: input.recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/cpv/product-master/${input.recordId}`,
    createdAt: input.now,
  });
}

async function findDuplicateCode(
  firestore: Firestore,
  productCode: string,
  excludeId?: string,
): Promise<boolean> {
  const snap = await firestore.collection(COLLECTION)
    .where('productCode', '==', productCode)
    .limit(25)
    .get();
  return snap.docs.some((d) => {
    if (excludeId && d.id === excludeId) return false;
    const data = d.data();
    if (data.isDeleted === true) return false;
    const status = String(data.cpvStatus || '');
    return ['Active', 'Under Review', 'Approved', 'Draft'].includes(status);
  });
}

async function countLinkedBatches(firestore: Firestore, productCode: string, productName: string): Promise<number> {
  let count = 0;
  for (const col of ['batches', 'cpv_batches']) {
    try {
      const byCode = await firestore.collection(col).where('productCode', '==', productCode).limit(1).get();
      if (!byCode.empty) count += byCode.size;
      else {
        const byName = await firestore.collection(col).where('productName', '==', productName).limit(1).get();
        if (!byName.empty) count += byName.size;
      }
    } catch {
      // missing index / field — ignore for delete guard soft-fail open
    }
  }
  return count;
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const productCode = requiredString(data.productCode ?? existing?.productCode, 'Product code', 80);
  const productName = requiredString(data.productName ?? existing?.productName, 'Product name', 200);
  const cpvStatusRaw = optionalString(data.cpvStatus ?? existing?.cpvStatus, 'Status', 40) || 'Draft';
  if (!CPV_STATUSES.includes(cpvStatusRaw as typeof CPV_STATUSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid CPV status: ${cpvStatusRaw}`);
  }
  const frequency = optionalString(
    data.cpvReviewFrequency ?? existing?.cpvReviewFrequency,
    'Review frequency',
    40,
  ) || 'Yearly';
  if (!REVIEW_FREQUENCIES.includes(frequency as typeof REVIEW_FREQUENCIES[number])) {
    throw new HttpsError('invalid-argument', `Invalid review frequency: ${frequency}`);
  }
  const cpvStartDate = requiredString(
    data.cpvStartDate ?? existing?.cpvStartDate,
    'CPV start date',
    40,
  );
  const cpvOwner = requiredString(data.cpvOwner ?? existing?.cpvOwner, 'CPV owner', 120);

  const stringIds = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 200) : [];

  return {
    recordType: 'cpv_product_master',
    adminProductId: optionalString(data.adminProductId ?? existing?.adminProductId, 'Admin product', 120),
    productCode,
    productName,
    genericName: optionalString(data.genericName ?? existing?.genericName, 'Generic name', 200),
    brandName: optionalString(data.brandName ?? existing?.brandName, 'Brand name', 200),
    productCategory: optionalString(data.productCategory ?? existing?.productCategory, 'Category', 120),
    productFamily: optionalString(data.productFamily ?? existing?.productFamily, 'Family', 120),
    strength: requiredString(data.strength ?? existing?.strength, 'Strength', 80),
    dosageForm: requiredString(data.dosageForm ?? existing?.dosageForm, 'Dosage form', 80),
    routeOfAdministration: optionalString(
      data.routeOfAdministration ?? existing?.routeOfAdministration,
      'Route',
      80,
    ),
    packSize: optionalString(data.packSize ?? existing?.packSize, 'Pack size', 80),
    packType: optionalString(data.packType ?? existing?.packType, 'Pack type', 80),
    market: optionalString(data.market ?? existing?.market, 'Market', 80),
    manufacturingSite: optionalString(
      data.manufacturingSite ?? existing?.manufacturingSite,
      'Manufacturing site',
      120,
    ),
    businessUnit: optionalString(data.businessUnit ?? existing?.businessUnit, 'Business unit', 120),
    department: optionalString(data.department ?? existing?.department, 'Department', 120),
    productOwner: optionalString(data.productOwner ?? existing?.productOwner, 'Product owner', 120),
    lifecycleStatus: optionalString(
      data.lifecycleStatus ?? existing?.lifecycleStatus,
      'Lifecycle',
      80,
    ),
    developmentStage: optionalString(
      data.developmentStage ?? existing?.developmentStage,
      'Development stage',
      80,
    ),
    validationStatus: optionalString(
      data.validationStatus ?? existing?.validationStatus,
      'Validation status',
      80,
    ),
    marketStatus: optionalString(data.marketStatus ?? existing?.marketStatus, 'Market status', 80),
    version: optionalString(data.version ?? existing?.version, 'Version', 40) || '1.0',
    revision: optionalString(data.revision ?? existing?.revision, 'Revision', 40) || '00',
    effectiveDate: optionalString(data.effectiveDate ?? existing?.effectiveDate, 'Effective date', 40),
    reviewDate: optionalString(data.reviewDate ?? existing?.reviewDate, 'Review date', 40),
    expiryDate: optionalString(data.expiryDate ?? existing?.expiryDate, 'Expiry date', 40),
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    manufacturingProcess: optionalString(
      data.manufacturingProcess ?? existing?.manufacturingProcess,
      'Manufacturing process',
      500,
    ),
    productionLine: optionalString(data.productionLine ?? existing?.productionLine, 'Production line', 120),
    manufacturingArea: optionalString(
      data.manufacturingArea ?? existing?.manufacturingArea,
      'Manufacturing area',
      120,
    ),
    packagingProcess: optionalString(
      data.packagingProcess ?? existing?.packagingProcess,
      'Packaging process',
      500,
    ),
    shelfLife: optionalString(data.shelfLife ?? existing?.shelfLife, 'Shelf life', 80),
    storageCondition: optionalString(
      data.storageCondition ?? existing?.storageCondition,
      'Storage',
      200,
    ),
    standardBatchSize: optionalString(
      data.standardBatchSize ?? existing?.standardBatchSize,
      'Batch size',
      80,
    ),
    manufacturingLicenseNumber: optionalString(
      data.manufacturingLicenseNumber ?? existing?.manufacturingLicenseNumber,
      'License',
      120,
    ),
    mfrNumber: optionalString(data.mfrNumber ?? existing?.mfrNumber, 'MFR', 80),
    bmrNumber: optionalString(data.bmrNumber ?? existing?.bmrNumber, 'BMR', 80),
    bprNumber: optionalString(data.bprNumber ?? existing?.bprNumber, 'BPR', 80),
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
    upperSpecificationLimit: optionalString(
      data.upperSpecificationLimit ?? existing?.upperSpecificationLimit,
      'USL',
      80,
    ),
    lowerSpecificationLimit: optionalString(
      data.lowerSpecificationLimit ?? existing?.lowerSpecificationLimit,
      'LSL',
      80,
    ),
    targetValue: optionalString(data.targetValue ?? existing?.targetValue, 'Target', 80),
    samplingPlan: optionalString(data.samplingPlan ?? existing?.samplingPlan, 'Sampling plan', 500),
    testingFrequency: optionalString(
      data.testingFrequency ?? existing?.testingFrequency,
      'Testing frequency',
      120,
    ),
    cpvStatus: cpvStatusRaw,
    status: cpvStatusRaw,
    cpvStartDate,
    cpvReviewFrequency: frequency,
    cpvOwner,
    qaReviewer: optionalString(data.qaReviewer ?? existing?.qaReviewer, 'QA reviewer', 120),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    linkedCppParameterIds: stringIds(
      data.linkedCppParameterIds ?? existing?.linkedCppParameterIds,
    ),
    linkedCqaParameterIds: stringIds(
      data.linkedCqaParameterIds ?? existing?.linkedCqaParameterIds,
    ),
    nextReviewDueDate: computeNextReviewDueDate(cpvStartDate, frequency),
    cpvProductId: buildCpvProductId(productCode),
  };
}

export const createAdminCpvProduct = onCall({ timeoutSeconds: 60, cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const payload = sanitizePayload(data);
  if (await findDuplicateCode(firestore, payload.productCode)) {
    throw new HttpsError('already-exists', 'An active CPV product with this code already exists');
  }
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...payload,
    id: ref.id,
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
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.cpvProductId,
    actionType: 'Product Created',
    description: `Created CPV product ${payload.productCode}`,
    newValue: { productCode: payload.productCode, cpvStatus: payload.cpvStatus },
    reason,
    now,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: ref.id,
    eventName: 'Product Created',
    title: 'CPV Product Created',
    message: `${payload.productName} (${payload.productCode}) added to CPV Product Master`,
    now,
  });
  await batch.commit();
  return record;
});

export const updateAdminCpvProduct = onCall({ timeoutSeconds: 60, cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Product id', 120);
  const reason = requiredReason(data.changeReason);
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV product not found');
  }
  const existing = snap.data() || {};
  const payload = sanitizePayload(data, existing);
  if (await findDuplicateCode(firestore, payload.productCode, id)) {
    throw new HttpsError('already-exists', 'An active CPV product with this code already exists');
  }
  // Preserve linked arrays unless explicitly provided
  if (!Array.isArray(data.linkedCppParameterIds)) {
    payload.linkedCppParameterIds = Array.isArray(existing.linkedCppParameterIds)
      ? existing.linkedCppParameterIds.map(String)
      : [];
  }
  if (!Array.isArray(data.linkedCqaParameterIds)) {
    payload.linkedCqaParameterIds = Array.isArray(existing.linkedCqaParameterIds)
      ? existing.linkedCqaParameterIds.map(String)
      : [];
  }
  const now = new Date().toISOString();
  const updates = {
    ...payload,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
    version: payload.version,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.cpvProductId,
    actionType: 'Product Updated',
    description: `Updated CPV product ${payload.productCode}`,
    oldValue: {
      productCode: existing.productCode,
      cpvStatus: existing.cpvStatus,
      version: existing.version,
    },
    newValue: {
      productCode: payload.productCode,
      cpvStatus: payload.cpvStatus,
      version: payload.version,
    },
    reason,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const setAdminCpvProductStatus = onCall({ timeoutSeconds: 60, cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Product id', 120);
  const cpvStatus = requiredString(data.cpvStatus, 'Status', 40);
  if (!CPV_STATUSES.includes(cpvStatus as typeof CPV_STATUSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid status: ${cpvStatus}`);
  }
  const reason = requiredReason(data.changeReason);
  const esignConfirmed = data.esignConfirmed === true;
  if (CRITICAL_STATUS_ACTIONS.has(cpvStatus) && !esignConfirmed) {
    throw new HttpsError(
      'failed-precondition',
      'Electronic signature confirmation required for this status change',
    );
  }
  if (['Active', 'Inactive', 'Obsolete', 'Archived', 'Approved'].includes(cpvStatus)) {
    assertActivator(actor, actorRole);
  } else {
    assertEditor(actor, actorRole);
  }

  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV product not found');
  }
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const updates = {
    cpvStatus,
    status: cpvStatus,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
    lastStatusChangeAt: now,
    lastStatusChangeBy: actorUid,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cpvProductId || ''),
    actionType: `Product ${cpvStatus}`,
    description: `Status changed from ${existing.cpvStatus} to ${cpvStatus}`,
    oldValue: existing.cpvStatus,
    newValue: cpvStatus,
    reason,
    now,
    esign: esignConfirmed,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: id,
    eventName: `Product ${cpvStatus}`,
    title: `CPV Product ${cpvStatus}`,
    message: `${existing.productName} status set to ${cpvStatus}`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const linkAdminCpvParameter = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Product id', 120);
  const parameterId = requiredString(data.parameterId, 'Parameter id', 120);
  const type = requiredString(data.type, 'Type', 10).toUpperCase();
  if (type !== 'CPP' && type !== 'CQA') {
    throw new HttpsError('invalid-argument', 'Type must be CPP or CQA');
  }
  const reason = optionalString(data.changeReason, 'Change reason', 500) || `Link ${type} parameter`;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV product not found');
  }
  const existing = snap.data() || {};
  const field = type === 'CPP' ? 'linkedCppParameterIds' : 'linkedCqaParameterIds';
  const current: string[] = Array.isArray(existing[field]) ? existing[field].map(String) : [];
  if (current.includes(parameterId)) {
    return { id, ...existing };
  }
  const next = [...current, parameterId];
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    [field]: next,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
  });
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cpvProductId || ''),
    actionType: `Link ${type}`,
    description: `Linked ${type} parameter ${parameterId}`,
    oldValue: current,
    newValue: next,
    reason,
    now,
  });
  await batch.commit();
  return { id, ...existing, [field]: next };
});

export const unlinkAdminCpvParameter = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Product id', 120);
  const parameterId = requiredString(data.parameterId, 'Parameter id', 120);
  const type = requiredString(data.type, 'Type', 10).toUpperCase();
  if (type !== 'CPP' && type !== 'CQA') {
    throw new HttpsError('invalid-argument', 'Type must be CPP or CQA');
  }
  const reason = optionalString(data.changeReason, 'Change reason', 500) || `Unlink ${type} parameter`;
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV product not found');
  }
  const existing = snap.data() || {};
  const field = type === 'CPP' ? 'linkedCppParameterIds' : 'linkedCqaParameterIds';
  const current: string[] = Array.isArray(existing[field]) ? existing[field].map(String) : [];
  const next = current.filter((x) => x !== parameterId);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    [field]: next,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
  });
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cpvProductId || ''),
    actionType: `Unlink ${type}`,
    description: `Unlinked ${type} parameter ${parameterId}`,
    oldValue: current,
    newValue: next,
    reason,
    now,
  });
  await batch.commit();
  return { id, ...existing, [field]: next };
});

export const importAdminCpvProduct = onCall({ timeoutSeconds: 60, cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const adminProductId = requiredString(data.adminProductId, 'Admin product id', 120);
  const reason = requiredReason(data.changeReason || 'Import from Admin Product Master');
  const adminSnap = await firestore.collection('products').doc(adminProductId).get();
  if (!adminSnap.exists || adminSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Admin product not found');
  }
  const admin = adminSnap.data() || {};
  const merged = {
    adminProductId,
    productCode: admin.productCode,
    productName: admin.productName,
    genericName: admin.genericName || '',
    brandName: admin.brandName || '',
    strength: admin.strength || 'N/A',
    dosageForm: admin.dosageForm || 'Other',
    routeOfAdministration: admin.routeOfAdministration || '',
    packSize: admin.packSize || '',
    market: admin.market || '',
    shelfLife: admin.shelfLife || '',
    storageCondition: admin.storageCondition || '',
    standardBatchSize: admin.standardBatchSize || admin.batchSize || '',
    manufacturingLicenseNumber: admin.manufacturingLicenseNumber || admin.manufacturingLicenseNo || '',
    mfrNumber: admin.mfrNumber || '',
    bmrNumber: admin.bmrNumber || '',
    bprNumber: admin.bprNumber || '',
    specificationNumber: admin.specificationNumber || '',
    stpNumber: admin.stpNumber || '',
    cpvStatus: optionalString(data.cpvStatus, 'Status', 40) || 'Draft',
    cpvStartDate: requiredString(data.cpvStartDate, 'CPV start date', 40),
    cpvReviewFrequency: optionalString(data.cpvReviewFrequency, 'Frequency', 40) || 'Yearly',
    cpvOwner: requiredString(data.cpvOwner, 'CPV owner', 120),
    qaReviewer: optionalString(data.qaReviewer, 'QA reviewer', 120),
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    manufacturingSite: admin.manufacturingSite || '',
    productCategory: admin.productCategory || admin.category || '',
    productFamily: admin.productFamily || admin.family || '',
  };
  const payload = sanitizePayload(merged);
  if (await findDuplicateCode(firestore, payload.productCode)) {
    throw new HttpsError('already-exists', 'An active CPV product with this code already exists');
  }
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const record = {
    ...payload,
    id: ref.id,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdByName: actorName,
    updatedByName: actorName,
    isDeleted: false,
    changeReason: reason,
    importedFromAdmin: true,
  };
  const batch = firestore.batch();
  batch.set(ref, record);
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.cpvProductId,
    actionType: 'Product Imported',
    description: `Imported ${payload.productCode} from Admin Product Master`,
    newValue: { adminProductId, productCode: payload.productCode },
    reason,
    now,
  });
  await batch.commit();
  return record;
});

export const softDeleteAdminCpvProduct = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertActivator(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Product id', 120);
  const reason = requiredReason(data.changeReason);
  const esignConfirmed = data.esignConfirmed === true;
  if (!esignConfirmed) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to archive/delete');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV product not found');
  }
  const existing = snap.data() || {};
  const linked = await countLinkedBatches(
    firestore,
    String(existing.productCode || ''),
    String(existing.productName || ''),
  );
  if (linked > 0) {
    throw new HttpsError(
      'failed-precondition',
      'Cannot delete product linked to batches. Set status to Obsolete or Inactive instead.',
    );
  }
  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    cpvStatus: 'Archived',
    status: 'Archived',
    deletedAt: now,
    deletedBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cpvProductId || ''),
    actionType: 'Product Archived',
    description: `Soft-deleted / archived CPV product ${existing.productCode}`,
    oldValue: existing.cpvStatus,
    newValue: 'Archived',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminCpvProductExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeCpvProductAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Product Export',
    description: `Exported ${count} CPV products (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
