'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { EmailSmsTemplatesAccessGuard } from '@/components/admin/email-sms-templates/email-sms-templates-access-guard';
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
  fetchEmailSmsTemplateById, fetchTemplateVersions,
} from '@/lib/admin/email-sms-templates-service';

function TemplateVersionsContent() {
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
      const [tmpl, versions] = await Promise.all([
        fetchEmailSmsTemplateById(id),
        fetchTemplateVersions(id),
      ]);
      if (!tmpl) setError('Template not found');
      else setCode(tmpl.templateCode);
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
        title="Template Version History"
        description={code || id}
        basePath="/admin"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/admin/email-sms-templates/${id}`}><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
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
                  <TableHead>Approval</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Snapshot At</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow><TableCell colSpan={5}><EmptyState title="No versions yet" /></TableCell></TableRow>
                ) : rows.map((row) => (
                  <TableRow key={String(row.id)}>
                    <TableCell className="font-mono text-xs">v{String(row.version || 1)}</TableCell>
                    <TableCell><StatusBadge status={String(row.approvalStatus || 'Draft')} /></TableCell>
                    <TableCell className="text-sm max-w-[280px] truncate">{String(row.subject || '—')}</TableCell>
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

export default function TemplateVersionsPage() {
  return (
    <EmailSmsTemplatesAccessGuard>
      <TemplateVersionsContent />
    </EmailSmsTemplatesAccessGuard>
  );
}
