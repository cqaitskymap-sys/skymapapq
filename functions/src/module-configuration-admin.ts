/**
 * Module Configuration — privileged Cloud Functions.
 * Feature flags, dependencies, enable/disable with Part 11 change control.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { getApps, initializeApp } from 'firebase-admin/app';
import {
  getFirestore, type Firestore, type DocumentData,
} from 'firebase-admin/firestore';

function initializeAdmin() {
  if (getApps().length === 0) initializeApp();
}

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

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 40);
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 40);
  }
  return [];
}

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor', 'qa_manager'];
const EDITOR_ROLES = ['super_admin', 'admin'];
const CRITICAL_CODES = new Set(['ADMIN', 'USERS', 'ROLES', 'AUDIT_TRAIL', 'ESIGN', 'SYSTEM_SETTINGS']);

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Module Configuration view access required');
  }
}

function assertEditor(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !EDITOR_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'Module Configuration edit access required');
  }
}

async function resolveActor(request: { auth?: { uid: string } | null }) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Authentication required');
  initializeAdmin();
  const firestore = getFirestore();
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

async function writeModuleAudit(
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
    auditId: `AUD-MODCFG-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'Module Configuration',
    collectionName: 'module_configuration',
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
    source: 'module-configuration-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: 'Module Configuration',
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

function parseFeatureFlags(value: unknown): Array<Record<string, unknown>> {
  let raw: unknown = value;
  if (typeof value === 'string') {
    try {
      raw = JSON.parse(value || '[]');
    } catch {
      throw new HttpsError('invalid-argument', 'Feature flags must be valid JSON');
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).map((item) => {
    const row = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const key = String(row.key || '').trim();
    if (!key) throw new HttpsError('invalid-argument', 'Each feature flag requires a key');
    return {
      key,
      label: String(row.label || key),
      enabled: row.enabled === true,
      rollout: String(row.rollout || (row.enabled ? 'GA' : 'Off')),
      roles: asStringArray(row.roles),
      departments: asStringArray(row.departments),
      sites: asStringArray(row.sites),
    };
  });
}

function parseConfigJson(value: unknown): string {
  const text = optionalString(value, 'Configuration JSON', 50000) || '{}';
  try {
    JSON.parse(text);
  } catch {
    throw new HttpsError('invalid-argument', 'Configuration JSON must be valid JSON');
  }
  return text;
}

function buildModuleConfigId(code: string): string {
  return `MOD-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

function parsePayload(data: Record<string, unknown>, actorUid: string, status: string) {
  const moduleCode = requiredString(data.moduleCode, 'Module code', 40).toUpperCase();
  const moduleName = requiredString(data.moduleName, 'Module name', 120);
  const isCritical = asBool(data.isCritical, CRITICAL_CODES.has(moduleCode));
  const isSystemModule = asBool(data.isSystemModule, isCritical);
  const dependencies = asStringArray(data.dependencies).map((d) => d.toUpperCase());
  if (dependencies.includes(moduleCode)) {
    throw new HttpsError('invalid-argument', 'Module cannot depend on itself');
  }

  return {
    moduleConfigId: buildModuleConfigId(moduleCode),
    moduleCode,
    moduleName,
    displayName: optionalString(data.displayName, 'Display name', 120) || moduleName,
    moduleCategory: optionalString(data.moduleCategory, 'Category', 80) || 'QMS',
    description: optionalString(data.description, 'Description', 2000),
    displayOrder: asNumber(data.displayOrder ?? data.sortOrder, 0),
    sortOrder: asNumber(data.displayOrder ?? data.sortOrder, 0),
    menuGroup: optionalString(data.menuGroup, 'Menu group', 80),
    navigationPath: optionalString(data.navigationPath || data.route, 'Navigation path', 200),
    route: optionalString(data.navigationPath || data.route, 'Route', 200),
    icon: optionalString(data.icon, 'Icon', 60),
    version: optionalString(data.version, 'Version', 40) || '1.0.0',
    buildNumber: optionalString(data.buildNumber, 'Build number', 40),
    isEnabled: asBool(data.isEnabled, true),
    isInstalled: asBool(data.isInstalled, true),
    isSystemModule,
    isCritical,
    isVisible: asBool(data.isVisible, true),
    visibility: optionalString(data.visibility, 'Visibility', 40) || 'Visible',
    licenseStatus: optionalString(data.licenseStatus, 'License status', 40) || 'Licensed',
    featureStatus: optionalString(data.featureStatus, 'Feature status', 40) || 'GA',
    environment: optionalString(data.environment, 'Environment', 40) || 'Production',
    company: optionalString(data.company, 'Company', 120),
    businessUnit: optionalString(data.businessUnit, 'Business unit', 120),
    site: optionalString(data.site, 'Site', 120),
    department: optionalString(data.department, 'Department', 120),
    requiredRole: optionalString(data.requiredRole, 'Required role', 80),
    dependencies,
    featureFlags: parseFeatureFlags(data.featureFlagsJson ?? data.featureFlags),
    configurationJson: parseConfigJson(data.configurationJson),
    remarks: optionalString(data.remarks, 'Remarks', 2000),
    status,
    isDeleted: false,
    updatedBy: actorUid,
  };
}

async function snapshotVersion(
  firestore: Firestore,
  docId: string,
  row: DocumentData,
  actorUid: string,
  now: string,
) {
  await firestore.collection('module_configuration_versions').doc().set({
    moduleDocId: docId,
    moduleCode: row.moduleCode,
    version: row.version || '1.0.0',
    isEnabled: row.isEnabled === true,
    dependencies: row.dependencies || [],
    featureFlags: row.featureFlags || [],
    configurationJson: row.configurationJson || '{}',
    environment: row.environment || 'Production',
    snapshotAt: now,
    snapshotBy: actorUid,
    createdAt: now,
  });
}

async function assertDependenciesEnabled(
  firestore: Firestore,
  dependencies: string[],
  exceptCode?: string,
) {
  if (!dependencies.length) return;
  const snap = await firestore.collection('module_configuration').limit(300).get();
  const byCode = new Map<string, DocumentData>();
  for (const d of snap.docs) {
    const row = d.data();
    if (row.isDeleted === true) continue;
    byCode.set(String(row.moduleCode || '').toUpperCase(), row);
  }
  const missing: string[] = [];
  const disabled: string[] = [];
  for (const dep of dependencies) {
    if (exceptCode && dep === exceptCode) continue;
    const row = byCode.get(dep);
    if (!row || row.isInstalled === false) missing.push(dep);
    else if (row.isEnabled !== true || row.status === 'Inactive') disabled.push(dep);
  }
  if (missing.length || disabled.length) {
    throw new HttpsError(
      'failed-precondition',
      `Dependency check failed. Missing: ${missing.join(', ') || 'none'}. Disabled: ${disabled.join(', ') || 'none'}.`,
    );
  }
}

async function assertNotRequiredByOthers(
  firestore: Firestore,
  moduleCode: string,
) {
  const snap = await firestore.collection('module_configuration').limit(300).get();
  const dependents: string[] = [];
  for (const d of snap.docs) {
    const row = d.data();
    if (row.isDeleted === true || row.isEnabled !== true) continue;
    const deps = Array.isArray(row.dependencies) ? row.dependencies.map(String) : [];
    if (deps.map((x: string) => x.toUpperCase()).includes(moduleCode)) {
      dependents.push(String(row.moduleCode));
    }
  }
  if (dependents.length) {
    throw new HttpsError(
      'failed-precondition',
      `Cannot disable/uninstall ${moduleCode}; required by: ${dependents.join(', ')}`,
    );
  }
}

const SEED_MODULES = [
  { moduleCode: 'ADMIN', moduleName: 'Admin Dashboard', moduleCategory: 'Core Admin', navigationPath: '/admin', icon: 'LayoutDashboard', isCritical: true, isSystemModule: true, dependencies: [], displayOrder: 1 },
  { moduleCode: 'USERS', moduleName: 'User Management', moduleCategory: 'Core Admin', navigationPath: '/admin/users', icon: 'Users', isCritical: true, isSystemModule: true, dependencies: ['ADMIN'], displayOrder: 2 },
  { moduleCode: 'ROLES', moduleName: 'Role & Permission', moduleCategory: 'Core Admin', navigationPath: '/admin/roles', icon: 'Shield', isCritical: true, isSystemModule: true, dependencies: ['USERS'], displayOrder: 3 },
  { moduleCode: 'AUDIT_TRAIL', moduleName: 'Audit Trail', moduleCategory: 'Security', navigationPath: '/admin/audit-trail', icon: 'FileSearch', isCritical: true, isSystemModule: true, dependencies: ['ADMIN'], displayOrder: 10 },
  { moduleCode: 'ESIGN', moduleName: 'E-Signature Settings', moduleCategory: 'Security', navigationPath: '/admin/esign-settings', icon: 'PenLine', isCritical: true, isSystemModule: true, dependencies: ['USERS'], displayOrder: 11 },
  { moduleCode: 'SYSTEM_SETTINGS', moduleName: 'System Settings', moduleCategory: 'Core Admin', navigationPath: '/admin/system-settings', icon: 'Settings', isCritical: true, isSystemModule: true, dependencies: ['ADMIN'], displayOrder: 12 },
  { moduleCode: 'PRODUCTS', moduleName: 'Product Master', moduleCategory: 'QMS', navigationPath: '/admin/products', icon: 'FlaskConical', dependencies: ['ADMIN'], displayOrder: 20 },
  { moduleCode: 'WORKFLOWS', moduleName: 'Workflow Configuration', moduleCategory: 'QMS', navigationPath: '/admin/workflows', icon: 'GitBranch', dependencies: ['ROLES'], displayOrder: 21 },
  { moduleCode: 'APPROVAL_MATRIX', moduleName: 'Approval Matrix', moduleCategory: 'QMS', navigationPath: '/admin/approval-matrix', icon: 'CheckSquare', dependencies: ['WORKFLOWS', 'ROLES'], displayOrder: 22 },
  { moduleCode: 'NOTIFICATIONS', moduleName: 'Notification Settings', moduleCategory: 'Core Admin', navigationPath: '/admin/notifications', icon: 'Bell', dependencies: ['USERS'], displayOrder: 23 },
  { moduleCode: 'TEMPLATES', moduleName: 'Email & SMS Templates', moduleCategory: 'Core Admin', navigationPath: '/admin/email-sms-templates', icon: 'Mail', dependencies: ['NOTIFICATIONS'], displayOrder: 24 },
  { moduleCode: 'DMS', moduleName: 'Document Management', moduleCategory: 'Document Management', navigationPath: '/qms/dms', icon: 'BookOpen', dependencies: ['WORKFLOWS'], displayOrder: 31 },
  { moduleCode: 'CAPA', moduleName: 'CAPA', moduleCategory: 'QMS', navigationPath: '/qms/capa', icon: 'CheckSquare', dependencies: ['APPROVAL_MATRIX'], displayOrder: 32 },
  { moduleCode: 'DEVIATION', moduleName: 'Deviation', moduleCategory: 'QMS', navigationPath: '/qms/deviation', icon: 'AlertTriangle', dependencies: ['PRODUCTS'], displayOrder: 33 },
  { moduleCode: 'AUDIT_MGMT', moduleName: 'Audit Management', moduleCategory: 'QMS', navigationPath: '/qms/audit', icon: 'ClipboardCheck', dependencies: ['ESIGN'], displayOrder: 34 },
  { moduleCode: 'EQUIPMENT', moduleName: 'Equipment Management', moduleCategory: 'Equipment', navigationPath: '/equipment', icon: 'Cog', dependencies: ['USERS'], displayOrder: 40 },
  { moduleCode: 'VALIDATION', moduleName: 'Validation', moduleCategory: 'Equipment', navigationPath: '/validation', icon: 'ShieldCheck', dependencies: ['EQUIPMENT'], displayOrder: 41 },
  { moduleCode: 'RISK', moduleName: 'Risk Management', moduleCategory: 'QMS', navigationPath: '/qms/risk', icon: 'ShieldAlert', dependencies: ['USERS'], displayOrder: 42 },
];

export const createAdminModuleConfiguration = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? data.reason);
  const payload = parsePayload(data, actorUid, 'Active');

  const codeSnap = await firestore.collection('module_configuration')
    .where('moduleCode', '==', payload.moduleCode).limit(1).get();
  if (!codeSnap.empty && codeSnap.docs[0].data().isDeleted !== true) {
    throw new HttpsError('already-exists', 'Module code already exists');
  }
  const nameSnap = await firestore.collection('module_configuration')
    .where('moduleName', '==', payload.moduleName).limit(1).get();
  if (!nameSnap.empty && nameSnap.docs[0].data().isDeleted !== true) {
    throw new HttpsError('already-exists', 'Module name already exists');
  }
  if (payload.isEnabled) await assertDependenciesEnabled(firestore, payload.dependencies);

  const now = new Date().toISOString();
  const ref = firestore.collection('module_configuration').doc();
  const row = { ...payload, createdAt: now, updatedAt: now, createdBy: actorUid, changeReason: reason };
  await ref.set(row);
  await snapshotVersion(firestore, ref.id, row, actorUid, now);
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: ref.id, actionType: 'Module Installed',
    description: `Module ${payload.moduleCode} created/installed`,
    newValue: payload, reason, now,
  });
  return { success: true, id: ref.id, moduleConfigId: payload.moduleConfigId };
});

export const updateAdminModuleConfiguration = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Module ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('module_configuration').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Module configuration not found');
  }
  const existing = snap.data()!;
  const payload = parsePayload(data, actorUid, String(existing.status || 'Active'));
  if (payload.moduleCode !== existing.moduleCode) {
    throw new HttpsError('failed-precondition', 'Module code cannot be changed');
  }
  if (existing.isSystemModule && payload.isSystemModule === false) {
    throw new HttpsError('failed-precondition', 'System module flag cannot be cleared');
  }
  if (payload.isEnabled) await assertDependenciesEnabled(firestore, payload.dependencies, payload.moduleCode);

  const now = new Date().toISOString();
  await snapshotVersion(firestore, id, existing, actorUid, now);
  await snap.ref.update({ ...payload, updatedAt: now, changeReason: reason });
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Configuration Changed',
    description: `Module ${payload.moduleCode} configuration updated`,
    oldValue: existing, newValue: payload, reason, now,
  });
  return { success: true, id };
});

export const setAdminModuleEnabled = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Module ID', 128);
  const isEnabled = asBool(data.isEnabled, true);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('module_configuration').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Module configuration not found');
  }
  const row = snap.data()!;
  const code = String(row.moduleCode || '');
  if (!isEnabled && (row.isCritical || CRITICAL_CODES.has(code))) {
    throw new HttpsError('failed-precondition', `Critical module ${code} cannot be disabled`);
  }
  if (!isEnabled) await assertNotRequiredByOthers(firestore, code);
  if (isEnabled) {
    await assertDependenciesEnabled(
      firestore,
      Array.isArray(row.dependencies) ? row.dependencies.map(String) : [],
      code,
    );
  }
  const now = new Date().toISOString();
  await snap.ref.update({
    isEnabled,
    status: isEnabled ? 'Active' : 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  });
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: id,
    actionType: isEnabled ? 'Module Enabled' : 'Module Disabled',
    description: `Module ${code} ${isEnabled ? 'enabled' : 'disabled'}`,
    oldValue: { isEnabled: row.isEnabled }, newValue: { isEnabled }, reason, now,
  });
  return { success: true, isEnabled };
});

export const setAdminModuleVisibility = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Module ID', 128);
  const isVisible = asBool(data.isVisible, true);
  const visibility = optionalString(data.visibility, 'Visibility', 40) || (isVisible ? 'Visible' : 'Hidden');
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('module_configuration').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Module configuration not found');
  }
  const now = new Date().toISOString();
  await snap.ref.update({
    isVisible, visibility, updatedAt: now, updatedBy: actorUid, changeReason: reason,
  });
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Configuration Changed',
    description: `Module ${snap.data()?.moduleCode} visibility → ${visibility}`,
    newValue: { isVisible, visibility }, reason, now,
  });
  return { success: true };
});

export const setAdminModuleFeatureFlag = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Module ID', 128);
  const flagKey = requiredString(data.flagKey, 'Feature flag key', 80);
  const enabled = asBool(data.enabled, false);
  const rollout = optionalString(data.rollout, 'Rollout', 40) || (enabled ? 'GA' : 'Off');
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('module_configuration').doc(id).get();
  if (!snap.exists || snap.data()?.isDeleted === true) {
    throw new HttpsError('not-found', 'Module configuration not found');
  }
  const flags = Array.isArray(snap.data()?.featureFlags)
    ? [...(snap.data()!.featureFlags as Array<Record<string, unknown>>)]
    : [];
  const idx = flags.findIndex((f) => String(f.key) === flagKey);
  if (idx >= 0) {
    flags[idx] = { ...flags[idx], enabled, rollout };
  } else {
    flags.push({ key: flagKey, label: flagKey, enabled, rollout, roles: [], departments: [], sites: [] });
  }
  const now = new Date().toISOString();
  await snap.ref.update({ featureFlags: flags, updatedAt: now, updatedBy: actorUid, changeReason: reason });
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: id,
    actionType: enabled ? 'Feature Enabled' : 'Feature Disabled',
    description: `Feature ${flagKey} on ${snap.data()?.moduleCode} → ${rollout}`,
    newValue: { flagKey, enabled, rollout }, reason, now,
  });
  return { success: true, featureFlags: flags };
});

export const softDeleteAdminModuleConfiguration = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const id = requiredString(data.id, 'Module ID', 128);
  const reason = requiredReason(data.changeReason ?? data.reason);
  const snap = await firestore.collection('module_configuration').doc(id).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Module configuration not found');
  const row = snap.data()!;
  const code = String(row.moduleCode || '');
  if (row.isSystemModule || row.isCritical || CRITICAL_CODES.has(code)) {
    throw new HttpsError('failed-precondition', `System/critical module ${code} cannot be uninstalled`);
  }
  await assertNotRequiredByOthers(firestore, code);
  const now = new Date().toISOString();
  await snap.ref.update({
    isDeleted: true,
    isEnabled: false,
    isInstalled: false,
    status: 'Inactive',
    updatedAt: now,
    updatedBy: actorUid,
    changeReason: reason,
  });
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: id, actionType: 'Module Uninstalled',
    description: `Module ${code} soft-uninstalled`,
    oldValue: row, reason, now,
  });
  return { success: true };
});

export const seedAdminModuleConfigurations = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertEditor(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = requiredReason(data.changeReason ?? `Seeded by ${actorName}`);
  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  for (const seed of SEED_MODULES) {
    const existing = await firestore.collection('module_configuration')
      .where('moduleCode', '==', seed.moduleCode).limit(1).get();
    if (!existing.empty && existing.docs[0].data().isDeleted !== true) {
      skipped += 1;
      continue;
    }
    const payload = parsePayload({
      ...seed,
      displayName: seed.moduleName,
      featureFlagsJson: '[]',
      configurationJson: '{}',
      licenseStatus: 'Licensed',
      featureStatus: 'GA',
      environment: 'Production',
      isEnabled: true,
      isInstalled: true,
      isVisible: true,
    }, actorUid, 'Active');
    const ref = firestore.collection('module_configuration').doc();
    const row = { ...payload, createdAt: now, updatedAt: now, createdBy: actorUid, changeReason: reason };
    await ref.set(row);
    await snapshotVersion(firestore, ref.id, row, actorUid, now);
    created += 1;
  }
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: 'seed', actionType: 'Configuration Changed',
    description: `Seeded modules (created ${created}, skipped ${skipped})`,
    newValue: { created, skipped }, reason, now,
  });
  return { success: true, created, skipped };
});

export const resolveAdminModuleConfiguration = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const moduleCode = optionalString(data.moduleCode, 'Module code', 40).toUpperCase();
  if (!moduleCode) throw new HttpsError('invalid-argument', 'Module code is required');
  const snap = await firestore.collection('module_configuration')
    .where('moduleCode', '==', moduleCode).limit(1).get();
  if (snap.empty || snap.docs[0].data().isDeleted === true) {
    throw new HttpsError('not-found', 'Module not found');
  }
  const row = snap.docs[0].data();
  return {
    success: true,
    id: snap.docs[0].id,
    moduleCode: row.moduleCode,
    isEnabled: row.isEnabled === true,
    isInstalled: row.isInstalled !== false,
    isVisible: row.isVisible !== false,
    licenseStatus: row.licenseStatus,
    featureFlags: row.featureFlags || [],
    dependencies: row.dependencies || [],
    navigationPath: row.navigationPath || row.route || '',
    configurationJson: row.configurationJson || '{}',
    environment: row.environment || 'Production',
  };
});

export const logAdminModuleConfigurationExport = onCall({ cors: true }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const now = new Date().toISOString();
  await writeModuleAudit(firestore, {
    actorUid, actorName, recordId: 'export', actionType: 'Export',
    description: `Exported ${Number(data.count || 0)} module configurations`,
    newValue: { format: data.format || 'CSV', count: data.count || 0 },
    reason: 'Module configuration export', now,
  });
  return { success: true };
});
