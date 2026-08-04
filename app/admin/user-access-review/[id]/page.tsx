'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AccessReviewAccessGuard } from '@/components/admin/access-review/access-review-access-guard';
import { AccessReviewDetailView } from '@/components/admin/access-review/access-review-detail-view';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { fetchAccessReviewById } from '@/lib/admin/access-review-service';
import type { AccessReview } from '@/lib/admin/schemas';

function AccessReviewDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const [entry, setEntry] = useState<AccessReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchAccessReviewById(id);
      if (!record) setError('Access review not found');
      setEntry(record);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !entry) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  return <AccessReviewDetailView entry={entry} onRefresh={load} />;
}

export default function AccessReviewDetailPage() {
  return (
    <AccessReviewAccessGuard>
      <AccessReviewDetailContent />
    </AccessReviewAccessGuard>
  );
}
