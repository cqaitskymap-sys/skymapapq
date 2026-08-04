'use client';

import { BackupAccessGuard } from '@/components/admin/backup/backup-access-guard';
import { BackupJobsPage } from '@/components/admin/backup/backup-jobs-page';

export default function AdminBackupJobsRoute() {
  return (
    <BackupAccessGuard>
      <BackupJobsPage />
    </BackupAccessGuard>
  );
}
