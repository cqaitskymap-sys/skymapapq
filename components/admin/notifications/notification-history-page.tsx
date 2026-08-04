'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Search } from 'lucide-react';
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
import { fetchNotificationDeliveryLog } from '@/lib/admin/notification-settings-service';
import { getAllNotifications, getNotificationStats } from '@/lib/notification-service';

const PAGE_SIZE = 20;

export function NotificationHistoryPage() {
  const [deliveryLog, setDeliveryLog] = useState<Array<Record<string, unknown>>>([]);
  const [inbox, setInbox] = useState<Awaited<ReturnType<typeof getAllNotifications>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState<'delivery' | 'inbox'>('delivery');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [log, notes] = await Promise.all([
        fetchNotificationDeliveryLog(),
        getAllNotifications(300),
      ]);
      setDeliveryLog(log);
      setInbox(notes);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows = tab === 'delivery' ? deliveryLog : inbox.map((n) => ({
    id: n.id,
    channel: n.notificationChannel || 'In-App',
    status: n.sentStatus || (n.isRead ? 'Read' : 'Delivered'),
    moduleName: n.moduleName,
    userId: n.userId,
    recordId: n.recordId,
    title: n.title,
    createdAt: n.createdAt,
  }));

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter((r) => !q
      || String(r.channel || '').toLowerCase().includes(q)
      || String(r.status || '').toLowerCase().includes(q)
      || String(r.moduleName || '').toLowerCase().includes(q)
      || String(r.userId || '').toLowerCase().includes(q)
      || String(r.recordId || '').toLowerCase().includes(q)
      || String(r.title || '').toLowerCase().includes(q));
  }, [rows, search]);

  const stats = getNotificationStats(inbox);
  const delivered = deliveryLog.filter((r) => String(r.status).toLowerCase().includes('deliver') || r.status === 'Sent').length;
  const failed = deliveryLog.filter((r) => r.status === 'Failed').length;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const paginated = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  const exportCsv = () => {
    const headers = ['Channel', 'Status', 'Module', 'User', 'Record', 'Title', 'Created'];
    const lines = filtered.map((r) => [
      r.channel, r.status, r.moduleName, r.userId, r.recordId, r.title, r.createdAt,
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([`\uFEFF${headers.join(',')}\n${lines.join('\n')}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notification-history-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} rows`);
  };

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification History"
        description="Delivery log and in-app notification history (immutable audit)"
        basePath="/admin"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/notifications"><ArrowLeft className="h-4 w-4 mr-1" />Settings</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Card><CardContent className="p-3">Delivered (log): {delivered}</CardContent></Card>
        <Card><CardContent className="p-3">Failed (log): {failed}</CardContent></Card>
        <Card><CardContent className="p-3">Inbox unread: {stats.unread}</CardContent></Card>
        <Card><CardContent className="p-3">Inbox failed: {stats.failed}</CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={tab === 'delivery' ? 'default' : 'outline'}
              className={tab === 'delivery' ? 'bg-sky-600 hover:bg-sky-700' : ''}
              onClick={() => { setTab('delivery'); setPage(0); }}
            >
              Delivery Log
            </Button>
            <Button
              size="sm"
              variant={tab === 'inbox' ? 'default' : 'outline'}
              className={tab === 'inbox' ? 'bg-sky-600 hover:bg-sky-700' : ''}
              onClick={() => { setTab('inbox'); setPage(0); }}
            >
              In-App History
            </Button>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search history..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Channel</TableHead>
                  <TableHead>Title / Record</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.length === 0 ? (
                  <TableRow><TableCell colSpan={6}><EmptyState title="No history found" /></TableCell></TableRow>
                ) : paginated.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell className="text-xs">{String(row.channel || '—')}</TableCell>
                    <TableCell className="text-sm max-w-[240px] truncate">
                      {String(row.title || row.recordId || '—')}
                    </TableCell>
                    <TableCell className="text-xs">{String(row.moduleName || '—')}</TableCell>
                    <TableCell className="font-mono text-xs">{String(row.userId || '—').slice(0, 12)}</TableCell>
                    <TableCell><StatusBadge status={String(row.status || '—')} /></TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(row.createdAt || '—').slice(0, 19)}</TableCell>
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
