'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
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
import type { MasterDataImportExport } from '@/lib/admin/schemas';
import { MASTER_DATA_OPERATION_STATUSES } from '@/lib/admin/constants';
import { subscribeToImpexOperations } from '@/lib/admin/master-data-import-export-service';

const PAGE_SIZE = 20;

export function MasterDataImpexHistoryPage() {
  const [rows, setRows] = useState<MasterDataImportExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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
        || r.errorLog?.toLowerCase().includes(q);
      const matchStatus = statusFilter === 'all' || r.operationStatus === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [rows, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import / Export History"
        description="Immutable operation log for master data transfers"
        basePath="/admin"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/master-data-import-export"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col lg:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search history..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
            </div>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
              <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {MASTER_DATA_OPERATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Master</TableHead>
                  <TableHead>Mode / Format</TableHead>
                  <TableHead>Counts</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={8}><EmptyState title="No history found" /></TableCell></TableRow>
                ) : paginated.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.operationId}</TableCell>
                    <TableCell className="text-xs">{row.operationType}</TableCell>
                    <TableCell className="text-xs">{row.masterType}</TableCell>
                    <TableCell className="text-xs">{row.importMode || row.fileFormat || '—'}</TableCell>
                    <TableCell className="text-xs">
                      {row.recordCount} / ✓{row.successCount} / ✗{row.errorCount}
                    </TableCell>
                    <TableCell><StatusBadge status={row.operationStatus} /></TableCell>
                    <TableCell className="text-xs max-w-[180px] truncate">{row.changeReason || '—'}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(row.operationDate || '').slice(0, 19)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{filtered.length} rows</span>
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
