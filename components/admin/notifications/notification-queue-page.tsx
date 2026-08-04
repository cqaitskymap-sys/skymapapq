'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Search } from 'lucide-react';
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
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditNotificationSettings } from '@/lib/permissions';
import {
  fetchNotificationQueue, processNotificationQueue,
} from '@/lib/admin/notification-settings-service';

const PAGE_SIZE = 20;

export function NotificationQueuePage() {
  const { role } = useAdminPermissions();
  const canEdit = canEditNotificationSettings(role);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchNotificationQueue());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => !q
      || String(r.channel || '').toLowerCase().includes(q)
      || String(r.status || '').toLowerCase().includes(q)
      || String(r.moduleName || '').toLowerCase().includes(q)
      || String(r.userId || '').toLowerCase().includes(q)
      || String(r.title || '').toLowerCase().includes(q));
  }, [rows, search]);

  const pending = rows.filter((r) => r.status === 'Pending' || r.status === 'Failed').length;
  const sent = rows.filter((r) => r.status === 'Sent').length;
  const failed = rows.filter((r) => r.status === 'Failed').length;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const handleProcess = async () => {
    setProcessing(true);
    const result = await processNotificationQueue();
    setProcessing(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`Processed ${result.data?.processed ?? 0}, failed ${result.data?.failed ?? 0}`);
      load();
    }
  };

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification Queue"
        description="Email / SMS / webhook outbound queue and retry monitor"
        basePath="/admin"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/notifications"><ArrowLeft className="h-4 w-4 mr-1" />Settings</Link>
            </Button>
            {canEdit && (
              <Button size="sm" className="bg-sky-600 hover:bg-sky-700" disabled={processing} onClick={handleProcess}>
                <RefreshCw className={`h-4 w-4 mr-1 ${processing ? 'animate-spin' : ''}`} />
                {processing ? 'Processing…' : 'Process Queue'}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Card><CardContent className="p-3">Pending / Retry: {pending}</CardContent></Card>
        <Card><CardContent className="p-3">Sent: {sent}</CardContent></Card>
        <Card><CardContent className="p-3">Failed: {failed}</CardContent></Card>
        <Card><CardContent className="p-3">Total: {rows.length}</CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search channel, status, module..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            />
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Channel</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Retries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={7}><EmptyState title="Queue is empty" /></TableCell></TableRow>
                ) : paginated.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell className="text-xs">{String(row.channel || '—')}</TableCell>
                    <TableCell className="text-sm max-w-[220px] truncate">{String(row.title || '—')}</TableCell>
                    <TableCell className="text-xs">{String(row.moduleName || '—')}</TableCell>
                    <TableCell className="font-mono text-xs">{String(row.userId || '—').slice(0, 12)}</TableCell>
                    <TableCell className="text-xs">{String(row.retryCount ?? 0)}/{String(row.maxRetries ?? 3)}</TableCell>
                    <TableCell><StatusBadge status={String(row.status || 'Pending')} /></TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(row.createdAt || '—').slice(0, 19)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{filtered.length} items</span>
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
