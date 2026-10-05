/**
 * CPV Batch Registration — privileged Cloud Functions.
 * CF-only writes, status transitions, dual audit, e-sign for release/reject/hold/archive.
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

function asPositiveNumber(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpsError('invalid-argument', `${field} must be a positive number`);
  }
  return n;
}

const COLLECTION = 'cpv_batches';
const MODULE = 'CPV Batch Registration';

const EDITOR_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'production', 'production_manager',
];
const RELEASE_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const VIEWER_ROLES = [
  ...EDITOR_ROLES,
  'qc', 'qc_manager', 'auditor', 'viewer',
];

const BATCH_STATUSES = [
  'Planned', 'Scheduled', 'Manufacturing', 'Sampling', 'Testing', 'Under Review',
  'Released', 'Rejected', 'Hold', 'Reprocessed', 'Closed', 'Archived',
] as const;

const LEGACY_STATUS_MAP: Record<string, typeof BATCH_STATUSES[number]> = {
  'Under QC Testing': 'Testing',
  'Under QA Review': 'Under Review',
  'Pending Review': 'Under Review',
  'QA Review': 'Under Review',
  'QC Testing': 'Testing',
  Approved: 'Scheduled',
  'Released for Manufacturing': 'Scheduled',
  'Manufacturing In Progress': 'Manufacturing',
  'Manufacturing Completed': 'Sampling',
  'On Hold': 'Hold',
  Reworked: 'Reprocessed',
  Cancelled: 'Closed',
  Draft: 'Planned',
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
const REVIEW_FREQUENCIES = ['Monthly', 'Quarterly', 'Half Yearly', 'Yearly'] as const;
const BATCH_SIZE_UNITS = ['Vials', 'Ampoule', 'Tablets', 'Capsules', 'Bottles', 'Kg', 'L', 'Units'] as const;
const CRITICAL_STATUSES = new Set(['Released', 'Rejected', 'Hold', 'Archived', 'Closed']);

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Batch Registration view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Batch Registration edit access required');
  }
}

function assertReleaser(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !RELEASE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'QA release authority required');
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

function buildCpvBatchId(batchNumber: string): string {
  return `CPV-BATCH-${batchNumber.toUpperCase().replace(/\s+/g, '-')}`;
}

function toMonthYear(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 7);
  return trimmed;
}

function normalizeBatchStatus(status: unknown): typeof BATCH_STATUSES[number] {
  const raw = String(status || 'Planned');
  if (BATCH_STATUSES.includes(raw as typeof BATCH_STATUSES[number])) {
    return raw as typeof BATCH_STATUSES[number];
  }
  return LEGACY_STATUS_MAP[raw] || 'Planned';
}

function assertTransition(from: string, to: string) {
  const normalizedFrom = normalizeBatchStatus(from);
  const normalizedTo = normalizeBatchStatus(to);
  if (normalizedFrom === normalizedTo) return;
  const allowed = BATCH_STATUS_TRANSITIONS[normalizedFrom] || [];
  if (!allowed.includes(normalizedTo)) {
    throw new HttpsError(
      'failed-precondition',
      `Invalid status transition: ${normalizedFrom} → ${normalizedTo}`,
    );
  }
}

function writeCpvBatchAudit(
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
    auditId: `AUD-CPVB-${Date.now().toString(36).toUpperCase()}`,
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
    source: 'cpv-batch-admin',
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
    notificationId: `NTF-CPVB-${Date.now().toString(36).toUpperCase()}`,
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
    actionLink: `/cpv/batch-registration/${input.recordId}`,
    createdAt: input.now,
  });
}

async function findDuplicateBatchNumber(
  firestore: Firestore,
  batchNumber: string,
  excludeId?: string,
): Promise<boolean> {
  const snap = await firestore.collection(COLLECTION)
    .where('batchNumber', '==', batchNumber)
    .limit(25)
    .get();
  return snap.docs.some((d) => {
    if (excludeId && d.id === excludeId) return false;
    return d.data()?.isDeleted !== true;
  });
}

async function assertOperationalProduct(firestore: Firestore, cpvProductId: string) {
  if (!cpvProductId) throw new HttpsError('invalid-argument', 'CPV product is required');
  const snap = await firestore.collection('cpv_products').doc(cpvProductId).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'CPV product not found');
  }
  const status = String(snap.data()?.cpvStatus || '').toLowerCase();
  if (!['active', 'under review', 'approved'].includes(status)) {
    throw new HttpsError(
      'failed-precondition',
      'Selected CPV product is not operational for batch registration',
    );
  }
  return snap.data() || {};
}

async function countLinkedMonitoring(
  firestore: Firestore,
  batchNumber: string,
): Promise<number> {
  if (!batchNumber) return 0;
  let count = 0;
  const cols = [
    'cpp_results',
    'cqa_results',
    'yield_monitoring',
    'stability_studies',
    'stability_results',
    'hold_time_monitoring',
    'raw_material_monitoring',
    'packing_material_monitoring',
    'environmental_monitoring',
    'utility_monitoring',
  ];
  for (const col of cols) {
    try {
      const byNumber = await firestore.collection(col).where('batchNumber', '==', batchNumber).limit(1).get();
      if (!byNumber.empty) {
        count += 1;
        continue;
      }
      const byNo = await firestore.collection(col).where('batchNo', '==', batchNumber).limit(1).get();
      if (!byNo.empty) count += 1;
    } catch {
      // ignore missing indexes
    }
  }
  return count;
}

function sanitizePayload(data: Record<string, unknown>, existing?: DocumentData) {
  const batchNumber = requiredString(data.batchNumber ?? existing?.batchNumber, 'Batch number', 80);
  const manufacturingDate = toMonthYear(
    requiredString(data.manufacturingDate ?? existing?.manufacturingDate, 'Manufacturing date', 40),
  );
  const expiryDate = toMonthYear(
    requiredString(data.expiryDate ?? existing?.expiryDate, 'Expiry date', 40),
  );
  if (manufacturingDate && expiryDate && expiryDate <= manufacturingDate) {
    throw new HttpsError('invalid-argument', 'Expiry month must be after manufacturing month');
  }

  const batchStatus = normalizeBatchStatus(data.batchStatus ?? existing?.batchStatus ?? 'Planned');
  const releaseStatusRaw = optionalString(
    data.releaseStatus ?? existing?.releaseStatus,
    'Release status',
    40,
  ) || 'Pending';
  if (!RELEASE_STATUSES.includes(releaseStatusRaw as typeof RELEASE_STATUSES[number])) {
    throw new HttpsError('invalid-argument', `Invalid release status: ${releaseStatusRaw}`);
  }

  const frequency = optionalString(
    data.cpvReviewPeriod ?? existing?.cpvReviewPeriod,
    'Review period',
    40,
  ) || 'Yearly';
  if (!REVIEW_FREQUENCIES.includes(frequency as typeof REVIEW_FREQUENCIES[number])) {
    throw new HttpsError('invalid-argument', `Invalid review period: ${frequency}`);
  }

  const unit = optionalString(data.batchSizeUnit ?? existing?.batchSizeUnit, 'Unit', 40) || 'Vials';
  if (!BATCH_SIZE_UNITS.includes(unit as typeof BATCH_SIZE_UNITS[number])) {
    throw new HttpsError('invalid-argument', `Invalid batch size unit: ${unit}`);
  }

  return {
    recordType: 'cpv_batch',
    cpvProductId: requiredString(data.cpvProductId ?? existing?.cpvProductId, 'CPV product', 120),
    batchNumber,
    batchCode: optionalString(data.batchCode ?? existing?.batchCode, 'Batch code', 80) || buildCpvBatchId(batchNumber),
    productCode: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
    productName: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    productVersion: optionalString(data.productVersion ?? existing?.productVersion, 'Product version', 40),
    productCategory: optionalString(data.productCategory ?? existing?.productCategory, 'Category', 120),
    genericName: optionalString(data.genericName ?? existing?.genericName, 'Generic name', 200),
    strength: optionalString(data.strength ?? existing?.strength, 'Strength', 80),
    dosageForm: optionalString(data.dosageForm ?? existing?.dosageForm, 'Dosage form', 80),
    packSize: optionalString(data.packSize ?? existing?.packSize, 'Pack size', 80),
    market: optionalString(data.market ?? existing?.market, 'Market', 80),
    batchSize: asPositiveNumber(data.batchSize ?? existing?.batchSize, 'Batch size'),
    targetBatchSize: optionalString(data.targetBatchSize ?? existing?.targetBatchSize, 'Target size', 80),
    actualBatchSize: optionalString(data.actualBatchSize ?? existing?.actualBatchSize, 'Actual size', 80),
    batchSizeUnit: unit,
    manufacturingDate,
    expiryDate,
    retestDate: optionalString(data.retestDate ?? existing?.retestDate, 'Retest date', 40),
    shelfLifeMonths: optionalString(data.shelfLifeMonths ?? existing?.shelfLifeMonths, 'Shelf life', 40),
    manufacturingEndDate: optionalString(
      data.manufacturingEndDate ?? existing?.manufacturingEndDate,
      'Mfg end',
      40,
    ),
    packagingStartDate: optionalString(
      data.packagingStartDate ?? existing?.packagingStartDate,
      'Pack start',
      40,
    ),
    packagingEndDate: optionalString(
      data.packagingEndDate ?? existing?.packagingEndDate,
      'Pack end',
      40,
    ),
    manufacturingSite: requiredString(
      data.manufacturingSite ?? existing?.manufacturingSite,
      'Manufacturing site',
      120,
    ),
    plant: optionalString(data.plant ?? existing?.plant, 'Plant', 120),
    manufacturingLine: optionalString(
      data.manufacturingLine ?? existing?.manufacturingLine,
      'Line',
      120,
    ),
    department: optionalString(data.department ?? existing?.department, 'Department', 120),
    shift: optionalString(data.shift ?? existing?.shift, 'Shift', 40) || 'A',
    campaign: optionalString(data.campaign ?? existing?.campaign, 'Campaign', 120),
    manufacturingOrderNumber: optionalString(
      data.manufacturingOrderNumber ?? existing?.manufacturingOrderNumber,
      'MO number',
      80,
    ),
    workOrderNumber: optionalString(
      data.workOrderNumber ?? existing?.workOrderNumber,
      'WO number',
      80,
    ),
    mfrNumber: optionalString(data.mfrNumber ?? existing?.mfrNumber, 'MFR', 80),
    bmrNumber: optionalString(data.bmrNumber ?? existing?.bmrNumber, 'BMR', 80),
    bprNumber: (() => {
      const raw = data.bprNumbers ?? data.bprNumber ?? existing?.bprNumber;
      if (Array.isArray(raw)) {
        return optionalString(
          (raw as unknown[]).map((v) => String(v ?? '').trim()).filter(Boolean).join(', '),
          'BPR',
          500,
        );
      }
      return optionalString(raw, 'BPR', 500);
    })(),
    semiFinishedBatchNumber: optionalString(
      data.semiFinishedBatchNumber ?? existing?.semiFinishedBatchNumber,
      'SF batch',
      80,
    ),
    finishedProductBatchNumber: optionalString(
      data.finishedProductBatchNumber ?? existing?.finishedProductBatchNumber,
      'FP batch',
      500,
    ),
    packingBatchNumber: optionalString(
      data.packingBatchNumber ?? existing?.packingBatchNumber,
      'Packing batch',
      80,
    ),
    manufacturedFor: optionalString(
      data.manufacturedFor ?? existing?.manufacturedFor,
      'Manufactured for',
      200,
    ),
    customerName: optionalString(data.customerName ?? existing?.customerName, 'Customer', 500),
    equipmentIds: Array.isArray(data.equipmentIds)
      ? (data.equipmentIds as unknown[]).map(String).slice(0, 100)
      : Array.isArray(existing?.equipmentIds)
        ? (existing?.equipmentIds as unknown[]).map(String).slice(0, 100)
        : [],
    operatorIds: Array.isArray(data.operatorIds)
      ? (data.operatorIds as unknown[]).map(String).slice(0, 100)
      : Array.isArray(existing?.operatorIds)
        ? (existing?.operatorIds as unknown[]).map(String).slice(0, 100)
        : [],
    linkedCppParameterIds: Array.isArray(data.linkedCppParameterIds)
      ? (data.linkedCppParameterIds as unknown[]).map(String).slice(0, 200)
      : Array.isArray(existing?.linkedCppParameterIds)
        ? (existing?.linkedCppParameterIds as unknown[]).map(String).slice(0, 200)
        : [],
    linkedCqaParameterIds: Array.isArray(data.linkedCqaParameterIds)
      ? (data.linkedCqaParameterIds as unknown[]).map(String).slice(0, 200)
      : Array.isArray(existing?.linkedCqaParameterIds)
        ? (existing?.linkedCqaParameterIds as unknown[]).map(String).slice(0, 200)
        : [],
    goldenBatchNumber: optionalString(
      data.goldenBatchNumber ?? existing?.goldenBatchNumber,
      'Golden batch',
      80,
    ),
    cpvReviewPeriod: frequency,
    batchStatus,
    status: batchStatus,
    releaseStatus: releaseStatusRaw,
    qaReleaseDate: optionalString(data.qaReleaseDate ?? existing?.qaReleaseDate, 'QA release date', 40),
    qaReleasedBy: optionalString(data.qaReleasedBy ?? existing?.qaReleasedBy, 'QA released by', 120),
    statusChangeReason: optionalString(
      data.statusChangeReason ?? existing?.statusChangeReason,
      'Status reason',
      2000,
    ),
    description: optionalString(data.description ?? existing?.description, 'Description', 2000),
    remarks: optionalString(data.remarks ?? existing?.remarks, 'Remarks', 2000),
    specificationNumber: optionalString(
      data.specificationNumber ?? existing?.specificationNumber,
      'Specification',
      80,
    ),
    stpNumber: optionalString(data.stpNumber ?? existing?.stpNumber, 'STP', 80),
    cpvBatchId: buildCpvBatchId(batchNumber),
    batch_number: batchNumber,
    product_name: requiredString(data.productName ?? existing?.productName, 'Product name', 200),
    product_code: requiredString(data.productCode ?? existing?.productCode, 'Product code', 80),
  };
}

export const createAdminCpvBatch = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const product = await assertOperationalProduct(
    firestore,
    requiredString(data.cpvProductId, 'CPV product', 120),
  );
  const payload = sanitizePayload({
    ...data,
    specificationNumber: data.specificationNumber || product.specificationNumber || '',
    stpNumber: data.stpNumber || product.stpNumber || '',
    productVersion: data.productVersion || product.version || '',
    productCategory: data.productCategory || product.productCategory || '',
    batchStatus: data.batchStatus || 'Planned',
    releaseStatus: data.releaseStatus || 'Pending',
  });
  if (await findDuplicateBatchNumber(firestore, payload.batchNumber)) {
    throw new HttpsError('already-exists', 'A batch with this number already exists');
  }
  // Editors cannot create directly as Released
  if (CRITICAL_STATUSES.has(payload.batchStatus) && !RELEASE_ROLES.includes(actorRole)) {
    throw new HttpsError('permission-denied', 'QA release authority required for this status');
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
  writeCpvBatchAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.cpvBatchId,
    actionType: 'Batch Created',
    description: `Registered CPV batch ${payload.batchNumber}`,
    newValue: { batchNumber: payload.batchNumber, batchStatus: payload.batchStatus },
    reason,
    now,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: ref.id,
    eventName: 'Batch Registered',
    title: 'CPV Batch Registered',
    message: `Batch ${payload.batchNumber} (${payload.productName}) registered`,
    now,
  });
  await batch.commit();
  return record;
});

export const updateAdminCpvBatch = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Batch id', 120);
  const reason = requiredReason(data.changeReason);
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV batch not found');
  }
  const existing = snap.data() || {};
  const currentStatus = normalizeBatchStatus(existing.batchStatus);
  if (currentStatus === 'Released') {
    const forbidden = ['batchNumber', 'productName', 'productCode', 'manufacturingDate', 'expiryDate', 'batchSize'];
    for (const key of forbidden) {
      if (data[key] !== undefined && String(data[key]) !== String(existing[key] ?? '')) {
        throw new HttpsError('failed-precondition', 'Released batches cannot modify critical fields');
      }
    }
  }
  if (currentStatus === 'Archived' || currentStatus === 'Closed') {
    throw new HttpsError('failed-precondition', `${currentStatus} batches cannot be edited`);
  }

  const payload = sanitizePayload(data, existing);
  if (await findDuplicateBatchNumber(firestore, payload.batchNumber, id)) {
    throw new HttpsError('already-exists', 'A batch with this number already exists');
  }
  // Status changes via update must go through setAdminCpvBatchStatus for critical ones
  if (payload.batchStatus !== currentStatus) {
    assertTransition(currentStatus, payload.batchStatus);
    if (CRITICAL_STATUSES.has(payload.batchStatus)) {
      throw new HttpsError(
        'failed-precondition',
        'Use status action with electronic signature for release/reject/hold/archive',
      );
    }
  }

  const now = new Date().toISOString();
  const updates = {
    ...payload,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCpvBatchAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: payload.cpvBatchId,
    actionType: 'Batch Updated',
    description: `Updated CPV batch ${payload.batchNumber}`,
    oldValue: { batchStatus: existing.batchStatus, batchNumber: existing.batchNumber },
    newValue: { batchStatus: payload.batchStatus, batchNumber: payload.batchNumber },
    reason,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const setAdminCpvBatchStatus = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Batch id', 120);
  const batchStatus = normalizeBatchStatus(requiredString(data.batchStatus, 'Status', 40));
  const reason = requiredReason(data.changeReason);
  const esignConfirmed = data.esignConfirmed === true;

  if (CRITICAL_STATUSES.has(batchStatus)) {
    assertReleaser(actor, actorRole);
    if (!esignConfirmed) {
      throw new HttpsError(
        'failed-precondition',
        'Electronic signature confirmation required for this status change',
      );
    }
  } else {
    assertEditor(actor, actorRole);
  }

  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV batch not found');
  }
  const existing = snap.data() || {};
  const from = normalizeBatchStatus(existing.batchStatus);
  assertTransition(from, batchStatus);

  const now = new Date().toISOString();
  let releaseStatus = String(existing.releaseStatus || 'Pending');
  let qaReleaseDate = String(existing.qaReleaseDate || '');
  let qaReleasedBy = String(existing.qaReleasedBy || '');
  if (batchStatus === 'Released') {
    releaseStatus = 'Released';
    qaReleaseDate = now.split('T')[0];
    qaReleasedBy = actorName;
  } else if (batchStatus === 'Rejected') {
    releaseStatus = 'Rejected';
  } else if (batchStatus === 'Hold') {
    releaseStatus = 'On Hold';
  }

  const updates = {
    batchStatus,
    status: batchStatus,
    releaseStatus,
    qaReleaseDate,
    qaReleasedBy,
    statusChangeReason: reason,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
    lastStatusChangeAt: now,
    lastStatusChangeBy: actorUid,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeCpvBatchAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cpvBatchId || ''),
    actionType: `Batch ${batchStatus}`,
    description: `Status changed from ${from} to ${batchStatus}`,
    oldValue: from,
    newValue: batchStatus,
    reason,
    now,
    esign: esignConfirmed,
  });
  notify(firestore, batch, {
    targetUid: actorUid,
    recordId: id,
    eventName: `Batch ${batchStatus}`,
    title: `CPV Batch ${batchStatus}`,
    message: `Batch ${existing.batchNumber} set to ${batchStatus}`,
    now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const importAdminCpvBatch = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const adminBatchId = requiredString(data.adminBatchId, 'Admin batch id', 120);
  const cpvProductId = requiredString(data.cpvProductId, 'CPV product', 120);
  const reason = requiredReason(data.changeReason || 'Import from Admin Batch Master');
  await assertOperationalProduct(firestore, cpvProductId);
  const adminSnap = await firestore.collection('batches').doc(adminBatchId).get();
  if (!adminSnap.exists || adminSnap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Admin batch not found');
  }
  const admin = adminSnap.data() || {};
  const merged = {
    cpvProductId,
    batchNumber: admin.batchNumber || admin.batch_number,
    productCode: admin.productCode || admin.product_code,
    productName: admin.productName || admin.product_name,
    genericName: admin.genericName || '',
    strength: admin.strength || '',
    dosageForm: admin.dosageForm || '',
    market: admin.market || '',
    batchSize: admin.batchSize || admin.batch_size || 1,
    batchSizeUnit: admin.batchSizeUnit || 'Vials',
    manufacturingDate: toMonthYear(String(admin.manufacturingDate || admin.manufacturing_date || '')),
    expiryDate: toMonthYear(String(admin.expiryDate || admin.expiry_date || '')),
    manufacturingSite: admin.manufacturingSite || admin.manufacturing_site || 'Site 1',
    manufacturingLine: admin.manufacturingLine || '',
    shift: admin.shift || 'A',
    mfrNumber: admin.mfrNumber || '',
    bmrNumber: admin.bmrNumber || '',
    bprNumber: admin.bprNumber || '',
    semiFinishedBatchNumber: admin.semiFinishedBatchNumber || '',
    finishedProductBatchNumber: admin.finishedProductBatchNumber || '',
    packingBatchNumber: admin.packingBatchNumber || '',
    manufacturedFor: admin.manufacturedFor || '',
    customerName: admin.customerName || '',
    remarks: admin.remarks || '',
    batchStatus: 'Planned',
    releaseStatus: 'Pending',
    cpvReviewPeriod: 'Yearly',
  };
  const payload = sanitizePayload(merged);
  if (await findDuplicateBatchNumber(firestore, payload.batchNumber)) {
    throw new HttpsError('already-exists', 'A batch with this number already exists');
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
    adminBatchId,
  };
  const batch = firestore.batch();
  batch.set(ref, record);
  writeCpvBatchAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: ref.id,
    documentNumber: payload.cpvBatchId,
    actionType: 'Batch Imported',
    description: `Imported batch ${payload.batchNumber} from Admin Batch Master`,
    newValue: { adminBatchId, batchNumber: payload.batchNumber },
    reason,
    now,
  });
  await batch.commit();
  return record;
});

export const softDeleteAdminCpvBatch = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertReleaser(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Batch id', 120);
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature confirmation required to archive');
  }
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'CPV batch not found');
  }
  const existing = snap.data() || {};
  const status = normalizeBatchStatus(existing.batchStatus);
  if (status === 'Released') {
    throw new HttpsError('failed-precondition', 'Cannot delete released batches. Archive via status workflow.');
  }
  const linked = await countLinkedMonitoring(firestore, String(existing.batchNumber || ''));
  if (linked > 0) {
    throw new HttpsError(
      'failed-precondition',
      'Cannot delete batch with linked CPP/CQA/monitoring records. Set status to Closed/Archived instead.',
    );
  }
  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    batchStatus: 'Archived',
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
  writeCpvBatchAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: id,
    documentNumber: String(existing.cpvBatchId || ''),
    actionType: 'Batch Archived',
    description: `Soft-deleted / archived CPV batch ${existing.batchNumber}`,
    oldValue: existing.batchStatus,
    newValue: 'Archived',
    reason,
    now,
    esign: true,
  });
  await batch.commit();
  return { success: true, id };
});

export const logAdminCpvBatchExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const count = Number(data.count || 0);
  const format = optionalString(data.format, 'Format', 40) || 'CSV';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeCpvBatchAudit(batch, firestore, {
    actorUid,
    actorName,
    recordId: 'export',
    actionType: 'Batch Export',
    description: `Exported ${count} CPV batches (${format})`,
    newValue: { count, format },
    reason: optionalString(data.changeReason, 'Reason', 500) || 'Export',
    now,
  });
  await batch.commit();
  return { success: true };
});
