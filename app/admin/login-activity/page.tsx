'use client';

import { LoginActivityAccessGuard } from '@/components/admin/login-activity/login-activity-access-guard';
import { LoginActivityListPage } from '@/components/admin/login-activity/login-activity-list-page';

export default function AdminLoginActivityPage() {
  return (
    <LoginActivityAccessGuard>
      <LoginActivityListPage />
    </LoginActivityAccessGuard>
  );
}
