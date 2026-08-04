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
  WORKFLOW_MODULE_OPTIONS, WORKFLOW_TYPES, WORKFLOW_CATEGORIES, WORKFLOW_PRIORITIES, ADMIN_ROLES,
} from '@/lib/admin/constants';
import { workflowFormSchema, type WorkflowFormData } from '@/lib/admin/schemas';
import { WorkflowStepBuilder } from './workflow-step-builder';
import { WorkflowFlowchart } from './workflow-flowchart';

interface WorkflowFormProps {
  initial?: Partial<WorkflowFormData>;
  readOnly?: boolean;
  isEdit?: boolean;
  roles?: { id: string; name: string }[];
  onSubmit: (data: WorkflowFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

const defaultValues: WorkflowFormData = {
  workflowCode: '',
  workflowName: '',
  moduleName: 'PQR',
  subModule: '',
  workflowCategory: 'Approval',
  businessUnit: '',
  site: '',
  department: 'QA',
  workflowType: 'Multi Level Approval',
  triggerEvent: '',
  priority: 'Medium',
  slaHours: undefined,
  parallelApproval: false,
  sequentialApproval: true,
  conditionalRouting: false,
  workflowVersion: '1.0',
  effectiveDate: '',
  reviewDate: '',
  expiryDate: '',
  initiatorRole: 'qa_executive',
  reviewerRoles: '',
  approverRoles: '',
  finalApproverRole: 'head_qa',
  escalationRole: 'head_qa',
  approvalLevels: 1,
  requireESignature: true,
  requireRemarks: true,
  allowRejection: true,
  allowResubmission: true,
  allowDelegation: false,
  autoEscalationEnabled: false,
  escalationDays: 3,
  targetCompletionDays: 30,
  description: '',
  remarks: '',
  changeReason: '',
  steps: [],
};

export function WorkflowForm({
  initial, readOnly, isEdit, roles, onSubmit, onCancel, submitting,
}: WorkflowFormProps) {
  const form = useForm<WorkflowFormData>({
    resolver: zodResolver(workflowFormSchema),
    defaultValues: { ...defaultValues, ...initial },
  });

  useEffect(() => {
    if (initial) form.reset({ ...defaultValues, ...initial });
  }, [initial, form]);

  const steps = form.watch('steps') || [];
  const roleOptions: { id: string; name: string }[] = roles || ADMIN_ROLES.map((r) => ({ id: r.id, name: r.name }));

  const handleSubmit = (data: WorkflowFormData) => {
    if (isEdit && data.changeReason.trim().length < 5) {
      form.setError('changeReason', { message: 'Change reason is required (min 5 characters)' });
      return;
    }
    onSubmit(data);
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Workflow Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Workflow Code *</Label>
            <Input {...form.register('workflowCode')} disabled={readOnly || !!initial?.workflowCode} />
            {form.formState.errors.workflowCode && <p className="text-xs text-red-500">{form.formState.errors.workflowCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Workflow Name *</Label>
            <Input {...form.register('workflowName')} disabled={readOnly} />
            {form.formState.errors.workflowName && <p className="text-xs text-red-500">{form.formState.errors.workflowName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Module *</Label>
            <Select
              value={form.watch('moduleName')}
              onValueChange={(v) => form.setValue('moduleName', v as WorkflowFormData['moduleName'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORKFLOW_MODULE_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Sub Module</Label>
            <Input {...form.register('subModule')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Workflow Type *</Label>
            <Select
              value={form.watch('workflowType')}
              onValueChange={(v) => form.setValue('workflowType', v as WorkflowFormData['workflowType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORKFLOW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={form.watch('workflowCategory') || 'Approval'}
              onValueChange={(v) => form.setValue('workflowCategory', v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORKFLOW_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Input {...form.register('department')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Business Unit</Label>
            <Input {...form.register('businessUnit')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Site</Label>
            <Input {...form.register('site')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Trigger Event</Label>
            <Input {...form.register('triggerEvent')} disabled={readOnly} placeholder="e.g. Deviation Created" />
          </div>
          <div className="space-y-2">
            <Label>Priority</Label>
            <Select
              value={form.watch('priority') || 'Medium'}
              onValueChange={(v) => form.setValue('priority', v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORKFLOW_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>SLA (Hours)</Label>
            <Input type="number" min={0} {...form.register('slaHours', { valueAsNumber: true })} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Version</Label>
            <Input {...form.register('workflowVersion')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Effective Date</Label>
            <Input type="date" {...form.register('effectiveDate')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Review Date</Label>
            <Input type="date" {...form.register('reviewDate')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Expiry Date</Label>
            <Input type="date" {...form.register('expiryDate')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Approval Levels</Label>
            <Input type="number" min={1} {...form.register('approvalLevels', { valueAsNumber: true })} disabled={readOnly} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Description</Label>
            <Textarea {...form.register('description')} disabled={readOnly} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Roles & Escalation</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Initiator Role</Label>
            <Select value={form.watch('initiatorRole')} onValueChange={(v) => form.setValue('initiatorRole', v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Final Approver Role *</Label>
            <Select value={form.watch('finalApproverRole')} onValueChange={(v) => form.setValue('finalApproverRole', v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.formState.errors.finalApproverRole && <p className="text-xs text-red-500">{form.formState.errors.finalApproverRole.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Escalation Role</Label>
            <Select value={form.watch('escalationRole')} onValueChange={(v) => form.setValue('escalationRole', v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roleOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Escalation Days</Label>
            <Input type="number" min={0} {...form.register('escalationDays', { valueAsNumber: true })} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Target Completion Days</Label>
            <Input type="number" min={0} {...form.register('targetCompletionDays', { valueAsNumber: true })} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Approval Engine Options</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { key: 'requireESignature', label: 'Require E-Signature' },
            { key: 'requireRemarks', label: 'Require Remarks' },
            { key: 'allowRejection', label: 'Allow Rejection' },
            { key: 'allowResubmission', label: 'Allow Resubmission / Rework' },
            { key: 'allowDelegation', label: 'Allow Delegation' },
            { key: 'autoEscalationEnabled', label: 'Auto Escalation' },
            { key: 'parallelApproval', label: 'Parallel Approval' },
            { key: 'sequentialApproval', label: 'Sequential Approval' },
            { key: 'conditionalRouting', label: 'Conditional Routing' },
          ].map((item) => (
            <div key={item.key} className="flex items-center gap-2">
              <Checkbox
                checked={form.watch(item.key as keyof WorkflowFormData) as boolean}
                onCheckedChange={(v) => form.setValue(item.key as keyof WorkflowFormData, Boolean(v) as never)}
                disabled={readOnly}
              />
              <Label className="text-sm">{item.label}</Label>
            </div>
          ))}
          <div className="space-y-2 sm:col-span-3">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} />
          </div>
        </CardContent>
      </Card>

      <WorkflowStepBuilder
        steps={steps}
        onChange={(s) => {
          form.setValue('steps', s);
          form.setValue('approvalLevels', s.length);
        }}
        readOnly={readOnly}
        roles={roleOptions}
      />
      {form.formState.errors.steps && <p className="text-xs text-red-500">{String(form.formState.errors.steps.message || form.formState.errors.steps.root?.message || '')}</p>}

      <Card>
        <CardHeader><CardTitle className="text-base">Workflow Designer Preview</CardTitle></CardHeader>
        <CardContent>
          <WorkflowFlowchart steps={steps.map((s, i) => ({ ...s, stepNumber: i + 1 }))} />
        </CardContent>
      </Card>

      {isEdit && !readOnly && (
        <Card>
          <CardHeader><CardTitle className="text-base">GMP Change Control</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Change Reason *</Label>
              <Textarea {...form.register('changeReason')} rows={2} placeholder="Document reason for this change (min 5 characters)" />
              {form.formState.errors.changeReason && <p className="text-xs text-red-500">{form.formState.errors.changeReason.message}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {!readOnly && (
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Workflow'}
          </Button>
        </div>
      )}
    </form>
  );
}
