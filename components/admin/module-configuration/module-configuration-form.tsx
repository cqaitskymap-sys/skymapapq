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
  MODULE_CONFIG_CATEGORIES, MODULE_LICENSE_STATUSES, MODULE_FEATURE_STATUSES,
  MODULE_VISIBILITY_STATUSES, SYSTEM_ENVIRONMENTS,
} from '@/lib/admin/constants';
import { moduleConfigFormSchema, type ModuleConfigFormData } from '@/lib/admin/schemas';

interface ModuleConfigurationFormProps {
  initial?: Partial<ModuleConfigFormData>;
  readOnly?: boolean;
  onSubmit: (data: ModuleConfigFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function ModuleConfigurationForm({
  initial, readOnly, onSubmit, onCancel, submitting,
}: ModuleConfigurationFormProps) {
  const form = useForm<ModuleConfigFormData>({
    resolver: zodResolver(moduleConfigFormSchema),
    defaultValues: {
      moduleCode: '',
      moduleName: '',
      displayName: '',
      moduleCategory: 'QMS',
      description: '',
      displayOrder: 100,
      menuGroup: '',
      navigationPath: '',
      icon: '',
      version: '1.0.0',
      buildNumber: '',
      isEnabled: true,
      isInstalled: true,
      isSystemModule: false,
      isCritical: false,
      isVisible: true,
      visibility: 'Visible',
      licenseStatus: 'Licensed',
      featureStatus: 'GA',
      environment: 'Production',
      company: '',
      businessUnit: '',
      site: '',
      department: '',
      requiredRole: '',
      dependencies: '',
      featureFlagsJson: '[]',
      configurationJson: '{}',
      remarks: '',
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
      <Card>
        <CardHeader><CardTitle className="text-base">Module Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Module Code *</Label>
            <Input {...form.register('moduleCode')} disabled={readOnly || !!initial?.moduleCode} />
            {form.formState.errors.moduleCode && <p className="text-xs text-red-500">{form.formState.errors.moduleCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Module Name *</Label>
            <Input {...form.register('moduleName')} disabled={readOnly} />
            {form.formState.errors.moduleName && <p className="text-xs text-red-500">{form.formState.errors.moduleName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Display Name</Label>
            <Input {...form.register('displayName')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={watchAll.moduleCategory} onValueChange={(v) => form.setValue('moduleCategory', v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODULE_CONFIG_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Navigation Path</Label>
            <Input {...form.register('navigationPath')} disabled={readOnly} placeholder="/admin/example" />
          </div>
          <div className="space-y-2">
            <Label>Icon</Label>
            <Input {...form.register('icon')} disabled={readOnly} placeholder="LayoutDashboard" />
          </div>
          <div className="space-y-2">
            <Label>Menu Group</Label>
            <Input {...form.register('menuGroup')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Display Order</Label>
            <Input type="number" min={0} {...form.register('displayOrder')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Version</Label>
            <Input {...form.register('version')} disabled={readOnly} />
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label>Description</Label>
            <Textarea {...form.register('description')} rows={2} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Status, License & Environment</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>License</Label>
            <Select value={watchAll.licenseStatus} onValueChange={(v) => form.setValue('licenseStatus', v as ModuleConfigFormData['licenseStatus'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODULE_LICENSE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Feature Status</Label>
            <Select value={watchAll.featureStatus} onValueChange={(v) => form.setValue('featureStatus', v as ModuleConfigFormData['featureStatus'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODULE_FEATURE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Environment</Label>
            <Select value={watchAll.environment} onValueChange={(v) => form.setValue('environment', v as ModuleConfigFormData['environment'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SYSTEM_ENVIRONMENTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={watchAll.visibility} onValueChange={(v) => form.setValue('visibility', v as ModuleConfigFormData['visibility'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MODULE_VISIBILITY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Required Role</Label>
            <Input {...form.register('requiredRole')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Build Number</Label>
            <Input {...form.register('buildNumber')} disabled={readOnly} />
          </div>
          <div className="flex flex-wrap gap-4 sm:col-span-2 lg:col-span-3 pt-2">
            {[
              ['isEnabled', 'Enabled'],
              ['isInstalled', 'Installed'],
              ['isVisible', 'Visible'],
              ['isSystemModule', 'System Module'],
              ['isCritical', 'Critical'],
            ].map(([key, label]) => (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={key}
                  checked={Boolean(watchAll[key as keyof ModuleConfigFormData])}
                  onCheckedChange={(c) => form.setValue(key as keyof ModuleConfigFormData, c === true as never)}
                  disabled={readOnly}
                />
                <Label htmlFor={key}>{label}</Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Dependencies & Feature Flags</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Dependencies (module codes, comma-separated)</Label>
            <Input {...form.register('dependencies')} disabled={readOnly} placeholder="USERS, WORKFLOWS" />
            <p className="text-[11px] text-muted-foreground">Enabled modules require all listed dependencies to be enabled.</p>
          </div>
          <div className="space-y-2">
            <Label>Feature Flags (JSON array)</Label>
            <Textarea {...form.register('featureFlagsJson')} rows={5} disabled={readOnly} className="font-mono text-xs" />
            {form.formState.errors.featureFlagsJson && <p className="text-xs text-red-500">{form.formState.errors.featureFlagsJson.message}</p>}
            <p className="text-[11px] text-muted-foreground">
              {`Example: [{"key":"ai_insights","label":"AI Insights","enabled":false,"rollout":"Beta","roles":["admin"]}]`}
            </p>
          </div>
          <div className="space-y-2">
            <Label>Configuration JSON</Label>
            <Textarea {...form.register('configurationJson')} rows={4} disabled={readOnly} className="font-mono text-xs" />
            {form.formState.errors.configurationJson && <p className="text-xs text-red-500">{form.formState.errors.configurationJson.message}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Scope & Governance</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2"><Label>Company</Label><Input {...form.register('company')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Business Unit</Label><Input {...form.register('businessUnit')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Site</Label><Input {...form.register('site')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Department</Label><Input {...form.register('department')} disabled={readOnly} /></div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} rows={2} disabled={readOnly} />
          </div>
          {!readOnly && (
            <div className="space-y-2 sm:col-span-2 lg:col-span-3">
              <Label>Change Reason *</Label>
              <Textarea {...form.register('changeReason')} rows={2} placeholder="Reason for creating or updating this configuration (min 5 characters)" />
              {form.formState.errors.changeReason && <p className="text-xs text-red-500">{form.formState.errors.changeReason.message}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={submitting} className="bg-sky-600 hover:bg-sky-700">
            {submitting ? 'Saving…' : 'Save Module Configuration'}
          </Button>
        </div>
      )}
    </form>
  );
}
