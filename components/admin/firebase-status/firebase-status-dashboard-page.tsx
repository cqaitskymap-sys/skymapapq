'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, Cloud, Database, Download, HardDrive,
  Lock, Printer, RefreshCw, Server, Shield, Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { FirebaseStatusSubnav } from './firebase-status-subnav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ADMIN_COLLECTIONS } from '@/lib/admin/constants';
import {
  exportHealthCsv,
  filterChecksBySection,
  getHealthSummary,
  logFirebaseStatusExport,
  openHealthPdfReport,
  runFirebaseHealthCheck,
  statusColorClass,
  statusDotClass,
  subscribeFirebaseHealthHistory,
  type FirebaseHealthSnapshot,
  type FirebaseStatusSectionId,
  type HealthLevel,
} from '@/lib/admin/firebase-status-service';
import { isFirebaseConfigured, getFirebaseSetupMessage } from '@/lib/firebase';

const AUTO_REFRESH_MS = 60_000;

const SECTION_ICONS: Record<string, React.ElementType> = {
  auth: Lock,
  firestore: Database,
  storage: HardDrive,
  functions: Zap,
  scheduler: Server,
  backup: Database,
  audit: Shield,
  login: Lock,
  hosting: Cloud,
  security_rules: Shield,
};

function StatusBadge({ status }: { status: HealthLevel }) {
  return (
    <Badge variant="outline" className={statusColorClass(status)}>
      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${statusDotClass(status)}`} />
      {status}
    </Badge>
  );
}

function ServiceCard({
  check,
}: {
  check: FirebaseHealthSnapshot['checks'][number];
}) {
  const Icon = SECTION_ICONS[check.id] || Activity;
  return (
    <Card className={`border-l-4 ${
      check.status === 'Healthy' ? 'border-l-emerald-500'
        : check.status === 'Warning' ? 'border-l-amber-500'
          : check.status === 'Critical' ? 'border-l-red-500' : 'border-l-slate-400'
    }`}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-slate-500" />
            {check.name}
          </span>
          <StatusBadge status={check.status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{check.detail}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">{check.latencyMs} ms</Badge>
          <Badge variant="outline">{check.category}</Badge>
        </div>
        {check.metrics && Object.keys(check.metrics).length > 0 && (
          <div className="grid grid-cols-2 gap-1 pt-1">
            {Object.entries(check.metrics).slice(0, 6).map(([k, v]) => (
              <div key={k} className="rounded border px-2 py-1 text-[11px]">
                <span className="text-muted-foreground">{k}: </span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FirebaseStatusDashboardPage({
  section = 'dashboard',
}: {
  section?: FirebaseStatusSectionId;
}) {
  const [snapshot, setSnapshot] = useState<FirebaseHealthSnapshot | null>(null);
  const [history, setHistory] = useState<FirebaseHealthSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const hasLiveSnapshot = useRef(false);

  const runCheck = useCallback(async (silent = false) => {
    if (!silent) setChecking(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) {
        throw new Error(getFirebaseSetupMessage());
      }
      const result = await runFirebaseHealthCheck({ persist: true });
      hasLiveSnapshot.current = true;
      setSnapshot(result);
      if (!silent) {
        toast.success(`Health check complete — ${result.overall}`);
      }
    } catch (e) {
      setError((e as Error).message);
      if (!silent) toast.error((e as Error).message);
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runCheck(true);
  }, [runCheck]);

  useEffect(() => {
    setHistoryLoading(true);
    const unsub = subscribeFirebaseHealthHistory(
      (rows) => {
        setHistory(rows);
        setHistoryLoading(false);
        if (!hasLiveSnapshot.current && rows[0]) {
          setSnapshot(rows[0]);
          setLoading(false);
        }
      },
      () => setHistoryLoading(false),
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = window.setInterval(() => {
      void runCheck(true);
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, runCheck]);

  const summary = useMemo(() => getHealthSummary(snapshot, history), [snapshot, history]);

  const sectionChecks = useMemo(() => {
    const base = filterChecksBySection(snapshot?.checks || [], section);
    const q = search.toLowerCase();
    return base.filter((c) => {
      const matchSearch = !q
        || c.name.toLowerCase().includes(q)
        || c.detail.toLowerCase().includes(q)
        || c.category.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || c.status === statusFilter;
      const matchCategory = categoryFilter === 'all' || c.category === categoryFilter;
      return matchSearch && matchStatus && matchCategory;
    });
  }, [snapshot?.checks, section, search, statusFilter, categoryFilter]);

  const categories = useMemo(
    () => Array.from(new Set((snapshot?.checks || []).map((c) => c.category))).sort(),
    [snapshot?.checks],
  );

  const handleExportExcel = async () => {
    const csv = exportHealthCsv(snapshot, history);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `firebase_health_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logFirebaseStatusExport(`Excel health export (${(snapshot?.checks || []).length} services)`);
    toast.success('Firebase health report exported (CSV/Excel)');
  };

  const handleExportPdf = async () => {
    openHealthPdfReport(snapshot, history);
    await logFirebaseStatusExport(`PDF health export (${(snapshot?.checks || []).length} services)`);
    toast.success('PDF report opened — use Print to save');
  };

  if (loading && !snapshot) return <LoadingSkeleton rows={4} />;
  if (error && !snapshot) return <ErrorCard message={error} onRetry={() => runCheck(false)} />;

  const titleMap: Record<FirebaseStatusSectionId, string> = {
    dashboard: 'Firebase Status',
    authentication: 'Authentication Status',
    firestore: 'Firestore Status',
    storage: 'Cloud Storage Status',
    functions: 'Cloud Functions Status',
    hosting: 'Hosting Status',
    performance: 'Performance Metrics',
    security: 'Security Rules Status',
    activity: 'Activity & Health Timeline',
    reports: 'Firebase Status Reports',
    audit: 'Firebase Status Audit Trail',
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={titleMap[section]}
        description="Enterprise Firebase infrastructure monitoring — Admin SDK probes, dual audit, auto-refresh"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              Auto-refresh {autoRefresh ? 'On' : 'Off'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel}>
              <Download className="h-4 w-4 mr-1" />Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf}>
              <Printer className="h-4 w-4 mr-1" />PDF
            </Button>
            <Button size="sm" onClick={() => runCheck(false)} disabled={checking}>
              <RefreshCw className={`h-4 w-4 mr-1 ${checking ? 'animate-spin' : ''}`} />
              Run Health Check
            </Button>
          </div>
        )}
      />

      <FirebaseStatusSubnav />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Overall" value={summary.overall} />
        <KpiCard label="Healthy" value={summary.healthy} />
        <KpiCard label="Warning" value={summary.warning} />
        <KpiCard label="Critical" value={summary.critical} />
        <KpiCard label="Avg Latency" value={`${summary.avgLatencyMs} ms`} />
        <KpiCard
          label="Uptime (samples)"
          value={summary.uptimeApprox === null ? '—' : `${summary.uptimeApprox}%`}
        />
      </div>

      {(section === 'dashboard' || section === 'reports') && (
        <Card className="border-l-4 border-l-blue-600">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Cloud className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-sm text-muted-foreground">Project / Last sync</p>
                <p className="font-mono text-sm">{summary.projectId || '—'}</p>
                <p className="text-xs text-muted-foreground">
                  {summary.lastCheck ? new Date(summary.lastCheck).toLocaleString() : 'Not checked yet'}
                  {snapshot?.source ? ` · ${snapshot.source}` : ''}
                </p>
              </div>
            </div>
            <StatusBadge status={summary.overall} />
          </CardContent>
        </Card>
      )}

      {(section === 'dashboard' || section === 'activity' || section === 'reports') && (snapshot?.alerts?.length || 0) > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Active Alerts ({snapshot?.alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {snapshot?.alerts.map((a, i) => (
              <div
                key={`${a.title}-${i}`}
                className={`rounded-md border px-3 py-2 text-sm ${statusColorClass(a.severity)}`}
              >
                <p className="font-medium">{a.title}</p>
                <p className="text-xs opacity-90">{a.message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {(section === 'dashboard' || !['activity', 'reports', 'audit'].includes(section)) && (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search services…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Healthy">Healthy</SelectItem>
                <SelectItem value="Warning">Warning</SelectItem>
                <SelectItem value="Critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {checking && !snapshot ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-36 w-full" />
              ))}
            </div>
          ) : sectionChecks.length === 0 ? (
            <EmptyState title="No services match filters" message="Adjust search or run a new health check." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {sectionChecks.map((c) => (
                <ServiceCard key={c.id} check={c} />
              ))}
            </div>
          )}
        </>
      )}

      {(section === 'dashboard' || section === 'activity' || section === 'audit' || section === 'reports') && (
        <Tabs defaultValue={section === 'reports' ? 'reports' : 'timeline'}>
          <TabsList>
            <TabsTrigger value="timeline">Health Timeline</TabsTrigger>
            <TabsTrigger value="collections">Admin Collections</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline" className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Health Check History</CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : history.length === 0 ? (
                  <EmptyState
                    title="No persisted health history yet"
                    message="Run a health check or wait for the 6-hour scheduler after Cloud Functions deploy."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Check ID</TableHead>
                          <TableHead>Overall</TableHead>
                          <TableHead>Latency</TableHead>
                          <TableHead>Alerts</TableHead>
                          <TableHead>Checked</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.map((h) => (
                          <TableRow key={h.id || h.checkId}>
                            <TableCell className="font-mono text-xs">{h.checkId}</TableCell>
                            <TableCell><StatusBadge status={h.overall} /></TableCell>
                            <TableCell>{h.avgLatencyMs ?? '—'} ms</TableCell>
                            <TableCell>{h.alerts?.length || 0}</TableCell>
                            <TableCell className="text-xs">
                              {h.checkedAt ? new Date(h.checkedAt).toLocaleString() : '—'}
                            </TableCell>
                            <TableCell className="text-xs">{h.source || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="collections">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Monitored Admin Collections</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {Object.entries(ADMIN_COLLECTIONS).map(([key, path]) => (
                    <div key={key} className="flex items-center justify-between border-b py-1.5 text-sm">
                      <span className="font-mono text-xs">{path}</span>
                      <Badge variant="outline" className="text-xs">{key}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reports" className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                'Firebase Health Report',
                'Performance / Latency Report',
                'Usage & Availability Report',
                'Authentication / Login Sample Report',
                'Storage Bucket Report',
                'Cloud Functions Self-Ping Report',
                'Security Posture Report',
                'Quota / Backup Age Report',
              ].map((name) => (
                <Card key={name}>
                  <CardContent className="p-4 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{name}</p>
                      <p className="text-xs text-muted-foreground">Derived from latest Admin SDK probes + history</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={handleExportExcel}>CSV</Button>
                      <Button size="sm" variant="outline" onClick={handleExportPdf}>PDF</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="integrations">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">QMS / Admin Integrations</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                {[
                  { href: '/admin', label: 'Admin Dashboard' },
                  { href: '/admin/users', label: 'User Management' },
                  { href: '/admin/login-activity', label: 'Login Activity' },
                  { href: '/admin/audit-trail', label: 'Audit Trail' },
                  { href: '/admin/notifications', label: 'Notification Settings' },
                  { href: '/admin/email-sms-templates', label: 'Email & SMS Templates' },
                  { href: '/admin/backup', label: 'Backup & Restore' },
                  { href: '/admin/backup/history', label: 'Backup History' },
                  { href: '/admin/system-settings', label: 'System Settings' },
                  { href: '/admin/esign-settings', label: 'E-Signature Settings' },
                  { href: '/admin/workflows', label: 'Workflow Configuration' },
                  { href: '/admin/module-configuration', label: 'Module Configuration' },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md border px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-900"
                  >
                    {item.label}
                  </Link>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {section === 'security' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Security monitoring notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Client create/update/delete on <code>system_health_checks</code> is denied — only Cloud Functions write health history.</p>
            <p>Access requires System Settings viewer roles (super_admin, admin, head_qa, auditor) plus Admin module view permission.</p>
            <p>Health check execution and exports are dual-audited to <code>audit_trail</code> and <code>audit_logs</code>.</p>
          </CardContent>
        </Card>
      )}

      {error && snapshot && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
      )}
    </div>
  );
}
