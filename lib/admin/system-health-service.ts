/**
 * System Health Check — client service.
 * Privileged scans via Cloud Functions; history via CF + realtime snapshot.
 */
import {
  collection, limit, onSnapshot, orderBy, query, type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ADMIN_COLLECTIONS } from './constants';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { shouldSkipRemoteCallablesInLocalDev } from '@/lib/audit-trail';
import { getExtendedSystemHealth } from './admin-dashboard-service';

export type SystemHealthLevel = 'Healthy' | 'Warning' | 'Degraded' | 'Critical' | 'Unknown';

export interface SystemHealthCheckItem {
  id: string;
  name: string;
  category: string;
  status: SystemHealthLevel;
  latencyMs: number;
  detail: string;
  metrics?: Record<string, string | number | boolean>;
}

export interface SystemModuleHealthItem {
  id: string;
  name: string;
  collection: string;
  category: string;
  status: SystemHealthLevel;
  latencyMs: number;
  detail: string;
  href: string;
}

export interface SystemHealthAlert {
  severity: SystemHealthLevel;
  title: string;
  message: string;
  category: string;
}

export interface SystemHealthSnapshot {
  id?: string;
  scanId: string;
  kind?: string;
  overall: SystemHealthLevel;
  healthScore: number;
  checks: SystemHealthCheckItem[];
  modules: SystemModuleHealthItem[];
  alerts: SystemHealthAlert[];
  categories?: Record<string, SystemHealthLevel>;
  projectId: string;
  avgLatencyMs: number;
  checkedAt: string;
  checkedBy?: string;
  checkedByName?: string;
  source?: string;
  status?: string;
  createdAt?: string;
}

export const SYSTEM_HEALTH_SECTIONS = [
  { id: 'dashboard', label: 'Overall Dashboard', href: '/admin/system-health' },
  { id: 'infrastructure', label: 'Infrastructure', href: '/admin/system-health/infrastructure' },
  { id: 'application', label: 'Application', href: '/admin/system-health/application' },
  { id: 'firebase', label: 'Firebase Health', href: '/admin/system-health/firebase' },
  { id: 'api', label: 'API Health', href: '/admin/system-health/api' },
  { id: 'database', label: 'Database', href: '/admin/system-health/database' },
  { id: 'security', label: 'Security', href: '/admin/system-health/security' },
  { id: 'background', label: 'Background Services', href: '/admin/system-health/background' },
  { id: 'integrations', label: 'Integrations', href: '/admin/system-health/integrations' },
  { id: 'alerts', label: 'Alerts', href: '/admin/system-health/alerts' },
  { id: 'reports', label: 'Reports', href: '/admin/system-health/reports' },
  { id: 'audit', label: 'Audit Trail', href: '/admin/system-health/audit' },
] as const;

export type SystemHealthSectionId = (typeof SYSTEM_HEALTH_SECTIONS)[number]['id'];

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function normalizeSystemHealthLevel(value: unknown): SystemHealthLevel {
  const v = String(value || '');
  if (v === 'Healthy' || v === 'Warning' || v === 'Degraded' || v === 'Critical' || v === 'Unknown') return v;
  if (v === 'Connected' || v === 'Success') return 'Healthy';
  if (v === 'Down' || v === 'Failed') return 'Critical';
  return 'Unknown';
}

export function systemHealthColorClass(status: SystemHealthLevel): string {
  if (status === 'Healthy') return 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/40';
  if (status === 'Warning') return 'text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-300 dark:border-amber-800 dark:bg-amber-950/40';
  if (status === 'Degraded') return 'text-orange-700 border-orange-200 bg-orange-50 dark:text-orange-300 dark:border-orange-800 dark:bg-orange-950/40';
  if (status === 'Critical') return 'text-red-700 border-red-200 bg-red-50 dark:text-red-300 dark:border-red-800 dark:bg-red-950/40';
  return 'text-slate-600 border-slate-200 bg-slate-50 dark:text-slate-300 dark:border-slate-700 dark:bg-slate-900';
}

export function systemHealthDotClass(status: SystemHealthLevel): string {
  if (status === 'Healthy') return 'bg-emerald-500';
  if (status === 'Warning') return 'bg-amber-500';
  if (status === 'Degraded') return 'bg-orange-500';
  if (status === 'Critical') return 'bg-red-500';
  return 'bg-slate-400';
}

export function systemHealthBorderClass(status: SystemHealthLevel): string {
  if (status === 'Healthy') return 'border-l-emerald-500';
  if (status === 'Warning') return 'border-l-amber-500';
  if (status === 'Degraded') return 'border-l-orange-500';
  if (status === 'Critical') return 'border-l-red-500';
  return 'border-l-slate-400';
}

function normalizeSnapshot(data: SystemHealthSnapshot): SystemHealthSnapshot {
  return {
    ...data,
    overall: normalizeSystemHealthLevel(data.overall),
    healthScore: Number(data.healthScore ?? 0),
    checks: (data.checks || []).map((c) => ({ ...c, status: normalizeSystemHealthLevel(c.status) })),
    modules: (data.modules || []).map((m) => ({ ...m, status: normalizeSystemHealthLevel(m.status) })),
    alerts: (data.alerts || []).map((a) => ({
      ...a,
      severity: normalizeSystemHealthLevel(a.severity),
      category: a.category || 'General',
    })),
  };
}

export async function runSystemHealthCheck(options?: {
  persist?: boolean;
  changeReason?: string;
}): Promise<SystemHealthSnapshot> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured');
  }
  try {
    if (shouldSkipRemoteCallablesInLocalDev()) {
      throw new Error('Cloud Functions skipped in local development');
    }
    const fn = httpsCallable(getFirebaseFunctions(), 'runAdminSystemHealthCheck');
    const result = await fn({
      persist: options?.persist !== false,
      changeReason: options?.changeReason || 'Manual system health check from Admin Console',
    });
    return normalizeSnapshot(result.data as SystemHealthSnapshot);
  } catch (error) {
    const fallback = await getExtendedSystemHealth();
    const now = new Date().toISOString();
    const mapStatus = (s: string): SystemHealthLevel => {
      if (s === 'Healthy') return 'Healthy';
      if (s === 'Degraded') return 'Degraded';
      if (s === 'Down') return 'Critical';
      return 'Warning';
    };
    return {
      scanId: `SHC-LOCAL-${Date.now().toString(36).toUpperCase()}`,
      kind: 'system',
      overall: mapStatus(fallback.overall),
      healthScore: fallback.score,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
      avgLatencyMs: 0,
      checkedAt: now,
      source: 'client-fallback',
      checks: fallback.checks.map((c, i) => ({
        id: `local_${i}`,
        name: c.name,
        category: 'Application',
        status: mapStatus(c.status),
        latencyMs: 0,
        detail: c.detail,
      })),
      modules: [],
      alerts: [
        {
          severity: 'Warning',
          title: 'Cloud Function system health unavailable',
          message: callableErrorMessage(error, 'Deploy runAdminSystemHealthCheck for full enterprise scan'),
          category: 'Infrastructure',
        },
      ],
      categories: { Application: mapStatus(fallback.overall) },
    };
  }
}

export async function fetchSystemHealthHistory(): Promise<SystemHealthSnapshot[]> {
  if (!isFirebaseConfigured()) return [];
  if (shouldSkipRemoteCallablesInLocalDev()) return [];
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'fetchAdminSystemHealthHistory');
    const result = await fn({});
    const rows = ((result.data as { rows?: SystemHealthSnapshot[] })?.rows || []);
    return rows.map(normalizeSnapshot);
  } catch {
    return [];
  }
}

export function subscribeSystemHealthHistory(
  onData: (rows: SystemHealthSnapshot[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const q = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.systemHealthScans),
    orderBy('checkedAt', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => normalizeSnapshot({ id: d.id, ...(d.data() as SystemHealthSnapshot) })));
    },
    (err) => {
      onError?.(err.message);
      onData([]);
    },
  );
}

export async function acknowledgeSystemHealthAlert(alertTitle: string, changeReason?: string): Promise<void> {
  if (!isFirebaseConfigured() || shouldSkipRemoteCallablesInLocalDev()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'acknowledgeAdminSystemHealthAlert');
    await fn({ alertTitle, changeReason: changeReason || 'Alert acknowledged by administrator' });
  } catch {
    // non-blocking
  }
}

export async function logSystemHealthExport(description: string, changeReason?: string): Promise<void> {
  if (!isFirebaseConfigured() || shouldSkipRemoteCallablesInLocalDev()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminSystemHealthExport');
    await fn({ description, changeReason: changeReason || 'Report export' });
  } catch {
    // non-blocking
  }
}

export function filterChecksForSection(
  checks: SystemHealthCheckItem[],
  section: SystemHealthSectionId,
): SystemHealthCheckItem[] {
  if (section === 'dashboard' || section === 'alerts' || section === 'reports' || section === 'audit') {
    return checks;
  }
  const map: Record<string, string[]> = {
    infrastructure: ['Infrastructure'],
    application: ['Application'],
    firebase: ['Infrastructure'],
    api: ['Application', 'Integrations'],
    database: ['Infrastructure', 'Disaster Recovery'],
    security: ['Security'],
    background: ['Background Services'],
    integrations: ['Integrations'],
  };
  const cats = map[section] || [];
  return checks.filter((c) => cats.includes(c.category));
}

export function getSystemHealthSummary(snapshot: SystemHealthSnapshot | null, history: SystemHealthSnapshot[]) {
  const healthy = (snapshot?.checks.filter((c) => c.status === 'Healthy').length || 0)
    + (snapshot?.modules.filter((m) => m.status === 'Healthy').length || 0);
  const warning = (snapshot?.checks.filter((c) => c.status === 'Warning').length || 0)
    + (snapshot?.modules.filter((m) => m.status === 'Warning').length || 0);
  const degraded = (snapshot?.checks.filter((c) => c.status === 'Degraded').length || 0)
    + (snapshot?.modules.filter((m) => m.status === 'Degraded').length || 0);
  const critical = (snapshot?.checks.filter((c) => c.status === 'Critical').length || 0)
    + (snapshot?.modules.filter((m) => m.status === 'Critical').length || 0);
  const uptimeApprox = history.length
    ? Math.round((history.filter((h) => h.overall === 'Healthy').length / history.length) * 100)
    : snapshot?.overall === 'Healthy' ? 100 : snapshot ? 0 : null;
  return {
    overall: snapshot?.overall || 'Unknown' as SystemHealthLevel,
    healthScore: snapshot?.healthScore ?? 0,
    healthy,
    warning,
    degraded,
    critical,
    alertCount: snapshot?.alerts.length || 0,
    avgLatencyMs: snapshot?.avgLatencyMs ?? 0,
    uptimeApprox,
    lastCheck: snapshot?.checkedAt || '',
    projectId: snapshot?.projectId || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    moduleCount: snapshot?.modules.length || 0,
  };
}

export function exportSystemHealthCsv(snapshot: SystemHealthSnapshot | null, history: SystemHealthSnapshot[]): string {
  const lines = [
    'Report,System Health Check',
    `Generated,${new Date().toISOString()}`,
    `Overall,${snapshot?.overall || '—'}`,
    `Health Score,${snapshot?.healthScore ?? '—'}`,
    `Avg Latency (ms),${snapshot?.avgLatencyMs ?? '—'}`,
    `Project,${snapshot?.projectId || '—'}`,
    '',
    'Type,Name,Category,Status,LatencyMs,Detail',
  ];
  for (const c of snapshot?.checks || []) {
    lines.push(['Check', csvEscape(c.name), csvEscape(c.category), c.status, String(c.latencyMs), csvEscape(c.detail)].join(','));
  }
  for (const m of snapshot?.modules || []) {
    lines.push(['Module', csvEscape(m.name), csvEscape(m.category), m.status, String(m.latencyMs), csvEscape(m.detail)].join(','));
  }
  lines.push('', 'History ScanId,Overall,Score,AvgLatencyMs,CheckedAt,Source');
  for (const h of history) {
    lines.push([
      csvEscape(h.scanId),
      h.overall,
      String(h.healthScore ?? ''),
      String(h.avgLatencyMs ?? ''),
      csvEscape(h.checkedAt),
      csvEscape(h.source || ''),
    ].join(','));
  }
  return lines.join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function openSystemHealthPdfReport(snapshot: SystemHealthSnapshot | null, history: SystemHealthSnapshot[]) {
  const checkRows = (snapshot?.checks || []).map((c) => `
    <tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.category)}</td>
    <td class="${c.status}"><strong>${c.status}</strong></td><td>${c.latencyMs} ms</td>
    <td>${escapeHtml(c.detail)}</td></tr>`).join('');
  const moduleRows = (snapshot?.modules || []).map((m) => `
    <tr><td>${escapeHtml(m.name)}</td><td>${escapeHtml(m.category)}</td>
    <td class="${m.status}"><strong>${m.status}</strong></td><td>${m.latencyMs} ms</td>
    <td>${escapeHtml(m.detail)}</td></tr>`).join('');
  const historyRows = history.slice(0, 20).map((h) => `
    <tr><td>${escapeHtml(h.scanId)}</td><td>${h.overall}</td><td>${h.healthScore}%</td>
    <td>${h.avgLatencyMs ?? '—'} ms</td><td>${escapeHtml(h.checkedAt)}</td></tr>`).join('');

  const html = `<!DOCTYPE html><html><head><title>System Health Report</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#0f172a}
  h1{font-size:20px;margin:0 0 8px} h2{font-size:16px;margin:24px 0 8px}
  .meta{color:#64748b;font-size:12px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}
  th{background:#f8fafc}
  .Healthy{color:#047857}.Warning{color:#b45309}.Degraded{color:#c2410c}.Critical{color:#b91c1c}
  @media print{.no-print{display:none}}
</style></head><body>
  <button class="no-print" onclick="window.print()">Print / Save as PDF</button>
  <h1>SkyMap QMS — System Health Report</h1>
  <div class="meta">Generated ${new Date().toLocaleString()} · Overall
    <span class="${snapshot?.overall || ''}">${snapshot?.overall || '—'}</span>
    · Score ${snapshot?.healthScore ?? '—'}% · Project ${escapeHtml(snapshot?.projectId || '—')}
  </div>
  <h2>Service Checks</h2>
  <table><thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Latency</th><th>Detail</th></tr></thead>
  <tbody>${checkRows || '<tr><td colspan="5">No checks</td></tr>'}</tbody></table>
  <h2>Module Health Matrix</h2>
  <table><thead><tr><th>Module</th><th>Category</th><th>Status</th><th>Latency</th><th>Detail</th></tr></thead>
  <tbody>${moduleRows || '<tr><td colspan="5">No modules</td></tr>'}</tbody></table>
  <h2>Alerts</h2>
  <ul>${(snapshot?.alerts || []).map((a) => `<li><strong>${a.severity}</strong> — ${escapeHtml(a.title)}: ${escapeHtml(a.message)}</li>`).join('') || '<li>None</li>'}</ul>
  <h2>Health Timeline</h2>
  <table><thead><tr><th>Scan ID</th><th>Overall</th><th>Score</th><th>Latency</th><th>Checked At</th></tr></thead>
  <tbody>${historyRows || '<tr><td colspan="5">No history</td></tr>'}</tbody></table>
  <p class="meta">FDA 21 CFR Part 11 / EU GMP Annex 11 — continuous system monitoring evidence. Export audited when Cloud Functions are deployed.</p>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
