'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, UserCheck, UserX, Copy, Database, Trash2,
  RotateCcw, Archive, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { ResetFrequencyBadge } from './reset-frequency-badge';
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
import { canEditDocumentNumbering } from '@/lib/permissions';
import {
  DOCUMENT_NUMBERING_MODULES, DOCUMENT_TYPE_OPTIONS, DEPARTMENT_TYPES, RECORD_STATUSES,
} from '@/lib/admin/constants';
import type { DocumentNumbering } from '@/lib/admin/schemas';
import {
  subscribeToDocumentNumberings, getExtendedSummaryCounts, setDocumentNumberingStatus,
  exportDocumentNumberingsCsv, logDocumentNumberingExport, cloneDocumentNumbering,
  seedDefaultDocumentNumberings, softDeleteDocumentNumbering, restoreDocumentNumbering,
  archiveDocumentNumbering, bulkUpdateDocumentNumberings, bulkSoftDeleteDocumentNumberings,
  importDocumentNumberingsFromFile, canDeleteNumberingRecord,
} from './document-numbering-api';

const PAGE_SIZE = 10;

type ListTab = 'all' | 'inactive' | 'archived' | 'deleted';
type StatusConfirm = { format: DocumentNumbering; activate: boolean } | null;
type BulkAction = 'activate' | 'deactivate' | 'archive' | 'delete' | null;

export function DocumentNumberingsListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditDocumentNumbering(role);

  const [formats, setFormats] = useState<DocumentNumbering[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listTab, setListTab] = useState<ListTab>('all');
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [docTypeFilter, setDocTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [siteFilter, setSiteFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<StatusConfirm>(null);
  const [copySource, setCopySource] = useState<DocumentNumbering | null>(null);
  const [copyCode, setCopyCode] = useState('');
  const [copyName, setCopyName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<DocumentNumbering | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<DocumentNumbering | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState<DocumentNumbering | null>(null);
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
    const unsub = subscribeToDocumentNumberings(
      listTab === 'deleted',
      (next) => {
        setFormats(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );
    return () => unsub();
  }, [listTab]);

  const sites = useMemo(
    () => Array.from(new Set(formats.map((n) => n.site || n.siteCode).filter(Boolean))),
    [formats],
  );

  const tabFiltered = useMemo(() => {
    switch (listTab) {
      case 'inactive':
        return formats.filter((n) => n.status === 'Inactive' && !n.isDeleted && !n.isArchived);
      case 'archived':
        return formats.filter((n) => n.isArchived && !n.isDeleted);
      case 'deleted':
        return formats.filter((n) => n.isDeleted);
      default:
        return formats.filter((n) => !n.isDeleted && !n.isArchived);
    }
  }, [formats, listTab]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tabFiltered.filter((n) => {
      const matchSearch = !q ||
        n.numberingCode?.toLowerCase().includes(q) ||
        n.numberingName?.toLowerCase().includes(q) ||
        n.moduleName?.toLowerCase().includes(q) ||
        n.documentType?.toLowerCase().includes(q) ||
        n.prefix?.toLowerCase().includes(q) ||
        n.department?.toLowerCase().includes(q);
      const matchModule = moduleFilter === 'all' || n.moduleName === moduleFilter;
      const matchDocType = docTypeFilter === 'all' || n.documentType === docTypeFilter;
      const matchStatus = statusFilter === 'all' || n.status === statusFilter;
      const matchDept = departmentFilter === 'all' || n.department === departmentFilter || n.departmentCode === departmentFilter;
      const matchSite = siteFilter === 'all' || n.site === siteFilter || n.siteCode === siteFilter;
      return matchSearch && matchModule && matchDocType && matchStatus && matchDept && matchSite;
    });
  }, [tabFiltered, search, moduleFilter, docTypeFilter, statusFilter, departmentFilter, siteFilter]);

  const stats = getExtendedSummaryCounts(formats);
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
    const csv = exportDocumentNumberingsCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `document-numbering-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logDocumentNumberingExport(auditMeta, filtered.length);
    toast.success('Document numbering list exported');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (changeReason.trim().length < 5) {
      toast.error('Enter a change reason (min 5 chars) before importing');
      e.target.value = '';
      return;
    }
    const result = await importDocumentNumberingsFromFile(file, auditMeta, changeReason);
    if (result.imported) toast.success(`Imported ${result.imported} rule(s)`);
    if (result.errors.length) toast.warning(`${result.errors.length} row(s) failed`);
    e.target.value = '';
  };

  const handleSeed = async () => {
    setSeeding(true);
    const result = await seedDefaultDocumentNumberings(auditMeta);
    setSeeding(false);
    toast.success(`Created ${result.created} rule(s), skipped ${result.skipped}`);
  };

  const runConfirm = async () => {
    if (!confirm?.format.id || !requireReason()) return;
    setActionLoading(true);
    const status = confirm.activate ? 'Active' : 'Inactive';
    const result = await setDocumentNumberingStatus(
      confirm.format.id, confirm.format, status, auditMeta, changeReason,
    );
    setActionLoading(false);
    if (result.success) {
      toast.success(`Rule ${status === 'Active' ? 'activated' : 'deactivated'}`);
      setConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Action failed');
  };

  const runCopy = async () => {
    if (!copySource?.id || !copyCode.trim()) {
      toast.error('New code is required');
      return;
    }
    if (!requireReason()) return;
    setActionLoading(true);
    const result = await cloneDocumentNumbering(
      copySource.id, copyCode.trim(), copyName.trim() || `${copySource.numberingCode}-COPY`,
      auditMeta, changeReason,
    );
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Rule cloned (Inactive — activate when ready)');
      setCopySource(null);
      setChangeReason('');
      if (result.format?.id) window.location.href = `/admin/document-numbering/${result.format.id}`;
    }
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id || !requireReason()) return;
    const check = canDeleteNumberingRecord(deleteConfirm);
    if (!check.allowed) {
      toast.error(check.reason || 'Cannot delete');
      return;
    }
    setActionLoading(true);
    const result = await softDeleteDocumentNumbering(deleteConfirm.id, deleteConfirm, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Numbering rule soft-deleted');
      setDeleteConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Delete failed');
  };

  const runRestore = async () => {
    if (!restoreConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await restoreDocumentNumbering(restoreConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Numbering rule restored');
      setRestoreConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Restore failed');
  };

  const runArchive = async () => {
    if (!archiveConfirm?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await archiveDocumentNumbering(archiveConfirm.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Numbering rule archived');
      setArchiveConfirm(null);
      setChangeReason('');
    } else toast.error(result.error || 'Archive failed');
  };

  const runBulk = async () => {
    if (!bulkAction || selected.length === 0 || !requireReason()) return;
    setActionLoading(true);
    if (bulkAction === 'delete') {
      const result = await bulkSoftDeleteDocumentNumberings(selected, changeReason, auditMeta);
      setActionLoading(false);
      if (result.successCount) toast.success(`Deleted ${result.successCount} rule(s)`);
      if (result.errors?.length) toast.warning(result.errors.join('; '));
      if (result.error) toast.error(result.error);
    } else {
      const result = await bulkUpdateDocumentNumberings(selected, bulkAction, changeReason, auditMeta);
      setActionLoading(false);
      if (result.successCount) toast.success(`Updated ${result.successCount} rule(s)`);
      if (result.errors?.length) toast.warning(result.errors.join('; '));
      if (result.error) toast.error(result.error);
    }
    setBulkAction(null);
    setChangeReason('');
    setSelected([]);
  };

  if (loading) return <div><PageHeader title="Document Numbering" basePath="/admin" /><LoadingSkeleton rows={2} /></div>;
  if (error) return <ErrorCard message={error} onRetry={() => setLoading(true)} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Numbering"
        description="Configure automatic numbering formats for PQR, CPV, and QMS records"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
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
                  <Link href="/admin/document-numbering/create">
                    <Plus className="h-4 w-4 mr-1" />Create New
                  </Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="Active" value={stats.active} />
        <KpiCard label="Inactive" value={stats.inactive} />
        <KpiCard label="Auto Generate" value={stats.autoGenerateEnabled} />
        <KpiCard label="Manual Override" value={stats.manualOverrideEnabled} />
        <KpiCard label="Yearly Reset" value={stats.yearlyReset} />
        <KpiCard label="Archived" value={stats.archived} />
        <KpiCard label="Deleted" value={stats.deleted} />
      </div>

      <Tabs value={listTab} onValueChange={(v) => { setListTab(v as ListTab); setPage(0); setSelected([]); }}>
        <TabsList>
          <TabsTrigger value="all">Active / All</TabsTrigger>
          <TabsTrigger value="inactive">Inactive</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
          <TabsTrigger value="deleted">Deleted</TabsTrigger>
        </TabsList>

        <TabsContent value={listTab} className="mt-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search code, name, module, document type..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    className="pl-9"
                  />
                </div>
                <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[150px]"><SelectValue placeholder="Module" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Modules</SelectItem>
                    {DOCUMENT_NUMBERING_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={docTypeFilter} onValueChange={(v) => { setDocTypeFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[160px]"><SelectValue placeholder="Doc Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Doc Types</SelectItem>
                    {DOCUMENT_TYPE_OPTIONS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={departmentFilter} onValueChange={(v) => { setDepartmentFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Depts</SelectItem>
                    {DEPARTMENT_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={siteFilter} onValueChange={(v) => { setSiteFilter(v); setPage(0); }}>
                  <SelectTrigger className="w-[130px]"><SelectValue placeholder="Site" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sites</SelectItem>
                    {sites.map((s) => <SelectItem key={s} value={s!}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {listTab !== 'deleted' && (
                  <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
                    <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      {RECORD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {canEdit && selected.length > 0 && listTab !== 'deleted' && (
                <div className="flex gap-2 flex-wrap items-center p-2 bg-slate-50 rounded-lg">
                  <span className="text-sm font-medium">{selected.length} selected</span>
                  <Button size="sm" variant="outline" onClick={() => setBulkAction('activate')}>Activate</Button>
                  <Button size="sm" variant="outline" onClick={() => setBulkAction('deactivate')}>Deactivate</Button>
                  <Button size="sm" variant="outline" onClick={() => setBulkAction('archive')}>
                    <Archive className="h-3.5 w-3.5 mr-1" />Archive
                  </Button>
                  {canDelete && (
                    <Button size="sm" variant="destructive" onClick={() => setBulkAction('delete')}>Delete</Button>
                  )}
                </div>
              )}

              <div className="hidden md:block overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      {canEdit && listTab !== 'deleted' && <TableHead className="w-10" />}
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Module</TableHead>
                      <TableHead>Document Type</TableHead>
                      <TableHead>Preview</TableHead>
                      <TableHead>Reset</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={9}><EmptyState title="No numbering rules found" /></TableCell>
                      </TableRow>
                    ) : (
                      paginated.map((row) => (
                        <TableRow key={row.id} className={row.isDeleted ? 'opacity-60 bg-red-50/30' : undefined}>
                          {canEdit && listTab !== 'deleted' && (
                            <TableCell>
                              <Checkbox
                                checked={selected.includes(row.id!)}
                                onCheckedChange={() => row.id && toggleSelect(row.id)}
                                disabled={row.isDeleted}
                              />
                            </TableCell>
                          )}
                          <TableCell className="font-mono text-xs">{row.numberingCode}</TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{row.numberingName || row.numberingCode}</div>
                            {row.isArchived && <span className="text-xs text-amber-600">Archived</span>}
                          </TableCell>
                          <TableCell><ModuleBadge module={row.moduleName} /></TableCell>
                          <TableCell className="text-sm">{row.documentType}</TableCell>
                          <TableCell className="font-mono text-xs max-w-[160px] truncate">{row.exampleNumberPreview}</TableCell>
                          <TableCell><ResetFrequencyBadge value={row.resetFrequency} /></TableCell>
                          <TableCell><StatusBadge status={row.isDeleted ? 'Deleted' : row.status} /></TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button asChild variant="ghost" size="icon">
                                <Link href={`/admin/document-numbering/${row.id}`}><Eye className="h-4 w-4" /></Link>
                              </Button>
                              {canEdit && !row.isDeleted && (
                                <>
                                  <Button asChild variant="ghost" size="icon">
                                    <Link href={`/admin/document-numbering/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => {
                                    setCopySource(row);
                                    setCopyCode(`${row.numberingCode}-COPY`);
                                    setCopyName(`${row.numberingName || row.numberingCode} (Copy)`);
                                    setChangeReason('');
                                  }}><Copy className="h-4 w-4" /></Button>
                                  {row.status === 'Active'
                                    ? (
                                      <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ format: row, activate: false }); }}>
                                        <UserX className="h-4 w-4 text-amber-600" />
                                      </Button>
                                    )
                                    : (
                                      <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ format: row, activate: true }); }}>
                                        <UserCheck className="h-4 w-4 text-green-600" />
                                      </Button>
                                    )}
                                  <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setArchiveConfirm(row); }}>
                                    <Archive className="h-4 w-4" />
                                  </Button>
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
                {paginated.length === 0 ? (
                  <EmptyState title="No numbering rules found" />
                ) : (
                  paginated.map((row) => (
                    <Card key={row.id} className={`border ${row.isDeleted ? 'opacity-60' : ''}`}>
                      <CardContent className="p-4 space-y-2">
                        <div className="flex justify-between">
                          <p className="font-semibold font-mono text-sm">{row.numberingCode}</p>
                          <StatusBadge status={row.isDeleted ? 'Deleted' : row.status} />
                        </div>
                        <p className="text-xs font-mono text-muted-foreground break-all">{row.exampleNumberPreview}</p>
                        <div className="flex flex-wrap gap-2">
                          <ModuleBadge module={row.moduleName} />
                          <ResetFrequencyBadge value={row.resetFrequency} />
                        </div>
                        <p className="text-sm">{row.documentType}</p>
                        <div className="flex gap-2 pt-2 flex-wrap">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/admin/document-numbering/${row.id}`}>View</Link>
                          </Button>
                          {canEdit && !row.isDeleted && (
                            <Button asChild size="sm" variant="outline">
                              <Link href={`/admin/document-numbering/${row.id}/edit`}>Edit</Link>
                            </Button>
                          )}
                          {row.isDeleted && canEdit && (
                            <Button size="sm" variant="outline" onClick={() => { setChangeReason(''); setRestoreConfirm(row); }}>Restore</Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{filtered.length} rules</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
                  <span>Page {currentPage + 1}/{totalPages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!confirm} onOpenChange={() => { setConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirm?.activate ? 'Activate Rule' : 'Deactivate Rule'}</DialogTitle>
            <DialogDescription>
              {confirm?.activate
                ? `Activate "${confirm?.format.numberingCode}"?`
                : `Deactivate "${confirm?.format.numberingCode}"? New records will not use this rule.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button className="bg-blue-600" disabled={actionLoading} onClick={runConfirm}>
              {actionLoading ? 'Processing...' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!copySource} onOpenChange={() => { setCopySource(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone Numbering Rule</DialogTitle>
            <DialogDescription>Create a copy of &quot;{copySource?.numberingCode}&quot; with a new code.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>New Code *</Label>
              <Input value={copyCode} onChange={(e) => setCopyCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>New Name</Label>
              <Input value={copyName} onChange={(e) => setCopyName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Change Reason *</Label>
              <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCopySource(null); setChangeReason(''); }}>Cancel</Button>
            <Button className="bg-blue-600" disabled={actionLoading} onClick={runCopy}>
              {actionLoading ? 'Cloning...' : 'Clone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={() => { setDeleteConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft Delete Numbering Rule</DialogTitle>
            <DialogDescription>
              Soft delete &quot;{deleteConfirm?.numberingCode}&quot;? Deactivate the rule before deleting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button variant="destructive" disabled={actionLoading} onClick={runDelete}>
              {actionLoading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!restoreConfirm} onOpenChange={() => { setRestoreConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Numbering Rule</DialogTitle>
            <DialogDescription>Restore &quot;{restoreConfirm?.numberingCode}&quot;?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRestoreConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button className="bg-green-600" disabled={actionLoading} onClick={runRestore}>
              {actionLoading ? 'Restoring...' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!archiveConfirm} onOpenChange={() => { setArchiveConfirm(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Numbering Rule</DialogTitle>
            <DialogDescription>Archive &quot;{archiveConfirm?.numberingCode}&quot;?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setArchiveConfirm(null); setChangeReason(''); }}>Cancel</Button>
            <Button disabled={actionLoading} onClick={runArchive}>
              {actionLoading ? 'Archiving...' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bulkAction} onOpenChange={() => { setBulkAction(null); setChangeReason(''); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk {bulkAction}</DialogTitle>
            <DialogDescription>Apply to {selected.length} selected rule(s).</DialogDescription>
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
