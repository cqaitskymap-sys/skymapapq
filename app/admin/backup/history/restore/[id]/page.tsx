'use client';

import { useCallback, useEffect, useState, use } from 'react';
import { BackupAccessGuard } from '@/components/admin/backup/backup-access-guard';
import { RestoreHistoryDetailView } from '@/components/admin/backup/restore-history-detail-view';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import type { RestoreHistory } from '@/lib/admin/schemas';
import { fetchRestoreById } from '@/lib/admin/backup-service';

function RestoreHistoryDetailContent({ id }: { id: string }) {
  const [restore, setRestore] = useState<RestoreHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const row = await fetchRestoreById(id);
      if (!row) setError('Restore history not found');
      else setRestore(row);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !restore) return <ErrorCard message={error || 'Restore history not found'} onRetry={load} />;

  return <RestoreHistoryDetailView restore={restore} />;
}

export default function RestoreHistoryDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <BackupAccessGuard>
      <RestoreHistoryDetailContent id={params.id} />
    </BackupAccessGuard>
  );
}
