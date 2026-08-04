'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ModuleConfigurationAccessGuard } from '@/components/admin/module-configuration/module-configuration-access-guard';
import { ModuleConfigurationDetailView } from '@/components/admin/module-configuration/module-configuration-detail-view';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { fetchModuleConfigurationById } from '@/lib/admin/module-configuration-service';
import type { ModuleConfig } from '@/lib/admin/schemas';

function ModuleConfigurationDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const [module, setModule] = useState<ModuleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchModuleConfigurationById(id);
      if (!record) setError('Module configuration not found');
      setModule(record);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !module) return <ErrorCard message={error || 'Not found'} onRetry={load} />;
  return <ModuleConfigurationDetailView module={module} onRefresh={load} />;
}

export default function ModuleConfigurationDetailPage() {
  return (
    <ModuleConfigurationAccessGuard>
      <ModuleConfigurationDetailContent />
    </ModuleConfigurationAccessGuard>
  );
}
