'use client';

import { EmailSmsTemplatesAccessGuard } from '@/components/admin/email-sms-templates/email-sms-templates-access-guard';
import { EmailSmsTemplatesListPage } from '@/components/admin/email-sms-templates/email-sms-templates-list-page';

export default function AdminEmailSmsTemplatesPage() {
  return (
    <EmailSmsTemplatesAccessGuard>
      <EmailSmsTemplatesListPage />
    </EmailSmsTemplatesAccessGuard>
  );
}
