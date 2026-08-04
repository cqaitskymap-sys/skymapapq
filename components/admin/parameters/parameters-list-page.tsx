'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, UserCheck, UserX, Upload, Database, Trash2,
  RotateCcw, Archive, Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ParameterTypeBadge } from './parameter-type-badge';
import { CriticalityBadge } from './criticality-badge';
import { ProductLinkBadge } from './product-link-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  canEditParameters, canEditQcParameters, canEditUtilityParameters,
  canImportParameters, canActivateParameters, canViewCppParametersOnly,
} from '@/lib/permissions';
import {
  PARAMETER_TYPES, PARAMETER_CATEGORIES, PROCESS_STAGES,
  CRITICALITY_OPTIONS, RECORD_STATUSES,
} from '@/lib/admin/constants';
import type { Parameter } from '@/lib/admin/schemas';
import {
  subscribeToParameters, getParameterSummaryCounts, setParameterStatus,
  deleteParameter, restoreParameter, archiveParameter,
  exportParametersCsv, logParameterExport, importParametersFromFile, seedDefaultParameters,
  bulkUpdateParameters, bulkDeleteParameters, buildParameterCategoryGroups,
  canDeleteParameterRecord,
} from '@/lib/admin/parameter-service';

const PAGE_SIZE = 10;

type StatusConfirm = { param: Parameter; activate: boolean } | null;
type BulkAction = 'activate' | 'deactivate' | 'archive' | 'delete' | null;

export function ParametersListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditParameters(role) || canEditQcParameters(role) || canEditUtilityParameters(role);
  const canImport = canImportParameters(role);
  const canActivate = canActivateParameters(role);
  const cppOnly = canViewCppParametersOnly(role);

  const [parameters, setParameters] = useState<Parameter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');
  const [criticalityFilter, setCriticalityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<StatusConfirm>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Parameter | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<Parameter | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<Parameter | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction>(null);
  const [changeReason, setChangeReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToParameters(
      showDeleted,
      (next) => {
        setParameters(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [showDeleted]);

  const roleFiltered = useMemo(() => {
    if (!cppOnly) return parameters;
    return parameters.filter((p) =>
      p.parameterType === 'CPP' || p.parameterType === 'IPC' || p.parameterType === 'Yield Parameter',
    );
  }, [parameters, cppOnly]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return roleFiltered.filter((p) => {
      const matchSearch = !q ||
        p.parameterCode?.toLowerCase().includes(q) ||
        p.parameterName?.toLowerCase().includes(q) ||
        p.shortName?.toLowerCase().includes(q) ||
        p.parameterType?.toLowerCase().includes(q) ||
        p.productLink?.toLowerCase().includes(q) ||
        p.parameterGroup?.toLowerCase().includes(q) ||
        p.moduleName?.toLowerCase().includes(q);
      const matchType = typeFilter === 'all' || p.parameterType === typeFilter;
      const matchCategory = categoryFilter === 'all' || p.parameterCategory === categoryFilter;
      const matchStage = stageFilter === 'all' || p.processStage === stageFilter;
      const matchCriticality = criticalityFilter === 'all' || p.criticality === criticalityFilter;
      const matchStatus = statusFilter === 'all' || p.status === statusFilter;
      return matchSearch && matchType && matchCategory && matchStage && matchCriticality && matchStatus;
    });
  }, [roleFiltered, search, typeFilter, categoryFilter, stageFilter, criticalityFilter, statusFilter]);

  const categoryGroups = useMemo(() => buildParameterCategoryGroups(filtered), [filtered]);
  const stats = getParameterSummaryCounts(roleFiltered);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const requireReason = () => {
    if (changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return false;
    }
    return true;
  };

  const handleExport = async () => {
    const csv = exportParametersCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parameters-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logParameterExport(auditMeta, filtered.length);
    toast.success('Parameter list exported');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importParametersFromFile(file, auditMeta);
    if (result.imported) toast.success(`Imported ${result.imported} parameter(s)`);
    if (result.errors.length) toast.warning(`${result.errors.length} row(s) failed`);
    e.target.value = '';
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    const result = await seedDefaultParameters(auditMeta);
    setSeeding(false);
    toast.success(`Created ${result.created} default parameter(s), skipped ${result.skipped}`);
  };

  const runConfirm = async () => {
    if (!confirm?.param.id || !requireReason()) return;
    setActionLoading(true);
    const status = confirm.activate ? 'Active' : 'Inactive';
    const result = await setParameterStatus(confirm.param.id, confirm.param, status, auditMeta, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success(`Parameter ${status === 'Active' ? 'activated' : 'deactivated'}`);
      setConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Action failed');
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id || !requireReason()) return;
    const check = canDeleteParameterRecord(deleteConfirm);
    if (!check.allowed) {
      toast.error(check.reason || 'Cannot delete');
      return;
    }
    setActionLoading(true);
    const result = await deleteParameter(deleteConfirm.id, deleteConfirm, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Parameter soft-deleted');
      setDeleteConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Delete failed');
  };

  const runRestore = async () => {
    if (!restoreConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await restoreParameter(restoreConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Parameter restored');
      setRestoreConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Restore failed');
  };

  const runArchive = async () => {
    if (!archiveConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await archiveParameter(archiveConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Parameter archived');
      setArchiveConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Archive failed');
  };

  const runBulk = async () => {
    if (!bulkAction || selected.length === 0 || !requireReason()) return;
    setActionLoading(true);
    if (bulkAction === 'delete') {
      const result = await bulkDeleteParameters(selected, changeReason);
      setActionLoading(false);
      if (result.successCount) toast.success(`Deleted ${result.successCount} parameter(s)`);
      if (result.errors?.length) toast.warning(result.errors.join('; '));
      if (result.error) toast.error(result.error);
    } else {
      const result = await bulkUpdateParameters(selected, bulkAction, changeReason);
      setActionLoading(false);
      if (result.successCount) toast.success(`Updated ${result.successCount} parameter(s)`);
      if (result.error) toast.error(result.error);
    }
    setBulkAction(null);
    setChangeReason('');
    setSelected([]);
  };

  if (loading) return <div><PageHeader title="Parameter Master" basePath="/admin" /><LoadingSkeleton rows={2} /></div>;
  if (error) return <ErrorCard message={error} onRetry={() => setLoading(true)} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parameter Master"
        description="CPP, CQA, IPC, QC, Stability, Utility and Environmental parameters for CPV and QMS"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canImport && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <label className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-1" />Import CSV
                    <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleImport} />
                  </label>
                </Button>
                <Button variant="outline" size="sm" disabled={seeding} onClick={handleSeedDefaults}>
                  <Database className="h-4 w-4 mr-1" />{seeding ? 'Seeding...' : 'Seed Defaults'}
                </Button>
              </>
            )}
            {canEdit && !cppOnly && (
              <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Link href="/admin/parameters/create"><Plus className="h-4 w-4 mr-1" />Create Parameter</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="CPP" value={stats.cpp} />
        <KpiCard label="CQA" value={stats.cqa} />
        <KpiCard label="IPC" value={stats.ipc} />
        <KpiCard label="Utility" value={stats.utility} />
        <KpiCard label="Environmental" value={stats.environmental} />
        <KpiCard label="Active" value={stats.active} />
        <KpiCard label="Critical" value={stats.critical} />
        <KpiCard label="Archived" value={stats.archived} />
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Parameter List</TabsTrigger>
          <TabsTrigger value="categories"><Layers className="h-3.5 w-3.5 mr-1" />Categories</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search code, name, group, module, product..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    className="pl-9"
                  />
                </div>
                <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {PARAMETER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    {PARAMETER_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={stageFilter} onValueChange={(v) => { setStageFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Stage" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Stages</SelectItem>
                    {PROCESS_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={criticalityFilter} onValueChange={(v) => { setCriticalityFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[130px]"><SelectValue placeholder="Criticality" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    {CRITICALITY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {RECORD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2">
                  <Checkbox id="showDeleted" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(Boolean(v))} />
                  <Label htmlFor="showDeleted" className="text-sm">Show deleted</Label>
                </div>
              </div>

              {canEdit && !cppOnly && selected.length > 0 && (
                <div className="flex gap-2 flex-wrap items-center p-2 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium">{selected.length} selected</span>
                  {canActivate && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setBulkAction('activate')}>Activate</Button>
                      <Button size="sm" variant="outline" onClick={() => setBulkAction('deactivate')}>Deactivate</Button>
                    </>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setBulkAction('archive')}><Archive className="h-3.5 w-3.5 mr-1" />Archive</Button>
                  {canDelete && (
                    <Button size="sm" variant="destructive" onClick={() => setBulkAction('delete')}>Delete</Button>
                  )}
                </div>
              )}

              <div className="hidden md:block overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {canEdit && !cppOnly && <TableHead className="w-10" />}
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Category / Group</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Limits</TableHead>
                      <TableHead>Criticality</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow><TableCell colSpan={10}><EmptyState title="No parameters found" /></TableCell></TableRow>
                    ) : (
                      paginated.map((row) => (
                        <TableRow key={row.id} className={row.isDeleted ? 'opacity-60 bg-red-50/30' : undefined}>
                          {canEdit && !cppOnly && (
                            <TableCell>
                              <Checkbox
                                checked={selected.includes(row.id!)}
                                onCheckedChange={() => row.id && toggleSelect(row.id)}
                                disabled={row.isDeleted}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">{row.parameterCode}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{row.parameterName}</div>
                            {row.isArchived && <span className="text-xs text-amber-600">Archived</span>}
                          </TableCell>
                          <TableCell><ParameterTypeBadge type={row.parameterType} /></TableCell>
                          <TableCell className="text-xs">
                            <div>{row.parameterCategory || '-'}</div>
                            <div className="text-muted-foreground">{row.parameterGroup || '-'}</div>
                          </TableCell>
                          <TableCell><ProductLinkBadge product={row.productLink} /></TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.lowerLimit && row.upperLimit ? `${row.lowerLimit} – ${row.upperLimit} ${row.unit}` : row.unit || '-'}
                          </TableCell>
                          <TableCell><CriticalityBadge criticality={row.criticality} /></TableCell>
                          <TableCell><StatusBadge status={row.isDeleted ? 'Deleted' : row.status} /></TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="ghost" size="icon"><Link href={`/admin/parameters/${row.id}`}><Eye className="h-4 w-4" /></Link></Button>
                              {canEdit && !cppOnly && !row.isDeleted && (
                                <>
                                  <Button asChild variant="ghost" size="icon"><Link href={`/admin/parameters/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
                                  {canActivate && (
                                    row.status === 'Active'
                                      ? <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ param: row, activate: false }); }}><UserX className="h-4 w-4 text-amber-600" /></Button>
                                      : <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ param: row, activate: true }); }}><UserCheck className="h-4 w-4 text-green-600" /></Button>
                                  )}
                                  <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setArchiveConfirm(row); }}><Archive className="h-4 w-4 text-slate-600" /></Button>
                                  {canDelete && (
                                    <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setDeleteConfirm(row); }}>
                                      <Trash2 className="h-4 w-4 text-red-600" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {row.isDeleted && canEdit && (
                                <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setRestoreConfirm(row); }}>
                                  <RotateCcw className="h-4 w-4 text-green-600" />
                                </Button>
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
                <span>{filtered.length} parameters</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                  <span>Page {currentPage + 1}/{totalPages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="mt-4 space-y-4">
          {categoryGroups.length === 0 ? (
            <EmptyState title="No categories" />
          ) : (
            categoryGroups.map(({ category, groups }) => (
              <Card key={category}>
                <CardHeader className="py-3">
                  <CardTitle className="text-base">{category} ({groups.reduce((n, g) => n + g.parameters.length, 0)})</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {groups.map(({ parameterGroup, parameters: items }) => (
                    <div key={parameterGroup} className="border rounded-lg p-3">
                      <p className="text-sm font-medium mb-2">{parameterGroup} ({items.length})</p>
                      <div className="flex flex-wrap gap-2">
                        {items.slice(0, 12).map((p) => (
                          <Link key={p.id} href={`/admin/parameters/${p.id}`} className="text-xs px-2 py-1 bg-slate-100 rounded hover:bg-slate-200">
                            {p.parameterCode}
                          </Link>
                        ))}
                        {items.length > 12 && <span className="text-xs text-muted-foreground">+{items.length - 12} more</span>}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from(new Set(filtered.map((p) => p.parameterGroup || 'General'))).sort().map((group) => {
                  const count = filtered.filter((p) => (p.parameterGroup || 'General') === group).length;
                  return (
                    <div key={group} className="border rounded-lg p-4">
                      <p className="font-medium">{group}</p>
                      <p className="text-2xl font-bold text-blue-600">{count}</p>
                      <p className="text-xs text-muted-foreground">parameters</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!confirm} onOpenChange={() => { setConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.activate ? 'Activate Parameter' : 'Deactivate Parameter'}</DialogTitle>
            <DialogDescription>
              {confirm?.activate
                ? `Activate "${confirm?.param.parameterName}"?`
                : `Deactivate "${confirm?.param.parameterName}"? CPV monitoring may be affected.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} placeholder="GMP change reason (min 5 characters)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button className="bg-blue-600" disabled={actionLoading} onClick={runConfirm}>{actionLoading ? 'Processing...' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => { setDeleteConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft Delete Parameter</DialogTitle>
            <DialogDescription>
              Soft delete &quot;{deleteConfirm?.parameterName}&quot;? Linked CPV records will prevent deletion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button variant="destructive" disabled={actionLoading} onClick={runDelete}>{actionLoading ? 'Deleting...' : 'Delete'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!restoreConfirm} onOpenChange={() => { setRestoreConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Parameter</DialogTitle>
            <DialogDescription>Restore &quot;{restoreConfirm?.parameterName}&quot;?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRestoreConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button className="bg-green-600" disabled={actionLoading} onClick={runRestore}>{actionLoading ? 'Restoring...' : 'Restore'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!archiveConfirm} onOpenChange={() => { setArchiveConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Parameter</DialogTitle>
            <DialogDescription>Archive &quot;{archiveConfirm?.parameterName}&quot;? It will remain for audit but hidden from active use.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setArchiveConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button disabled={actionLoading} onClick={runArchive}>{actionLoading ? 'Archiving...' : 'Archive'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bulkAction} onOpenChange={() => { setBulkAction(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk {bulkAction}</DialogTitle>
            <DialogDescription>Apply to {selected.length} selected parameter(s).</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkAction(null); setChangeReason(''); }}>Cancel</Button>
            <Button className={bulkAction === 'delete' ? 'bg-red-600' : 'bg-blue-600'} disabled={actionLoading} onClick={runBulk}>
              {actionLoading ? 'Processing...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
