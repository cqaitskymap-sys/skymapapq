'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, Download, Eye, FileSpreadsheet, Link2, Loader2,
  Pencil, Plus, RefreshCw, Save, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase';
import {
  BATCH_REVIEW_STATUSES, BATCH_RELEASE_STATUSES,
  PQR_SECTION_FLOW, canAddBatchReview, canExportBatchReview, canManageBatchReview,
  computeBatchSummary, filterBatchReviewRecords, pqrSectionHref,
  type BatchReviewFormData, type PqrBatchReviewRecord, type PqrOption,
} from '@/lib/pqr-batch-review-records';
import {
  buildBatchCharts, createBatchReviewRecord, exportBatchReviewCsv,
  fetchBatchReviewRecords, fetchPqrById, fetchPqrOptions, getBatchReviewNarrative,
  logBatchReviewExport, logBatchReviewNarrativeEdit, logBatchReviewView,
  pullBatchesFromMaster, refreshLinkedCountsForPqr, saveBatchSectionToPqr,
  softDeleteBatchReviewRecord, updateBatchReviewRecord,
} from '@/lib/pqr-batch-review-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { BatchReviewAccessGuard } from './batch-review-access-guard';
import { BatchReviewFormDialog } from './batch-review-form-dialog';
import { BatchStatusBadge, ReleaseStatusBadge } from './batch-review-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type { ColumnDef } from '@/components/admin/admin-data-table';

const CHART_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#64748b'];

function SafeChart({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="h-52">
        {empty ? <EmptyState title="No data" message="No chart data for current filters." /> : children}
      </CardContent>
    </Card>
  );
}

function formatYield(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'Data Not Available';
  return `${value}%`;
}

export function BatchReviewPage() {
  const { user, profile } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = profile?.role;
  const canAdd = canAddBatchReview(role);
  const canManage = canManageBatchReview(role);
  const canExport = canExportBatchReview(role);

  const [pqrs, setPqrs] = useState<PqrOption[]>([]);
  const [selectedPqrId, setSelectedPqrId] = useState('');
  const [records, setRecords] = useState<PqrBatchReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editRecord, setEditRecord] = useState<PqrBatchReviewRecord | null>(null);
  const [detailRecord, setDetailRecord] = useState<PqrBatchReviewRecord | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRelease, setFilterRelease] = useState('all');
  const [filterMfgFrom, setFilterMfgFrom] = useState('');
  const [filterMfgTo, setFilterMfgTo] = useState('');
  const [filterManufacturedFor, setFilterManufacturedFor] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
  }), [user?.uid, profile?.full_name, profile?.email, role]);

  const selectedPqr = useMemo(
    () => pqrs.find((p) => p.id === selectedPqrId) || null,
    [pqrs, selectedPqrId],
  );

  const syncPqrIdToUrl = useCallback((pqrId: string) => {
    if (!pqrId) return;
    const params = new URLSearchParams(searchParams?.toString() || '');
    if (params.get('pqrId') === pqrId) return;
    params.set('pqrId', pqrId);
    router.replace(`/pqr/batches?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const loadPqrs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!isFirebaseConfigured()) {
        setError('Firebase is not configured.');
        return;
      }
      const opts = await fetchPqrOptions();
      setPqrs(opts);
      const fromUrl = searchParams?.get('pqrId') || '';
      let nextId = selectedPqrId;
      if (fromUrl && opts.some((p) => p.id === fromUrl)) {
        nextId = fromUrl;
      } else if (fromUrl && !opts.some((p) => p.id === fromUrl)) {
        const direct = await fetchPqrById(fromUrl);
        if (direct) {
          setPqrs((prev) => (prev.some((p) => p.id === direct.id) ? prev : [direct, ...prev]));
          nextId = direct.id;
        }
      } else if (!nextId && opts.length) {
        nextId = opts[0].id;
      }
      if (nextId) {
        setSelectedPqrId(nextId);
        syncPqrIdToUrl(nextId);
      }
    } catch {
      setError('Failed to load PQR records.');
    } finally {
      setLoading(false);
    }
  }, [searchParams, selectedPqrId, syncPqrIdToUrl]);

  const loadRecords = useCallback(async (pqrId: string, pqr?: PqrOption | null) => {
    if (!pqrId) return;
    setBusy(true);
    try {
      const rows = await fetchBatchReviewRecords(pqrId, { hydrate: true, pqr: pqr || null });
      setRecords(rows);
      setNarrative(getBatchReviewNarrative(rows));
      setNarrativeDirty(false);
    } catch {
      toast.error('Failed to load batch review records');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void loadPqrs(); void logBatchReviewView(actor); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedPqrId) {
      void loadRecords(selectedPqrId, selectedPqr);
      syncPqrIdToUrl(selectedPqrId);
    }
  }, [selectedPqrId]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => filterBatchReviewRecords(records, {
    batchStatus: filterStatus,
    releaseStatus: filterRelease,
    manufacturedFor: filterManufacturedFor,
    mfgDateFrom: filterMfgFrom,
    mfgDateTo: filterMfgTo,
    search: filterSearch,
  }), [records, filterStatus, filterRelease, filterManufacturedFor, filterMfgFrom, filterMfgTo, filterSearch]);

  const summary = useMemo(() => computeBatchSummary(filtered), [filtered]);
  const charts = useMemo(() => buildBatchCharts(filtered), [filtered]);

  const resetFilters = () => {
    setFilterStatus('all');
    setFilterRelease('all');
    setFilterMfgFrom('');
    setFilterMfgTo('');
    setFilterManufacturedFor('');
    setFilterSearch('');
  };

  const handlePull = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { created, skipped, error: err } = await pullBatchesFromMaster(selectedPqr, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`${created} batch(es) pulled (${skipped} already linked)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleRefreshLinks = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { updated, error: err } = await refreshLinkedCountsForPqr(selectedPqr.id, actor);
    setBusy(false);
    if (err) return toast.error(err);
    toast.success(`Refreshed linked counts for ${updated} batch(es)`);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveForm = async (data: BatchReviewFormData): Promise<void> => {
    if (!selectedPqr) return;
    setBusy(true);
    const result = editRecord?.id
      ? await updateBatchReviewRecord(editRecord.id, selectedPqr, data, actor)
      : await createBatchReviewRecord(selectedPqr, data, actor);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(editRecord ? 'Batch updated' : 'Batch added');
    setFormOpen(false);
    setEditRecord(null);
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const handleSaveSection = async () => {
    if (!selectedPqr) return;
    setBusy(true);
    const { error: err } = await saveBatchSectionToPqr(selectedPqr.id, narrative, records, actor);
    setBusy(false);
    if (err) return toast.error(err);
    setNarrativeDirty(false);
    toast.success('Batch section saved to PQR');
  };

  const handleDelete = async (): Promise<void> => {
    if (!deleteId || !selectedPqr) return;
    setBusy(true);
    const { error: err } = await softDeleteBatchReviewRecord(deleteId, actor);
    setBusy(false);
    setDeleteId(null);
    if (err) {
      toast.error(err);
      return;
    }
    toast.success('Batch record removed');
    await loadRecords(selectedPqr.id, selectedPqr);
  };

  const exportCsv = () => {
    if (!filtered.length) return toast.info('No batch records to export');
    exportBatchReviewCsv(filtered, selectedPqr?.pqrNumber);
    void logBatchReviewExport(actor, 'csv');
    toast.success('Batch review exported as CSV');
  };

  const pqrTableColumns: ColumnDef<PqrBatchReviewRecord & { srNo: number }>[] = [
    { key: 'srNo', header: 'Sr. No.' },
    { key: 'batchNumber', header: 'Batch No.' },
    { key: 'semiFinishedBatchNumber', header: 'Semi Finish Batch No.', render: (r) => r.semiFinishedBatchNumber || '—' },
    { key: 'finishedProductBatchNumber', header: 'Finished Product Batch No.', render: (r) => r.finishedProductBatchNumber || '—' },
    { key: 'manufacturingDate', header: 'MFG Date', render: (r) => r.manufacturingDate || '—' },
    { key: 'expiryDate', header: 'EXP Date', render: (r) => r.expiryDate || '—' },
    { key: 'batchSize', header: 'Batch Size', render: (r) => r.batchSize ? `${r.batchSize} ${r.batchSizeUnit}` : '—' },
    { key: 'yieldPct', header: 'Yield %', render: (r) => formatYield(r.yieldPct) },
    { key: 'manufacturedFor', header: 'Manufactured For', render: (r) => r.manufacturedFor || r.customerName || '—' },
    { key: 'batchStatus', header: 'Status', render: (r) => <BatchStatusBadge status={r.batchStatus} /> },
    { key: 'releaseStatus', header: 'Release', render: (r) => <ReleaseStatusBadge status={r.releaseStatus} /> },
    {
      key: 'linkedDeviationCount',
      header: 'Dev / OOS / CAPA',
      render: (r) => (
        <span className="text-xs whitespace-nowrap">
          {r.linkedDeviationCount || 0} / {r.linkedOosCount || 0} / {r.linkedCapaCount || 0}
        </span>
      ),
    },
    { key: 'remarks', header: 'Remarks', render: (r) => <span className="line-clamp-1 max-w-[120px]">{r.remarks || '—'}</span> },
    {
      key: 'actions', header: 'Action',
      render: (r) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" aria-label={`View ${r.batchNumber}`} onClick={() => setDetailRecord(r)}>
            <Eye className="h-4 w-4" />
          </Button>
          {canManage && (
            <>
              <Button variant="ghost" size="icon" aria-label={`Edit ${r.batchNumber}`} onClick={() => { setEditRecord(r); setFormOpen(true); }}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Remove ${r.batchNumber}`} onClick={() => setDeleteId(r.id || null)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const tableData = filtered.map((r, i) => ({ ...r, srNo: i + 1 }));

  const sectionNav = useMemo(() => {
    const idx = PQR_SECTION_FLOW.findIndex((s) => s.key === 'batches');
    const prev = PQR_SECTION_FLOW[idx - 1];
    const next = PQR_SECTION_FLOW[idx + 1];
    return {
      prev: prev ? { ...prev, href: pqrSectionHref(prev.href, selectedPqrId) } : null,
      next: next ? { ...next, href: pqrSectionHref(next.href, selectedPqrId) } : null,
    };
  }, [selectedPqrId]);

  if (loading) {
    return (
      <BatchReviewAccessGuard>
        <div className="p-4 sm:p-6"><LoadingSkeleton rows={3} /></div>
      </BatchReviewAccessGuard>
    );
  }

  if (error) {
    return (
      <BatchReviewAccessGuard>
        <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={() => void loadPqrs()} /></div>
      </BatchReviewAccessGuard>
    );
  }

  return (
    <BatchReviewAccessGuard>
      <div className="space-y-6 p-4 sm:p-6">
        <CpvPageHeader
          title="Batch Review"
          description="Review manufactured batches for the selected Annual PQR using Batch Master and linked QMS records"
          trail={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'PQR Management', href: '/pqr/dashboard' },
            { label: 'Batch Review' },
          ]}
          actions={(
            <>
              {canExport && (
                <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
                  <FileSpreadsheet className="h-4 w-4 mr-1" />Export CSV
                </Button>
              )}
              {canManage && selectedPqr && (
                <>
                  <Button variant="outline" size="sm" onClick={() => void handleRefreshLinks()} disabled={busy}>
                    <Link2 className="h-4 w-4 mr-1" />Refresh Links
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void handlePull()} disabled={busy}>
                    {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
                    Pull from Master
                  </Button>
                </>
              )}
              {canAdd && selectedPqr && (
                <Button size="sm" onClick={() => { setEditRecord(null); setFormOpen(true); }}>
                  <Plus className="h-4 w-4 mr-1" />Add Batch
                </Button>
              )}
            </>
          )}
        />

        <div className="flex flex-wrap gap-2 text-sm">
          {PQR_SECTION_FLOW.filter((s) => !['dashboard', 'create'].includes(s.key)).map((s) => (
            <Link
              key={s.key}
              href={pqrSectionHref(s.href, selectedPqrId)}
              className={`rounded-md border px-2.5 py-1 ${s.key === 'batches' ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50'}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="pqr-select">PQR Number *</Label>
                <Select
                  value={selectedPqrId}
                  onValueChange={(id) => {
                    setSelectedPqrId(id);
                    syncPqrIdToUrl(id);
                  }}
                >
                  <SelectTrigger id="pqr-select"><SelectValue placeholder="Select PQR..." /></SelectTrigger>
                  <SelectContent>
                    {pqrs.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.pqrNumber} — {p.productName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedPqr && (
                <>
                  <div>
                    <Label className="text-muted-foreground">Product / Code</Label>
                    <p className="text-sm font-medium">{selectedPqr.productName}</p>
                    <p className="text-xs text-muted-foreground">{selectedPqr.productCode}</p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">Review Period</Label>
                    <p className="text-sm font-medium">{selectedPqr.reviewPeriodFrom || '—'} — {selectedPqr.reviewPeriodTo || '—'}</p>
                    {(selectedPqr.reviewYear || selectedPqr.site) && (
                      <p className="text-xs text-muted-foreground">
                        {[selectedPqr.reviewYear ? `Year ${selectedPqr.reviewYear}` : null, selectedPqr.site].filter(Boolean).join(' · ')}
                      </p>
                    )}
                  </div>
                  {(selectedPqr.strength || selectedPqr.dosageForm) && (
                    <div>
                      <Label className="text-muted-foreground">Strength / Dosage Form</Label>
                      <p className="text-sm font-medium">{[selectedPqr.strength, selectedPqr.dosageForm].filter(Boolean).join(' / ')}</p>
                    </div>
                  )}
                  {selectedPqr.status && (
                    <div>
                      <Label className="text-muted-foreground">PQR Status</Label>
                      <p className="text-sm font-medium capitalize">{selectedPqr.status.replace(/_/g, ' ')}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {!selectedPqr ? (
          <EmptyState title="Select a PQR" message="Choose a PQR record to review batches for the annual review period." />
        ) : (
          <>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-10">
              <KpiCard label="Total Batches" value={summary.totalBatches} />
              <KpiCard label="Released" value={summary.releasedBatches} tone="green" />
              <KpiCard label="Rejected" value={summary.rejectedBatches} tone="red" />
              <KpiCard label="Hold" value={summary.holdBatches} tone="amber" />
              <KpiCard label="Reworked" value={summary.reworkedBatches} />
              <KpiCard label="Reprocessed" value={summary.reprocessedBatches} />
              <KpiCard label="Release %" value={`${summary.releasePct}%`} tone="green" />
              <KpiCard label="Rejection %" value={`${summary.rejectionPct}%`} tone={summary.rejectionPct > 0 ? 'red' : 'green'} />
              <KpiCard label="Dev / OOS / CAPA" value={`${summary.totalDeviations}/${summary.totalOos}/${summary.totalCapa}`} />
              <KpiCard
                label="Avg Yield %"
                value={summary.avgYieldPct != null ? `${summary.avgYieldPct}%` : 'N/A'}
                tone={summary.avgYieldPct != null ? 'green' : undefined}
              />
            </div>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Search batch / product / remarks"
                    className="w-full sm:w-[220px]"
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    aria-label="Search batches"
                  />
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[160px]" aria-label="Filter batch status"><SelectValue placeholder="Batch Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {BATCH_REVIEW_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={filterRelease} onValueChange={setFilterRelease}>
                    <SelectTrigger className="w-[160px]" aria-label="Filter release status"><SelectValue placeholder="Release Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Release</SelectItem>
                      {BATCH_RELEASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Manufactured For" className="w-[160px]" value={filterManufacturedFor} onChange={(e) => setFilterManufacturedFor(e.target.value)} />
                  <Input type="date" aria-label="Manufacturing date from" value={filterMfgFrom} onChange={(e) => setFilterMfgFrom(e.target.value)} />
                  <Input type="date" aria-label="Manufacturing date to" value={filterMfgTo} onChange={(e) => setFilterMfgTo(e.target.value)} />
                  <Button variant="outline" size="sm" onClick={resetFilters}>Reset</Button>
                  <Button variant="outline" size="icon" aria-label="Reload records" onClick={() => selectedPqrId && void loadRecords(selectedPqrId, selectedPqr)} disabled={busy}>
                    <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">PQR Batch Review Table</CardTitle></CardHeader>
              <CardContent className="overflow-x-auto">
                {tableData.length ? (
                  <ResponsiveDataTable
                    columns={pqrTableColumns}
                    data={tableData}
                    searchKeys={['batchNumber', 'manufacturedFor', 'customerName', 'remarks', 'productCode']}
                    mobileTitleKey="batchNumber"
                    mobileSubtitleKey="manufacturingDate"
                    pageSize={15}
                  />
                ) : (
                  <EmptyState title="No batch records" message="Pull eligible batches from Batch Master for this PQR product and period, or add manually." />
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <SafeChart title="Batch Status Distribution" empty={!charts.statusDistribution.length}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={charts.statusDistribution} dataKey="value" nameKey="name" outerRadius={70} label>
                      {charts.statusDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </SafeChart>
              <SafeChart title="Monthly Batch Manufacturing Trend" empty={!charts.monthlyManufacturing.length}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={charts.monthlyManufacturing}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="#2563eb" />
                  </LineChart>
                </ResponsiveContainer>
              </SafeChart>
              <SafeChart title="Released vs Rejected Trend" empty={!charts.releaseRejectTrend.length}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.releaseRejectTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="released" fill="#059669" name="Released" />
                    <Bar dataKey="rejected" fill="#dc2626" name="Rejected" />
                  </BarChart>
                </ResponsiveContainer>
              </SafeChart>
              <SafeChart title="Product / Manufactured-For Trend" empty={!charts.manufacturedForTrend.length && !charts.productTrend.length}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={charts.productTrend.length ? charts.productTrend.map((p) => ({ name: p.product, count: p.count })) : charts.manufacturedForTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </SafeChart>
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">PQR Section Narrative — Batch Manufacturing Details</CardTitle>
                {canManage && (
                  <Button size="sm" onClick={() => void handleSaveSection()} disabled={busy || !narrativeDirty}>
                    <Save className="h-4 w-4 mr-1" />Save to PQR
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                <Textarea
                  className="min-h-[120px]"
                  value={narrative}
                  readOnly={!canManage}
                  aria-label="Batch manufacturing narrative"
                  onChange={(e) => {
                    setNarrative(e.target.value);
                    setNarrativeDirty(true);
                    if (selectedPqr) logBatchReviewNarrativeEdit(actor, selectedPqr.id);
                  }}
                />
                {narrativeDirty && <p className="mt-2 text-xs text-amber-700">Unsaved narrative changes</p>}
              </CardContent>
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              {sectionNav.prev ? (
                <Button variant="outline" asChild>
                  <Link href={sectionNav.prev.href}><ArrowLeft className="h-4 w-4 mr-1" />{sectionNav.prev.label}</Link>
                </Button>
              ) : <span />}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild><Link href="/pqr/dashboard">PQR Dashboard</Link></Button>
                <Button variant="outline" asChild><Link href="/qms/deviation">Deviations</Link></Button>
                <Button variant="outline" asChild><Link href="/qms/oos">OOS</Link></Button>
                <Button variant="outline" asChild><Link href="/qms/capa">CAPA</Link></Button>
                <Button variant="outline" asChild><Link href="/cpv/dashboard">CPV</Link></Button>
              </div>
              {sectionNav.next ? (
                <Button asChild>
                  <Link href={sectionNav.next.href}>{sectionNav.next.label}<ArrowRight className="h-4 w-4 ml-1" /></Link>
                </Button>
              ) : <span />}
            </div>
          </>
        )}

        {selectedPqr && (
          <BatchReviewFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            pqr={selectedPqr}
            record={editRecord}
            onSubmit={handleSaveForm}
            loading={busy}
          />
        )}

        <Dialog open={!!detailRecord} onOpenChange={() => setDetailRecord(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Batch Detail — {detailRecord?.batchNumber}</DialogTitle></DialogHeader>
            {detailRecord && (
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[
                    ['PQR Number', detailRecord.pqrNumber || selectedPqr?.pqrNumber],
                    ['Product', detailRecord.product],
                    ['Product Code', detailRecord.productCode],
                    ['Strength', detailRecord.strength || '—'],
                    ['Dosage Form', detailRecord.dosageForm || '—'],
                    ['Batch No.', detailRecord.batchNumber],
                    ['MFG Date', detailRecord.manufacturingDate || '—'],
                    ['EXP Date', detailRecord.expiryDate || '—'],
                    ['Batch Size', detailRecord.batchSize ? `${detailRecord.batchSize} ${detailRecord.batchSizeUnit}` : '—'],
                    ['Status', detailRecord.batchStatus],
                    ['Release', detailRecord.releaseStatus],
                    ['Theoretical Yield', detailRecord.theoreticalYield ?? 'Data Not Available'],
                    ['Actual Yield', detailRecord.actualYield ?? 'Data Not Available'],
                    ['Yield %', formatYield(detailRecord.yieldPct)],
                    ['Deviations', detailRecord.linkedDeviationCount],
                    ['OOS', detailRecord.linkedOosCount],
                    ['CAPA', detailRecord.linkedCapaCount],
                    ['Complaints', detailRecord.linkedComplaintCount ?? 0],
                    ['Change Controls', detailRecord.linkedChangeControlCount ?? 0],
                    ['Source', detailRecord.sourceType || 'manual'],
                  ].map(([k, v]) => (
                    <div key={String(k)}><dt className="text-muted-foreground">{k}</dt><dd className="font-medium">{String(v)}</dd></div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <BatchStatusBadge status={detailRecord.batchStatus} />
                  <ReleaseStatusBadge status={detailRecord.releaseStatus} />
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/qms/deviation?batch=${encodeURIComponent(detailRecord.batchNumber)}`}>Open Deviations</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/qms/oos?batch=${encodeURIComponent(detailRecord.batchNumber)}`}>Open OOS</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`/qms/capa?batch=${encodeURIComponent(detailRecord.batchNumber)}`}>Open CAPA</Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/cpv/dashboard">Open CPV</Link>
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={() => setDeleteId(null)}
          title="Remove Batch Record"
          description="This will soft-delete the batch review record. Continue?"
          confirmLabel="Remove"
          destructive
          loading={busy}
          onConfirm={handleDelete}
        />
      </div>
    </BatchReviewAccessGuard>
  );
}
