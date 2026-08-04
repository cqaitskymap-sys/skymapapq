'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, CheckCircle2, Cloud, Download, Printer, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { SystemHealthSubnav } from './system-health-subnav';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  acknowledgeSystemHealthAlert,
  exportSystemHealthCsv,
  filterChecksForSection,
  getSystemHealthSummary,
  logSystemHealthExport,
  openSystemHealthPdfReport,
  runSystemHealthCheck,
  subscribeSystemHealthHistory,
  systemHealthBorderClass,
  systemHealthColorClass,
  systemHealthDotClass,
  type SystemHealthLevel,
  type SystemHealthSectionId,
  type SystemHealthSnapshot,
} from '@/lib/admin/system-health-service';
import { isFirebaseConfigured, getFirebaseSetupMessage } from '@/lib/firebase';

const AUTO_REFRESH_MS = 90_000;

function StatusBadge({ status }: { status: SystemHealthLevel }) {
  return (
    <Badge variant="outline" className={systemHealthColorClass(status)}>
      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${systemHealthDotClass(status)}`} />
      {status}
    </Badge>
  );
}

export function SystemHealthDashboardPage({
  section = 'dashboard',
}: {
  section?: SystemHealthSectionId;
}) {
  const [snapshot, setSnapshot] = useState<SystemHealthSnapshot | null>(null);
  const [history, setHistory] = useState<SystemHealthSnapshot[]>([]);
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
      if (!isFirebaseConfigured()) throw new Error(getFirebaseSetupMessage());
      const result = await runSystemHealthCheck({ persist: true });
      hasLiveSnapshot.current = true;
      setSnapshot(result);
      if (!silent) toast.success(`System health ${result.overall} — score ${result.healthScore}%`);
    } catch (e) {
      setError((e as Error).message);
      if (!silent) toast.error((e as Error).message);
    } finally {
      setChecking(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => { void runCheck(true); }, [runCheck]);

  useEffect(() => {
    setHistoryLoading(true);
    const unsub = subscribeSystemHealthHistory(
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
    const id = window.setInterval(() => { void runCheck(true); }, AUTO_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, runCheck]);

  const summary = useMemo(() => getSystemHealthSummary(snapshot, history), [snapshot, history]);

  const sectionChecks = useMemo(() => {
    const base = filterChecksForSection(snapshot?.checks || [], section);
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

  const filteredModules = useMemo(() => {
    const q = search.toLowerCase();
    return (snapshot?.modules || []).filter((m) => {
      const matchSearch = !q
        || m.name.toLowerCase().includes(q)
        || m.collection.toLowerCase().includes(q)
        || m.category.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || m.status === statusFilter;
      const matchCategory = categoryFilter === 'all' || m.category === categoryFilter;
      return matchSearch && matchStatus && matchCategory;
    });
  }, [snapshot?.modules, search, statusFilter, categoryFilter]);

  const categories = useMemo(
    () => Array.from(new Set([
      ...(snapshot?.checks || []).map((c) => c.category),
      ...(snapshot?.modules || []).map((m) => m.category),
    ])).sort(),
    [snapshot?.checks, snapshot?.modules],
  );

  const handleExportExcel = async () => {
    const csv = exportSystemHealthCsv(snapshot, history);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system_health_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logSystemHealthExport(`Excel system health export (score ${snapshot?.healthScore ?? 0}%)`);
    toast.success('System health report exported (CSV/Excel)');
  };

  const handleExportPdf = async () => {
    openSystemHealthPdfReport(snapshot, history);
    await logSystemHealthExport(`PDF system health export (score ${snapshot?.healthScore ?? 0}%)`);
    toast.success('PDF report opened — use Print to save');
  };

  const handleAck = async (title: string) => {
    await acknowledgeSystemHealthAlert(title);
    toast.success('Alert acknowledged (audit recorded)');
  };

  if (loading && !snapshot) return <LoadingSkeleton rows={4} />;
  if (error && !snapshot) return <ErrorCard message={error} onRetry={() => runCheck(false)} />;

  const titleMap: Record<SystemHealthSectionId, string> = {
    dashboard: 'System Health Check',
    infrastructure: 'Infrastructure Health',
    application: 'Application Health',
    firebase: 'Firebase Health (via System Scan)',
    api: 'API Health',
    database: 'Database Health',
    security: 'Security Health',
    background: 'Background Services',
    integrations: 'Integrations Health',
    alerts: 'System Health Alerts',
    reports: 'System Health Reports',
    audit: 'System Health Audit Trail',
  };

  const showMatrix = section === 'dashboard' || section === 'application' || section === 'integrations'
    || section === 'firebase' || section === 'database';
  const showChecks = section !== 'alerts' && section !== 'reports' && section !== 'audit';
  const showAlerts = section === 'dashboard' || section === 'alerts' || section === 'reports';
  const showTimeline = section === 'dashboard' || section === 'audit' || section === 'reports' || section === 'alerts';

  return (
    <div className="space-y-6">
      <PageHeader
        title={titleMap[section]}
        description="Enterprise continuous monitoring — infrastructure, modules, security, DR readiness, dual audit"
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/firebase-status"><Cloud className="h-4 w-4 mr-1" />Firebase Status</Link>
            </Button>
            <Button
              variant={autoRefresh ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAutoRefresh((v) => !v)}
            >
              Live {autoRefresh ? 'On' : 'Off'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel}>
              <Download className="h-4 w-4 mr-1" />Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf}>
              <Printer className="h-4 w-4 mr-1" />PDF
            </Button>
            <Button size="sm" onClick={() => runCheck(false)} disabled={checking}>
              <RefreshCw className={`h-4 w-4 mr-1 ${checking ? 'animate-spin' : ''}`} />
              Run Health Scan
            </Button>
          </div>
        )}
      />

      <SystemHealthSubnav />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Health Score" value={`${summary.healthScore}%`} />
        <KpiCard label="Overall" value={summary.overall} isStatus />
        <KpiCard label="Healthy" value={summary.healthy} />
        <KpiCard label="Warning / Degraded" value={summary.warning + summary.degraded} />
        <KpiCard label="Critical" value={summary.critical} />
        <KpiCard label="Avg Latency" value={`${summary.avgLatencyMs} ms`} />
      </div>

      {(section === 'dashboard' || section === 'reports') && (
        <Card className={`border-l-4 ${systemHealthBorderClass(summary.overall)}`}>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Activity className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Executive health score</p>
                  <p className="text-2xl font-bold">{summary.healthScore}%</p>
                  <p className="text-xs text-muted-foreground">
                    {summary.lastCheck ? new Date(summary.lastCheck).toLocaleString() : 'Not scanned'}
                    {snapshot?.source ? ` · ${snapshot.source}` : ''}
                    {summary.uptimeApprox !== null ? ` · Sample uptime ${summary.uptimeApprox}%` : ''}
                  </p>
                </div>
              </div>
              <StatusBadge status={summary.overall} />
            </div>
            <Progress value={Math.min(100, Math.max(0, summary.healthScore))} className="h-2" />
          </CardContent>
        </Card>
      )}

      {(section === 'dashboard' || section === 'infrastructure' || section === 'firebase') && snapshot?.categories && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {Object.entries(snapshot.categories).map(([cat, status]) => (
            <Card key={cat} className={`border-l-4 ${systemHealthBorderClass(status)}`}>
              <CardContent className="p-3 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{cat}</span>
                <StatusBadge status={status} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {showAlerts && (snapshot?.alerts?.length || 0) > 0 && (
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
                className={`rounded-md border px-3 py-2 text-sm flex flex-wrap items-center justify-between gap-2 ${systemHealthColorClass(a.severity)}`}
              >
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs opacity-90">{a.message}</p>
                  <p className="text-[11px] mt-1 opacity-75">{a.category}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => handleAck(a.title)}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Acknowledge
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {showChecks && (
        <>
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="Search checks / modules…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="Healthy">Healthy</SelectItem>
                <SelectItem value="Warning">Warning</SelectItem>
                <SelectItem value="Degraded">Degraded</SelectItem>
                <SelectItem value="Critical">Critical</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
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
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {sectionChecks.map((c) => (
                <Card key={c.id} className={`border-l-4 ${systemHealthBorderClass(c.status)}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between gap-2">
                      <span>{c.name}</span>
                      <StatusBadge status={c.status} />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground">{c.detail}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{c.latencyMs} ms</Badge>
                      <Badge variant="outline">{c.category}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {sectionChecks.length === 0 && (
                <div className="col-span-full">
                  <EmptyState title="No checks match filters" message="Adjust filters or run a new health scan." />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {showMatrix && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Business Module Health Matrix ({filteredModules.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredModules.length === 0 ? (
              <EmptyState title="No module rows" message="Run a full system scan after Cloud Functions deploy." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Module</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Collection</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Detail</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredModules.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>
                          <Link href={m.href} className="text-blue-600 hover:underline text-sm">{m.name}</Link>
                        </TableCell>
                        <TableCell className="text-xs">{m.category}</TableCell>
                        <TableCell className="font-mono text-xs">{m.collection}</TableCell>
                        <TableCell><StatusBadge status={m.status} /></TableCell>
                        <TableCell>{m.latencyMs} ms</TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{m.detail}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showTimeline && (
        <Tabs defaultValue={section === 'reports' ? 'reports' : 'timeline'}>
          <TabsList>
            <TabsTrigger value="timeline">Health Timeline</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Scan History</CardTitle></CardHeader>
              <CardContent>
                {historyLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : history.length === 0 ? (
                  <EmptyState
                    title="No persisted scans yet"
                    message="Run a health scan or wait for the 4-hour scheduler after Cloud Functions deploy."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Scan ID</TableHead>
                          <TableHead>Overall</TableHead>
                          <TableHead>Score</TableHead>
                          <TableHead>Latency</TableHead>
                          <TableHead>Alerts</TableHead>
                          <TableHead>Checked</TableHead>
                          <TableHead>Source</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.map((h) => (
                          <TableRow key={h.id || h.scanId}>
                            <TableCell className="font-mono text-xs">{h.scanId}</TableCell>
                            <TableCell><StatusBadge status={h.overall} /></TableCell>
                            <TableCell>{h.healthScore}%</TableCell>
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

          <TabsContent value="reports" className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {[
                'System Health Report',
                'Infrastructure Report',
                'Application Report',
                'Database / Firestore Report',
                'API / Integrations Report',
                'Security Report',
                'Performance / Latency Report',
                'Availability Report',
                'Compliance Monitoring Report',
              ].map((name) => (
                <Card key={name}>
                  <CardContent className="p-4 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{name}</p>
                      <p className="text-xs text-muted-foreground">Derived from latest enterprise scan + timeline</p>
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
                <CardTitle className="text-base">Linked Admin / QMS Surfaces</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
                {[
                  { href: '/admin', label: 'Admin Dashboard' },
                  { href: '/admin/firebase-status', label: 'Firebase Status' },
                  { href: '/admin/backup', label: 'Backup & Restore' },
                  { href: '/admin/backup/history', label: 'Backup History' },
                  { href: '/admin/audit-trail', label: 'Audit Trail' },
                  { href: '/admin/login-activity', label: 'Login Activity' },
                  { href: '/admin/notifications', label: 'Notification Settings' },
                  { href: '/admin/email-sms-templates', label: 'Email & SMS Templates' },
                  { href: '/admin/users', label: 'User Management' },
                  { href: '/admin/workflows', label: 'Workflow Configuration' },
                  { href: '/admin/system-settings', label: 'System Settings' },
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

      {error && snapshot && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{error}</p>
      )}
    </div>
  );
}
