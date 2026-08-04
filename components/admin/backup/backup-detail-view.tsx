'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Download, ShieldCheck, RotateCcw, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BackupStatusBadge } from './backup-status-badge';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canViewBackup, canApproveRestore } from '@/lib/permissions';
import type { BackupHistory } from '@/lib/admin/schemas';
import {
  downloadBackup, verifyBackup, logBackupExport,
} from '@/lib/admin/backup-service';

interface BackupDetailViewProps {
  backup: BackupHistory;
  auditMeta: { userId: string; userName: string };
  onRefresh: () => void;
}

export function BackupDetailView({ backup, auditMeta, onRefresh }: BackupDetailViewProps) {
  const { role } = useAdminPermissions();
  const canDownload = canViewBackup(role);
  const canRestore = canApproveRestore(role);
  const [verifying, setVerifying] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    const result = await downloadBackup(backup);
    setDownloading(false);
    if (result.success) {
      await logBackupExport(`Backup downloaded: ${backup.backupNumber}`, backup.backupId);
      toast.success('Backup download started');
    } else toast.error(result.error || 'Download failed');
  };

  const handleVerify = async () => {
    setVerifying(true);
    const result = await verifyBackup(backup, auditMeta);
    setVerifying(false);
    if (result.verified) {
      toast.success('Backup verified — checksum matches');
      onRefresh();
    } else toast.error(result.error || 'Verification failed');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Backup ${backup.backupNumber}`}
        description={`${backup.backupType} — ${backup.backupScope}`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/backup"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
            </Button>
            {canDownload && (
              <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
                <Download className="h-4 w-4 mr-1" />{downloading ? 'Downloading...' : 'Download'}
              </Button>
            )}
            {canDownload && backup.checksum && (
              <Button size="sm" variant="outline" onClick={handleVerify} disabled={verifying}>
                <ShieldCheck className="h-4 w-4 mr-1" />{verifying ? 'Verifying...' : 'Verify'}
              </Button>
            )}
            {canRestore && backup.backupStatus === 'Completed' && (
              <Button size="sm" className="bg-red-600" asChild>
                <Link href={`/admin/backup/restore?backupId=${backup.backupId}`}>
                  <RotateCcw className="h-4 w-4 mr-1" />Request Restore
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Status</p>
          <BackupStatusBadge status={backup.backupStatus} />
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">File Size</p>
          <p className="font-semibold">{backup.fileSize || '—'}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Records</p>
          <p className="font-semibold">{backup.recordsCount}</p>
        </CardContent></Card>
        <Card><CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Restore Point</p>
          <p className="font-semibold">{backup.restorePointCreated ? 'Yes' : 'No'}</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Backup Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Backup ID</span><span>{backup.backupId}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Date Time</span><span>{new Date(backup.backupDateTime).toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Created By</span><span>{backup.createdBy}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">File Name</span><span>{backup.fileName}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Storage</span><span className="text-xs">{backup.storageLocation}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Checksum</span><span className="text-xs font-mono truncate max-w-[200px]">{backup.checksum || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Encryption</span><span>{backup.encryptionStatus || '—'} ({backup.encryptionAlgorithm || '—'})</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Integrity</span><span>{backup.integrityStatus || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Provider</span><span>{backup.storageProvider || '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Expires</span><span>{backup.expirationDate ? String(backup.expirationDate).slice(0, 10) : '—'}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Protected</span><span>{backup.isProtected ? 'Yes' : 'No'}</span></div>
            {backup.remarks && <p className="text-muted-foreground pt-2">{backup.remarks}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Collections Included ({backup.collectionsIncluded?.length || 0})</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {(backup.collectionsIncluded || []).map((c) => (
                <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
