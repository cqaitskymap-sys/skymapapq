/**
 * CPV Alert Engine — privileged Cloud Functions.
 * Hardens the existing Alert Engine module (collections: alerts, alert_rules,
 * alert_notifications, alert_escalations). Triple immutable audit, role notify,
 * e-sign close/reject/escalate, CF-only writes.
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

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const COLLECTION = 'alerts';
const RULES_COLLECTION = 'alert_rules';
const NOTIFICATIONS_COLLECTION = 'alert_notifications';
const ESCALATIONS_COLLECTION = 'alert_escalations';
const MODULE = 'CPV Alert Engine';
const SOURCE = 'cpv-alert-admin';

const VIEWER_ROLES = [
  'super_admin', 'admin', 'qa', 'head_qa', 'qa_manager',
  'qc', 'qc_manager', 'production', 'production_manager',
  'engineering', 'engineering_manager', 'viewer', 'auditor',
];
const MANAGE_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager'];
const CONFIGURE_ROLES = ['super_admin', 'admin'];
const EXPORT_ROLES = ['super_admin', 'admin', 'qa', 'head_qa', 'qa_manager', 'auditor'];

const ALERT_SOURCES = [
  'CPP Monitoring', 'CQA Monitoring', 'Yield Monitoring', 'Stability Monitoring',
  'Raw Material Monitoring', 'Packing Material Monitoring', 'Utility Monitoring',
  'Environmental Monitoring', 'Hold Time Monitoring', 'Process Capability',
  'Trend Analysis', 'SPC', 'Risk Assessment', 'Annual CPV Review',
  'Reports & Analytics', 'Deviation', 'CAPA', 'Change Control',
  'Calibration', 'Maintenance', 'Equipment', 'Supplier', 'Warehouse', 'Inventory',
  'LIMS', 'MES', 'ERP', 'QMS', 'Document Management', 'User Management',
  'Security Logs', 'System Health', 'AI Analytics', 'Manual Alert',
] as const;

const ALERT_TYPES = [
  'Alert Limit Crossed', 'Action Limit Crossed', 'OOT', 'OOS', 'OOC', 'Excursion',
  'Temperature Excursion', 'Humidity Excursion', 'Differential Pressure Failure',
  'HVAC Failure', 'Utility Failure', 'Equipment Failure', 'Sensor Failure',
  'Communication Failure', 'Power Failure', 'Low Yield', 'Capability Drop',
  'Sigma Drop', 'Trend Shift', 'High Risk', 'Critical Risk', 'Risk Score Increased',
  'Cpk Below Limit', 'SPC Rule Violation', 'Western Electric Rule Violation',
  'Nelson Rule Violation', 'Hold Time Exceeded', 'Material Non-Compliance',
  'Packing Reconciliation Mismatch', 'Stability Sample Missed', 'Stability Pull Point Due',
  'Overdue Review', 'Calibration Due', 'Calibration Overdue', 'Maintenance Due',
  'Maintenance Overdue', 'Document Expired',
  'Approval Pending', 'Workflow Delay', 'CAPA Overdue', 'Deviation Overdue',
  'Repeated OOS', 'Repeated OOT', 'Repeated CAPA', 'Security Login Failure',
  'Unauthorized Access', 'System Failure', 'Database Failure', 'Cloud Function Failure',
  'Backup Failure', 'API Failure', 'AI Prediction Alert', 'CPP Limit Exceeded',
  'CQA Limit Exceeded',
] as const;

const ALERT_CATEGORIES = [
  'Critical', 'High', 'Medium', 'Low', 'Informational', 'Emergency', 'Predictive',
  'Compliance', 'System', 'Security', 'Operational', 'Maintenance', 'Quality',
  'Environmental', 'Utility', 'Manufacturing',
] as const;

const DELIVERY_CHANNELS = [
  'In-App', 'Toast', 'Email', 'SMS', 'WhatsApp', 'Microsoft Teams', 'Slack',
  'Push', 'FCM', 'Browser Push', 'Webhook', 'REST API',
] as const;

const PRIORITIES = ['Low', 'Medium', 'High', 'Critical', 'Emergency'] as const;
const SEVERITIES = ['Information', 'Warning', 'Major', 'Critical', 'Emergency'] as const;
const STATUSES = [
  'Open', 'Acknowledged', 'Under Investigation', 'Linked to Deviation',
  'Linked to OOS', 'Linked to CAPA', 'Closed', 'Rejected', 'Overdue',
] as const;

const CONDITION_TYPES = [
  'Value Outside Limit', 'Alert Limit Crossed', 'Action Limit Crossed',
  'Repeated Failure', 'Cpk Below Threshold', 'SPC Rule Violation',
  'Overdue', 'Missed Schedule', 'Risk Level Critical',
] as const;

const COMPARISON_OPERATORS = ['>', '>=', '<', '<=', '=', '!=', 'Between', 'Outside Range'] as const;

const LINK_TYPES = [
  'linkedDeviationNumber', 'linkedOosNumber', 'linkedCapaNumber', 'linkedRiskNumber',
] as const;

type LinkType = typeof LINK_TYPES[number];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Alert Engine view access required');
  }
}

function assertManage(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !MANAGE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Alert Engine manage access required');
  }
}

function assertConfigure(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !CONFIGURE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Alert rule configuration access required');
  }
}

function assertExport(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EXPORT_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Alert export access required');
  }
}

function canAcknowledgeSource(role: string, source: string): boolean {
  if (MANAGE_ROLES.includes(role)) return true;
  if (['qc', 'qc_manager'].includes(role)) {
    return ['CQA Monitoring', 'Stability Monitoring'].includes(source);
  }
  if (['production', 'production_manager'].includes(role)) {
    return ['CPP Monitoring', 'Yield Monitoring'].includes(source);
  }
  if (['engineering', 'engineering_manager'].includes(role)) {
    return ['Utility Monitoring', 'Environmental Monitoring'].includes(source);
  }
  return false;
}

function assertEnum(value: string, allowed: readonly string[], field: string) {
  if (!allowed.includes(value)) {
    throw new HttpsError('invalid-argument', `Invalid ${field}: ${value}`);
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

function writeAudit(
  batch: WriteBatch,
  firestore: Firestore,
  input: {
    actorUid: string; actorName: string; recordId: string; documentNumber?: string;
    actionType: string; description: string; oldValue?: unknown; newValue?: unknown;
    reason?: string; now: string; esign?: boolean;
  },
) {
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-ALT-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,
    collectionName: COLLECTION, recordId: input.recordId, documentId: input.recordId,
    documentNumber: input.documentNumber || '', actionType: input.actionType, action: input.actionType,
    actionDescription: input.description, oldValue: input.oldValue ?? null, newValue: input.newValue ?? null,
    reason: input.reason || '', performedBy: input.actorName, userId: input.actorUid, userName: input.actorName,
    electronicSignature: input.esign === true, createdAt: input.now, source: SOURCE,
    immutable: true, appendOnly: true,
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: MODULE, action: input.actionType, recordId: input.recordId, description: input.description,
    performedBy: input.actorName, userId: input.actorUid, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: SOURCE,
  });
  batch.set(firestore.collection('cpv_audit_trail').doc(), {
    moduleName: MODULE, actionType: input.actionType, actionDescription: input.description,
    recordId: input.recordId, documentNumber: input.documentNumber || '',
    userId: input.actorUid, userName: input.actorName, reason: input.reason || '',
    timestamp: input.now, createdAt: input.now, status: 'Success',
    electronicSignature: input.esign === true, source: SOURCE,
  });
}

async function notifyRole(
  firestore: Firestore,
  batch: WriteBatch,
  role: string,
  input: {
    alertId: string;
    eventName: string;
    title: string;
    message: string;
    now: string;
    actorUid?: string;
  },
) {
  if (!role) return;
  const snap = await firestore.collection('profiles')
    .where('role', '==', role)
    .limit(50)
    .get();
  snap.docs.forEach((doc) => {
    const profile = doc.data();
    if (profile.is_active === false) return;
    batch.set(firestore.collection('notifications').doc(), {
      userId: doc.id,
      title: input.title,
      message: input.message,
      type: 'cpv_alert',
      eventName: input.eventName,
      recordId: input.alertId,
      module: MODULE,
      targetRole: role,
      href: `/cpv/alert-engine/${input.alertId}`,
      read: false,
      createdAt: input.now,
    });
  });
  batch.set(firestore.collection(NOTIFICATIONS_COLLECTION).doc(), {
    alertId: input.alertId,
    title: input.title,
    message: input.message,
    targetRole: role,
    eventName: input.eventName,
    sentAt: input.now,
    createdAt: input.now,
    createdBy: input.actorUid || '',
    isDeleted: false,
  });
}

async function buildAlertNumber(firestore: Firestore, year: number): Promise<string> {
  const prefix = `ALT/${year}/`;
  try {
    const snap = await firestore.collection(COLLECTION).orderBy('createdAt', 'desc').limit(200).get();
    let maxSeq = 0;
    snap.docs.forEach((doc) => {
      const an = String(doc.data()?.alertNumber || '');
      if (an.startsWith(prefix)) {
        const seq = parseInt(an.slice(prefix.length), 10);
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
    return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
  } catch {
    return `${prefix}${String(Math.floor(Date.now() % 9000) + 1000).padStart(4, '0')}`;
  }
}

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function slaHoursFromPriority(priority: string): number {
  if (priority === 'Emergency') return 1;
  if (priority === 'Critical') return 8;
  if (priority === 'High') return 24;
  return 72;
}

function riskLevelFromPriority(priority: string): string {
  if (priority === 'Emergency') return 'Critical';
  if (['Critical', 'High', 'Medium', 'Low'].includes(priority)) return priority;
  return 'Medium';
}

function dueDaysFromPriority(priority: string): number {
  if (['Critical', 'Emergency', 'High'].includes(priority)) return 1;
  if (priority === 'Medium') return 3;
  return 7;
}

function sanitizeDeliveryChannels(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return ['In-App', 'Toast'];
  const channels = raw
    .map((c) => String(c).trim())
    .filter((c) => DELIVERY_CHANNELS.includes(c as typeof DELIVERY_CHANNELS[number]));
  return channels.length ? channels.slice(0, 12) : ['In-App', 'Toast'];
}

function sanitizeAiIntelligence(raw: unknown) {
  const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const correlated = Array.isArray(a.correlatedAlertIds)
    ? a.correlatedAlertIds.map((id) => String(id)).slice(0, 50)
    : [];
  return {
    aiConfidenceScore: num(a.aiConfidenceScore),
    aiRootCauseSuggestion: optionalString(a.aiRootCauseSuggestion, 'AI root cause', 2000),
    aiRecommendedActions: optionalString(a.aiRecommendedActions, 'AI recommended actions', 2000),
    aiClusterId: optionalString(a.aiClusterId, 'AI cluster id', 120),
    isPredictive: Boolean(a.isPredictive),
    duplicateSuppressed: Boolean(a.duplicateSuppressed),
    noiseReductionApplied: a.noiseReductionApplied === undefined ? true : Boolean(a.noiseReductionApplied),
    correlatedAlertIds: correlated,
    failurePrediction: optionalString(a.failurePrediction, 'Failure prediction', 1000),
    riskPrediction: optionalString(a.riskPrediction, 'Risk prediction', 1000),
  };
}

function observedOrLimit(value: unknown): string | number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') return value.trim().slice(0, 120);
  if (value == null) return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : String(value).slice(0, 120);
}

function appendTimeline(
  existing: unknown,
  entry: { action: string; user: string; at: string; remarks?: string },
) {
  const list = Array.isArray(existing) ? [...existing] : [];
  list.push(entry);
  return list.slice(-100);
}

async function loadAlert(firestore: Firestore, id: string) {
  const snap = await firestore.collection(COLLECTION).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Alert not found');
  const existing = snap.data() || {};
  if (existing.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'Alert is deleted');
  }
  return { snap, existing };
}

export const createAdminCpvAlert = onCall({ timeoutSeconds: 120, cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);

  const alertTitle = requiredString(data.alertTitle, 'Alert title', 300);
  const alertSource = requiredString(data.alertSource, 'Alert source', 80);
  assertEnum(alertSource, ALERT_SOURCES, 'alert source');
  const alertType = requiredString(data.alertType, 'Alert type', 120);
  assertEnum(alertType, ALERT_TYPES, 'alert type');
  const alertPriority = requiredString(data.alertPriority, 'Alert priority', 40);
  assertEnum(alertPriority, PRIORITIES, 'alert priority');
  const alertSeverity = requiredString(data.alertSeverity, 'Alert severity', 40);
  assertEnum(alertSeverity, SEVERITIES, 'alert severity');
  const alertMessage = requiredString(data.alertMessage, 'Alert message', 2000);
  const productName = requiredString(data.productName, 'Product name', 200);
  const moduleName = optionalString(data.moduleName, 'Module name', 120) || alertSource;
  const alertCategory = optionalString(data.alertCategory, 'Alert category', 80) || 'Operational';
  if (alertCategory) assertEnum(alertCategory, ALERT_CATEGORIES, 'alert category');

  const assignedTo = optionalString(data.assignedTo, 'Assigned to', 200);
  const assignedRole = optionalString(data.assignedRole, 'Assigned role', 80) || 'qa';
  if (['High', 'Critical', 'Emergency'].includes(alertPriority) && !assignedRole && !assignedTo) {
    throw new HttpsError('invalid-argument', 'Assigned role or user required for High/Critical/Emergency alerts');
  }

  const deliveryChannels = sanitizeDeliveryChannels(data.deliveryChannels);
  const aiIntelligence = sanitizeAiIntelligence(data.aiIntelligence);
  const slaHours = num(data.slaHours, slaHoursFromPriority(alertPriority)) || slaHoursFromPriority(alertPriority);
  const riskLevel = riskLevelFromPriority(alertPriority);
  const dueDate = optionalString(data.dueDate, 'Due date', 40) || addDays(dueDaysFromPriority(alertPriority));

  const year = new Date().getFullYear();
  const alertNumber = await buildAlertNumber(firestore, year);
  const now = new Date().toISOString();
  const ref = firestore.collection(COLLECTION).doc();
  const alertId = `ALT-${Date.now()}`;

  const timeline = [{
    action: 'manual alert created',
    user: actorName,
    at: now,
    remarks: reason,
  }];

  const record = {
    id: ref.id,
    alertId,
    alertNumber,
    alertTitle,
    alertSource,
    moduleName,
    productName,
    productCode: optionalString(data.productCode, 'Product code', 80),
    batchNumber: optionalString(data.batchNumber, 'Batch number', 80),
    parameterName: optionalString(data.parameterName, 'Parameter name', 200),
    observedValue: observedOrLimit(data.observedValue),
    limitValue: observedOrLimit(data.limitValue),
    alertType,
    alertCategory,
    alertPriority,
    alertSeverity,
    alertStatus: 'Open' as const,
    riskLevel,
    alertMessage,
    detectedDateTime: now,
    assignedTo,
    assignedRole,
    dueDate,
    slaHours,
    escalatedAt: '',
    escalationLevel: 0,
    acknowledgedBy: '',
    acknowledgedDateTime: '',
    closedBy: '',
    closedDateTime: '',
    closureRemarks: '',
    linkedDeviationNumber: '',
    linkedOosNumber: '',
    linkedCapaNumber: '',
    linkedRiskNumber: '',
    sourceRecordId: optionalString(data.sourceRecordId, 'Source record id', 120),
    deliveryChannels,
    aiIntelligence,
    changeReason: reason,
    electronicSignature: false,
    timeline,
    version: optionalString(data.version, 'Version', 20) || '1.0',
    createdAt: now,
    updatedAt: now,
    createdBy: actorUid,
    updatedBy: actorUid,
    createdByName: actorName,
    updatedByName: actorName,
    isDeleted: false,
  };

  const batch = firestore.batch();
  batch.set(ref, record);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: alertNumber,
    actionType: 'Alert Generated', description: `Generated ${alertNumber}: ${alertTitle}`,
    newValue: { alertPriority, alertSeverity, alertSource, riskLevel }, reason, now,
  });

  const notifyInput = {
    alertId: ref.id,
    eventName: 'Alert Generated',
    title: alertTitle,
    message: `${alertNumber}: ${alertMessage}`.slice(0, 500),
    now,
    actorUid,
  };
  await notifyRole(firestore, batch, assignedRole, notifyInput);
  if (['High', 'Critical', 'Emergency'].includes(alertPriority) && assignedRole !== 'qa') {
    await notifyRole(firestore, batch, 'qa', notifyInput);
  }
  if (['Critical', 'Emergency'].includes(alertPriority) && assignedRole !== 'head_qa') {
    await notifyRole(firestore, batch, 'head_qa', notifyInput);
  }

  await batch.commit();
  return record;
});

export const acknowledgeAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const { snap, existing } = await loadAlert(firestore, id);

  if (!MANAGE_ROLES.includes(actorRole) && !canAcknowledgeSource(actorRole, String(existing.alertSource || ''))) {
    throw new HttpsError('permission-denied', 'Acknowledge access denied for this alert source');
  }
  if (['Closed', 'Rejected'].includes(String(existing.alertStatus || ''))) {
    throw new HttpsError('failed-precondition', 'Closed or rejected alerts cannot be acknowledged');
  }

  const now = new Date().toISOString();
  const updates = {
    alertStatus: 'Acknowledged',
    acknowledgedBy: actorName,
    acknowledgedDateTime: now,
    timeline: appendTimeline(existing.timeline, {
      action: 'alert acknowledged', user: actorName, at: now, remarks: reason,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Alert Acknowledged', description: `Acknowledged ${existing.alertNumber}`,
    oldValue: existing.alertStatus, newValue: 'Acknowledged', reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const assignAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const assignedTo = requiredString(data.assignedTo, 'Assigned to', 200);
  const assignedRole = requiredString(data.assignedRole, 'Assigned role', 80);
  const reason = requiredReason(data.changeReason);
  const { snap, existing } = await loadAlert(firestore, id);

  const now = new Date().toISOString();
  const updates = {
    assignedTo,
    assignedRole,
    timeline: appendTimeline(existing.timeline, {
      action: 'alert assigned',
      user: actorName,
      at: now,
      remarks: `${assignedRole}: ${assignedTo}`,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Alert Assigned', description: `Assigned ${existing.alertNumber} to ${assignedRole}/${assignedTo}`,
    oldValue: { assignedTo: existing.assignedTo, assignedRole: existing.assignedRole },
    newValue: { assignedTo, assignedRole }, reason, now,
  });
  await notifyRole(firestore, batch, assignedRole, {
    alertId: id,
    eventName: 'Alert Assigned',
    title: `Alert assigned: ${existing.alertNumber}`,
    message: String(existing.alertMessage || existing.alertTitle || '').slice(0, 500),
    now,
    actorUid,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const linkAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const linkType = requiredString(data.linkType, 'Link type', 80) as LinkType;
  assertEnum(linkType, LINK_TYPES, 'link type');
  const linkValue = requiredString(data.linkValue, 'Link value', 120);
  const reason = requiredReason(data.changeReason);
  const { snap, existing } = await loadAlert(firestore, id);

  const statusMap: Record<LinkType, string> = {
    linkedDeviationNumber: 'Linked to Deviation',
    linkedOosNumber: 'Linked to OOS',
    linkedCapaNumber: 'Linked to CAPA',
    linkedRiskNumber: 'Under Investigation',
  };
  const actionMap: Record<LinkType, string> = {
    linkedDeviationNumber: 'Alert Linked to Deviation',
    linkedOosNumber: 'Alert Linked to OOS',
    linkedCapaNumber: 'Alert Linked to CAPA',
    linkedRiskNumber: 'Alert Linked to Risk',
  };
  const alertStatus = statusMap[linkType];
  assertEnum(alertStatus, STATUSES, 'alert status');

  const now = new Date().toISOString();
  const updates = {
    [linkType]: linkValue,
    alertStatus,
    timeline: appendTimeline(existing.timeline, {
      action: actionMap[linkType].toLowerCase(),
      user: actorName,
      at: now,
      remarks: linkValue,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: actionMap[linkType], description: `${actionMap[linkType]}: ${linkValue}`,
    oldValue: existing[linkType] || null, newValue: linkValue, reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const investigateAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const { snap, existing } = await loadAlert(firestore, id);

  if (['Closed', 'Rejected'].includes(String(existing.alertStatus || ''))) {
    throw new HttpsError('failed-precondition', 'Closed or rejected alerts cannot move to investigation');
  }

  const now = new Date().toISOString();
  const updates = {
    alertStatus: 'Under Investigation',
    timeline: appendTimeline(existing.timeline, {
      action: 'under investigation', user: actorName, at: now, remarks: reason,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Alert Under Investigation',
    description: `Investigation started for ${existing.alertNumber}`,
    oldValue: existing.alertStatus, newValue: 'Under Investigation', reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const closeAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const closureRemarks = requiredString(data.closureRemarks, 'Closure remarks', 2000);
  if (closureRemarks.length < 5) {
    throw new HttpsError('invalid-argument', 'Closure remarks must be at least 5 characters');
  }
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to close alert');
  }
  const { snap, existing } = await loadAlert(firestore, id);

  const now = new Date().toISOString();
  const updates = {
    alertStatus: 'Closed',
    closedBy: actorName,
    closedDateTime: now,
    closureRemarks,
    electronicSignature: true,
    timeline: appendTimeline(existing.timeline, {
      action: 'alert closed', user: actorName, at: now, remarks: closureRemarks,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Alert Closed', description: `Closed ${existing.alertNumber}`,
    oldValue: existing.alertStatus, newValue: 'Closed', reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Electronic Signature', description: `Close e-sign by ${actorName}`,
    reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const rejectAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const remarks = requiredString(data.remarks ?? data.closureRemarks, 'Remarks', 2000);
  if (remarks.length < 5) {
    throw new HttpsError('invalid-argument', 'Remarks must be at least 5 characters');
  }
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to reject alert');
  }
  const { snap, existing } = await loadAlert(firestore, id);

  const now = new Date().toISOString();
  const updates = {
    alertStatus: 'Rejected',
    closureRemarks: remarks,
    electronicSignature: true,
    timeline: appendTimeline(existing.timeline, {
      action: 'alert rejected', user: actorName, at: now, remarks,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Alert Rejected', description: `Rejected ${existing.alertNumber}`,
    oldValue: existing.alertStatus, newValue: 'Rejected', reason, now, esign: true,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Electronic Signature', description: `Reject e-sign by ${actorName}`,
    reason, now, esign: true,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const escalateAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const escalationRole = optionalString(data.escalationRole, 'Escalation role', 80) || 'head_qa';
  const reason = requiredReason(data.changeReason);
  if (data.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to escalate alert');
  }
  const { snap, existing } = await loadAlert(firestore, id);

  const now = new Date().toISOString();
  const nextLevel = num(existing.escalationLevel ?? existing.escalateLevel) + 1;
  const updates = {
    alertStatus: 'Overdue',
    assignedRole: escalationRole,
    escalationLevel: nextLevel,
    escalateLevel: nextLevel,
    escalatedAt: now,
    electronicSignature: true,
    timeline: appendTimeline(existing.timeline, {
      action: 'alert escalated',
      user: actorName,
      at: now,
      remarks: `Level ${nextLevel} → ${escalationRole}`,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };

  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  const escRef = firestore.collection(ESCALATIONS_COLLECTION).doc();
  batch.set(escRef, {
    id: escRef.id,
    alertId: id,
    alertNumber: String(existing.alertNumber || ''),
    escalationRole,
    escalationLevel: nextLevel,
    escalatedBy: actorName,
    escalatedByUid: actorUid,
    escalatedAt: now,
    changeReason: reason,
    createdAt: now,
    createdBy: actorUid,
    isDeleted: false,
  });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Alert Escalated',
    description: `Escalated ${existing.alertNumber} to ${escalationRole} (level ${nextLevel})`,
    oldValue: existing.alertStatus, newValue: { status: 'Overdue', escalationRole, level: nextLevel },
    reason, now, esign: true,
  });

  const notifyInput = {
    alertId: id,
    eventName: 'Alert Escalated',
    title: `Escalated: ${existing.alertNumber}`,
    message: String(existing.alertMessage || existing.alertTitle || '').slice(0, 500),
    now,
    actorUid,
  };
  await notifyRole(firestore, batch, escalationRole, notifyInput);
  if (escalationRole !== 'head_qa') {
    await notifyRole(firestore, batch, 'head_qa', notifyInput);
  }

  await batch.commit();
  return { id, ...existing, ...updates };
});

export const saveAdminAlertRule = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertConfigure(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason);
  const existingId = optionalString(data.existingId ?? data.id, 'Existing id', 120);

  const ruleCode = requiredString(data.ruleCode, 'Rule code', 80);
  const ruleName = requiredString(data.ruleName, 'Rule name', 200);
  const moduleName = requiredString(data.moduleName, 'Module name', 120);
  const conditionType = requiredString(data.conditionType, 'Condition type', 80);
  assertEnum(conditionType, CONDITION_TYPES, 'condition type');
  const comparisonOperator = requiredString(data.comparisonOperator, 'Comparison operator', 40);
  assertEnum(comparisonOperator, COMPARISON_OPERATORS, 'comparison operator');
  const priority = requiredString(data.priority, 'Priority', 40);
  assertEnum(priority, PRIORITIES, 'priority');
  const severity = requiredString(data.severity, 'Severity', 40);
  assertEnum(severity, SEVERITIES, 'severity');
  const alertCategory = optionalString(data.alertCategory, 'Alert category', 80) || 'Quality';
  assertEnum(alertCategory, ALERT_CATEGORIES, 'alert category');
  const status = optionalString(data.status, 'Status', 40) || 'Active';
  if (!['Active', 'Inactive'].includes(status)) {
    throw new HttpsError('invalid-argument', `Invalid rule status: ${status}`);
  }

  const deliveryChannels = sanitizeDeliveryChannels(data.deliveryChannels);
  const now = new Date().toISOString();
  const payload = {
    ruleId: `RULE-${ruleCode}`,
    ruleCode,
    ruleName,
    moduleName,
    parameterType: optionalString(data.parameterType, 'Parameter type', 80),
    conditionType,
    thresholdValue: num(data.thresholdValue),
    comparisonOperator,
    priority,
    severity,
    alertCategory,
    autoCreateDeviation: Boolean(data.autoCreateDeviation),
    autoCreateOos: Boolean(data.autoCreateOos),
    autoSuggestCapa: Boolean(data.autoSuggestCapa),
    notifyRole: optionalString(data.notifyRole, 'Notify role', 80) || 'qa',
    escalationRole: optionalString(data.escalationRole, 'Escalation role', 80) || 'head_qa',
    deliveryChannels,
    slaHours: Math.max(1, Math.floor(num(data.slaHours, 24))),
    dueDays: Math.max(1, Math.floor(num(data.dueDays, 3))),
    repeatAlertSuppressionHours: Math.max(0, Math.floor(num(data.repeatAlertSuppressionHours, 24))),
    status,
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    changeReason: reason,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
  };

  const batch = firestore.batch();
  if (existingId && !existingId.startsWith('default-')) {
    const snap = await firestore.collection(RULES_COLLECTION).doc(existingId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'Alert rule not found');
    batch.update(snap.ref, payload);
    writeAudit(batch, firestore, {
      actorUid, actorName, recordId: existingId, documentNumber: payload.ruleId,
      actionType: 'Alert Rule Updated', description: `Updated rule ${ruleCode}`,
      newValue: { ruleName, priority, severity, status }, reason, now,
    });
    await batch.commit();
    return { id: existingId, ...snap.data(), ...payload };
  }

  const ref = firestore.collection(RULES_COLLECTION).doc();
  const record = {
    id: ref.id,
    ...payload,
    createdAt: now,
    createdBy: actorUid,
    createdByName: actorName,
    isDeleted: false,
  };
  batch.set(ref, record);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: ref.id, documentNumber: payload.ruleId,
    actionType: 'Alert Rule Created', description: `Created rule ${ruleCode}`,
    newValue: { ruleName, priority, severity }, reason, now,
  });
  await batch.commit();
  return record;
});

export const deactivateAdminAlertRule = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertConfigure(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  if (id.startsWith('default-')) {
    throw new HttpsError('failed-precondition', 'Default seed rules cannot be deactivated in Firestore');
  }
  const snap = await firestore.collection(RULES_COLLECTION).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Alert rule not found');
  const existing = snap.data() || {};
  const now = new Date().toISOString();
  const updates = {
    status: 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.ruleId || existing.ruleCode || ''),
    actionType: 'Alert Rule Deactivated', description: `Deactivated rule ${existing.ruleCode || id}`,
    oldValue: existing.status, newValue: 'Inactive', reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const softDeleteAdminCpvAlert = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertManage(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Record id', 120);
  const reason = requiredReason(data.changeReason);
  const { snap, existing } = await loadAlert(firestore, id);

  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    timeline: appendTimeline(existing.timeline, {
      action: 'alert soft-deleted', user: actorName, at: now, remarks: reason,
    }),
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber: String(existing.alertNumber || ''),
    actionType: 'Alert Soft Deleted', description: `Soft-deleted ${existing.alertNumber}`,
    reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const logAdminCpvAlertExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertExport(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = optionalString(data.id, 'Record id', 120) || 'export';
  const exportType = optionalString(data.exportType, 'Export type', 40) || 'Download';
  const documentNumber = optionalString(data.documentNumber, 'Document number', 80);
  const reason = optionalString(data.changeReason, 'Reason', 2000) || 'Alert export';
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, documentNumber,
    actionType: 'Alert Exported', description: `Exported alert data as ${exportType}`,
    newValue: { exportType }, reason, now,
  });
  await batch.commit();
  return { ok: true };
});
