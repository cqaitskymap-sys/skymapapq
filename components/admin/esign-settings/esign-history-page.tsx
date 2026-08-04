'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, ArrowLeft, Download } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fetchEsignRecords, getEsignRecordsSummary } from '@/lib/admin/esign-service';
import type { EsignRecord } from '@/lib/admin/schemas';

const PAGE_SIZE = 20;

export function EsignHistoryPage() {
  const [rows, setRows] = useState<EsignRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    fetchEsignRecords()
      .then((list) => { setRows(list); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => !q
      || r.esignRecordId?.toLowerCase().includes(q)
      || r.moduleName?.toLowerCase().includes(q)
      || r.actionType?.toLowerCase().includes(q)
      || r.userName?.toLowerCase().includes(q)
      || r.recordId?.toLowerCase().includes(q)
      || r.documentNumber?.toLowerCase().includes(q));
  }, [rows, search]);

  const summary = getEsignRecordsSummary(rows);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const exportCsv = () => {
    const headers = [
      'Signature ID', 'Transaction', 'Module', 'Action', 'Record', 'User', 'Meaning',
      'Status', 'Auth', 'Hash', 'Signed At',
    ];
    const lines = filtered.map((r) => [
      r.esignRecordId, r.transactionId, r.moduleName, r.actionType, r.recordId,
      r.userName, r.signatureMeaning, r.status, r.authenticationStatus,
      r.digitalHash, r.signedDateTime,
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([`\uFEFF${headers.join(',')}\n${lines.join('\n')}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `esign-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} signatures`);
  };

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="E-Signature History"
        description="Immutable electronic signature records (Part 11 / Annex 11)"
        basePath="/admin"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/esign-settings"><ArrowLeft className="h-4 w-4 mr-1" />Settings</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Card><CardContent className="p-3">Signed: {summary.signed}</CardContent></Card>
        <Card><CardContent className="p-3">Failed: {summary.failedAttempts}</CardContent></Card>
        <Card><CardContent className="p-3">Tests: {summary.testSignatures}</CardContent></Card>
        <Card><CardContent className="p-3">Total: {summary.totalRecords}</CardContent></Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search signature, module, user, record…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {paginated.length === 0 ? (
            <div className="p-8"><EmptyState title="No signatures" message="Electronic signatures will appear here after signing." /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Signature ID</TableHead>
                  <TableHead>Module / Action</TableHead>
                  <TableHead>Record</TableHead>
                  <TableHead>Signer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Hash</TableHead>
                  <TableHead>Signed At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((row) => (
                  <TableRow key={row.id || row.esignRecordId}>
                    <TableCell className="font-mono text-xs">{row.esignRecordId}</TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{row.moduleName}</p>
                      <p className="text-xs text-muted-foreground">{row.actionType}</p>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p>{row.documentNumber || row.recordId}</p>
                    </TableCell>
                    <TableCell className="text-sm">{row.userName}</TableCell>
                    <TableCell><StatusBadge status={row.status || row.authenticationStatus} /></TableCell>
                    <TableCell className="font-mono text-[10px] max-w-[120px] truncate">{row.digitalHash || '-'}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {row.signedDateTime ? new Date(row.signedDateTime).toLocaleString() : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{filtered.length} record(s)</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={currentPage <= 0} onClick={() => setPage((p) => p - 1)}>Prev</Button>
          <span>Page {currentPage + 1} / {totalPages}</span>
          <Button variant="outline" size="sm" disabled={currentPage >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
