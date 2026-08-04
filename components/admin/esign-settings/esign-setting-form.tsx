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
  ESIGN_SETTING_MODULES, ESIGN_ACTION_TYPES, ESIGN_SIGNATURE_MEANINGS,
} from '@/lib/admin/constants';
import { esignSettingFormSchema, type EsignSettingFormData } from '@/lib/admin/schemas';
import { EsignPreviewCard } from './esign-preview-card';

interface EsignSettingFormProps {
  initial?: Partial<EsignSettingFormData>;
  readOnly?: boolean;
  onSubmit: (data: EsignSettingFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function EsignSettingForm({
  initial, readOnly, onSubmit, onCancel, submitting,
}: EsignSettingFormProps) {
  const form = useForm<EsignSettingFormData>({
    resolver: zodResolver(esignSettingFormSchema),
    defaultValues: {
      settingCode: '',
      moduleName: 'PQR',
      actionType: 'Approved By',
      moduleAliases: '',
      actionAliases: '',
      signatureMeaning: 'I approve this record',
      requirePasswordReAuthentication: true,
      requireCommentReason: true,
      requireRoleVerification: true,
      requireDepartmentVerification: false,
      requireActiveSession: true,
      sessionTimeoutMinutes: 15,
      maxFailedEsignAttempts: 3,
      lockAccountAfterFailedAttempts: true,
      allowDelegatedSignature: false,
      requireFinalApprovalSignature: false,
      showSignatureStatement: true,
      signatureStatementText: '',
      allowedRoles: '',
      allowedDepartments: '',
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Setting Identity</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Setting Code *</Label>
              <Input {...form.register('settingCode')} disabled={readOnly || !!initial?.settingCode} />
              {form.formState.errors.settingCode && <p className="text-xs text-red-500">{form.formState.errors.settingCode.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Module Name *</Label>
              <Select value={watchAll.moduleName} onValueChange={(v) => form.setValue('moduleName', v)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ESIGN_SETTING_MODULES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Action Type *</Label>
              <Select value={watchAll.actionType} onValueChange={(v) => form.setValue('actionType', v)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ESIGN_ACTION_TYPES.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Signature Meaning *</Label>
              <Select value={watchAll.signatureMeaning} onValueChange={(v) => form.setValue('signatureMeaning', v)} disabled={readOnly}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ESIGN_SIGNATURE_MEANINGS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Module Aliases (comma-separated)</Label>
              <Input {...form.register('moduleAliases')} disabled={readOnly} placeholder="CAPA Approval Workflow, CAPA Closure" />
              <p className="text-xs text-muted-foreground">Matches consumer moduleName strings used by QMS modules.</p>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>Action Aliases (comma-separated)</Label>
              <Input {...form.register('actionAliases')} disabled={readOnly} placeholder="Approve, Approval, CAPA Closure Authorization" />
            </div>
            <div className="space-y-2">
              <Label>Allowed Roles (optional)</Label>
              <Input {...form.register('allowedRoles')} disabled={readOnly} placeholder="admin, head_qa" />
            </div>
            <div className="space-y-2">
              <Label>Allowed Departments (optional)</Label>
              <Input {...form.register('allowedDepartments')} disabled={readOnly} placeholder="QA, QC" />
            </div>
          </CardContent>
        </Card>

        <EsignPreviewCard setting={watchAll} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Security & Session Rules</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="reqPass" checked={watchAll.requirePasswordReAuthentication} onCheckedChange={(c) => form.setValue('requirePasswordReAuthentication', c === true)} disabled={readOnly} />
            <Label htmlFor="reqPass">Require Password Re-Authentication</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="reqComment" checked={watchAll.requireCommentReason} onCheckedChange={(c) => form.setValue('requireCommentReason', c === true)} disabled={readOnly} />
            <Label htmlFor="reqComment">Require Comment / Reason</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="reqRole" checked={watchAll.requireRoleVerification} onCheckedChange={(c) => form.setValue('requireRoleVerification', c === true)} disabled={readOnly} />
            <Label htmlFor="reqRole">Require Role Verification</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="reqDept" checked={watchAll.requireDepartmentVerification} onCheckedChange={(c) => form.setValue('requireDepartmentVerification', c === true)} disabled={readOnly} />
            <Label htmlFor="reqDept">Require Department Verification</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="reqSession" checked={watchAll.requireActiveSession} onCheckedChange={(c) => form.setValue('requireActiveSession', c === true)} disabled={readOnly} />
            <Label htmlFor="reqSession">Require Active Session</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="allowDeleg" checked={watchAll.allowDelegatedSignature} onCheckedChange={(c) => form.setValue('allowDelegatedSignature', c === true)} disabled={readOnly} />
            <Label htmlFor="allowDeleg">Allow Delegated Signature</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="finalAp" checked={watchAll.requireFinalApprovalSignature} onCheckedChange={(c) => form.setValue('requireFinalApprovalSignature', c === true)} disabled={readOnly} />
            <Label htmlFor="finalAp">Require Final Approval Signature</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="lockAcc" checked={watchAll.lockAccountAfterFailedAttempts} onCheckedChange={(c) => form.setValue('lockAccountAfterFailedAttempts', c === true)} disabled={readOnly} />
            <Label htmlFor="lockAcc">Lock Account After Failed Attempts</Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="showStmt" checked={watchAll.showSignatureStatement} onCheckedChange={(c) => form.setValue('showSignatureStatement', c === true)} disabled={readOnly} />
            <Label htmlFor="showStmt">Show Signature Statement</Label>
          </div>
          <div className="space-y-2">
            <Label>Session Timeout (minutes)</Label>
            <Input type="number" min={1} {...form.register('sessionTimeoutMinutes')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Max Failed E-Sign Attempts</Label>
            <Input type="number" min={1} {...form.register('maxFailedEsignAttempts')} disabled={readOnly} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Signature Statement Text</Label>
            <Textarea {...form.register('signatureStatementText')} rows={2} disabled={readOnly} placeholder="Custom statement shown in signature popup" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} rows={2} disabled={readOnly} />
          </div>
          {!readOnly && (
            <div className="space-y-2 sm:col-span-2">
              <Label>Change Reason *</Label>
              <Textarea {...form.register('changeReason')} rows={2} placeholder="Reason for creating or updating this policy (min 5 characters)" />
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
          <Button type="submit" disabled={submitting} className="bg-indigo-600 hover:bg-indigo-700">
            {submitting ? 'Saving…' : 'Save E-Sign Setting'}
          </Button>
        </div>
      )}
    </form>
  );
}
