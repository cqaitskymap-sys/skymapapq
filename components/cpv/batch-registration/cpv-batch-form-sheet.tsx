'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
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
  CPV_BATCH_STATUSES,
  CPV_RELEASE_STATUSES,
  isBatchFieldLocked,
  toMonthYearValue,
  type CpvBatchFormData,
  type CpvBatchRecord,
} from '@/lib/cpv-batch-registration';
import { BATCH_SIZE_UNITS } from '@/lib/admin/constants';
import { cpvProductToBatchAutofill } from '@/lib/cpv-batch-registration-service';
import type { CpvProductRecord } from '@/lib/cpv-product-master';
import { CPV_REVIEW_FREQUENCIES } from '@/lib/cpv-product-master';

/** Statuses editable in the form — critical GMP statuses use e-sign actions. */
const FORM_SAFE_STATUSES = CPV_BATCH_STATUSES.filter(
  (s) => !['Released', 'Rejected', 'Hold', 'Closed', 'Archived'].includes(s),
);

function statusOptionsFor(current?: string) {
  if (current && !FORM_SAFE_STATUSES.includes(current as typeof FORM_SAFE_STATUSES[number])) {
    return [current, ...FORM_SAFE_STATUSES] as string[];
  }
  return [...FORM_SAFE_STATUSES];
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

  const batchStatus = form.watch('batchStatus');

  useEffect(() => {
    if (!open) return;
    if (editing) {
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
        changeReason: '',
      });
    } else {
      form.reset({
        ...form.getValues(),
        changeReason: '',
        batchStatus: 'Planned',
        releaseStatus: 'Pending',
        manufacturingDate: new Date().toISOString().slice(0, 7),
      });
    }
  }, [open, editing, form]);

  const handleProductSelect = (productId: string) => {
    const product = cpvProducts.find((p) => p.id === productId);
    if (!product) return;
    const fill = cpvProductToBatchAutofill(product);
    form.setValue('cpvProductId', productId);
    Object.entries(fill).forEach(([key, val]) => {
      if (val !== undefined) form.setValue(key as keyof CpvBatchFormData, val as never);
    });
  };

  const submit = form.handleSubmit(async (values) => {
    await onSubmit(values);
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
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
              <FormField control={form.control} name="batchCode" render={({ field }) => (
                <FormItem><FormLabel>Batch Code</FormLabel><FormControl><Input {...field} placeholder="Defaults to CPV-BATCH-…" readOnly={locked} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="batchSize" render={({ field }) => (
                <FormItem><FormLabel>Batch Size *</FormLabel><FormControl><Input type="number" {...field} readOnly={locked} onChange={(e) => field.onChange(Number(e.target.value))} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="batchSizeUnit" render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit of Measure</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled={locked}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{BATCH_SIZE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="targetBatchSize" render={({ field }) => (
                <FormItem><FormLabel>Target Batch Size</FormLabel><FormControl><Input {...field} readOnly={locked} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="actualBatchSize" render={({ field }) => (
                <FormItem><FormLabel>Actual Batch Size</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="manufacturingDate" render={({ field }) => (
                <FormItem>
                  <FormLabel>Mfg Start *</FormLabel>
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
              <FormField control={form.control} name="manufacturingEndDate" render={({ field }) => (
                <FormItem><FormLabel>Mfg End</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
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
              <FormField control={form.control} name="retestDate" render={({ field }) => (
                <FormItem><FormLabel>Retest Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="shelfLifeMonths" render={({ field }) => (
                <FormItem><FormLabel>Shelf Life (months)</FormLabel><FormControl><Input {...field} placeholder="e.g. 24" /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="packagingStartDate" render={({ field }) => (
                <FormItem><FormLabel>Packaging Start</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="packagingEndDate" render={({ field }) => (
                <FormItem><FormLabel>Packaging End</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="manufacturingSite" render={({ field }) => (
                <FormItem><FormLabel>Manufacturing Site *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="plant" render={({ field }) => (
                <FormItem><FormLabel>Plant</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="manufacturingLine" render={({ field }) => (
                <FormItem><FormLabel>Production Line</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="department" render={({ field }) => (
                <FormItem><FormLabel>Department</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="shift" render={({ field }) => (
                <FormItem><FormLabel>Shift</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="campaign" render={({ field }) => (
                <FormItem><FormLabel>Campaign</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="manufacturingOrderNumber" render={({ field }) => (
                <FormItem><FormLabel>Manufacturing Order</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="workOrderNumber" render={({ field }) => (
                <FormItem><FormLabel>Work Order</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="mfrNumber" render={({ field }) => (
                <FormItem><FormLabel>MFR / Recipe</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bmrNumber" render={({ field }) => (
                <FormItem><FormLabel>BMR / MBR</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bprNumber" render={({ field }) => (
                <FormItem><FormLabel>BPR Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="semiFinishedBatchNumber" render={({ field }) => (
                <FormItem><FormLabel>Semi Finished Batch</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="finishedProductBatchNumber" render={({ field }) => (
                <FormItem><FormLabel>Finished Product Batch</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="packingBatchNumber" render={({ field }) => (
                <FormItem><FormLabel>Packing Batch</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="goldenBatchNumber" render={({ field }) => (
                <FormItem><FormLabel>Golden Batch</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="manufacturedFor" render={({ field }) => (
                <FormItem><FormLabel>Manufactured For</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="customerName" render={({ field }) => (
                <FormItem><FormLabel>Customer Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="cpvReviewPeriod" render={({ field }) => (
                <FormItem>
                  <FormLabel>CPV Review Period</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{CPV_REVIEW_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="batchStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch Status *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={locked || !FORM_SAFE_STATUSES.includes(field.value as typeof FORM_SAFE_STATUSES[number])}
                  >
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {statusOptionsFor(field.value).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="releaseStatus" render={({ field }) => (
                <FormItem>
                  <FormLabel>Release Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange} disabled>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{CPV_RELEASE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>

            {(batchStatus === 'Rejected' || batchStatus === 'Hold') && (
              <FormField control={form.control} name="statusChangeReason" render={({ field }) => (
                <FormItem>
                  <FormLabel>{batchStatus === 'Rejected' ? 'Rejection Reason *' : 'Hold Reason *'}</FormLabel>
                  <FormControl><Textarea rows={2} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
            )} />

            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
            )} />

            <FormField control={form.control} name="changeReason" render={({ field }) => (
              <FormItem>
                <FormLabel>Change Reason * (ALCOA+ / Part 11)</FormLabel>
                <FormControl><Textarea rows={2} placeholder="Describe why this create/update is being performed" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
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
