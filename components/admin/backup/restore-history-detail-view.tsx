'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { BackupStatusBadge } from './backup-status-badge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { RestoreHistory } from '@/lib/admin/schemas';

interface RestoreHistoryDetailViewProps {
  restore: RestoreHistory;
}

export function RestoreHistoryDetailView({ restore }: RestoreHistoryDetailViewProps) {
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Restore ${restore.restoreId}`}
        description={`${restore.restoreType} · immutable history record`}
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/backup/history"><ArrowLeft className="h-4 w-4 mr-1" />History</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/backup/restore?backupId=${restore.backupId}`}>Restore Wizard</Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Status</p>
          <BackupStatusBadge status={restore.restoreStatus} />
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Records</p>
          <p className="font-semibold">{restore.recordsRestored}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Dry Run</p>
          <p className="font-semibold">{restore.dryRun ? 'Yes' : 'No'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Archived</p>
          <p className="font-semibold">{restore.isArchived ? 'Yes' : 'No'}</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Restore Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Restore ID</span><span className="font-mono text-xs">{restore.restoreId}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Backup ID</span><span className="font-mono text-xs">{restore.backupId}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Type</span><span>{restore.restoreType}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Requested By</span><span>{restore.restoredBy || restore.createdBy || '—'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Approved By</span><span>{restore.approvedBy || '—'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Approved At</span><span>{restore.approvedAt ? String(restore.approvedAt).slice(0, 19) : '—'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">E-Sign Record</span><span className="font-mono text-xs">{restore.esignRecordId || '—'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Pre-Restore Backup</span><span className="font-mono text-xs">{restore.preRestoreBackupId || '—'}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Date</span><span>{new Date(restore.restoreDateTime).toLocaleString()}</span></div>
            <div className="flex justify-between gap-4"><span className="text-muted-foreground">Duration</span><span>{restore.durationMs ? `${restore.durationMs} ms` : '—'}</span></div>
            {restore.failureReason && (
              <p className="text-red-600 text-xs pt-2">{restore.failureReason}</p>
            )}
            <p className="text-muted-foreground pt-2">{restore.reasonForRestore}</p>
            {restore.remarks && <p className="text-xs">{restore.remarks}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Collections Restored ({restore.collectionsRestored?.length || 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {(restore.collectionsRestored || []).map((c) => (
                <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
              ))}
              {(restore.collectionsRestored || []).length === 0 && (
                <p className="text-sm text-muted-foreground">No collections listed</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
