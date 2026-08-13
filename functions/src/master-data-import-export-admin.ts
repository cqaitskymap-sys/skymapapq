/**
 * Master Data Import / Export — privileged Cloud Functions hub.
 * Orchestrates validated bulk import/export with Part 11 operation logging.
 */
import { createHash } from 'crypto';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { type Firestore, type DocumentData,
} from 'firebase-admin/firestore';
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

function optionalString(value: unknown, field: string, maxLength = 20000): string {
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

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'];
const EDITOR_ROLES = ['super_admin', 'admin'];
const MAX_ROWS = 200;
const MAX_EXPORT = 1000;

const MASTER_CATALOG: Array<{
  code: string;
  label: string;
  collection: string;
  uniqueKey: string;
  required: string[];
}> = [
  { code: 'departments', label: 'Department Master', collection: 'departments', uniqueKey: 'departmentCode', required: ['departmentCode', 'departmentName'] },
  { code: 'designations', label: 'Designation Master', collection: 'designations', uniqueKey: 'designationCode', required: ['designationCode', 'designationName'] },
  { code: 'company_sites', label: 'Company / Site Master', collection: 'company_sites', uniqueKey: 'siteCode', required: ['siteCode', 'siteName'] },
  { code: 'products', label: 'Product Master', collection: 'products', uniqueKey: 'productCode', required: ['productCode', 'productName'] },
  { code: 'batches', label: 'Batch Master', collection: 'batches', uniqueKey: 'batchNumber', required: ['batchNumber'] },
  { code: 'parameters', label: 'Parameter Master', collection: 'parameters', uniqueKey: 'parameterCode', required: ['parameterCode', 'parameterName'] },
  { code: 'workflows', label: 'Workflow Configuration', collection: 'workflows', uniqueKey: 'workflowCode', required: ['workflowCode', 'workflowName'] },
  { code: 'approval_matrix', label: 'Approval Matrix', collection: 'approval_matrix', uniqueKey: 'matrixCode', required: ['matrixCode'] },
  { code: 'document_numbering', label: 'Document Numbering', collection: 'document_numbering', uniqueKey: 'numberingCode', required: ['numberingCode'] },
  { code: 'notification_settings', label: 'Notification Settings', collection: 'notification_settings', uniqueKey: 'notificationCode', required: ['notificationCode', 'eventName'] },
  { code: 'email_sms_templates', label: 'Email & SMS Templates', collection: 'email_sms_templates', uniqueKey: 'templateCode', required: ['templateCode', 'templateName', 'body'] },
  { code: 'module_configuration', label: 'Module Configuration', collection: 'module_configuration', uniqueKey: 'moduleCode', required: ['moduleCode', 'moduleName'] },
];

function resolveMaster(codeOrCollection: string) {
  const key = codeOrCollection.trim().toLowerCase();
  const found = MASTER_CATALOG.find((m) => m.code === key || m.collection === key);
  if (!found) {
    throw new HttpsError('invalid-argument', `Unsupported master type: ${codeOrCollection}`);
  }
  return found;
}

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Master Data Import/Export view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Master Data Import/Export edit access required');
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

async function writeImpexAudit(
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    recordId: string;
    actionType: string;
    description: string;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string;
    now: string;
  },
) {
  const batch = firestore.batch();
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-IMPEX-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'Master Data Import/Export',
    collectionName: 'master_data_import_export',
    recordId: input.recordId,
    documentId: input.recordId,
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    reason: input.reason || '',
    performedBy: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    createdAt: input.now,
    source: 'master-data-import-export-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: 'Master Data Import/Export',
    action: input.actionType,
    recordId: input.recordId,
    description: input.description,
    performedBy: input.actorName,
    userId: input.actorUid,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
  });
  await batch.commit();
}

function buildOperationId(type: string): string {
  return `IMPEX-${type.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
}

function sanitizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'id' || key.startsWith('_')) continue;
    if (typeof value === 'string') {
      const cleaned = value.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').trim();
      out[key] = cleaned.slice(0, 5000);
    } else if (typeof value === 'number' || typeof value === 'boolean' || value == null) {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 50);
    } else if (typeof value === 'object') {
      out[key] = value;
    }
  }
  return out;
}

function validateRow(
  row: Record<string, unknown>,
  required: string[],
  index: number,
): string[] {
  const errors: string[] = [];
  for (const field of required) {
    const val = row[field];
    if (val == null || String(val).trim() === '') {
      errors.push(`Row ${index + 1}: missing required field "${field}"`);
    }
  }
  return errors;
}

async function findByUniqueKey(
  firestore: Firestore,
  collectionName: string,
  uniqueKey: string,
  value: string,
) {
  const snap = await firestore.collection(collectionName)
    .where(uniqueKey, '==', value)
    .limit(5)
    .get();
  return snap.docs.find((d) => d.data().isDeleted !== true) || null;
}

function recordsToCsv(records: Array<Record<string, unknown>>): string {
  if (!records.length) return '';
  const keys = Array.from(new Set(records.flatMap((r) => Object.keys(r))));
  const header = keys.map((k) => `"${k}"`).join(',');
  const lines = records.map((r) => keys.map((k) => {
    const v = r[k];
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  }).join(','));
  return `\uFEFF${[header, ...lines].join('\n')}`;
}

export const exportAdminMasterData = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason ?? 'Master data export');
  const master = resolveMaster(requiredString(data.masterType, 'Master type', 80));
  const format = optionalString(data.format, 'Format', 20) || 'JSON';
  const started = Date.now();
  const now = new Date().toISOString();

  const snap = await firestore.collection(master.collection).limit(MAX_EXPORT).get();
  const records = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((r) => (r as DocumentData).isDeleted !== true)
    .map((r) => {
      const copy = { ...r } as Record<string, unknown>;
      // Strip potentially sensitive internal fields from exports for non-super_admin
      if (actorRole !== 'super_admin') {
        delete copy.passwordHash;
        delete copy.mfaSecret;
      }
      return copy;
    });

  const opId = buildOperationId('Export');
  const opRef = firestore.collection('master_data_import_export').doc();
  const payload = {
    operationId: opId,
    operationType: 'Export',
    masterType: master.label,
    masterCollection: master.collection,
    fileName: `${master.code}-export-${Date.now()}.${format.toLowerCase() === 'csv' ? 'csv' : 'json'}`,
    fileFormat: format.toUpperCase() === 'CSV' ? 'CSV' : 'JSON',
    importMode: '',
    recordCount: records.length,
    successCount: records.length,
    errorCount: 0,
    skippedCount: 0,
    operationDate: now,
    performedBy: actorName,
    performedByUid: actorUid,
    operationStatus: 'Success',
    errorLog: '',
    validationSummary: `Exported ${records.length} records`,
    mappingProfile: '',
    changeReason: reason,
    checksum: createHash('sha256').update(JSON.stringify(records.slice(0, 20))).digest('hex').slice(0, 24),
    durationMs: Date.now() - started,
    status: 'Active',
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
  };
  await opRef.set(payload);
  await writeImpexAudit(firestore, {
    actorUid, actorName, recordId: opRef.id, actionType: 'Export Completed',
    description: `Exported ${records.length} ${master.label} records`,
    newValue: { master: master.code, count: records.length, format }, reason, now,
  });

  return {
    success: true,
    operationId: opId,
    operationDocId: opRef.id,
    count: records.length,
    format: payload.fileFormat,
    fileName: payload.fileName,
    records,
    csv: payload.fileFormat === 'CSV' ? recordsToCsv(records) : '',
  };
});

export const validateAdminMasterDataImport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason ?? 'Import validation');
  const master = resolveMaster(requiredString(data.masterType, 'Master type', 80));
  const rows = Array.isArray(data.rows)
    ? (data.rows as Record<string, unknown>[]).slice(0, MAX_ROWS)
    : [];
  if (!rows.length) throw new HttpsError('invalid-argument', 'No import rows provided');

  const errors: string[] = [];
  const preview: Array<Record<string, unknown>> = [];
  let valid = 0;
  let duplicates = 0;

  for (const [index, raw] of rows.entries()) {
    const row = sanitizeRow(raw);
    const rowErrors = validateRow(row, master.required, index);
    errors.push(...rowErrors);
    const keyVal = String(row[master.uniqueKey] || '').trim();
    if (keyVal) {
      const existing = await findByUniqueKey(firestore, master.collection, master.uniqueKey, keyVal);
      if (existing) {
        duplicates += 1;
        row.__exists = true;
        row.__existingId = existing.id;
      } else {
        row.__exists = false;
      }
    }
    if (!rowErrors.length) {
      valid += 1;
      if (preview.length < 25) preview.push(row);
    }
  }

  const now = new Date().toISOString();
  const opId = buildOperationId('Validate');
  const opRef = firestore.collection('master_data_import_export').doc();
  await opRef.set({
    operationId: opId,
    operationType: 'Validate',
    masterType: master.label,
    masterCollection: master.collection,
    fileName: optionalString(data.fileName, 'File name', 200),
    fileFormat: optionalString(data.fileFormat, 'Format', 20) || 'JSON',
    importMode: 'Dry Run',
    recordCount: rows.length,
    successCount: valid,
    errorCount: errors.length,
    skippedCount: duplicates,
    operationDate: now,
    performedBy: actorName,
    performedByUid: actorUid,
    operationStatus: errors.length ? 'Partial Success' : 'Success',
    errorLog: errors.slice(0, 50).join('\n'),
    validationSummary: `${valid} valid, ${errors.length} field errors, ${duplicates} existing keys`,
    changeReason: reason,
    status: 'Active',
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
  });

  await writeImpexAudit(firestore, {
    actorUid, actorName, recordId: opRef.id, actionType: 'Validation Errors',
    description: `Validated ${rows.length} ${master.label} rows`,
    newValue: { valid, errors: errors.length, duplicates }, reason, now,
  });

  return {
    success: true,
    operationId: opId,
    operationDocId: opRef.id,
    total: rows.length,
    valid,
    errorCount: errors.length,
    duplicates,
    errors: errors.slice(0, 40),
    preview,
  };
});

export const importAdminMasterData = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const master = resolveMaster(requiredString(data.masterType, 'Master type', 80));
  const mode = optionalString(data.importMode, 'Import mode', 40) || 'Insert + Update';
  const rows = Array.isArray(data.rows)
    ? (data.rows as Record<string, unknown>[]).slice(0, MAX_ROWS)
    : [];
  if (!rows.length) throw new HttpsError('invalid-argument', 'No import rows provided');

  const dryRun = mode === 'Dry Run';
  const started = Date.now();
  const now = new Date().toISOString();
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const errors: string[] = [];
  const createdIds: string[] = [];

  const opId = buildOperationId('Import');
  const opRef = firestore.collection('master_data_import_export').doc();
  await opRef.set({
    operationId: opId,
    operationType: 'Import',
    masterType: master.label,
    masterCollection: master.collection,
    fileName: optionalString(data.fileName, 'File name', 200),
    fileFormat: optionalString(data.fileFormat, 'Format', 20) || 'JSON',
    importMode: mode,
    recordCount: rows.length,
    successCount: 0,
    errorCount: 0,
    skippedCount: 0,
    operationDate: now,
    performedBy: actorName,
    performedByUid: actorUid,
    operationStatus: 'In Progress',
    errorLog: '',
    validationSummary: '',
    changeReason: reason,
    status: 'Active',
    isDeleted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
  });

  await writeImpexAudit(firestore, {
    actorUid, actorName, recordId: opRef.id, actionType: 'Import Started',
    description: `Import ${mode} started for ${master.label} (${rows.length} rows)`,
    newValue: { mode, master: master.code, count: rows.length }, reason, now,
  });

  for (const [index, raw] of rows.entries()) {
    try {
      const row = sanitizeRow(raw);
      const rowErrors = validateRow(row, master.required, index);
      if (rowErrors.length) {
        errorCount += 1;
        errors.push(...rowErrors);
        continue;
      }
      const keyVal = String(row[master.uniqueKey] || '').trim();
      if (!keyVal) {
        errorCount += 1;
        errors.push(`Row ${index + 1}: unique key ${master.uniqueKey} required`);
        continue;
      }
      const existing = await findByUniqueKey(firestore, master.collection, master.uniqueKey, keyVal);

      if (mode === 'Insert Only' && existing) {
        skippedCount += 1;
        continue;
      }
      if (mode === 'Update Only' && !existing) {
        skippedCount += 1;
        continue;
      }

      if (dryRun) {
        successCount += 1;
        continue;
      }

      const writePayload = {
        ...row,
        [master.uniqueKey]: keyVal,
        updatedAt: now,
        updatedBy: actorUid,
        status: row.status || 'Active',
        isDeleted: false,
      };
      delete (writePayload as Record<string, unknown>).__exists;
      delete (writePayload as Record<string, unknown>).__existingId;

      if (existing) {
        await existing.ref.update(writePayload);
        createdIds.push(existing.id);
      } else {
        const ref = firestore.collection(master.collection).doc();
        await ref.set({
          ...writePayload,
          createdAt: now,
          createdBy: actorUid,
        });
        createdIds.push(ref.id);
      }
      successCount += 1;
    } catch (e) {
      errorCount += 1;
      errors.push(`Row ${index + 1}: ${(e as Error).message}`);
    }
  }

  const status = errorCount === 0
    ? 'Success'
    : successCount > 0
      ? 'Partial Success'
      : 'Failed';
  const finished = new Date().toISOString();
  await opRef.update({
    successCount,
    errorCount,
    skippedCount,
    operationStatus: status,
    errorLog: errors.slice(0, 80).join('\n'),
    validationSummary: `${successCount} ok, ${skippedCount} skipped, ${errorCount} failed`,
    durationMs: Date.now() - started,
    updatedAt: finished,
  });

  for (const err of errors.slice(0, 40)) {
    await firestore.collection('master_data_import_export_errors').doc().set({
      operationId: opId,
      operationDocId: opRef.id,
      masterType: master.code,
      message: err,
      createdAt: finished,
    });
  }

  await writeImpexAudit(firestore, {
    actorUid, actorName, recordId: opRef.id,
    actionType: status === 'Failed' ? 'Import Failed' : 'Import Completed',
    description: `Import ${mode} finished for ${master.label}: ${successCount} ok / ${errorCount} failed`,
    newValue: { successCount, errorCount, skippedCount, dryRun, createdIds: createdIds.slice(0, 20) },
    reason, now: finished,
  });

  return {
    success: status !== 'Failed',
    operationId: opId,
    operationDocId: opRef.id,
    dryRun,
    successCount,
    errorCount,
    skippedCount,
    errors: errors.slice(0, 40),
    status,
  };
});

export const softDeleteAdminMasterDataOperation = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Operation ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('master_data_import_export').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Operation not found');
  const now = new Date().toISOString();
  await snap.ref.update({
    isDeleted: true,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  });
  await writeImpexAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Configuration Changed',
    description: `Import/export operation ${snap.data()?.operationId} soft-deleted`,
    reason, now,
  });
  return { success: true };
});
