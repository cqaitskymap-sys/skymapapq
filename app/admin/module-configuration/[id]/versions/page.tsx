'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { ModuleConfigurationAccessGuard } from '@/components/admin/module-configuration/module-configuration-access-guard';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  fetchModuleConfigurationById, fetchModuleConfigVersions,
} from '@/lib/admin/module-configuration-service';

function ModuleVersionsContent() {
  const params = useParams();
  const id = params.id as string;
  const [code, setCode] = useState('');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mod, versions] = await Promise.all([
        fetchModuleConfigurationById(id),
        fetchModuleConfigVersions(id),
      ]);
      if (!mod) setError('Module not found');
      else setCode(mod.moduleCode);
      setRows(versions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Module Version History"
        description={code || id}
        basePath="/admin"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/module-configuration/${id}`}><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50 dark:bg-slate-900/40">
                  <TableHead>Version</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Dependencies</TableHead>
                  <TableHead>Snapshot At</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={6}><EmptyState title="No versions yet" /></TableCell></TableRow>
                ) : rows.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell className="font-mono text-xs">{String(row.version || '1.0.0')}</TableCell>
                    <TableCell><StatusBadge status={row.isEnabled ? 'Active' : 'Inactive'} /></TableCell>
                    <TableCell className="text-xs">{String(row.environment || '—')}</TableCell>
                    <TableCell className="text-[11px] max-w-[200px] truncate">
                      {Array.isArray(row.dependencies) ? (row.dependencies as string[]).join(', ') : '—'}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{String(row.snapshotAt || '').slice(0, 19)}</TableCell>
                    <TableCell className="font-mono text-xs">{String(row.snapshotBy || '—').slice(0, 12)}</TableCell>
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

export default function ModuleVersionsPage() {
  return (
    <ModuleConfigurationAccessGuard>
      <ModuleVersionsContent />
    </ModuleConfigurationAccessGuard>
  );
}
