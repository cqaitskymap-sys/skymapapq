/**
 * CPV Configuration — privileged Cloud Functions.
 * Hardens the existing CPV Configuration module (singletons on cpv_configuration
 * + list collections). Triple immutable audit, e-sign for critical sections,
 * CF-only writes. Does not invent a new module.
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

const COLLECTION = 'cpv_configuration';
const MODULE = 'CPV Configuration';
const SOURCE = 'cpv-configuration-admin';

const EDIT_ROLES = ['super_admin', 'admin'];
const IMPORT_EXPORT_ROLES = ['super_admin', 'admin'];
const APPROVE_ROLES = ['super_admin', 'head_qa'];

const SINGLETON_DOC_IDS = [
  'general_settings',
  'global_org_settings',
  'process_capability_settings',
  'spc_settings',
  'risk_scoring_settings',
  'ai_settings',
  'notification_settings',
  'dashboard_settings',
  'export_report_settings',
  'security_settings',
  'backup_settings',
  'feature_flags',
] as const;

type SingletonDocId = typeof SINGLETON_DOC_IDS[number];

const ALLOWED_LIST_COLLECTIONS = [
  'cpv_config_products',
  'cpp_parameters',
  'cqa_parameters',
  'cpv_limit_rules',
  'cpv_review_frequency',
  'cpv_alert_rules',
  'cpv_report_templates',
  'cpv_workflows',
  'cpv_integration_mapping',
] as const;

type ListCollection = typeof ALLOWED_LIST_COLLECTIONS[number];

/** Section / alias keys → singleton doc IDs (import bundle flexibility). */
const SECTION_TO_DOC_ID: Record<string, SingletonDocId> = {
  general: 'general_settings',
  general_settings: 'general_settings',
  global: 'global_org_settings',
  global_org_settings: 'global_org_settings',
  capability: 'process_capability_settings',
  process_capability_settings: 'process_capability_settings',
  spc: 'spc_settings',
  spc_settings: 'spc_settings',
  risk: 'risk_scoring_settings',
  risk_scoring_settings: 'risk_scoring_settings',
  ai: 'ai_settings',
  ai_settings: 'ai_settings',
  notification: 'notification_settings',
  notification_settings: 'notification_settings',
  dashboard: 'dashboard_settings',
  dashboard_settings: 'dashboard_settings',
  exportSettings: 'export_report_settings',
  export: 'export_report_settings',
  export_report_settings: 'export_report_settings',
  security: 'security_settings',
  security_settings: 'security_settings',
  backup: 'backup_settings',
  backup_settings: 'backup_settings',
  featureFlags: 'feature_flags',
  feature_flags: 'feature_flags',
};

/** Bundle list array keys → Firestore collection names. */
const BUNDLE_LIST_TO_COLLECTION: Record<string, ListCollection> = {
  products: 'cpv_config_products',
  cppParameters: 'cpp_parameters',
  cqaParameters: 'cqa_parameters',
  limitRules: 'cpv_limit_rules',
  reviewFrequency: 'cpv_review_frequency',
  alertRules: 'cpv_alert_rules',
  annualTemplates: 'cpv_report_templates',
  workflows: 'cpv_workflows',
  dataSourceMappings: 'cpv_integration_mapping',
};

const DEFAULT_GENERAL_SETTINGS = {
  cpvEnabled: true,
  defaultReviewFrequency: 'Yearly',
  defaultReviewPeriod: 'Calendar Year',
  defaultProductOwnerRole: 'production',
  defaultQaReviewerRole: 'qa',
  defaultFinalApproverRole: 'head_qa',
  autoGenerateCpvReviewNumber: true,
  autoPullDataFromModules: true,
  autoCreateAlerts: true,
  autoCreateRiskRecords: true,
  autoSuggestCapa: true,
  requireESignatureForApproval: true,
  allowQaOverride: false,
  configurationVersion: '1.0',
  status: 'Active',
};

const DEFAULT_GLOBAL_ORG_SETTINGS = {
  organizationName: 'SkyMap Pharma',
  companyName: 'SkyMap',
  plantName: '',
  siteName: '',
  department: 'Quality Assurance',
  timeZone: 'Asia/Kolkata',
  language: 'en-IN',
  dateFormat: 'DD-MMM-YYYY',
  numberFormat: 'en-IN',
  currency: 'INR',
  fiscalYearStartMonth: 4,
  environment: 'Production',
  businessCalendarEnabled: true,
  holidayCalendarEnabled: true,
  shiftCalendarEnabled: true,
  status: 'Active',
};

const DEFAULT_CAPABILITY_SETTINGS = {
  minimumSampleCount: 5,
  cpkExcellentLimit: 1.67,
  cpkAcceptableLimit: 1.33,
  cpkWarningLimit: 1.0,
  cpkCriticalLimit: 1.0,
  cpRequired: true,
  ppPpkRequired: false,
  autoRiskIfCpkBelow: 1.33,
  autoCapaIfCpkBelow: 1.0,
  cpFormula: '(USL-LSL)/(6*sigma)',
  cpkFormula: 'min((USL-mean),(mean-LSL))/(3*sigma)',
  ppFormula: '(USL-LSL)/(6*s)',
  ppkFormula: 'min((USL-mean),(mean-LSL))/(3*s)',
  sigmaLimits: 3,
  status: 'Active',
};

const DEFAULT_SPC_SETTINGS = {
  defaultChartType: 'Individuals Chart',
  enableRule1OutsideControlLimit: true,
  enableRule2SevenPointsSameSide: true,
  enableRule3SixIncreasingDecreasing: true,
  enableRule4TwoOfThreeNearLimit: true,
  enableWesternElectricRules: true,
  enableNelsonRules: true,
  enableCusum: false,
  enableEwma: false,
  ewmaLambda: 0.2,
  samplingFrequency: 'Per Batch',
  defaultSampleSize: 5,
  enableAutoRiskCreation: true,
  enableCapaSuggestion: false,
  status: 'Active',
};

const DEFAULT_RISK_SETTINGS = {
  riskMethod: 'RPN',
  severityScale: 10,
  occurrenceScale: 10,
  detectionScale: 10,
  lowRiskMaxRpn: 50,
  mediumRiskMaxRpn: 100,
  highRiskMaxRpn: 200,
  criticalRiskMinRpn: 201,
  autoCapaForCriticalRisk: true,
  status: 'Active',
};

const DEFAULT_AI_SETTINGS = {
  aiEnabled: true,
  enablePredictiveAlerts: true,
  enableInsights: true,
  enableRecommendations: true,
  enableRiskPrediction: true,
  enableTrendPrediction: true,
  enableRootCauseAnalysis: true,
  enablePreventiveRecommendations: true,
  confidenceThreshold: 70,
  predictionThreshold: 65,
  enableForCpp: true,
  enableForCqa: true,
  enableForYield: true,
  enableForSpc: true,
  enableForRisk: true,
  enableForAlerts: true,
  status: 'Active',
};

const DEFAULT_NOTIFICATION_SETTINGS = {
  enableInApp: true,
  enableEmail: true,
  enableSms: false,
  enableWhatsApp: false,
  enableTeams: false,
  enableSlack: false,
  enablePush: true,
  enableFcm: true,
  reminderEnabled: true,
  reminderBeforeHours: 24,
  retryAttempts: 3,
  retryIntervalMinutes: 15,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '06:00',
  defaultTemplate: 'CPV Alert Standard',
  status: 'Active',
};

const DEFAULT_DASHBOARD_SETTINGS = {
  enableExecutiveDashboard: true,
  enableRoleBasedLayouts: true,
  defaultTheme: 'System',
  showKpiCards: true,
  showTrendCharts: true,
  showAlertFeed: true,
  showAiPanel: true,
  refreshIntervalSeconds: 60,
  savedLayoutName: 'Default CPV Layout',
  status: 'Active',
};

const DEFAULT_EXPORT_SETTINGS = {
  enablePdfExport: true,
  enableExcelExport: true,
  enableCsvExport: true,
  enablePrint: true,
  enableScheduledReports: false,
  enableEmailReports: false,
  reportHeaderSource: 'Company Site Master',
  showCompanyLogo: true,
  showPageNumber: true,
  showRevisionNumber: true,
  showESignatureBlock: true,
  showAuditTrailSummary: true,
  enableWatermark: true,
  watermarkText: 'CONTROLLED COPY',
  customBrandingEnabled: true,
  status: 'Active',
};

const DEFAULT_SECURITY_SETTINGS = {
  enforceRbac: true,
  requireMfaForCriticalChanges: false,
  sessionTimeoutMinutes: 30,
  passwordMinLength: 12,
  ipWhitelistEnabled: false,
  ipWhitelist: '',
  auditAllConfigChanges: true,
  encryptNotificationPayloads: true,
  requireEsignForConfig: true,
  status: 'Active',
};

const DEFAULT_BACKUP_SETTINGS = {
  autoBackupEnabled: true,
  backupFrequency: 'Daily',
  retentionDays: 90,
  verifyAfterBackup: true,
  storeInCloudStorage: true,
  includeAuditTrail: true,
  disasterRecoveryEnabled: true,
  lastBackupAt: '',
  status: 'Active',
};

const DEFAULT_FEATURE_FLAGS = {
  enableYieldModule: true,
  enableEnvironmentalModule: true,
  enableUtilityModule: true,
  enableHoldTimeModule: true,
  enableStabilityModule: true,
  enableSpcModule: true,
  enableCapabilityModule: true,
  enableRiskModule: true,
  enableAlertEngine: true,
  enableAiAnalytics: true,
  enableAnnualReview: true,
  enableReportsAnalytics: true,
  status: 'Active',
};

const DEFAULT_SINGLETONS: Record<SingletonDocId, Record<string, unknown>> = {
  general_settings: DEFAULT_GENERAL_SETTINGS,
  global_org_settings: DEFAULT_GLOBAL_ORG_SETTINGS,
  process_capability_settings: DEFAULT_CAPABILITY_SETTINGS,
  spc_settings: DEFAULT_SPC_SETTINGS,
  risk_scoring_settings: DEFAULT_RISK_SETTINGS,
  ai_settings: DEFAULT_AI_SETTINGS,
  notification_settings: DEFAULT_NOTIFICATION_SETTINGS,
  dashboard_settings: DEFAULT_DASHBOARD_SETTINGS,
  export_report_settings: DEFAULT_EXPORT_SETTINGS,
  security_settings: DEFAULT_SECURITY_SETTINGS,
  backup_settings: DEFAULT_BACKUP_SETTINGS,
  feature_flags: DEFAULT_FEATURE_FLAGS,
};

function assertEdit(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDIT_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Configuration edit access required');
  }
}

function assertImportExport(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !IMPORT_EXPORT_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Configuration import/export access required');
  }
}

function assertApprove(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !APPROVE_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'CPV Configuration approve access required');
  }
}

function assertSingletonDocId(docId: string): asserts docId is SingletonDocId {
  if (!SINGLETON_DOC_IDS.includes(docId as SingletonDocId)) {
    throw new HttpsError('invalid-argument', `Invalid configuration docId: ${docId}`);
  }
}

function assertListCollection(name: string): asserts name is ListCollection {
  if (!ALLOWED_LIST_COLLECTIONS.includes(name as ListCollection)) {
    throw new HttpsError('invalid-argument', `Invalid list collection: ${name}`);
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
    collectionName?: string;
    actionType: string; description: string; oldValue?: unknown; newValue?: unknown;
    reason?: string; now: string; esign?: boolean;
  },
) {
  const collectionName = input.collectionName || COLLECTION;
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-CFG-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now, timestamp: input.now, moduleName: 'CPV', subModule: MODULE,
    collectionName, recordId: input.recordId, documentId: input.recordId,
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

function notifyActor(
  firestore: Firestore,
  batch: WriteBatch,
  input: {
    targetUid: string; recordId: string; eventName: string;
    title: string; message: string; now: string;
  },
) {
  batch.set(firestore.collection('notifications').doc(), {
    userId: input.targetUid,
    title: input.title,
    message: input.message,
    type: 'cpv_configuration',
    eventName: input.eventName,
    recordId: input.recordId,
    module: MODULE,
    href: '/cpv/configuration',
    read: false,
    createdAt: input.now,
  });
}

function stripMeta(raw: unknown): Record<string, unknown> {
  const data = (raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete data.id;
  delete data.createdAt;
  delete data.createdBy;
  delete data.updatedAt;
  delete data.updatedBy;
  delete data.isDeleted;
  delete data.changeReason;
  delete data.electronicSignature;
  return data;
}

function requiresEsignForSingleton(
  docId: string,
  incoming: Record<string, unknown>,
  existing?: DocumentData,
): boolean {
  if (docId === 'security_settings' || docId === 'backup_settings') return true;
  if (docId === 'general_settings') {
    const flag = incoming.requireESignatureForApproval
      ?? incoming.requireESignature
      ?? existing?.requireESignatureForApproval
      ?? existing?.requireESignature
      ?? true;
    return flag === true;
  }
  return false;
}

function isCriticalSingleton(docId: string): boolean {
  return docId === 'security_settings' || docId === 'backup_settings';
}

export const saveAdminCpvConfigSingleton = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEdit(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const docId = requiredString(payload.docId, 'Document id', 80);
  assertSingletonDocId(docId);
  const reason = requiredReason(payload.changeReason);
  const data = stripMeta(payload.data);

  const ref = firestore.collection(COLLECTION).doc(docId);
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() || {}) : undefined;
  const isNew = !snap.exists;
  const needEsign = requiresEsignForSingleton(docId, data, existing);
  if (needEsign && payload.esignConfirmed !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Electronic signature required for this configuration change',
    );
  }

  const now = new Date().toISOString();
  const esign = needEsign || payload.esignConfirmed === true;
  const record: Record<string, unknown> = {
    ...data,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
    electronicSignature: esign,
    isDeleted: false,
  };
  if (isNew) {
    record.createdAt = now;
    record.createdBy = actorUid;
    record.createdByName = actorName;
  } else {
    record.createdAt = existing?.createdAt || now;
    record.createdBy = existing?.createdBy || actorUid;
    record.createdByName = existing?.createdByName || actorName;
  }

  const batch = firestore.batch();
  batch.set(ref, record, { merge: true });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: docId,
    actionType: isNew ? 'Configuration Created' : 'Configuration Updated',
    description: `${isNew ? 'Created' : 'Updated'} CPV configuration singleton ${docId}`,
    oldValue: existing || null,
    newValue: { docId, keys: Object.keys(data) },
    reason, now, esign,
  });
  if (isCriticalSingleton(docId)) {
    notifyActor(firestore, batch, {
      targetUid: actorUid, recordId: docId, now,
      eventName: 'Critical Configuration Change',
      title: `CPV ${docId} updated`,
      message: `${actorName} updated ${docId}: ${reason}`.slice(0, 500),
    });
  }
  await batch.commit();
  return { id: docId, ...record };
});

export const createAdminCpvConfigListRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEdit(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const collectionName = requiredString(payload.collectionName, 'Collection name', 80);
  assertListCollection(collectionName);
  const reason = requiredReason(payload.changeReason);
  const data = stripMeta(payload.data);

  const now = new Date().toISOString();
  const ref = firestore.collection(collectionName).doc();
  const record = {
    id: ref.id,
    ...data,
    changeReason: reason,
    electronicSignature: false,
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
    actorUid, actorName, recordId: ref.id, collectionName,
    actionType: 'Configuration Created',
    description: `Created configuration record in ${collectionName}`,
    newValue: data, reason, now,
  });
  await batch.commit();
  return record;
});

export const updateAdminCpvConfigListRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEdit(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const collectionName = requiredString(payload.collectionName, 'Collection name', 80);
  assertListCollection(collectionName);
  const id = requiredString(payload.id, 'Record id', 120);
  const reason = requiredReason(payload.changeReason);
  const data = stripMeta(payload.data);

  const snap = await firestore.collection(collectionName).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Configuration record not found');
  const existing = snap.data() || {};
  if (existing.isDeleted === true) {
    throw new HttpsError('failed-precondition', 'Configuration record is deleted');
  }

  const now = new Date().toISOString();
  const updates = {
    ...data,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.set(snap.ref, updates, { merge: true });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, collectionName,
    actionType: 'Configuration Updated',
    description: `Updated configuration record in ${collectionName}`,
    oldValue: existing, newValue: updates, reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const softDeleteAdminCpvConfigListRecord = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEdit(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const collectionName = requiredString(payload.collectionName, 'Collection name', 80);
  assertListCollection(collectionName);
  const id = requiredString(payload.id, 'Record id', 120);
  const reason = requiredReason(payload.changeReason);

  const snap = await firestore.collection(collectionName).doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Configuration record not found');
  const existing = snap.data() || {};

  const now = new Date().toISOString();
  const updates = {
    isDeleted: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    changeReason: reason,
  };
  const batch = firestore.batch();
  batch.update(snap.ref, updates);
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: id, collectionName,
    actionType: 'Configuration Soft Deleted',
    description: `Soft-deleted configuration record in ${collectionName}`,
    oldValue: { isDeleted: existing.isDeleted }, newValue: { isDeleted: true },
    reason, now,
  });
  await batch.commit();
  return { id, ...existing, ...updates };
});

export const resetAdminCpvConfigurationDefaults = onCall({ timeoutSeconds: 60 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEdit(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(payload.changeReason);
  if (payload.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to reset configuration defaults');
  }

  const now = new Date().toISOString();
  const batch = firestore.batch();
  const written: string[] = [];

  for (const docId of SINGLETON_DOC_IDS) {
    const defaults = DEFAULT_SINGLETONS[docId];
    const ref = firestore.collection(COLLECTION).doc(docId);
    const record = {
      ...defaults,
      createdAt: now,
      updatedAt: now,
      createdBy: actorUid,
      updatedBy: actorUid,
      createdByName: actorName,
      updatedByName: actorName,
      changeReason: reason,
      electronicSignature: true,
      isDeleted: false,
    };
    batch.set(ref, record, { merge: true });
    written.push(docId);
  }

  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: 'defaults',
    actionType: 'Configuration Reset Defaults',
    description: `Reset ${written.length} CPV configuration singletons to defaults`,
    newValue: { singletons: written }, reason, now, esign: true,
  });
  notifyActor(firestore, batch, {
    targetUid: actorUid, recordId: 'defaults', now,
    eventName: 'Configuration Reset Defaults',
    title: 'CPV Configuration reset to defaults',
    message: `${actorName} reset singleton defaults: ${reason}`.slice(0, 500),
  });
  await batch.commit();
  return { ok: true, singletons: written };
});

export const importAdminCpvConfiguration = onCall({ timeoutSeconds: 120 }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertImportExport(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(payload.changeReason);
  if (payload.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to import configuration');
  }
  const bundle = (payload.bundle && typeof payload.bundle === 'object')
    ? payload.bundle as Record<string, unknown>
    : {};

  const now = new Date().toISOString();
  const importedSingletons: string[] = [];
  const importedLists: Record<string, number> = {};

  // Singletons keyed by docId or section name
  for (const [key, value] of Object.entries(bundle)) {
    const docId = SECTION_TO_DOC_ID[key];
    if (!docId || value == null || typeof value !== 'object' || Array.isArray(value)) continue;
    const data = stripMeta(value);
    const ref = firestore.collection(COLLECTION).doc(docId);
    const existingSnap = await ref.get();
    const existing = existingSnap.exists ? (existingSnap.data() || {}) : {};
    await ref.set({
      ...data,
      updatedAt: now,
      updatedBy: actorUid,
      updatedByName: actorName,
      changeReason: reason,
      electronicSignature: true,
      isDeleted: false,
      createdAt: existing.createdAt || now,
      createdBy: existing.createdBy || actorUid,
      createdByName: existing.createdByName || actorName,
    }, { merge: true });
    importedSingletons.push(docId);
  }

  // List arrays — always create new docs (never update by import id)
  for (const [bundleKey, collectionName] of Object.entries(BUNDLE_LIST_TO_COLLECTION)) {
    const rows = bundle[bundleKey];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    let count = 0;
    for (const row of rows.slice(0, 500)) {
      if (!row || typeof row !== 'object') continue;
      const data = stripMeta(row);
      const ref = firestore.collection(collectionName).doc();
      await ref.set({
        id: ref.id,
        ...data,
        changeReason: reason,
        electronicSignature: true,
        createdAt: now,
        updatedAt: now,
        createdBy: actorUid,
        updatedBy: actorUid,
        createdByName: actorName,
        updatedByName: actorName,
        isDeleted: false,
      });
      count += 1;
    }
    importedLists[collectionName] = count;
  }

  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: 'import',
    actionType: 'Configuration Imported',
    description: `Imported CPV configuration (${importedSingletons.length} singletons, ${Object.values(importedLists).reduce((a, b) => a + b, 0)} list rows)`,
    newValue: { singletons: importedSingletons, lists: importedLists },
    reason, now, esign: true,
  });
  if (importedSingletons.includes('security_settings') || importedSingletons.includes('backup_settings')) {
    notifyActor(firestore, batch, {
      targetUid: actorUid, recordId: 'import', now,
      eventName: 'Critical Configuration Import',
      title: 'CPV security/backup settings imported',
      message: `${actorName} imported critical configuration: ${reason}`.slice(0, 500),
    });
  }
  await batch.commit();
  return { ok: true, singletons: importedSingletons, lists: importedLists };
});

export const logAdminCpvConfigurationExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertImportExport(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(payload.changeReason);
  const count = Number(payload.count);
  const now = new Date().toISOString();
  const batch = firestore.batch();
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: 'export',
    actionType: 'Configuration Exported',
    description: `Exported CPV configuration${Number.isFinite(count) ? ` (${count} records)` : ''}`,
    newValue: { count: Number.isFinite(count) ? count : null },
    reason, now,
  });
  await batch.commit();
  return { ok: true };
});

export const approveAdminCpvConfiguration = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertApprove(actor, actorRole);
  const payload = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(payload.changeReason);
  if (payload.esignConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Electronic signature required to approve configuration');
  }
  const snapshotSummary = optionalString(payload.snapshotSummary, 'Snapshot summary', 2000);

  const now = new Date().toISOString();
  const docId = 'configuration_approval';
  const ref = firestore.collection(COLLECTION).doc(docId);
  const existingSnap = await ref.get();
  const existing = existingSnap.exists ? (existingSnap.data() || {}) : {};

  const record = {
    status: 'Approved',
    approvedBy: actorName,
    approvedByUid: actorUid,
    approvedAt: now,
    snapshotSummary,
    changeReason: reason,
    electronicSignature: true,
    updatedAt: now,
    updatedBy: actorUid,
    updatedByName: actorName,
    isDeleted: false,
    createdAt: existing.createdAt || now,
    createdBy: existing.createdBy || actorUid,
    createdByName: existing.createdByName || actorName,
  };

  const batch = firestore.batch();
  batch.set(ref, record, { merge: true });
  writeAudit(batch, firestore, {
    actorUid, actorName, recordId: docId,
    actionType: 'Configuration Approved',
    description: `Approved CPV configuration by ${actorName}`,
    oldValue: existing.status || null,
    newValue: { status: 'Approved', snapshotSummary },
    reason, now, esign: true,
  });
  await batch.commit();
  return { id: docId, ...record };
});
