'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AuditTrailAccessGuard } from '@/components/admin/audit-trail/audit-trail-access-guard';
import { AuditTrailDetailView } from '@/components/admin/audit-trail/audit-trail-detail-view';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  fetchAuditTrailById,
  fetchAuditTrailEntries,
  filterAuditTrailByRole,
} from '@/lib/admin/audit-trail-service';
import type { AuditTrailEntry } from '@/lib/admin/schemas';

function canViewSingleEntry(
  entry: AuditTrailEntry,
  role?: string | null,
  userId?: string,
): boolean {
  return filterAuditTrailByRole([entry], role, userId).length > 0;
}

function AuditTrailDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuth();
  const { role } = useAdminPermissions();
  const [entry, setEntry] = useState<AuditTrailEntry | null>(null);
  const [timelineEntries, setTimelineEntries] = useState<AuditTrailEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchAuditTrailById(id);
      if (!record) {
        setError('Audit record not found');
        setEntry(null);
        return;
      }
      if (!canViewSingleEntry(record, role, user?.uid)) {
        setError('You do not have permission to view this audit record');
        setEntry(null);
        return;
      }
      setEntry(record);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id, role, user?.uid]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!entry?.recordId) {
      setTimelineEntries([]);
      return;
    }

    let cancelled = false;
    setTimelineLoading(true);
    fetchAuditTrailEntries(true)
      .then((all) => {
        if (cancelled) return;
        setTimelineEntries(filterAuditTrailByRole(all, role, user?.uid));
      })
      .catch(() => {
        if (!cancelled) setTimelineEntries([]);
      })
      .finally(() => {
        if (!cancelled) setTimelineLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entry?.recordId, role, user?.uid]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !entry) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  return (
    <AuditTrailDetailView
      entry={entry}
      allEntries={timelineEntries}
      timelineLoading={timelineLoading}
    />
  );
}

export default function AuditTrailDetailPage() {
  return (
    <AuditTrailAccessGuard>
      <AuditTrailDetailContent />
    </AuditTrailAccessGuard>
  );
}
