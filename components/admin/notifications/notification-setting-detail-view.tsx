'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Send, UserCheck, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { PriorityBadge } from './priority-badge';
import { TemplatePreviewCard } from './template-preview-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditNotificationSettings } from '@/lib/permissions';
import type { NotificationSetting } from '@/lib/admin/schemas';
import { setNotificationSettingStatus, sendTestNotification } from '@/lib/admin/notification-settings-service';

interface NotificationSettingDetailViewProps {
  setting: NotificationSetting;
  onRefresh: () => void;
}

export function NotificationSettingDetailView({ setting, onRefresh }: NotificationSettingDetailViewProps) {
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditNotificationSettings(role);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [loading, setLoading] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const toggleStatus = async () => {
    setLoading(true);
    const activate = setting.status !== 'Active';
    const result = await setNotificationSettingStatus(setting.id!, setting, activate ? 'Active' : 'Inactive', auditMeta);
    setLoading(false);
    if (result.success) {
      toast.success(activate ? 'Rule activated' : 'Rule deactivated');
      onRefresh();
    } else toast.error(result.error || 'Action failed');
    setConfirmDeactivate(false);
  };

  const runTest = async () => {
    setLoading(true);
    const result = await sendTestNotification(setting, auditMeta);
    setLoading(false);
    if (result.success) toast.success('Test notification sent');
    else toast.error(result.error || 'Test failed');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={setting.notificationCode}
        description={`${setting.eventName} · ${setting.moduleName}`}
        basePath="/admin"
        actions={
          canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/notifications/queue">Queue</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/notifications/history">History</Link>
              </Button>
              <Button variant="outline" size="sm" onClick={runTest} disabled={loading}>
                <Send className="h-4 w-4 mr-1" />Send Test
              </Button>
              {setting.status === 'Active' ? (
                <Button variant="outline" size="sm" onClick={() => setConfirmDeactivate(true)} disabled={loading}>
                  <UserX className="h-4 w-4 mr-1" />Deactivate
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={toggleStatus} disabled={loading}>
                  <UserCheck className="h-4 w-4 mr-1" />Activate
                </Button>
              )}
              <Button size="sm" asChild className="bg-sky-600 hover:bg-sky-700">
                <Link href={`/admin/notifications/${setting.id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/notifications/queue">Queue</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/notifications/history">History</Link>
              </Button>
            </div>
          )
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={setting.status} />
        <ModuleBadge module={setting.moduleName} />
        <PriorityBadge priority={setting.priority} />
        <span className="text-xs px-2 py-1 rounded bg-slate-100">{setting.notificationType}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Setting ID</span><span className="font-mono">{setting.notificationSettingId}</span>
            <span className="text-muted-foreground">Event Trigger</span><span>{setting.eventTrigger}</span>
            <span className="text-muted-foreground">Event Aliases</span>
            <span>{(setting.eventAliases || []).length ? setting.eventAliases.join(', ') : '—'}</span>
            <span className="text-muted-foreground">Recipient Role</span><span>{setting.recipientRole}</span>
            <span className="text-muted-foreground">Escalation Role</span><span>{setting.escalationRole || '—'}</span>
            <span className="text-muted-foreground">Before Due Days</span><span>{setting.notifyBeforeDueDays}</span>
            <span className="text-muted-foreground">Escalation After</span><span>{setting.escalationAfterDays}</span>
            <span className="text-muted-foreground">Repeat Reminder</span><span>{setting.repeatReminder ? setting.reminderFrequency : 'No'}</span>
            <span className="text-muted-foreground">Prevent Duplicates</span>
            <span>{setting.preventDuplicates !== false ? `Yes (${setting.duplicateWindowMinutes || 60}m)` : 'No'}</span>
            <span className="text-muted-foreground">In-App / Email / SMS</span>
            <span>{setting.enableInAppNotification ? 'Yes' : 'No'} / {setting.enableEmailNotification ? 'Yes' : 'No'} / {setting.enableSmsNotification ? 'Yes' : 'No'}</span>
          </CardContent>
        </Card>
        <TemplatePreviewCard setting={setting} />
      </div>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate notification rule?</AlertDialogTitle>
            <AlertDialogDescription>Automated notifications for this rule will stop until reactivated.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggleStatus}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
