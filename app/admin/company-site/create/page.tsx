'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CompanySiteAccessGuard } from '@/components/admin/company-sites/company-site-access-guard';
import { CompanySiteForm } from '@/components/admin/company-sites/company-site-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditCompanySites } from '@/lib/permissions';
import {
  createCompanySite, uploadCompanyLogo, updateCompanyLogoViaCallable,
} from '@/lib/admin/company-site-service';
import type { CompanySiteFormData } from '@/lib/admin/schemas';

function CreateCompanySiteContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [submitting, setSubmitting] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  if (!canEditCompanySites(role)) {
    return <ErrorCard accessDenied message="Only Super Admin and Admin can create company/sites." />;
  }

  const onSubmit = async (data: CompanySiteFormData) => {
    setSubmitting(true);
    const result = await createCompanySite(data, auditMeta);
    if (result.error || !result.site?.id) {
      setSubmitting(false);
      toast.error(result.error || 'Failed to create site');
      return;
    }

    if (logoFile) {
      const upload = await uploadCompanyLogo(result.site.id, logoFile, auditMeta);
      if (upload.url) {
        const logoResult = await updateCompanyLogoViaCallable(
          result.site.id,
          upload.url,
          result.site,
          data.changeReason || 'Company logo uploaded on create',
        );
        if (!logoResult.success) toast.warning(`Site created but logo update failed: ${logoResult.error}`);
      } else if (upload.error) {
        toast.warning(`Site created but logo upload failed: ${upload.error}`);
      }
    }

    setSubmitting(false);
    toast.success('Company/site created');
    router.push(`/admin/company-site/${result.site.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Create Company / Site" description="Add company and site details for document headers and multi-site QMS configuration" basePath="/admin" />
      <CompanySiteForm
        onSubmit={onSubmit}
        onCancel={() => router.push('/admin/company-site')}
        onLogoSelect={setLogoFile}
        submitting={submitting}
      />
    </div>
  );
}

export default function CreateCompanySitePage() {
  return (
    <CompanySiteAccessGuard>
      <CreateCompanySiteContent />
    </CompanySiteAccessGuard>
  );
}
