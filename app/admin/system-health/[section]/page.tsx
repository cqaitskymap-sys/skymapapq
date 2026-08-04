'use client';

import { use } from 'react';
import { SystemHealthAccessGuard } from '@/components/admin/system-health/system-health-access-guard';
import { SystemHealthDashboardPage } from '@/components/admin/system-health/system-health-dashboard-page';
import type { SystemHealthSectionId } from '@/lib/admin/system-health-service';

const SECTION_MAP: Record<string, SystemHealthSectionId> = {
  infrastructure: 'infrastructure',
  application: 'application',
  firebase: 'firebase',
  api: 'api',
  database: 'database',
  security: 'security',
  background: 'background',
  integrations: 'integrations',
  alerts: 'alerts',
  reports: 'reports',
  audit: 'audit',
};

export default function AdminSystemHealthSectionPage(props: {
  params: Promise<{ section: string }>;
}) {
  const params = use(props.params);
  const section = SECTION_MAP[params.section] || 'dashboard';

  return (
    <SystemHealthAccessGuard>
      <SystemHealthDashboardPage section={section} />
    </SystemHealthAccessGuard>
  );
}
