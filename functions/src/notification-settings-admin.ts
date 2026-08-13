/**
 * Notification Settings — privileged Cloud Functions.
 * Rule-driven delivery, queue, and Part 11–aligned configuration control.
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

function asNumber(value: unknown, fallback: number, min = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'];
const EDITOR_ROLES = ['super_admin', 'admin'];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Notification Settings view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Notification Settings edit access required');
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

async function writeNotifAudit(
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
    auditId: `AUD-NTF-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'Notification Settings',
    collectionName: 'notification_settings',
    recordId: input.recordId,
    documentId: input.recordId,
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    changedByUserId: input.actorUid,
    changedByUserName: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    reasonForChange: input.reason || '',
    reason: input.reason || '',
    ipAddress: 'server',
    deviceInfo: 'cloud-function',
    status: 'Success',
    appendOnly: true,
    immutable: true,
    source: 'notification-settings-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    dateTime: input.now,
    userId: input.actorUid,
    userName: input.actorName,
    module: 'Notification Settings',
    recordId: input.recordId,
    action: input.actionType,
    oldValue: typeof input.oldValue === 'string' ? input.oldValue : JSON.stringify(input.oldValue ?? ''),
    newValue: typeof input.newValue === 'string' ? input.newValue : JSON.stringify(input.newValue ?? ''),
    reason: input.reason || '',
    ipAddress: 'server',
    device: 'cloud-function',
    status: 'Success',
  });
  await batch.commit();
}

function buildCode(code: string): string {
  return code.toUpperCase().replace(/\s+/g, '-').slice(0, 60);
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '');
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokensMatch(a: string, b: string): boolean {
  const na = normalizeToken(a);
  const nb = normalizeToken(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

function parseSettingPayload(data: Record<string, unknown>, actorUid: string, status = 'Active') {
  const notificationCode = buildCode(requiredString(data.notificationCode, 'Notification code', 60));
  const enableEmail = asBool(data.enableEmailNotification, true);
  const templateSubject = optionalString(data.templateSubject, 'Template subject', 300);
  if (enableEmail && !templateSubject) {
    throw new HttpsError('invalid-argument', 'Template subject is required for email notifications');
  }
  const recipientRole = optionalString(data.recipientRole, 'Recipient role', 80);
  const recipientUserOptional = optionalString(data.recipientUserOptional, 'Recipient user', 128);
  if (!recipientRole && !recipientUserOptional) {
    throw new HttpsError('invalid-argument', 'Recipient role or user is required');
  }

  return {
    notificationSettingId: `NTS-${notificationCode}`,
    notificationCode,
    eventName: requiredString(data.eventName, 'Event name', 160),
    moduleName: requiredString(data.moduleName, 'Module', 120),
    eventTrigger: requiredString(data.eventTrigger, 'Event trigger', 120),
    eventAliases: Array.isArray(data.eventAliases)
      ? (data.eventAliases as unknown[]).map((v) => String(v).trim()).filter(Boolean).slice(0, 30)
      : [],
    notificationType: optionalString(data.notificationType, 'Type', 80) || 'In-App + Email',
    recipientRole,
    recipientUserOptional,
    recipientDepartmentOptional: optionalString(data.recipientDepartmentOptional, 'Department', 120),
    recipientSiteOptional: optionalString(data.recipientSiteOptional, 'Site', 120),
    recipientBusinessUnitOptional: optionalString(data.recipientBusinessUnitOptional, 'BU', 120),
    ccRoleOptional: optionalString(data.ccRoleOptional, 'CC role', 80),
    escalationRole: optionalString(data.escalationRole, 'Escalation role', 80),
    notifyBeforeDueDays: asNumber(data.notifyBeforeDueDays, 3),
    beforeDueDays: asNumber(data.notifyBeforeDueDays, 3),
    escalationAfterDays: asNumber(data.escalationAfterDays, 7),
    escalationDays: asNumber(data.escalationAfterDays, 7),
    repeatReminder: asBool(data.repeatReminder, false),
    reminderFrequency: optionalString(data.reminderFrequency, 'Reminder frequency', 40) || 'None',
    templateSubject,
    templateBody: requiredString(data.templateBody, 'Template body', 5000),
    template: requiredString(data.templateBody, 'Template body', 5000),
    priority: optionalString(data.priority, 'Priority', 40) || 'Medium',
    enableInAppNotification: asBool(data.enableInAppNotification, true),
    inAppEnabled: asBool(data.enableInAppNotification, true),
    enableEmailNotification: enableEmail,
    emailEnabled: enableEmail,
    enableSmsNotification: asBool(data.enableSmsNotification, false),
    smsEnabled: asBool(data.enableSmsNotification, false),
    enablePushNotification: asBool(data.enablePushNotification, false),
    enableWebhook: asBool(data.enableWebhook, false),
    webhookUrl: optionalString(data.webhookUrl, 'Webhook URL', 500),
    preventDuplicates: asBool(data.preventDuplicates, true),
    duplicateWindowMinutes: asNumber(data.duplicateWindowMinutes, 60, 1),
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    status,
    isDeleted: false,
    updatedBy: actorUid,
  };
}

async function resolveUsersByRole(
  firestore: Firestore,
  role: string,
  department?: string,
  site?: string,
): Promise<Array<{ uid: string; name: string; email: string }>> {
  if (!role) return [];
  const snap = await firestore.collection('users').where('role', '==', role).limit(100).get();
  const out: Array<{ uid: string; name: string; email: string }> = [];
  for (const d of snap.docs) {
    const u = d.data();
    if (u.isDeleted === true) continue;
    const status = String(u.userStatus || u.status || 'Active');
    if (status === 'Inactive' || status === 'Suspended') continue;
    if (department && String(u.department || '') !== department) continue;
    if (site && String(u.siteName || u.site || '') !== site) continue;
    const uid = String(u.authUid || d.id);
    out.push({
      uid,
      name: String(u.fullName || u.full_name || u.email || uid),
      email: String(u.email || ''),
    });
  }
  // Also check profiles by role
  if (out.length === 0) {
    const profiles = await firestore.collection('profiles').where('role', '==', role).limit(50).get();
    for (const d of profiles.docs) {
      const p = d.data();
      if (p.is_active === false) continue;
      out.push({
        uid: d.id,
        name: String(p.full_name || p.email || d.id),
        email: String(p.email || ''),
      });
    }
  }
  return out;
}

function dedupeKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

async function wasRecentlySent(
  firestore: Firestore,
  key: string,
  windowMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const snap = await firestore.collection('notification_delivery_log')
    .where('dedupeKey', '==', key)
    .where('createdAt', '>=', since)
    .limit(1)
    .get()
    .catch(() => ({ empty: true, docs: [] as unknown[] }));
  return !snap.empty;
}

async function enqueueChannel(
  firestore: Firestore,
  input: {
    channel: string;
    userId: string;
    title: string;
    message: string;
    moduleName: string;
    eventName: string;
    recordId: string;
    priority: string;
    settingId: string;
    now: string;
    subject?: string;
  },
) {
  await firestore.collection('notification_queue').doc().set({
    queueId: `NQ-${Date.now().toString(36).toUpperCase()}`,
    channel: input.channel,
    userId: input.userId,
    title: input.title,
    subject: input.subject || input.title,
    message: input.message,
    moduleName: input.moduleName,
    eventName: input.eventName,
    recordId: input.recordId,
    priority: input.priority,
    settingId: input.settingId,
    status: 'Pending',
    retryCount: 0,
    maxRetries: 3,
    createdAt: input.now,
    updatedAt: input.now,
    nextAttemptAt: input.now,
  });
}

const DEFAULT_RULES = [
  {
    notificationCode: 'CAPA-DUE',
    eventName: 'CAPA Due',
    moduleName: 'CAPA',
    eventTrigger: 'CAPA Due',
    eventAliases: ['CAPA Overdue', 'Due Soon'],
    recipientRole: 'qa_manager',
    templateSubject: '[{{moduleName}}] CAPA due {{documentNumber}}',
    templateBody: 'Hello {{UserName}}, CAPA {{documentNumber}} is due on {{DueDate}}. Status: {{Status}}.',
    priority: 'High',
  },
  {
    notificationCode: 'DEV-CREATED',
    eventName: 'Deviation Created',
    moduleName: 'Deviation',
    eventTrigger: 'Deviation Created',
    eventAliases: ['Record Created'],
    recipientRole: 'head_qa',
    templateSubject: '[Deviation] {{documentNumber}} created',
    templateBody: 'Deviation {{documentNumber}} was created by {{createdBy}}. Please review.',
    priority: 'High',
  },
  {
    notificationCode: 'PQR-APPROVAL',
    eventName: 'PQR Approval Pending',
    moduleName: 'PQR',
    eventTrigger: 'Approval Pending',
    eventAliases: ['Review Pending'],
    recipientRole: 'head_qa',
    templateSubject: '[PQR] Approval pending {{documentNumber}}',
    templateBody: 'PQR {{documentNumber}} awaits approval. Assigned: {{assignedTo}}.',
    priority: 'Medium',
  },
  {
    notificationCode: 'LOGIN-FAIL',
    eventName: 'Login Failed',
    moduleName: 'Admin',
    eventTrigger: 'Login Failed',
    eventAliases: ['User Locked', 'Security Alert'],
    recipientRole: 'admin',
    templateSubject: '[Security] {{eventName}}',
    templateBody: 'Security event: {{eventName}} for {{UserName}}. Please investigate.',
    priority: 'Critical',
  },
  {
    notificationCode: 'ESIGN-REQ',
    eventName: 'Electronic Signature Required',
    moduleName: 'Admin',
    eventTrigger: 'Electronic Signature Required',
    eventAliases: ['Approval Pending'],
    recipientRole: 'qa_manager',
    templateSubject: '[E-Sign] Signature required',
    templateBody: 'Electronic signature required for {{moduleName}} record {{documentNumber}}.',
    priority: 'High',
  },
];

export const createAdminNotificationSetting = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const payload = parseSettingPayload(data, actorUid, 'Active');

  const existing = await firestore.collection('notification_settings')
    .where('notificationCode', '==', payload.notificationCode)
    .limit(1)
    .get();
  if (!existing.empty && existing.docs[0].data().isDeleted !== true) {
    throw new HttpsError('already-exists', 'Notification code already exists');
  }

  const now = new Date().toISOString();
  const ref = firestore.collection('notification_settings').doc();
  await ref.set({ ...payload, createdAt: now, updatedAt: now, createdBy: actorUid, changeReason: reason });
  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: 'Create',
    description: `Notification rule ${payload.notificationCode} created`,
    newValue: payload, reason, now,
  });
  return { success: true, id: ref.id, notificationSettingId: payload.notificationSettingId };
});

export const updateAdminNotificationSetting = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Setting ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('notification_settings').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Notification setting not found');
  }
  const prev = snap.data() || {};
  const payload = parseSettingPayload(data, actorUid, String(prev.status || 'Active'));
  if (payload.notificationCode !== String(prev.notificationCode || '')) {
    const codeSnap = await firestore.collection('notification_settings')
      .where('notificationCode', '==', payload.notificationCode)
      .limit(1)
      .get();
    if (!codeSnap.empty && codeSnap.docs[0].id !== id) {
      throw new HttpsError('already-exists', 'Notification code already exists');
    }
  }
  const now = new Date().toISOString();
  await snap.ref.update({ ...payload, updatedAt: now, changeReason: reason });
  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Update',
    description: `Notification rule ${payload.notificationCode} updated`,
    oldValue: { status: prev.status, eventTrigger: prev.eventTrigger },
    newValue: payload, reason, now,
  });
  return { success: true, id };
});

export const setAdminNotificationSettingStatus = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Setting ID', 128);
  const status = requiredString(data.status, 'Status', 20);
  const reason = requiredReason(data.changeReason ?? data.reason);
  if (!['Active', 'Inactive'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Status must be Active or Inactive');
  }
  const snap = await firestore.collection('notification_settings').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Notification setting not found');
  const prev = snap.data() || {};
  const now = new Date().toISOString();
  await snap.ref.update({ status, updatedAt: now, updatedBy: actorUid, changeReason: reason });
  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: id,
    actionType: status === 'Active' ? 'Activate' : 'Deactivate',
    description: `Notification rule ${prev.notificationCode || id} set to ${status}`,
    oldValue: { status: prev.status }, newValue: { status }, reason, now,
  });
  return { success: true, id, status };
});

export const softDeleteAdminNotificationSetting = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Setting ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('notification_settings').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Notification setting not found');
  const prev = snap.data() || {};
  const now = new Date().toISOString();
  await snap.ref.update({
    isDeleted: true, status: 'Inactive', updatedAt: now, updatedBy: actorUid, changeReason: reason,
  });
  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Delete',
    description: `Notification rule ${prev.notificationCode || id} soft-deleted`,
    oldValue: prev, newValue: { isDeleted: true }, reason, now,
  });
  return { success: true, id };
});

export const seedAdminNotificationSettings = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason ?? 'Seed default notification rules');
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;

  for (const def of DEFAULT_RULES) {
    const existing = await firestore.collection('notification_settings')
      .where('notificationCode', '==', def.notificationCode)
      .limit(1)
      .get();
    if (!existing.empty && existing.docs[0].data().isDeleted !== true) {
      await existing.docs[0].ref.update({
        eventAliases: def.eventAliases,
        updatedAt: now,
        updatedBy: actorUid,
      });
      skipped += 1;
      continue;
    }
    const payload = parseSettingPayload({
      ...def,
      enableInAppNotification: true,
      enableEmailNotification: true,
      enableSmsNotification: false,
      notifyBeforeDueDays: 3,
      escalationAfterDays: 7,
      repeatReminder: false,
      reminderFrequency: 'None',
      preventDuplicates: true,
      remarks: `Seeded ${def.notificationCode}`,
    }, actorUid, 'Active');
    await firestore.collection('notification_settings').doc().set({
      ...payload,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      changeReason: reason,
    });
    created += 1;
  }

  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: 'seed', actionType: 'Create',
    description: `Seeded notification rules (created ${created}, skipped ${skipped})`,
    newValue: { created, skipped }, reason, now,
  });
  return { success: true, created, skipped };
});

export const dispatchAdminNotificationEvent = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const moduleName = requiredString(data.moduleName, 'Module', 120);
  const eventTrigger = requiredString(data.eventTrigger || data.eventName, 'Event', 120);
  const recordId = requiredString(data.recordId, 'Record ID', 128);
  const documentNumber = optionalString(data.documentNumber, 'Document number', 120);
  const vars = {
    UserName: optionalString(data.userName, 'UserName', 200) || actorName,
    EmployeeName: optionalString(data.employeeName, 'EmployeeName', 200),
    documentNumber,
    DocumentNo: documentNumber,
    moduleName,
    Module: moduleName,
    eventName: eventTrigger,
    Workflow: optionalString(data.workflow, 'Workflow', 120),
    Department: optionalString(data.department, 'Department', 120),
    Approver: optionalString(data.approver, 'Approver', 120),
    DueDate: optionalString(data.dueDate, 'DueDate', 40),
    Status: optionalString(data.status, 'Status', 80),
    assignedTo: optionalString(data.assignedTo, 'assignedTo', 120),
    createdBy: optionalString(data.createdBy, 'createdBy', 120) || actorName,
    productName: optionalString(data.productName, 'productName', 160),
    batchNumber: optionalString(data.batchNumber, 'batchNumber', 80),
    siteName: optionalString(data.siteName, 'siteName', 120),
  };

  const settingsSnap = await firestore.collection('notification_settings')
    .where('status', '==', 'Active')
    .limit(300)
    .get();

  const matching = settingsSnap.docs.filter((d) => {
    const row = d.data();
    if (row.isDeleted === true) return false;
    if (!tokensMatch(String(row.moduleName || ''), moduleName)
      && !tokensMatch(String(row.moduleName || ''), String(data.moduleAlias || ''))) {
      // allow Admin module catch-all for security events
      if (String(row.moduleName) !== 'Admin' || !['Login Failed', 'User Locked', 'Security Alert'].some((t) => tokensMatch(t, eventTrigger))) {
        return false;
      }
    }
    const triggers = [String(row.eventTrigger || ''), ...(Array.isArray(row.eventAliases) ? row.eventAliases.map(String) : [])];
    return triggers.some((t) => tokensMatch(t, eventTrigger));
  });

  if (matching.length === 0 && data.fallbackUserId) {
    // Direct fallback when no rule configured
    const now = new Date().toISOString();
    const title = optionalString(data.title, 'Title', 200) || `${moduleName}: ${eventTrigger}`;
    const message = optionalString(data.message, 'Message', 2000) || title;
    await firestore.collection('notifications').doc().set({
      notificationId: `NTF-${Date.now().toString(36).toUpperCase()}`,
      userId: String(data.fallbackUserId),
      user_id: String(data.fallbackUserId),
      title,
      message,
      moduleName,
      eventName: eventTrigger,
      recordId,
      documentNumber,
      isRead: false,
      readStatus: 'Unread',
      sentStatus: 'Sent',
      notificationChannel: 'In-App',
      priority: 'Medium',
      createdAt: now,
    });
    return { success: true, delivered: 1, queued: 0, rulesMatched: 0 };
  }

  const now = new Date().toISOString();
  let delivered = 0;
  let queued = 0;

  for (const docSnap of matching) {
    const rule = docSnap.data();
    let title = applyTemplate(String(rule.templateSubject || `[{{moduleName}}] {{eventName}}`), vars);
    let message = applyTemplate(String(rule.templateBody || rule.template || ''), vars);

    const linkedCode = String(rule.linkedTemplateCode || rule.templateCode || '').toUpperCase();
    if (linkedCode) {
      const tmplSnap = await firestore.collection('email_sms_templates')
        .where('templateCode', '==', linkedCode)
        .limit(1)
        .get();
      if (!tmplSnap.empty) {
        const tmpl = tmplSnap.docs[0].data();
        if (tmpl.isDeleted !== true
          && tmpl.status === 'Active'
          && (tmpl.approvalStatus === 'Published' || tmpl.approvalStatus === 'Approved')) {
          if (tmpl.subject) title = applyTemplate(String(tmpl.subject), vars);
          if (tmpl.body) message = applyTemplate(String(tmpl.body), vars);
        }
      }
    }
    const recipients = new Map<string, { uid: string; name: string; email: string }>();

    if (rule.recipientUserOptional) {
      recipients.set(String(rule.recipientUserOptional), {
        uid: String(rule.recipientUserOptional),
        name: String(rule.recipientUserOptional),
        email: '',
      });
    }
    for (const u of await resolveUsersByRole(
      firestore,
      String(rule.recipientRole || ''),
      String(rule.recipientDepartmentOptional || '') || undefined,
      String(rule.recipientSiteOptional || '') || undefined,
    )) {
      recipients.set(u.uid, u);
    }
    if (rule.ccRoleOptional) {
      for (const u of await resolveUsersByRole(firestore, String(rule.ccRoleOptional))) {
        recipients.set(u.uid, u);
      }
    }

    const windowMinutes = Number(rule.duplicateWindowMinutes || 60);
    const preventDup = rule.preventDuplicates !== false;

    for (const recipient of recipients.values()) {
      const key = dedupeKey([docSnap.id, recordId, recipient.uid, 'In-App']);
      if (preventDup && await wasRecentlySent(firestore, key, windowMinutes)) continue;

      if (rule.enableInAppNotification !== false) {
        await firestore.collection('notifications').doc().set({
          notificationId: `NTF-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5)}`,
          userId: recipient.uid,
          user_id: recipient.uid,
          recipientUserId: recipient.uid,
          title,
          message,
          moduleName,
          module: moduleName,
          eventName: eventTrigger,
          recordId,
          documentNumber,
          recipientRole: String(rule.recipientRole || ''),
          target_role: String(rule.recipientRole || ''),
          priority: String(rule.priority || 'Medium'),
          notificationChannel: 'In-App',
          isRead: false,
          readStatus: 'Unread',
          sentStatus: 'Sent',
          settingId: docSnap.id,
          createdAt: now,
          createdBy: actorUid,
        });
        delivered += 1;
      }

      if (rule.enableEmailNotification) {
        await enqueueChannel(firestore, {
          channel: 'Email', userId: recipient.uid, title, subject: title, message,
          moduleName, eventName: eventTrigger, recordId, priority: String(rule.priority || 'Medium'),
          settingId: docSnap.id, now,
        });
        queued += 1;
      }
      if (rule.enableSmsNotification) {
        await enqueueChannel(firestore, {
          channel: 'SMS', userId: recipient.uid, title, message,
          moduleName, eventName: eventTrigger, recordId, priority: String(rule.priority || 'Medium'),
          settingId: docSnap.id, now,
        });
        queued += 1;
      }

      await firestore.collection('notification_delivery_log').doc().set({
        dedupeKey: key,
        settingId: docSnap.id,
        recordId,
        userId: recipient.uid,
        channel: 'In-App',
        status: 'Delivered',
        createdAt: now,
      });
    }
  }

  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId, actionType: 'Notification Sent',
    description: `Dispatched ${eventTrigger} for ${moduleName} (${delivered} in-app, ${queued} queued)`,
    newValue: { moduleName, eventTrigger, delivered, queued, rulesMatched: matching.length },
    reason: 'Event dispatch', now,
  });

  return { success: true, delivered, queued, rulesMatched: matching.length };
});

export const processAdminNotificationQueue = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const now = new Date().toISOString();
  const snap = await firestore.collection('notification_queue')
    .where('status', 'in', ['Pending', 'Failed'])
    .limit(50)
    .get();

  let processed = 0;
  let failed = 0;
  for (const docSnap of snap.docs) {
    const row = docSnap.data();
    const retries = Number(row.retryCount || 0);
    const maxRetries = Number(row.maxRetries || 3);
    try {
      // Placeholder providers — mark Sent and log (SMTP/SMS integration point)
      await docSnap.ref.update({
        status: 'Sent',
        sentAt: now,
        updatedAt: now,
        providerResponse: `${row.channel} placeholder delivered`,
      });
      await firestore.collection('notification_delivery_log').doc().set({
        queueId: docSnap.id,
        channel: row.channel,
        userId: row.userId,
        status: 'Sent',
        createdAt: now,
        dedupeKey: dedupeKey([docSnap.id, String(row.channel), String(row.userId)]),
      });
      processed += 1;
    } catch (e) {
      const nextRetry = retries + 1;
      await docSnap.ref.update({
        status: nextRetry >= maxRetries ? 'Failed' : 'Pending',
        retryCount: nextRetry,
        lastError: (e as Error).message,
        updatedAt: now,
        nextAttemptAt: new Date(Date.now() + nextRetry * 5 * 60_000).toISOString(),
      });
      failed += 1;
    }
  }

  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: 'queue', actionType: 'Update',
    description: `Processed notification queue (sent ${processed}, failed ${failed})`,
    newValue: { processed, failed }, reason: 'Queue processing', now,
  });
  return { success: true, processed, failed };
});

export const broadcastAdminNotification = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const title = requiredString(data.title, 'Title', 200);
  const message = requiredString(data.message, 'Message', 5000);
  const targetRole = optionalString(data.targetRole, 'Target role', 80);
  const now = new Date().toISOString();

  let recipients: Array<{ uid: string; name: string; email: string }> = [];
  if (targetRole) {
    recipients = await resolveUsersByRole(firestore, targetRole);
  } else {
    const profiles = await firestore.collection('profiles').where('is_active', '==', true).limit(200).get();
    recipients = profiles.docs.map((d) => ({
      uid: d.id,
      name: String(d.data().full_name || d.data().email || d.id),
      email: String(d.data().email || ''),
    }));
  }

  let delivered = 0;
  for (const r of recipients) {
    await firestore.collection('notifications').doc().set({
      notificationId: `NTF-BC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 4)}`,
      userId: r.uid,
      user_id: r.uid,
      title,
      message,
      moduleName: 'Admin',
      eventName: 'Broadcast',
      recordId: 'broadcast',
      notificationChannel: 'In-App',
      priority: optionalString(data.priority, 'Priority', 40) || 'Medium',
      isRead: false,
      readStatus: 'Unread',
      sentStatus: 'Sent',
      isBroadcast: true,
      createdAt: now,
      createdBy: actorUid,
    });
    delivered += 1;
  }

  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: 'broadcast', actionType: 'Broadcast Sent',
    description: `Broadcast "${title}" to ${delivered} recipients`,
    newValue: { title, delivered, targetRole }, reason, now,
  });
  return { success: true, delivered };
});

export const archiveAdminNotifications = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const beforeDate = requiredString(data.beforeDate, 'Before date', 40);
  const now = new Date().toISOString();
  const snap = await firestore.collection('notifications')
    .where('createdAt', '<', `${beforeDate}T23:59:59.999Z`)
    .limit(300)
    .get()
    .catch(async () => firestore.collection('notifications').limit(300).get());

  let archived = 0;
  for (const docSnap of snap.docs) {
    const row = docSnap.data();
    if (String(row.createdAt || '') > `${beforeDate}T23:59:59.999Z`) continue;
    if (row.isArchived === true) continue;
    await firestore.collection('notifications_archive').doc(docSnap.id).set({
      ...row,
      isArchived: true,
      archivedAt: now,
      archivedBy: actorUid,
    });
    await docSnap.ref.update({ isArchived: true, archivedAt: now, updatedAt: now });
    archived += 1;
  }

  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: 'archive', actionType: 'Archive',
    description: `Archived ${archived} notifications before ${beforeDate}`,
    newValue: { archived, beforeDate }, reason, now,
  });
  return { success: true, archived };
});

export const logAdminNotificationSettingsExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const format = requiredString(data.format || 'Excel', 'Format', 40);
  const count = Number(data.count || 0);
  const now = new Date().toISOString();
  await writeNotifAudit(firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Export',
    description: `Exported ${count} notification settings as ${format}`,
    newValue: { format, count }, reason: 'Export', now,
  });
  return { success: true };
});
