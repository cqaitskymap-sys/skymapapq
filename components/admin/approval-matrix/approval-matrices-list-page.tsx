'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, UserCheck, UserX, Copy, Database, Trash2,
  RotateCcw, Archive, Upload, GitBranch,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { RiskBadge } from './risk-badge';
import { DepartmentBadge } from './department-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  canEditApprovalMatrix, canActivateApprovalMatrix, canRecommendWorkflowChanges,
} from '@/lib/permissions';
import { APPROVAL_MATRIX_MODULES, RISK_LEVELS, RECORD_STATUSES } from '@/lib/admin/constants';
import type { ApprovalMatrix } from '@/lib/admin/schemas';
import {
  subscribeToApprovalMatrices, getApprovalMatrixSummaryCounts, setApprovalMatrixStatus,
  exportApprovalMatricesCsv, logApprovalMatrixExport, copyApprovalMatrix, seedDefaultApprovalMatrices,
  deleteApprovalMatrix, restoreApprovalMatrix, archiveApprovalMatrix,
  bulkUpdateApprovalMatrices, bulkDeleteApprovalMatrices, importApprovalMatricesFromFile,
  canDeleteMatrixRecord, DEFAULT_APPROVAL_MATRIX_PRESETS,
} from '@/lib/admin/approval-matrix-service';

const PAGE_SIZE = 10;

type StatusConfirm = { matrix: ApprovalMatrix; activate: boolean } | null;
type BulkAction = 'activate' | 'deactivate' | 'archive' | 'delete' | null;

export function ApprovalMatricesListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditApprovalMatrix(role);
  const canActivate = canActivateApprovalMatrix(role);
  const canRecommend = canRecommendWorkflowChanges(role);

  const [matrices, setMatrices] = useState<ApprovalMatrix[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [riskFilter, setRiskFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<StatusConfirm>(null);
  const [copySource, setCopySource] = useState<ApprovalMatrix | null>(null);
  const [copyCode, setCopyCode] = useState('');
  const [copyName, setCopyName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<ApprovalMatrix | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<ApprovalMatrix | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<ApprovalMatrix | null>(null);
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
    const unsub = subscribeToApprovalMatrices(
      showDeleted,
      (next) => {
        setMatrices(next);
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

  const sites = useMemo(
    () => Array.from(new Set(matrices.map((m) => m.siteLocation).filter(Boolean))),
    [matrices],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return matrices.filter((m) => {
      const matchSearch = !q ||
        m.matrixCode?.toLowerCase().includes(q) ||
        m.matrixName?.toLowerCase().includes(q) ||
        m.moduleName?.toLowerCase().includes(q) ||
        m.department?.toLowerCase().includes(q) ||
        m.category?.toLowerCase().includes(q) ||
        m.workflowCode?.toLowerCase().includes(q);
      const matchModule = moduleFilter === 'all' || m.moduleName === moduleFilter;
      const matchRisk = riskFilter === 'all' || m.riskLevel === riskFilter;
      const matchStatus = statusFilter === 'all' || m.status === statusFilter;
      const matchSite = siteFilter === 'all' || m.siteLocation === siteFilter || !m.siteLocation;
      return matchSearch && matchModule && matchRisk && matchStatus && matchSite;
    });
  }, [matrices, search, moduleFilter, riskFilter, statusFilter, siteFilter]);

  const stats = getApprovalMatrixSummaryCounts(matrices);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const requireReason = () => {
    if (changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return false;
    }
    return true;
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleExport = async () => {
    const csv = exportApprovalMatricesCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `approval-matrix-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logApprovalMatrixExport(auditMeta, filtered.length);
    toast.success('Approval matrix list exported');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importApprovalMatricesFromFile(file, auditMeta);
    if (result.imported) toast.success(`Imported ${result.imported} matrix(es)`);
    if (result.errors.length) toast.warning(`${result.errors.length} row(s) failed`);
    e.target.value = '';
  };

  const handleSeed = async () => {
    setSeeding(true);
    const result = await seedDefaultApprovalMatrices(auditMeta);
    setSeeding(false);
    toast.success(`Created ${result.created} matrix(es), skipped ${result.skipped}`);
  };

  const runConfirm = async () => {
    if (!confirm?.matrix.id || !requireReason()) return;
    setActionLoading(true);
    const status = confirm.activate ? 'Active' : 'Inactive';
    const result = await setApprovalMatrixStatus(
      confirm.matrix.id, confirm.matrix, status, auditMeta, changeReason,
    );
    setActionLoading(false);
    if (result.success) {
      toast.success(`Matrix ${status === 'Active' ? 'activated' : 'deactivated'}`);
      setConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Action failed');
  };

  const runCopy = async () => {
    if (!copySource?.id || !copyCode.trim() || !copyName.trim()) {
      toast.error('New code and name are required');
      return;
    }
    if (!requireReason()) return;
    setActionLoading(true);
    const result = await copyApprovalMatrix(
      copySource.id, copyCode.trim(), copyName.trim(), auditMeta, changeReason,
    );
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Matrix cloned (Inactive — activate when ready)');
      setCopySource(null);
      setChangeReason('');
      if (result.matrix?.id) window.location.href = `/admin/approval-matrix/${result.matrix.id}`;
    }
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id || !requireReason()) return;
    const check = canDeleteMatrixRecord(deleteConfirm);
    if (!check.allowed) {
      toast.error(check.reason || 'Cannot delete');
      return;
    }
    setActionLoading(true);
    const result = await deleteApprovalMatrix(deleteConfirm.id, deleteConfirm, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Approval matrix soft-deleted');
      setDeleteConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Delete failed');
  };

  const runRestore = async () => {
    if (!restoreConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await restoreApprovalMatrix(restoreConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Approval matrix restored');
      setRestoreConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Restore failed');
  };

  const runArchive = async () => {
    if (!archiveConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await archiveApprovalMatrix(archiveConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Approval matrix archived');
      setArchiveConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Archive failed');
  };

  const runBulk = async () => {
    if (!bulkAction || selected.length === 0 || !requireReason()) return;
    setActionLoading(true);
    if (bulkAction === 'delete') {
      const result = await bulkDeleteApprovalMatrices(selected, changeReason);
      setActionLoading(false);
      if (result.successCount) toast.success(`Deleted ${result.successCount} matrix(es)`);
      if (result.errors?.length) toast.warning(result.errors.join('; '));
      if (result.error) toast.error(result.error);
    } else {
      const result = await bulkUpdateApprovalMatrices(selected, bulkAction, changeReason);
      setActionLoading(false);
      if (result.successCount) toast.success(`Updated ${result.successCount} matrix(es)`);
      if (result.error) toast.error(result.error);
    }
    setBulkAction(null);
    setChangeReason('');
    setSelected([]);
  };

  if (loading) return <div><PageHeader title="Approval Matrix" basePath="/admin" /><LoadingSkeleton rows={2} /></div>;
  if (error) return <ErrorCard message={error} onRetry={() => setLoading(true)} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval Matrix"
        description="Module-wise and department-wise approval authority for PQR, CPV, and QMS"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/workflows"><GitBranch className="h-4 w-4 mr-1" />Workflows</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <label className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-1" />Import CSV
                    <input type="file" accept=".csv" className="hidden" onChange={handleImport} />
                  </label>
                </Button>
                <Button variant="outline" size="sm" disabled={seeding} onClick={handleSeed}>
                  <Database className="h-4 w-4 mr-1" />{seeding ? 'Seeding...' : 'Seed Defaults'}
                </Button>
                <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <Link href="/admin/approval-matrix/create"><Plus className="h-4 w-4 mr-1" />Create Matrix</Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      {canRecommend && !canEdit && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-3 text-sm text-amber-800">
            You can recommend approval matrix changes to Admin. Contact Super Admin / Admin to publish configuration updates.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="Active" value={stats.active} />
        <KpiCard label="Inactive" value={stats.inactive} />
        <KpiCard label="Critical" value={stats.critical} />
        <KpiCard label="E-Sign Req." value={stats.eSignRequired} />
        <KpiCard label="Dept-wise" value={stats.departmentWise} />
        <KpiCard label="Product-specific" value={stats.productSpecific} />
        <KpiCard label="Archived" value={stats.archived} />
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Matrix List</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="by-module">By Module</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search code, name, module, category..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    className="pl-9"
                  />
                </div>
                <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Module" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Modules</SelectItem>
                    {APPROVAL_MATRIX_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={riskFilter} onValueChange={(v) => { setRiskFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[130px]"><SelectValue placeholder="Risk" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Risk</SelectItem>
                    {RISK_LEVELS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={siteFilter} onValueChange={(v) => { setSiteFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Site" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sites</SelectItem>
                    {sites.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
                  <Checkbox id="showDeletedAmx" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(Boolean(v))} />
                  <Label htmlFor="showDeletedAmx" className="text-sm">Show deleted</Label>
                </div>
              </div>

              {canEdit && selected.length > 0 && (
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
                      {canEdit && <TableHead className="w-10" />}
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Risk</TableHead>
                      <TableHead>Final Approver</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow><TableCell colSpan={9}><EmptyState title="No approval matrices found" /></TableCell></TableRow>
                    ) : (
                      paginated.map((row) => (
                        <TableRow key={row.id} className={row.isDeleted ? 'opacity-60 bg-red-50/30' : undefined}>
                          {canEdit && (
                            <TableCell>
                              <Checkbox
                                checked={selected.includes(row.id!)}
                                onCheckedChange={() => row.id && toggleSelect(row.id)}
                                disabled={row.isDeleted}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">{row.matrixCode}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{row.matrixName}</div>
                            {row.isArchived && <span className="text-xs text-amber-600">Archived</span>}
                          </TableCell>
                          <TableCell><ModuleBadge module={row.moduleName} /></TableCell>
                          <TableCell><DepartmentBadge department={row.department} /></TableCell>
                          <TableCell><RiskBadge risk={row.riskLevel} /></TableCell>
                          <TableCell className="text-xs">{row.finalApproverRole?.replace(/_/g, ' ') || '-'}</TableCell>
                          <TableCell><StatusBadge status={row.isDeleted ? 'Deleted' : row.status} /></TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="ghost" size="icon"><Link href={`/admin/approval-matrix/${row.id}`}><Eye className="h-4 w-4" /></Link></Button>
                              {canEdit && !row.isDeleted && (
                                <>
                                  <Button asChild variant="ghost" size="icon"><Link href={`/admin/approval-matrix/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
                                  <Button variant="ghost" size="icon" onClick={() => {
                                    setCopySource(row);
                                    setCopyCode(`${row.matrixCode}-COPY`);
                                    setCopyName(`${row.matrixName} (Copy)`);
                                    setChangeReason('');
                                  }}><Copy className="h-4 w-4" /></Button>
                                  {canActivate && (
                                    row.status === 'Active'
                                      ? <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ matrix: row, activate: false }); }}><UserX className="h-4 w-4 text-amber-600" /></Button>
                                      : <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ matrix: row, activate: true }); }}><UserCheck className="h-4 w-4 text-green-600" /></Button>
                                  )}
                                  <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setArchiveConfirm(row); }}><Archive className="h-4 w-4" /></Button>
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

              <div className="md:hidden space-y-3">
                {paginated.map((row) => (
                  <Card key={row.id} className={`border ${row.isDeleted ? 'opacity-60' : ''}`}>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex justify-between">
                        <p className="font-semibold">{row.matrixName}</p>
                        <StatusBadge status={row.isDeleted ? 'Deleted' : row.status} />
                      </div>
                      <p className="text-xs font-mono text-muted-foreground">{row.matrixCode}</p>
                      <div className="flex flex-wrap gap-2">
                        <ModuleBadge module={row.moduleName} />
                        <RiskBadge risk={row.riskLevel} />
                        <DepartmentBadge department={row.department} />
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button asChild size="sm" variant="outline"><Link href={`/admin/approval-matrix/${row.id}`}>View</Link></Button>
                        {canEdit && !row.isDeleted && (
                          <Button asChild size="sm" variant="outline"><Link href={`/admin/approval-matrix/${row.id}/edit`}>Edit</Link></Button>
                        )}
                        {canDelete && !row.isDeleted && (
                          <Button size="sm" variant="destructive" onClick={() => { setChangeReason(''); setDeleteConfirm(row); }}>Delete</Button>
                        )}
                        {row.isDeleted && canEdit && (
                          <Button size="sm" variant="outline" onClick={() => { setChangeReason(''); setRestoreConfirm(row); }}>Restore</Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{filtered.length} matrices</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                  <span>Page {currentPage + 1}/{totalPages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          <Card>
            <CardContent className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {DEFAULT_APPROVAL_MATRIX_PRESETS.map((preset) => {
                const existing = matrices.find((m) => m.matrixCode === preset.matrixCode);
                return (
                  <div key={preset.matrixCode} className="border rounded-lg p-4">
                    <p className="font-medium font-mono text-sm">{preset.matrixCode}</p>
                    <p className="text-xs text-muted-foreground mt-1">{preset.matrixName}</p>
                    <p className="text-xs text-muted-foreground mt-1">{existing ? 'Installed' : 'Available via Seed Defaults'}</p>
                    {existing && (
                      <Button asChild size="sm" variant="outline" className="mt-2">
                        <Link href={`/admin/approval-matrix/${existing.id}`}>Open</Link>
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="by-module" className="mt-4">
          <Card>
            <CardContent className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {APPROVAL_MATRIX_MODULES.map((mod) => {
                const count = filtered.filter((m) => m.moduleName === mod).length;
                if (!count) return null;
                return (
                  <div key={mod} className="border rounded-lg p-4">
                    <p className="font-medium">{mod}</p>
                    <p className="text-2xl font-bold text-blue-600">{count}</p>
                    <p className="text-xs text-muted-foreground">configured matrix(es)</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!confirm} onOpenChange={() => { setConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.activate ? 'Activate Matrix' : 'Deactivate Matrix'}</DialogTitle>
            <DialogDescription>
              {confirm?.activate
                ? `Activate "${confirm?.matrix.matrixName}"?`
                : `Deactivate "${confirm?.matrix.matrixName}"? New records will not use this matrix.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button className="bg-blue-600" disabled={actionLoading} onClick={runConfirm}>{actionLoading ? 'Processing...' : 'Confirm'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!copySource} onOpenChange={() => { setCopySource(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone Approval Matrix</DialogTitle>
            <DialogDescription>Create a copy of &quot;{copySource?.matrixName}&quot; with a new code.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>New Code *</Label>
              <Input value={copyCode} onChange={(e) => setCopyCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>New Name *</Label>
              <Input value={copyName} onChange={(e) => setCopyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Change Reason *</Label>
              <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCopySource(null); setChangeReason(''); }}>Cancel</Button>
            <Button className="bg-blue-600" disabled={actionLoading} onClick={runCopy}>{actionLoading ? 'Cloning...' : 'Clone'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => { setDeleteConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft Delete Approval Matrix</DialogTitle>
            <DialogDescription>
              Soft delete &quot;{deleteConfirm?.matrixName}&quot;? Deactivate the matrix before deleting.
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
            <DialogTitle>Restore Approval Matrix</DialogTitle>
            <DialogDescription>Restore &quot;{restoreConfirm?.matrixName}&quot;?</DialogDescription>
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
            <DialogTitle>Archive Approval Matrix</DialogTitle>
            <DialogDescription>Archive &quot;{archiveConfirm?.matrixName}&quot;?</DialogDescription>
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
            <DialogDescription>Apply to {selected.length} selected matrix(es).</DialogDescription>
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
