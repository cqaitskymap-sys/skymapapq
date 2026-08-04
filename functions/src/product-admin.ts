/**
 * Product Master — privileged Cloud Functions.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore, type DocumentData, type WriteBatch } from 'firebase-admin/firestore';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

function requiredString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpsError('invalid-argument', `${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 200): string {
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

const PRODUCT_EDITOR_ROLES = ['super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive'];

function assertProductEditor(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !PRODUCT_EDITOR_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active product editor access required');
  }
}

function assertActiveAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !['super_admin', 'admin'].includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }
}

const PRODUCT_LIFECYCLE_STATUSES = [
  'Development', 'Technology Transfer', 'Validation', 'Commercial', 'Discontinued', 'Archived',
] as const;

const PRODUCT_STATUSES = ['Active', 'Inactive', 'Discontinued', 'Under Development'] as const;

const DOSAGE_FORMS = [
  'Injection', 'Tablet', 'Capsule', 'Syrup', 'Suspension', 'Ointment',
  'Cream', 'Gel', 'Drops', 'Powder', 'Other',
] as const;

const MARKET_OPTIONS = ['Domestic', 'Export', 'Both'] as const;

const INGREDIENT_TYPES = [
  'API', 'Excipient', 'Preservative', 'Solvent', 'Buffer', 'pH Adjuster', 'Vehicle', 'Other',
] as const;

const PACKING_MATERIAL_TYPES = [
  'Primary Packing', 'Secondary Packing', 'Tertiary Packing',
] as const;

const PRODUCT_ATTACHMENT_TYPES = ['specification', 'stp', 'other'] as const;

const PRODUCT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

function buildProductId(code: string): string {
  return `PROD-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function productNotification(
  targetUid: string,
  recordId: string,
  eventName: string,
  title: string,
  message: string,
  now: string,
) {
  return {
    notificationId: `NTF-${Date.now().toString(36).toUpperCase()}-${recordId.slice(0, 6)}`,
    userId: targetUid,
    recipientUserId: targetUid,
    title,
    message,
    type: 'info',
    moduleName: 'Product Master',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/products/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeProductAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    action: string;
    oldValue: unknown;
    newValue: unknown;
    reason: string;
    now: string;
  },
) {
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'Product Master',
    recordId: input.recordId,
    action: input.action,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason,
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  batch.set(firestore.collection('audit_trail').doc(), {
    collectionName: 'products',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Product Master',
    reason: input.reason,
    timestamp: input.now,
  });
}

interface ParsedComposition {
  id?: string;
  ingredientName: string;
  ingredientType: string;
  grade: string;
  quantity: number;
  unit: string;
  functionPurpose: string;
  specificationNo: string;
  stpNo: string;
}

interface ParsedPacking {
  id?: string;
  packingMaterial: string;
  materialType: string;
  packSize: string;
  quantity: number;
  unit: string;
  specificationNo: string;
  stpNo: string;
}

function parseCompositions(value: unknown): ParsedComposition[] {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new HttpsError('invalid-argument', `Invalid composition at index ${index}`);
    }
    const r = row as Record<string, unknown>;
    const ingredientName = requiredString(r.ingredientName, `compositions[${index}].ingredientName`, 200);
    const ingredientType = String(r.ingredientType || 'Other');
    if (!INGREDIENT_TYPES.includes(ingredientType as typeof INGREDIENT_TYPES[number])) {
      throw new HttpsError('invalid-argument', `Invalid ingredient type at index ${index}`);
    }
    const quantity = Number(r.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new HttpsError('invalid-argument', `Composition quantity must be positive at index ${index}`);
    }
    return {
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : undefined,
      ingredientName,
      ingredientType,
      grade: optionalString(r.grade, `compositions[${index}].grade`, 80),
      quantity,
      unit: optionalString(r.unit, `compositions[${index}].unit`, 40),
      functionPurpose: optionalString(r.functionPurpose, `compositions[${index}].functionPurpose`, 200),
      specificationNo: optionalString(r.specificationNo, `compositions[${index}].specificationNo`, 80),
      stpNo: optionalString(r.stpNo, `compositions[${index}].stpNo`, 80),
    };
  });
}

function parsePackingDetails(value: unknown): ParsedPacking[] {
  if (!Array.isArray(value)) return [];
  return value.map((row, index) => {
    if (!row || typeof row !== 'object') {
      throw new HttpsError('invalid-argument', `Invalid packing detail at index ${index}`);
    }
    const r = row as Record<string, unknown>;
    const packingMaterial = requiredString(r.packingMaterial, `packingDetails[${index}].packingMaterial`, 200);
    const materialType = String(r.materialType || 'Primary Packing');
    if (!PACKING_MATERIAL_TYPES.includes(materialType as typeof PACKING_MATERIAL_TYPES[number])) {
      throw new HttpsError('invalid-argument', `Invalid packing material type at index ${index}`);
    }
    const quantity = r.quantity == null ? 0 : Number(r.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new HttpsError('invalid-argument', `Packing quantity must be numeric at index ${index}`);
    }
    return {
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : undefined,
      packingMaterial,
      materialType,
      packSize: optionalString(r.packSize, `packingDetails[${index}].packSize`, 80),
      quantity,
      unit: optionalString(r.unit, `packingDetails[${index}].unit`, 40),
      specificationNo: optionalString(r.specificationNo, `packingDetails[${index}].specificationNo`, 80),
      stpNo: optionalString(r.stpNo, `packingDetails[${index}].stpNo`, 80),
    };
  });
}

function parseProductPayload(input: Record<string, unknown>, existing?: DocumentData) {
  const productCode = requiredString(input.productCode ?? existing?.productCode, 'productCode', 32).toUpperCase();
  const productName = requiredString(input.productName ?? existing?.productName, 'productName', 200);
  const genericName = requiredString(input.genericName ?? existing?.genericName, 'genericName', 200);
  const dosageForm = String(input.dosageForm ?? existing?.dosageForm ?? 'Injection');
  if (!DOSAGE_FORMS.includes(dosageForm as typeof DOSAGE_FORMS[number])) {
    throw new HttpsError('invalid-argument', 'Invalid dosage form');
  }
  const market = String(input.market ?? existing?.market ?? 'Domestic');
  if (!MARKET_OPTIONS.includes(market as typeof MARKET_OPTIONS[number])) {
    throw new HttpsError('invalid-argument', 'Invalid market');
  }
  const productStatus = String(input.productStatus ?? existing?.productStatus ?? 'Active');
  if (!PRODUCT_STATUSES.includes(productStatus as typeof PRODUCT_STATUSES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid product status');
  }
  const lifecycleStatus = String(input.lifecycleStatus ?? existing?.lifecycleStatus ?? 'Commercial');
  if (!PRODUCT_LIFECYCLE_STATUSES.includes(lifecycleStatus as typeof PRODUCT_LIFECYCLE_STATUSES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid lifecycle status');
  }
  const shelfLife = requiredString(input.shelfLife ?? existing?.shelfLife, 'shelfLife', 40);
  if (!/^\d+/.test(shelfLife)) {
    throw new HttpsError('invalid-argument', 'Shelf life must be numeric');
  }

  const compositions = input.compositions !== undefined
    ? parseCompositions(input.compositions)
    : parseCompositions(existing?.compositions ?? []);
  const packingDetails = input.packingDetails !== undefined
    ? parsePackingDetails(input.packingDetails)
    : parsePackingDetails(existing?.packingDetails ?? []);

  if (compositions.length > 0 && !compositions.some((c) => c.ingredientType === 'API')) {
    throw new HttpsError('invalid-argument', 'At least one API ingredient is required');
  }

  const manufacturingLicenseNumber = optionalString(
    input.manufacturingLicenseNumber ?? existing?.manufacturingLicenseNumber ?? existing?.manufacturingLicenseNo,
    'manufacturingLicenseNumber',
    80,
  );
  const standardBatchSize = optionalString(
    input.standardBatchSize ?? existing?.standardBatchSize ?? existing?.batchSize,
    'standardBatchSize',
    80,
  );

  return {
    productId: buildProductId(productCode),
    productCode,
    productName,
    genericName,
    brandName: optionalString(input.brandName ?? existing?.brandName, 'brandName', 160),
    productFamily: optionalString(input.productFamily ?? existing?.productFamily, 'productFamily', 160),
    therapeuticCategory: optionalString(
      input.therapeuticCategory ?? input.category ?? existing?.therapeuticCategory ?? existing?.category,
      'therapeuticCategory',
      160,
    ),
    category: optionalString(
      input.category ?? input.therapeuticCategory ?? existing?.category ?? existing?.therapeuticCategory,
      'category',
      160,
    ),
    strength: requiredString(input.strength ?? existing?.strength, 'strength', 80),
    dosageForm,
    routeOfAdministration: optionalString(
      input.routeOfAdministration ?? existing?.routeOfAdministration,
      'routeOfAdministration',
      80,
    ),
    packSize: optionalString(input.packSize ?? existing?.packSize, 'packSize', 80),
    packType: optionalString(input.packType ?? existing?.packType, 'packType', 80),
    containerClosure: optionalString(input.containerClosure ?? existing?.containerClosure, 'containerClosure', 160),
    market,
    country: optionalString(input.country ?? existing?.country, 'country', 120) || 'India',
    manufacturingSite: optionalString(input.manufacturingSite ?? existing?.manufacturingSite, 'manufacturingSite', 160),
    businessUnit: optionalString(input.businessUnit ?? existing?.businessUnit, 'businessUnit', 160),
    department: optionalString(input.department ?? existing?.department, 'department', 160),
    productOwner: optionalString(input.productOwner ?? existing?.productOwner, 'productOwner', 160),
    lifecycleStatus,
    shelfLife,
    storageCondition: optionalString(input.storageCondition ?? existing?.storageCondition, 'storageCondition', 200),
    standardBatchSize,
    batchSize: standardBatchSize,
    manufacturingLicenseNumber,
    manufacturingLicenseNo: manufacturingLicenseNumber,
    registrationNumber: optionalString(input.registrationNumber ?? existing?.registrationNumber, 'registrationNumber', 80),
    licenseNumber: optionalString(input.licenseNumber ?? existing?.licenseNumber, 'licenseNumber', 80),
    mfrNumber: optionalString(input.mfrNumber ?? existing?.mfrNumber, 'mfrNumber', 80),
    bmrNumber: optionalString(input.bmrNumber ?? existing?.bmrNumber, 'bmrNumber', 80),
    bprNumber: optionalString(input.bprNumber ?? existing?.bprNumber, 'bprNumber', 80),
    specificationNumber: optionalString(input.specificationNumber ?? existing?.specificationNumber, 'specificationNumber', 80),
    stpNumber: optionalString(input.stpNumber ?? existing?.stpNumber, 'stpNumber', 80),
    batchPrefix: optionalString(input.batchPrefix ?? existing?.batchPrefix, 'batchPrefix', 40),
    hsnCode: optionalString(input.hsnCode ?? existing?.hsnCode, 'hsnCode', 40),
    gtin: optionalString(input.gtin ?? existing?.gtin, 'gtin', 40),
    barcode: optionalString(input.barcode ?? existing?.barcode, 'barcode', 80),
    qrCode: optionalString(input.qrCode ?? existing?.qrCode, 'qrCode', 200),
    productStatus,
    status: productStatus === 'Active' ? 'Active' : 'Inactive',
    description: optionalString(input.description ?? existing?.description, 'description', 2000),
    remarks: optionalString(input.remarks ?? existing?.remarks, 'remarks', 2000),
    composition: compositions.map((c) => c.ingredientName).join(', '),
    packingStyle: packingDetails.map((p) => p.packingMaterial).join(', '),
    compositions,
    packingDetails,
  };
}

async function assertUniqueProduct(
  firestore: Firestore,
  payload: ReturnType<typeof parseProductPayload>,
  excludeDocId?: string,
) {
  const [codeSnap, nameSnap] = await Promise.all([
    firestore.collection('products').where('productCode', '==', payload.productCode).limit(10).get(),
    firestore.collection('products').where('productName', '==', payload.productName).limit(10).get(),
  ]);
  if (codeSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Product code already exists');
  }
  if (nameSnap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Product name already exists');
  }
}

async function countLinkedProductReferences(firestore: Firestore, productCode: string) {
  const batches = await firestore.collection('batches')
    .where('productCode', '==', productCode)
    .limit(500)
    .get();
  return batches.docs.filter((doc) => doc.data().isDeleted !== true).length;
}

async function cascadeProductRename(
  firestore: Firestore,
  batch: WriteBatch,
  productCode: string,
  productName: string,
  genericName: string,
  actorUid: string,
  now: string,
) {
  const batches = await firestore.collection('batches')
    .where('productCode', '==', productCode)
    .limit(500)
    .get();
  let cascadeCount = 0;
  batches.docs.forEach((doc) => {
    if (doc.data().isDeleted === true) return;
    batch.update(doc.ref, {
      productName,
      genericName,
      updatedAt: now,
      updatedBy: actorUid,
    });
    cascadeCount += 1;
  });
  return cascadeCount;
}

async function syncProductCompositions(
  firestore: Firestore,
  batch: WriteBatch,
  productDocId: string,
  rows: ParsedComposition[],
  actorUid: string,
  now: string,
) {
  const existingSnap = await firestore.collection('product_compositions')
    .where('productId', '==', productDocId)
    .limit(200)
    .get();
  const existingIds = new Set(existingSnap.docs.map((doc) => doc.id));
  const newIds = new Set(rows.map((r) => r.id).filter(Boolean));

  for (const row of rows) {
    const payload = {
      ingredientName: row.ingredientName,
      ingredientType: row.ingredientType,
      grade: row.grade,
      quantity: row.quantity,
      unit: row.unit,
      functionPurpose: row.functionPurpose,
      specificationNo: row.specificationNo,
      stpNo: row.stpNo,
      productId: productDocId,
      isDeleted: false,
      updatedAt: now,
      updatedBy: actorUid,
    };
    if (row.id && existingIds.has(row.id)) {
      batch.update(firestore.collection('product_compositions').doc(row.id), payload);
    } else {
      batch.set(firestore.collection('product_compositions').doc(), {
        ...payload,
        createdAt: now,
        createdBy: actorUid,
      });
    }
  }

  for (const doc of existingSnap.docs) {
    if (!newIds.has(doc.id) && doc.data().isDeleted !== true) {
      batch.update(doc.ref, { isDeleted: true, updatedAt: now, updatedBy: actorUid });
    }
  }
}

async function syncProductPacking(
  firestore: Firestore,
  batch: WriteBatch,
  productDocId: string,
  rows: ParsedPacking[],
  actorUid: string,
  now: string,
) {
  const existingSnap = await firestore.collection('product_packing_details')
    .where('productId', '==', productDocId)
    .limit(200)
    .get();
  const existingIds = new Set(existingSnap.docs.map((doc) => doc.id));
  const newIds = new Set(rows.map((r) => r.id).filter(Boolean));

  for (const row of rows) {
    const payload = {
      packingMaterial: row.packingMaterial,
      materialType: row.materialType,
      packSize: row.packSize,
      quantity: row.quantity,
      unit: row.unit,
      specificationNo: row.specificationNo,
      stpNo: row.stpNo,
      productId: productDocId,
      isDeleted: false,
      updatedAt: now,
      updatedBy: actorUid,
    };
    if (row.id && existingIds.has(row.id)) {
      batch.update(firestore.collection('product_packing_details').doc(row.id), payload);
    } else {
      batch.set(firestore.collection('product_packing_details').doc(), {
        ...payload,
        createdAt: now,
        createdBy: actorUid,
      });
    }
  }

  for (const doc of existingSnap.docs) {
    if (!newIds.has(doc.id) && doc.data().isDeleted !== true) {
      batch.update(doc.ref, { isDeleted: true, updatedAt: now, updatedBy: actorUid });
    }
  }
}

function stripSubcollections<T extends Record<string, unknown>>(payload: T) {
  const { compositions, packingDetails, ...record } = payload;
  return record;
}

export const createAdminProduct = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertProductEditor(actor, actorRole);

  const input = request.data as Record<string, unknown>;
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const payload = parseProductPayload(input);
  await assertUniqueProduct(firestore, payload);

  const now = new Date().toISOString();
  const ref = firestore.collection('products').doc();
  const record = {
    ...stripSubcollections(payload),
    isDeleted: false,
    createdBy: request.auth.uid,
    updatedBy: request.auth.uid,
    createdAt: now,
    updatedAt: now,
  };

  const batch = firestore.batch();
  batch.set(ref, record);
  await syncProductCompositions(firestore, batch, ref.id, payload.compositions, request.auth.uid, now);
  await syncProductPacking(firestore, batch, ref.id, payload.packingDetails, request.auth.uid, now);
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: ref.id,
    action: 'CREATE_PRODUCT',
    oldValue: null,
    newValue: record,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    productNotification(
      request.auth.uid,
      ref.id,
      'PRODUCT_CREATED',
      'Product created',
      `Product "${payload.productName}" (${payload.productCode}) was created.`,
      now,
    ),
  );
  await batch.commit();
  return { id: ref.id, ...record };
});

export const updateAdminProduct = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const input = request.data as Record<string, unknown>;
  const productDocId = requiredString(input.productDocId, 'productDocId', 128);
  const reason = requiredString(input.reason || input.changeReason, 'reason', 500);
  const updates = (input.updates && typeof input.updates === 'object' && !Array.isArray(input.updates))
    ? input.updates as Record<string, unknown>
    : input;

  const ref = firestore.collection('products').doc(productDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Product not found');
  }
  const existing = snap.data() || {};
  const payload = parseProductPayload({ ...existing, ...updates }, existing);
  await assertUniqueProduct(firestore, payload, productDocId);

  const now = new Date().toISOString();
  const batch = firestore.batch();
  const record = {
    ...stripSubcollections(payload),
    updatedAt: now,
    updatedBy: request.auth.uid,
  };
  batch.update(ref, record);
  await syncProductCompositions(firestore, batch, productDocId, payload.compositions, request.auth.uid, now);
  await syncProductPacking(firestore, batch, productDocId, payload.packingDetails, request.auth.uid, now);

  let cascadeCount = 0;
  if (String(existing.productName || '') !== payload.productName
    || String(existing.genericName || '') !== payload.genericName) {
    cascadeCount = await cascadeProductRename(
      firestore,
      batch,
      payload.productCode,
      payload.productName,
      payload.genericName,
      request.auth.uid,
      now,
    );
  }

  if (String(existing.productStatus || '') !== payload.productStatus) {
    writeProductAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: productDocId,
      action: 'STATUS_CHANGED',
      oldValue: existing.productStatus,
      newValue: payload.productStatus,
      reason,
      now,
    });
  }
  if (String(existing.lifecycleStatus || '') !== payload.lifecycleStatus) {
    writeProductAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: productDocId,
      action: 'LIFECYCLE_CHANGED',
      oldValue: existing.lifecycleStatus,
      newValue: payload.lifecycleStatus,
      reason,
      now,
    });
    batch.set(
      firestore.collection('notifications').doc(),
      productNotification(
        request.auth.uid,
        productDocId,
        'LIFECYCLE_CHANGED',
        'Product lifecycle changed',
        `Lifecycle for "${payload.productName}" changed to "${payload.lifecycleStatus}".`,
        now,
      ),
    );
  }
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: productDocId,
    action: 'EDIT_PRODUCT',
    oldValue: existing,
    newValue: record,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    productNotification(
      request.auth.uid,
      productDocId,
      'PRODUCT_UPDATED',
      'Product updated',
      `Product "${payload.productName}" was updated.`,
      now,
    ),
  );
  await batch.commit();
  return { product: { id: productDocId, ...existing, ...record }, cascadeCount };
});

export const setAdminProductStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const productDocId = requiredString(request.data?.productDocId, 'productDocId', 128);
  const productStatus = String(request.data?.productStatus || '');
  if (!PRODUCT_STATUSES.includes(productStatus as typeof PRODUCT_STATUSES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid product status');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('products').doc(productDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Product not found');
  }
  const existing = snap.data() || {};
  const status = productStatus === 'Active' ? 'Active' : 'Inactive';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { productStatus, status, updatedAt: now, updatedBy: request.auth.uid });
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: productDocId,
    action: 'STATUS_CHANGED',
    oldValue: existing.productStatus,
    newValue: productStatus,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    productNotification(
      request.auth.uid,
      productDocId,
      'PRODUCT_STATUS_CHANGED',
      'Product status changed',
      `Product "${String(existing.productName || '')}" is now ${productStatus}.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const setAdminProductLifecycle = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const productDocId = requiredString(request.data?.productDocId, 'productDocId', 128);
  const lifecycleStatus = String(request.data?.lifecycleStatus || '');
  if (!PRODUCT_LIFECYCLE_STATUSES.includes(lifecycleStatus as typeof PRODUCT_LIFECYCLE_STATUSES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid lifecycle status');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('products').doc(productDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Product not found');
  }
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { lifecycleStatus, updatedAt: now, updatedBy: request.auth.uid });
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: productDocId,
    action: 'LIFECYCLE_CHANGED',
    oldValue: existing.lifecycleStatus,
    newValue: lifecycleStatus,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    productNotification(
      request.auth.uid,
      productDocId,
      'LIFECYCLE_CHANGED',
      'Product lifecycle changed',
      `Lifecycle for "${String(existing.productName || '')}" changed to "${lifecycleStatus}".`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const archiveAdminProduct = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const productDocId = requiredString(request.data?.productDocId, 'productDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('products').doc(productDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Product not found');
  }
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    lifecycleStatus: 'Archived',
    productStatus: 'Inactive',
    status: 'Inactive',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: productDocId,
    action: 'ARCHIVE_PRODUCT',
    oldValue: { lifecycleStatus: existing.lifecycleStatus, productStatus: existing.productStatus },
    newValue: { lifecycleStatus: 'Archived', productStatus: 'Inactive' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    productNotification(
      request.auth.uid,
      productDocId,
      'PRODUCT_ARCHIVED',
      'Product archived',
      `Product "${String(existing.productName || '')}" was archived.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const softDeleteAdminProduct = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);
  if (actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only Super Admin can soft-delete products');
  }

  const productDocId = requiredString(request.data?.productDocId, 'productDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('products').doc(productDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Product not found');
  const existing = snap.data() || {};

  const linkedRefs = await countLinkedProductReferences(firestore, String(existing.productCode || ''));
  if (linkedRefs > 0) {
    throw new HttpsError('failed-precondition', `Cannot delete product: ${linkedRefs} linked batch record(s) found`);
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: true,
    productStatus: 'Inactive',
    status: 'Inactive',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: productDocId,
    action: 'DELETE_PRODUCT',
    oldValue: existing,
    newValue: { isDeleted: true, productStatus: 'Inactive' },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    productNotification(
      request.auth.uid,
      productDocId,
      'PRODUCT_DELETED',
      'Product deleted',
      `Product "${String(existing.productName || '')}" was soft-deleted.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const restoreAdminProduct = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const productDocId = requiredString(request.data?.productDocId, 'productDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('products').doc(productDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Product not found');
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: false,
    productStatus: 'Active',
    status: 'Active',
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: productDocId,
    action: 'RESTORE_PRODUCT',
    oldValue: { isDeleted: existing.isDeleted, productStatus: existing.productStatus },
    newValue: { isDeleted: false, productStatus: 'Active' },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const bulkUpdateAdminProducts = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const productDocIds = Array.isArray(request.data?.productDocIds)
    ? (request.data.productDocIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (productDocIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one product');
  }
  const action = String(request.data?.action || '');
  if (!['activate', 'deactivate', 'archive'].includes(action)) {
    throw new HttpsError('invalid-argument', 'Unsupported bulk action');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const now = new Date().toISOString();
  let successCount = 0;

  for (const productDocId of productDocIds) {
    const ref = firestore.collection('products').doc(productDocId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.isDeleted === true) continue;
    const existing = snap.data() || {};
    const batch = firestore.batch();

    if (action === 'activate') {
      batch.update(ref, { productStatus: 'Active', status: 'Active', updatedAt: now, updatedBy: request.auth!.uid });
      writeProductAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: productDocId,
        action: 'STATUS_CHANGED',
        oldValue: existing.productStatus,
        newValue: 'Active',
        reason,
        now,
      });
    } else if (action === 'deactivate') {
      batch.update(ref, { productStatus: 'Inactive', status: 'Inactive', updatedAt: now, updatedBy: request.auth!.uid });
      writeProductAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: productDocId,
        action: 'STATUS_CHANGED',
        oldValue: existing.productStatus,
        newValue: 'Inactive',
        reason,
        now,
      });
    } else {
      batch.update(ref, {
        lifecycleStatus: 'Archived',
        productStatus: 'Inactive',
        status: 'Inactive',
        updatedAt: now,
        updatedBy: request.auth!.uid,
      });
      writeProductAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: productDocId,
        action: 'ARCHIVE_PRODUCT',
        oldValue: { lifecycleStatus: existing.lifecycleStatus, productStatus: existing.productStatus },
        newValue: { lifecycleStatus: 'Archived', productStatus: 'Inactive' },
        reason,
        now,
      });
    }
    await batch.commit();
    successCount += 1;
  }
  return { successCount };
});

export const bulkSoftDeleteAdminProducts = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertActiveAdmin(actor, actorRole);
  if (actorRole !== 'super_admin') {
    throw new HttpsError('permission-denied', 'Only Super Admin can bulk soft-delete products');
  }

  const productDocIds = Array.isArray(request.data?.productDocIds)
    ? (request.data.productDocIds as unknown[]).map((id) => String(id)).filter(Boolean).slice(0, 50)
    : [];
  if (productDocIds.length === 0) {
    throw new HttpsError('invalid-argument', 'Select at least one product');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (const productDocId of productDocIds) {
    try {
      const ref = firestore.collection('products').doc(productDocId);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const existing = snap.data() || {};
      if (existing.isDeleted === true) continue;
      const linkedRefs = await countLinkedProductReferences(firestore, String(existing.productCode || ''));
      if (linkedRefs > 0) {
        errors.push(`${existing.productName || productDocId}: ${linkedRefs} linked batch record(s)`);
        continue;
      }
      const batch = firestore.batch();
      batch.update(ref, {
        isDeleted: true,
        productStatus: 'Inactive',
        status: 'Inactive',
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      writeProductAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: productDocId,
        action: 'DELETE_PRODUCT',
        oldValue: existing,
        newValue: { isDeleted: true, productStatus: 'Inactive' },
        reason,
        now,
      });
      await batch.commit();
      successCount += 1;
    } catch (error) {
      errors.push(`${productDocId}: ${(error as Error).message}`);
    }
  }
  return { successCount, errors };
});

export const importAdminProducts = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const reason = requiredString(request.data?.reason, 'reason', 500);
  const rows = Array.isArray(request.data?.rows) ? request.data.rows as Record<string, unknown>[] : [];
  if (rows.length === 0) throw new HttpsError('invalid-argument', 'No import rows provided');
  if (rows.length > 50) throw new HttpsError('invalid-argument', 'Maximum 50 rows per import');

  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (let index = 0; index < rows.length; index += 1) {
    try {
      const row = rows[index];
      if (!row.compositions) {
        row.compositions = [{
          ingredientName: 'API',
          ingredientType: 'API',
          grade: '',
          quantity: 1,
          unit: 'mg',
          functionPurpose: '',
          specificationNo: '',
          stpNo: '',
        }];
      }
      const payload = parseProductPayload(row);
      await assertUniqueProduct(firestore, payload);
      const ref = firestore.collection('products').doc();
      const record = {
        ...stripSubcollections(payload),
        isDeleted: false,
        createdBy: request.auth.uid,
        updatedBy: request.auth.uid,
        createdAt: now,
        updatedAt: now,
      };
      const batch = firestore.batch();
      batch.set(ref, record);
      await syncProductCompositions(firestore, batch, ref.id, payload.compositions, request.auth.uid, now);
      await syncProductPacking(firestore, batch, ref.id, payload.packingDetails, request.auth.uid, now);
      writeProductAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: ref.id,
        action: 'IMPORT_PRODUCT',
        oldValue: null,
        newValue: record,
        reason,
        now,
      });
      await batch.commit();
      successCount += 1;
    } catch (error) {
      errors.push(`Row ${index + 1}: ${(error as Error).message}`);
    }
  }
  return { successCount, errors };
});

export const logAdminProductExport = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const count = Number(request.data?.count || 0);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: 'export',
    action: 'EXPORT_PRODUCT_LIST',
    oldValue: null,
    newValue: { count },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const registerAdminProductAttachment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const productDocId = requiredString(request.data?.productDocId, 'productDocId', 128);
  const fileName = requiredString(request.data?.fileName, 'fileName', 260);
  const fileType = optionalString(request.data?.fileType, 'fileType', 120);
  const fileSize = Number(request.data?.fileSize || 0);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    throw new HttpsError('invalid-argument', 'fileSize must be a positive number');
  }
  if (fileSize > PRODUCT_ATTACHMENT_MAX_BYTES) {
    throw new HttpsError('invalid-argument', 'File must be 10 MB or smaller');
  }
  const attachmentType = String(request.data?.attachmentType || 'other');
  if (!PRODUCT_ATTACHMENT_TYPES.includes(attachmentType as typeof PRODUCT_ATTACHMENT_TYPES[number])) {
    throw new HttpsError('invalid-argument', 'Invalid attachment type');
  }
  const storagePath = requiredString(request.data?.storagePath, 'storagePath', 500);
  const downloadUrl = requiredString(request.data?.downloadUrl, 'downloadUrl', 2000);
  const reason = optionalString(request.data?.reason, 'reason', 500);

  const productRef = firestore.collection('products').doc(productDocId);
  const productSnap = await productRef.get();
  if (!productSnap.exists || productSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Product not found');
  }

  const now = new Date().toISOString();
  const attachmentRef = firestore.collection('product_attachments').doc();
  const attachment = {
    productId: productDocId,
    fileName,
    fileType,
    fileSize,
    attachmentType,
    storagePath,
    downloadUrl,
    uploadedBy: request.auth.uid,
    uploadedAt: now,
    isDeleted: false,
    createdAt: now,
    createdBy: request.auth.uid,
    updatedAt: now,
    updatedBy: request.auth.uid,
  };

  const batch = firestore.batch();
  batch.set(attachmentRef, attachment);
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: productDocId,
    action: 'ATTACHMENT_UPLOAD',
    oldValue: null,
    newValue: { fileName, attachmentType, fileSize },
    reason: reason || 'Attachment registered after client upload',
    now,
  });
  await batch.commit();
  return { id: attachmentRef.id, ...attachment };
});

export const softDeleteAdminProductAttachment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertProductEditor(actor, String(actor?.role || ''));

  const attachmentDocId = requiredString(request.data?.attachmentDocId, 'attachmentDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('product_attachments').doc(attachmentDocId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Attachment not found');
  }
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { isDeleted: true, updatedAt: now, updatedBy: request.auth.uid });
  writeProductAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: String(existing.productId || ''),
    action: 'ATTACHMENT_DELETE',
    oldValue: existing,
    newValue: { isDeleted: true },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});
