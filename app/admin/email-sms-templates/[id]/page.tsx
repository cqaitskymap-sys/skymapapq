'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { EmailSmsTemplatesAccessGuard } from '@/components/admin/email-sms-templates/email-sms-templates-access-guard';
import { EmailSmsTemplateDetailView } from '@/components/admin/email-sms-templates/email-sms-template-detail-view';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { fetchEmailSmsTemplateById } from '@/lib/admin/email-sms-templates-service';
import type { EmailSmsTemplate } from '@/lib/admin/schemas';

function EmailSmsTemplateDetailContent() {
  const params = useParams();
  const id = params.id as string;
  const [template, setTemplate] = useState<EmailSmsTemplate | null>(null);
  const [loading, setLoading] = useState(true);
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

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !template) return <ErrorCard message={error || 'Not found'} onRetry={load} />;
  return <EmailSmsTemplateDetailView template={template} onRefresh={load} />;
}

export default function EmailSmsTemplateDetailPage() {
  return (
    <EmailSmsTemplatesAccessGuard>
      <EmailSmsTemplateDetailContent />
    </EmailSmsTemplatesAccessGuard>
  );
}
