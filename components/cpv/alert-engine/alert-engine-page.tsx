'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Download, Eye, Plus, RefreshCw, Scan, Settings } from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  ALERT_SOURCES, ALERT_TYPES, ALERT_PRIORITIES, ALERT_SEVERITIES,
  buildAlertCharts, cpvAlertFormSchema, summarizeAlerts, priorityColor,
  type CpvAlertFormData, type CpvAlertRecord,
} from '@/lib/cpv-alert-records';
import {
  createCpvAlert, fetchAlertRules, fetchCpvAlerts, logAlertExport, scanAndCreateAlerts,
} from '@/lib/cpv-alert-service';
import { downloadCsv } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { AlertStatusBadge, PriorityBadge, RiskBadge } from './alert-badges';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ColumnDef } from '@/components/admin/admin-data-table';

export function AlertEnginePage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canManage = cpvPermissions.canManageAlerts(role);
  const canConfigure = cpvPermissions.canConfigureAlertRules(role);
  const canExport = cpvPermissions.canExportAlerts(role);

  const [records, setRecords] = useState<CpvAlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState('all');
  const [filterSource, setFilterSource] = useState('all');
  const [rules, setRules] = useState<Awaited<ReturnType<typeof fetchAlertRules>>>([]);

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System', role: profile?.role || '' };
  const summary = useMemo(() => summarizeAlerts(records), [records]);
  const charts = useMemo(() => buildAlertCharts(records), [records]);

  const form = useForm<CpvAlertFormData>({
    resolver: zodResolver(cpvAlertFormSchema),
    defaultValues: {
      alertTitle: '', alertSource: 'Manual Alert', moduleName: 'Manual Alert',
      productName: '', productCode: '', batchNumber: '', parameterName: '',
      observedValue: '', limitValue: '', alertType: 'Alert Limit Crossed',
      alertCategory: 'Operational', alertPriority: 'Medium', alertSeverity: 'Warning', alertMessage: '',
      assignedTo: '', assignedRole: 'qa', dueDate: '',
      deliveryChannels: ['In-App', 'Toast'],
      changeReason: 'Manual CPV alert created',
    },
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, ruleRows] = await Promise.all([fetchCpvAlerts(), fetchAlertRules()]);
      setRecords(rows);
      setRules(ruleRows);
    } catch {
      setError('Failed to load alerts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => records.filter((r) => {
    if (filterStatus !== 'all' && r.alertStatus !== filterStatus) return false;
    if (filterPriority !== 'all' && r.alertPriority !== filterPriority) return false;
    if (filterSource !== 'all' && r.alertSource !== filterSource) return false;
    return true;
  }), [records, filterStatus, filterPriority, filterSource]);

  const runScan = async () => {
    setScanning(true);
    const { created, error: err } = await scanAndCreateAlerts(actor);
    setScanning(false);
    if (err) return toast.error(err);
    toast.success(`${created} alert(s) auto-generated`);
    await load();
  };

  const saveManual = form.handleSubmit(async (values) => {
    const { result, error: err } = await createCpvAlert(values, actor, records.length);
    if (err || !result) return toast.error(err || 'Create failed');
    toast.success(`Alert ${result.alertNumber} created`);
    setCreateOpen(false);
    form.reset();
    await load();
  });

  const exportList = () => {
    downloadCsv('cpv-alerts.csv',
      ['AlertNumber', 'Title', 'Source', 'Product', 'Batch', 'Priority', 'Status', 'Detected'],
      filtered.map((r) => [
        r.alertNumber, r.alertTitle, r.alertSource, r.productName, r.batchNumber,
        r.alertPriority, r.alertStatus, String(r.detectedDateTime).slice(0, 16),
      ]),
    );
    void logAlertExport(actor, filtered.length);
    toast.success('Alert list exported');
  };

  const columns: ColumnDef<CpvAlertRecord>[] = [
    { key: 'alertNumber', header: 'Alert No.' },
    { key: 'alertTitle', header: 'Title', render: (r) => <span className="line-clamp-1 max-w-[160px]">{r.alertTitle}</span> },
    { key: 'alertSource', header: 'Source', render: (r) => <span className="line-clamp-1 max-w-[120px]">{r.alertSource}</span> },
    { key: 'productName', header: 'Product' },
    { key: 'alertPriority', header: 'Priority', render: (r) => <PriorityBadge priority={String(r.alertPriority)} /> },
    { key: 'alertStatus', header: 'Status', render: (r) => <AlertStatusBadge status={String(r.alertStatus)} /> },
    { key: 'riskLevel', header: 'Risk', render: (r) => <RiskBadge level={String(r.riskLevel)} /> },
    {
      key: 'actions', header: '',
      render: (r) => (
        <Button variant="ghost" size="icon" onClick={() => router.push(`/cpv/alert-engine/${r.id}`)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error) return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="CPV Alert Engine"
        description="Detect, notify and track CPV alerts from process, quality, risk and statistical data"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Alert Engine' },
        ]}
        actions={(
          <>
            {canExport && <Button variant="outline" size="sm" onClick={exportList}><Download className="h-4 w-4 mr-1" />Export</Button>}
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => void runScan()} disabled={scanning}>
                <Scan className={`h-4 w-4 mr-1 ${scanning ? 'animate-spin' : ''}`} />Scan Sources
              </Button>
            )}
            {canConfigure && (
              <Button variant="outline" size="sm" onClick={() => setRulesOpen(true)}>
                <Settings className="h-4 w-4 mr-1" />Rules
              </Button>
            )}
            {canManage && (
              <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4 mr-1" />Manual Alert</Button>
            )}
          </>
        )}
      />

      <div className="flex flex-wrap gap-2 text-xs">
        {[
          { href: '/cpv/dashboard', label: 'Dashboard' },
          { href: '/cpv/cpp', label: 'CPP' },
          { href: '/cpv/cqa', label: 'CQA' },
          { href: '/cpv/yield-monitoring', label: 'Yield' },
          { href: '/cpv/environmental-monitoring', label: 'Environmental' },
          { href: '/cpv/utility-monitoring', label: 'Utility' },
          { href: '/cpv/hold-time-monitoring', label: 'Hold Time' },
          { href: '/cpv/stability-monitoring', label: 'Stability' },
          { href: '/cpv/statistical-process-control', label: 'SPC' },
          { href: '/cpv/process-capability', label: 'Capability' },
          { href: '/cpv/trend-analysis', label: 'Trend' },
          { href: '/cpv/risk-assessment', label: 'Risk' },
          { href: '/cpv/annual-review', label: 'Annual Review' },
          { href: '/cpv/reports-analytics', label: 'Reports' },
          { href: '/cpv/ai-analytics', label: 'AI Analytics' },
          { href: '/qms/audit-trail', label: 'Audit Trail' },
          { href: '/admin/system-health', label: 'System Health' },
        ].map((link) => (
          <Button key={link.href} variant="ghost" size="sm" className="h-7 px-2" onClick={() => router.push(link.href)}>
            {link.label}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5 xl:grid-cols-10">
        <KpiCard label="Total Alerts" value={summary.total} tone="blue" />
        <KpiCard label="Open" value={summary.open} tone={summary.open ? 'red' : 'green'} />
        <KpiCard label="Critical" value={summary.critical} tone="red" />
        <KpiCard label="High" value={summary.high} tone="amber" />
        <KpiCard label="Acknowledged" value={summary.acknowledged} tone="blue" />
        <KpiCard label="Overdue" value={summary.overdue} tone="red" />
        <KpiCard label="Deviation Linked" value={summary.deviationLinked} />
        <KpiCard label="OOS Linked" value={summary.oosLinked} tone="amber" />
        <KpiCard label="CAPA Linked" value={summary.capaLinked} />
        <KpiCard label="Closed" value={summary.closed} tone="green" />
      </div>

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alert Dashboard</TabsTrigger>
          <TabsTrigger value="critical">Critical / Emergency</TabsTrigger>
          <TabsTrigger value="escalation">Escalation</TabsTrigger>
          <TabsTrigger value="charts">AI & Analytics</TabsTrigger>
          <TabsTrigger value="rules">Alert Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="alerts" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Select value={filterSource} onValueChange={setFilterSource}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {ALERT_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterPriority} onValueChange={setFilterPriority}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priority</SelectItem>
                {ALERT_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {['Open', 'Acknowledged', 'Under Investigation', 'Linked to Deviation', 'Linked to OOS', 'Linked to CAPA', 'Closed', 'Overdue', 'Rejected'].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
          <Card>
            <CardContent className="pt-6">
              {filtered.length ? (
                <ResponsiveDataTable columns={columns} data={filtered} searchKeys={['alertNumber', 'productName', 'batchNumber', 'parameterName', 'alertTitle']} />
              ) : (
                <EmptyState title="No alerts" message="Run a source scan or create a manual alert." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="critical" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              {records.filter((r) => ['Critical', 'Emergency'].includes(r.alertPriority) && !['Closed', 'Rejected'].includes(r.alertStatus)).length ? (
                <ResponsiveDataTable
                  columns={columns}
                  data={records.filter((r) => ['Critical', 'Emergency'].includes(r.alertPriority) && !['Closed', 'Rejected'].includes(r.alertStatus))}
                  searchKeys={['alertNumber', 'productName', 'batchNumber']}
                />
              ) : (
                <EmptyState title="No critical alerts" message="Critical and emergency alerts will appear here." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="escalation" className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              {records.filter((r) => r.alertStatus === 'Overdue' || r.escalationLevel > 0).length ? (
                <ResponsiveDataTable
                  columns={columns}
                  data={records.filter((r) => r.alertStatus === 'Overdue' || r.escalationLevel > 0)}
                  searchKeys={['alertNumber', 'productName']}
                />
              ) : (
                <EmptyState title="No escalations" message="SLA escalations and overdue alerts appear here." />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="charts">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-sm">Alert by Source</CardTitle></CardHeader>
              <CardContent className="h-56"><ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={charts.bySource} dataKey="value" nameKey="name" outerRadius={70} label>
                  {charts.bySource.map((_, i) => <Cell key={i} fill={['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed'][i % 5]} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-sm">Alert by Priority</CardTitle></CardHeader>
              <CardContent className="h-56"><ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={charts.byPriority} dataKey="value" nameKey="name" outerRadius={70} label>
                  {charts.byPriority.map((e) => <Cell key={e.name} fill={priorityColor(e.name)} />)}
                </Pie><Tooltip /></PieChart>
              </ResponsiveContainer></CardContent></Card>
            <Card className="lg:col-span-2"><CardHeader><CardTitle className="text-sm">Monthly Alert Trend</CardTitle></CardHeader>
              <CardContent className="h-56"><ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts.trendByMonth}><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" fill="#2563eb" /></BarChart>
              </ResponsiveContainer></CardContent></Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle className="text-sm">AI Predictive / High-Confidence Alerts</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {records.filter((r) => r.aiIntelligence?.isPredictive || (r.aiIntelligence?.aiConfidenceScore || 0) >= 80).slice(0, 8).map((r) => (
                  <div key={r.id} className="rounded-md border p-3">
                    <p className="font-medium">{r.alertNumber} · {r.alertTitle}</p>
                    <p className="text-muted-foreground">Confidence {r.aiIntelligence?.aiConfidenceScore || 0}% · {r.aiIntelligence?.riskPrediction || '—'}</p>
                    <p className="text-xs mt-1">{r.aiIntelligence?.aiRecommendedActions || ''}</p>
                  </div>
                ))}
                {!records.some((r) => r.aiIntelligence?.isPredictive || (r.aiIntelligence?.aiConfidenceScore || 0) >= 80) && (
                  <EmptyState title="No AI predictions yet" message="Predictive intelligence appears after alerts are generated." />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardContent className="pt-6 space-y-2">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{rule.ruleName}</p>
                    <PriorityBadge priority={rule.priority} />
                  </div>
                  <p className="text-muted-foreground">{rule.moduleName} · {rule.conditionType} · SLA {rule.slaHours || 24}h</p>
                  <p className="text-xs mt-1">Channels: {(rule.deliveryChannels || ['In-App']).join(', ')} · Notify {rule.notifyRole} → Escalate {rule.escalationRole}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Create Manual Alert</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={saveManual} className="space-y-4">
              <FormField control={form.control} name="alertTitle" render={({ field }) => (
                <FormItem><FormLabel>Alert Title *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField control={form.control} name="alertSource" render={({ field }) => (
                  <FormItem><FormLabel>Source *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{ALERT_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="alertType" render={({ field }) => (
                  <FormItem><FormLabel>Type *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{ALERT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="productName" render={({ field }) => (
                  <FormItem><FormLabel>Product *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="batchNumber" render={({ field }) => (
                  <FormItem><FormLabel>Batch</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="alertPriority" render={({ field }) => (
                  <FormItem><FormLabel>Priority *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{ALERT_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="alertSeverity" render={({ field }) => (
                  <FormItem><FormLabel>Severity *</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{ALERT_SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="assignedRole" render={({ field }) => (
                  <FormItem><FormLabel>Assigned Role</FormLabel><FormControl><Input {...field} placeholder="qa" /></FormControl><FormMessage /></FormItem>
                )} />
              </div>
              <FormField control={form.control} name="alertMessage" render={({ field }) => (
                <FormItem><FormLabel>Message *</FormLabel><FormControl><Textarea {...field} rows={3} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="changeReason" render={({ field }) => (
                <FormItem><FormLabel>Change Reason (ALCOA+) *</FormLabel><FormControl><Textarea {...field} rows={2} /></FormControl><FormMessage /></FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit">Create Alert</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={rulesOpen} onOpenChange={setRulesOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Alert Rules</DialogTitle></DialogHeader>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {rules.map((rule) => (
              <div key={rule.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{rule.ruleName}</p>
                  <PriorityBadge priority={rule.priority} />
                </div>
                <p className="text-muted-foreground">{rule.moduleName} · {rule.conditionType} · {rule.comparisonOperator} {rule.thresholdValue}</p>
                <p className="text-xs mt-1">Notify: {rule.notifyRole} · Escalate: {rule.escalationRole} · Suppression: {rule.repeatAlertSuppressionHours}h</p>
              </div>
            ))}
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setRulesOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
