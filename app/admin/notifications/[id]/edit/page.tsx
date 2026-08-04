'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { NotificationSettingsAccessGuard } from '@/components/admin/notifications/notification-settings-access-guard';
import { NotificationSettingForm } from '@/components/admin/notifications/notification-setting-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditNotificationSettings } from '@/lib/permissions';
import { fetchNotificationSettingById, updateNotificationSetting } from '@/lib/admin/notification-settings-service';
import { fetchActiveUsers, fetchDepartments } from '@/lib/admin/department-service';
import type { NotificationSetting, NotificationSettingFormData } from '@/lib/admin/schemas';

function EditNotificationSettingContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [setting, setSetting] = useState<NotificationSetting | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [record, u, d] = await Promise.all([
        fetchNotificationSettingById(id),
        fetchActiveUsers(),
        fetchDepartments(),
      ]);
      if (!record) setError('Notification rule not found');
      setSetting(record);
      setUsers(u.map((x) => ({ id: x.id || x.userId || '', name: x.fullName || x.email || '' })));
      setDepartments(d.map((dept) => dept.departmentName).filter(Boolean));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!canEditNotificationSettings(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit notification rules." />;
  }

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !setting) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  const initial: Partial<NotificationSettingFormData> = {
    notificationCode: setting.notificationCode,
    eventName: setting.eventName,
    moduleName: setting.moduleName as NotificationSettingFormData['moduleName'],
    eventTrigger: setting.eventTrigger as NotificationSettingFormData['eventTrigger'],
    eventAliases: (setting.eventAliases || []).join(', '),
    notificationType: setting.notificationType,
    recipientRole: setting.recipientRole,
    recipientUserOptional: setting.recipientUserOptional,
    recipientDepartmentOptional: setting.recipientDepartmentOptional,
    ccRoleOptional: setting.ccRoleOptional,
    escalationRole: setting.escalationRole,
    notifyBeforeDueDays: setting.notifyBeforeDueDays,
    escalationAfterDays: setting.escalationAfterDays,
    repeatReminder: setting.repeatReminder,
    reminderFrequency: setting.reminderFrequency,
    templateSubject: setting.templateSubject,
    templateBody: setting.templateBody,
    priority: setting.priority,
    enableInAppNotification: setting.enableInAppNotification,
    enableEmailNotification: setting.enableEmailNotification,
    enableSmsNotification: setting.enableSmsNotification,
    remarks: setting.remarks,
    changeReason: '',
  };

  const onSubmit = async (data: NotificationSettingFormData) => {
    setSubmitting(true);
    const result = await updateNotificationSetting(id, data, setting, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Notification rule updated');
    router.push(`/admin/notifications/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Notification Rule" description={setting.notificationCode} basePath="/admin" />
      <NotificationSettingForm
        initial={initial}
        users={users}
        departments={departments}
        onSubmit={onSubmit}
        onCancel={() => router.push(`/admin/notifications/${id}`)}
        submitting={submitting}
      />
    </div>
  );
}

export default function EditNotificationSettingPage() {
  return (
    <NotificationSettingsAccessGuard>
      <EditNotificationSettingContent />
    </NotificationSettingsAccessGuard>
  );
}
