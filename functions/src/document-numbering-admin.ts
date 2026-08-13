/**
 * Document Numbering — privileged Cloud Functions.
 * Atomic sequence generation via Firestore transactions.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { type Firestore, type DocumentData, type WriteBatch,
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
  const reason = requiredString(value, 'Change reason', 500);
  if (reason.length < 5) {
    throw new HttpsError('invalid-argument', 'Change reason must be at least 5 characters');
  }
  return reason;
}

const EDITOR_ROLES = ['super_admin', 'admin'];
const ADMIN_ROLES = ['super_admin', 'admin'];
const GENERATOR_ROLES = [
  'super_admin', 'admin', 'head_qa', 'qa_manager', 'qa_executive',
  'qc_manager', 'qc_executive', 'production_manager', 'production_executive',
  'warehouse_manager', 'engineering_manager', 'regulatory_affairs',
];

const DOCUMENT_NUMBERING_MODULES = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Audit', 'Vendor Qualification',
  'Validation', 'CSV', 'Equipment', 'Calibration', 'Maintenance', 'Warehouse',
  'eBMR', 'Admin', 'Risk Management', 'Qualification', 'Batch', 'Product',
] as const;

const YEAR_FORMATS = ['YYYY', 'YY', 'None'] as const;
const MONTH_FORMATS = ['MM', 'MMM', 'None'] as const;
const SEPARATORS = ['/', '-', '_', 'None'] as const;
const RESET_FREQUENCIES = ['Never', 'Yearly', 'Monthly', 'Daily'] as const;
const REVISION_FORMATS = ['00', '01', 'Rev-00', 'R00', 'V1.0', 'Custom'] as const;

const SEQUENCES = 'document_numbering_sequences';
const SEQUENCES_LEGACY = 'document_number_sequences';
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DOC_TYPE_ALIASES: Record<string, string[]> = {
  'PQR Report': ['Annual PQR', 'PQR'],
  'Annual PQR': ['PQR Report'],
  'Deviation Report': ['GMP Deviation', 'Deviation'],
  'GMP Deviation': ['Deviation Report'],
  'CAPA Report': ['Corrective Action', 'CAPA'],
  'Corrective Action': ['CAPA Report'],
  'Complaint Investigation': ['Market Complaint', 'Complaint'],
  'Market Complaint': ['Complaint Investigation'],
  'Recall Report': ['Product Recall', 'Recall'],
  'Product Recall': ['Recall Report'],
  'Risk Assessment': ['Risk'],
  'Batch Number': ['Batch'],
};

function buildNumberingId(code: string): string {
  return `NUM-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Active document numbering editor access required');
  }
}

function assertAdmin(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !ADMIN_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Active administrator access required');
  }
}

function assertGenerator(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !GENERATOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Active user access required to generate numbers');
  }
}

function validateEnum<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  const str = String(value ?? fallback);
  if (!allowed.includes(str as T)) {
    throw new HttpsError('invalid-argument', `Invalid ${field}`);
  }
  return str as T;
}

function numberingNotification(
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
    moduleName: 'Document Numbering',
    eventName,
    recordId,
    priority: 'High',
    notificationChannel: 'In-App',
    readStatus: 'Unread',
    sentStatus: 'Sent',
    isRead: false,
    actionLink: `/admin/document-numbering/${recordId}`,
    createdAt: now,
    readAt: null,
    readBy: [],
    readAtBy: {},
  };
}

function writeNumberingAudit(
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
    module: 'Document Numbering',
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
    collectionName: 'document_numbering',
    documentId: input.recordId,
    action: input.action,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    userId: input.actorUid,
    userName: input.actorName,
    moduleName: 'Document Numbering',
    reason: input.reason,
    timestamp: input.now,
  });
}

function parseFormatTokens(formatTokens: string): string[] {
  return formatTokens.split(',').map((t) => t.trim()).filter(Boolean);
}

function formatYear(yearFormat: string, date: Date): string {
  if (yearFormat === 'None') return '';
  const y = date.getFullYear();
  return yearFormat === 'YY' ? String(y).slice(-2) : String(y);
}

function formatMonth(monthFormat: string, date: Date): string {
  if (monthFormat === 'None') return '';
  const m = date.getMonth();
  if (monthFormat === 'MMM') return MONTH_ABBR[m];
  return String(m + 1).padStart(2, '0');
}

function formatRevision(revisionFormat: string, revision?: string): string {
  if (revision) return revision;
  switch (revisionFormat) {
    case '01': return '01';
    case 'Rev-00': return 'Rev-00';
    case 'R00': return 'R00';
    case 'V1.0': return 'V1.0';
    default: return '00';
  }
}

function documentTypeToken(documentType: string): string {
  const map: Record<string, string> = {
    'CSV URS': 'URS', 'CSV IQ': 'IQ', 'CSV OQ': 'OQ', 'CSV PQ': 'PQ',
    'Validation Protocol': 'VAL', 'Validation Report': 'VAL',
  };
  if (map[documentType]) return map[documentType];
  return (documentType.split(' ')[0] || documentType).toUpperCase().slice(0, 6);
}

function getSeparatorChar(separator: string): string {
  return separator === 'None' ? '' : separator;
}

function getPeriodKey(resetFrequency: string, date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  switch (resetFrequency) {
    case 'Yearly': return `${y}`;
    case 'Monthly': return `${y}-${m}`;
    case 'Daily': return `${y}-${m}-${d}`;
    default: return 'all';
  }
}

function sequenceDocId(numberingId: string, periodKey: string): string {
  return `${numberingId}__${periodKey}`;
}

export function buildDocumentNumberFromFormat(
  format: Record<string, unknown>,
  options: {
    siteCode?: string;
    departmentCode?: string;
    productCode?: string;
    revision?: string;
    runningNumber: number;
    date?: Date;
  },
): string {
  const date = options.date ?? new Date();
  const tokens = parseFormatTokens(String(format.formatTokens || 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR'));
  const sep = getSeparatorChar(String(format.separator || '/'));
  const runLen = Number(format.runningNumberLength ?? format.runningNumber ?? 4);
  const paddedRun = String(options.runningNumber).padStart(runLen, '0');
  const suffix = String(format.suffix || '');

  const parts = tokens.map((token) => {
    switch (token) {
      case 'PREFIX': return String(format.prefix || '');
      case 'SITE_CODE': return options.siteCode || String(format.siteCode || '');
      case 'DEPARTMENT_CODE': return options.departmentCode || String(format.departmentCode || '');
      case 'PRODUCT_CODE': return options.productCode || String(format.productCodeOptional || format.product || '');
      case 'DOCUMENT_TYPE': return documentTypeToken(String(format.documentType || ''));
      case 'RUNNING_NUMBER': return paddedRun;
      case 'MONTH': return formatMonth(String(format.monthFormat || 'None'), date);
      case 'YEAR': return formatYear(String(format.yearFormat || 'YYYY'), date);
      case 'REVISION': return formatRevision(String(format.revisionFormat || '00'), options.revision);
      default: return '';
    }
  }).filter((p) => p !== '');

  const body = !sep ? parts.join('') : parts.join(sep);
  return suffix ? `${body}${sep || ''}${suffix}` : body;
}

function parseNumberingPayload(data: Record<string, unknown>) {
  const numberingCode = requiredString(data.numberingCode, 'Numbering code', 80).toUpperCase();
  const moduleName = validateEnum(data.moduleName, DOCUMENT_NUMBERING_MODULES, 'moduleName', 'PQR');
  const documentType = requiredString(data.documentType, 'Document type', 120);
  const prefix = requiredString(data.prefix, 'Prefix', 40);
  const yearFormat = validateEnum(data.yearFormat, YEAR_FORMATS, 'yearFormat', 'YYYY');
  const monthFormat = validateEnum(data.monthFormat, MONTH_FORMATS, 'monthFormat', 'None');
  const separator = validateEnum(data.separator, SEPARATORS, 'separator', '/');
  const resetFrequency = validateEnum(data.resetFrequency, RESET_FREQUENCIES, 'resetFrequency', 'Yearly');
  const revisionFormat = validateEnum(data.revisionFormat, REVISION_FORMATS, 'revisionFormat', '00');
  const formatTokens = requiredString(data.formatTokens || 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR', 'Format tokens', 500);
  const runningNumberLength = Math.max(1, Math.min(12, Number(data.runningNumberLength) || 4));
  const startingNumber = Math.max(0, Number(data.startingNumber ?? 0) || 0);
  const currentRunningNumber = Math.max(0, Number(data.currentRunningNumber ?? startingNumber) || 0);

  if (resetFrequency === 'Yearly' && !formatTokens.includes('YEAR') && yearFormat !== 'None') {
    throw new HttpsError('invalid-argument', 'Yearly reset should include YEAR token in format');
  }
  if (resetFrequency === 'Monthly' && !formatTokens.includes('MONTH') && monthFormat !== 'None') {
    throw new HttpsError('invalid-argument', 'Monthly reset should include MONTH token in format');
  }

  const numberingId = buildNumberingId(numberingCode);
  const preview = buildDocumentNumberFromFormat({
    prefix, suffix: optionalString(data.suffix, 'suffix', 40),
    siteCode: optionalString(data.siteCode, 'siteCode', 40),
    departmentCode: optionalString(data.departmentCode, 'departmentCode', 40),
    productCodeOptional: optionalString(data.productCodeOptional, 'productCodeOptional', 80),
    product: optionalString(data.product, 'product', 80),
    documentType, formatTokens, separator, yearFormat, monthFormat, revisionFormat,
    runningNumberLength,
  }, { runningNumber: currentRunningNumber || startingNumber || 1 });

  return {
    numberingId,
    numberingCode,
    numberingName: optionalString(data.numberingName, 'numberingName', 200) || `${moduleName} ${documentType}`,
    description: optionalString(data.description, 'description', 2000),
    moduleName,
    module: moduleName,
    documentType,
    documentCategory: optionalString(data.documentCategory, 'documentCategory', 80),
    department: optionalString(data.department, 'department', 120),
    site: optionalString(data.site, 'site', 120),
    businessUnit: optionalString(data.businessUnit, 'businessUnit', 120),
    company: optionalString(data.company, 'company', 120),
    location: optionalString(data.location, 'location', 120),
    product: optionalString(data.product, 'product', 120),
    workflowCode: optionalString(data.workflowCode, 'workflowCode', 80),
    prefix,
    suffix: optionalString(data.suffix, 'suffix', 40),
    siteCode: optionalString(data.siteCode, 'siteCode', 40),
    departmentCode: optionalString(data.departmentCode, 'departmentCode', 40),
    productCodeOptional: optionalString(data.productCodeOptional, 'productCodeOptional', 80),
    yearFormat,
    monthFormat,
    separator,
    runningNumberLength,
    runningNumber: runningNumberLength,
    startingNumber,
    currentRunningNumber,
    currentNumber: currentRunningNumber,
    resetFrequency,
    revisionFormat,
    formatTokens,
    exampleNumberPreview: preview,
    exampleFormat: preview,
    numberingVersion: optionalString(data.numberingVersion, 'numberingVersion', 20) || '1.0',
    effectiveDate: optionalString(data.effectiveDate, 'effectiveDate', 40),
    reviewDate: optionalString(data.reviewDate, 'reviewDate', 40),
    autoGenerateEnabled: data.autoGenerateEnabled !== false,
    manualOverrideAllowed: Boolean(data.manualOverrideAllowed),
    allowSkipSequence: Boolean(data.allowSkipSequence),
    remarks: optionalString(data.remarks, 'remarks', 2000),
  };
}

async function assertUniqueNumbering(
  firestore: Firestore,
  code: string,
  name: string,
  excludeId?: string,
) {
  const [codeSnap, nameSnap] = await Promise.all([
    firestore.collection('document_numbering').where('numberingCode', '==', code).limit(5).get(),
    firestore.collection('document_numbering').where('numberingName', '==', name).limit(5).get(),
  ]);
  if (codeSnap.docs.some((d) => d.id !== excludeId && d.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Numbering code already exists');
  }
  if (name && nameSnap.docs.some((d) => d.id !== excludeId && d.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Numbering rule name already exists');
  }
}

async function assertNoDuplicateActive(
  firestore: Firestore,
  moduleName: string,
  documentType: string,
  excludeId?: string,
) {
  const snap = await firestore.collection('document_numbering')
    .where('moduleName', '==', moduleName)
    .where('status', '==', 'Active')
    .limit(20)
    .get();
  const dup = snap.docs.find((d) =>
    d.id !== excludeId
    && d.data().isDeleted !== true
    && d.data().documentType === documentType,
  );
  if (dup) {
    throw new HttpsError('already-exists', 'An active numbering format already exists for this module and document type');
  }
}

function normalizeMatchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function findActiveFormat(
  firestore: Firestore,
  moduleName: string,
  documentType: string,
): Promise<{ id: string; data: DocumentData } | null> {
  const snap = await firestore.collection('document_numbering')
    .where('status', '==', 'Active')
    .limit(50)
    .get();
  const active = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    .filter((r) => r.data.isDeleted !== true && r.data.isArchived !== true);

  const exact = active.find((r) =>
    r.data.moduleName === moduleName && r.data.documentType === documentType,
  );
  if (exact) return exact;

  const aliases = DOC_TYPE_ALIASES[documentType] || [];
  const aliasHit = active.find((r) =>
    r.data.moduleName === moduleName
    && (aliases.includes(String(r.data.documentType))
      || normalizeMatchKey(String(r.data.documentType)).includes(normalizeMatchKey(documentType))
      || normalizeMatchKey(documentType).includes(normalizeMatchKey(String(r.data.documentType)))),
  );
  if (aliasHit) return aliasHit;

  // Fuzzy module aliases (CMP→Complaint, REC→Recall, RISK→Risk Management)
  const moduleAliases: Record<string, string[]> = {
    CMP: ['Complaint'], REC: ['Recall'], RISK: ['Risk Management'],
    Complaint: ['CMP'], Recall: ['REC'], 'Risk Management': ['RISK'],
  };
  const mods = [moduleName, ...(moduleAliases[moduleName] || [])];
  return active.find((r) =>
    mods.includes(String(r.data.moduleName))
    && (r.data.documentType === documentType
      || aliases.includes(String(r.data.documentType))
      || normalizeMatchKey(String(r.data.documentType)).includes(normalizeMatchKey(documentType))),
  ) || null;
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
    const firestore = getAdminFirestore();
  const actorSnap = await firestore.collection('users').doc(request.auth.uid).get();
  const actor = actorSnap.data();
  const actorRole = String(actor?.role || '');
  const actorName = String(actor?.full_name || actor?.fullName || actor?.email || 'Admin');
  return { firestore, actor, actorRole, actorName, actorUid: request.auth.uid };
}

export const createAdminDocumentNumbering = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const reason = optionalString(data.reason || data.changeReason, 'reason', 500)
    || 'Initial numbering rule registration';
  const payload = parseNumberingPayload(data);
  await assertUniqueNumbering(firestore, payload.numberingCode, payload.numberingName);
  await assertNoDuplicateActive(firestore, payload.moduleName, payload.documentType);

  const now = new Date().toISOString();
  const ref = firestore.collection('document_numbering').doc();
  const batch = firestore.batch();
  const record = {
    ...payload,
    status: 'Active',
    isArchived: false,
    isDeleted: false,
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
  batch.set(ref, record);
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, action: 'CREATE_NUMBERING_FORMAT',
    oldValue: null, newValue: record, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), numberingNotification(
    actorUid, ref.id, 'Rule Created', 'Numbering Rule Created',
    `Rule ${payload.numberingName} (${payload.numberingCode}) was created.`, now,
  ));
  await batch.commit();
  return { id: ref.id, ...record };
});

export const updateAdminDocumentNumbering = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const numberingDocId = requiredString(data.numberingDocId, 'Numbering ID', 128);
  const reason = requiredReason(data.reason || data.changeReason);
  const existingSnap = await firestore.collection('document_numbering').doc(numberingDocId).get();
  if (!existingSnap.exists) throw new HttpsError('not-found', 'Numbering rule not found');
  const existing = existingSnap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Cannot update a deleted rule');

  const updates = (data.updates || data) as Record<string, unknown>;
  const payload = parseNumberingPayload({ ...existing, ...updates });
  await assertUniqueNumbering(firestore, payload.numberingCode, payload.numberingName, numberingDocId);
  if ((existing.status || 'Active') === 'Active') {
    await assertNoDuplicateActive(firestore, payload.moduleName, payload.documentType, numberingDocId);
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  const next = {
    ...payload,
    status: existing.status || 'Active',
    isArchived: existing.isArchived ?? false,
    isDeleted: false,
    updatedAt: now,
    updatedBy: actorUid,
  };
  batch.update(existingSnap.ref, next);
  if (existing.manualOverrideAllowed !== payload.manualOverrideAllowed) {
    writeNumberingAudit(batch, firestore, {
      actorUid, actorName, recordId: numberingDocId, action: 'MANUAL_OVERRIDE_TOGGLE',
      oldValue: existing.manualOverrideAllowed, newValue: payload.manualOverrideAllowed, reason, now,
    });
  }
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: numberingDocId, action: 'EDIT_NUMBERING_FORMAT',
    oldValue: existing, newValue: next, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), numberingNotification(
    actorUid, numberingDocId, 'Rule Updated', 'Numbering Rule Updated',
    `Rule ${payload.numberingName} was updated.`, now,
  ));
  await batch.commit();
  return { format: { id: numberingDocId, ...existing, ...next } };
});

export const setAdminDocumentNumberingStatus = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const numberingDocId = requiredString(data.numberingDocId, 'Numbering ID', 128);
  const reason = requiredReason(data.reason);
  const status = validateEnum(data.numberingStatus || data.status, ['Active', 'Inactive'] as const, 'status', 'Active');
  const snap = await firestore.collection('document_numbering').doc(numberingDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Numbering rule not found');
  const existing = snap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Rule is deleted');
  if (status === 'Active') {
    await assertNoDuplicateActive(
      firestore,
      String(existing.moduleName),
      String(existing.documentType),
      numberingDocId,
    );
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, { status, updatedAt: now, updatedBy: actorUid });
  const action = status === 'Active' ? 'ACTIVATE_NUMBERING_FORMAT' : 'DEACTIVATE_NUMBERING_FORMAT';
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: numberingDocId, action,
    oldValue: existing.status, newValue: status, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const archiveAdminDocumentNumbering = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const numberingDocId = requiredString(data.numberingDocId, 'Numbering ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('document_numbering').doc(numberingDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Numbering rule not found');
  const existing = snap.data()!;

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    isArchived: true, status: 'Inactive', updatedAt: now, updatedBy: actorUid,
  });
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: numberingDocId, action: 'ARCHIVE_NUMBERING_FORMAT',
    oldValue: existing, newValue: { isArchived: true }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const softDeleteAdminDocumentNumbering = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const numberingDocId = requiredString(data.numberingDocId, 'Numbering ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('document_numbering').doc(numberingDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Numbering rule not found');
  const existing = snap.data()!;
  if (existing.isDeleted === true) throw new HttpsError('failed-precondition', 'Already deleted');
  if (existing.status === 'Active') {
    throw new HttpsError('failed-precondition', 'Deactivate rule before deleting');
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    isDeleted: true, deletedAt: now, deletedBy: actorUid,
    status: 'Inactive', updatedAt: now, updatedBy: actorUid,
  });
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: numberingDocId, action: 'SOFT_DELETE_NUMBERING_FORMAT',
    oldValue: existing, newValue: { isDeleted: true }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const restoreAdminDocumentNumbering = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const numberingDocId = requiredString(data.numberingDocId, 'Numbering ID', 128);
  const reason = requiredReason(data.reason);
  const snap = await firestore.collection('document_numbering').doc(numberingDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Numbering rule not found');
  const existing = snap.data()!;
  if (existing.isDeleted !== true) throw new HttpsError('failed-precondition', 'Rule is not deleted');

  await assertUniqueNumbering(
    firestore,
    String(existing.numberingCode || ''),
    String(existing.numberingName || ''),
    numberingDocId,
  );

  const now = new Date().toISOString();
  const batch = firestore.batch();
  batch.update(snap.ref, {
    isDeleted: false, deletedAt: null, deletedBy: null,
    updatedAt: now, updatedBy: actorUid,
  });
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: numberingDocId, action: 'RESTORE_NUMBERING_FORMAT',
    oldValue: { isDeleted: true }, newValue: { isDeleted: false }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const cloneAdminDocumentNumbering = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const sourceId = requiredString(data.sourceNumberingDocId || data.sourceId, 'Source ID', 128);
  const newCode = requiredString(data.newCode, 'New numbering code', 80).toUpperCase();
  const newName = optionalString(data.newName, 'newName', 200);
  const reason = optionalString(data.reason, 'reason', 500) || `Cloned from ${sourceId}`;

  const sourceSnap = await firestore.collection('document_numbering').doc(sourceId).get();
  if (!sourceSnap.exists) throw new HttpsError('not-found', 'Source rule not found');
  const source = sourceSnap.data()!;

  const payload = parseNumberingPayload({
    ...source,
    numberingCode: newCode,
    numberingName: newName || `${source.numberingName || source.numberingCode} (Copy)`,
    currentRunningNumber: source.startingNumber ?? 0,
  });
  await assertUniqueNumbering(firestore, payload.numberingCode, payload.numberingName);

  const now = new Date().toISOString();
  const ref = firestore.collection('document_numbering').doc();
  const batch = firestore.batch();
  const record = {
    ...payload,
    status: 'Inactive',
    isArchived: false,
    isDeleted: false,
    clonedFrom: sourceId,
    createdAt: now,
    createdBy: actorUid,
    updatedAt: now,
    updatedBy: actorUid,
  };
  batch.set(ref, record);
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, action: 'CLONE_NUMBERING_FORMAT',
    oldValue: { sourceId }, newValue: record, reason, now,
  });
  await batch.commit();
  return { id: ref.id, ...record };
});

export const bulkUpdateAdminDocumentNumberings = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const ids = data.numberingDocIds as string[];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
    throw new HttpsError('invalid-argument', 'Select 1–50 rules');
  }
  const action = validateEnum(data.action, ['activate', 'deactivate', 'archive'] as const, 'action', 'activate');
  const reason = requiredReason(data.reason);
  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      const snap = await firestore.collection('document_numbering').doc(id).get();
      if (!snap.exists || snap.data()?.isDeleted === true) continue;
      const existing = snap.data()!;
      const batch = firestore.batch();
      if (action === 'archive') {
        batch.update(snap.ref, { isArchived: true, status: 'Inactive', updatedAt: now, updatedBy: actorUid });
      } else if (action === 'activate') {
        await assertNoDuplicateActive(
          firestore,
          String(existing.moduleName),
          String(existing.documentType),
          id,
        );
        batch.update(snap.ref, { status: 'Active', updatedAt: now, updatedBy: actorUid });
      } else {
        batch.update(snap.ref, { status: 'Inactive', updatedAt: now, updatedBy: actorUid });
      }
      writeNumberingAudit(batch, firestore, {
        actorUid, actorName, recordId: id, action: `BULK_${action.toUpperCase()}_NUMBERING`,
        oldValue: existing.status, newValue: action, reason, now,
      });
      await batch.commit();
      successCount += 1;
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  return { successCount, errors };
});

export const bulkSoftDeleteAdminDocumentNumberings = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertAdmin(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const ids = data.numberingDocIds as string[];
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) {
    throw new HttpsError('invalid-argument', 'Select 1–50 rules');
  }
  const reason = requiredReason(data.reason);
  const now = new Date().toISOString();
  let successCount = 0;
  const errors: string[] = [];

  for (const id of ids) {
    try {
      const snap = await firestore.collection('document_numbering').doc(id).get();
      if (!snap.exists) continue;
      const existing = snap.data()!;
      if (existing.isDeleted === true) continue;
      if (existing.status === 'Active') {
        errors.push(`${existing.numberingCode}: deactivate first`);
        continue;
      }
      const batch = firestore.batch();
      batch.update(snap.ref, {
        isDeleted: true, deletedAt: now, deletedBy: actorUid,
        status: 'Inactive', updatedAt: now, updatedBy: actorUid,
      });
      writeNumberingAudit(batch, firestore, {
        actorUid, actorName, recordId: id, action: 'BULK_SOFT_DELETE_NUMBERING',
        oldValue: existing, newValue: { isDeleted: true }, reason, now,
      });
      await batch.commit();
      successCount += 1;
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  return { successCount, errors };
});

/**
 * Atomic document number generation (or preview without increment).
 */
export const generateAdminDocumentNumber = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertGenerator(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const moduleName = requiredString(data.moduleName, 'Module', 80);
  const documentType = requiredString(data.documentType, 'Document type', 120);
  // Default is preview-safe: only mutate when increment is explicitly true
  const increment = data.increment === true && data.preview !== true;
  const previewOnly = !increment;
  const date = data.date ? new Date(String(data.date)) : new Date();
  if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'Invalid date');

  const formatHit = await findActiveFormat(firestore, moduleName, documentType);
  if (!formatHit) {
    throw new HttpsError('not-found', `No active numbering format for ${moduleName} / ${documentType}`);
  }
  const format = formatHit.data;
  if (format.autoGenerateEnabled === false && !data.manualNumber) {
    throw new HttpsError('failed-precondition', 'Auto generate is disabled for this format');
  }

  if (data.manualNumber) {
    if (!format.manualOverrideAllowed && data.allowManualOverride !== true) {
      throw new HttpsError('permission-denied', 'Manual override is not allowed for this format');
    }
    const manual = requiredString(data.manualNumber, 'Manual number', 120);
    const dup = await firestore.collection(SEQUENCES)
      .where('lastGeneratedNumber', '==', manual)
      .limit(1)
      .get();
    if (!dup.empty) throw new HttpsError('already-exists', 'Document number already exists');
    return { number: manual, formatId: formatHit.id, preview: false };
  }

  const numberingId = String(format.numberingId || buildNumberingId(String(format.numberingCode || formatHit.id)));
  const periodKey = getPeriodKey(String(format.resetFrequency || 'Yearly'), date);
  const seqRef = firestore.collection(SEQUENCES).doc(sequenceDocId(numberingId, periodKey));
  const startingNumber = Math.max(0, Number(format.startingNumber ?? 0) || 0);

  if (previewOnly) {
    const seqDoc = await seqRef.get();
    let current = seqDoc.exists
      ? Number(seqDoc.data()?.currentValue ?? 0)
      : (format.resetFrequency === 'Never' ? Number(format.currentRunningNumber ?? startingNumber) : startingNumber);
    const nextNumber = current + 1;
    const number = buildDocumentNumberFromFormat(format, {
      siteCode: optionalString(data.siteCode, 'siteCode', 40) || undefined,
      departmentCode: optionalString(data.departmentCode, 'departmentCode', 40) || undefined,
      productCode: optionalString(data.productCode, 'productCode', 80) || undefined,
      revision: optionalString(data.revision, 'revision', 40) || undefined,
      runningNumber: nextNumber,
      date,
    });
    return { number, formatId: formatHit.id, preview: true, nextRunningNumber: nextNumber };
  }

  const result = await firestore.runTransaction(async (tx) => {
    const seqDoc = await tx.get(seqRef);
    let current = seqDoc.exists
      ? Number(seqDoc.data()?.currentValue ?? 0)
      : (format.resetFrequency === 'Never' ? Number(format.currentRunningNumber ?? startingNumber) : startingNumber);
    const nextNumber = current + 1;
    const number = buildDocumentNumberFromFormat(format, {
      siteCode: optionalString(data.siteCode, 'siteCode', 40) || undefined,
      departmentCode: optionalString(data.departmentCode, 'departmentCode', 40) || undefined,
      productCode: optionalString(data.productCode, 'productCode', 80) || undefined,
      revision: optionalString(data.revision, 'revision', 40) || undefined,
      runningNumber: nextNumber,
      date,
    });

    tx.set(seqRef, {
      numberingId,
      periodKey,
      currentValue: nextNumber,
      formatId: formatHit.id,
      lastGeneratedNumber: number,
      moduleName: String(format.moduleName || moduleName),
      documentType: String(format.documentType || documentType),
      updatedAt: new Date().toISOString(),
      updatedBy: actorUid,
    }, { merge: true });

    tx.update(firestore.collection('document_numbering').doc(formatHit.id), {
      currentRunningNumber: nextNumber,
      currentNumber: nextNumber,
      updatedAt: new Date().toISOString(),
      updatedBy: actorUid,
    });

    return { number, nextNumber };
  });

  // Dual-write legacy sequence collection for backward compatibility
  try {
    await firestore.collection(SEQUENCES_LEGACY).doc(sequenceDocId(numberingId, periodKey)).set({
      numberingId,
      periodKey,
      currentValue: result.nextNumber,
      formatId: formatHit.id,
      lastGeneratedNumber: result.number,
      moduleName: String(format.moduleName || moduleName),
      documentType: String(format.documentType || documentType),
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  } catch {
    // non-fatal
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: formatHit.id, action: 'NUMBER_GENERATED',
    oldValue: null, newValue: { number: result.number, moduleName, documentType }, reason: 'Atomic number generation', now,
  });
  await batch.commit();

  return { number: result.number, formatId: formatHit.id, preview: false, nextRunningNumber: result.nextNumber };
});

export const resetAdminDocumentNumberingSequence = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const numberingDocId = requiredString(data.numberingDocId, 'Numbering ID', 128);
  const reason = requiredReason(data.reason);
  const resetTo = Math.max(0, Number(data.resetTo ?? 0) || 0);
  const snap = await firestore.collection('document_numbering').doc(numberingDocId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Numbering rule not found');
  const format = snap.data()!;
  const numberingId = String(format.numberingId || buildNumberingId(String(format.numberingCode)));
  const periodKey = getPeriodKey(String(format.resetFrequency || 'Yearly'), new Date());
  const now = new Date().toISOString();

  await firestore.collection(SEQUENCES).doc(sequenceDocId(numberingId, periodKey)).set({
    numberingId, periodKey, currentValue: resetTo, formatId: numberingDocId,
    updatedAt: now, updatedBy: actorUid,
  }, { merge: true });

  const batch = firestore.batch();
  batch.update(snap.ref, {
    currentRunningNumber: resetTo, currentNumber: resetTo,
    updatedAt: now, updatedBy: actorUid,
  });
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: numberingDocId, action: 'RESET_RUNNING_NUMBER',
    oldValue: format.currentRunningNumber, newValue: resetTo, reason, now,
  });
  batch.set(firestore.collection('notifications').doc(), numberingNotification(
    actorUid, numberingDocId, 'Sequence Reset', 'Sequence Reset',
    `Sequence for ${format.numberingCode} reset to ${resetTo}.`, now,
  ));
  await batch.commit();
  return { success: true, resetTo };
});

export const previewAdminDocumentNumber = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertGenerator(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const moduleName = requiredString(data.moduleName, 'Module', 80);
  const documentType = requiredString(data.documentType, 'Document type', 120);
  const date = data.date ? new Date(String(data.date)) : new Date();

  const formatHit = await findActiveFormat(firestore, moduleName, documentType);
  if (!formatHit) {
    throw new HttpsError('not-found', `No active numbering format for ${moduleName} / ${documentType}`);
  }
  const format = formatHit.data;
  const numberingId = String(format.numberingId || buildNumberingId(String(format.numberingCode || formatHit.id)));
  const periodKey = getPeriodKey(String(format.resetFrequency || 'Yearly'), date);
  const seqRef = firestore.collection(SEQUENCES).doc(sequenceDocId(numberingId, periodKey));
  const startingNumber = Math.max(0, Number(format.startingNumber ?? 0) || 0);
  const seqDoc = await seqRef.get();
  let current = seqDoc.exists
    ? Number(seqDoc.data()?.currentValue ?? 0)
    : (format.resetFrequency === 'Never' ? Number(format.currentRunningNumber ?? startingNumber) : startingNumber);
  const nextNumber = current + 1;
  const number = buildDocumentNumberFromFormat(format, {
    siteCode: optionalString(data.siteCode, 'siteCode', 40) || undefined,
    departmentCode: optionalString(data.departmentCode, 'departmentCode', 40) || undefined,
    productCode: optionalString(data.productCode, 'productCode', 80) || undefined,
    revision: optionalString(data.revision, 'revision', 40) || undefined,
    runningNumber: nextNumber,
    date,
  });
  return { number, formatId: formatHit.id, preview: true, nextRunningNumber: nextNumber };
});

export const listAdminDocumentNumberHistory = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertGenerator(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const numberingId = optionalString(data.numberingId, 'numberingId', 128);
  const formatId = optionalString(data.formatId, 'formatId', 128);

  let snap;
  if (numberingId) {
    snap = await firestore.collection(SEQUENCES).where('numberingId', '==', numberingId).limit(30).get();
  } else if (formatId) {
    snap = await firestore.collection(SEQUENCES).where('formatId', '==', formatId).limit(30).get();
  } else {
    snap = await firestore.collection(SEQUENCES).orderBy('updatedAt', 'desc').limit(30).get();
  }

  const history = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String((b as { updatedAt?: string }).updatedAt || '')
      .localeCompare(String((a as { updatedAt?: string }).updatedAt || '')));
  return { history };
});

export const importAdminDocumentNumberings = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const rows = data.rows as Record<string, unknown>[];
  if (!Array.isArray(rows) || rows.length < 1) {
    throw new HttpsError('invalid-argument', 'No rows to import');
  }
  if (rows.length > 50) throw new HttpsError('invalid-argument', 'Maximum 50 rows per import');
  const reason = optionalString(data.reason, 'reason', 500) || 'CSV numbering import';
  let imported = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (let i = 0; i < rows.length; i++) {
    try {
      const payload = parseNumberingPayload(rows[i]);
      await assertUniqueNumbering(firestore, payload.numberingCode, payload.numberingName);
      const ref = firestore.collection('document_numbering').doc();
      const batch = firestore.batch();
      const record = {
        ...payload, status: 'Inactive', isArchived: false, isDeleted: false,
        createdAt: now, createdBy: actorUid, updatedAt: now, updatedBy: actorUid,
      };
      batch.set(ref, record);
      writeNumberingAudit(batch, firestore, {
        actorUid, actorName, recordId: ref.id, action: 'IMPORT_NUMBERING_FORMAT',
        oldValue: null, newValue: record, reason, now,
      });
      await batch.commit();
      imported += 1;
    } catch (e) {
      errors.push(`Row ${i + 1}: ${(e as Error).message}`);
    }
  }
  return { imported, errors };
});

export const logAdminDocumentNumberingExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const count = Number(data.count || 0);
  const reason = optionalString(data.reason, 'reason', 500) || 'Numbering list export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeNumberingAudit(batch, firestore, {
    actorUid, actorName, recordId: 'export', action: 'EXPORT_NUMBERING_LIST',
    oldValue: null, newValue: { count }, reason, now,
  });
  await batch.commit();
  return { success: true };
});

export const seedAdminDefaultDocumentNumberings = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);

  const data = (request.data || {}) as Record<string, unknown>;
  const presets = data.presets as Record<string, unknown>[];
  if (!Array.isArray(presets) || presets.length < 1) {
    throw new HttpsError('invalid-argument', 'No presets provided');
  }
  const reason = optionalString(data.reason, 'reason', 500) || 'Seed default numbering rules';
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const preset of presets) {
    try {
      const payload = parseNumberingPayload(preset);
      const existing = await firestore.collection('document_numbering')
        .where('numberingCode', '==', payload.numberingCode)
        .limit(1)
        .get();
      if (existing.docs.some((d) => d.data().isDeleted !== true)) {
        skipped += 1;
        continue;
      }
      const ref = firestore.collection('document_numbering').doc();
      const batch = firestore.batch();
      const record = {
        ...payload, status: 'Active', isArchived: false, isDeleted: false,
        createdAt: now, createdBy: actorUid, updatedAt: now, updatedBy: actorUid,
      };
      batch.set(ref, record);
      writeNumberingAudit(batch, firestore, {
        actorUid, actorName, recordId: ref.id, action: 'SEED_NUMBERING_FORMAT',
        oldValue: null, newValue: record, reason, now,
      });
      await batch.commit();
      created += 1;
    } catch {
      skipped += 1;
    }
  }
  return { created, skipped };
});
