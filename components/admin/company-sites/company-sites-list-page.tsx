'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, UserCheck, UserX, Star, Trash2, RotateCcw,
  Upload, Network, Building2, MapPin, Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { SiteTypeBadge } from './site-type-badge';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditCompanySites } from '@/lib/permissions';
import { SITE_TYPES, RECORD_STATUSES } from '@/lib/admin/constants';
import type { CompanySite } from '@/lib/admin/schemas';
import {
  subscribeToCompanySites, setCompanySiteStatus, setDefaultCompanySite,
  exportCompanySitesCsv, logCompanySiteExport, deleteCompanySite, restoreCompanySite,
  bulkUpdateCompanySites, bulkDeleteCompanySites, importCompanySites, parseCompanySiteImportCsv,
  buildCompanyHierarchy, buildBusinessUnitGroups, buildSiteMap, canDeleteCompanySiteRecord, isSystemSite,
} from '@/lib/admin/company-site-service';

const PAGE_SIZE = 10;

type ConfirmState = {
  type: 'activate' | 'deactivate' | 'default';
  site: CompanySite;
} | null;

export function CompanySitesListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditCompanySites(role);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [sites, setSites] = useState<CompanySite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [changeReason, setChangeReason] = useState('');

  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<CompanySite | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState<CompanySite | null>(null);
  const [bulkAction, setBulkAction] = useState<'activate' | 'deactivate' | 'delete' | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importReason, setImportReason] = useState('');

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
    role,
  };

  useEffect(() => {
    setLoading(true);
    const unsubscribe = subscribeToCompanySites(
      showDeleted,
      (next) => {
        setSites(next);
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

  const companies = useMemo(() => {
    const map = new Map<string, string>();
    sites.forEach((site) => {
      if (site.companyCode) map.set(site.companyCode, site.companyName);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [sites]);

  const hierarchy = useMemo(() => buildCompanyHierarchy(sites), [sites]);
  const businessUnits = useMemo(() => buildBusinessUnitGroups(sites), [sites]);
  const siteMap = useMemo(() => buildSiteMap(sites), [sites]);

  const filtered = useMemo(() => {
    const queryText = search.toLowerCase();
    return sites.filter((site) => {
      const matchSearch = !queryText
        || site.companyName?.toLowerCase().includes(queryText)
        || site.siteName?.toLowerCase().includes(queryText)
        || site.companyCode?.toLowerCase().includes(queryText)
        || site.siteCode?.toLowerCase().includes(queryText)
        || site.businessUnit?.toLowerCase().includes(queryText);
      const matchStatus = statusFilter === 'all' || site.status === statusFilter;
      const matchType = typeFilter === 'all' || site.siteType === typeFilter;
      const matchCompany = companyFilter === 'all' || site.companyCode === companyFilter;
      return matchSearch && matchStatus && matchType && matchCompany;
    });
  }, [sites, search, statusFilter, typeFilter, companyFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleExport = async () => {
    const csv = exportCompanySitesCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `company-sites-export-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    await logCompanySiteExport(auditMeta, filtered.length);
    toast.success('Company/site list exported');
  };

  const runConfirm = async () => {
    if (!confirm || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionBusy(true);
    if (confirm.type === 'default') {
      const result = await setDefaultCompanySite(confirm.site.id!, confirm.site, auditMeta, changeReason);
      if (result.success) toast.success('Default site updated');
      else toast.error(result.error || 'Failed');
    } else {
      const status = confirm.type === 'activate' ? 'Active' : 'Inactive';
      const result = await setCompanySiteStatus(confirm.site.id!, confirm.site, status, auditMeta, changeReason);
      if (result.success) {
        if (status === 'Inactive') toast.warning('Inactive site — new records cannot use this site');
        else toast.success('Site activated');
      } else toast.error(result.error || 'Action failed');
    }
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
    const result = await deleteCompanySite(deleteConfirm.id, deleteConfirm, changeReason);
    if (result.success) toast.success('Site soft-deleted');
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
    const result = await restoreCompanySite(restoreConfirm.id, changeReason);
    if (result.success) toast.success('Site restored');
    else toast.error(result.error || 'Restore failed');
    setActionBusy(false);
    setRestoreConfirm(null);
    setChangeReason('');
  };

  const runBulk = async () => {
    if (!bulkAction || selected.length === 0 || changeReason.trim().length < 5) {
      toast.error('Select sites and provide a change reason (min 5 characters)');
      return;
    }
    setActionBusy(true);
    if (bulkAction === 'delete') {
      const result = await bulkDeleteCompanySites(selected, changeReason);
      if (result.error) toast.error(result.error);
      else {
        toast.success(`${result.successCount} site(s) soft-deleted`);
        if (result.errors.length > 0) toast.warning(`${result.errors.length} site(s) skipped`);
      }
    } else {
      const result = await bulkUpdateCompanySites(selected, bulkAction, changeReason);
      if (result.error) toast.error(result.error);
      else toast.success(`${result.successCount} site(s) updated`);
    }
    setActionBusy(false);
    setBulkAction(null);
    setSelected([]);
    setChangeReason('');
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || importReason.trim().length < 5) {
      toast.error('Select a CSV file and provide import reason (min 5 characters)');
      return;
    }
    setActionBusy(true);
    const text = await file.text();
    const rows = parseCompanySiteImportCsv(text);
    if (rows.length === 0) {
      toast.error('No valid rows found in CSV');
      setActionBusy(false);
      return;
    }
    const result = await importCompanySites(rows, importReason);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`Imported ${result.successCount} site(s)`);
      if (result.errors.length > 0) toast.warning(`${result.errors.length} row(s) failed`);
    }
    setActionBusy(false);
    setImportOpen(false);
    setImportReason('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Company / Site Master" basePath="/admin" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  if (error) return <ErrorCard message={error} onRetry={() => window.location.reload()} />;

  const renderActions = (row: CompanySite) => (
    <div className="flex justify-end gap-1">
      <Button asChild variant="ghost" size="icon"><Link href={`/admin/company-site/${row.id}`}><Eye className="h-4 w-4" /></Link></Button>
      {canEdit && !row.isDeleted && (
        <>
          <Button asChild variant="ghost" size="icon"><Link href={`/admin/company-site/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link></Button>
          {!row.isDefault && row.status === 'Active' && (
            <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ type: 'default', site: row }); }}>
              <Star className="h-4 w-4 text-blue-600" />
            </Button>
          )}
          {row.status === 'Active'
            ? <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ type: 'deactivate', site: row }); }}><UserX className="h-4 w-4 text-amber-600" /></Button>
            : <Button variant="ghost" size="icon" onClick={() => { setChangeReason(''); setConfirm({ type: 'activate', site: row }); }}><UserCheck className="h-4 w-4 text-green-600" /></Button>}
          {canDelete && canDeleteCompanySiteRecord(row).allowed && (
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
        title="Company / Site Master"
        description="Manage multi-company and multi-site configuration for document headers and site-specific QMS operations"
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1" />Import</Button>
                <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                  <Link href="/admin/company-site/create"><Plus className="h-4 w-4 mr-1" />Create Site</Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <Tabs defaultValue="sites">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="sites">Site List</TabsTrigger>
          <TabsTrigger value="companies">Companies</TabsTrigger>
          <TabsTrigger value="business-units">Business Units</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
          <TabsTrigger value="site-map">Site Map</TabsTrigger>
        </TabsList>

        <TabsContent value="sites" className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search company, site, code, or business unit..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="pl-9" />
                </div>
                <Select value={companyFilter} onValueChange={(value) => { setCompanyFilter(value); setPage(0); }}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Company" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Companies</SelectItem>
                    {companies.map(([code, name]) => <SelectItem key={code} value={code}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(0); }}>
                  <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {RECORD_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={(value) => { setTypeFilter(value); setPage(0); }}>
                  <SelectTrigger className="w-[180px]"><SelectValue placeholder="Site Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {SITE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={showDeleted} onCheckedChange={(checked) => setShowDeleted(Boolean(checked))} />
                  Show deleted
                </label>
                {canEdit && selected.length > 0 && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => { setChangeReason(''); setBulkAction('activate'); }}>Bulk Activate</Button>
                    <Button size="sm" variant="outline" onClick={() => { setChangeReason(''); setBulkAction('deactivate'); }}>Bulk Deactivate</Button>
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
                      <TableHead>Company</TableHead>
                      <TableHead>Site</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow><TableCell colSpan={7}><EmptyState title="No company/sites found" /></TableCell></TableRow>
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
                          <TableCell>
                            <div className="font-medium">{row.companyName}</div>
                            <div className="text-xs text-muted-foreground font-mono">{row.companyCode}</div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.siteName}</div>
                            <div className="text-xs text-muted-foreground font-mono">{row.siteCode}</div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {row.isDefault && <Badge className="text-[10px] bg-blue-100 text-blue-700">Default</Badge>}
                              {isSystemSite(row) && <Badge variant="outline" className="text-[10px]">System</Badge>}
                              {row.isDeleted && <Badge variant="destructive" className="text-[10px]">Deleted</Badge>}
                            </div>
                          </TableCell>
                          <TableCell><SiteTypeBadge type={row.siteType} /></TableCell>
                          <TableCell className="text-sm">{row.city}{row.state ? `, ${row.state}` : ''}</TableCell>
                          <TableCell><StatusBadge status={row.status} /></TableCell>
                          <TableCell>{renderActions(row)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{filtered.length} site(s)</span>
                <div className="flex gap-2 items-center">
                  <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((prev) => prev - 1)}>Prev</Button>
                  <span>Page {currentPage + 1}/{totalPages}</span>
                  <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((prev) => prev + 1)}>Next</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="companies">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {hierarchy.length === 0 ? (
              <EmptyState title="No companies configured" />
            ) : (
              hierarchy.map((group) => (
                <Card key={group.companyCode}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {group.companyName}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground font-mono">{group.companyCode}</p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm text-muted-foreground">{group.sites.length} site(s)</p>
                    {group.sites.map((site) => (
                      <Link key={site.id} href={`/admin/company-site/${site.id}`} className="block p-2 border rounded hover:bg-muted/50 text-sm">
                        {site.siteName} · {site.siteCode}
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="business-units">
          <div className="grid gap-4 md:grid-cols-2">
            {businessUnits.length === 0 ? (
              <EmptyState title="No business units configured" />
            ) : (
              businessUnits.map((group) => (
                <Card key={`${group.companyName}-${group.businessUnit}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Briefcase className="h-4 w-4" />
                      {group.businessUnit}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">{group.companyName}</p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {group.sites.map((site) => (
                      <Link key={site.id} href={`/admin/company-site/${site.id}`} className="block p-2 border rounded hover:bg-muted/50 text-sm">
                        {site.siteName} · {site.siteCode}
                      </Link>
                    ))}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="hierarchy">
          <Card>
            <CardContent className="p-4 space-y-3">
              {hierarchy.length === 0 ? (
                <EmptyState title="No hierarchy to display" />
              ) : (
                hierarchy.map((group) => (
                  <div key={group.companyCode} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 font-semibold">
                      <Network className="h-4 w-4" />
                      {group.companyName}
                      <span className="text-xs text-muted-foreground font-mono">({group.companyCode})</span>
                    </div>
                    <div className="mt-3 ml-6 space-y-2 border-l pl-4">
                      {group.sites.map((site) => (
                        <div key={site.id} className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-medium">{site.siteName}</p>
                            <p className="text-xs text-muted-foreground">{site.siteType} · {site.businessUnit || '—'}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={site.status} />
                            <Button asChild size="sm" variant="outline"><Link href={`/admin/company-site/${site.id}`}>View</Link></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="site-map">
          <Card>
            <CardContent className="p-4 space-y-4">
              {siteMap.length === 0 ? (
                <EmptyState title="No geographic site data" />
              ) : (
                siteMap.map((region) => (
                  <div key={region.country} className="border rounded-lg p-4">
                    <div className="flex items-center gap-2 font-semibold mb-3">
                      <MapPin className="h-4 w-4" />
                      {region.country}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {region.states.map((stateGroup) => (
                        <div key={`${region.country}-${stateGroup.state}`} className="rounded border p-3">
                          <p className="font-medium text-sm mb-2">{stateGroup.state}</p>
                          <div className="space-y-1">
                            {stateGroup.sites.map((site) => (
                              <Link key={site.id} href={`/admin/company-site/${site.id}`} className="block text-sm text-blue-600 hover:underline">
                                {site.siteName} ({site.city || '—'})
                              </Link>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirm} onOpenChange={() => setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === 'default' ? 'Set Default Site'
                : confirm?.type === 'activate' ? 'Activate Site' : 'Deactivate Site'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === 'default'
                ? `Set "${confirm?.site.siteName}" as the default site for document headers?`
                : confirm?.type === 'activate'
                  ? `Activate site "${confirm?.site.siteName}"?`
                  : `Deactivate "${confirm?.site.siteName}"? Existing records remain viewable; new QMS records cannot use this site.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} rows={2} />
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
            <AlertDialogTitle>Soft Delete Site</AlertDialogTitle>
            <AlertDialogDescription>
              Soft-delete &quot;{deleteConfirm?.siteName}&quot;? Linked users, departments, or designations will block deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} rows={2} />
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
            <AlertDialogTitle>Restore Site</AlertDialogTitle>
            <AlertDialogDescription>Restore &quot;{restoreConfirm?.siteName}&quot; to Active status?</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} rows={2} />
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
                : `Bulk ${bulkAction === 'activate' ? 'Activate' : 'Deactivate'}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkAction === 'delete'
                ? `${selected.length} site(s) selected. System, default, or linked sites will be skipped.`
                : `${selected.length} site(s) selected.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runBulk} disabled={actionBusy} className={bulkAction === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600'}>
              {actionBusy ? 'Processing…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={importOpen} onOpenChange={setImportOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Import Company / Sites</AlertDialogTitle>
            <AlertDialogDescription>
              Upload CSV with columns: Company Code, Company Name, Site Code, Site Name, Address, City, State, Country.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2">
              <Label>Import Reason *</Label>
              <Textarea value={importReason} onChange={(event) => setImportReason(event.target.value)} rows={2} />
            </div>
            <Input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleImportFile} disabled={actionBusy} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
