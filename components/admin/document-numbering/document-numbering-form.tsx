'use client';

import { useEffect, useState } from 'react';
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
  DOCUMENT_NUMBERING_MODULES, DOCUMENT_TYPE_OPTIONS, DEPARTMENT_TYPES,
  NUMBERING_YEAR_FORMATS, NUMBERING_MONTH_FORMATS, NUMBERING_SEPARATOR_OPTIONS,
  NUMBERING_RESET_FREQUENCIES, REVISION_FORMAT_OPTIONS,
} from '@/lib/admin/constants';
import {
  documentNumberingFormSchema, type DocumentNumberingFormData,
} from '@/lib/admin/schemas';
import { buildDocumentNumberPreview, parseFormatTokens } from './document-numbering-api';
import { FormatBuilder } from './format-builder';

interface DocumentNumberingFormProps {
  initial?: Partial<DocumentNumberingFormData>;
  sites?: { code: string; name: string }[];
  departments?: { code: string; name: string }[];
  products?: { code: string; name: string }[];
  readOnly?: boolean;
  isEdit?: boolean;
  onSubmit: (data: DocumentNumberingFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

const defaultValues: DocumentNumberingFormData = {
  numberingCode: '',
  numberingName: '',
  description: '',
  moduleName: 'PQR',
  documentType: 'PQR Report',
  documentCategory: '',
  department: 'QA',
  site: '',
  businessUnit: '',
  company: '',
  location: '',
  product: '',
  workflowCode: '',
  prefix: '',
  suffix: '',
  siteCode: '',
  departmentCode: '',
  productCodeOptional: '',
  yearFormat: 'YYYY',
  monthFormat: 'None',
  separator: '/',
  runningNumberLength: 4,
  startingNumber: 0,
  currentRunningNumber: 0,
  resetFrequency: 'Yearly',
  revisionFormat: '00',
  formatTokens: 'PREFIX,DEPARTMENT_CODE,RUNNING_NUMBER,YEAR',
  numberingVersion: '1.0',
  effectiveDate: '',
  reviewDate: '',
  autoGenerateEnabled: true,
  manualOverrideAllowed: false,
  allowSkipSequence: false,
  remarks: '',
  changeReason: '',
};

export function DocumentNumberingForm({
  initial, sites, departments, products, readOnly, isEdit, onSubmit, onCancel, submitting,
}: DocumentNumberingFormProps) {
  const [tokenList, setTokenList] = useState<string[]>(
    parseFormatTokens(initial?.formatTokens || defaultValues.formatTokens),
  );

  const form = useForm<DocumentNumberingFormData>({
    resolver: zodResolver(documentNumberingFormSchema),
    defaultValues: { ...defaultValues, ...initial },
  });

  useEffect(() => {
    if (initial) {
      form.reset({ ...defaultValues, ...initial });
      setTokenList(parseFormatTokens(initial.formatTokens || defaultValues.formatTokens));
    }
  }, [initial, form]);

  const watchAll = form.watch();

  const livePreview = buildDocumentNumberPreview(
    { ...watchAll, formatTokens: tokenList.join(',') },
    { runningNumber: Number(watchAll.currentRunningNumber ?? 0) + 1 },
  );

  const handleTokensChange = (tokens: string[]) => {
    setTokenList(tokens);
    form.setValue('formatTokens', tokens.join(','), { shouldValidate: true });
  };

  const warnings: string[] = [];
  if (watchAll.resetFrequency === 'Yearly' && !tokenList.includes('YEAR') && watchAll.yearFormat !== 'None') {
    warnings.push('Yearly reset is configured but YEAR token is not in the format.');
  }
  if (watchAll.resetFrequency === 'Monthly' && !tokenList.includes('MONTH') && watchAll.monthFormat !== 'None') {
    warnings.push('Monthly reset is configured but MONTH token is not in the format.');
  }

  const handleFormSubmit = (data: DocumentNumberingFormData) => {
    if (isEdit && data.changeReason.trim().length < 5) {
      form.setError('changeReason', { message: 'Change reason is required (min 5 characters)' });
      return;
    }
    onSubmit({ ...data, formatTokens: tokenList.join(',') });
  };

  return (
    <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Numbering Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Numbering Code *</Label>
            <Input {...form.register('numberingCode')} disabled={readOnly || !!initial?.numberingCode} />
            {form.formState.errors.numberingCode && (
              <p className="text-xs text-red-500">{form.formState.errors.numberingCode.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Numbering Name</Label>
            <Input {...form.register('numberingName')} disabled={readOnly} placeholder="Display name for this rule" />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Description</Label>
            <Textarea {...form.register('description')} disabled={readOnly} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Module Name *</Label>
            <Select
              value={watchAll.moduleName}
              onValueChange={(v) => form.setValue('moduleName', v as DocumentNumberingFormData['moduleName'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_NUMBERING_MODULES.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Document Type *</Label>
            <Select
              value={watchAll.documentType}
              onValueChange={(v) => form.setValue('documentType', v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPE_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.documentType && (
              <p className="text-xs text-red-500">{form.formState.errors.documentType.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Document Category</Label>
            <Input {...form.register('documentCategory')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Workflow Code</Label>
            <Input {...form.register('workflowCode')} disabled={readOnly} placeholder="Optional linked workflow" />
          </div>
          <div className="space-y-2">
            <Label>Prefix *</Label>
            <Input {...form.register('prefix')} disabled={readOnly} />
            {form.formState.errors.prefix && (
              <p className="text-xs text-red-500">{form.formState.errors.prefix.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Suffix</Label>
            <Input {...form.register('suffix')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Department</Label>
            <Select
              value={watchAll.department || '__none__'}
              onValueChange={(v) => form.setValue('department', v === '__none__' ? '' : v)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {DEPARTMENT_TYPES.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Site / Location</Label>
            {sites && sites.length > 0 ? (
              <Select
                value={watchAll.site || watchAll.siteCode || '__none__'}
                onValueChange={(v) => {
                  const val = v === '__none__' ? '' : v;
                  form.setValue('site', val);
                  form.setValue('siteCode', val);
                }}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.name} ({s.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input {...form.register('site')} disabled={readOnly} />
            )}
          </div>
          <div className="space-y-2">
            <Label>Business Unit</Label>
            <Input {...form.register('businessUnit')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Input {...form.register('company')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Numbering Version</Label>
            <Input {...form.register('numberingVersion')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Effective Date</Label>
            <Input type="date" {...form.register('effectiveDate')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Review Date</Label>
            <Input type="date" {...form.register('reviewDate')} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Codes & Format Options</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Site Code</Label>
            {sites && sites.length > 0 ? (
              <Select
                value={watchAll.siteCode || '__none__'}
                onValueChange={(v) => form.setValue('siteCode', v === '__none__' ? '' : v)}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {sites.map((s) => (
                    <SelectItem key={s.code} value={s.code}>{s.name} ({s.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input {...form.register('siteCode')} disabled={readOnly} />
            )}
          </div>
          <div className="space-y-2">
            <Label>Department Code</Label>
            {departments && departments.length > 0 ? (
              <Select
                value={watchAll.departmentCode || '__none__'}
                onValueChange={(v) => form.setValue('departmentCode', v === '__none__' ? '' : v)}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.code} value={d.code}>{d.name} ({d.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input {...form.register('departmentCode')} disabled={readOnly} />
            )}
          </div>
          <div className="space-y-2">
            <Label>Product Code (Optional)</Label>
            {products && products.length > 0 ? (
              <Select
                value={watchAll.productCodeOptional || '__none__'}
                onValueChange={(v) => form.setValue('productCodeOptional', v === '__none__' ? '' : v)}
                disabled={readOnly}
              >
                <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.code} value={p.code}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input {...form.register('productCodeOptional')} disabled={readOnly} />
            )}
          </div>
          <div className="space-y-2">
            <Label>Year Format</Label>
            <Select
              value={watchAll.yearFormat}
              onValueChange={(v) => form.setValue('yearFormat', v as DocumentNumberingFormData['yearFormat'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NUMBERING_YEAR_FORMATS.map((y) => (
                  <SelectItem key={y} value={y}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Month Format</Label>
            <Select
              value={watchAll.monthFormat}
              onValueChange={(v) => form.setValue('monthFormat', v as DocumentNumberingFormData['monthFormat'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NUMBERING_MONTH_FORMATS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Separator</Label>
            <Select
              value={watchAll.separator}
              onValueChange={(v) => form.setValue('separator', v as DocumentNumberingFormData['separator'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NUMBERING_SEPARATOR_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>{s === 'None' ? 'None' : s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Running Number Length *</Label>
            <Input type="number" min={1} {...form.register('runningNumberLength')} disabled={readOnly} />
            {form.formState.errors.runningNumberLength && (
              <p className="text-xs text-red-500">{form.formState.errors.runningNumberLength.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Starting Number</Label>
            <Input type="number" min={0} {...form.register('startingNumber')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Current Running Number *</Label>
            <Input type="number" min={0} {...form.register('currentRunningNumber')} disabled={readOnly} />
            {form.formState.errors.currentRunningNumber && (
              <p className="text-xs text-red-500">{form.formState.errors.currentRunningNumber.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Reset Frequency</Label>
            <Select
              value={watchAll.resetFrequency}
              onValueChange={(v) => form.setValue('resetFrequency', v as DocumentNumberingFormData['resetFrequency'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NUMBERING_RESET_FREQUENCIES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Revision Format</Label>
            <Select
              value={watchAll.revisionFormat}
              onValueChange={(v) => form.setValue('revisionFormat', v as DocumentNumberingFormData['revisionFormat'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REVISION_FORMAT_OPTIONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <FormatBuilder
        tokens={tokenList}
        onChange={handleTokensChange}
        formValues={{ ...watchAll, formatTokens: tokenList.join(',') }}
        readOnly={readOnly}
      />

      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-emerald-900">Live Number Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-mono font-semibold text-emerald-800 break-all">{livePreview || '—'}</p>
          <p className="text-xs text-emerald-700 mt-1">Preview uses next running number via buildDocumentNumberPreview</p>
        </CardContent>
      </Card>

      {warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      {form.formState.errors.formatTokens && (
        <p className="text-xs text-red-500">{form.formState.errors.formatTokens.message}</p>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Generation Rules</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id="autoGenerateEnabled"
                checked={watchAll.autoGenerateEnabled}
                onCheckedChange={(c) => form.setValue('autoGenerateEnabled', c === true)}
                disabled={readOnly}
              />
              <Label htmlFor="autoGenerateEnabled">Auto Generate Enabled</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="manualOverrideAllowed"
                checked={watchAll.manualOverrideAllowed}
                onCheckedChange={(c) => form.setValue('manualOverrideAllowed', c === true)}
                disabled={readOnly}
              />
              <Label htmlFor="manualOverrideAllowed">Manual Override Allowed</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="allowSkipSequence"
                checked={watchAll.allowSkipSequence}
                onCheckedChange={(c) => form.setValue('allowSkipSequence', c === true)}
                disabled={readOnly}
              />
              <Label htmlFor="allowSkipSequence">Allow Skip Sequence</Label>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} rows={3} disabled={readOnly} />
          </div>
          {isEdit && (
            <div className="space-y-2">
              <Label>Change Reason *</Label>
              <Textarea
                {...form.register('changeReason')}
                rows={2}
                disabled={readOnly}
                placeholder="Describe why this numbering rule is being updated (min 5 characters)"
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
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={submitting}>
            {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Numbering Format'}
          </Button>
        </div>
      )}
    </form>
  );
}
