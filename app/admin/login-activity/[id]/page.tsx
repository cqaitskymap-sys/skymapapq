'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LoginActivityAccessGuard } from '@/components/admin/login-activity/login-activity-access-guard';
import { LoginActivityDetailView } from '@/components/admin/login-activity/login-activity-detail-view';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { fetchLoginActivityById } from '@/lib/admin/login-activity-service';
import type { LoginActivity } from '@/lib/admin/schemas';

function LoginActivityDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const [entry, setEntry] = useState<LoginActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchLoginActivityById(id);
      if (!record) setError('Login record not found');
      setEntry(record);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !entry) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  return <LoginActivityDetailView entry={entry} onRefresh={load} />;
}

export default function LoginActivityDetailPage() {
  return (
    <LoginActivityAccessGuard>
      <LoginActivityDetailContent />
    </LoginActivityAccessGuard>
  );
}
