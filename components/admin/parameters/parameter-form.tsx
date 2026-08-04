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
  PARAMETER_TYPES, PARAMETER_CATEGORIES, PARAMETER_GROUPS, PARAMETER_MODULE_OPTIONS,
  PARAMETER_DATA_TYPES, PARAMETER_CALCULATION_TYPES, PROCESS_STAGES,
  RESULT_TYPES, CRITICALITY_OPTIONS, FREQUENCY_OPTIONS,
} from '@/lib/admin/constants';
import { parameterFormSchema, type ParameterFormData, type AdminProduct } from '@/lib/admin/schemas';

interface ParameterFormProps {
  initial?: Partial<ParameterFormData>;
  products: AdminProduct[];
  readOnly?: boolean;
  isEdit?: boolean;
  onSubmit: (data: ParameterFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

const defaultValues: ParameterFormData = {
  parameterCode: '',
  parameterName: '',
  shortName: '',
  description: '',
  parameterType: 'CPP',
  parameterCategory: 'Manufacturing',
  parameterGroup: 'General',
  moduleName: 'General',
  subModule: '',
  productLink: '',
  productCategory: '',
  processStage: 'Mixing',
  department: '',
  testMethodStp: '',
  specificationNo: '',
  targetValue: '',
  lowerLimit: '',
  upperLimit: '',
  alertLimitLow: '',
  alertLimitHigh: '',
  actionLimitLow: '',
  actionLimitHigh: '',
  criticalLimit: '',
  defaultValue: '',
  precision: '',
  formula: '',
  dataType: 'Numeric',
  calculationType: 'Manual',
  unit: '',
  resultType: 'Numeric',
  frequency: 'Per Batch',
  criticality: 'Major',
  mandatory: false,
  displayOrder: undefined,
  sequenceNumber: '',
  applicableSite: '',
  businessUnit: '',
  ootApplicable: false,
  oosApplicable: false,
  autoDeviationRequired: false,
  autoCapaRequired: false,
  remarks: '',
  changeReason: '',
};

export function ParameterForm({
  initial, products, readOnly, isEdit, onSubmit, onCancel, submitting,
}: ParameterFormProps) {
  const form = useForm<ParameterFormData>({
    resolver: zodResolver(parameterFormSchema),
    defaultValues: { ...defaultValues, ...initial },
  });

  useEffect(() => {
    if (initial) form.reset({ ...defaultValues, ...initial });
  }, [initial, form]);

  const resultType = form.watch('resultType');
  const dataType = form.watch('dataType');
  const isNumeric = resultType === 'Numeric' || dataType === 'Numeric';
  const activeProducts = products.filter((p) => p.productStatus === 'Active');

  const handleSubmit = (data: ParameterFormData) => {
    if (isEdit && data.changeReason.trim().length < 5) {
      form.setError('changeReason', { message: 'Change reason is required (min 5 characters)' });
      return;
    }
    onSubmit(data);
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Parameter Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Parameter Code *</Label>
            <Input {...form.register('parameterCode')} disabled={readOnly || !!initial?.parameterCode} />
            {form.formState.errors.parameterCode && <p className="text-xs text-red-500">{form.formState.errors.parameterCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Parameter Name *</Label>
            <Input {...form.register('parameterName')} disabled={readOnly} />
            {form.formState.errors.parameterName && <p className="text-xs text-red-500">{form.formState.errors.parameterName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Short Name</Label>
            <Input {...form.register('shortName')} disabled={readOnly} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Description</Label>
            <Textarea {...form.register('description')} disabled={readOnly} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Parameter Type *</Label>
            <Select
              value={form.watch('parameterType')}
              onValueChange={(v) => form.setValue('parameterType', v as ParameterFormData['parameterType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAMETER_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Parameter Category</Label>
            <Select
              value={form.watch('parameterCategory')}
              onValueChange={(v) => form.setValue('parameterCategory', v as ParameterFormData['parameterCategory'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAMETER_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Parameter Group</Label>
            <Select
              value={form.watch('parameterGroup')}
              onValueChange={(v) => form.setValue('parameterGroup', v as ParameterFormData['parameterGroup'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAMETER_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Module</Label>
            <Select
              value={form.watch('moduleName')}
              onValueChange={(v) => form.setValue('moduleName', v as ParameterFormData['moduleName'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAMETER_MODULE_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Sub Module</Label>
            <Input {...form.register('subModule')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Product Link</Label>
            <Select
              value={form.watch('productLink') || '__none__'}
              onValueChange={(v) => form.setValue('productLink', v === '__none__' ? '' : v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All Products</SelectItem>
                {activeProducts.map((p) => (
                  <SelectItem key={p.productCode} value={p.productCode}>{p.productCode} — {p.productName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Product Category</Label>
            <Input {...form.register('productCategory')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Process Stage</Label>
            <Select
              value={form.watch('processStage')}
              onValueChange={(v) => form.setValue('processStage', v as ParameterFormData['processStage'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PROCESS_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Input {...form.register('department')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Test Method / STP No</Label>
            <Input {...form.register('testMethodStp')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Specification No</Label>
            <Input {...form.register('specificationNo')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Applicable Site</Label>
            <Input {...form.register('applicableSite')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Business Unit</Label>
            <Input {...form.register('businessUnit')} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Limits, Data Type & Calculation</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Data Type</Label>
            <Select
              value={form.watch('dataType')}
              onValueChange={(v) => form.setValue('dataType', v as ParameterFormData['dataType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAMETER_DATA_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Result Type *</Label>
            <Select
              value={form.watch('resultType')}
              onValueChange={(v) => form.setValue('resultType', v as ParameterFormData['resultType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESULT_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Calculation Type</Label>
            <Select
              value={form.watch('calculationType')}
              onValueChange={(v) => form.setValue('calculationType', v as ParameterFormData['calculationType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAMETER_CALCULATION_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Unit {isNumeric ? '*' : ''}</Label>
            <Input {...form.register('unit')} disabled={readOnly} placeholder="e.g. %, mg, °C" />
            {form.formState.errors.unit && <p className="text-xs text-red-500">{form.formState.errors.unit.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Target Value</Label>
            <Input {...form.register('targetValue')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Default Value</Label>
            <Input {...form.register('defaultValue')} disabled={readOnly} />
          </div>
          {isNumeric && (
            <>
              <div className="space-y-2">
                <Label>Lower Limit *</Label>
                <Input {...form.register('lowerLimit')} disabled={readOnly} />
                {form.formState.errors.lowerLimit && <p className="text-xs text-red-500">{form.formState.errors.lowerLimit.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Upper Limit *</Label>
                <Input {...form.register('upperLimit')} disabled={readOnly} />
                {form.formState.errors.upperLimit && <p className="text-xs text-red-500">{form.formState.errors.upperLimit.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Alert Limit Low</Label>
                <Input {...form.register('alertLimitLow')} disabled={readOnly} />
              </div>
              <div className="space-y-2">
                <Label>Alert Limit High</Label>
                <Input {...form.register('alertLimitHigh')} disabled={readOnly} />
              </div>
              <div className="space-y-2">
                <Label>Action Limit Low</Label>
                <Input {...form.register('actionLimitLow')} disabled={readOnly} />
              </div>
              <div className="space-y-2">
                <Label>Action Limit High</Label>
                <Input {...form.register('actionLimitHigh')} disabled={readOnly} />
              </div>
              <div className="space-y-2">
                <Label>Critical Limit</Label>
                <Input {...form.register('criticalLimit')} disabled={readOnly} />
              </div>
              <div className="space-y-2">
                <Label>Precision</Label>
                <Input {...form.register('precision')} disabled={readOnly} placeholder="e.g. 2 decimal places" />
              </div>
            </>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label>Formula</Label>
            <Input {...form.register('formula')} disabled={readOnly} placeholder="For calculated parameters" />
          </div>
          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select
              value={form.watch('frequency')}
              onValueChange={(v) => form.setValue('frequency', v as ParameterFormData['frequency'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Criticality</Label>
            <Select
              value={form.watch('criticality')}
              onValueChange={(v) => form.setValue('criticality', v as ParameterFormData['criticality'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CRITICALITY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Display Order</Label>
            <Input type="number" {...form.register('displayOrder')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Sequence Number</Label>
            <Input {...form.register('sequenceNumber')} disabled={readOnly} />
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              checked={form.watch('mandatory')}
              onCheckedChange={(v) => form.setValue('mandatory', Boolean(v))}
              disabled={readOnly}
            />
            <Label>Mandatory Parameter</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Automation Rules</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'ootApplicable', label: 'OOT Applicable' },
            { key: 'oosApplicable', label: 'OOS Applicable' },
            { key: 'autoDeviationRequired', label: 'Auto Deviation Required' },
            { key: 'autoCapaRequired', label: 'Auto CAPA Required' },
          ].map((item) => (
            <div key={item.key} className="flex items-center gap-3">
              <Checkbox
                checked={form.watch(item.key as keyof ParameterFormData) as boolean}
                onCheckedChange={(v) => form.setValue(item.key as keyof ParameterFormData, Boolean(v) as never)}
                disabled={readOnly}
              />
              <Label>{item.label}</Label>
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} />
          </div>
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
            {submitting ? 'Saving...' : 'Save Parameter'}
          </Button>
        </div>
      )}
    </form>
  );
}
