'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  NOTIFICATION_MODULES, NOTIFICATION_EVENT_TRIGGERS, NOTIFICATION_CHANNEL_TYPES,
  NOTIFICATION_PRIORITIES, REMINDER_FREQUENCIES, ADMIN_ROLES,
} from '@/lib/admin/constants';
import { notificationSettingFormSchema, type NotificationSettingFormData } from '@/lib/admin/schemas';
import { TemplatePreviewCard } from './template-preview-card';

interface NotificationSettingFormProps {
  initial?: Partial<NotificationSettingFormData>;
  users?: { id: string; name: string }[];
  departments?: string[];
  readOnly?: boolean;
  onSubmit: (data: NotificationSettingFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function NotificationSettingForm({
  initial, users, departments, readOnly, onSubmit, onCancel, submitting,
}: NotificationSettingFormProps) {
  const form = useForm<NotificationSettingFormData>({
    resolver: zodResolver(notificationSettingFormSchema),
    defaultValues: {
      notificationCode: '',
      eventName: '',
      moduleName: 'PQR',
      eventTrigger: 'Approval Pending',
      notificationType: 'In-App + Email',
      recipientRole: 'head_qa',
      recipientUserOptional: '',
      recipientDepartmentOptional: '',
      ccRoleOptional: '',
      escalationRole: '',
      notifyBeforeDueDays: 3,
      escalationAfterDays: 7,
      repeatReminder: false,
      reminderFrequency: 'None',
      templateSubject: '',
      templateBody: 'Record {{documentNumber}} in {{moduleName}} requires action. Status: {{status}}.',
      priority: 'Medium',
      enableInAppNotification: true,
      enableEmailNotification: true,
      enableSmsNotification: false,
      remarks: '',
      eventAliases: '',
      changeReason: '',
      ...initial,
    },
  });

  useEffect(() => {
    if (initial) form.reset({ ...form.getValues(), ...initial });
  }, [initial, form]);

  const watchAll = form.watch();

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Rule Identity</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Notification Code *</Label>
              <Input {...form.register('notificationCode')} disabled={readOnly || !!initial?.notificationCode} />
              {form.formState.errors.notificationCode && <p className="text-xs text-red-500">{form.formState.errors.notificationCode.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Event Name *</Label>
              <Input {...form.register('eventName')} disabled={readOnly} />
              {form.formState.errors.eventName && <p className="text-xs text-red-500">{form.formState.errors.eventName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Module *</Label>
              <Select value={watchAll.moduleName} onValueChange={(v) => form.setValue('moduleName', v as NotificationSettingFormData['moduleName'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTIFICATION_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Event Trigger *</Label>
              <Select value={watchAll.eventTrigger} onValueChange={(v) => form.setValue('eventTrigger', v as NotificationSettingFormData['eventTrigger'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTIFICATION_EVENT_TRIGGERS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Event Aliases (comma-separated)</Label>
              <Input
                {...form.register('eventAliases')}
                disabled={readOnly}
                placeholder="e.g. CAPA Overdue, CAPA Due Soon"
              />
              <p className="text-[11px] text-muted-foreground">
                Extra trigger names that match this rule (placeholders: {'{{UserName}}'}, {'{{DocumentNo}}'}, {'{{DueDate}}'}, {'{{Status}}'}, …)
              </p>
            </div>
            <div className="space-y-2">
              <Label>Notification Type</Label>
              <Select value={watchAll.notificationType} onValueChange={(v) => form.setValue('notificationType', v as NotificationSettingFormData['notificationType'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTIFICATION_CHANNEL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={watchAll.priority} onValueChange={(v) => form.setValue('priority', v as NotificationSettingFormData['priority'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTIFICATION_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
        <TemplatePreviewCard setting={watchAll} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recipients & Escalation</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Recipient Role *</Label>
            <Select value={watchAll.recipientRole || '__none__'} onValueChange={(v) => form.setValue('recipientRole', v === '__none__' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {ADMIN_ROLES.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.formState.errors.recipientRole && <p className="text-xs text-red-500">{form.formState.errors.recipientRole.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Recipient User (Optional)</Label>
            <Select value={watchAll.recipientUserOptional || '__none__'} onValueChange={(v) => form.setValue('recipientUserOptional', v === '__none__' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {(users || []).map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Recipient Department (Optional)</Label>
            <Select value={watchAll.recipientDepartmentOptional || '__none__'} onValueChange={(v) => form.setValue('recipientDepartmentOptional', v === '__none__' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {(departments || []).map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>CC Role (Optional)</Label>
            <Select value={watchAll.ccRoleOptional || '__none__'} onValueChange={(v) => form.setValue('ccRoleOptional', v === '__none__' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {ADMIN_ROLES.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Escalation Role</Label>
            <Select value={watchAll.escalationRole || '__none__'} onValueChange={(v) => form.setValue('escalationRole', v === '__none__' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {ADMIN_ROLES.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Notify Before Due (days)</Label>
            <Input type="number" min={0} {...form.register('notifyBeforeDueDays')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Escalation After (days)</Label>
            <Input type="number" min={0} {...form.register('escalationAfterDays')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Reminder Frequency</Label>
            <Select value={watchAll.reminderFrequency} onValueChange={(v) => form.setValue('reminderFrequency', v as NotificationSettingFormData['reminderFrequency'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{REMINDER_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Checkbox id="repeatReminder" checked={watchAll.repeatReminder} onCheckedChange={(c) => form.setValue('repeatReminder', c === true)} disabled={readOnly} />
            <Label htmlFor="repeatReminder">Repeat Reminder</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Channels & Template</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Checkbox id="inApp" checked={watchAll.enableInAppNotification} onCheckedChange={(c) => form.setValue('enableInAppNotification', c === true)} disabled={readOnly} />
              <Label htmlFor="inApp">Enable In-App</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="email" checked={watchAll.enableEmailNotification} onCheckedChange={(c) => form.setValue('enableEmailNotification', c === true)} disabled={readOnly} />
              <Label htmlFor="email">Enable Email</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="sms" checked={watchAll.enableSmsNotification} onCheckedChange={(c) => form.setValue('enableSmsNotification', c === true)} disabled={readOnly} />
              <Label htmlFor="sms">Enable SMS (placeholder)</Label>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Template Subject {watchAll.enableEmailNotification && '*'}</Label>
            <Input {...form.register('templateSubject')} disabled={readOnly} placeholder="[{{moduleName}}] {{eventName}} — {{documentNumber}}" />
            {form.formState.errors.templateSubject && <p className="text-xs text-red-500">{form.formState.errors.templateSubject.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Template Body *</Label>
            <Textarea {...form.register('templateBody')} rows={5} disabled={readOnly} />
            {form.formState.errors.templateBody && <p className="text-xs text-red-500">{form.formState.errors.templateBody.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} rows={2} disabled={readOnly} />
          </div>
          {!readOnly && (
            <div className="space-y-2">
              <Label>Change Reason *</Label>
              <Textarea
                {...form.register('changeReason')}
                rows={2}
                placeholder="Reason for creating or updating this rule (min 5 characters)"
              />
              {form.formState.errors.changeReason && (
                <p className="text-xs text-red-500">{form.formState.errors.changeReason.message}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={submitting} className="bg-sky-600 hover:bg-sky-700">
            {submitting ? 'Saving…' : 'Save Notification Rule'}
          </Button>
        </div>
      )}
    </form>
  );
}
