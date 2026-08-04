'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Upload, History, Search, FileSearch } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { KpiCard } from '@/components/admin/dashboard/kpi-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditMasterDataImportExport } from '@/lib/permissions';
import type { MasterDataImportExport } from '@/lib/admin/schemas';
import {
  subscribeToImpexOperations, getImpexSummary, getMasterDataTypeOptions,
} from '@/lib/admin/master-data-import-export-service';

const PAGE_SIZE = 10;

export function MasterDataImpexDashboardPage() {
  const { role } = useAdminPermissions();
  const canEdit = canEditMasterDataImportExport(role);
  const [rows, setRows] = useState<MasterDataImportExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    const unsub = subscribeToImpexOperations(
      (list) => { setRows(list); setError(null); setLoading(false); },
      (err) => { setError(err.message); setLoading(false); },
    );
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => {
      const matchSearch = !q
        || r.operationId?.toLowerCase().includes(q)
        || r.masterType?.toLowerCase().includes(q)
        || r.fileName?.toLowerCase().includes(q)
        || r.performedBy?.toLowerCase().includes(q);
      const matchType = typeFilter === 'all' || r.operationType === typeFilter;
      return matchSearch && matchType;
    });
  }, [rows, search, typeFilter]);

  const stats = getImpexSummary(rows);
  const masters = getMasterDataTypeOptions();
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  if (loading) {
    return (
      <div>
        <PageHeader title="Master Data Import / Export" basePath="/admin" />
        <LoadingSkeleton rows={2} />
      </div>
    );
  }
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Master Data Import / Export"
        description="Validated bulk import/export hub with operation audit trail"
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail?module=Master%20Data%20Import%2FExport">
                <FileSearch className="h-4 w-4 mr-1" />Audit Trail
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/master-data-import-export/history">
                <History className="h-4 w-4 mr-1" />Full History
              </Link>
            </Button>
            {canEdit && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/admin/master-data-import-export/export">
                    <Download className="h-4 w-4 mr-1" />Export Wizard
                  </Link>
                </Button>
                <Button size="sm" asChild className="bg-sky-600 hover:bg-sky-700">
                  <Link href="/admin/master-data-import-export/import">
                    <Upload className="h-4 w-4 mr-1" />Import Wizard
                  </Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Operations" value={stats.total} />
        <KpiCard label="Imports" value={stats.imports} />
        <KpiCard label="Exports" value={stats.exports} />
        <KpiCard label="Success" value={stats.success} />
        <KpiCard label="Partial" value={stats.partial} />
        <KpiCard label="Failed" value={stats.failed} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Supported Masters ({masters.length})</CardTitle></CardHeader>
          <CardContent className="text-xs text-muted-foreground flex flex-wrap gap-2">
            {masters.map((m) => (
              <span key={m.value} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{m.label}</span>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Quick Actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {canEdit ? (
              <>
                <Button asChild className="bg-sky-600 hover:bg-sky-700"><Link href="/admin/master-data-import-export/import">Start Import</Link></Button>
                <Button asChild variant="outline"><Link href="/admin/master-data-import-export/export">Start Export</Link></Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">View-only access. Contact an administrator to run imports.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search operations..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Import">Import</SelectItem>
                <SelectItem value="Export">Export</SelectItem>
                <SelectItem value="Validate">Validate</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Operation</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Master</TableHead>
                  <TableHead>Records</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={7}><EmptyState title="No operations yet" /></TableCell></TableRow>
                ) : paginated.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.operationId}</TableCell>
                    <TableCell className="text-xs">{row.operationType}</TableCell>
                    <TableCell className="text-xs">{row.masterType}</TableCell>
                    <TableCell className="text-xs">
                      {row.recordCount}
                      {(row.successCount || row.errorCount) ? ` (✓${row.successCount} ✗${row.errorCount})` : ''}
                    </TableCell>
                    <TableCell><StatusBadge status={row.operationStatus} /></TableCell>
                    <TableCell className="text-xs">{row.performedBy}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(row.operationDate || '').slice(0, 19)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{filtered.length} operations</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
              <span>Page {currentPage + 1}/{totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
