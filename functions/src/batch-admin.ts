/**
 * Batch Master — privileged Cloud Functions.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  type Firestore, type DocumentData, type WriteBatch, FieldValue,
} from 'firebase-admin/firestore';
import { getAdminFirestore } from './admin-app';

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

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value == null || value === '') return undefined;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new HttpsError('invalid-argument', `${field} must be a valid number`);
  }
  return num;
}

const BATCH_EDITOR_ROLES = [
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'production_manager', 'production_executive',
];

const BATCH_RELEASE_ROLES = ['super_admin', 'admin', 'head_qa', 'qa_manager'];

const BATCH_STATUSES = [
  'Planned', 'Scheduled', 'Manufacturing', 'Sampling', 'Testing', 'Under Review',
  'Released', 'Rejected', 'Hold', 'Reprocessed', 'Closed', 'Archived',
] as const;

const LEGACY_STATUS_MAP: Record<string, typeof BATCH_STATUSES[number]> = {
  'Under QC Testing': 'Testing',
  'Under QA Review': 'Under Review',
  Reworked: 'Reprocessed',
  Cancelled: 'Closed',
};

const BATCH_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  Planned: ['Scheduled', 'Manufacturing', 'Hold', 'Closed'],
  Scheduled: ['Planned', 'Manufacturing', 'Hold'],
  Manufacturing: ['Sampling', 'Hold', 'Rejected'],
  Sampling: ['Testing', 'Hold', 'Rejected'],
  Testing: ['Under Review', 'Hold', 'Rejected'],
  'Under Review': ['Released', 'Rejected', 'Hold'],
  Released: ['Hold', 'Closed', 'Archived'],
  Rejected: ['Reprocessed', 'Closed', 'Archived'],
  Hold: ['Planned', 'Scheduled', 'Manufacturing', 'Sampling', 'Testing', 'Under Review'],
  Reprocessed: ['Manufacturing', 'Testing', 'Sampling'],
  Closed: ['Archived'],
  Archived: [],
};

const RELEASE_STATUSES = ['Pending', 'Released', 'Rejected', 'On Hold', 'Not Applicable'] as const;
const QC_STATUSES = ['Pending', 'In Progress', 'Approved', 'Rejected', 'On Hold', 'Not Applicable'] as const;
const QA_STATUSES = ['Pending', 'In Review', 'Approved', 'Rejected', 'On Hold', 'Not Applicable'] as const;
const BATCH_SIZE_UNITS = ['Vials', 'Tablets', 'Capsules', 'Bottles', 'Kg', 'L', 'Units'] as const;

const LINKED_BATCH_COLLECTIONS: Array<{ name: string; idField: string; numberField?: string }> = [
  { name: 'deviations', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'capa_records', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'oos_records', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'complaints', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'change_controls', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'recall_records', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'stability_studies', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'ebmr_records', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'cpv_batches', idField: 'adminBatchId', numberField: 'batchNumber' },
  { name: 'pqr_batches', idField: 'batch_id', numberField: 'batch_number' },
  { name: 'batch_attachments', idField: 'batchId' },
];

function normalizeBatchStatus(status: unknown): typeof BATCH_STATUSES[number] {
  const raw = String(status || 'Planned');
  if (BATCH_STATUSES.includes(raw as typeof BATCH_STATUSES[number])) {
    return raw as typeof BATCH_STATUSES[number];
  }
  return LEGACY_STATUS_MAP[raw] || 'Planned';
}

function buildBatchId(batchNumber: string): string {
  return `BATCH-${batchNumber.toUpperCase().replace(/\s+/g, '-')}`;
}

function assertBatchEditor(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !BATCH_EDITOR_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active batch editor access required');
  }
}

function assertBatchReleaser(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !BATCH_RELEASE_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active QA release authority required');
  }
}

function assertActiveAdmin(actor: DocumentData | undefined, actorRole: string) {
  if (!actor || actor.is_active !== true || !['super_admin', 'admin'].includes(actorRole)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }
}

function batchNotification(
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
    moduleName: 'Batch Master',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/batches/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeBatchAudit(
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
    module: 'Batch Master',
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
    collectionName: 'batches',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Batch Master',
    reason: input.reason,
    timestamp: input.now,
  });
}

function validateEnum<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  const str = String(value ?? fallback);
  if (!allowed.includes(str as T)) {
    throw new HttpsError('invalid-argument', `Invalid ${field}`);
  }
  return str as T;
}

function assertStatusTransition(from: string, to: string, qaOverride = false) {
  const normalizedFrom = normalizeBatchStatus(from);
  const normalizedTo = normalizeBatchStatus(to);
  if (normalizedFrom === normalizedTo) return;
  if (qaOverride) return;
  const allowed = BATCH_STATUS_TRANSITIONS[normalizedFrom] || [];
  if (!allowed.includes(normalizedTo)) {
    throw new HttpsError(
      'failed-precondition',
      `Invalid status transition from "${normalizedFrom}" to "${normalizedTo}"`,
    );
  }
}

async function assertUniqueBatchNumber(
  firestore: Firestore,
  batchNumber: string,
  excludeDocId?: string,
) {
  const snap = await firestore.collection('batches')
    .where('batchNumber', '==', batchNumber)
    .limit(10)
    .get();
  if (snap.docs.some((doc) => doc.id !== excludeDocId && doc.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Batch number already exists');
  }
}

async function countLinkedBatchReferences(
  firestore: Firestore,
  batchDocId: string,
  batchNumber: string,
): Promise<Array<{ module: string; count: number }>> {
  const results: Array<{ module: string; count: number }> = [];
  for (const link of LINKED_BATCH_COLLECTIONS) {
    if (link.name === 'batch_attachments') continue;
    try {
      const byId = await firestore.collection(link.name)
        .where(link.idField, '==', batchDocId)
        .limit(5)
        .get();
      let count = byId.docs.filter((doc) => doc.data().isDeleted !== true).length;
      if (count === 0 && link.numberField && batchNumber) {
        const byNumber = await firestore.collection(link.name)
          .where(link.numberField, '==', batchNumber)
          .limit(5)
          .get();
        count = byNumber.docs.filter((doc) => doc.data().isDeleted !== true).length;
      }
      if (count > 0) results.push({ module: link.name, count });
    } catch {
      // Collection may not exist or lack index — skip
    }
  }
  return results;
}

function getPeriodKey(resetFrequency: string, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  switch (resetFrequency) {
    case 'Yearly': return `${y}`;
    case 'Monthly': return `${y}-${m}`;
    default: return 'all';
  }
}

async function generateBatchNumber(
  firestore: Firestore,
  productCode: string,
  siteCode?: string,
  options?: { preview?: boolean },
): Promise<string> {
  const date = new Date();
  const year = date.getFullYear();
  const preview = options?.preview === true;

  const numberingSnap = await firestore.collection('document_numbering')
    .where('status', '==', 'Active')
    .limit(20)
    .get();

  type NumberingFormat = Record<string, unknown> & { id: string };
  const batchFormat = numberingSnap.docs
    .map((doc): NumberingFormat => ({ id: doc.id, ...(doc.data() as Record<string, unknown>) }))
    .find((row) => {
      const moduleNameLower = String(row.moduleName || row.module || '').toLowerCase();
      const docType = String(row.documentType || '').toLowerCase();
      return moduleNameLower.includes('batch') || docType.includes('batch');
    });

  if (batchFormat) {
    const periodKey = getPeriodKey(String(batchFormat.resetFrequency || 'Yearly'), date);
    const seqRef = firestore.collection('document_numbering_sequences')
      .doc(`${batchFormat.numberingId || batchFormat.id}__${periodKey}`);

    let seqNum: number;
    if (preview) {
      const seqDoc = await seqRef.get();
      seqNum = (seqDoc.exists ? Number(seqDoc.data()?.currentNumber || seqDoc.data()?.currentValue || 0) : 0) + 1;
    } else {
      seqNum = await firestore.runTransaction(async (tx) => {
        const seqDoc = await tx.get(seqRef);
        const next = (seqDoc.exists
          ? Number(seqDoc.data()?.currentNumber || seqDoc.data()?.currentValue || 0)
          : 0) + 1;
        tx.set(seqRef, {
          numberingId: batchFormat.numberingId || batchFormat.id,
          periodKey,
          currentNumber: next,
          currentValue: next,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        return next;
      });
    }

    const prefix = String(batchFormat.prefix || 'B');
    const sep = batchFormat.separator === 'None' ? '' : String(batchFormat.separator || '-');
    const runLen = Number(batchFormat.runningNumberLength ?? batchFormat.runningNumber ?? 6);
    const padded = String(seqNum).padStart(runLen, '0');
    const parts = [prefix, siteCode || productCode, String(year), padded].filter(Boolean);
    return parts.join(sep || '-');
  }

  const counterRef = firestore.collection('batch_number_sequences').doc(String(year));
  let seq: number;
  if (preview) {
    const counterDoc = await counterRef.get();
    seq = (counterDoc.exists ? Number(counterDoc.data()?.currentNumber || 0) : 0) + 1;
  } else {
    seq = await firestore.runTransaction(async (tx) => {
      const counterDoc = await tx.get(counterRef);
      const next = (counterDoc.exists ? Number(counterDoc.data()?.currentNumber || 0) : 0) + 1;
      tx.set(counterRef, { year, currentNumber: next, updatedAt: new Date().toISOString() }, { merge: true });
      return next;
    });
  }
  return `B${year}-${String(seq).padStart(6, '0')}`;
}

function parseBatchPayload(input: Record<string, unknown>, existing?: DocumentData) {
  const batchNumber = optionalString(input.batchNumber ?? existing?.batchNumber, 'batchNumber', 80);
  const productCode = requiredString(input.productCode ?? existing?.productCode, 'productCode', 32).toUpperCase();
  const batchSize = optionalNumber(input.batchSize ?? existing?.batchSize, 'batchSize');
  if (batchSize == null || batchSize <= 0) {
    throw new HttpsError('invalid-argument', 'Batch size must be positive');
  }
  const batchSizeUnit = validateEnum(
    input.batchSizeUnit ?? existing?.batchSizeUnit ?? existing?.unit,
    BATCH_SIZE_UNITS,
    'batchSizeUnit',
    'Vials',
  );
  const manufacturingDate = requiredString(
    input.manufacturingDate ?? existing?.manufacturingDate,
    'manufacturingDate',
    20,
  );
  const expiryDate = requiredString(input.expiryDate ?? existing?.expiryDate, 'expiryDate', 20);
  if (expiryDate < manufacturingDate) {
    throw new HttpsError('invalid-argument', 'Expiry date must be on or after manufacturing date');
  }

  const batchStatus = validateEnum(
    input.batchStatus ?? existing?.batchStatus,
    BATCH_STATUSES,
    'batchStatus',
    'Planned',
  );
  const releaseStatus = validateEnum(
    input.releaseStatus ?? existing?.releaseStatus,
    RELEASE_STATUSES,
    'releaseStatus',
    'Pending',
  );
  const qcStatus = validateEnum(input.qcStatus ?? existing?.qcStatus, QC_STATUSES, 'qcStatus', 'Pending');
  const qaStatus = validateEnum(input.qaStatus ?? existing?.qaStatus, QA_STATUSES, 'qaStatus', 'Pending');

  const plannedQty = optionalNumber(input.plannedQuantity ?? existing?.plannedQuantity, 'plannedQuantity');
  const actualQty = optionalNumber(input.actualQuantity ?? existing?.actualQuantity, 'actualQuantity');

  return {
    batchNumber,
    batchId: batchNumber ? buildBatchId(batchNumber) : '',
    batchCode: optionalString(input.batchCode ?? existing?.batchCode, 'batchCode', 80),
    productCode,
    productName: optionalString(input.productName ?? existing?.productName, 'productName', 200),
    productVersion: optionalString(input.productVersion ?? existing?.productVersion, 'productVersion', 40),
    productCategory: optionalString(input.productCategory ?? existing?.productCategory, 'productCategory', 160),
    genericName: optionalString(input.genericName ?? existing?.genericName, 'genericName', 200),
    strength: optionalString(input.strength ?? existing?.strength, 'strength', 80),
    dosageForm: optionalString(input.dosageForm ?? existing?.dosageForm, 'dosageForm', 80),
    market: optionalString(input.market ?? existing?.market, 'market', 40),
    manufacturingOrder: optionalString(input.manufacturingOrder ?? existing?.manufacturingOrder, 'manufacturingOrder', 80),
    batchSize: String(batchSize),
    batchSizeUnit,
    unit: batchSizeUnit,
    plannedQuantity: plannedQty != null ? String(plannedQty) : optionalString(existing?.plannedQuantity, 'plannedQuantity', 40),
    actualQuantity: actualQty != null ? String(actualQty) : optionalString(existing?.actualQuantity, 'actualQuantity', 40),
    manufacturingDate,
    packagingDate: optionalString(input.packagingDate ?? existing?.packagingDate, 'packagingDate', 20),
    expiryDate,
    retestDate: optionalString(input.retestDate ?? existing?.retestDate, 'retestDate', 20),
    shelfLife: optionalString(input.shelfLife ?? existing?.shelfLife, 'shelfLife', 40),
    batchPrefix: optionalString(input.batchPrefix ?? existing?.batchPrefix, 'batchPrefix', 40),
    manufacturingSite: optionalString(input.manufacturingSite ?? existing?.manufacturingSite, 'manufacturingSite', 160),
    businessUnit: optionalString(input.businessUnit ?? existing?.businessUnit, 'businessUnit', 160),
    department: optionalString(input.department ?? existing?.department, 'department', 160),
    warehouse: optionalString(input.warehouse ?? existing?.warehouse, 'warehouse', 160),
    storageLocation: optionalString(input.storageLocation ?? existing?.storageLocation, 'storageLocation', 160),
    manufacturingLine: optionalString(
      input.manufacturingLine ?? existing?.manufacturingLine ?? existing?.lineNumber,
      'manufacturingLine',
      80,
    ),
    lineNumber: optionalString(
      input.manufacturingLine ?? existing?.manufacturingLine ?? existing?.lineNumber,
      'lineNumber',
      80,
    ),
    equipment: optionalString(input.equipment ?? existing?.equipment, 'equipment', 200),
    processVersion: optionalString(input.processVersion ?? existing?.processVersion, 'processVersion', 40),
    recipeVersion: optionalString(input.recipeVersion ?? existing?.recipeVersion, 'recipeVersion', 40),
    shift: optionalString(input.shift ?? existing?.shift, 'shift', 40),
    mfrNumber: optionalString(input.mfrNumber ?? existing?.mfrNumber, 'mfrNumber', 80),
    bmrNumber: optionalString(input.bmrNumber ?? existing?.bmrNumber, 'bmrNumber', 80),
    bprNumber: optionalString(input.bprNumber ?? existing?.bprNumber, 'bprNumber', 500),
    manufacturedFor: optionalString(input.manufacturedFor ?? existing?.manufacturedFor, 'manufacturedFor', 160),
    customerName: optionalString(input.customerName ?? existing?.customerName, 'customerName', 160),
    batchStatus,
    releaseStatus,
    qcStatus,
    qaStatus,
    releaseDate: optionalString(input.releaseDate ?? existing?.releaseDate, 'releaseDate', 20),
    qaReleasedBy: optionalString(input.qaReleasedBy ?? existing?.qaReleasedBy, 'qaReleasedBy', 160),
    semiFinishedBatchNumber: optionalString(
      input.semiFinishedBatchNumber ?? existing?.semiFinishedBatchNumber,
      'semiFinishedBatchNumber',
      80,
    ),
    finishedProductBatchNumber: optionalString(
      input.finishedProductBatchNumber ?? existing?.finishedProductBatchNumber,
      'finishedProductBatchNumber',
      80,
    ),
    packingBatchNumber: optionalString(
      input.packingBatchNumber ?? existing?.packingBatchNumber,
      'packingBatchNumber',
      80,
    ),
    statusChangeReason: optionalString(input.statusChangeReason ?? existing?.statusChangeReason, 'statusChangeReason', 500),
    remarks: optionalString(input.remarks ?? existing?.remarks, 'remarks', 2000),
    status: batchStatus === 'Released' ? 'Active' : 'Inactive',
    isArchived: batchStatus === 'Archived' || existing?.isArchived === true,
  };
}

async function loadActiveProduct(firestore: Firestore, productCode: string): Promise<Record<string, unknown> & { docId: string }> {
  const snap = await firestore.collection('products')
    .where('productCode', '==', productCode)
    .limit(5)
    .get();
  const product = snap.docs.find((doc) => doc.data().isDeleted !== true);
  if (!product) throw new HttpsError('not-found', 'Product not found');
  const data = product.data();
  if (data.productStatus !== 'Active') {
    throw new HttpsError('failed-precondition', 'Cannot create batch for inactive product');
  }
  return { docId: product.id, ...data };
}

export const createAdminBatch = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchEditor(actor, String(actor?.role || ''));

  const input = (request.data || {}) as Record<string, unknown>;
  const reason = requiredString(input.reason ?? input.changeReason, 'reason', 500);
  const autoGenerate = input.autoGenerateBatchNumber === true;
  const product = await loadActiveProduct(firestore, requiredString(input.productCode, 'productCode', 32));

  let batchNumber = optionalString(input.batchNumber, 'batchNumber', 80);
  if (autoGenerate || !batchNumber) {
    batchNumber = await generateBatchNumber(
      firestore,
      String(product.productCode || ''),
      optionalString(input.manufacturingSite ?? product.manufacturingSite, 'manufacturingSite', 160) || undefined,
    );
  }
  await assertUniqueBatchNumber(firestore, batchNumber);

  const payload = parseBatchPayload({
    ...input,
    batchNumber,
    productName: input.productName || product.productName,
    genericName: input.genericName || product.genericName,
    strength: input.strength || product.strength,
    dosageForm: input.dosageForm || product.dosageForm,
    market: input.market || product.market,
    productCategory: input.productCategory || product.category || product.therapeuticCategory,
    productVersion: input.productVersion || '',
    shelfLife: input.shelfLife || product.shelfLife,
    batchPrefix: input.batchPrefix || product.batchPrefix,
    mfrNumber: input.mfrNumber || product.mfrNumber,
    bmrNumber: input.bmrNumber || product.bmrNumber,
    bprNumber: input.bprNumber || product.bprNumber,
    businessUnit: input.businessUnit || product.businessUnit,
    department: input.department || product.department,
    manufacturingSite: input.manufacturingSite || product.manufacturingSite,
  });

  const now = new Date().toISOString();
  const ref = firestore.collection('batches').doc();
  const batch = firestore.batch();
  batch.set(ref, {
    ...payload,
    batchId: buildBatchId(batchNumber),
    isDeleted: false,
    isArchived: false,
    createdAt: now,
    createdBy: request.auth.uid,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: ref.id,
    action: 'CREATE_BATCH',
    oldValue: null,
    newValue: payload,
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    batchNotification(
      request.auth.uid,
      ref.id,
      'BATCH_CREATED',
      'Batch created',
      `Batch "${batchNumber}" was registered for product ${payload.productCode}.`,
      now,
    ),
  );
  await batch.commit();
  const created = await ref.get();
  return { id: ref.id, ...created.data() };
});

export const updateAdminBatch = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  const actorRole = String(actor?.role || '');
  assertBatchEditor(actor, actorRole);

  const batchDocId = requiredString(request.data?.batchDocId, 'batchDocId', 128);
  const updates = (request.data?.updates || request.data || {}) as Record<string, unknown>;
  const reason = requiredString(request.data?.reason ?? updates.changeReason, 'reason', 500);
  const qaOverride = updates.qaOverride === true && ['super_admin', 'head_qa'].includes(actorRole);

  const ref = firestore.collection('batches').doc(batchDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Batch not found');
  const existing = snap.data() || {};
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Cannot update deleted batch');

  const existingStatus = normalizeBatchStatus(existing.batchStatus);
  if (existingStatus === 'Released' && !qaOverride) {
    throw new HttpsError('failed-precondition', 'Released batch cannot be edited without QA override');
  }

  const payload = parseBatchPayload(updates, existing);
  if (payload.batchNumber !== existing.batchNumber) {
    if (existingStatus === 'Released' && !qaOverride) {
      throw new HttpsError('failed-precondition', 'Batch number cannot be changed on released batch');
    }
    await assertUniqueBatchNumber(firestore, payload.batchNumber, batchDocId);
  }

  if (updates.batchStatus && !qaOverride) {
    assertStatusTransition(String(existing.batchStatus), String(updates.batchStatus));
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    ...payload,
    batchId: buildBatchId(payload.batchNumber),
    updatedAt: now,
    updatedBy: request.auth.uid,
  });

  const statusChanged = normalizeBatchStatus(existing.batchStatus) !== payload.batchStatus;
  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: batchDocId,
    action: qaOverride && existingStatus === 'Released' ? 'QA_OVERRIDE' : 'EDIT_BATCH',
    oldValue: existing,
    newValue: payload,
    reason,
    now,
  });
  if (statusChanged) {
    writeBatchAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: batchDocId,
      action: 'STATUS_CHANGE',
      oldValue: existing.batchStatus,
      newValue: payload.batchStatus,
      reason,
      now,
    });
    batch.set(
      firestore.collection('notifications').doc(),
      batchNotification(
        request.auth.uid,
        batchDocId,
        'BATCH_STATUS_CHANGED',
        'Batch status changed',
        `Batch "${payload.batchNumber}" status changed to ${payload.batchStatus}.`,
        now,
      ),
    );
  }
  await batch.commit();
  const updated = await ref.get();
  return { batch: { id: ref.id, ...updated.data() } };
});

export const setAdminBatchStatus = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchReleaser(actor, String(actor?.role || ''));

  const batchDocId = requiredString(request.data?.batchDocId, 'batchDocId', 128);
  const action = requiredString(request.data?.action, 'action', 40);
  const reason = requiredString(request.data?.reason, 'reason', 500);

  const ref = firestore.collection('batches').doc(batchDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Batch not found');
  const existing = snap.data() || {};
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Batch is deleted');

  const statusMap: Record<string, Partial<DocumentData>> = {
    release: { batchStatus: 'Released', releaseStatus: 'Released', qcStatus: 'Approved', qaStatus: 'Approved' },
    reject: { batchStatus: 'Rejected', releaseStatus: 'Rejected', qaStatus: 'Rejected' },
    hold: { batchStatus: 'Hold', releaseStatus: 'On Hold', qcStatus: 'On Hold', qaStatus: 'On Hold' },
    close: { batchStatus: 'Closed', releaseStatus: 'Not Applicable' },
    archive: { batchStatus: 'Archived', releaseStatus: 'Not Applicable', isArchived: true },
  };
  const patch = statusMap[action];
  if (!patch) throw new HttpsError('invalid-argument', 'Invalid batch action');

  const now = new Date().toISOString();
  const batch = firestore.batch();
  const updates: DocumentData = {
    ...patch,
    statusChangeReason: reason,
    status: action === 'release' ? 'Active' : 'Inactive',
    updatedAt: now,
    updatedBy: request.auth.uid,
  };
  if (action === 'release') {
    updates.releaseDate = now.slice(0, 10);
    updates.qaReleasedBy = String(actor?.full_name || actor?.email || 'QA');
  }
  batch.update(ref, updates);

  const auditAction = {
    release: 'RELEASE_BATCH',
    reject: 'REJECT_BATCH',
    hold: 'HOLD_BATCH',
    close: 'CLOSE_BATCH',
    archive: 'ARCHIVE_BATCH',
  }[action] || 'STATUS_CHANGE';

  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: batchDocId,
    action: auditAction,
    oldValue: { batchStatus: existing.batchStatus, releaseStatus: existing.releaseStatus },
    newValue: { ...patch, reason },
    reason,
    now,
  });

  const eventMap: Record<string, string> = {
    release: 'BATCH_RELEASED',
    reject: 'BATCH_REJECTED',
    hold: 'BATCH_ON_HOLD',
    close: 'BATCH_CLOSED',
    archive: 'BATCH_ARCHIVED',
  };
  batch.set(
    firestore.collection('notifications').doc(),
    batchNotification(
      request.auth.uid,
      batchDocId,
      eventMap[action] || 'BATCH_STATUS_CHANGED',
      `Batch ${action}d`,
      `Batch "${String(existing.batchNumber || '')}" was ${action}d.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const softDeleteAdminBatch = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const batchDocId = requiredString(request.data?.batchDocId, 'batchDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('batches').doc(batchDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Batch not found');
  const existing = snap.data() || {};

  if (normalizeBatchStatus(existing.batchStatus) === 'Released') {
    throw new HttpsError('failed-precondition', 'Released batch cannot be deleted');
  }

  const links = await countLinkedBatchReferences(
    firestore,
    batchDocId,
    String(existing.batchNumber || ''),
  );
  if (links.length > 0) {
    const summary = links.map((l) => `${l.module} (${l.count})`).join(', ');
    throw new HttpsError('failed-precondition', `Cannot delete batch: linked records in ${summary}`);
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: true,
    status: 'Inactive',
    deletedAt: now,
    deletedBy: request.auth.uid,
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: batchDocId,
    action: 'DELETE_BATCH',
    oldValue: existing,
    newValue: { isDeleted: true },
    reason,
    now,
  });
  batch.set(
    firestore.collection('notifications').doc(),
    batchNotification(
      request.auth.uid,
      batchDocId,
      'BATCH_DELETED',
      'Batch deleted',
      `Batch "${String(existing.batchNumber || '')}" was soft-deleted.`,
      now,
    ),
  );
  await batch.commit();
  return { success: true };
});

export const restoreAdminBatch = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchEditor(actor, String(actor?.role || ''));

  const batchDocId = requiredString(request.data?.batchDocId, 'batchDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('batches').doc(batchDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Batch not found');
  const existing = snap.data() || {};

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, {
    isDeleted: false,
    isArchived: false,
    deletedAt: FieldValue.delete(),
    deletedBy: FieldValue.delete(),
    updatedAt: now,
    updatedBy: request.auth.uid,
  });
  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: batchDocId,
    action: 'RESTORE_BATCH',
    oldValue: { isDeleted: existing.isDeleted },
    newValue: { isDeleted: false },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const bulkUpdateAdminBatches = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchEditor(actor, String(actor?.role || ''));

  const batchDocIds = request.data?.batchDocIds;
  if (!Array.isArray(batchDocIds) || batchDocIds.length === 0 || batchDocIds.length > 50) {
    throw new HttpsError('invalid-argument', 'batchDocIds must contain 1–50 IDs');
  }
  const action = requiredString(request.data?.action, 'action', 40);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const now = new Date().toISOString();
  let successCount = 0;

  for (const id of batchDocIds) {
    const batchDocId = String(id);
    const ref = firestore.collection('batches').doc(batchDocId);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const existing = snap.data() || {};
    if (existing.isDeleted === true) continue;
    if (normalizeBatchStatus(existing.batchStatus) === 'Released') continue;

    const updates: DocumentData = { updatedAt: now, updatedBy: request.auth.uid };
    if (action === 'archive') {
      updates.batchStatus = 'Archived';
      updates.isArchived = true;
      updates.status = 'Inactive';
    } else if (action === 'hold') {
      updates.batchStatus = 'Hold';
      updates.releaseStatus = 'On Hold';
    } else if (action === 'close') {
      updates.batchStatus = 'Closed';
      updates.status = 'Inactive';
    } else {
      continue;
    }

    const batch = firestore.batch();
    batch.update(ref, updates);
    writeBatchAudit(batch, firestore, {
      actorUid: request.auth.uid,
      actorName: String(actor?.full_name || actor?.email || 'Admin'),
      recordId: batchDocId,
      action: `BULK_${action.toUpperCase()}`,
      oldValue: { batchStatus: existing.batchStatus },
      newValue: updates,
      reason,
      now,
    });
    await batch.commit();
    successCount += 1;
  }
  return { successCount };
});

export const bulkSoftDeleteAdminBatches = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const batchDocIds = request.data?.batchDocIds;
  if (!Array.isArray(batchDocIds) || batchDocIds.length === 0 || batchDocIds.length > 50) {
    throw new HttpsError('invalid-argument', 'batchDocIds must contain 1–50 IDs');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const errors: string[] = [];
  let successCount = 0;

  for (const id of batchDocIds) {
    try {
      const batchDocId = String(id);
      const ref = firestore.collection('batches').doc(batchDocId);
      const snap = await ref.get();
      if (!snap.exists) {
        errors.push(`${batchDocId}: not found`);
        continue;
      }
      const existing = snap.data() || {};
      if (normalizeBatchStatus(existing.batchStatus) === 'Released') {
        errors.push(`${existing.batchNumber}: released batch cannot be deleted`);
        continue;
      }
      const links = await countLinkedBatchReferences(
        firestore,
        batchDocId,
        String(existing.batchNumber || ''),
      );
      if (links.length > 0) {
        errors.push(`${existing.batchNumber}: linked records exist`);
        continue;
      }
      const now = new Date().toISOString();
      const batch = firestore.batch();
      batch.update(ref, {
        isDeleted: true,
        status: 'Inactive',
        deletedAt: now,
        deletedBy: request.auth.uid,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      writeBatchAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: batchDocId,
        action: 'DELETE_BATCH',
        oldValue: existing,
        newValue: { isDeleted: true },
        reason,
        now,
      });
      await batch.commit();
      successCount += 1;
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { successCount, errors };
});

export const importAdminBatches = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertActiveAdmin(actor, String(actor?.role || ''));

  const rows = request.data?.rows;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 50) {
    throw new HttpsError('invalid-argument', 'rows must contain 1–50 import records');
  }
  const reason = requiredString(request.data?.reason, 'reason', 500);
  let imported = 0;
  const errors: string[] = [];

  for (const [index, row] of rows.entries()) {
    try {
      if (!row || typeof row !== 'object') throw new Error('Invalid row');
      const r = row as Record<string, unknown>;
      const productCode = requiredString(r.productCode, `rows[${index}].productCode`, 32);
      const product = await loadActiveProduct(firestore, productCode);
      let batchNumber = optionalString(r.batchNumber, `rows[${index}].batchNumber`, 80);
      if (!batchNumber) {
        batchNumber = await generateBatchNumber(firestore, productCode);
      }
      await assertUniqueBatchNumber(firestore, batchNumber);

      const payload = parseBatchPayload({
        ...r,
        batchNumber,
        productCode,
        productName: r.productName || product.productName,
        batchStatus: r.batchStatus || 'Planned',
        releaseStatus: r.releaseStatus || 'Pending',
        batchSize: r.batchSize || 1,
        batchSizeUnit: r.batchSizeUnit || 'Vials',
        manufacturingDate: r.manufacturingDate || new Date().toISOString().slice(0, 10),
        expiryDate: r.expiryDate || new Date().toISOString().slice(0, 10),
        remarks: r.remarks || 'Imported',
      });

      const now = new Date().toISOString();
      const ref = firestore.collection('batches').doc();
      const batch = firestore.batch();
      batch.set(ref, {
        ...payload,
        batchId: buildBatchId(batchNumber),
        isDeleted: false,
        isArchived: false,
        createdAt: now,
        createdBy: request.auth.uid,
        updatedAt: now,
        updatedBy: request.auth.uid,
      });
      writeBatchAudit(batch, firestore, {
        actorUid: request.auth.uid,
        actorName: String(actor?.full_name || actor?.email || 'Admin'),
        recordId: ref.id,
        action: 'IMPORT_BATCH',
        oldValue: null,
        newValue: { batchNumber, productCode },
        reason,
        now,
      });
      await batch.commit();
      imported += 1;
    } catch (e) {
      errors.push(`Row ${index + 1}: ${(e as Error).message}`);
    }
  }
  return { imported, errors };
});

export const logAdminBatchExport = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchEditor(actor, String(actor?.role || ''));

  const count = Number(request.data?.count || 0);
  const reason = optionalString(request.data?.reason, 'reason', 500) || 'Batch list export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: 'export',
    action: 'EXPORT_BATCH_LIST',
    oldValue: null,
    newValue: { count },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const registerAdminBatchAttachment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchEditor(actor, String(actor?.role || ''));

  const batchDocId = requiredString(request.data?.batchDocId, 'batchDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const fileName = requiredString(request.data?.fileName, 'fileName', 260);
  const fileType = optionalString(request.data?.fileType, 'fileType', 120);
  const fileSize = Number(request.data?.fileSize || 0);
  const storagePath = requiredString(request.data?.storagePath, 'storagePath', 500);
  const downloadUrl = requiredString(request.data?.downloadUrl, 'downloadUrl', 2000);

  if (fileSize <= 0 || fileSize > 10 * 1024 * 1024) {
    throw new HttpsError('invalid-argument', 'Attachment must be between 1 byte and 10 MB');
  }

  const batchRef = firestore.collection('batches').doc(batchDocId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists || batchSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Batch not found');
  }

  const now = new Date().toISOString();
  const attachmentRef = firestore.collection('batch_attachments').doc();
  const batch = firestore.batch();
  batch.set(attachmentRef, {
    batchId: batchDocId,
    fileName,
    fileType,
    fileSize,
    storagePath,
    downloadUrl,
    uploadedBy: request.auth.uid,
    uploadedAt: now,
    isDeleted: false,
  });
  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: batchDocId,
    action: 'ATTACHMENT_UPLOAD',
    oldValue: null,
    newValue: { fileName, storagePath },
    reason,
    now,
  });
  await batch.commit();
  return { id: attachmentRef.id, batchId: batchDocId, fileName, downloadUrl };
});

export const softDeleteAdminBatchAttachment = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchEditor(actor, String(actor?.role || ''));

  const attachmentDocId = requiredString(request.data?.attachmentDocId, 'attachmentDocId', 128);
  const reason = requiredString(request.data?.reason, 'reason', 500);
  const ref = firestore.collection('batch_attachments').doc(attachmentDocId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Attachment not found');
  const existing = snap.data() || {};

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(ref, { isDeleted: true, updatedAt: now, updatedBy: request.auth.uid });
  writeBatchAudit(batch, firestore, {
    actorUid: request.auth.uid,
    actorName: String(actor?.full_name || actor?.email || 'Admin'),
    recordId: String(existing.batchId || attachmentDocId),
    action: 'ATTACHMENT_DELETE',
    oldValue: existing,
    newValue: { isDeleted: true },
    reason,
    now,
  });
  await batch.commit();
  return { success: true };
});

export const previewAdminBatchNumber = onCall(async (request) => {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  const firestore = getAdminFirestore();
  const actorSnapshot = await firestore.collection('profiles').doc(request.auth.uid).get();
  const actor = actorSnapshot.data();
  assertBatchEditor(actor, String(actor?.role || ''));

  const productCode = requiredString(request.data?.productCode, 'productCode', 32);
  const siteCode = optionalString(request.data?.siteCode, 'siteCode', 40);
  const number = await generateBatchNumber(firestore, productCode, siteCode || undefined, { preview: true });
  return { batchNumber: number, preview: true };
});
