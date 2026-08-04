'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Download, Upload, Eye, Pencil, CheckCircle, Ban, PauseCircle, FilterX, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  CPV_BATCH_STATUSES,
  CPV_RELEASE_STATUSES,
  formatMonthYear,
  summarizeCpvBatches,
  toMonthYearValue,
  type CpvBatchFormData,
  type CpvBatchRecord,
} from '@/lib/cpv-batch-registration';
import { CPV_REVIEW_FREQUENCIES } from '@/lib/cpv-product-master';
import {
  fetchCpvBatches,
  fetchActiveCpvProductsForBatch,
  fetchAdminBatchesForImport,
  createCpvBatch,
  updateCpvBatch,
  changeCpvBatchStatus,
  importCpvBatchFromAdmin,
  logCpvBatchExport,
  buildCpvBatchesExportRows,
} from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { CpvBatchFormSheet } from './cpv-batch-form-sheet';
import { KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';
import type { ColumnDef } from '@/components/admin/admin-data-table';

function ReleaseBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const classes =
    normalized === 'released' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : normalized.includes('hold') ? 'border-amber-200 bg-amber-50 text-amber-700'
        : normalized === 'rejected' ? 'border-red-200 bg-red-50 text-red-700'
          : 'border-slate-200 bg-slate-50 text-slate-600';
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${classes}`}>{status}</span>;
}

export function CpvBatchListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productQuery = searchParams.get('product') || '';
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canManage = cpvPermissions.canManageCpvBatches(role);
  const canRelease = cpvPermissions.canReleaseHoldRejectBatch(role);
  const canImportExport = cpvPermissions.canImportExportCpvBatches(role);
  const isReadOnly = cpvPermissions.isReadOnly(role);

  const [batches, setBatches] = useState<CpvBatchRecord[]>([]);
  const [cpvProducts, setCpvProducts] = useState<CpvProductRecord[]>([]);
  const [adminBatches, setAdminBatches] = useState<Awaited<ReturnType<typeof fetchAdminBatchesForImport>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CpvBatchRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ batch: CpvBatchRecord; action: 'release' | 'reject' | 'hold' } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importBatchId, setImportBatchId] = useState('');
  const [importProductId, setImportProductId] = useState('');
  const [importReason, setImportReason] = useState('Import from Admin Batch Master');

  const [search, setSearch] = useState(productQuery);
  const [statusFilter, setStatusFilter] = useState('all');
  const [releaseFilter, setReleaseFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const actor = { id: user?.uid || 'system', name: profile?.full_name || 'System' };

  useEffect(() => {
    if (productQuery) setSearch(productQuery);
  }, [productQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, products, admin] = await Promise.all([
        fetchCpvBatches(),
        fetchActiveCpvProductsForBatch(),
        fetchAdminBatchesForImport(),
      ]);
      setBatches(rows);
      setCpvProducts(products);
      setAdminBatches(admin);
    } catch {
      setError('Failed to load CPV batches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sites = useMemo(
    () => Array.from(new Set(batches.map((b) => b.manufacturingSite).filter(Boolean))).sort(),
    [batches],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return batches.filter((b) => {
      if (statusFilter !== 'all' && b.batchStatus !== statusFilter) return false;
      if (releaseFilter !== 'all' && b.releaseStatus !== releaseFilter) return false;
      if (periodFilter !== 'all' && b.cpvReviewPeriod !== periodFilter) return false;
      if (siteFilter !== 'all' && b.manufacturingSite !== siteFilter) return false;
      if (dateFrom && toMonthYearValue(b.manufacturingDate) < dateFrom) return false;
      if (dateTo && toMonthYearValue(b.manufacturingDate) > dateTo) return false;
      if (!q) return true;
      return (
        b.batchNumber.toLowerCase().includes(q)
        || b.productName.toLowerCase().includes(q)
        || b.productCode.toLowerCase().includes(q)
        || b.customerName.toLowerCase().includes(q)
        || (b.cpvBatchId || '').toLowerCase().includes(q)
        || (b.manufacturingOrderNumber || '').toLowerCase().includes(q)
        || (b.workOrderNumber || '').toLowerCase().includes(q)
        || (b.manufacturingSite || '').toLowerCase().includes(q)
      );
    });
  }, [batches, search, statusFilter, releaseFilter, periodFilter, siteFilter, dateFrom, dateTo]);

  const summary = useMemo(() => summarizeCpvBatches(batches), [batches]);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setReleaseFilter('all');
    setPeriodFilter('all');
    setSiteFilter('all');
    setDateFrom('');
    setDateTo('');
  };
  const handleSave = async (data: CpvBatchFormData) => {
    setSubmitting(true);
    try {
      if (editing?.id) {
        const { error: err } = await updateCpvBatch(editing.id, data, actor, editing);
        if (err) { toast.error(err); return; }
        toast.success('Batch updated');
      } else {
        const { error: err } = await createCpvBatch(data, actor);
        if (err) { toast.error(err); return; }
        toast.success('Batch registered');
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusAction = async () => {
    if (!actionTarget) return;
    if (actionReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignOpen(true);
  };

  const applyStatusChange = async () => {
    if (!actionTarget) return;
    const { batch, action } = actionTarget;
    const statusMap = { release: 'Released', reject: 'Rejected', hold: 'Hold' } as const;
    setSubmitting(true);
    const { error: err } = await changeCpvBatchStatus(
      batch.id,
      statusMap[action],
      actor,
      batch,
      actionReason,
      { esignConfirmed: true },
    );
    setSubmitting(false);
    setEsignOpen(false);
    setActionTarget(null);
    setActionReason('');
    if (err) toast.error(err);
    else toast.success(`Batch ${statusMap[action].toLowerCase()}`);
    await load();
  };

  const handleImport = async () => {
    if (!importBatchId || !importProductId) {
      toast.error('Select admin batch and CPV product');
      return;
    }
    if (importReason.trim().length < 5) {
      toast.error('Import reason must be at least 5 characters');
      return;
    }
    setSubmitting(true);
    const { error: err } = await importCpvBatchFromAdmin(importBatchId, importProductId, actor, importReason);
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('Batch imported as Planned — advance workflow after review');
      setImportOpen(false);
      await load();
    }
  };

  const handleExport = async () => {
    const { headers, rows } = buildCpvBatchesExportRows(filtered);
    downloadCsv(`cpv-batches-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    await logCpvBatchExport(actor, filtered.length, 'CSV');
    toast.success(`Exported ${filtered.length} CPV batches`);
  };
  const columns: ColumnDef<CpvBatchRecord>[] = [
    { key: 'cpvBatchId', header: 'CPV Batch ID' },
    { key: 'batchNumber', header: 'Batch No' },
    { key: 'productName', header: 'Product' },
    { key: 'manufacturingDate', header: 'Mfg Date', render: (r) => formatMonthYear(r.manufacturingDate) },
    { key: 'expiryDate', header: 'Expiry', render: (r) => formatMonthYear(r.expiryDate) },
    { key: 'batchStatus', header: 'Status', render: (r) => <StatusBadge status={r.batchStatus} /> },
    { key: 'releaseStatus', header: 'Release', render: (r) => <ReleaseBadge status={r.releaseStatus} /> },
    { key: 'cpvReviewPeriod', header: 'Review Period' },
  ];

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <CpvPageHeader title="CPV Batch Registration" description="Register and manage batches under Continued Process Verification" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  if (error) {
    return <div className="p-4 sm:p-6"><ErrorCard message={error} onRetry={load} /></div>;
  }

  return (
    <div id="cpv-batch-registration-root" className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title="CPV Batch Registration"
        description="Register and manage batches under Continued Process Verification"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Batch Registration' },
        ]}
        actions={
          <>
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" />Import
              </Button>
            )}
            {canImportExport && (
              <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => void handleExport()}>
                <Download className="h-4 w-4" />Export
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-2 no-print" onClick={() => printPage()}>
              <Printer className="h-4 w-4" />Print
            </Button>
            {canManage && !isReadOnly && (
              <Button size="sm" className="gap-2 no-print" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4" />Register Batch
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-9">
        <KpiCard label="Total Batches" value={summary.total} tone="blue" />
        <KpiCard label="Planned" value={summary.planned} tone="blue" />
        <KpiCard label="Manufacturing" value={summary.manufacturing} tone="amber" />
        <KpiCard label="QC Testing" value={summary.qcTesting} tone="amber" />
        <KpiCard label="QA Review" value={summary.qaReview} tone="amber" />
        <KpiCard label="Released" value={summary.released} tone="green" />
        <KpiCard label="Rejected" value={summary.rejected} tone="red" />
        <KpiCard label="Hold" value={summary.hold} tone="red" />
        <KpiCard label="Due For Review" value={summary.dueForReview} tone="amber" />
      </div>

      <Card className="no-print">
        <CardContent className="p-4 space-y-4">
          <div className="grid gap-3 lg:grid-cols-7">
            <div className="lg:col-span-2">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <Input className="mt-1" placeholder="Batch, product, MO/WO, site, customer..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Batch Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {CPV_BATCH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Release Status</Label>
              <Select value={releaseFilter} onValueChange={setReleaseFilter}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {CPV_RELEASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Site</Label>
              <Select value={siteFilter} onValueChange={setSiteFilter}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Review Period</Label>
              <Select value={periodFilter} onValueChange={setPeriodFilter}>
                <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {CPV_REVIEW_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <div className="grid flex-1 grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Mfg From</Label>
                  <Input type="month" className="mt-1 h-9" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Mfg To</Label>
                  <Input type="month" className="mt-1 h-9" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
                <FilterX className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No batches" message="Register a CPV batch or import from Admin Batch Master." />
          ) : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              onRowClick={(row) => router.push(`/cpv/batch-registration/${row.id}`)}
              pageSize={10}
              statusKey="batchStatus"
              mobileTitleKey="batchNumber"
              mobileSubtitleKey="productName"
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/batch-registration/${row.id}`)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  {canManage && !isReadOnly && (
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(row); setFormOpen(true); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canRelease && !isReadOnly && row.batchStatus !== 'Released' && (
                    <Button size="icon" variant="ghost" onClick={() => setActionTarget({ batch: row, action: 'release' })}>
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                    </Button>
                  )}
                  {canRelease && !isReadOnly && (
                    <Button size="icon" variant="ghost" onClick={() => setActionTarget({ batch: row, action: 'hold' })}>
                      <PauseCircle className="h-4 w-4 text-amber-600" />
                    </Button>
                  )}
                  {canRelease && !isReadOnly && (
                    <Button size="icon" variant="ghost" onClick={() => setActionTarget({ batch: row, action: 'reject' })}>
                      <Ban className="h-4 w-4 text-red-600" />
                    </Button>
                  )}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <CpvBatchFormSheet
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditing(null); }}
        editing={editing}
        cpvProducts={cpvProducts}
        onSubmit={handleSave}
        submitting={submitting}
      />

      <Dialog open={Boolean(actionTarget) && !esignOpen} onOpenChange={(v) => { if (!v) { setActionTarget(null); setActionReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionTarget?.action === 'release' ? 'Release batch?' : actionTarget?.action === 'reject' ? 'Reject batch?' : 'Hold batch?'}
            </DialogTitle>
            <DialogDescription>
              Electronic signature is required. Workflow transitions are validated on the server.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label>Change Reason *</Label>
            <Textarea
              className="mt-1"
              rows={3}
              placeholder="Enter reason (min 5 characters)..."
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionTarget(null); setActionReason(''); }}>Cancel</Button>
            <Button
              variant={actionTarget?.action === 'reject' ? 'destructive' : 'default'}
              disabled={submitting}
              onClick={() => void handleStatusAction()}
            >
              Continue to E-Sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={(v) => { setEsignOpen(v); if (!v) setSubmitting(false); }}
        moduleName="CPV Batch Registration"
        recordId={actionTarget?.batch.id || 'cpv-batch'}
        documentNumber={actionTarget?.batch.cpvBatchId}
        actionType={
          actionTarget?.action === 'release' ? 'Release'
            : actionTarget?.action === 'reject' ? 'Reject'
              : 'Hold'
        }
        onSuccess={() => { void applyStatusChange(); }}
        onCancel={() => setEsignOpen(false)}
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Import from Admin Batch Master</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Admin Batch</Label>
              <Select value={importBatchId} onValueChange={setImportBatchId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select batch" /></SelectTrigger>
                <SelectContent>
                  {adminBatches.map((b) => (
                    <SelectItem key={b.id} value={b.id || ''}>{b.batchNumber} — {b.productName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CPV Product</Label>
              <Select value={importProductId} onValueChange={setImportProductId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select CPV product" /></SelectTrigger>
                <SelectContent>
                  {cpvProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.productCode} — {p.productName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Change Reason *</Label>
              <Textarea className="mt-1" rows={2} value={importReason} onChange={(e) => setImportReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleImport()} disabled={submitting}>Import as Planned</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
