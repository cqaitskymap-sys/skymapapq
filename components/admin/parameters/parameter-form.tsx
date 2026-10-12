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
  PARAMETER_TYPES, PROCESS_STAGES, RESULT_TYPES, FREQUENCY_OPTIONS,
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

const TYPE_LABELS: Record<string, string> = {
  CPP: 'Critical process parameter (CPP)',
  CQA: 'Critical quality attribute (CQA)',
  IPC: 'In-process check (IPC)',
  'Finished Product Test': 'Finished product test',
  'Stability Test': 'Stability test',
  'Utility Parameter': 'Utility — water, steam, air',
  'Environmental Parameter': 'Environment — room conditions',
  'Raw Material Test': 'Raw material test',
  'Packing Material Test': 'Packing material test',
  'Yield Parameter': 'Yield',
};

const TYPE_HINTS: Record<string, string> = {
  CPP: 'A process setting that must stay in range, such as mixing speed or temperature.',
  CQA: 'A quality result that shows if the product is acceptable, such as assay or pH.',
  IPC: 'A check done while the batch is still being made.',
  'Finished Product Test': 'A test on the finished product before it is released.',
  'Stability Test': 'A test on product kept in storage over time.',
  'Utility Parameter': 'A reading from utilities such as purified water, steam, or compressed air.',
  'Environmental Parameter': 'A room reading such as temperature, humidity, or pressure.',
  'Raw Material Test': 'A test on material received before it is used.',
  'Packing Material Test': 'A test on bottles, labels, cartons, or other packing material.',
  'Yield Parameter': 'How much product the batch produced.',
};

function classificationFor(type: string): Pick<ParameterFormData, 'parameterCategory' | 'parameterGroup' | 'moduleName'> {
  switch (type) {
    case 'CPP':
      return { parameterCategory: 'Manufacturing', parameterGroup: 'CPP Group', moduleName: 'CPV' };
    case 'CQA':
      return { parameterCategory: 'Quality Control', parameterGroup: 'CQA Group', moduleName: 'Quality Control' };
    case 'IPC':
      return { parameterCategory: 'Manufacturing', parameterGroup: 'IPC Group', moduleName: 'Manufacturing' };
    case 'Finished Product Test':
      return { parameterCategory: 'Quality Control', parameterGroup: 'CQA Group', moduleName: 'Quality Control' };
    case 'Stability Test':
      return { parameterCategory: 'Stability', parameterGroup: 'Stability Group', moduleName: 'Quality Control' };
    case 'Utility Parameter':
      return { parameterCategory: 'Utility', parameterGroup: 'Utility Group', moduleName: 'Environmental Monitoring' };
    case 'Environmental Parameter':
      return { parameterCategory: 'Environmental', parameterGroup: 'Environmental Group', moduleName: 'Environmental Monitoring' };
    case 'Raw Material Test':
      return { parameterCategory: 'Quality Control', parameterGroup: 'General', moduleName: 'Quality Control' };
    case 'Packing Material Test':
      return { parameterCategory: 'Packaging', parameterGroup: 'General', moduleName: 'Quality Control' };
    default:
      return { parameterCategory: 'Manufacturing', parameterGroup: 'General', moduleName: 'Manufacturing' };
  }
}

function dataTypeFor(resultType: string): ParameterFormData['dataType'] {
  if (resultType === 'Numeric') return 'Numeric';
  if (resultType === 'Pass/Fail') return 'Boolean';
  return 'Text';
}

function Hint({ children }: { children: string }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
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
  const parameterType = form.watch('parameterType');
  const isNumeric = resultType === 'Numeric';
  const activeProducts = products.filter((p) => p.productStatus === 'Active');

  useEffect(() => {
    form.setValue('dataType', dataTypeFor(resultType));
  }, [resultType, form]);

  const handleSubmit = (data: ParameterFormData) => {
    if (isEdit && data.changeReason.trim().length < 5) {
      form.setError('changeReason', { message: 'Change reason is required (min 5 characters)' });
      return;
    }
    const next: ParameterFormData = {
      ...data,
      dataType: dataTypeFor(data.resultType),
      shortName: data.shortName.trim() || data.parameterName.trim().slice(0, 20),
    };
    if (!isEdit) {
      Object.assign(next, classificationFor(data.parameterType));
    }
    onSubmit(next);
  };

  return (
    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">What are you measuring?</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Code *</Label>
            <Input {...form.register('parameterCode')} disabled={readOnly || !!initial?.parameterCode} placeholder="MIX-TEMP" />
            <Hint>A short unique code. It cannot be changed later.</Hint>
            {form.formState.errors.parameterCode && <p className="text-xs text-red-500">{form.formState.errors.parameterCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input {...form.register('parameterName')} disabled={readOnly} placeholder="Mixing temperature" />
            <Hint>The name people will see on batch records.</Hint>
            {form.formState.errors.parameterName && <p className="text-xs text-red-500">{form.formState.errors.parameterName.message}</p>}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>What kind of check is this? *</Label>
            <Select
              value={parameterType}
              onValueChange={(v) => form.setValue('parameterType', v as ParameterFormData['parameterType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {PARAMETER_TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t] || t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Hint>{TYPE_HINTS[parameterType] || 'Choose the closest match.'}</Hint>
          </div>
          <div className="space-y-2">
            <Label>When is it checked?</Label>
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
            <Hint>The manufacturing step where this result is recorded.</Hint>
          </div>
          <div className="space-y-2">
            <Label>Which product?</Label>
            <Select
              value={form.watch('productLink') || '__none__'}
              onValueChange={(v) => form.setValue('productLink', v === '__none__' ? '' : v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="All products" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All products</SelectItem>
                {activeProducts.map((p) => (
                  <SelectItem key={p.productCode} value={p.productCode}>{p.productCode} — {p.productName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Hint>Leave this as All products if every product uses this check.</Hint>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Description</Label>
            <Textarea {...form.register('description')} disabled={readOnly} rows={2} placeholder="What this check is for, in a sentence" />
          </div>
          <div className="space-y-2">
            <Label>Test method number</Label>
            <Input {...form.register('testMethodStp')} disabled={readOnly} placeholder="Optional, for example STP-012" />
          </div>
          <div className="space-y-2">
            <Label>Specification number</Label>
            <Input {...form.register('specificationNo')} disabled={readOnly} placeholder="Optional, for example SPC-045" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Allowed result</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>How is the result written? *</Label>
            <Select
              value={resultType}
              onValueChange={(v) => form.setValue('resultType', v as ParameterFormData['resultType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RESULT_TYPES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Hint>Number, text, pass/fail, or complies / does not comply.</Hint>
          </div>
          <div className="space-y-2">
            <Label>Unit {isNumeric ? '*' : ''}</Label>
            <Input {...form.register('unit')} disabled={readOnly || !isNumeric} placeholder={isNumeric ? '°C, %, mg, rpm' : 'Not needed for this result type'} />
            {form.formState.errors.unit && <p className="text-xs text-red-500">{form.formState.errors.unit.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Target</Label>
            <Input {...form.register('targetValue')} disabled={readOnly} placeholder="The expected result" />
          </div>
          <div className="space-y-2">
            <Label>How often is it checked?</Label>
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
          {isNumeric && (
            <>
              <div className="space-y-2">
                <Label>Lowest allowed value *</Label>
                <Input {...form.register('lowerLimit')} disabled={readOnly} placeholder="Below this, the result fails" />
                {form.formState.errors.lowerLimit && <p className="text-xs text-red-500">{form.formState.errors.lowerLimit.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Highest allowed value *</Label>
                <Input {...form.register('upperLimit')} disabled={readOnly} placeholder="Above this, the result fails" />
                {form.formState.errors.upperLimit && <p className="text-xs text-red-500">{form.formState.errors.upperLimit.message}</p>}
              </div>
              <div className="sm:col-span-2">
                <Hint>Warning limits are optional. Use them only if you want an early alert before the result actually fails.</Hint>
              </div>
              <div className="space-y-2">
                <Label>Warn if below</Label>
                <Input {...form.register('alertLimitLow')} disabled={readOnly} />
                {form.formState.errors.alertLimitLow && <p className="text-xs text-red-500">{form.formState.errors.alertLimitLow.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Warn if above</Label>
                <Input {...form.register('alertLimitHigh')} disabled={readOnly} />
                {form.formState.errors.alertLimitHigh && <p className="text-xs text-red-500">{form.formState.errors.alertLimitHigh.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Take action if below</Label>
                <Input {...form.register('actionLimitLow')} disabled={readOnly} />
                {form.formState.errors.actionLimitLow && <p className="text-xs text-red-500">{form.formState.errors.actionLimitLow.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Take action if above</Label>
                <Input {...form.register('actionLimitHigh')} disabled={readOnly} />
                {form.formState.errors.actionLimitHigh && <p className="text-xs text-red-500">{form.formState.errors.actionLimitHigh.message}</p>}
              </div>
            </>
          )}
          <div className="space-y-2">
            <Label>How serious is a failure?</Label>
            <Select
              value={form.watch('criticality')}
              onValueChange={(v) => form.setValue('criticality', v as ParameterFormData['criticality'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Critical">Critical — product quality is at risk</SelectItem>
                <SelectItem value="Major">Major — must be corrected</SelectItem>
                <SelectItem value="Minor">Minor — record and review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 sm:pt-7">
            <Checkbox
              checked={form.watch('mandatory')}
              onCheckedChange={(v) => form.setValue('mandatory', Boolean(v))}
              disabled={readOnly}
            />
            <Label>This result is required on every batch</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">If the result is not acceptable</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { key: 'ootApplicable', label: 'Flag an unusual trend, even if the result is still inside the limits' },
            { key: 'oosApplicable', label: 'Flag a result that is outside the allowed limits' },
            { key: 'autoDeviationRequired', label: 'Open a deviation automatically' },
            { key: 'autoCapaRequired', label: 'Open a CAPA automatically' },
          ].map((item) => (
            <div key={item.key} className="flex items-start gap-3">
              <Checkbox
                className="mt-0.5"
                checked={form.watch(item.key as keyof ParameterFormData) as boolean}
                onCheckedChange={(v) => form.setValue(item.key as keyof ParameterFormData, Boolean(v) as never)}
                disabled={readOnly}
              />
              <Label className="font-normal leading-snug">{item.label}</Label>
            </div>
          ))}
          <div className="space-y-2 sm:col-span-2">
            <Label>Notes</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} placeholder="Anything else the person recording this result should know" />
          </div>
        </CardContent>
      </Card>

      {isEdit && !readOnly && (
        <Card>
          <CardHeader><CardTitle className="text-base">Why are you changing this?</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea {...form.register('changeReason')} rows={2} placeholder="Write why this parameter is being changed" />
              <Hint>At least 5 characters. This is stored in the audit trail.</Hint>
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
