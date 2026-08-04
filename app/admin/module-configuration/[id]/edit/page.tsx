'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ModuleConfigurationAccessGuard } from '@/components/admin/module-configuration/module-configuration-access-guard';
import { ModuleConfigurationForm } from '@/components/admin/module-configuration/module-configuration-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditModuleConfiguration } from '@/lib/permissions';
import {
  fetchModuleConfigurationById, updateModuleConfiguration, moduleToFormData,
} from '@/lib/admin/module-configuration-service';
import type { ModuleConfig, ModuleConfigFormData } from '@/lib/admin/schemas';

function EditModuleConfigurationContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [module, setModule] = useState<ModuleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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

  if (!canEditModuleConfiguration(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit module configurations." />;
  }
  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !module) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  const onSubmit = async (data: ModuleConfigFormData) => {
    setSubmitting(true);
    const result = await updateModuleConfiguration(id, data, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Module configuration updated');
    router.push(`/admin/module-configuration/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Module Configuration" description={module.moduleCode} basePath="/admin" />
      <ModuleConfigurationForm
        initial={moduleToFormData(module)}
        onSubmit={onSubmit}
        onCancel={() => router.push(`/admin/module-configuration/${id}`)}
        submitting={submitting}
      />
    </div>
  );
}

export default function EditModuleConfigurationPage() {
  return (
    <ModuleConfigurationAccessGuard>
      <EditModuleConfigurationContent />
    </ModuleConfigurationAccessGuard>
  );
}
