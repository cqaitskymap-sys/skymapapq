/**
 * Firebase Status — client service.
 * Privileged probes via Cloud Functions; history via CF + realtime snapshot.
 */
import {
  collection, limit, onSnapshot, orderBy, query, type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ADMIN_COLLECTIONS } from './constants';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import { shouldSkipRemoteCallablesInLocalDev } from '@/lib/audit-trail';
import { checkFirebaseConnection } from './admin-service';

export type HealthLevel = 'Healthy' | 'Warning' | 'Critical' | 'Unknown';

export interface FirebaseServiceCheck {
  id: string;
  name: string;
  category: string;
  status: HealthLevel;
  latencyMs: number;
  detail: string;
  metrics?: Record<string, string | number | boolean>;
}

export interface FirebaseHealthAlert {
  severity: HealthLevel;
  title: string;
  message: string;
}

export interface FirebaseHealthSnapshot {
  id?: string;
  checkId: string;
  overall: HealthLevel;
  checks: FirebaseServiceCheck[];
  alerts: FirebaseHealthAlert[];
  projectId: string;
  avgLatencyMs: number;
  checkedAt: string;
  checkedBy?: string;
  checkedByName?: string;
  source?: string;
  status?: string;
  createdAt?: string;
}

export const FIREBASE_STATUS_SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', href: '/admin/firebase-status' },
  { id: 'authentication', label: 'Authentication', href: '/admin/firebase-status/authentication' },
  { id: 'firestore', label: 'Firestore', href: '/admin/firebase-status/firestore' },
  { id: 'storage', label: 'Cloud Storage', href: '/admin/firebase-status/storage' },
  { id: 'functions', label: 'Cloud Functions', href: '/admin/firebase-status/functions' },
  { id: 'hosting', label: 'Hosting', href: '/admin/firebase-status/hosting' },
  { id: 'performance', label: 'Performance', href: '/admin/firebase-status/performance' },
  { id: 'security', label: 'Security Rules', href: '/admin/firebase-status/security' },
  { id: 'activity', label: 'Activity Logs', href: '/admin/firebase-status/activity' },
  { id: 'reports', label: 'Reports', href: '/admin/firebase-status/reports' },
  { id: 'audit', label: 'Audit Trail', href: '/admin/firebase-status/audit' },
] as const;

export type FirebaseStatusSectionId = (typeof FIREBASE_STATUS_SECTIONS)[number]['id'];

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

function normalizeLevel(value: unknown): HealthLevel {
  const v = String(value || '');
  if (v === 'Healthy' || v === 'Warning' || v === 'Critical' || v === 'Unknown') return v;
  if (v === 'Connected' || v === 'Success') return 'Healthy';
  if (v === 'Degraded') return 'Warning';
  if (v === 'Down' || v === 'Failed') return 'Critical';
  return 'Unknown';
}

export function statusColorClass(status: HealthLevel): string {
  if (status === 'Healthy') return 'text-emerald-700 border-emerald-200 bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/40';
  if (status === 'Warning') return 'text-amber-700 border-amber-200 bg-amber-50 dark:text-amber-300 dark:border-amber-800 dark:bg-amber-950/40';
  if (status === 'Critical') return 'text-red-700 border-red-200 bg-red-50 dark:text-red-300 dark:border-red-800 dark:bg-red-950/40';
  return 'text-slate-600 border-slate-200 bg-slate-50 dark:text-slate-300 dark:border-slate-700 dark:bg-slate-900';
}

export function statusDotClass(status: HealthLevel): string {
  if (status === 'Healthy') return 'bg-emerald-500';
  if (status === 'Warning') return 'bg-amber-500';
  if (status === 'Critical') return 'bg-red-500';
  return 'bg-slate-400';
}

export async function runFirebaseHealthCheck(options?: {
  persist?: boolean;
  changeReason?: string;
}): Promise<FirebaseHealthSnapshot> {
  if (!isFirebaseConfigured()) {
    throw new Error('Firebase is not configured');
  }
  try {
    if (shouldSkipRemoteCallablesInLocalDev()) {
      throw new Error('Cloud Functions skipped in local development');
    }
    const fn = httpsCallable(getFirebaseFunctions(), 'runAdminFirebaseHealthCheck');
    const result = await fn({
      persist: options?.persist !== false,
      changeReason: options?.changeReason || 'Manual Firebase health check from Admin Console',
    });
    const data = result.data as FirebaseHealthSnapshot;
    return {
      ...data,
      overall: normalizeLevel(data.overall),
      checks: (data.checks || []).map((c) => ({ ...c, status: normalizeLevel(c.status) })),
      alerts: data.alerts || [],
    };
  } catch (error) {
    // Client fallback when CF not deployed yet
    const base = await checkFirebaseConnection();
    const overall: HealthLevel = base.connected ? 'Warning' : 'Critical';
    const now = new Date().toISOString();
    return {
      checkId: `FBH-LOCAL-${Date.now().toString(36).toUpperCase()}`,
      overall,
      projectId: base.projectId,
      avgLatencyMs: base.latencyMs,
      checkedAt: now,
      source: 'client-fallback',
      checks: [
        {
          id: 'firestore',
          name: 'Cloud Firestore',
          category: 'Firestore',
          status: base.connected ? 'Healthy' : 'Critical',
          latencyMs: base.latencyMs,
          detail: base.connected ? `Client probe OK (${base.latencyMs}ms)` : (base.error || 'Unreachable'),
        },
        {
          id: 'functions',
          name: 'Cloud Functions',
          category: 'Functions',
          status: 'Warning',
          latencyMs: 0,
          detail: callableErrorMessage(error, 'Health Cloud Function unavailable — using client fallback'),
        },
      ],
      alerts: [
        {
          severity: 'Warning',
          title: 'Cloud Function health probe unavailable',
          message: callableErrorMessage(error, 'Deploy runAdminFirebaseHealthCheck for full Admin SDK probes'),
        },
      ],
    };
  }
}

export async function fetchFirebaseHealthHistory(): Promise<FirebaseHealthSnapshot[]> {
  if (!isFirebaseConfigured()) return [];
  if (shouldSkipRemoteCallablesInLocalDev()) return [];
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'fetchAdminFirebaseHealthHistory');
    const result = await fn({});
    const rows = ((result.data as { rows?: FirebaseHealthSnapshot[] })?.rows || []);
    return rows.map((r) => ({
      ...r,
      overall: normalizeLevel(r.overall),
      checks: (r.checks || []).map((c) => ({ ...c, status: normalizeLevel(c.status) })),
      alerts: r.alerts || [],
    }));
  } catch {
    return [];
  }
}

export function subscribeFirebaseHealthHistory(
  onData: (rows: FirebaseHealthSnapshot[]) => void,
  onError?: (message: string) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const q = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.systemHealthChecks),
    orderBy('checkedAt', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const data = d.data() as FirebaseHealthSnapshot;
        return {
          ...data,
          id: d.id,
          overall: normalizeLevel(data.overall),
          checks: (data.checks || []).map((c) => ({ ...c, status: normalizeLevel(c.status) })),
          alerts: data.alerts || [],
        };
      });
      onData(rows);
    },
    (err) => {
      onError?.(err.message);
      onData([]);
    },
  );
}

export async function logFirebaseStatusExport(description: string, changeReason?: string): Promise<void> {
  if (!isFirebaseConfigured() || shouldSkipRemoteCallablesInLocalDev()) return;
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminFirebaseStatusExport');
    await fn({ description, changeReason: changeReason || 'Report export' });
  } catch {
    // Non-blocking — export still proceeds locally
  }
}

export function filterChecksBySection(
  checks: FirebaseServiceCheck[],
  section: FirebaseStatusSectionId,
): FirebaseServiceCheck[] {
  if (section === 'dashboard' || section === 'reports' || section === 'activity' || section === 'audit') {
    return checks;
  }
  const map: Record<string, string[]> = {
    authentication: ['Authentication', 'auth', 'login'],
    firestore: ['Firestore', 'firestore'],
    storage: ['Storage', 'storage'],
    functions: ['Functions', 'functions', 'Scheduler', 'scheduler'],
    hosting: ['Hosting', 'hosting'],
    performance: ['Performance', 'Backup', 'backup'],
    security: ['Security', 'security', 'Compliance', 'audit'],
  };
  const keys = map[section] || [];
  return checks.filter((c) =>
    keys.some((k) =>
      c.category.toLowerCase().includes(k.toLowerCase())
      || c.id.toLowerCase().includes(k.toLowerCase())
      || c.name.toLowerCase().includes(k.toLowerCase()),
    ),
  );
}

export function getHealthSummary(snapshot: FirebaseHealthSnapshot | null, history: FirebaseHealthSnapshot[]) {
  const healthy = snapshot?.checks.filter((c) => c.status === 'Healthy').length || 0;
  const warning = snapshot?.checks.filter((c) => c.status === 'Warning').length || 0;
  const critical = snapshot?.checks.filter((c) => c.status === 'Critical').length || 0;
  const alertCount = snapshot?.alerts.length || 0;
  const uptimeApprox = history.length
    ? Math.round((history.filter((h) => h.overall === 'Healthy').length / history.length) * 100)
    : snapshot?.overall === 'Healthy' ? 100 : snapshot ? 0 : null;
  return {
    healthy,
    warning,
    critical,
    alertCount,
    avgLatencyMs: snapshot?.avgLatencyMs ?? 0,
    uptimeApprox,
    lastCheck: snapshot?.checkedAt || '',
    overall: snapshot?.overall || 'Unknown' as HealthLevel,
    projectId: snapshot?.projectId || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
  };
}

export function exportHealthCsv(snapshot: FirebaseHealthSnapshot | null, history: FirebaseHealthSnapshot[]): string {
  const lines = [
    'Report,Firebase Health',
    `Generated,${new Date().toISOString()}`,
    `Overall,${snapshot?.overall || '—'}`,
    `Avg Latency (ms),${snapshot?.avgLatencyMs ?? '—'}`,
    `Project,${snapshot?.projectId || '—'}`,
    '',
    'Service,Category,Status,LatencyMs,Detail',
  ];
  for (const c of snapshot?.checks || []) {
    lines.push([
      csvEscape(c.name),
      csvEscape(c.category),
      c.status,
      String(c.latencyMs),
      csvEscape(c.detail),
    ].join(','));
  }
  lines.push('', 'History CheckId,Overall,AvgLatencyMs,CheckedAt,Source');
  for (const h of history) {
    lines.push([
      csvEscape(h.checkId),
      h.overall,
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

export function openHealthPdfReport(snapshot: FirebaseHealthSnapshot | null, history: FirebaseHealthSnapshot[]) {
  const rows = (snapshot?.checks || []).map((c) => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td>${escapeHtml(c.category)}</td>
      <td><strong>${c.status}</strong></td>
      <td>${c.latencyMs} ms</td>
      <td>${escapeHtml(c.detail)}</td>
    </tr>`).join('');

  const historyRows = history.slice(0, 20).map((h) => `
    <tr>
      <td>${escapeHtml(h.checkId)}</td>
      <td>${h.overall}</td>
      <td>${h.avgLatencyMs ?? '—'} ms</td>
      <td>${escapeHtml(h.checkedAt)}</td>
      <td>${escapeHtml(h.source || '')}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><title>Firebase Health Report</title>
<style>
  body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#0f172a}
  h1{font-size:20px;margin:0 0 8px} h2{font-size:16px;margin:24px 0 8px}
  .meta{color:#64748b;font-size:12px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{border:1px solid #e2e8f0;padding:8px;text-align:left}
  th{background:#f8fafc}
  .Healthy{color:#047857}.Warning{color:#b45309}.Critical{color:#b91c1c}
  @media print{.no-print{display:none}}
</style></head><body>
  <button class="no-print" onclick="window.print()">Print / Save as PDF</button>
  <h1>SkyMap QMS — Firebase Health Report</h1>
  <div class="meta">
    Generated ${new Date().toLocaleString()} · Overall
    <span class="${snapshot?.overall || ''}">${snapshot?.overall || '—'}</span>
    · Project ${escapeHtml(snapshot?.projectId || '—')}
    · Avg latency ${snapshot?.avgLatencyMs ?? '—'} ms
  </div>
  <h2>Service Status</h2>
  <table><thead><tr><th>Service</th><th>Category</th><th>Status</th><th>Latency</th><th>Detail</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5">No checks</td></tr>'}</tbody></table>
  <h2>Alerts</h2>
  <ul>${(snapshot?.alerts || []).map((a) => `<li><strong>${a.severity}</strong> — ${escapeHtml(a.title)}: ${escapeHtml(a.message)}</li>`).join('') || '<li>None</li>'}</ul>
  <h2>Health Timeline (recent)</h2>
  <table><thead><tr><th>Check ID</th><th>Overall</th><th>Latency</th><th>Checked At</th><th>Source</th></tr></thead>
  <tbody>${historyRows || '<tr><td colspan="5">No history</td></tr>'}</tbody></table>
  <p class="meta">FDA 21 CFR Part 11 / EU GMP Annex 11 — infrastructure monitoring evidence. Export is recorded in audit trail when Cloud Functions are deployed.</p>
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
