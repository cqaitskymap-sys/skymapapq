/**
 * System Health Check — privileged Cloud Functions.
 * Enterprise application + infrastructure + module matrix probes.
 * Distinct from Firebase Status (infra-focused); integrates with same RBAC.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { type Firestore, type DocumentData } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminFirestore, getAdminStorage } from './admin-app';
import * as logger from 'firebase-functions/logger';


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

const VIEWER_ROLES = ['super_admin', 'admin', 'head_qa', 'auditor'];

type HealthLevel = 'Healthy' | 'Warning' | 'Degraded' | 'Critical' | 'Unknown';

interface HealthCheckItem {
  id: string;
  name: string;
  category: string;
  status: HealthLevel;
  latencyMs: number;
  detail: string;
  metrics?: Record<string, string | number | boolean>;
}

interface ModuleHealthItem {
  id: string;
  name: string;
  collection: string;
  category: string;
  status: HealthLevel;
  latencyMs: number;
  detail: string;
  href: string;
}

const MODULE_PROBES: Array<{ id: string; name: string; collection: string; category: string; href: string }> = [
  { id: 'users', name: 'User Management', collection: 'users', category: 'Admin', href: '/admin/users' },
  { id: 'roles', name: 'Role Management', collection: 'roles', category: 'Admin', href: '/admin/roles' },
  { id: 'departments', name: 'Department Master', collection: 'departments', category: 'Master Data', href: '/admin/departments' },
  { id: 'designations', name: 'Designation Master', collection: 'designations', category: 'Master Data', href: '/admin/designations' },
  { id: 'company_sites', name: 'Company / Site Master', collection: 'company_sites', category: 'Master Data', href: '/admin/company-site' },
  { id: 'products', name: 'Product Master', collection: 'products', category: 'Master Data', href: '/admin/products' },
  { id: 'batches', name: 'Batch Master', collection: 'batches', category: 'Master Data', href: '/admin/batches' },
  { id: 'parameters', name: 'Parameter Master', collection: 'parameters', category: 'Master Data', href: '/admin/parameters' },
  { id: 'workflows', name: 'Workflow Configuration', collection: 'workflows', category: 'Admin', href: '/admin/workflows' },
  { id: 'approval_matrix', name: 'Approval Matrix', collection: 'approval_matrix', category: 'Admin', href: '/admin/approval-matrix' },
  { id: 'document_numbering', name: 'Document Numbering', collection: 'document_numbering', category: 'Admin', href: '/admin/document-numbering' },
  { id: 'audit_trail', name: 'Audit Trail', collection: 'audit_trail', category: 'Compliance', href: '/admin/audit-trail' },
  { id: 'login_activity', name: 'Login Activity', collection: 'login_activity', category: 'Security', href: '/admin/login-activity' },
  { id: 'access_reviews', name: 'User Access Review', collection: 'access_reviews', category: 'Security', href: '/admin/user-access-review' },
  { id: 'esign_settings', name: 'E-Signature Settings', collection: 'esign_settings', category: 'Compliance', href: '/admin/esign-settings' },
  { id: 'notification_settings', name: 'Notification Settings', collection: 'notification_settings', category: 'Integrations', href: '/admin/notifications' },
  { id: 'email_sms_templates', name: 'Email & SMS Templates', collection: 'email_sms_templates', category: 'Integrations', href: '/admin/email-sms-templates' },
  { id: 'module_configuration', name: 'Module Configuration', collection: 'module_configuration', category: 'Admin', href: '/admin/module-configuration' },
  { id: 'master_data_ie', name: 'Master Data Import/Export', collection: 'master_data_import_export', category: 'Master Data', href: '/admin/master-data-import-export' },
  { id: 'backup_history', name: 'Backup', collection: 'backup_history', category: 'Disaster Recovery', href: '/admin/backup' },
  { id: 'restore_history', name: 'Backup & Restore History', collection: 'restore_history', category: 'Disaster Recovery', href: '/admin/backup/history' },
  { id: 'system_settings', name: 'System Settings', collection: 'system_settings', category: 'Admin', href: '/admin/system-settings' },
  { id: 'system_health_checks', name: 'Firebase Status', collection: 'system_health_checks', category: 'Infrastructure', href: '/admin/firebase-status' },
  { id: 'deviations', name: 'Deviation', collection: 'deviations', category: 'QMS', href: '/qms/deviation' },
  { id: 'capa', name: 'CAPA', collection: 'capa_records', category: 'QMS', href: '/qms/capa' },
  { id: 'change_control', name: 'Change Control', collection: 'change_controls', category: 'QMS', href: '/qms/change-control' },
  { id: 'oos', name: 'OOS', collection: 'oos_records', category: 'QMS', href: '/dashboard/oos' },
  { id: 'risk', name: 'Risk Management', collection: 'risk_assessments', category: 'QMS', href: '/qms/risk-management' },
  { id: 'audits', name: 'Audit Management', collection: 'audits', category: 'QMS', href: '/qms/audit' },
  { id: 'validation', name: 'Validation', collection: 'validations', category: 'QMS', href: '/qms/validation' },
  { id: 'equipment', name: 'Equipment Management', collection: 'equipment', category: 'QMS', href: '/qms/equipment' },
  { id: 'complaints', name: 'Complaint Management', collection: 'complaints', category: 'QMS', href: '/qms/complaints' },
  { id: 'documents', name: 'Document Management', collection: 'documents', category: 'QMS', href: '/qms/documents/sop' },
];

function assertViewer(actor: DocumentData | undefined, role: string) {
  if (!actor || actor.is_active !== true || !VIEWER_ROLES.includes(role)) {
    throw new HttpsError('permission-denied', 'System Health Check view access required');
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

async function writeSystemHealthAudit(
  firestore: Firestore,
  input: {
    actorUid: string;
    actorName: string;
    actionType: string;
    description: string;
    newValue?: unknown;
    reason?: string;
    now: string;
  },
) {
  const batch = firestore.batch();
  batch.set(firestore.collection('audit_trail').doc(), {
    auditId: `AUD-SHC-${Date.now().toString(36).toUpperCase()}`,
    dateTime: input.now,
    timestamp: input.now,
    moduleName: 'Admin',
    subModule: 'System Health Check',
    collectionName: 'system_health_scans',
    recordId: 'system-health',
    documentId: 'system-health',
    actionType: input.actionType,
    action: input.actionType,
    actionDescription: input.description,
    oldValue: null,
    newValue: input.newValue ?? null,
    reason: input.reason || '',
    performedBy: input.actorName,
    userId: input.actorUid,
    userName: input.actorName,
    createdAt: input.now,
    source: 'system-health-admin',
  });
  batch.set(firestore.collection('audit_logs').doc(), {
    module: 'System Health Check',
    action: input.actionType,
    recordId: 'system-health',
    description: input.description,
    performedBy: input.actorName,
    userId: input.actorUid,
    reason: input.reason || '',
    timestamp: input.now,
    createdAt: input.now,
  });
  await batch.commit();
}

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const result = await fn();
    return { result, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      result: null as T,
      latencyMs: Date.now() - start,
      error: (e as Error).message || 'Probe failed',
    };
  }
}

function scoreFor(status: HealthLevel): number {
  if (status === 'Healthy') return 100;
  if (status === 'Warning') return 70;
  if (status === 'Degraded') return 45;
  if (status === 'Critical') return 0;
  return 50;
}

function rollup(statuses: HealthLevel[]): HealthLevel {
  if (statuses.some((s) => s === 'Critical')) return 'Critical';
  if (statuses.some((s) => s === 'Degraded')) return 'Degraded';
  if (statuses.some((s) => s === 'Warning')) return 'Warning';
  if (statuses.every((s) => s === 'Healthy')) return 'Healthy';
  return 'Unknown';
}

async function probeCollection(
  firestore: Firestore,
  collectionName: string,
): Promise<{ ok: boolean; size: number; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    const snap = await firestore.collection(collectionName).limit(1).get();
    return { ok: true, size: snap.size, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, size: 0, latencyMs: Date.now() - start, error: (e as Error).message };
  }
}

async function runSystemHealthScan(firestore: Firestore): Promise<{
  overall: HealthLevel;
  healthScore: number;
  checks: HealthCheckItem[];
  modules: ModuleHealthItem[];
  alerts: Array<{ severity: HealthLevel; title: string; message: string; category: string }>;
  projectId: string;
  avgLatencyMs: number;
  categories: Record<string, HealthLevel>;
}> {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
  const checks: HealthCheckItem[] = [];

  // --- Infrastructure ---
  {
    const authProbe = await timed(() => getAdminAuth().listUsers(1));
    checks.push({
      id: 'infra_auth',
      name: 'Firebase Authentication',
      category: 'Infrastructure',
      status: authProbe.error ? 'Critical' : 'Healthy',
      latencyMs: authProbe.latencyMs,
      detail: authProbe.error || `Auth Admin SDK OK (${authProbe.result?.users.length ?? 0} sample)`,
      metrics: { sampleUsers: authProbe.result?.users.length ?? 0 },
    });
  }

  {
    const fs = await probeCollection(firestore, 'profiles');
    checks.push({
      id: 'infra_firestore',
      name: 'Cloud Firestore',
      category: 'Infrastructure',
      status: fs.ok ? (fs.latencyMs > 2000 ? 'Warning' : 'Healthy') : 'Critical',
      latencyMs: fs.latencyMs,
      detail: fs.ok ? `Firestore reachable (${fs.latencyMs}ms)` : (fs.error || 'Unreachable'),
    });
  }

  {
    const start = Date.now();
    try {
      const bucket = getAdminStorage().bucket();
      const [exists] = await bucket.exists();
      const latencyMs = Date.now() - start;
      checks.push({
        id: 'infra_storage',
        name: 'Cloud Storage',
        category: 'Infrastructure',
        status: exists ? 'Healthy' : 'Degraded',
        latencyMs,
        detail: exists ? `Bucket ${bucket.name} reachable` : `Bucket ${bucket.name} missing`,
        metrics: { bucket: bucket.name },
      });
    } catch (e) {
      checks.push({
        id: 'infra_storage',
        name: 'Cloud Storage',
        category: 'Infrastructure',
        status: 'Critical',
        latencyMs: Date.now() - start,
        detail: (e as Error).message,
      });
    }
  }

  checks.push({
    id: 'infra_functions',
    name: 'Cloud Functions',
    category: 'Infrastructure',
    status: 'Healthy',
    latencyMs: 0,
    detail: 'System health callable executing (self-ping OK)',
    metrics: { selfPing: true },
  });

  {
    const settings = await timed(() => firestore.collection('backup_settings').limit(1).get());
    const auto = settings.result?.docs[0]?.data()?.autoBackupEnabled === true;
    checks.push({
      id: 'infra_scheduler',
      name: 'Cloud Scheduler',
      category: 'Background Services',
      status: settings.error ? 'Warning' : auto ? 'Healthy' : 'Warning',
      latencyMs: settings.latencyMs,
      detail: settings.error
        || (auto ? 'Scheduled backup enabled' : 'Auto backup disabled — scheduler idle for backups'),
      metrics: { autoBackupEnabled: auto },
    });
  }

  checks.push({
    id: 'infra_hosting',
    name: 'Hosting / App Runtime',
    category: 'Infrastructure',
    status: projectId ? 'Healthy' : 'Warning',
    latencyMs: 0,
    detail: projectId
      ? `Project ${projectId} — app hosting assumed via Firebase / Vercel`
      : 'Project ID unavailable in Functions runtime',
    metrics: { projectId: projectId || '—' },
  });

  // --- Security ---
  {
    const login = await timed(() => firestore.collection('login_activity').limit(50).get());
    const failed = login.result?.docs.filter((d) => String(d.data().loginStatus || '') === 'Failed').length ?? 0;
    let status: HealthLevel = 'Healthy';
    if (login.error) status = 'Warning';
    else if (failed >= 20) status = 'Critical';
    else if (failed >= 8) status = 'Degraded';
    else if (failed >= 3) status = 'Warning';
    checks.push({
      id: 'sec_logins',
      name: 'Authentication Failures',
      category: 'Security',
      status,
      latencyMs: login.latencyMs,
      detail: login.error || `Sampled ${login.result?.size ?? 0} logins — ${failed} failed`,
      metrics: { sampleSize: login.result?.size ?? 0, failedInSample: failed },
    });
  }

  {
    const audit = await probeCollection(firestore, 'audit_trail');
    checks.push({
      id: 'sec_audit',
      name: 'Audit Trail Integrity',
      category: 'Security',
      status: audit.ok ? (audit.size === 0 ? 'Warning' : 'Healthy') : 'Critical',
      latencyMs: audit.latencyMs,
      detail: audit.ok
        ? (audit.size === 0 ? 'Audit trail empty in sample' : 'Audit trail readable')
        : (audit.error || 'Audit trail unreachable'),
    });
  }

  {
    const esign = await probeCollection(firestore, 'esign_settings');
    checks.push({
      id: 'sec_esign',
      name: 'E-Signature Configuration',
      category: 'Security',
      status: esign.ok ? (esign.size === 0 ? 'Warning' : 'Healthy') : 'Degraded',
      latencyMs: esign.latencyMs,
      detail: esign.ok
        ? (esign.size === 0 ? 'No e-sign settings document sampled' : 'E-sign settings reachable')
        : (esign.error || 'E-sign settings unreachable'),
    });
  }

  // --- Application / API ---
  {
    const settings = await probeCollection(firestore, 'system_settings');
    checks.push({
      id: 'app_settings',
      name: 'Application Configuration',
      category: 'Application',
      status: settings.ok ? (settings.size === 0 ? 'Degraded' : 'Healthy') : 'Critical',
      latencyMs: settings.latencyMs,
      detail: settings.ok
        ? (settings.size === 0 ? 'No system settings found' : 'System settings loaded')
        : (settings.error || 'Cannot read settings'),
    });
  }

  {
    const wf = await probeCollection(firestore, 'workflows');
    checks.push({
      id: 'app_workflows',
      name: 'Workflow Engine',
      category: 'Background Services',
      status: wf.ok ? (wf.size === 0 ? 'Warning' : 'Healthy') : 'Degraded',
      latencyMs: wf.latencyMs,
      detail: wf.ok
        ? (wf.size === 0 ? 'No workflows configured' : 'Workflow collection reachable')
        : (wf.error || 'Workflow engine unreachable'),
    });
  }

  {
    const notif = await probeCollection(firestore, 'notification_settings');
    checks.push({
      id: 'app_notifications',
      name: 'Notification Engine',
      category: 'Integrations',
      status: notif.ok ? (notif.size === 0 ? 'Warning' : 'Healthy') : 'Degraded',
      latencyMs: notif.latencyMs,
      detail: notif.ok
        ? (notif.size === 0 ? 'No notification settings' : 'Notification settings reachable')
        : (notif.error || 'Notification engine unreachable'),
    });
  }

  {
    const templates = await probeCollection(firestore, 'email_sms_templates');
    checks.push({
      id: 'app_email_sms',
      name: 'Email / SMS Templates',
      category: 'Integrations',
      status: templates.ok ? (templates.size === 0 ? 'Warning' : 'Healthy') : 'Degraded',
      latencyMs: templates.latencyMs,
      detail: templates.ok
        ? (templates.size === 0 ? 'No templates found' : 'Template store reachable')
        : (templates.error || 'Template store unreachable'),
    });
  }

  // --- Disaster Recovery ---
  {
    const backup = await timed(async () => {
      try {
        return await firestore.collection('backup_history').orderBy('backupDateTime', 'desc').limit(1).get();
      } catch {
        return firestore.collection('backup_history').limit(5).get();
      }
    });
    const last = backup.result?.docs[0]?.data();
    const lastDate = String(last?.backupDateTime || '');
    const ageDays = lastDate
      ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000)
      : null;
    let status: HealthLevel = 'Healthy';
    if (backup.error || ageDays === null) status = 'Degraded';
    else if (ageDays > 14) status = 'Critical';
    else if (ageDays > 7) status = 'Warning';
    checks.push({
      id: 'dr_backup',
      name: 'Backup Health',
      category: 'Disaster Recovery',
      status,
      latencyMs: backup.latencyMs,
      detail: ageDays === null
        ? 'No backup history found'
        : `Last backup ${ageDays} day(s) ago (${last?.backupStatus || '—'})`,
      metrics: {
        lastBackupAgeDays: ageDays ?? -1,
        lastBackupStatus: String(last?.backupStatus || '—'),
        encryptionStatus: String(last?.encryptionStatus || '—'),
      },
    });
  }

  {
    const restore = await probeCollection(firestore, 'restore_history');
    checks.push({
      id: 'dr_restore',
      name: 'Restore Readiness',
      category: 'Disaster Recovery',
      status: restore.ok ? 'Healthy' : 'Warning',
      latencyMs: restore.latencyMs,
      detail: restore.ok
        ? 'Restore history collection reachable'
        : (restore.error || 'Restore history unreachable'),
    });
  }

  // --- Module matrix (batched) ---
  const modules: ModuleHealthItem[] = [];
  const batchSize = 8;
  for (let i = 0; i < MODULE_PROBES.length; i += batchSize) {
    const chunk = MODULE_PROBES.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map(async (m) => {
      const probe = await probeCollection(firestore, m.collection);
      let status: HealthLevel = 'Healthy';
      if (!probe.ok) status = 'Critical';
      else if (probe.latencyMs > 2500) status = 'Warning';
      else if (probe.size === 0 && ['deviations', 'capa', 'change_control', 'oos', 'risk', 'audits', 'validation', 'equipment', 'complaints', 'documents'].includes(m.id)) {
        status = 'Healthy'; // empty QMS OK
      }
      return {
        id: m.id,
        name: m.name,
        collection: m.collection,
        category: m.category,
        status,
        latencyMs: probe.latencyMs,
        detail: probe.ok
          ? `Collection reachable (${probe.latencyMs}ms, sample=${probe.size})`
          : (probe.error || 'Unreachable'),
        href: m.href,
      } satisfies ModuleHealthItem;
    }));
    modules.push(...results);
  }

  const allStatuses = [
    ...checks.map((c) => c.status),
    ...modules.map((m) => m.status),
  ];
  const overall = rollup(allStatuses);
  const healthScore = Math.round(
    allStatuses.reduce((sum, s) => sum + scoreFor(s), 0) / Math.max(allStatuses.length, 1),
  );
  const avgLatencyMs = Math.round(
    [...checks, ...modules].reduce((s, c) => s + c.latencyMs, 0) / Math.max(checks.length + modules.length, 1),
  );

  const categoryMap = new Map<string, HealthLevel[]>();
  for (const c of checks) {
    const list = categoryMap.get(c.category) || [];
    list.push(c.status);
    categoryMap.set(c.category, list);
  }
  for (const m of modules) {
    const list = categoryMap.get(m.category) || [];
    list.push(m.status);
    categoryMap.set(m.category, list);
  }
  const categories: Record<string, HealthLevel> = {};
  for (const [key, vals] of categoryMap.entries()) {
    categories[key] = rollup(vals);
  }

  const alerts = [
    ...checks.filter((c) => c.status === 'Critical' || c.status === 'Degraded' || c.status === 'Warning')
      .map((c) => ({
        severity: c.status,
        title: `${c.name}: ${c.status}`,
        message: c.detail,
        category: c.category,
      })),
    ...modules.filter((m) => m.status === 'Critical' || m.status === 'Degraded')
      .map((m) => ({
        severity: m.status,
        title: `Module ${m.name}: ${m.status}`,
        message: m.detail,
        category: m.category,
      })),
  ];

  return { overall, healthScore, checks, modules, alerts, projectId, avgLatencyMs, categories };
}

export const runAdminSystemHealthCheck = onCall({ timeoutSeconds: 180, memory: '1GiB' }, async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const reason = typeof data.changeReason === 'string' && data.changeReason.trim().length >= 5
    ? data.changeReason.trim()
    : 'System health check executed';
  const persist = data.persist !== false;
  const now = new Date().toISOString();

  const result = await runSystemHealthScan(firestore);
  const payload = {
    scanId: `SHC-${Date.now().toString(36).toUpperCase()}`,
    kind: 'system',
    overall: result.overall,
    healthScore: result.healthScore,
    checks: result.checks,
    modules: result.modules,
    alerts: result.alerts,
    categories: result.categories,
    projectId: result.projectId,
    avgLatencyMs: result.avgLatencyMs,
    checkedAt: now,
    checkedBy: actorUid,
    checkedByName: actorName,
    source: 'runAdminSystemHealthCheck',
    status: 'Active',
    createdAt: now,
  };

  if (persist) {
    await firestore.collection('system_health_scans').doc().set(payload);
  }

  await writeSystemHealthAudit(firestore, {
    actorUid,
    actorName,
    actionType: result.overall === 'Healthy' ? 'Health Check Executed' : 'Health Status Changed',
    description: `System health ${result.overall} (score ${result.healthScore}%, ${result.checks.length} checks, ${result.modules.length} modules)`,
    newValue: {
      overall: result.overall,
      healthScore: result.healthScore,
      alertCount: result.alerts.length,
      avgLatencyMs: result.avgLatencyMs,
    },
    reason,
    now,
  });

  return payload;
});

export const fetchAdminSystemHealthHistory = onCall(async (request) => {
  const { firestore, actor, actorRole } = await resolveActor(request);
  assertViewer(actor, actorRole);
  try {
    const snap = await firestore.collection('system_health_scans')
      .orderBy('checkedAt', 'desc')
      .limit(50)
      .get();
    return { rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })) };
  } catch {
    const snap = await firestore.collection('system_health_scans').limit(50).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String((b as { checkedAt?: string }).checkedAt || '')
        .localeCompare(String((a as { checkedAt?: string }).checkedAt || '')));
    return { rows };
  }
});

export const acknowledgeAdminSystemHealthAlert = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  const alertTitle = requiredString(data.alertTitle || 'Alert', 'Alert title', 300);
  const reason = requiredString(data.changeReason || 'Alert acknowledged', 'Change reason', 500);
  const now = new Date().toISOString();
  await writeSystemHealthAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'Alert Acknowledged',
    description: `Acknowledged system health alert: ${alertTitle}`,
    newValue: { alertTitle },
    reason,
    now,
  });
  return { success: true, acknowledgedAt: now };
});

export const logAdminSystemHealthExport = onCall(async (request) => {
  const { firestore, actor, actorRole, actorName, actorUid } = await resolveActor(request);
  assertViewer(actor, actorRole);
  const data = (request.data || {}) as Record<string, unknown>;
  await writeSystemHealthAudit(firestore, {
    actorUid,
    actorName,
    actionType: 'System Health Report Exported',
    description: requiredString(data.description || 'Health report export', 'Description', 500),
    reason: typeof data.changeReason === 'string' ? data.changeReason : 'Report export',
    now: new Date().toISOString(),
  });
  return { success: true };
});

export const scheduledSystemHealthCheck = onSchedule(
  {
    schedule: 'every 4 hours',
    timeZone: 'Asia/Kolkata',
    timeoutSeconds: 180,
    memory: '1GiB',
  },
  async () => {
        const firestore = getAdminFirestore();
    try {
      const result = await runSystemHealthScan(firestore);
      const now = new Date().toISOString();
      await firestore.collection('system_health_scans').doc().set({
        scanId: `SHC-SCH-${Date.now().toString(36).toUpperCase()}`,
        kind: 'system',
        overall: result.overall,
        healthScore: result.healthScore,
        checks: result.checks,
        modules: result.modules,
        alerts: result.alerts,
        categories: result.categories,
        projectId: result.projectId,
        avgLatencyMs: result.avgLatencyMs,
        checkedAt: now,
        checkedBy: 'system-scheduler',
        checkedByName: 'Cloud Scheduler',
        source: 'scheduledSystemHealthCheck',
        status: 'Active',
        createdAt: now,
      });
      if (result.overall !== 'Healthy') {
        await writeSystemHealthAudit(firestore, {
          actorUid: 'system-scheduler',
          actorName: 'Cloud Scheduler',
          actionType: 'Alert Generated',
          description: `Scheduled system health ${result.overall} — score ${result.healthScore}% — ${result.alerts.length} alert(s)`,
          newValue: { overall: result.overall, healthScore: result.healthScore, alerts: result.alerts.slice(0, 15) },
          reason: 'Automated system health probe',
          now,
        });
      }
      logger.info('Scheduled system health completed', { overall: result.overall, score: result.healthScore });
    } catch (e) {
      logger.error('Scheduled system health failed', e);
    }
  },
);
