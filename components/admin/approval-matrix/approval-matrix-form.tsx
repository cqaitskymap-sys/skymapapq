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
  APPROVAL_MATRIX_MODULES, RISK_LEVELS, ADMIN_ROLES, DEPARTMENT_TYPES,
  APPROVAL_MODES, APPROVAL_MATRIX_PRIORITIES,
} from '@/lib/admin/constants';
import { approvalMatrixFormSchema, type ApprovalMatrixFormData } from '@/lib/admin/schemas';
import { ApprovalFlowPreview } from './approval-flow-preview';
import type { ApprovalMatrix } from '@/lib/admin/schemas';

interface ApprovalMatrixFormProps {
  initial?: Partial<ApprovalMatrixFormData>;
  sites?: string[];
  products?: { code: string; name: string }[];
  readOnly?: boolean;
  isEdit?: boolean;
  roles?: { id: string; name: string }[];
  onSubmit: (data: ApprovalMatrixFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

function rolesToOptions(roles?: { id: string; name: string }[]) {
  return roles || ADMIN_ROLES.map((r) => ({ id: r.id, name: r.name }));
}

const defaultValues: ApprovalMatrixFormData = {
  matrixCode: '',
  matrixName: '',
  description: '',
  moduleName: 'PQR',
  subModule: '',
  department: 'QA',
  siteLocation: '',
  businessUnit: '',
  workflowCode: '',
  documentType: '',
  category: '',
  priority: 'Medium',
  productOptional: '',
  processOptional: '',
  riskLevel: 'Medium',
  approvalMode: 'Sequential',
  matrixVersion: '1.0',
  effectiveDate: '',
  reviewDate: '',
  preparedByRole: 'qa_executive',
  reviewedByRole: '',
  verifiedByRole: '',
  approvedByRole: '',
  finalApproverRole: 'head_qa',
  escalationRole: 'head_qa',
  approvalGroup: '',
  quorumCount: undefined,
  minimumApprovalLevel: 1,
  slaHours: undefined,
  reminderHours: undefined,
  autoEscalationEnabled: false,
  autoEscalationHours: undefined,
  autoApproveEnabled: false,
  allowReject: true,
  allowReturn: true,
  allowRework: true,
  allowResubmit: true,
  allowCancel: false,
  allowSkip: false,
  eSignatureRequired: true,
  digitalSignatureRequired: false,
  approvalCommentRequired: true,
  parallelApprovalAllowed: false,
  sequentialApprovalRequired: true,
  conditionalApprovalEnabled: false,
  conditionExpression: '',
  delegationAllowed: false,
  remarks: '',
  changeReason: '',
};

export function ApprovalMatrixForm({
  initial, sites, products, readOnly, isEdit, roles, onSubmit, onCancel, submitting,
}: ApprovalMatrixFormProps) {
  const form = useForm<ApprovalMatrixFormData>({
    resolver: zodResolver(approvalMatrixFormSchema),
    defaultValues: { ...defaultValues, ...initial },
  });

  useEffect(() => {
    if (initial) form.reset({ ...defaultValues, ...initial });
  }, [initial, form]);

  const roleOptions = rolesToOptions(roles);
  const watchAll = form.watch();
  const approvalMode = form.watch('approvalMode');
  const autoEscalationEnabled = form.watch('autoEscalationEnabled');
  const conditionalApprovalEnabled = form.watch('conditionalApprovalEnabled');

  const previewMatrix = {
    ...watchAll,
    module: watchAll.moduleName,
    moduleName: watchAll.moduleName,
    status: 'Active' as const,
    preparedByRole: watchAll.preparedByRole,
    reviewedByRole: watchAll.reviewedByRole,
    verifiedByRole: watchAll.verifiedByRole,
    approvedByRole: watchAll.approvedByRole,
    finalApproverRole: watchAll.finalApproverRole,
    eSignatureRequired: watchAll.eSignatureRequired,
    approvalCommentRequired: watchAll.approvalCommentRequired,
  } as unknown as ApprovalMatrix;

  const handleSubmit = (data: ApprovalMatrixFormData) => {
    if (isEdit && data.changeReason.trim().length < 5) {
      form.setError('changeReason', { message: 'Change reason is required (min 5 characters)' });
      return;
    }
    onSubmit(data);
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Matrix Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Matrix Code *</Label>
            <Input {...form.register('matrixCode')} disabled={readOnly || !!initial?.matrixCode} />
            {form.formState.errors.matrixCode && <p className="text-xs text-red-500">{form.formState.errors.matrixCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Matrix Name *</Label>
            <Input {...form.register('matrixName')} disabled={readOnly} />
            {form.formState.errors.matrixName && <p className="text-xs text-red-500">{form.formState.errors.matrixName.message}</p>}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Description</Label>
            <Textarea {...form.register('description')} disabled={readOnly} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Module Name *</Label>
            <Select
              value={form.watch('moduleName')}
              onValueChange={(v) => form.setValue('moduleName', v as ApprovalMatrixFormData['moduleName'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APPROVAL_MATRIX_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Sub Module</Label>
            <Input {...form.register('subModule')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Department *</Label>
            <Select value={form.watch('department')} onValueChange={(v) => form.setValue('department', v)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DEPARTMENT_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            {form.formState.errors.department && <p className="text-xs text-red-500">{form.formState.errors.department.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Site / Location</Label>
            <Select
              value={form.watch('siteLocation') || '__all__'}
              onValueChange={(v) => form.setValue('siteLocation', v === '__all__' ? '' : v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="All sites" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Sites</SelectItem>
                {(sites || []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Business Unit</Label>
            <Input {...form.register('businessUnit')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Workflow Code</Label>
            <Input {...form.register('workflowCode')} disabled={readOnly} placeholder="e.g. PQR-DEFAULT" />
          </div>
          <div className="space-y-2">
            <Label>Document Type</Label>
            <Input {...form.register('documentType')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Input {...form.register('category')} disabled={readOnly} />
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
                {APPROVAL_MATRIX_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Risk Level</Label>
            <Select
              value={form.watch('riskLevel')}
              onValueChange={(v) => form.setValue('riskLevel', v as ApprovalMatrixFormData['riskLevel'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RISK_LEVELS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Approval Mode</Label>
            <Select
              value={form.watch('approvalMode')}
              onValueChange={(v) => form.setValue('approvalMode', v as ApprovalMatrixFormData['approvalMode'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {APPROVAL_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Matrix Version</Label>
            <Input {...form.register('matrixVersion')} disabled={readOnly} />
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
            <Label>Product (Optional)</Label>
            <Select
              value={form.watch('productOptional') || '__none__'}
              onValueChange={(v) => form.setValue('productOptional', v === '__none__' ? '' : v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All Products</SelectItem>
                {(products || []).map((p) => <SelectItem key={p.code} value={p.code}>{p.code} — {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Process (Optional)</Label>
            <Input {...form.register('processOptional')} disabled={readOnly} placeholder="e.g. Sterile Filling" />
          </div>
          <div className="space-y-2">
            <Label>Minimum Approval Level</Label>
            <Input type="number" min={1} {...form.register('minimumApprovalLevel', { valueAsNumber: true })} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Approval Authority (comma-separated for multiple roles)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'preparedByRole', label: 'Level 1 — Prepared By' },
            { key: 'reviewedByRole', label: 'Level 2 — Reviewed By' },
            { key: 'verifiedByRole', label: 'Level 3 — Verified By' },
            { key: 'approvedByRole', label: 'Level 4 — Approved By' },
            { key: 'finalApproverRole', label: 'Level 5 — Final Approver *' },
            { key: 'escalationRole', label: 'Escalation Role' },
          ].map((field) => (
            <div key={field.key} className="space-y-2">
              <Label>{field.label}</Label>
              <Select
                value={form.watch(field.key as keyof ApprovalMatrixFormData) as string || '__none__'}
                onValueChange={(v) => {
                  if (field.key === 'reviewedByRole') {
                    form.setValue('reviewedByRole', v === '__none__' ? '' : v);
                  } else {
                    form.setValue(field.key as keyof ApprovalMatrixFormData, (v === '__none__' ? '' : v) as never);
                  }
                }}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {roleOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {field.key === 'reviewedByRole' && (
                <Input
                  placeholder="Or comma-separated: qa_manager,qc_manager"
                  value={form.watch('reviewedByRole')}
                  disabled={readOnly}
                  onChange={(e) => form.setValue('reviewedByRole', e.target.value)}
                  className="text-xs"
                />
              )}
            </div>
          ))}
          <div className="space-y-2">
            <Label>Approval Group</Label>
            <Input {...form.register('approvalGroup')} disabled={readOnly} />
          </div>
          {(approvalMode === 'Quorum' || approvalMode === 'Majority') && (
            <div className="space-y-2">
              <Label>Quorum Count {approvalMode === 'Quorum' ? '*' : ''}</Label>
              <Input type="number" min={0} {...form.register('quorumCount', { valueAsNumber: true })} disabled={readOnly} />
              {form.formState.errors.quorumCount && (
                <p className="text-xs text-red-500">{form.formState.errors.quorumCount.message}</p>
              )}
            </div>
          )}
          {form.formState.errors.finalApproverRole && (
            <p className="text-xs text-red-500 sm:col-span-2">{form.formState.errors.finalApproverRole.message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">SLA & Escalation</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>SLA Hours</Label>
            <Input type="number" min={0} {...form.register('slaHours', { valueAsNumber: true })} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Reminder Hours</Label>
            <Input type="number" min={0} {...form.register('reminderHours', { valueAsNumber: true })} disabled={readOnly} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              checked={autoEscalationEnabled}
              onCheckedChange={(v) => form.setValue('autoEscalationEnabled', Boolean(v))}
              disabled={readOnly}
            />
            <Label className="text-sm">Auto Escalation Enabled</Label>
          </div>
          {autoEscalationEnabled && (
            <div className="space-y-2">
              <Label>Auto Escalation Hours</Label>
              <Input type="number" min={0} {...form.register('autoEscalationHours', { valueAsNumber: true })} disabled={readOnly} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Approval Options</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {[
            { key: 'eSignatureRequired', label: 'E-Signature Required' },
            { key: 'digitalSignatureRequired', label: 'Digital Signature Required' },
            { key: 'approvalCommentRequired', label: 'Approval Comment Required' },
            { key: 'parallelApprovalAllowed', label: 'Parallel Approval' },
            { key: 'sequentialApprovalRequired', label: 'Sequential Approval' },
            { key: 'delegationAllowed', label: 'Delegation Allowed' },
            { key: 'allowReject', label: 'Allow Reject' },
            { key: 'allowReturn', label: 'Allow Return' },
            { key: 'allowRework', label: 'Allow Rework' },
            { key: 'allowResubmit', label: 'Allow Resubmit' },
            { key: 'allowCancel', label: 'Allow Cancel' },
            { key: 'allowSkip', label: 'Allow Skip' },
            { key: 'autoApproveEnabled', label: 'Auto Approve Enabled' },
            { key: 'conditionalApprovalEnabled', label: 'Conditional Approval' },
          ].map((item) => (
            <div key={item.key} className="flex items-center gap-2">
              <Checkbox
                checked={form.watch(item.key as keyof ApprovalMatrixFormData) as boolean}
                onCheckedChange={(v) => form.setValue(item.key as keyof ApprovalMatrixFormData, Boolean(v) as never)}
                disabled={readOnly}
              />
              <Label className="text-sm">{item.label}</Label>
            </div>
          ))}
          {conditionalApprovalEnabled && (
            <div className="space-y-2 sm:col-span-3">
              <Label>Condition Expression</Label>
              <Textarea {...form.register('conditionExpression')} disabled={readOnly} rows={2} placeholder="e.g. riskLevel == 'Critical'" />
            </div>
          )}
          <div className="space-y-2 sm:col-span-3">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} />
          </div>
          {isEdit && (
            <div className="space-y-2 sm:col-span-3">
              <Label>Change Reason *</Label>
              <Textarea {...form.register('changeReason')} disabled={readOnly} rows={2} placeholder="Describe why this matrix is being updated" />
              {form.formState.errors.changeReason && (
                <p className="text-xs text-red-500">{form.formState.errors.changeReason.message}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Approval Flow Preview</CardTitle></CardHeader>
        <CardContent>
          <ApprovalFlowPreview matrix={previewMatrix} />
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Matrix'}
          </Button>
        </div>
      )}
    </form>
  );
}
