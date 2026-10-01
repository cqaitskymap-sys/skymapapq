'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BATCH_STATUSES, RELEASE_STATUSES, BATCH_SIZE_UNITS, QC_STATUSES, QA_STATUSES,
} from '@/lib/admin/constants';
import { batchFormSchema, type BatchFormData, type AdminProduct } from '@/lib/admin/schemas';
import { previewBatchNumber, productToBatchAutofill } from '@/lib/admin/batch-service';

interface BatchFormProps {
  initial?: Partial<BatchFormData>;
  products: AdminProduct[];
  readOnly?: boolean;
  releasedLocked?: boolean;
  canQaOverride?: boolean;
  isCreate?: boolean;
  onSubmit: (data: BatchFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function BatchForm({
  initial, products, readOnly, releasedLocked, canQaOverride, isCreate,
  onSubmit, onCancel, submitting,
}: BatchFormProps) {
  const [previewLoading, setPreviewLoading] = useState(false);

  const normalizedInitial = useMemo(() => {
    if (!initial) return undefined;
    return {
      ...initial,
      manufacturingDate: (initial.manufacturingDate || '').slice(0, 10),
      expiryDate: (initial.expiryDate || '').slice(0, 10),
      packagingDate: (initial.packagingDate || '').slice(0, 10),
      retestDate: (initial.retestDate || '').slice(0, 10),
    };
  }, [initial]);

  const form = useForm<BatchFormData>({
    resolver: zodResolver(batchFormSchema),
    defaultValues: {
      productCode: '',
      batchNumber: '',
      autoGenerateBatchNumber: false,
      batchCode: '',
      productName: '',
      productVersion: '',
      productCategory: '',
      genericName: '',
      strength: '',
      dosageForm: '',
      market: '',
      manufacturingOrder: '',
      batchSize: undefined,
      batchSizeUnit: 'Vials',
      plannedQuantity: undefined,
      actualQuantity: undefined,
      manufacturingDate: '',
      packagingDate: '',
      expiryDate: '',
      retestDate: '',
      shelfLife: '',
      batchPrefix: '',
      manufacturingSite: '',
      businessUnit: '',
      department: '',
      warehouse: '',
      storageLocation: '',
      manufacturingLine: '',
      equipment: '',
      processVersion: '',
      recipeVersion: '',
      shift: '',
      mfrNumber: '',
      bmrNumber: '',
      bprNumber: '',
      manufacturedFor: '',
      customerName: '',
      batchStatus: 'Planned',
      releaseStatus: 'Pending',
      qcStatus: 'Pending',
      qaStatus: 'Pending',
      releaseDate: '',
      qaReleasedBy: '',
      semiFinishedBatchNumber: '',
      finishedProductBatchNumber: '',
      packingBatchNumber: '',
      statusChangeReason: '',
      remarks: '',
      changeReason: isCreate ? 'Initial batch registration' : '',
      qaOverride: false,
      ...normalizedInitial,
    },
  });

  useEffect(() => {
    if (normalizedInitial) form.reset({ ...form.getValues(), ...normalizedInitial });
  }, [normalizedInitial, form]);

  const batchStatus = form.watch('batchStatus');
  const productCode = form.watch('productCode');
  const autoGenerate = form.watch('autoGenerateBatchNumber');
  const activeProducts = useMemo(
    () => products.filter((p) => p.productStatus === 'Active'),
    [products],
  );

  const locked = readOnly || (releasedLocked && !form.watch('qaOverride'));
  const needsReason = batchStatus === 'Rejected' || batchStatus === 'Hold';

  const applyProductAutofill = (code: string) => {
    const product = products.find((p) => p.productCode === code);
    if (!product) return;
    const fill = productToBatchAutofill(product);
    Object.entries(fill).forEach(([key, value]) => {
      if (value !== undefined && value !== '') {
        form.setValue(key as keyof BatchFormData, value as BatchFormData[keyof BatchFormData]);
      }
    });
  };

  useEffect(() => {
    if (productCode && !initial?.productName) applyProductAutofill(productCode);
  }, [productCode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePreviewNumber = async () => {
    const code = form.getValues('productCode');
    if (!code) {
      toast.error('Select a product first');
      return;
    }
    setPreviewLoading(true);
    const result = await previewBatchNumber(code, form.getValues('manufacturingSite'));
    setPreviewLoading(false);
    if (result.error) toast.error(result.error);
    else if (result.batchNumber) {
      form.setValue('batchNumber', result.batchNumber);
      form.setValue('autoGenerateBatchNumber', true);
      toast.success('Batch number generated');
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {releasedLocked && canQaOverride && !readOnly && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/30">
          <CardContent className="p-4 flex items-center gap-3">
            <Checkbox
              checked={form.watch('qaOverride')}
              onCheckedChange={(v) => form.setValue('qaOverride', Boolean(v))}
            />
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">QA Override</p>
              <p className="text-xs text-amber-700 dark:text-amber-300">Released batch — enable override to edit critical fields</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Batch Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Product *</Label>
            <Select
              value={form.watch('productCode')}
              onValueChange={(v) => {
                form.setValue('productCode', v);
                applyProductAutofill(v);
              }}
              disabled={locked || !!initial?.productCode}
            >
              <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
              <SelectContent>
                {activeProducts.map((p) => (
                  <SelectItem key={p.productCode} value={p.productCode}>
                    {p.productCode} — {p.productName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.productCode && <p className="text-xs text-red-500">{form.formState.errors.productCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Batch Number *</Label>
            <div className="flex gap-2">
              <Input {...form.register('batchNumber')} disabled={locked || autoGenerate} />
              {isCreate && (
                <Button type="button" variant="outline" size="icon" disabled={previewLoading || locked} onClick={handlePreviewNumber}>
                  <RefreshCw className={cnIcon(previewLoading)} />
                </Button>
              )}
            </div>
            {isCreate && (
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={autoGenerate}
                  onCheckedChange={(v) => form.setValue('autoGenerateBatchNumber', Boolean(v))}
                />
                <span className="text-xs text-muted-foreground">Auto-generate on save</span>
              </div>
            )}
            {form.formState.errors.batchNumber && <p className="text-xs text-red-500">{form.formState.errors.batchNumber.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Batch Code</Label>
            <Input {...form.register('batchCode')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Manufacturing Order</Label>
            <Input {...form.register('manufacturingOrder')} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Product Details (Auto-filled)</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { key: 'productName', label: 'Product Name' },
            { key: 'genericName', label: 'Generic Name' },
            { key: 'strength', label: 'Strength' },
            { key: 'dosageForm', label: 'Dosage Form' },
            { key: 'market', label: 'Market' },
            { key: 'mfrNumber', label: 'MFR Number' },
            { key: 'bmrNumber', label: 'BMR Number' },
            { key: 'bprNumber', label: 'BPR Number' },
            { key: 'shelfLife', label: 'Shelf Life' },
          ].map((f) => (
            <div key={f.key} className="space-y-2">
              <Label>{f.label}</Label>
              <Input {...form.register(f.key as keyof BatchFormData)} disabled readOnly />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Manufacturing Details</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Batch Size *</Label>
            <Input type="number" {...form.register('batchSize', { valueAsNumber: true })} disabled={locked} />
            {form.formState.errors.batchSize && <p className="text-xs text-red-500">{form.formState.errors.batchSize.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Batch Size Unit</Label>
            <Select
              value={form.watch('batchSizeUnit')}
              onValueChange={(v) => form.setValue('batchSizeUnit', v as BatchFormData['batchSizeUnit'])}
              disabled={locked}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BATCH_SIZE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Actual Quantity</Label>
            <Input type="number" {...form.register('actualQuantity', { valueAsNumber: true })} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Manufacturing Date *</Label>
            <Input type="date" {...form.register('manufacturingDate')} disabled={locked} />
            {form.formState.errors.manufacturingDate && <p className="text-xs text-red-500">{form.formState.errors.manufacturingDate.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Expiry Date *</Label>
            <Input type="date" {...form.register('expiryDate')} disabled={locked} />
            {form.formState.errors.expiryDate && <p className="text-xs text-red-500">{form.formState.errors.expiryDate.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Manufacturing Site</Label>
            <Input {...form.register('manufacturingSite')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Manufacturing Line</Label>
            <Input {...form.register('manufacturingLine')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Equipment</Label>
            <Input {...form.register('equipment')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Shift</Label>
            <Input {...form.register('shift')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Manufactured For</Label>
            <Input {...form.register('manufacturedFor')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Customer Name</Label>
            <Input {...form.register('customerName')} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Additional Batch Numbers</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Semi Finished Batch</Label>
            <Input {...form.register('semiFinishedBatchNumber')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Finished Product Batch</Label>
            <Input {...form.register('finishedProductBatchNumber')} disabled={readOnly} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Status & Release</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Batch Status</Label>
            <Select
              value={form.watch('batchStatus')}
              onValueChange={(v) => form.setValue('batchStatus', v as BatchFormData['batchStatus'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BATCH_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Release Status</Label>
            <Select
              value={form.watch('releaseStatus')}
              onValueChange={(v) => form.setValue('releaseStatus', v as BatchFormData['releaseStatus'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RELEASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>QC Status</Label>
            <Select
              value={form.watch('qcStatus')}
              onValueChange={(v) => form.setValue('qcStatus', v as BatchFormData['qcStatus'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {QC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>QA Status</Label>
            <Select
              value={form.watch('qaStatus')}
              onValueChange={(v) => form.setValue('qaStatus', v as BatchFormData['qaStatus'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {QA_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>QA Released By</Label>
            <Input {...form.register('qaReleasedBy')} disabled={readOnly} />
          </div>
          {needsReason && (
            <div className="space-y-2 sm:col-span-2">
              <Label>{batchStatus === 'Rejected' ? 'Rejection Reason *' : 'Hold Reason *'}</Label>
              <Textarea {...form.register('statusChangeReason')} disabled={readOnly} rows={2} />
              {form.formState.errors.statusChangeReason && <p className="text-xs text-red-500">{form.formState.errors.statusChangeReason.message}</p>}
            </div>
          )}
          <div className="space-y-2 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} />
          </div>
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardHeader><CardTitle className="text-base">ALCOA+ Change Reason</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              {...form.register('changeReason')}
              rows={2}
              placeholder="Document reason for this batch record change (min 5 characters for updates)"
            />
          </CardContent>
        </Card>
      )}

      {!readOnly && (
        <div className="flex gap-3 justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Batch'}
          </Button>
        </div>
      )}
    </form>
  );
}

function cnIcon(loading: boolean) {
  return loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4';
}
