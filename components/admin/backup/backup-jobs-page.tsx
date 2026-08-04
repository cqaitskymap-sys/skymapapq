'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { BackupStatusBadge } from './backup-status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { fetchBackupJobs } from '@/lib/admin/backup-service';

export function BackupJobsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchBackupJobs()
      .then((list) => { setRows(list); setError(null); })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = rows.filter((r) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return String(r.jobId || '').toLowerCase().includes(q)
      || String(r.backupId || '').toLowerCase().includes(q)
      || String(r.jobStatus || '').toLowerCase().includes(q);
  });

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error) return <ErrorCard message={error} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backup Jobs"
        description="Background backup/restore job queue and progress"
        basePath="/admin"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/backup"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search jobs..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Job ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Backup</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={6}><EmptyState title="No backup jobs yet" /></TableCell></TableRow>
                ) : filtered.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell className="font-mono text-xs">{String(row.jobId || row.id)}</TableCell>
                    <TableCell className="text-xs">{String(row.jobType || 'Backup')}</TableCell>
                    <TableCell className="font-mono text-xs">{String(row.backupId || '—')}</TableCell>
                    <TableCell><BackupStatusBadge status={String(row.jobStatus || '')} /></TableCell>
                    <TableCell className="text-xs">{Number(row.progressPct || 0)}%</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(row.createdAt || '').slice(0, 19)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
