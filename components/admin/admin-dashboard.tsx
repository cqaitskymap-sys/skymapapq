'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  Users, UserCheck, UserX, Lock, Shield, Building2, Clock, FileSearch,
  Database, Activity, RefreshCw, Download, Plus, GitBranch, Settings,
  Eye, MapPin, AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { usePermissions } from '@/hooks/usePermissions';
import { navHrefModule } from '@/lib/nav-permissions';
import {
  fetchAdminDashboardData, logDashboardAudit,
  type AdminDashboardData,
} from '@/lib/admin/admin-dashboard-service';
import { KpiCard } from './dashboard/kpi-card';
import { StatusBadge } from './dashboard/status-badge';
import { LoadingSkeleton } from './dashboard/loading-skeleton';
import { EmptyState } from './dashboard/empty-state';
import { ErrorCard } from './dashboard/error-card';
import { PageHeader } from './dashboard/page-header';

const DashboardChartCard = dynamic(
  () => import('./dashboard/chart-card').then((module) => module.DashboardChartCard),
  {
    ssr: false,
    loading: () => <div className="h-[312px] animate-pulse rounded-xl bg-muted" role="status" aria-label="Loading chart" />,
  },
);

const SAFE_CHART = [{ name: 'No Data', value: 0 }];

function safeChartData(data: { name: string; value: number }[]) {
  return data?.length ? data : SAFE_CHART;
}

interface AdminDashboardProps {
  basePath?: string;
}

export function AdminDashboard({ basePath = '/admin' }: AdminDashboardProps) {
  const { user, profile } = useAuth();
  const { role, canAccessAdmin, isReadOnly, hasPermission, loading: permsLoading } = useAdminPermissions();
  const { canAccessModule } = usePermissions();
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const adminBase = '/admin';
  const canView = canAccessAdmin && hasPermission('Admin', 'view');
  const canAct = !isReadOnly && (role === 'super_admin' || role === 'admin');

  const getAuditMeta = useCallback(() => ({
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  }), [profile?.email, profile?.full_name, user?.uid]);

  const load = useCallback(async (isRefresh = false) => {
    if (startDate && endDate && startDate > endDate) {
      setError('Start date must be on or before end date');
      toast.error('Invalid date range');
      return;
    }
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fetchAdminDashboardData({
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setData(result);
      if (isRefresh) {
        await logDashboardAudit('REFRESH', getAuditMeta(), 'Dashboard data refreshed');
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [startDate, endDate, getAuditMeta]);

  useEffect(() => {
    if (!permsLoading && canView) load();
    else if (!permsLoading) setLoading(false);
  }, [permsLoading, canView, load]);

  useEffect(() => {
    if (permsLoading || !canView) return;
    const refreshWhenActive = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const interval = window.setInterval(refreshWhenActive, 120_000);
    window.addEventListener('online', refreshWhenActive);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', refreshWhenActive);
    };
  }, [canView, load, permsLoading]);

  const handleExport = async () => {
    if (!data) return;
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `admin-dashboard-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      await logDashboardAudit('EXPORT', getAuditMeta(), 'Dashboard data exported');
      toast.success('Dashboard exported');
    } catch {
      toast.error('Export failed');
    }
  };

  if (permsLoading || (loading && !data)) {
    return (
      <div>
        <PageHeader title="Admin Dashboard" description="Pharma QMS system control overview" basePath={basePath} />
        <LoadingSkeleton />
      </div>
    );
  }

  if (!canView) {
    return (
      <div>
        <PageHeader title="Admin Dashboard" basePath={basePath} />
        <ErrorCard
          accessDenied
          title="Access Denied"
          message="Only Super Admin, Admin, and authorized Auditors can view this dashboard."
        />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div>
        <PageHeader title="Admin Dashboard" basePath={basePath} />
        <ErrorCard message={error} onRetry={() => load()} />
      </div>
    );
  }

  if (!data) return null;

  const k = data.kpis;
  const visibleModuleKpis = data.moduleKpis.filter((item) => {
    const moduleName = navHrefModule(item.href);
    return !moduleName || canAccessModule(moduleName);
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Dashboard"
        description="Complete system control overview for Pharma QMS + PQR + CPV"
        basePath={basePath}
        actions={
          <div className="flex flex-wrap gap-2">
            {isReadOnly && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                Read-Only Mode
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />Export
            </Button>
          </div>
        }
      />

      <Card className="bg-slate-50 dark:bg-slate-900/50 border-slate-200">
        <CardContent className="p-4 flex flex-col sm:flex-row flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Start Date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">End Date</Label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 w-40" />
          </div>
          <Button size="sm" onClick={() => load()} className="bg-blue-600 hover:bg-blue-700">
            Apply Filter
          </Button>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <KpiCard label="Total Users" value={k.totalUsers} icon={Users} accent="border-l-blue-600" />
        <KpiCard label="Active Users" value={k.activeUsers} icon={UserCheck} accent="border-l-green-600" />
        <KpiCard label="Inactive Users" value={k.inactiveUsers} icon={UserX} accent="border-l-slate-400" />
        <KpiCard label="Locked Users" value={k.lockedUsers} icon={Lock} accent="border-l-red-500" />
        <KpiCard label="Total Roles" value={k.totalRoles} icon={Shield} accent="border-l-indigo-600" />
        <KpiCard label="Departments" value={k.totalDepartments} icon={Building2} accent="border-l-cyan-600" />
        <KpiCard label="Sites" value={k.totalSites} icon={MapPin} accent="border-l-teal-600" />
        <KpiCard label="Pending Approvals" value={k.pendingApprovals} icon={Clock} accent="border-l-amber-500" />
        <KpiCard label="Audit Records" value={k.totalAuditRecords} icon={FileSearch} accent="border-l-violet-600" />
        <KpiCard label="Firebase" value={k.firebaseStatus} isStatus accent="border-l-sky-600" />
        <KpiCard label="Last Backup" value={k.lastBackupStatus} accent="border-l-purple-600" />
        <KpiCard label="Health Score" value={`${k.systemHealthScore}%`} icon={Activity} accent="border-l-emerald-600" />
      </div>

      {/* Quick Actions */}
      {canAct && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-800">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link href="/admin/users/create"><Plus className="h-4 w-4 mr-1" />Add User</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`${adminBase}/roles`}><Shield className="h-4 w-4 mr-1" />Create Role</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`${adminBase}/departments`}><Building2 className="h-4 w-4 mr-1" />Add Department</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`${adminBase}/workflows`}><GitBranch className="h-4 w-4 mr-1" />Configure Workflow</Link></Button>
            <Button asChild size="sm" variant="outline"><Link href={`${adminBase}/audit-trail`}><Eye className="h-4 w-4 mr-1" />View Audit Trail</Link></Button>
            <Button asChild size="sm" variant="outline">
              <Link href={`${adminBase}/backup/create`}><Database className="h-4 w-4 mr-1" />Create Backup Export</Link>
            </Button>
            <Button asChild size="sm" variant="outline"><Link href={`${adminBase}/system-settings`}><Settings className="h-4 w-4 mr-1" />System Settings</Link></Button>
          </CardContent>
        </Card>
      )}

      {(data.dataQuality.sampled || data.dataQuality.warnings.length > 0) && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Dashboard data quality notice</p>
            <p>
              {data.dataQuality.sampled
                ? 'KPI totals are server aggregates; charts and activity lists use bounded recent samples. '
                : ''}
              {data.dataQuality.warnings.length > 0
                ? `${data.dataQuality.warnings.length} data source(s) could not be read.`
                : ''}
            </p>
          </div>
        </div>
      )}

      <section aria-labelledby="module-overview-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="module-overview-title" className="text-lg font-semibold">QMS Module Overview</h2>
          <span className="text-xs text-muted-foreground">
            Updated {new Date(data.dataQuality.fetchedAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visibleModuleKpis.map((item) => (
            <Link key={item.label} href={item.href} className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              <KpiCard label={item.label} value={item.value} accent="border-l-blue-500" />
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">User Activity — Recent Logins</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/login-activity">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {data.loginActivity.length === 0 ? (
              <EmptyState title="No login activity" message="Login events will appear here once users sign in." />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-2">User</th>
                    <th className="pb-2 pr-2">Role</th>
                    <th className="pb-2 pr-2">Time</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.loginActivity.map((row, i) => (
                    <tr key={row.id || i} className="border-b last:border-0">
                      <td className="py-2 pr-2">
                        <p className="font-medium truncate max-w-[120px]">{row.userName}</p>
                        <p className="text-xs text-muted-foreground truncate max-w-[120px]">{row.email}</p>
                      </td>
                      <td className="py-2 pr-2 text-xs">{row.role}</td>
                      <td className="py-2 pr-2 text-xs whitespace-nowrap">
                        {row.loginTime ? new Date(row.loginTime).toLocaleString() : '-'}
                      </td>
                      <td className="py-2"><StatusBadge status={row.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Recent Admin Actions */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Admin Actions</CardTitle></CardHeader>
          <CardContent>
            {data.recentActions.length === 0 ? (
              <EmptyState title="No audit events" message="Admin actions will be logged here automatically." />
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {data.recentActions.map((act, i) => (
                  <div key={act.id || i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 p-3 border rounded-lg text-sm">
                    <div>
                      <p className="font-medium">{act.action} — {act.module}</p>
                      <p className="text-xs text-muted-foreground">{act.userName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={act.status} />
                      <span className="text-xs text-muted-foreground">
                        {act.dateTime ? new Date(act.dateTime).toLocaleString() : '-'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Approvals */}
        <Card>
          <CardHeader><CardTitle className="text-base">Approval Overview</CardTitle></CardHeader>
          <CardContent>
            {data.pendingApprovals.length === 0 ? (
              <EmptyState title="No pending approvals" message="All user, workflow, and config changes are approved." />
            ) : (
              <div className="space-y-2">
                {data.pendingApprovals.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 border rounded-lg text-sm gap-2">
                    <div>
                      <Badge variant="outline" className="text-xs mb-1">{p.type}</Badge>
                      <p className="font-medium">{p.title}</p>
                      <p className="text-xs text-muted-foreground">By {p.requestedBy}</p>
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Health */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">
              <Link href="/admin/system-health" className="hover:text-blue-600 hover:underline">
                System Health
              </Link>
            </CardTitle>
            <StatusBadge status={data.systemHealth.overall} />
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 border rounded bg-slate-50 dark:bg-slate-900">
                <p className="text-muted-foreground">Health Score</p>
                <p className="text-lg font-bold text-blue-600">{data.systemHealth.score}%</p>
              </div>
              <div className="p-2 border rounded bg-slate-50 dark:bg-slate-900">
                <p className="text-muted-foreground">Environment</p>
                <p className="font-medium">{data.systemHealth.environment}</p>
              </div>
              <div className="p-2 border rounded bg-slate-50 dark:bg-slate-900">
                <p className="text-muted-foreground">Build Version</p>
                <p className="font-medium">{data.systemHealth.buildVersion}</p>
              </div>
              <div className="p-2 border rounded bg-slate-50 dark:bg-slate-900">
                <p className="text-muted-foreground">Last Check</p>
                <p className="font-medium text-xs">{new Date(data.systemHealth.checkedAt).toLocaleString()}</p>
              </div>
            </div>
            {data.systemHealth.checks.map((c) => (
              <div key={c.name} className="flex items-center justify-between py-2 border-b text-sm last:border-0">
                <span>{c.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground hidden sm:inline">{c.detail}</span>
                  <StatusBadge status={c.status} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <DashboardChartCard title="Users by Role" data={safeChartData(data.charts.usersByRole)} type="pie" />
        <DashboardChartCard title="Users by Department" data={safeChartData(data.charts.usersByDepartment)} type="bar" />
        <DashboardChartCard title="Monthly Login Trend" data={safeChartData(data.charts.monthlyLoginTrend)} type="line" />
        <DashboardChartCard title="Module Usage (Audit)" data={safeChartData(data.charts.moduleUsageTrend)} type="bar" />
        <DashboardChartCard title="Audit Actions Trend" data={safeChartData(data.charts.auditActionsTrend)} type="line" />
      </div>
    </div>
  );
}
