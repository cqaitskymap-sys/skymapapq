'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Download, Eye, FileText, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  KPI_FILTER_MAP,
  canExportRecallDashboard,
  isRecallDashboardReadOnly,
} from '@/lib/recall-dashboard-records';
import {
  exportRecallDashboardCsvDownload,
  fetchRecallDashboardData,
  logRecallDashboardExcelExport,
  logRecallDashboardFilterApplied,
  logRecallDashboardPdfExport,
  logRecallDashboardRefreshed,
  logRecallDashboardViewed,
  logRecallRecordOpened,
  openRecallDashboardPdfPlaceholder,
} from '@/lib/recall-dashboard-service';
import type {
  RecallDashboardChartData,
  RecallDashboardMetrics,
  RecallFilters,
  RecallOpenRecoveryRow,
  RecallRecord,
  RecallRegulatoryPendingRow,
} from '@/lib/recall-types';
import { canCreateRecall, getRecallRecoveryPercent } from '@/lib/recall-types';
import { getLatestRecallTrendSummary } from '@/lib/recall-trend-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { RecallDashboardCharts } from './recall-dashboard-charts';
import { RecallFiltersBar } from './recall-filters';
import { RecallDashboardAccessGuard } from './recall-dashboard-access-guard';
import { RecallStatusBadge, ClassificationBadge } from './recall-sub-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const KPI_ITEMS: {
  label: string;
  key: keyof RecallDashboardMetrics;
  filterKey?: string;
  accent?: string;
}[] = [
  { label: 'Total Recalls', key: 'total', filterKey: 'total' },
  { label: 'Open Recalls', key: 'open', filterKey: 'open', accent: 'border-l-amber-500' },
  { label: 'Closed Recalls', key: 'closed', filterKey: 'closed', accent: 'border-l-green-600' },
  { label: 'Mock Recalls', key: 'mockRecalls', filterKey: 'mock', accent: 'border-l-purple-600' },
  { label: 'Class I Recalls', key: 'classI', filterKey: 'class_i', accent: 'border-l-red-600' },
  { label: 'Class II Recalls', key: 'classII', filterKey: 'class_ii', accent: 'border-l-orange-600' },
  { label: 'Class III Recalls', key: 'classIII', filterKey: 'class_iii', accent: 'border-l-yellow-600' },
  { label: 'Regulatory Pending', key: 'regulatoryPending', filterKey: 'regulatory_pending', accent: 'border-l-red-600' },
  { label: 'Recovery In Progress', key: 'recoveryInProgress', filterKey: 'recovery_in_progress', accent: 'border-l-blue-600' },
  { label: 'Average Recovery %', key: 'avgRecoveryPercent', accent: 'border-l-green-600' },
  { label: 'CAPA Linked Recalls', key: 'capaLinked', filterKey: 'capa_linked', accent: 'border-l-violet-600' },
  { label: 'Complaint Linked Recalls', key: 'complaintLinked', filterKey: 'complaint_linked', accent: 'border-l-cyan-600' },
  { label: 'Critical Recalls', key: 'critical', filterKey: 'critical', accent: 'border-l-red-700' },
  { label: 'Overdue Recalls', key: 'overdue', filterKey: 'overdue', accent: 'border-l-red-600' },
];

const PAGE_SIZE = 10;

export function RecallDashboardPage() {
  return (
    <Suspense fallback={<LoadingSkeleton rows={3} />}>
      <RecallDashboardContent />
    </Suspense>
  );
}

function RecallDashboardContent() {
  const searchParams = useSearchParams();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canExport = canExportRecallDashboard(role);
  const readOnly = isRecallDashboardReadOnly(role);
  const canCreate = role ? canCreateRecall(role) : false;
  const viewedLogged = useRef(false);

  const [filters, setFilters] = useState<RecallFilters>({});
  const [records, setRecords] = useState<RecallRecord[]>([]);
  const [metrics, setMetrics] = useState<RecallDashboardMetrics | null>(null);
  const [charts, setCharts] = useState<RecallDashboardChartData | null>(null);
  const [recentRecalls, setRecentRecalls] = useState<RecallRecord[]>([]);
  const [openRecovery, setOpenRecovery] = useState<RecallOpenRecoveryRow[]>([]);
  const [regulatoryPending, setRegulatoryPending] = useState<RecallRegulatoryPendingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeKpi, setActiveKpi] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const [trendSummary, setTrendSummary] = useState<string | null>(null);

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
    role: role || '',
    department: profile?.department || '',
  }), [user?.uid, profile?.full_name, profile?.department, role]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await fetchRecallDashboardData(filters, actor);
      setRecords(data.records);
      setMetrics(data.metrics);
      setCharts(data.charts);
      setRecentRecalls(data.recentRecalls);
      setOpenRecovery(data.openRecovery);
      setRegulatoryPending(data.regulatoryPending);
      setTablePage(1);
      setTrendSummary(await getLatestRecallTrendSummary());
      if (isRefresh) {
        await logRecallDashboardRefreshed(actor, data.records.length);
        toast.success('Dashboard refreshed');
      }
    } catch {
      setError('Failed to load recall dashboard data.');
      toast.error('Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters, actor]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!viewedLogged.current && !loading) {
      viewedLogged.current = true;
      void logRecallDashboardViewed(actor);
    }
  }, [loading, actor]);

  useEffect(() => {
    const kpi = searchParams.get('kpi');
    if (kpi && KPI_FILTER_MAP[kpi]) {
      setActiveKpi(kpi);
      setFilters((prev) => ({ ...prev, ...KPI_FILTER_MAP[kpi], kpi_filter: kpi }));
    }
  }, [searchParams]);

  const handleKpiClick = (filterKey?: string) => {
    if (!filterKey || filterKey === 'total') {
      setActiveKpi(null);
      setFilters((prev) => {
        const { kpi_filter, ...rest } = prev;
        return rest;
      });
      return;
    }
    setActiveKpi(filterKey);
    setFilters((prev) => ({ ...prev, ...KPI_FILTER_MAP[filterKey], kpi_filter: filterKey }));
    void logRecallDashboardFilterApplied(actor, { kpi_filter: filterKey });
  };

  const handleFilterChange = () => {
    void logRecallDashboardFilterApplied(actor, filters);
  };

  const handleExportPdf = async () => {
    if (!canExport || !metrics) return toast.error('No export permission');
    try {
      openRecallDashboardPdfPlaceholder(records, metrics, actor.name);
      await logRecallDashboardPdfExport(actor, records.length);
      toast.success('PDF export completed');
    } catch (e) {
      await logRecallDashboardPdfExport(actor, records.length);
      toast.error(e instanceof Error ? e.message : 'Recall dashboard PDF export is not available.');
    }
  };

  const handleExportExcel = async () => {
    if (!canExport) return toast.error('No export permission');
    exportRecallDashboardCsvDownload(records, `recall-dashboard-${Date.now()}.csv`);
    await logRecallDashboardExcelExport(actor, records.length);
    toast.success('Excel export downloaded');
  };

  const paginatedRecords = useMemo(() => {
    const start = (tablePage - 1) * PAGE_SIZE;
    return records.slice(start, start + PAGE_SIZE);
  }, [records, tablePage]);

  const totalPages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));

  const openRecord = (id: string, recallNumber: string) => {
    void logRecallRecordOpened(actor, id, recallNumber);
  };

  return (
    <RecallDashboardAccessGuard>
      <div className="space-y-6">
        <CpvPageHeader
          title="Product Recall Dashboard"
          description="Monitor recall status, recovery progress and regulatory notification"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'QMS', href: '/qms/recall' },
            { label: 'Product Recall', href: '/qms/recall' },
            { label: 'Dashboard' },
          ]}
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void load(true)}>
                <RefreshCw className={cn('mr-1 h-4 w-4', refreshing && 'animate-spin')} />Refresh
              </Button>
              {canExport && !readOnly && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handleExportPdf()}><FileText className="mr-1 h-4 w-4" />Export PDF</Button>
                  <Button variant="outline" size="sm" onClick={() => void handleExportExcel()}><Download className="mr-1 h-4 w-4" />Export Excel</Button>
                </>
              )}
              {canCreate && !readOnly && (
                <Link href="/qms/recall/create"><Button size="sm" className="bg-blue-600 hover:bg-blue-700"><Plus className="mr-1 h-4 w-4" />Initiate Recall</Button></Link>
              )}
            </div>
          )}
        />

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Filters</CardTitle></CardHeader>
          <CardContent>
            <RecallFiltersBar filters={filters} onChange={setFilters} onFilterChange={handleFilterChange} />
          </CardContent>
        </Card>

        {loading ? (
          <LoadingSkeleton rows={4} />
        ) : error ? (
          <ErrorCard title="Load error" message={error} onRetry={() => void load()} />
        ) : (
          <>
            {metrics && (
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
                {KPI_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    disabled={!item.filterKey}
                    onClick={() => item.filterKey && handleKpiClick(item.filterKey)}
                    className={cn('text-left w-full', item.filterKey && 'cursor-pointer', activeKpi === item.filterKey && 'rounded-lg ring-2 ring-blue-500')}
                  >
                    <KpiCard
                      label={item.label}
                      value={item.key === 'avgRecoveryPercent' ? `${metrics[item.key]}%` : metrics[item.key]}
                      accent={item.accent}
                    />
                  </button>
                ))}
              </div>
            )}

            {charts ? <RecallDashboardCharts charts={charts} /> : null}

            {trendSummary && (
              <Card className="border-l-4 border-l-blue-600">
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-blue-600" />
                    Recall Trend Analysis Summary
                  </CardTitle>
                  <Link href="/qms/recall/trend-analysis">
                    <Button variant="outline" size="sm">View Trend Analysis</Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{trendSummary}</p>
                </CardContent>
              </Card>
            )}

            <Tabs defaultValue="recent">
              <TabsList className="flex h-auto flex-wrap">
                <TabsTrigger value="recent">Recent Recalls</TabsTrigger>
                <TabsTrigger value="recovery">Open Recovery ({openRecovery.length})</TabsTrigger>
                <TabsTrigger value="regulatory">Regulatory Pending ({regulatoryPending.length})</TabsTrigger>
                <TabsTrigger value="register">Full Register ({records.length})</TabsTrigger>
              </TabsList>

              <TabsContent value="recent" className="mt-4">
                {recentRecalls.length ? (
                  <RecallTable rows={recentRecalls} onOpen={openRecord} />
                ) : (
                  <EmptyState title="No recent recalls" message="Recall activity will appear here once recalls are initiated." />
                )}
              </TabsContent>

              <TabsContent value="recovery" className="mt-4">
                {openRecovery.length ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Recall No</TableHead><TableHead>Product</TableHead><TableHead>Batch No</TableHead>
                          <TableHead>Distributed Qty</TableHead><TableHead>Recovered Qty</TableHead><TableHead>Recovery %</TableHead>
                          <TableHead>Responsible Person</TableHead><TableHead>Due Date</TableHead><TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {openRecovery.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-sm">{r.recall_number}</TableCell>
                            <TableCell>{r.product_name}</TableCell>
                            <TableCell>{r.batch_number}</TableCell>
                            <TableCell>{r.distributed_quantity}</TableCell>
                            <TableCell>{r.recovered_quantity}</TableCell>
                            <TableCell>{r.recovery_percent}%</TableCell>
                            <TableCell>{r.responsible_person}</TableCell>
                            <TableCell>{r.due_date}</TableCell>
                            <TableCell>
                              <Link href={`/qms/recall/${r.id}`} onClick={() => openRecord(r.id, r.recall_number)}>
                                <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState title="No open recovery" message="Active recovery tracking will appear for in-progress recalls." />
                )}
              </TabsContent>

              <TabsContent value="regulatory" className="mt-4">
                {regulatoryPending.length ? (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Recall No</TableHead><TableHead>Market</TableHead><TableHead>Classification</TableHead>
                          <TableHead>Notification Required</TableHead><TableHead>Due Date</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {regulatoryPending.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-sm">{r.recall_number}</TableCell>
                            <TableCell>{r.market_region}</TableCell>
                            <TableCell><ClassificationBadge value={r.recall_classification} /></TableCell>
                            <TableCell>{r.notification_required}</TableCell>
                            <TableCell>{r.due_date}</TableCell>
                            <TableCell>{r.status}</TableCell>
                            <TableCell>
                              <Link href={`/qms/recall/${r.id}`} onClick={() => openRecord(r.id, r.recall_number)}>
                                <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState title="No regulatory pending" message="Recalls requiring regulatory notification will appear here." />
                )}
              </TabsContent>

              <TabsContent value="register" className="mt-4 space-y-3">
                {records.length ? (
                  <>
                    <RecallTable rows={paginatedRecords} onOpen={openRecord} />
                    {totalPages > 1 && (
                      <div className="flex items-center justify-center gap-2">
                        <Button variant="outline" size="sm" disabled={tablePage <= 1} onClick={() => setTablePage((p) => p - 1)}>Previous</Button>
                        <span className="text-xs text-muted-foreground">Page {tablePage} of {totalPages}</span>
                        <Button variant="outline" size="sm" disabled={tablePage >= totalPages} onClick={() => setTablePage((p) => p + 1)}>Next</Button>
                      </div>
                    )}
                  </>
                ) : (
                  <EmptyState title="No recalls found" message="Adjust filters or initiate a new recall." />
                )}
              </TabsContent>
            </Tabs>

            {readOnly && (
              <p className="text-xs text-muted-foreground text-center">Auditor access: read-only dashboard view.</p>
            )}
          </>
        )}
      </div>
    </RecallDashboardAccessGuard>
  );
}

function RecallTable({
  rows,
  onOpen,
}: {
  rows: RecallRecord[];
  onOpen: (id: string, recallNumber: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Recall No</TableHead><TableHead>Recall Date</TableHead><TableHead>Product</TableHead>
            <TableHead>Batch No</TableHead><TableHead>Market</TableHead><TableHead>Classification</TableHead>
            <TableHead>Recovery %</TableHead><TableHead>Status</TableHead><TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-sm">{r.recall_number}</TableCell>
              <TableCell>{r.recall_date}</TableCell>
              <TableCell className="max-w-[140px] truncate">{r.product_name}</TableCell>
              <TableCell>{r.batch_number}</TableCell>
              <TableCell>{r.market_region}</TableCell>
              <TableCell><ClassificationBadge value={r.recall_classification} /></TableCell>
              <TableCell>{getRecallRecoveryPercent(r)}%</TableCell>
              <TableCell><RecallStatusBadge status={r.recall_status} /></TableCell>
              <TableCell>
                <Link href={`/qms/recall/${r.id}`} onClick={() => onOpen(r.id, r.recall_number)}>
                  <Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
