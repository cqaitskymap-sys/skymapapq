'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Plus, Search, Download, Eye, Pencil, UserCheck, UserX, Database, Trash2, Bell, History,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
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
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditEmailSmsTemplates } from '@/lib/permissions';
import {
  TEMPLATE_TYPES, TEMPLATE_CATEGORIES, TEMPLATE_APPROVAL_STATUSES, RECORD_STATUSES,
} from '@/lib/admin/constants';
import type { EmailSmsTemplate } from '@/lib/admin/schemas';
import {
  subscribeToEmailSmsTemplates, getEmailSmsTemplatesSummary,
  setEmailSmsTemplateStatus, softDeleteEmailSmsTemplate,
  exportEmailSmsTemplatesCsv, logEmailSmsTemplatesExport, seedDefaultEmailSmsTemplates,
} from '@/lib/admin/email-sms-templates-service';

const PAGE_SIZE = 10;

export function EmailSmsTemplatesListPage() {
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditEmailSmsTemplates(role);

  const [templates, setTemplates] = useState<EmailSmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [approvalFilter, setApprovalFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [confirm, setConfirm] = useState<{ template: EmailSmsTemplate; activate: boolean } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<EmailSmsTemplate | null>(null);
  const [seeding, setSeeding] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToEmailSmsTemplates(
      (rows) => { setTemplates(rows); setError(null); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return templates.filter((t) => {
      const matchSearch = !q
        || t.templateCode?.toLowerCase().includes(q)
        || t.templateName?.toLowerCase().includes(q)
        || t.module?.toLowerCase().includes(q)
        || t.subject?.toLowerCase().includes(q);
      const matchType = typeFilter === 'all' || t.templateType === typeFilter;
      const matchCategory = categoryFilter === 'all' || t.category === categoryFilter;
      const matchApproval = approvalFilter === 'all' || t.approvalStatus === approvalFilter;
      const matchStatus = statusFilter === 'all' || t.status === statusFilter;
      return matchSearch && matchType && matchCategory && matchApproval && matchStatus;
    });
  }, [templates, search, typeFilter, categoryFilter, approvalFilter, statusFilter]);

  const stats = getEmailSmsTemplatesSummary(templates);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleExport = async () => {
    const csv = exportEmailSmsTemplatesCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email-sms-templates-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    await logEmailSmsTemplatesExport(auditMeta, filtered.length);
    toast.success('Templates exported');
  };

  const handleSeed = async () => {
    setSeeding(true);
    const result = await seedDefaultEmailSmsTemplates(auditMeta);
    setSeeding(false);
    toast.success(`Created ${result.created}, skipped ${result.skipped}`);
  };

  const runConfirm = async () => {
    if (!confirm?.template.id) return;
    const status = confirm.activate ? 'Active' : 'Inactive';
    const result = await setEmailSmsTemplateStatus(confirm.template.id, status, auditMeta, `${status} via Admin UI`);
    if (result.success) toast.success(`Template ${status === 'Active' ? 'activated' : 'deactivated'}`);
    else toast.error(result.error || 'Action failed');
    setConfirm(null);
  };

  const runDelete = async () => {
    if (!deleteConfirm?.id) return;
    const result = await softDeleteEmailSmsTemplate(deleteConfirm.id, auditMeta, 'Soft-deleted via Admin UI');
    if (result.success) toast.success('Template soft-deleted');
    else toast.error(result.error || 'Delete failed');
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Email & SMS Templates" basePath="/admin" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Email & SMS Templates"
        description="Enterprise communication template library with versioning and approval"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/notifications"><Bell className="h-4 w-4 mr-1" />Notification Settings</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail?module=Email%2FSMS%20Templates">Audit Trail</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" disabled={seeding} onClick={handleSeed}>
                  <Database className="h-4 w-4 mr-1" />{seeding ? 'Seeding…' : 'Seed Defaults'}
                </Button>
                <Button asChild size="sm" className="bg-sky-600 hover:bg-sky-700">
                  <Link href="/admin/email-sms-templates/create"><Plus className="h-4 w-4 mr-1" />Create Template</Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total" value={stats.total} />
        <KpiCard label="Active" value={stats.active} />
        <KpiCard label="Published" value={stats.published} />
        <KpiCard label="Draft / Review" value={stats.draft} />
        <KpiCard label="Email" value={stats.email} />
        <KpiCard label="SMS" value={stats.sms} />
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search code, name, module, subject..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                {TEMPLATE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={approvalFilter} onValueChange={(v) => { setApprovalFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[150px]"><SelectValue placeholder="Approval" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Approval</SelectItem>
                {TEMPLATE_APPROVAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[120px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {RECORD_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden md:block overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Approval</TableHead>
                  <TableHead>Ver</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={8}><EmptyState title="No templates found" /></TableCell></TableRow>
                ) : paginated.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.templateCode}</TableCell>
                    <TableCell className="text-sm">{row.templateName}</TableCell>
                    <TableCell className="text-xs">{row.templateType}</TableCell>
                    <TableCell className="text-xs">{row.module}</TableCell>
                    <TableCell><StatusBadge status={row.approvalStatus || 'Draft'} /></TableCell>
                    <TableCell className="text-xs">v{row.version || 1}</TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild variant="ghost" size="icon">
                          <Link href={`/admin/email-sms-templates/${row.id}`}><Eye className="h-4 w-4" /></Link>
                        </Button>
                        <Button asChild variant="ghost" size="icon">
                          <Link href={`/admin/email-sms-templates/${row.id}/versions`}><History className="h-4 w-4" /></Link>
                        </Button>
                        {canEdit && (
                          <>
                            <Button asChild variant="ghost" size="icon">
                              <Link href={`/admin/email-sms-templates/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                            </Button>
                            {row.status === 'Active'
                              ? <Button variant="ghost" size="icon" onClick={() => setConfirm({ template: row, activate: false })}><UserX className="h-4 w-4 text-amber-600" /></Button>
                              : <Button variant="ghost" size="icon" onClick={() => setConfirm({ template: row, activate: true })}><UserCheck className="h-4 w-4 text-green-600" /></Button>}
                            {canDelete && (
                              <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(row)}>
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="md:hidden space-y-3">
            {paginated.map((row) => (
              <Card key={row.id} className="border">
                <CardContent className="p-4 space-y-2">
                  <div className="flex justify-between">
                    <p className="font-mono text-sm font-semibold">{row.templateCode}</p>
                    <StatusBadge status={row.status} />
                  </div>
                  <p className="text-sm">{row.templateName}</p>
                  <p className="text-xs text-muted-foreground">{row.templateType} · {row.module} · v{row.version || 1}</p>
                  <div className="flex gap-2 pt-2">
                    <Button asChild size="sm" variant="outline"><Link href={`/admin/email-sms-templates/${row.id}`}>View</Link></Button>
                    {canEdit && <Button asChild size="sm" variant="outline"><Link href={`/admin/email-sms-templates/${row.id}/edit`}>Edit</Link></Button>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{filtered.length} templates</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>Page {currentPage + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!confirm} onOpenChange={() => setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.activate ? 'Activate Template' : 'Deactivate Template'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.activate
                ? `Activate "${confirm?.template.templateCode}"?`
                : `Deactivate "${confirm?.template.templateCode}"?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runConfirm} className="bg-sky-600">Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Soft-Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Soft-delete &quot;{deleteConfirm?.templateCode}&quot;? Version history is retained for audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runDelete} className="bg-red-600 hover:bg-red-700">Soft Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
