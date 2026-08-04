'use client';

import { NotificationSettingsAccessGuard } from '@/components/admin/notifications/notification-settings-access-guard';
import { NotificationQueuePage } from '@/components/admin/notifications/notification-queue-page';

export default function AdminNotificationQueueRoute() {
  return (
    <NotificationSettingsAccessGuard>
      <NotificationQueuePage />
    </NotificationSettingsAccessGuard>
  );
}
