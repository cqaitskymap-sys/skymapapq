'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EmailSmsTemplatesAccessGuard } from '@/components/admin/email-sms-templates/email-sms-templates-access-guard';
import { EmailSmsTemplateForm } from '@/components/admin/email-sms-templates/email-sms-template-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditEmailSmsTemplates } from '@/lib/permissions';
import {
  fetchEmailSmsTemplateById, updateEmailSmsTemplate, templateToFormData,
} from '@/lib/admin/email-sms-templates-service';
import type { EmailSmsTemplate, EmailSmsTemplateFormData } from '@/lib/admin/schemas';

function EditEmailSmsTemplateContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [template, setTemplate] = useState<EmailSmsTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchEmailSmsTemplateById(id);
      if (!record) setError('Template not found');
      setTemplate(record);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!canEditEmailSmsTemplates(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit templates." />;
  }
  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !template) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  const onSubmit = async (data: EmailSmsTemplateFormData) => {
    setSubmitting(true);
    const result = await updateEmailSmsTemplate(id, data, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Template updated (new version snapshot saved)');
    router.push(`/admin/email-sms-templates/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Template" description={template.templateCode} basePath="/admin" />
      <EmailSmsTemplateForm
        initial={templateToFormData(template)}
        onSubmit={onSubmit}
        onCancel={() => router.push(`/admin/email-sms-templates/${id}`)}
        submitting={submitting}
      />
    </div>
  );
}

export default function EditEmailSmsTemplatePage() {
  return (
    <EmailSmsTemplatesAccessGuard>
      <EditEmailSmsTemplateContent />
    </EmailSmsTemplatesAccessGuard>
  );
}
