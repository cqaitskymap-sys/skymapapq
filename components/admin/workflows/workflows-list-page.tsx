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
import { ModuleBadge } from './module-badge';
import { WorkflowTypeBadge } from './workflow-type-badge';
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
  canEditWorkflows, canActivateWorkflows, canRecommendWorkflowChanges,
} from '@/lib/permissions';
import { WORKFLOW_MODULE_OPTIONS, WORKFLOW_TYPES, RECORD_STATUSES } from '@/lib/admin/constants';
import type { Workflow } from '@/lib/admin/schemas';
import {
  subscribeToWorkflows, getWorkflowSummaryCounts, setWorkflowStatus,
  exportWorkflowsCsv, logWorkflowExport, copyWorkflow, seedDefaultWorkflows,
  deleteWorkflow, restoreWorkflow, archiveWorkflow,
  bulkUpdateWorkflows, bulkDeleteWorkflows, importWorkflowsFromFile,
  canDeleteWorkflowRecord,
} from '@/lib/admin/workflow-service';

const PAGE_SIZE = 10;

type StatusConfirm = { wf: Workflow; activate: boolean } | null;
type BulkAction = 'activate' | 'deactivate' | 'archive' | 'delete' | null;

export function WorkflowsListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditWorkflows(role);
  const canActivate = canActivateWorkflows(role);
  const canRecommend = canRecommendWorkflowChanges(role);

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<StatusConfirm>(null);
  const [copySource, setCopySource] = useState<Workflow | null>(null);
  const [copyCode, setCopyCode] = useState('');
  const [copyName, setCopyName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<Workflow | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<Workflow | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<Workflow | null>(null);
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
    const unsub = subscribeToWorkflows(
      showDeleted,
      (next) => {
        setWorkflows(next);
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

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return workflows.filter((w) => {
      const matchSearch = !q ||
        w.workflowCode?.toLowerCase().includes(q) ||
        w.workflowName?.toLowerCase().includes(q) ||
        w.moduleName?.toLowerCase().includes(q) ||
        w.department?.toLowerCase().includes(q) ||
        w.workflowCategory?.toLowerCase().includes(q);
      const matchModule = moduleFilter === 'all' || w.moduleName === moduleFilter;
      const matchType = typeFilter === 'all' || w.workflowType === typeFilter;
      const matchStatus = statusFilter === 'all' || w.status === statusFilter;
      return matchSearch && matchModule && matchType && matchStatus;
    });
  }, [workflows, search, moduleFilter, typeFilter, statusFilter]);

  const stats = getWorkflowSummaryCounts(workflows);
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
    const csv = exportWorkflowsCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflows-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logWorkflowExport(auditMeta, filtered.length);
    toast.success('Workflow list exported');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importWorkflowsFromFile(file, auditMeta);
    if (result.imported) toast.success(`Imported ${result.imported} workflow(s)`);
    if (result.errors.length) toast.warning(`${result.errors.length} row(s) failed`);
    e.target.value = '';
  };

  const handleSeed = async () => {
    setSeeding(true);
    const result = await seedDefaultWorkflows(auditMeta);
    setSeeding(false);
    toast.success(`Created ${result.created} workflow(s), skipped ${result.skipped}`);
  };

  const runConfirm = async () => {
    if (!confirm?.wf.id || !requireReason()) return;
    setActionLoading(true);
    const status = confirm.activate ? 'Active' : 'Inactive';
    const result = await setWorkflowStatus(confirm.wf.id, confirm.wf, status, auditMeta, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success(`Workflow ${status === 'Active' ? 'activated' : 'deactivated'}`);
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
    const result = await copyWorkflow(copySource.id, copyCode.trim(), copyName.trim(), auditMeta, changeReason);
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Workflow cloned (Inactive — activate when ready)');
      setCopySource(null);
      setChangeReason('');
      if (result.workflow?.id) window.location.href = `/admin/workflows/${result.workflow.id}`;
    }
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id || !requireReason()) return;
    const check = canDeleteWorkflowRecord(deleteConfirm);
    if (!check.allowed) {
      toast.error(check.reason || 'Cannot delete');
      return;
    }
    setActionLoading(true);
    const result = await deleteWorkflow(deleteConfirm.id, deleteConfirm, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Workflow soft-deleted');
      setDeleteConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Delete failed');
  };

  const runRestore = async () => {
    if (!restoreConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await restoreWorkflow(restoreConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Workflow restored');
      setRestoreConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Restore failed');
  };

  const runArchive = async () => {
    if (!archiveConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await archiveWorkflow(archiveConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Workflow archived');
      setArchiveConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Archive failed');
  };

  const runBulk = async () => {
    if (!bulkAction || selected.length === 0 || !requireReason()) return;
    setActionLoading(true);
    if (bulkAction === 'delete') {
      const result = await bulkDeleteWorkflows(selected, changeReason);
      setActionLoading(false);
      if (result.successCount) toast.success(`Deleted ${result.successCount} workflow(s)`);
      if (result.errors?.length) toast.warning(result.errors.join('; '));
      if (result.error) toast.error(result.error);
    } else {
      const result = await bulkUpdateWorkflows(selected, bulkAction, changeReason);
      setActionLoading(false);
      if (result.successCount) toast.success(`Updated ${result.successCount} workflow(s)`);
      if (result.error) toast.error(result.error);
    }
    setBulkAction(null);
    setChangeReason('');
    setSelected([]);
  };

  if (loading) return <div><PageHeader title="Workflow Configuration" basePath="/admin" /><LoadingSkeleton rows={2} /></div>;
  if (error) return <ErrorCard message={error} onRetry={() => setLoading(true)} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Workflow Configuration"
        description="Configure approval, investigation, and execution workflows for all SkyMap QMS modules"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/approval-matrix"><GitBranch className="h-4 w-4 mr-1" />Approval Matrix</Link>
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
                  <Link href="/admin/workflows/create"><Plus className="h-4 w-4 mr-1" />Create Workflow</Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      {canRecommend && !canEdit && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-3 text-sm text-amber-800">
            You can recommend workflow changes to Admin. Contact Super Admin / Admin to publish configuration updates.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="Active" value={stats.active} />
        <KpiCard label="Inactive" value={stats.inactive} />
        <KpiCard label="Multi-Level" value={stats.multiLevel} />
        <KpiCard label="E-Sign" value={stats.eSignRequired} />
        <KpiCard label="Escalation" value={stats.escalationEnabled} />
        <KpiCard label="Archived" value={stats.archived} />
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Workflow List</TabsTrigger>
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
                    {WORKFLOW_MODULE_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[200px]"><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {WORKFLOW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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
                  <Checkbox id="showDeletedWf" checked={showDeleted} onCheckedChange={(v) => setShowDeleted(Boolean(v))} />
                  <Label htmlFor="showDeletedWf" className="text-sm">Show deleted</Label>
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
                      <TableHead>Type</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Levels</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow><TableCell colSpan={9}><EmptyState title="No workflows found" /></TableCell></TableRow>
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
                          <TableCell className="font-mono text-xs">{row.workflowCode}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{row.workflowName}</div>
                            {row.isArchived && <span className="text-xs text-amber-600">Archived</span>}
                          </TableCell>
                          <TableCell><ModuleBadge module={row.moduleName} /></TableCell>
                          <TableCell><WorkflowTypeBadge type={row.workflowType} /></TableCell>
                          <TableCell className="text-xs">{row.workflowVersion || '1.0'}</TableCell>
                          <TableCell>{row.approvalLevels}</TableCell>
                          <TableCell><StatusBadge status={row.isDeleted ? 'Deleted' : row.status} /></TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="ghost" size="icon"><Link href={`/admin/workflows/${row.id}`}><Eye className="h-4 w-4" /></Link></Button>
                              {canEdit && !row.isDeleted && (
                                <>
                                  <Button asChild variant="ghost" size="icon"><Link href={`/admin/workflows/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
                                  <Button variant="ghost" size="icon" onClick={() => {
                                    setCopySource(row);
                                    setCopyCode(`${row.workflowCode}-COPY`);
                                    setCopyName(`${row.workflowName} (Copy)`);
                                    setChangeReason('');
                                  }}><Copy className="h-4 w-4" /></Button>
                                  {canActivate && (
                                    row.status === 'Active'
                                      ? <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ wf: row, activate: false }); }}><UserX className="h-4 w-4 text-amber-600" /></Button>
                                      : <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ wf: row, activate: true }); }}><UserCheck className="h-4 w-4 text-green-600" /></Button>
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

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{filtered.length} workflows</span>
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
              {['PQR-DEFAULT', 'DEV-DEFAULT', 'OOS-DEFAULT', 'CAPA-DEFAULT', 'CC-DEFAULT', 'DMS-DEFAULT', 'TRN-DEFAULT'].map((code) => {
                const existing = workflows.find((w) => w.workflowCode === code);
                return (
                  <div key={code} className="border rounded-lg p-4">
                    <p className="font-medium font-mono text-sm">{code}</p>
                    <p className="text-xs text-muted-foreground mt-1">{existing ? 'Installed' : 'Available via Seed Defaults'}</p>
                    {existing && (
                      <Button asChild size="sm" variant="outline" className="mt-2">
                        <Link href={`/admin/workflows/${existing.id}`}>Open</Link>
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
              {WORKFLOW_MODULE_OPTIONS.map((mod) => {
                const count = filtered.filter((w) => w.moduleName === mod).length;
                if (!count) return null;
                return (
                  <div key={mod} className="border rounded-lg p-4">
                    <p className="font-medium">{mod}</p>
                    <p className="text-2xl font-bold text-blue-600">{count}</p>
                    <p className="text-xs text-muted-foreground">configured workflow(s)</p>
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
            <DialogTitle>{confirm?.activate ? 'Activate Workflow' : 'Deactivate Workflow'}</DialogTitle>
            <DialogDescription>
              {confirm?.activate
                ? `Activate "${confirm?.wf.workflowName}"? Only one active workflow should typically exist per module.`
                : `Deactivate "${confirm?.wf.workflowName}"? In-flight records retain their snapshot; new records will not use this workflow.`}
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
            <DialogTitle>Clone Workflow</DialogTitle>
            <DialogDescription>Create a copy of &quot;{copySource?.workflowName}&quot; with a new code.</DialogDescription>
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
            <DialogTitle>Soft Delete Workflow</DialogTitle>
            <DialogDescription>
              Soft delete &quot;{deleteConfirm?.workflowName}&quot;? Linked QMS records will prevent deletion.
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
            <DialogTitle>Restore Workflow</DialogTitle>
            <DialogDescription>Restore &quot;{restoreConfirm?.workflowName}&quot;?</DialogDescription>
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
            <DialogTitle>Archive Workflow</DialogTitle>
            <DialogDescription>Archive &quot;{archiveConfirm?.workflowName}&quot;?</DialogDescription>
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
            <DialogDescription>Apply to {selected.length} selected workflow(s).</DialogDescription>
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
