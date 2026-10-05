'use client';

import { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  cpvBatchFormSchema,
  isBatchFieldLocked,
  toMonthYearValue,
  type CpvBatchFormData,
  type CpvBatchRecord,
} from '@/lib/cpv-batch-registration';
import { cpvProductToBatchAutofill } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';

function splitList(value: string): string[] {
  const parts = value
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [''];
}

function joinList(values: string[]): string {
  return values.map((s) => s.trim()).filter(Boolean).join(', ');
}

function RepeatableTextRows({
  label,
  addLabel,
  placeholder,
  rows,
  locked,
  onChange,
}: {
  label: string;
  addLabel: string;
  placeholder: string;
  rows: string[];
  locked: boolean;
  onChange: (rows: string[]) => void;
}) {
  return (
    <FormItem className="sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <FormLabel>{label}</FormLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={() => onChange([...rows, ''])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {addLabel}
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={`${placeholder}-${index}`} className="flex gap-2">
            <FormControl>
              <Input
                value={row}
                placeholder={`${placeholder} ${index + 1}`}
                readOnly={locked}
                onChange={(e) => {
                  const next = [...rows];
                  next[index] = e.target.value;
                  onChange(next);
                }}
              />
            </FormControl>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={locked || rows.length <= 1}
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              aria-label={`Remove ${placeholder} ${index + 1}`}
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        ))}
      </div>
      <FormMessage />
    </FormItem>
  );
}

interface CpvBatchFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: CpvBatchRecord | null;
  cpvProducts: CpvProductRecord[];
  onSubmit: (data: CpvBatchFormData) => Promise<void>;
  submitting?: boolean;
}

export function CpvBatchFormSheet({
  open,
  onOpenChange,
  editing,
  cpvProducts,
  onSubmit,
  submitting,
}: CpvBatchFormSheetProps) {
  const locked = editing ? isBatchFieldLocked(editing.batchStatus) : false;
  const [bprRows, setBprRows] = useState<string[]>(['']);
  const [fpBatchRows, setFpBatchRows] = useState<string[]>(['']);
  const [customerRows, setCustomerRows] = useState<string[]>(['']);

  const form = useForm<CpvBatchFormData>({
    resolver: zodResolver(cpvBatchFormSchema),
    defaultValues: {
      cpvProductId: '',
      batchNumber: '',
      batchCode: '',
      productCode: '',
      productName: '',
      productVersion: '',
      productCategory: '',
      genericName: '',
      strength: '',
      dosageForm: '',
      packSize: '',
      market: '',
      batchSize: 1,
      targetBatchSize: '',
      actualBatchSize: '',
      batchSizeUnit: 'Vials',
      manufacturingDate: new Date().toISOString().slice(0, 7),
      expiryDate: '',
      retestDate: '',
      shelfLifeMonths: '',
      manufacturingEndDate: '',
      packagingStartDate: '',
      packagingEndDate: '',
      manufacturingSite: '',
      plant: '',
      manufacturingLine: '',
      department: '',
      shift: 'A',
      campaign: '',
      manufacturingOrderNumber: '',
      workOrderNumber: '',
      mfrNumber: '',
      bmrNumber: '',
      bprNumber: '',
      semiFinishedBatchNumber: '',
      finishedProductBatchNumber: '',
      packingBatchNumber: '',
      manufacturedFor: '',
      customerName: '',
      goldenBatchNumber: '',
      cpvReviewPeriod: 'Yearly',
      batchStatus: 'Planned',
      releaseStatus: 'Pending',
      qaReleaseDate: '',
      qaReleasedBy: '',
      statusChangeReason: '',
      description: '',
      remarks: '',
      changeReason: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setBprRows(splitList(editing.bprNumber || ''));
      setFpBatchRows(splitList(editing.finishedProductBatchNumber || ''));
      setCustomerRows(splitList(editing.customerName || ''));
      form.reset({
        cpvProductId: editing.cpvProductId,
        batchNumber: editing.batchNumber,
        batchCode: editing.batchCode || '',
        productCode: editing.productCode,
        productName: editing.productName,
        productVersion: editing.productVersion || '',
        productCategory: editing.productCategory || '',
        genericName: editing.genericName,
        strength: editing.strength,
        dosageForm: editing.dosageForm,
        packSize: editing.packSize,
        market: editing.market,
        batchSize: editing.batchSize,
        targetBatchSize: editing.targetBatchSize || '',
        actualBatchSize: editing.actualBatchSize || '',
        batchSizeUnit: editing.batchSizeUnit,
        manufacturingDate: toMonthYearValue(editing.manufacturingDate),
        expiryDate: toMonthYearValue(editing.expiryDate),
        retestDate: editing.retestDate || '',
        shelfLifeMonths: editing.shelfLifeMonths || '',
        manufacturingEndDate: editing.manufacturingEndDate || '',
        packagingStartDate: editing.packagingStartDate || '',
        packagingEndDate: editing.packagingEndDate || '',
        manufacturingSite: editing.manufacturingSite,
        plant: editing.plant || '',
        manufacturingLine: editing.manufacturingLine,
        department: editing.department || '',
        shift: editing.shift,
        campaign: editing.campaign || '',
        manufacturingOrderNumber: editing.manufacturingOrderNumber || '',
        workOrderNumber: editing.workOrderNumber || '',
        mfrNumber: editing.mfrNumber,
        bmrNumber: editing.bmrNumber,
        bprNumber: editing.bprNumber,
        semiFinishedBatchNumber: editing.semiFinishedBatchNumber,
        finishedProductBatchNumber: editing.finishedProductBatchNumber,
        packingBatchNumber: editing.packingBatchNumber,
        manufacturedFor: editing.manufacturedFor,
        customerName: editing.customerName,
        goldenBatchNumber: editing.goldenBatchNumber || '',
        cpvReviewPeriod: editing.cpvReviewPeriod,
        batchStatus: editing.batchStatus,
        releaseStatus: editing.releaseStatus,
        qaReleaseDate: editing.qaReleaseDate,
        qaReleasedBy: editing.qaReleasedBy,
        statusChangeReason: editing.statusChangeReason,
        description: editing.description || '',
        remarks: editing.remarks,
        changeReason: 'Update CPV Batch',
      });
    } else {
      setBprRows(['']);
      setFpBatchRows(['']);
      setCustomerRows(['']);
      form.reset({
        ...form.getValues(),
        bprNumber: '',
        finishedProductBatchNumber: '',
        customerName: '',
        changeReason: 'Register CPV Batch',
        batchStatus: 'Planned',
        releaseStatus: 'Pending',
        manufacturingDate: new Date().toISOString().slice(0, 7),
      });
    }
  }, [open, editing, form]);

  const updateBprRows = (next: string[]) => {
    const rows = next.length > 0 ? next : [''];
    setBprRows(rows);
    form.setValue('bprNumber', joinList(rows), { shouldDirty: true });
  };

  const updateFpBatchRows = (next: string[]) => {
    const rows = next.length > 0 ? next : [''];
    setFpBatchRows(rows);
    form.setValue('finishedProductBatchNumber', joinList(rows), { shouldDirty: true });
  };

  const updateCustomerRows = (next: string[]) => {
    const rows = next.length > 0 ? next : [''];
    setCustomerRows(rows);
    form.setValue('customerName', joinList(rows), { shouldDirty: true });
  };

  const handleProductSelect = (productId: string) => {
    const product = cpvProducts.find((p) => p.id === productId);
    if (!product) return;
    const fill = cpvProductToBatchAutofill(product);
    form.setValue('cpvProductId', productId);
    Object.entries(fill).forEach(([key, val]) => {
      if (val !== undefined) form.setValue(key as keyof CpvBatchFormData, val as never);
    });
    if (typeof fill.bprNumber === 'string') {
      setBprRows(splitList(fill.bprNumber));
    }
  };

  const submit = form.handleSubmit(async (values) => {
    await onSubmit({
      ...values,
      bprNumber: joinList(bprRows),
      finishedProductBatchNumber: joinList(fpBatchRows),
      customerName: joinList(customerRows),
      changeReason: values.changeReason?.trim() || (editing ? 'Update CPV Batch' : 'Register CPV Batch'),
    });
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? 'Edit CPV Batch' : 'Register CPV Batch'}</SheetTitle>
          <SheetDescription>
            Register manufacturing batch under Continued Process Verification. Change reason is required (ALCOA+ / Part 11).
            Release / Reject / Hold use electronic signature actions — not this form.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <FormField
              control={form.control}
              name="cpvProductId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>CPV Product *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => handleProductSelect(v)}
                    disabled={locked}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select CPV product" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {cpvProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.productCode} — {p.productName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch('productName') && (
              <Card className="border-blue-100 bg-blue-50/50">
                <CardContent className="p-3 text-xs text-slate-700">
                  <strong>Auto-filled:</strong> {form.watch('productCode')} · {form.watch('productName')} · {form.watch('strength')} · {form.watch('dosageForm')}
                </CardContent>
              </Card>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField control={form.control} name="batchNumber" render={({ field }) => (
                <FormItem><FormLabel>Batch Number *</FormLabel><FormControl><Input {...field} readOnly={locked} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="batchSize" render={({ field }) => (
                <FormItem><FormLabel>Standard Batch Size *</FormLabel><FormControl><Input type="number" {...field} readOnly={locked} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="actualBatchSize" render={({ field }) => (
                <FormItem><FormLabel>Actual Batch Size</FormLabel><FormControl><Input type="number" {...field} readOnly={locked} onChange={(e) => field.onChange(e.target.value)} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="manufacturingDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>MFG DATE *</FormLabel>
                  <FormControl>
                    <Input
                      type="month"
                      value={toMonthYearValue(field.value)}
                      onChange={(e) => field.onChange(e.target.value)}
                      readOnly={locked}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="expiryDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Expiry Date *</FormLabel>
                  <FormControl>
                    <Input
                      type="month"
                      value={toMonthYearValue(field.value)}
                      onChange={(e) => field.onChange(e.target.value)}
                      readOnly={locked}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="manufacturingSite" render={({ field }) => (
                <FormItem><FormLabel>Manufacturing Site *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="manufacturingLine" render={({ field }) => (
                <FormItem><FormLabel>Production Line</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="mfrNumber" render={({ field }) => (
                <FormItem><FormLabel>MFR</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bmrNumber" render={({ field }) => (
                <FormItem><FormLabel>BMR</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bprNumber" render={() => (
                <RepeatableTextRows
                  label="BPR Number"
                  addLabel="Add BPR"
                  placeholder="BPR Number"
                  rows={bprRows}
                  locked={locked}
                  onChange={updateBprRows}
                />
              )} />
              <FormField control={form.control} name="finishedProductBatchNumber" render={() => (
                <RepeatableTextRows
                  label="Finished Product Batch"
                  addLabel="Add Batch"
                  placeholder="Finished Product Batch"
                  rows={fpBatchRows}
                  locked={locked}
                  onChange={updateFpBatchRows}
                />
              )} />
              <FormField control={form.control} name="customerName" render={() => (
                <RepeatableTextRows
                  label="Customer Name"
                  addLabel="Add Customer"
                  placeholder="Customer Name"
                  rows={customerRows}
                  locked={locked}
                  onChange={updateCustomerRows}
                />
              )} />
            </div>

            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
            )} />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting || locked}>{submitting ? 'Saving...' : editing ? 'Update' : 'Register'}</Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
