'use client';

import { NotificationSettingsAccessGuard } from '@/components/admin/notifications/notification-settings-access-guard';
import { NotificationHistoryPage } from '@/components/admin/notifications/notification-history-page';

export default function AdminNotificationHistoryRoute() {
  return (
    <NotificationSettingsAccessGuard>
      <NotificationHistoryPage />
    </NotificationSettingsAccessGuard>
  );
}
