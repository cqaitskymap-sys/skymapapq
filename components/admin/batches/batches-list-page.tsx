'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, Upload, CheckCircle, XCircle, PauseCircle,
  Trash2, RotateCcw, Archive, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { BatchStatusBadge } from './batch-status-badge';
import { ReleaseStatusBadge } from './release-status-badge';
import { BatchLifecycleBadge } from './batch-lifecycle-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  canEditBatches, canImportBatches, canReleaseBatches, canProductionCreateBatches,
} from '@/lib/permissions';
import { BATCH_STATUSES, RELEASE_STATUSES } from '@/lib/admin/constants';
import type { AdminBatch } from '@/lib/admin/schemas';
import { subscribeToProducts } from '@/lib/admin/product-service';
import {
  subscribeToBatches, getBatchSummaryCounts, setBatchStatusAction,
  exportBatchesCsv, logBatchExport, importBatchesFromFile,
  deleteBatch, restoreBatch, bulkUpdateBatches, bulkDeleteBatches,
  buildBatchLifecycleDashboard, canDeleteBatchRecord,
} from '@/lib/admin/batch-service';

const PAGE_SIZE = 10;

type StatusAction = { batch: AdminBatch; action: 'release' | 'reject' | 'hold' | 'close' | 'archive' } | null;

export function BatchesListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditBatches(role);
  const canCreate = canProductionCreateBatches(role);
  const canImport = canImportBatches(role);
  const canRelease = canReleaseBatches(role);

  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [productOptions, setProductOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [releaseFilter, setReleaseFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [statusAction, setStatusAction] = useState<StatusAction>(null);
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AdminBatch | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<AdminBatch | null>(null);
  const [bulkAction, setBulkAction] = useState<'hold' | 'close' | 'archive' | 'delete' | null>(null);
  const [changeReason, setChangeReason] = useState('');

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  useEffect(() => {
    setLoading(true);
    const unsubBatches = subscribeToBatches(
      showDeleted,
      (next) => {
        setBatches(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    const unsubProducts = subscribeToProducts(false, (products) => {
      setProductOptions(Array.from(new Set(products.map((p) => p.productCode).filter(Boolean))));
    });
    return () => {
      unsubBatches();
      unsubProducts();
    };
  }, [showDeleted]);

  const lifecycleDashboard = useMemo(() => buildBatchLifecycleDashboard(batches), [batches]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return batches.filter((b) => {
      const matchSearch = !q ||
        b.batchNumber?.toLowerCase().includes(q) ||
        b.batchCode?.toLowerCase().includes(q) ||
        b.productCode?.toLowerCase().includes(q) ||
        b.productName?.toLowerCase().includes(q) ||
        b.customerName?.toLowerCase().includes(q);
      const matchProduct = productFilter === 'all' || b.productCode === productFilter;
      const matchStatus = statusFilter === 'all' || b.batchStatus === statusFilter;
      const matchRelease = releaseFilter === 'all' || b.releaseStatus === releaseFilter;
      const mfg = b.manufacturingDate || '';
      const matchFrom = !dateFrom || mfg >= dateFrom;
      const matchTo = !dateTo || mfg <= dateTo;
      return matchSearch && matchProduct && matchStatus && matchRelease && matchFrom && matchTo;
    });
  }, [batches, search, productFilter, statusFilter, releaseFilter, dateFrom, dateTo]);

  const stats = getBatchSummaryCounts(batches);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleExport = async () => {
    const csv = exportBatchesCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `batches-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logBatchExport(auditMeta, filtered.length);
    toast.success('Batch list exported');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importBatchesFromFile(file, auditMeta);
    if (result.imported) toast.success(`Imported ${result.imported} batch(es)`);
    if (result.errors.length) toast.warning(`${result.errors.length} row(s) failed`);
    e.target.value = '';
  };

  const runStatusAction = async () => {
    if (!statusAction?.batch.id) return;
    if (actionReason.trim().length < 5) {
      toast.error('Reason is required (min 5 characters)');
      return;
    }
    setActionLoading(true);
    const result = await setBatchStatusAction(
      statusAction.batch.id,
      statusAction.batch,
      statusAction.action,
      actionReason,
      auditMeta,
    );
    setActionLoading(false);
    if (result.success) {
      toast.success(`Batch ${statusAction.action}d successfully`);
      setStatusAction(null);
      setActionReason('');
    } else toast.error(result.error || 'Action failed');
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionLoading(true);
    const result = await deleteBatch(deleteConfirm.id, deleteConfirm, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Batch soft-deleted');
      setDeleteConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Delete failed');
  };

  const runRestore = async () => {
    if (!restoreConfirm?.id || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionLoading(true);
    const result = await restoreBatch(restoreConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Batch restored');
      setRestoreConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Restore failed');
  };

  const runBulk = async () => {
    if (!bulkAction || selected.length === 0 || changeReason.trim().length < 5) {
      toast.error('Select batches and provide change reason (min 5 characters)');
      return;
    }
    setActionLoading(true);
    if (bulkAction === 'delete') {
      const result = await bulkDeleteBatches(selected, changeReason);
      if (result.successCount) toast.success(`${result.successCount} batch(es) deleted`);
      if (result.errors.length) toast.warning(result.errors.slice(0, 3).join('; '));
    } else {
      const result = await bulkUpdateBatches(selected, bulkAction, changeReason);
      if (result.successCount) toast.success(`${result.successCount} batch(es) updated`);
      else toast.error(result.error || 'Bulk update failed');
    }
    setActionLoading(false);
    setBulkAction(null);
    setChangeReason('');
    setSelected([]);
  };

  if (loading) return <div><PageHeader title="Batch Master" basePath="/admin" /><LoadingSkeleton rows={2} /></div>;
  if (error) return <ErrorCard message={error} onRetry={() => setShowDeleted((v) => !v)} />;

  const tableSection = (
    <>
      <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search batch, product, customer..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <Select value={productFilter} onValueChange={(v) => { setProductFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Product" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {productOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Batch Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {BATCH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={releaseFilter} onValueChange={(v) => { setReleaseFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[150px]"><SelectValue placeholder="Release" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Release</SelectItem>
            {RELEASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }} className="w-[140px]" />
        <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }} className="w-[140px]" />
        <div className="flex items-center gap-2">
          <Checkbox checked={showDeleted} onCheckedChange={(v) => setShowDeleted(Boolean(v))} />
          <span className="text-xs text-muted-foreground">Show deleted</span>
        </div>
      </div>

      {canEdit && selected.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center p-2 bg-muted/50 rounded">
          <span className="text-sm">{selected.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkAction('hold')}>Hold</Button>
          <Button size="sm" variant="outline" onClick={() => setBulkAction('close')}>Close</Button>
          <Button size="sm" variant="outline" onClick={() => setBulkAction('archive')}><Archive className="h-3 w-3 mr-1" />Archive</Button>
          {canDelete && (
            <Button size="sm" variant="destructive" onClick={() => setBulkAction('delete')}>Delete</Button>
          )}
        </div>
      )}

      <div className="hidden md:block overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 dark:bg-slate-900">
              {canEdit && <TableHead className="w-10" />}
              <TableHead>Batch No</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Mfg Date</TableHead>
              <TableHead>Expiry</TableHead>
              <TableHead>Batch Status</TableHead>
              <TableHead>Release</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow><TableCell colSpan={9}><EmptyState title="No batches found" /></TableCell></TableRow>
            ) : (
              paginated.map((row) => (
                <TableRow key={row.id} className={row.isDeleted ? 'opacity-60' : ''}>
                  {canEdit && row.id && (
                    <TableCell>
                      <Checkbox
                        checked={selected.includes(row.id)}
                        onCheckedChange={() => toggleSelect(row.id!)}
                        disabled={row.isDeleted}
                      />
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs font-medium">{row.batchNumber}</TableCell>
                  <TableCell>
                    <div className="text-sm">{row.productName}</div>
                    <div className="text-xs text-muted-foreground">{row.productCode}</div>
                  </TableCell>
                  <TableCell className="text-sm">{row.manufacturingSite || '-'}</TableCell>
                  <TableCell className="text-sm">{row.manufacturingDate}</TableCell>
                  <TableCell className="text-sm">{row.expiryDate}</TableCell>
                  <TableCell><BatchStatusBadge status={row.batchStatus} /></TableCell>
                  <TableCell><ReleaseStatusBadge status={row.releaseStatus} /></TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button asChild variant="ghost" size="icon"><Link href={`/admin/batches/${row.id}`}><Eye className="h-4 w-4" /></Link></Button>
                      {canEdit && !row.isDeleted && row.batchStatus !== 'Released' && (
                        <Button asChild variant="ghost" size="icon"><Link href={`/admin/batches/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
                      )}
                      {canDelete && !row.isDeleted && canDeleteBatchRecord(row).allowed && (
                        <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(row)}>
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      )}
                      {canEdit && row.isDeleted && (
                        <Button variant="ghost" size="icon" onClick={() => setRestoreConfirm(row)}>
                          <RotateCcw className="h-4 w-4 text-green-600" />
                        </Button>
                      )}
                      {canRelease && !row.isDeleted && row.batchStatus !== 'Released' && row.batchStatus !== 'Rejected' && (
                        <>
                          <Button variant="ghost" size="icon" onClick={() => setStatusAction({ batch: row, action: 'release' })}>
                            <CheckCircle className="h-4 w-4 text-green-600" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setStatusAction({ batch: row, action: 'hold' })}>
                            <PauseCircle className="h-4 w-4 text-amber-600" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setStatusAction({ batch: row, action: 'reject' })}>
                            <XCircle className="h-4 w-4 text-red-600" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{filtered.length} batches</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <span>Page {currentPage + 1}/{totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Batch Master"
        description="Product batch master for PQR, CPV, CPP, CQA, Deviation, OOS, CAPA, and Stability"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canImport && (
              <Button variant="outline" size="sm" asChild>
                <label className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-1" />Import CSV
                  <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
                </label>
              </Button>
            )}
            {canCreate && (
              <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Link href="/admin/batches/create"><Plus className="h-4 w-4 mr-1" />Create Batch</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="Planned" value={stats.planned} />
        <KpiCard label="Manufacturing" value={stats.manufacturing} />
        <KpiCard label="Testing" value={stats.testing} />
        <KpiCard label="Released" value={stats.released} />
        <KpiCard label="Hold" value={stats.hold} />
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Batch List</TabsTrigger>
          <TabsTrigger value="lifecycle"><Layers className="h-4 w-4 mr-1" />Lifecycle Dashboard</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Card><CardContent className="p-4 space-y-4">{tableSection}</CardContent></Card>
        </TabsContent>
        <TabsContent value="lifecycle">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lifecycleDashboard.map((group) => (
              <Card key={group.batchStatus}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <BatchLifecycleBadge status={group.batchStatus} />
                    <span className="text-muted-foreground font-normal">{group.count}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 max-h-40 overflow-y-auto">
                  {group.batches.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No batches</p>
                  ) : (
                    group.batches.slice(0, 8).map((b) => (
                      <Link key={b.id} href={`/admin/batches/${b.id}`} className="block text-xs hover:underline">
                        {b.batchNumber} · {b.productCode}
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!statusAction} onOpenChange={() => { setStatusAction(null); setActionReason(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {statusAction?.action === 'release' ? 'Release Batch' : statusAction?.action === 'reject' ? 'Reject Batch' : statusAction?.action === 'hold' ? 'Hold Batch' : 'Update Batch'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Action on batch &quot;{statusAction?.batch.batchNumber}&quot; — reason required for audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Reason *</Label>
            <Textarea value={actionReason} onChange={(e) => setActionReason(e.target.value)} rows={3} placeholder="Enter reason (min 5 characters)..." />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={statusAction?.action === 'reject' ? 'bg-red-600' : statusAction?.action === 'hold' ? 'bg-amber-600' : 'bg-green-600'}
              disabled={actionReason.trim().length < 5 || actionLoading}
              onClick={runStatusAction}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => { setDeleteConfirm(null); setChangeReason(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Soft Delete Batch</AlertDialogTitle>
            <AlertDialogDescription>
              Soft-delete batch &quot;{deleteConfirm?.batchNumber}&quot;? Linked records will prevent deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete} className="bg-red-600 hover:bg-red-700" disabled={actionLoading}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!restoreConfirm} onOpenChange={() => { setRestoreConfirm(null); setChangeReason(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Batch</AlertDialogTitle>
            <AlertDialogDescription>Restore batch &quot;{restoreConfirm?.batchNumber}&quot;?</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runRestore} disabled={actionLoading}>Restore</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!bulkAction} onOpenChange={() => { setBulkAction(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk {bulkAction}</DialogTitle>
            <DialogDescription>Apply to {selected.length} selected batch(es)</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAction(null)}>Cancel</Button>
            <Button onClick={runBulk} disabled={actionLoading || changeReason.trim().length < 5}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
