'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ModuleConfigurationAccessGuard } from '@/components/admin/module-configuration/module-configuration-access-guard';
import { ModuleConfigurationForm } from '@/components/admin/module-configuration/module-configuration-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditModuleConfiguration } from '@/lib/permissions';
import { createModuleConfiguration } from '@/lib/admin/module-configuration-service';
import type { ModuleConfigFormData } from '@/lib/admin/schemas';

function CreateModuleConfigurationContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [submitting, setSubmitting] = useState(false);

  if (!canEditModuleConfiguration(role)) {
    return <ErrorCard accessDenied message="You do not have permission to create module configurations." />;
  }

  const onSubmit = async (data: ModuleConfigFormData) => {
    setSubmitting(true);
    const result = await createModuleConfiguration(data, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Module configuration created');
    router.push(`/admin/module-configuration/${result.module?.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Add Module Configuration" description="Register a QMS module with flags and dependencies" basePath="/admin" />
      <ModuleConfigurationForm
        onSubmit={onSubmit}
        onCancel={() => router.push('/admin/module-configuration')}
        submitting={submitting}
      />
    </div>
  );
}

export default function CreateModuleConfigurationPage() {
  return (
    <ModuleConfigurationAccessGuard>
      <CreateModuleConfigurationContent />
    </ModuleConfigurationAccessGuard>
  );
}
