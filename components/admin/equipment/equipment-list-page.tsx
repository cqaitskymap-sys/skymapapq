'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, Download, Eye, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EquipmentStatusBadge } from '@/components/equipment-mgmt/equipment-sub-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { canEditEquipmentMaster } from '@/lib/permissions';
import {
  EQUIPMENT_QUALIFICATION_STATUSES,
  type EquipmentRecord,
} from '@/lib/equipment-mgmt-types';
import { listEquipment, exportEquipmentCsv, deleteEquipment } from '@/lib/equipment-mgmt-service';

const PAGE_SIZE = 10;

export function EquipmentListPage() {
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditEquipmentMaster(role);

  const [equipment, setEquipment] = useState<EquipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [lineFilter, setLineFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<EquipmentRecord | null>(null);
  const [changeReason, setChangeReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await listEquipment({});
      setEquipment(rows);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load equipment');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return equipment.filter((row) => {
      const matchSearch = !q
        || row.equipment_id.toLowerCase().includes(q)
        || row.equipment_name.toLowerCase().includes(q)
        || row.manufacturing_line?.toLowerCase().includes(q)
        || row.qualification_status?.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || row.qualification_status === statusFilter;
      const matchLine = lineFilter === 'all' || row.manufacturing_line === lineFilter;
      return matchSearch && matchStatus && matchLine;
    });
  }, [equipment, search, statusFilter, lineFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const lineOptions = useMemo(() => {
    const lines = new Set(equipment.map((e) => e.manufacturing_line).filter(Boolean));
    return Array.from(lines).sort();
  }, [equipment]);

  const kpi = useMemo(() => ({
    total: equipment.length,
    qualified: equipment.filter((e) => e.qualification_status === 'Qualified').length,
    notQualified: equipment.filter((e) => e.qualification_status === 'Not Qualified').length,
  }), [equipment]);

  const handleExport = async () => {
    try {
      await exportEquipmentCsv(filtered);
      toast.success(`Exported ${filtered.length} equipment record(s)`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed');
    }
  };

  const runDelete = async () => {
    if (!deleteConfirm || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setActionBusy(true);
    try {
      await deleteEquipment(deleteConfirm.id, {
        id: user?.uid || 'system',
        name: profile?.full_name || profile?.email || 'Admin',
        role: role || 'admin',
      }, changeReason);
      toast.success(`Deleted ${deleteConfirm.equipment_id}`);
      setDeleteConfirm(null);
      setChangeReason('');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader title="Equipment Master" basePath="/admin" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }

  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipment Master"
        description="Central equipment register with name, ID, qualification status, and manufacturing line"
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
            {canEdit && (
              <Button asChild size="sm" className="bg-blue-600 hover:bg-blue-700">
                <Link href="/admin/equipment/create">
                  <Plus className="h-4 w-4 mr-1" />Create Equipment
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Total', value: kpi.total },
          { label: 'Qualified', value: kpi.qualified },
          { label: 'Not Qualified', value: kpi.notQualified },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search ID, name, line, qualification…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Qualification" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Qualification</SelectItem>
                {EQUIPMENT_QUALIFICATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={lineFilter} onValueChange={(v) => { setLineFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Line" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Lines</SelectItem>
                {lineOptions.map((line) => <SelectItem key={line} value={line}>{line}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden md:block overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead>Equipment ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Qualification Status</TableHead>
                  <TableHead>Manufacturing Line</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        title="No equipment found"
                        message={canEdit ? 'Create the first equipment profile to get started.' : 'No records match your filters.'}
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  paginated.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.equipment_id}</TableCell>
                      <TableCell className="font-medium">{row.equipment_name}</TableCell>
                      <TableCell><EquipmentStatusBadge status={row.qualification_status || '—'} /></TableCell>
                      <TableCell>{row.manufacturing_line || '—'}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button asChild variant="ghost" size="icon" aria-label="View equipment">
                            <Link href={`/admin/equipment/${row.id}`}><Eye className="h-4 w-4" /></Link>
                          </Button>
                          {canEdit && (
                            <>
                              <Button asChild variant="ghost" size="icon" aria-label="Edit equipment">
                                <Link href={`/admin/equipment/${row.id}/edit`}><Pencil className="h-4 w-4" /></Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Delete equipment"
                                onClick={() => { setChangeReason(''); setDeleteConfirm(row); }}
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
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

          <div className="md:hidden space-y-3">
            {paginated.length === 0 ? (
              <EmptyState title="No equipment found" />
            ) : (
              paginated.map((row) => (
                <Card key={row.id} className="border">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-semibold">{row.equipment_name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{row.equipment_id}</p>
                      </div>
                      <EquipmentStatusBadge status={row.qualification_status || '—'} />
                    </div>
                    <p className="text-xs text-muted-foreground">{row.manufacturing_line || 'No line'}</p>
                    <div className="flex gap-2 pt-1">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/equipment/${row.id}`}>View</Link>
                      </Button>
                      {canEdit && (
                        <>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/admin/equipment/${row.id}/edit`}>Edit</Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-red-600"
                            onClick={() => { setChangeReason(''); setDeleteConfirm(row); }}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {filtered.length} equipment
              {profile?.full_name ? ` · viewed by ${profile.full_name}` : ''}
            </span>
            <div className="flex gap-2 items-center">
              <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <span>Page {currentPage + 1}/{totalPages}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Equipment</AlertDialogTitle>
            <AlertDialogDescription>
              Soft-delete &quot;{deleteConfirm?.equipment_name}&quot; ({deleteConfirm?.equipment_id})?
              The record will be hidden from the register and kept for audit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              rows={2}
              placeholder="Why is this equipment being deleted?"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actionBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); void runDelete(); }}
              disabled={actionBusy}
              className="bg-red-600 hover:bg-red-700"
            >
              {actionBusy ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
