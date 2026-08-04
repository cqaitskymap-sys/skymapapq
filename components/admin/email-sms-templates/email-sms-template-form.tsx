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
  TEMPLATE_TYPES, TEMPLATE_CATEGORIES, TEMPLATE_LANGUAGES, TEMPLATE_APPROVAL_STATUSES,
  TEMPLATE_PLACEHOLDERS, NOTIFICATION_PRIORITIES, NOTIFICATION_MODULES,
} from '@/lib/admin/constants';
import { emailSmsTemplateFormSchema, type EmailSmsTemplateFormData } from '@/lib/admin/schemas';
import { previewTemplateLocally } from '@/lib/admin/email-sms-templates-service';

interface EmailSmsTemplateFormProps {
  initial?: Partial<EmailSmsTemplateFormData>;
  readOnly?: boolean;
  onSubmit: (data: EmailSmsTemplateFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function EmailSmsTemplateForm({
  initial, readOnly, onSubmit, onCancel, submitting,
}: EmailSmsTemplateFormProps) {
  const form = useForm<EmailSmsTemplateFormData>({
    resolver: zodResolver(emailSmsTemplateFormSchema),
    defaultValues: {
      templateCode: '',
      templateName: '',
      description: '',
      category: 'General',
      module: 'CAPA',
      subModule: '',
      workflow: '',
      templateType: 'Email',
      subject: '',
      body: 'Dear {{UserName}},\n\n{{DocumentNo}} requires your attention. Status: {{status}}.\n\nRegards,\nSkyMap QMS',
      smsBody: '',
      isHtml: false,
      variables: '',
      priority: 'Medium',
      language: 'en',
      company: '',
      businessUnit: '',
      site: '',
      department: '',
      effectiveDate: '',
      reviewDate: '',
      expiryDate: '',
      approvalStatus: 'Draft',
      remarks: '',
      changeReason: '',
      ...initial,
    },
  });

  useEffect(() => {
    if (initial) form.reset({ ...form.getValues(), ...initial });
  }, [initial, form]);

  const watchAll = form.watch();
  const preview = previewTemplateLocally(watchAll);

  const insertPlaceholder = (name: string) => {
    const current = form.getValues('body') || '';
    form.setValue('body', `${current}{{${name}}}`);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Template Identity</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Template Code *</Label>
              <Input {...form.register('templateCode')} disabled={readOnly || !!initial?.templateCode} />
              {form.formState.errors.templateCode && <p className="text-xs text-red-500">{form.formState.errors.templateCode.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Template Name *</Label>
              <Input {...form.register('templateName')} disabled={readOnly} />
              {form.formState.errors.templateName && <p className="text-xs text-red-500">{form.formState.errors.templateName.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={watchAll.templateType} onValueChange={(v) => form.setValue('templateType', v as EmailSmsTemplateFormData['templateType'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TEMPLATE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select value={watchAll.category} onValueChange={(v) => form.setValue('category', v)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TEMPLATE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Module *</Label>
              <Select value={watchAll.module} onValueChange={(v) => form.setValue('module', v)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {NOTIFICATION_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  {TEMPLATE_CATEGORIES.filter((c) => !(NOTIFICATION_MODULES as readonly string[]).includes(c)).map((c) => (
                    <SelectItem key={`mod-${c}`} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={watchAll.language} onValueChange={(v) => form.setValue('language', v)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TEMPLATE_LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={watchAll.priority} onValueChange={(v) => form.setValue('priority', v as EmailSmsTemplateFormData['priority'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NOTIFICATION_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Approval Status</Label>
              <Select value={watchAll.approvalStatus} onValueChange={(v) => form.setValue('approvalStatus', v as EmailSmsTemplateFormData['approvalStatus'])} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{TEMPLATE_APPROVAL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Description</Label>
              <Textarea {...form.register('description')} rows={2} disabled={readOnly} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Live Preview</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {watchAll.templateType === 'Email' && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Subject</p>
                <p className="font-medium border rounded p-2 bg-slate-50 dark:bg-slate-900/40">{preview.subject || '—'}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {watchAll.templateType === 'SMS' ? `SMS (${preview.smsLength}/160 chars · ${Math.ceil(preview.smsLength / 160) || 1} part(s))` : 'Body'}
              </p>
              <pre className="whitespace-pre-wrap border rounded p-3 bg-slate-50 dark:bg-slate-900/40 text-xs max-h-64 overflow-auto">
                {watchAll.templateType === 'SMS' ? preview.smsBody : preview.body}
              </pre>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Content & Placeholders</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {(watchAll.templateType === 'Email' || watchAll.templateType === 'System Notification') && (
            <div className="space-y-2">
              <Label>Subject *</Label>
              <Input {...form.register('subject')} disabled={readOnly} placeholder="[{{moduleName}}] {{DocumentNo}}" />
              {form.formState.errors.subject && <p className="text-xs text-red-500">{form.formState.errors.subject.message}</p>}
            </div>
          )}
          <div className="space-y-2">
            <Label>Message Body *</Label>
            <Textarea {...form.register('body')} rows={6} disabled={readOnly} />
            {form.formState.errors.body && <p className="text-xs text-red-500">{form.formState.errors.body.message}</p>}
          </div>
          {watchAll.templateType === 'SMS' && (
            <div className="space-y-2">
              <Label>SMS Body</Label>
              <Textarea {...form.register('smsBody')} rows={3} disabled={readOnly} placeholder="Defaults to message body if empty" />
              {form.formState.errors.smsBody && <p className="text-xs text-red-500">{form.formState.errors.smsBody.message}</p>}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox id="isHtml" checked={watchAll.isHtml} onCheckedChange={(c) => form.setValue('isHtml', c === true)} disabled={readOnly} />
            <Label htmlFor="isHtml">Rich HTML email (scripts/event handlers blocked)</Label>
          </div>
          <div className="space-y-2">
            <Label>Custom Variables (comma-separated)</Label>
            <Input {...form.register('variables')} disabled={readOnly} placeholder="CustomField1, CustomField2" />
          </div>
          {!readOnly && (
            <div className="flex flex-wrap gap-1">
              {TEMPLATE_PLACEHOLDERS.slice(0, 24).map((p) => (
                <Button key={p} type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => insertPlaceholder(p)}>
                  {`{{${p}}}`}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Scope & Governance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2"><Label>Sub Module</Label><Input {...form.register('subModule')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Workflow</Label><Input {...form.register('workflow')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Company</Label><Input {...form.register('company')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Business Unit</Label><Input {...form.register('businessUnit')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Site</Label><Input {...form.register('site')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Department</Label><Input {...form.register('department')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Effective Date</Label><Input type="date" {...form.register('effectiveDate')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Review Date</Label><Input type="date" {...form.register('reviewDate')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Expiry Date</Label><Input type="date" {...form.register('expiryDate')} disabled={readOnly} /></div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} rows={2} disabled={readOnly} />
          </div>
          {!readOnly && (
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Change Reason *</Label>
              <Textarea {...form.register('changeReason')} rows={2} placeholder="Reason for creating or updating this template (min 5 characters)" />
              {form.formState.errors.changeReason && <p className="text-xs text-red-500">{form.formState.errors.changeReason.message}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={submitting} className="bg-sky-600 hover:bg-sky-700">
            {submitting ? 'Saving…' : 'Save Template'}
          </Button>
        </div>
      )}
    </form>
  );
}
