/**
 * Email & SMS Templates — privileged Cloud Functions.
 * Part 11 / Annex 11 communication template master with versioning & approval.
 */
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

function optionalString(value: unknown, field: string, maxLength = 5000): string {
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

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 80);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 80);
  }
  return [];
}

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'];
const EDITOR_ROLES = ['super_admin', 'admin'];
const APPROVER_ROLES = ['super_admin', 'admin', 'head_qa'];

const KNOWN_PLACEHOLDERS = new Set([
  'UserName', 'EmployeeName', 'EmployeeID', 'Department', 'Designation',
  'Company', 'Site', 'DocumentNo', 'DocumentTitle', 'DocumentVersion',
  'BatchNumber', 'ProductName', 'WorkflowName', 'ApprovalLevel', 'Approver',
  'Reviewer', 'DueDate', 'EffectiveDate',
  'CAPANumber', 'DeviationNumber', 'ChangeControlNumber', 'AuditNumber',
  'EquipmentID', 'CalibrationDue', 'CurrentDate', 'CurrentTime', 'SystemURL',
  'moduleName', 'eventName', 'status', 'assignedTo', 'createdBy', 'documentNumber',
]);

function extractPlaceholders(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{(\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) found.add(m[1]);
  return Array.from(found);
}

function validatePlaceholders(text: string, custom: string[]) {
  const found = extractPlaceholders(text);
  const allowed = new Set([...KNOWN_PLACEHOLDERS, ...custom]);
  const invalid = found.filter((p) => !allowed.has(p));
  if (invalid.length) {
    throw new HttpsError(
      'invalid-argument',
      `Unknown placeholders: ${invalid.map((p) => `{{${p}}}`).join(', ')}. Add them to Variables or use known placeholders.`,
    );
  }
  return found;
}

function assertNoScript(html: string) {
  if (/<\s*script\b/i.test(html) || /\bon\w+\s*=/i.test(html) || /javascript:/i.test(html)) {
    throw new HttpsError('invalid-argument', 'HTML contains disallowed script or event handlers');
  }
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  const withDefaults: Record<string, string> = {
    CurrentDate: new Date().toISOString().slice(0, 10),
    CurrentTime: new Date().toISOString().slice(11, 19),
    SystemURL: vars.SystemURL || '',
    ...vars,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const val = withDefaults[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Email/SMS Templates view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Email/SMS Templates edit access required');
  }
}

function assertApprover(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !APPROVER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Template approval access required');
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

async function writeTemplateAudit(
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
    auditId: `AUD-TMPL-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'Email/SMS Templates',
    collectionName: 'email_sms_templates',
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
    source: 'email-sms-templates-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: 'Email/SMS Templates',
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

function buildTemplateId(code: string): string {
  return `TMPL-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function parsePayload(data: Record<string, unknown>, actorUid: string, status: string) {
  const templateCode = requiredString(data.templateCode, 'Template code', 80).toUpperCase();
  const templateName = requiredString(data.templateName, 'Template name', 200);
  const templateType = optionalString(data.templateType, 'Template type', 60) || 'Email';
  const body = requiredString(data.body, 'Body', 50000);
  const smsBody = optionalString(data.smsBody, 'SMS body', 1600) || (templateType === 'SMS' ? body : '');
  const subject = optionalString(data.subject, 'Subject', 300);
  const isHtml = asBool(data.isHtml, false);
  const htmlBody = isHtml ? body : optionalString(data.htmlBody, 'HTML body', 50000);
  if (templateType === 'Email' && !subject) {
    throw new HttpsError('invalid-argument', 'Subject is required for Email templates');
  }
  if (templateType === 'SMS' && smsBody.length > 1600) {
    throw new HttpsError('invalid-argument', 'SMS body exceeds 1600 characters');
  }
  if (isHtml || htmlBody) assertNoScript(htmlBody || body);

  const customVars = asStringArray(data.variables);
  const placeholders = validatePlaceholders(`${subject}\n${body}\n${smsBody}`, customVars);

  return {
    templateId: buildTemplateId(templateCode),
    templateCode,
    templateName,
    description: optionalString(data.description, 'Description', 2000),
    category: optionalString(data.category, 'Category', 120) || 'General',
    module: requiredString(data.module, 'Module', 120),
    subModule: optionalString(data.subModule, 'Sub module', 120),
    workflow: optionalString(data.workflow, 'Workflow', 120),
    templateType,
    channel: templateType,
    subject,
    body,
    smsBody,
    htmlBody: htmlBody || '',
    isHtml,
    variables: customVars.join(', '),
    placeholders,
    priority: optionalString(data.priority, 'Priority', 40) || 'Medium',
    language: optionalString(data.language, 'Language', 20) || 'en',
    company: optionalString(data.company, 'Company', 120),
    businessUnit: optionalString(data.businessUnit, 'Business unit', 120),
    site: optionalString(data.site, 'Site', 120),
    department: optionalString(data.department, 'Department', 120),
    effectiveDate: optionalString(data.effectiveDate, 'Effective date', 40),
    reviewDate: optionalString(data.reviewDate, 'Review date', 40),
    expiryDate: optionalString(data.expiryDate, 'Expiry date', 40),
    approvalStatus: optionalString(data.approvalStatus, 'Approval status', 40) || 'Draft',
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    status,
    isDeleted: false,
    updatedBy: actorUid,
  };
}

async function snapshotVersion(
  firestore: Firestore,
  templateDocId: string,
  row: DocumentData,
  actorUid: string,
  now: string,
) {
  await firestore.collection('email_sms_template_versions').doc().set({
    templateDocId,
    templateCode: row.templateCode,
    version: Number(row.version || 1),
    subject: row.subject || '',
    body: row.body || '',
    smsBody: row.smsBody || '',
    htmlBody: row.htmlBody || '',
    isHtml: row.isHtml === true,
    approvalStatus: row.approvalStatus || 'Draft',
    placeholders: row.placeholders || [],
    snapshotAt: now,
    snapshotBy: actorUid,
    createdAt: now,
  });
}

const SEED_TEMPLATES = [
  {
    templateCode: 'CAPA-DUE-EMAIL',
    templateName: 'CAPA Due Reminder (Email)',
    templateType: 'Email',
    category: 'CAPA',
    module: 'CAPA',
    subject: '[CAPA] {{CAPANumber}} due {{DueDate}}',
    body: 'Dear {{UserName}},\n\nCAPA {{CAPANumber}} assigned to {{assignedTo}} is due on {{DueDate}}. Status: {{status}}.\n\nPlease take action in SkyMap QMS.\n{{SystemURL}}',
    variables: 'CAPANumber,DueDate,UserName,assignedTo,status,SystemURL',
    approvalStatus: 'Published',
  },
  {
    templateCode: 'DEV-CREATED-EMAIL',
    templateName: 'Deviation Created (Email)',
    templateType: 'Email',
    category: 'Deviation',
    module: 'Deviation',
    subject: '[Deviation] {{DeviationNumber}} created',
    body: 'Deviation {{DeviationNumber}} was created by {{createdBy}} in {{Department}}. Status: {{status}}.',
    variables: 'DeviationNumber,createdBy,Department,status',
    approvalStatus: 'Published',
  },
  {
    templateCode: 'PWD-RESET-EMAIL',
    templateName: 'Password Reset (Email)',
    templateType: 'Email',
    category: 'Password Reset',
    module: 'User Management',
    subject: 'Password reset for {{UserName}}',
    body: 'Hello {{UserName}}, a password reset was requested for your SkyMap account. If this was not you, contact QA IT immediately.',
    variables: 'UserName',
    approvalStatus: 'Published',
  },
  {
    templateCode: 'ESIGN-REQUIRED',
    templateName: 'E-Signature Required',
    templateType: 'System Notification',
    category: 'Electronic Signature',
    module: 'Electronic Signature',
    subject: 'Signature required — {{DocumentNo}}',
    body: '{{Approver}}: electronic signature required for {{DocumentTitle}} ({{DocumentNo}}). Workflow: {{WorkflowName}}.',
    variables: 'Approver,DocumentTitle,DocumentNo,WorkflowName',
    approvalStatus: 'Published',
  },
  {
    templateCode: 'SEC-LOGIN-FAIL',
    templateName: 'Login Failure Alert',
    templateType: 'Email',
    category: 'Security Alerts',
    module: 'Login Activity',
    subject: '[Security] Login failure for {{UserName}}',
    body: 'Failed login detected for {{UserName}} at {{CurrentDate}} {{CurrentTime}}. Site: {{Site}}.',
    variables: 'UserName,CurrentDate,CurrentTime,Site',
    approvalStatus: 'Published',
  },
];

export const createAdminEmailSmsTemplate = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const payload = parsePayload(data, actorUid, optionalString(data.status, 'Status', 40) || 'Active');

  const codeSnap = await firestore.collection('email_sms_templates')
    .where('templateCode', '==', payload.templateCode)
    .limit(1)
    .get();
  if (!codeSnap.empty && codeSnap.docs[0].data().isDeleted !== true) {
    throw new HttpsError('already-exists', 'Template code already exists');
  }
  const nameSnap = await firestore.collection('email_sms_templates')
    .where('templateName', '==', payload.templateName)
    .limit(1)
    .get();
  if (!nameSnap.empty && nameSnap.docs[0].data().isDeleted !== true) {
    throw new HttpsError('already-exists', 'Template name already exists');
  }

  const now = new Date().toISOString();
  const ref = firestore.collection('email_sms_templates').doc();
  const row = { ...payload, version: 1, createdAt: now, updatedAt: now, createdBy: actorUid, changeReason: reason };
  await ref.set(row);
  await snapshotVersion(firestore, ref.id, row, actorUid, now);
  await writeTemplateAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: 'Template Created',
    description: `Template ${payload.templateCode} created`,
    newValue: payload, reason, now,
  });
  return { success: true, id: ref.id, templateId: payload.templateId };
});

export const updateAdminEmailSmsTemplate = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Template ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('email_sms_templates').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Template not found');
  }
  const existing = snap.data()!;
  const payload = parsePayload(data, actorUid, String(existing.status || 'Active'));

  if (payload.templateCode !== existing.templateCode) {
    throw new HttpsError('failed-precondition', 'Template code cannot be changed');
  }
  const nameSnap = await firestore.collection('email_sms_templates')
    .where('templateName', '==', payload.templateName)
    .limit(2)
    .get();
  if (nameSnap.docs.some((d) => d.id !== id && d.data().isDeleted !== true)) {
    throw new HttpsError('already-exists', 'Template name already exists');
  }

  const now = new Date().toISOString();
  const nextVersion = Number(existing.version || 1) + 1;
  const approvalStatus = optionalString(data.approvalStatus, 'Approval status', 40)
    || (existing.approvalStatus === 'Published' ? 'Draft' : String(existing.approvalStatus || 'Draft'));

  await snapshotVersion(firestore, id, existing, actorUid, now);
  await snap.ref.update({
    ...payload,
    version: nextVersion,
    approvalStatus,
    updatedAt: now,
    changeReason: reason,
  });
  await writeTemplateAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Template Updated',
    description: `Template ${payload.templateCode} updated to v${nextVersion}`,
    oldValue: existing, newValue: { ...payload, version: nextVersion }, reason, now,
  });
  return { success: true, id, version: nextVersion };
});

export const setAdminEmailSmsTemplateStatus = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Template ID', 128);
  const status = requiredString(data.status, 'Status', 40);
  if (!['Active', 'Inactive'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Status must be Active or Inactive');
  }
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('email_sms_templates').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Template not found');
  }
  const now = new Date().toISOString();
  const old = snap.data();
  await snap.ref.update({ status, updatedAt: now, updatedBy: actorUid, changeReason: reason });
  await writeTemplateAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Configuration Changed',
    description: `Template ${old?.templateCode} set to ${status}`,
    oldValue: { status: old?.status }, newValue: { status }, reason, now,
  });
  return { success: true };
});

export const transitionAdminEmailSmsTemplate = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Template ID', 128);
  const approvalStatus = requiredString(data.approvalStatus, 'Approval status', 40);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const allowed = ['Draft', 'Under Review', 'Approved', 'Published', 'Archived', 'Obsolete'];
  if (!allowed.includes(approvalStatus)) {
    throw new HttpsError('invalid-argument', 'Invalid approval status');
  }
  if (['Approved', 'Published'].includes(approvalStatus)) {
    assertApprover(actor, actorRole);
  } else {
    assertEditor(actor, actorRole);
  }
  const snap = await firestore.collection('email_sms_templates').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Template not found');
  }
  const old = snap.data()!;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    approvalStatus,
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  };
  if (approvalStatus === 'Published' && !old.effectiveDate) {
    patch.effectiveDate = now.slice(0, 10);
  }
  await snap.ref.update(patch);
  const actionType = approvalStatus === 'Published' ? 'Template Published'
    : approvalStatus === 'Approved' ? 'Template Approved'
      : approvalStatus === 'Archived' ? 'Template Archived'
        : 'Configuration Changed';
  await writeTemplateAudit(firestore, {
    actorUid, actorName, recordId: id, actionType,
    description: `Template ${old.templateCode} → ${approvalStatus}`,
    oldValue: { approvalStatus: old.approvalStatus },
    newValue: { approvalStatus }, reason, now,
  });
  return { success: true, approvalStatus };
});

export const softDeleteAdminEmailSmsTemplate = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Template ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('email_sms_templates').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Template not found');
  const old = snap.data()!;
  const now = new Date().toISOString();
  await snap.ref.update({
    isDeleted: true,
    status: 'Inactive',
    approvalStatus: 'Obsolete',
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  });
  await writeTemplateAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Template Deleted',
    description: `Template ${old.templateCode} soft-deleted`,
    oldValue: old, reason, now,
  });
  return { success: true };
});

export const seedAdminEmailSmsTemplates = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? `Seeded by ${actorName}`);
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  for (const seed of SEED_TEMPLATES) {
    const existing = await firestore.collection('email_sms_templates')
      .where('templateCode', '==', seed.templateCode)
      .limit(1)
      .get();
    if (!existing.empty && existing.docs[0].data().isDeleted !== true) {
      skipped += 1;
      continue;
    }
    const payload = parsePayload({ ...seed, status: 'Active' }, actorUid, 'Active');
    const ref = firestore.collection('email_sms_templates').doc();
    const row = {
      ...payload,
      approvalStatus: seed.approvalStatus,
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      changeReason: reason,
    };
    await ref.set(row);
    await snapshotVersion(firestore, ref.id, row, actorUid, now);
    created += 1;
  }
  await writeTemplateAudit(firestore, {
    actorUid, actorName, recordId: 'seed', actionType: 'Configuration Changed',
    description: `Seeded templates (created ${created}, skipped ${skipped})`,
    newValue: { created, skipped }, reason, now,
  });
  return { success: true, created, skipped };
});

export const resolveAdminEmailSmsTemplate = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const templateCode = optionalString(data.templateCode, 'Template code', 80).toUpperCase();
  const moduleName = optionalString(data.module, 'Module', 120);
  const templateType = optionalString(data.templateType, 'Template type', 60);
  const vars = (data.variables && typeof data.variables === 'object'
    ? data.variables as Record<string, string>
    : {}) as Record<string, string>;

  let row: DocumentData | null = null;
  if (templateCode) {
    const snap = await firestore.collection('email_sms_templates')
      .where('templateCode', '==', templateCode)
      .limit(1)
      .get();
    if (!snap.empty) row = { id: snap.docs[0].id, ...snap.docs[0].data() };
  } else if (moduleName && templateType) {
    const snap = await firestore.collection('email_sms_templates')
      .where('module', '==', moduleName)
      .where('templateType', '==', templateType)
      .limit(20)
      .get();
    row = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as DocumentData & { id: string }))
      .find((t) => t.isDeleted !== true
        && t.status === 'Active'
        && (t.approvalStatus === 'Published' || t.approvalStatus === 'Approved'))
      || null;
  }

  if (!row || row.isDeleted === true) {
    throw new HttpsError('not-found', 'Template not found');
  }
  if (row.status !== 'Active') {
    throw new HttpsError('failed-precondition', 'Template is inactive');
  }

  const subject = applyTemplate(String(row.subject || ''), vars);
  const body = applyTemplate(String(row.body || ''), vars);
  const smsBody = applyTemplate(String(row.smsBody || row.body || ''), vars);
  return {
    success: true,
    id: row.id,
    templateCode: row.templateCode,
    templateType: row.templateType,
    version: row.version,
    approvalStatus: row.approvalStatus,
    subject,
    body,
    smsBody,
    isHtml: row.isHtml === true,
  };
});

export const previewAdminEmailSmsTemplate = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = optionalString(data.id, 'ID', 128);
  const reason = optionalString(data.changeReason, 'Change reason', 500) || 'Preview / test';
  let subject = optionalString(data.subject, 'Subject', 300);
  let body = optionalString(data.body, 'Body', 50000);
  let smsBody = optionalString(data.smsBody, 'SMS body', 1600);
  let templateCode = '';

  if (id) {
    const snap = await firestore.collection('email_sms_templates').doc(id).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Template not found');
    const row = snap.data()!;
    subject = String(row.subject || subject);
    body = String(row.body || body);
    smsBody = String(row.smsBody || smsBody || body);
    templateCode = String(row.templateCode || '');
  }

  const sample: Record<string, string> = {
    UserName: 'Jane Doe',
    EmployeeName: 'Jane Doe',
    EmployeeID: 'EMP-1001',
    Department: 'QA',
    Designation: 'QA Executive',
    Company: 'SkyMap Pharma',
    Site: 'HMF Plant',
    DocumentNo: 'DOC-2026-0001',
    DocumentTitle: 'SOP Example',
    DocumentVersion: '01',
    BatchNumber: 'BTH-2026-0042',
    ProductName: 'Amoxicillin 500mg',
    WorkflowName: 'CAPA Approval',
    ApprovalLevel: 'Level 2',
    Approver: 'Head QA',
    Reviewer: 'QA Manager',
    DueDate: '2026-08-15',
    EffectiveDate: '2026-07-01',
    CAPANumber: 'CAPA-2026-0012',
    DeviationNumber: 'DEV-2026-0008',
    ChangeControlNumber: 'CC-2026-0003',
    AuditNumber: 'AUD-2026-0001',
    EquipmentID: 'EQ-HPLC-01',
    CalibrationDue: '2026-09-01',
    moduleName: 'CAPA',
    eventName: 'Due Soon',
    status: 'Open',
    assignedTo: 'QA Executive',
    createdBy: actorName,
    documentNumber: 'DOC-2026-0001',
    SystemURL: 'https://skymap.example',
    ...(typeof data.variables === 'object' && data.variables ? data.variables as Record<string, string> : {}),
  };

  const rendered = {
    subject: applyTemplate(subject, sample),
    body: applyTemplate(body, sample),
    smsBody: applyTemplate(smsBody || body, sample),
    smsLength: applyTemplate(smsBody || body, sample).length,
  };

  if (data.logTest === true) {
    const now = new Date().toISOString();
    await writeTemplateAudit(firestore, {
      actorUid, actorName, recordId: id || 'preview',
      actionType: 'Template Tested',
      description: `Preview/test for ${templateCode || 'adhoc'}`,
      newValue: { templateCode, smsLength: rendered.smsLength },
      reason, now,
    });
  }

  return { success: true, ...rendered, sample };
});

export const logAdminEmailSmsTemplatesExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  await writeTemplateAudit(firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Export',
    description: `Exported ${Number(data.count || 0)} email/SMS templates`,
    newValue: { format: data.format || 'CSV', count: data.count || 0 },
    reason: 'Template library export', now,
  });
  return { success: true };
});
