'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, UserCheck, UserX, Upload, Trash2,
  RotateCcw, Layers, FolderTree, Archive,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { DosageFormBadge } from './dosage-form-badge';
import { ProductStatusBadge } from './product-status-badge';
import { ProductLifecycleBadge } from './product-lifecycle-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
import { canEditProducts, canImportProducts } from '@/lib/permissions';
import {
  DOSAGE_FORMS, MARKET_OPTIONS, PRODUCT_STATUSES, PRODUCT_LIFECYCLE_STATUSES, PRODUCT_CATEGORIES,
} from '@/lib/admin/constants';
import type { AdminProduct } from '@/lib/admin/schemas';
import {
  subscribeToProducts, setProductStatus, exportProductsCsv, logProductExport,
  importProductsFromText, deleteProduct, restoreProduct, bulkUpdateProducts, bulkDeleteProducts,
  buildProductCategoryGroups, buildLifecycleDashboard, canDeleteProductRecord,
} from '@/lib/admin/product-service';

const PAGE_SIZE = 10;

type ConfirmState = {
  product: AdminProduct;
  activate: boolean;
} | null;

export function ProductsListPage({
  title = 'Product Master',
  description = 'Pharma product master for PQR, CPV, Batch, Stability, and QMS modules',
  basePath = '/admin/products',
  sectionLabel = 'Master Data',
}: {
  title?: string;
  description?: string;
  basePath?: string;
  sectionLabel?: string;
} = {}) {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditProducts(role);
  const canImport = canImportProducts(role);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [formFilter, setFormFilter] = useState('all');
  const [marketFilter, setMarketFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [changeReason, setChangeReason] = useState('');

  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<AdminProduct | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<AdminProduct | null>(null);
  const [bulkAction, setBulkAction] = useState<'activate' | 'deactivate' | 'archive' | 'delete' | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [importReason, setImportReason] = useState('');

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
    role,
  };

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToProducts(
      showDeleted,
      (next) => {
        setProducts(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [showDeleted]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      if (p.category || p.therapeuticCategory) set.add(p.category || p.therapeuticCategory || '');
    });
    return Array.from(set).filter(Boolean).sort();
  }, [products]);

  const lifecycleDashboard = useMemo(() => buildLifecycleDashboard(products), [products]);
  const categoryGroups = useMemo(() => buildProductCategoryGroups(products), [products]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter((p) => {
      const matchSearch = !q ||
        p.productName?.toLowerCase().includes(q) ||
        p.productCode?.toLowerCase().includes(q) ||
        p.genericName?.toLowerCase().includes(q) ||
        p.productFamily?.toLowerCase().includes(q);
      const matchForm = formFilter === 'all' || p.dosageForm === formFilter;
      const matchMarket = marketFilter === 'all' || p.market === marketFilter;
      const matchStatus = statusFilter === 'all' || p.productStatus === statusFilter;
      const matchLifecycle = lifecycleFilter === 'all' || p.lifecycleStatus === lifecycleFilter;
      const matchCategory = categoryFilter === 'all'
        || p.category === categoryFilter
        || p.therapeuticCategory === categoryFilter;
      return matchSearch && matchForm && matchMarket && matchStatus && matchLifecycle && matchCategory;
    });
  }, [products, search, formFilter, marketFilter, statusFilter, lifecycleFilter, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleExport = async () => {
    const csv = exportProductsCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `products-export-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    await logProductExport(auditMeta, filtered.length);
    toast.success('Product list exported');
  };

  const runConfirm = async () => {
    if (!confirm || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionBusy(true);
    const status = confirm.activate ? 'Active' : 'Inactive';
    const result = await setProductStatus(confirm.product.id!, confirm.product, status, auditMeta, changeReason);
    if (result.success) {
      if (status === 'Inactive') toast.warning('Inactive product — new PQR/CPV batch registration blocked');
      else toast.success('Product activated');
    } else toast.error(result.error || 'Action failed');
    setActionBusy(false);
    setConfirm(null);
    setChangeReason('');
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionBusy(true);
    const result = await deleteProduct(deleteConfirm.id, deleteConfirm, changeReason);
    if (result.success) toast.success('Product soft-deleted');
    else toast.error(result.error || 'Delete failed');
    setActionBusy(false);
    setDeleteConfirm(null);
    setChangeReason('');
  };

  const runRestore = async () => {
    if (!restoreConfirm?.id || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionBusy(true);
    const result = await restoreProduct(restoreConfirm.id, changeReason);
    if (result.success) toast.success('Product restored');
    else toast.error(result.error || 'Restore failed');
    setActionBusy(false);
    setRestoreConfirm(null);
    setChangeReason('');
  };

  const runBulk = async () => {
    if (!bulkAction || selected.length === 0 || changeReason.trim().length < 5) {
      toast.error('Select products and provide a change reason (min 5 characters)');
      return;
    }
    setActionBusy(true);
    if (bulkAction === 'delete') {
      const result = await bulkDeleteProducts(selected, changeReason);
      if (result.error) toast.error(result.error);
      else {
        toast.success(`${result.successCount} product(s) soft-deleted`);
        if (result.errors.length > 0) toast.warning(`${result.errors.length} product(s) skipped`);
      }
    } else {
      const result = await bulkUpdateProducts(selected, bulkAction, changeReason);
      if (result.error) toast.error(result.error);
      else toast.success(`${result.successCount} product(s) updated`);
    }
    setActionBusy(false);
    setBulkAction(null);
    setSelected([]);
    setChangeReason('');
  };

  const handlePasteImport = async () => {
    if (!pasteText.trim() || importReason.trim().length < 5) {
      toast.error('Paste product rows and provide import reason (min 5 characters)');
      return;
    }
    setActionBusy(true);
    const result = await importProductsFromText(pasteText, auditMeta, importReason);
    setActionBusy(false);
    if (result.imported) toast.success(`Imported ${result.imported} product(s)`);
    if (result.errors.length) toast.warning(`${result.errors.length} row(s) failed`);
    if (!result.imported && !result.errors.length) {
      toast.error('No valid product rows found');
      return;
    }
    if (result.imported) {
      setPasteText('');
      setImportReason('');
      setPasteOpen(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Product Master" basePath="/admin/products" sectionLabel="Master Data" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  if (error) return <ErrorCard message={error} onRetry={() => window.location.reload()} />;

  const renderActions = (row: AdminProduct) => (
    <div className="flex justify-end gap-1">
      <Button asChild variant="ghost" size="icon"><Link href={`/admin/products/${row.id}`}><Eye className="h-4 w-4" /></Link></Button>
      {canEdit && !row.isDeleted && (
        <>
          <Button asChild variant="ghost" size="icon"><Link href={`/admin/products/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
          {row.productStatus === 'Active'
            ? <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ product: row, activate: false }); }}><UserX className="h-4 w-4 text-amber-600" /></Button>
            : <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ product: row, activate: true }); }}><UserCheck className="h-4 w-4 text-green-600" /></Button>}
          {canDelete && canDeleteProductRecord(row).allowed && (
            <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setDeleteConfirm(row); }}>
              <Trash2 className="h-4 w-4 text-red-600" />
            </Button>
          )}
        </>
      )}
      {canEdit && row.isDeleted && (
        <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setRestoreConfirm(row); }}>
          <RotateCcw className="h-4 w-4 text-green-600" />
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        basePath={basePath}
        sectionLabel={sectionLabel}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canImport && (
              <Button variant="outline" size="sm" onClick={() => setPasteOpen(true)} disabled={actionBusy}>
                <Upload className="h-4 w-4 mr-1" />Import
              </Button>
            )}
            {canEdit && (
              <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Link href="/admin/products/create"><Plus className="h-4 w-4 mr-1" />Create Product</Link>
              </Button>
            )}
          </div>
        }
      />

      <Tabs defaultValue="products">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="products">Product List</TabsTrigger>
          <TabsTrigger value="lifecycle">Lifecycle Dashboard</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>

        <TabsContent value="products" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col xl:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search name, code, generic, family..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
                </div>
                <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    {PRODUCT_CATEGORIES.map((c) => !categories.includes(c) ? <SelectItem key={c} value={c}>{c}</SelectItem> : null)}
                  </SelectContent>
                </Select>
                <Select value={lifecycleFilter} onValueChange={(v) => { setLifecycleFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Lifecycle" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Lifecycle</SelectItem>
                    {PRODUCT_LIFECYCLE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={formFilter} onValueChange={(v) => { setFormFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Dosage Form" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Forms</SelectItem>
                    {DOSAGE_FORMS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={marketFilter} onValueChange={(v) => { setMarketFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[130px]"><SelectValue placeholder="Market" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Markets</SelectItem>
                    {MARKET_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {PRODUCT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={showDeleted} onCheckedChange={(checked) => setShowDeleted(Boolean(checked))} />
                  Show deleted
                </label>
                {canEdit && selected.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setChangeReason(''); setBulkAction('activate'); }}>Bulk Activate</Button>
                    <Button size="sm" variant="outline" onClick={() => { setChangeReason(''); setBulkAction('deactivate'); }}>Bulk Deactivate</Button>
                    <Button size="sm" variant="outline" onClick={() => { setChangeReason(''); setBulkAction('archive'); }}><Archive className="h-3 w-3 mr-1" />Bulk Archive</Button>
                    {canDelete && (
                      <Button size="sm" variant="destructive" onClick={() => { setChangeReason(''); setBulkAction('delete'); }}>Bulk Delete</Button>
                    )}
                  </div>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50 dark:bg-slate-900">
                      {canEdit && <TableHead className="w-10" />}
                      <TableHead>Code</TableHead>
                      <TableHead>Product Name</TableHead>
                      <TableHead>Category / Family</TableHead>
                      <TableHead>Form</TableHead>
                      <TableHead>Lifecycle</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow><TableCell colSpan={8}><EmptyState title="No products found" /></TableCell></TableRow>
                    ) : (
                      paginated.map((row) => (
                        <TableRow key={row.id} className={row.isDeleted ? 'opacity-60' : ''}>
                          {canEdit && (
                            <TableCell>
                              {!row.isDeleted && row.id && (
                                <Checkbox checked={selected.includes(row.id)} onCheckedChange={() => toggleSelect(row.id!)} />
                              )}
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">{row.productCode}</TableCell>
                          <TableCell>
                            <div className="font-medium">{row.productName}</div>
                            <div className="text-xs text-muted-foreground">{row.genericName}</div>
                            {row.isDeleted && <Badge variant="destructive" className="text-[10px] mt-1">Deleted</Badge>}
                          </TableCell>
                          <TableCell className="text-sm">
                            <div>{row.category || row.therapeuticCategory || '—'}</div>
                            <div className="text-xs text-muted-foreground">{row.productFamily || '—'}</div>
                          </TableCell>
                          <TableCell><DosageFormBadge form={row.dosageForm} /></TableCell>
                          <TableCell><ProductLifecycleBadge status={row.lifecycleStatus} /></TableCell>
                          <TableCell><ProductStatusBadge status={row.productStatus} /></TableCell>
                          <TableCell>{renderActions(row)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{filtered.length} product(s)</span>
                <div className="flex gap-2 items-center">
                  <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                  <span>Page {currentPage + 1}/{totalPages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lifecycle">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {lifecycleDashboard.every((g) => g.count === 0) ? (
              <EmptyState title="No lifecycle data" />
            ) : (
              lifecycleDashboard.map((group) => (
                <Card key={group.lifecycleStatus}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Layers className="h-4 w-4" />
                      {group.lifecycleStatus}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground">{group.count} product(s)</p>
                    {group.products.slice(0, 5).map((product) => (
                      <Link key={product.id} href={`/admin/products/${product.id}`} className="block p-2 border rounded hover:bg-muted/50 text-sm">
                        {product.productName} · {product.productCode}
                      </Link>
                    ))}
                    {group.products.length > 5 && (
                      <p className="text-xs text-muted-foreground">+{group.products.length - 5} more</p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="categories">
          <div className="space-y-4">
            {categoryGroups.length === 0 ? (
              <EmptyState title="No categories configured" />
            ) : (
              categoryGroups.map((group) => (
                <Card key={group.category}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FolderTree className="h-4 w-4" />
                      {group.category}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    {group.families.map((family) => (
                      <div key={`${group.category}-${family.productFamily}`} className="border rounded-lg p-3 space-y-2">
                        <p className="font-medium text-sm">{family.productFamily}</p>
                        {family.products.map((product) => (
                          <Link key={product.id} href={`/admin/products/${product.id}`} className="block text-sm text-blue-600 hover:underline">
                            {product.productName} ({product.productCode})
                          </Link>
                        ))}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirm} onOpenChange={() => setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.activate ? 'Activate Product' : 'Deactivate Product'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.activate
                ? `Activate "${confirm?.product.productName}"?`
                : `Deactivate "${confirm?.product.productName}"? New PQR and CPV batch registration will be blocked.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm} disabled={actionBusy} className="bg-blue-600">
              {actionBusy ? 'Processing…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Soft Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Soft-delete &quot;{deleteConfirm?.productName}&quot;? Linked batch records will block deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete} disabled={actionBusy} className="bg-red-600 hover:bg-red-700">
              {actionBusy ? 'Deleting…' : 'Soft Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!restoreConfirm} onOpenChange={() => setRestoreConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore Product</AlertDialogTitle>
            <AlertDialogDescription>Restore &quot;{restoreConfirm?.productName}&quot; to Active status?</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runRestore} disabled={actionBusy} className="bg-green-600">
              {actionBusy ? 'Restoring…' : 'Restore'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!bulkAction} onOpenChange={() => setBulkAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkAction === 'delete' ? 'Bulk Soft Delete'
                : bulkAction === 'archive' ? 'Bulk Archive'
                  : `Bulk ${bulkAction === 'activate' ? 'Activate' : 'Deactivate'}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === 'delete'
                ? `${selected.length} product(s) selected. Linked batches or active commercial products may be skipped.`
                : `${selected.length} product(s) selected.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runBulk}
              disabled={actionBusy}
              className={bulkAction === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600'}
            >
              {actionBusy ? 'Processing…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Import Products</DialogTitle>
            <DialogDescription>
              Paste product rows with Product Name, Product Code, MFR No., and BPR No. Tab-separated or free-text lines are supported.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Import Reason *</Label>
              <Textarea value={importReason} onChange={(e) => setImportReason(e.target.value)} rows={2} />
            </div>
            <Textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={10}
              placeholder="Paste product rows here..."
            />
            <Input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setPasteText(await file.text());
              e.target.value = '';
            }} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>Load from file</Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPasteOpen(false)}>Cancel</Button>
            <Button className="bg-blue-600 hover:bg-blue-700" disabled={actionBusy} onClick={handlePasteImport}>
              {actionBusy ? 'Importing…' : 'Import Products'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
