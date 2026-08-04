'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EmailSmsTemplatesAccessGuard } from '@/components/admin/email-sms-templates/email-sms-templates-access-guard';
import { EmailSmsTemplateForm } from '@/components/admin/email-sms-templates/email-sms-template-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditEmailSmsTemplates } from '@/lib/permissions';
import { createEmailSmsTemplate } from '@/lib/admin/email-sms-templates-service';
import type { EmailSmsTemplateFormData } from '@/lib/admin/schemas';

function CreateEmailSmsTemplateContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [submitting, setSubmitting] = useState(false);

  if (!canEditEmailSmsTemplates(role)) {
    return <ErrorCard accessDenied message="You do not have permission to create templates." />;
  }

  const onSubmit = async (data: EmailSmsTemplateFormData) => {
    setSubmitting(true);
    const result = await createEmailSmsTemplate(data, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Template created');
    router.push(`/admin/email-sms-templates/${result.template?.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Create Email/SMS Template" description="Communication template with placeholders" basePath="/admin" />
      <EmailSmsTemplateForm
        onSubmit={onSubmit}
        onCancel={() => router.push('/admin/email-sms-templates')}
        submitting={submitting}
      />
    </div>
  );
}

export default function CreateEmailSmsTemplatePage() {
  return (
    <EmailSmsTemplatesAccessGuard>
      <CreateEmailSmsTemplateContent />
    </EmailSmsTemplatesAccessGuard>
  );
}
