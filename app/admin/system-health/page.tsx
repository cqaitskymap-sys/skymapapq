'use client';

import { SystemHealthAccessGuard } from '@/components/admin/system-health/system-health-access-guard';
import { SystemHealthDashboardPage } from '@/components/admin/system-health/system-health-dashboard-page';

export default function AdminSystemHealthPage() {
  return (
    <SystemHealthAccessGuard>
      <SystemHealthDashboardPage section="dashboard" />
    </SystemHealthAccessGuard>
  );
}
