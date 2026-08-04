'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Download, Upload, Eye, Pencil, Power, FilterX, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { cpvPermissions } from '@/lib/cpv';
import {
  CPV_PRODUCT_STATUSES,
  CPV_REVIEW_FREQUENCIES,
  DOSAGE_FORM_FILTER_OPTIONS,
  MARKET_FILTER_OPTIONS,
  summarizeCpvProducts,
  type CpvProductFormData,
  type CpvProductRecord,
} from '@/lib/cpv-product-master';
import {
  fetchCpvProducts,
  fetchAdminProductsForImport,
  createCpvProduct,
  updateCpvProduct,
  setCpvProductStatus,
  importCpvProductFromAdmin,
  logCpvProductExport,
  buildCpvProductsExportRows,
} from '@/lib/cpv-product-master-service';
import type { AdminProduct } from '@/lib/admin/schemas';
import { downloadCsv, printPage } from '@/lib/export-utils';
import { CpvPageHeader } from './cpv-page-header';
import { CpvProductFormSheet } from './cpv-product-form-sheet';
import { ResponsiveDataTable } from './responsive-data-table';
import { KpiCard, StatusBadge } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ElectronicSignatureDialog } from '@/components/electronic-signatures';
import type { ColumnDef } from '@/components/admin/admin-data-table';

export function CpvProductMasterListPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canManage = cpvPermissions.canManageCpvProducts(role);
  const canActivate = cpvPermissions.canActivateCpvProducts(role);
  const canImportExport = cpvPermissions.canImportExportCpvProducts(role);
  const isReadOnly = cpvPermissions.isReadOnly(role);

  const [products, setProducts] = useState<CpvProductRecord[]>([]);
  const [adminProducts, setAdminProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CpvProductRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<CpvProductRecord | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [esignOpen, setEsignOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importProductId, setImportProductId] = useState('');
  const [importOwner, setImportOwner] = useState('');
  const [importStartDate, setImportStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [importFrequency, setImportFrequency] = useState<typeof CPV_REVIEW_FREQUENCIES[number]>('Yearly');
  const [importReason, setImportReason] = useState('Import from Admin Product Master');

  const [dosageFilter, setDosageFilter] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [frequencyFilter, setFrequencyFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [search, setSearch] = useState('');

  const actor = {
    id: user?.uid || 'system',
    name: profile?.full_name || 'System',
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, admin] = await Promise.all([
        fetchCpvProducts(),
        fetchAdminProductsForImport(),
      ]);
      setProducts(rows);
      setAdminProducts(admin);
    } catch {
      setError('Failed to load CPV products.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sites = useMemo(
    () => Array.from(new Set(products.map((p) => p.manufacturingSite).filter(Boolean))).sort(),
    [products],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      if (dosageFilter !== 'all' && p.dosageForm !== dosageFilter) return false;
      if (marketFilter !== 'all' && p.market !== marketFilter) return false;
      if (statusFilter !== 'all' && p.cpvStatus !== statusFilter) return false;
      if (frequencyFilter !== 'all' && p.cpvReviewFrequency !== frequencyFilter) return false;
      if (siteFilter !== 'all' && p.manufacturingSite !== siteFilter) return false;
      if (!q) return true;
      return (
        p.productName.toLowerCase().includes(q)
        || p.productCode.toLowerCase().includes(q)
        || p.genericName.toLowerCase().includes(q)
        || p.market.toLowerCase().includes(q)
        || (p.productCategory || '').toLowerCase().includes(q)
        || (p.productFamily || '').toLowerCase().includes(q)
        || (p.manufacturingSite || '').toLowerCase().includes(q)
        || (p.cpvProductId || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, dosageFilter, marketFilter, statusFilter, frequencyFilter, siteFilter]);

  const summary = useMemo(() => summarizeCpvProducts(products), [products]);

  const clearFilters = () => {
    setDosageFilter('all');
    setMarketFilter('all');
    setStatusFilter('all');
    setFrequencyFilter('all');
    setSiteFilter('all');
    setSearch('');
  };

  const handleSave = async (data: CpvProductFormData) => {
    setSubmitting(true);
    try {
      if (editing?.id) {
        const { error: err } = await updateCpvProduct(editing.id, data, actor, editing);
        if (err) { toast.error(err); return; }
        toast.success('CPV product updated');
      } else {
        const { error: err } = await createCpvProduct(data, actor);
        if (err) { toast.error(err); return; }
        toast.success('Product added to CPV');
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } finally {
      setSubmitting(false);
    }
  };

  const requestStatusToggle = (row: CpvProductRecord) => {
    setStatusTarget(row);
    setStatusReason('');
  };

  const confirmStatusDialog = () => {
    if (!statusTarget) return;
    if (statusReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    setEsignOpen(true);
  };

  const applyStatusChange = async () => {
    if (!statusTarget) return;
    const newStatus = statusTarget.cpvStatus === 'Active' ? 'Inactive' : 'Active';
    setSubmitting(true);
    const { error: err } = await setCpvProductStatus(
      statusTarget.id,
      newStatus,
      actor,
      statusTarget,
      { changeReason: statusReason, esignConfirmed: true },
    );
    setSubmitting(false);
    setEsignOpen(false);
    setStatusTarget(null);
    setStatusReason('');
    if (err) toast.error(err);
    else toast.success(newStatus === 'Active' ? 'Product activated' : 'Product deactivated');
    await load();
  };

  const handleImport = async () => {
    if (!importProductId || !importOwner) {
      toast.error('Select product and enter CPV owner');
      return;
    }
    if (importReason.trim().length < 5) {
      toast.error('Import reason must be at least 5 characters');
      return;
    }
    setSubmitting(true);
    const { error: err } = await importCpvProductFromAdmin(
      importProductId,
      {
        cpvStartDate: importStartDate,
        cpvReviewFrequency: importFrequency,
        cpvOwner: importOwner,
        cpvStatus: 'Draft',
        remarks: '',
        qaReviewer: '',
        changeReason: importReason,
      },
      actor,
    );
    setSubmitting(false);
    if (err) toast.error(err);
    else {
      toast.success('Product imported as Draft — activate after review');
      setImportOpen(false);
      await load();
    }
  };

  const handleExport = async () => {
    const { headers, rows } = buildCpvProductsExportRows(filtered);
    downloadCsv(`cpv-products-${new Date().toISOString().split('T')[0]}.csv`, headers, rows);
    await logCpvProductExport(actor, filtered.length, 'CSV');
    toast.success(`Exported ${filtered.length} CPV products`);
  };

  const columns: ColumnDef<CpvProductRecord>[] = [
    { key: 'cpvProductId', header: 'CPV ID' },
    { key: 'productCode', header: 'Code' },
    { key: 'productName', header: 'Product Name' },
    { key: 'strength', header: 'Strength' },
    { key: 'dosageForm', header: 'Dosage Form' },
    { key: 'manufacturingSite', header: 'Site', render: (row) => row.manufacturingSite || '—' },
    { key: 'market', header: 'Market' },
    {
      key: 'cpvStatus',
      header: 'CPV Status',
      render: (row) => <StatusBadge status={row.cpvStatus} />,
    },
    { key: 'cpvReviewFrequency', header: 'Review Freq.' },
    {
      key: 'links',
      header: 'Parameters',
      render: (row) => (
        <span className="text-xs">
          CPP: {row.linkedCppParameterIds?.length || 0} / CQA: {row.linkedCqaParameterIds?.length || 0}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="p-4 sm:p-6">
        <CpvPageHeader title="CPV Product Master" description="Manage products under Continued Process Verification" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorCard message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div id="cpv-product-master-root" className="space-y-6 p-4 sm:p-6">
      <CpvPageHeader
        title="CPV Product Master"
        description="Manage products under Continued Process Verification"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'Product Master' },
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
                <Plus className="h-4 w-4" />Add to CPV
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Total CPV Products" value={summary.total} tone="blue" />
        <KpiCard label="Active" value={summary.active} tone="green" />
        <KpiCard label="Draft" value={summary.draft} tone="blue" />
        <KpiCard label="Inactive" value={summary.inactive} tone="amber" />
        <KpiCard label="Under Review / Approved" value={summary.underReview} tone="amber" />
        <KpiCard label="Without CPP Link" value={summary.withoutCppLink} tone="red" />
        <KpiCard label="Without CQA Link" value={summary.withoutCqaLink} tone="red" />
        <KpiCard label="Due For Review" value={summary.dueForReview} tone="amber" />
      </div>

      <Card className="no-print">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Search</Label>
              <Input
                className="mt-1"
                placeholder="Code, name, category, family, site, CPV ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <div>
                <Label className="text-xs text-muted-foreground">Dosage Form</Label>
                <Select value={dosageFilter} onValueChange={setDosageFilter}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {DOSAGE_FORM_FILTER_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Market</Label>
                <Select value={marketFilter} onValueChange={setMarketFilter}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {MARKET_FILTER_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">CPV Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {CPV_PRODUCT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                <Label className="text-xs text-muted-foreground">Review Frequency</Label>
                <Select value={frequencyFilter} onValueChange={setFrequencyFilter}>
                  <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {CPV_REVIEW_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button variant="ghost" size="sm" className="h-9" onClick={clearFilters}>
              <FilterX className="h-3.5 w-3.5 mr-1" />Clear
            </Button>
          </div>

          {filtered.length === 0 ? (
            <EmptyState title="No CPV products" message="Add a product to CPV or import from Admin Product Master." />
          ) : (
            <ResponsiveDataTable
              columns={columns}
              data={filtered}
              searchKeys={['productName', 'productCode', 'genericName', 'market', 'cpvProductId']}
              onRowClick={(row) => router.push(`/cpv/product-master/${row.id}`)}
              pageSize={10}
              statusKey="cpvStatus"
              statusOptions={[...CPV_PRODUCT_STATUSES]}
              actions={(row) => (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => router.push(`/cpv/product-master/${row.id}`)}>
                    <Eye className="h-4 w-4" />
                  </Button>
                  {canManage && !isReadOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => { setEditing(row); setFormOpen(true); }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canActivate && !isReadOnly && (
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => requestStatusToggle(row)}
                    >
                      <Power className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )}
            />
          )}
        </CardContent>
      </Card>

      <CpvProductFormSheet
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditing(null); }}
        editing={editing}
        adminProducts={adminProducts}
        onSubmit={handleSave}
        submitting={submitting}
      />

      <Dialog open={Boolean(statusTarget) && !esignOpen} onOpenChange={(v) => { if (!v) { setStatusTarget(null); setStatusReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusTarget?.cpvStatus === 'Active' ? 'Deactivate CPV Product?' : 'Activate CPV Product?'}
            </DialogTitle>
            <DialogDescription>
              {statusTarget?.cpvStatus === 'Active'
                ? 'Inactive products cannot register new batches or CPP/CQA entries. Electronic signature is required.'
                : 'Activation requires electronic signature. Product will be available for CPV activities.'}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>Change Reason *</Label>
            <Textarea
              className="mt-1"
              rows={3}
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              placeholder="Reason for status change (min 5 characters)"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setStatusTarget(null); setStatusReason(''); }}>Cancel</Button>
            <Button onClick={confirmStatusDialog} disabled={submitting}>Continue to E-Sign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ElectronicSignatureDialog
        open={esignOpen}
        onOpenChange={(v) => { setEsignOpen(v); if (!v) setSubmitting(false); }}
        moduleName="CPV Product Master"
        recordId={statusTarget?.id || 'cpv-product'}
        documentNumber={statusTarget?.cpvProductId}
        actionType={statusTarget?.cpvStatus === 'Active' ? 'Deactivate' : 'Activate'}
        onSuccess={() => { void applyStatusChange(); }}
        onCancel={() => setEsignOpen(false)}
      />

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import from Admin Product Master</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Product</Label>
              <Select value={importProductId} onValueChange={setImportProductId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {adminProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id || ''}>{p.productCode} — {p.productName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CPV Start Date</Label>
              <Input type="date" className="mt-1" value={importStartDate} onChange={(e) => setImportStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Review Frequency</Label>
              <Select value={importFrequency} onValueChange={(v) => setImportFrequency(v as typeof importFrequency)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CPV_REVIEW_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CPV Owner *</Label>
              <Input className="mt-1" value={importOwner} onChange={(e) => setImportOwner(e.target.value)} />
            </div>
            <div>
              <Label>Change Reason *</Label>
              <Textarea className="mt-1" rows={2} value={importReason} onChange={(e) => setImportReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleImport()} disabled={submitting}>Import as Draft</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
