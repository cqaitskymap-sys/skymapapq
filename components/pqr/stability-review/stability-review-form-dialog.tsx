'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import {
  DEFAULT_STABILITY_LIMITS,
  DEFAULT_STABILITY_PARAMETERS,
  STABILITY_PULLING_INTERVALS,
  STABILITY_STORAGE_CONDITIONS,
  STABILITY_STUDY_TYPES,
  PQR_STABILITY_RESULT_STATUSES,
  stabilityReviewFormSchema,
  type PqrStabilityReviewRecord,
  type StabilityReviewFormData,
} from '@/lib/pqr-stability-review-records';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const defaults = (pqr: PqrOption): StabilityReviewFormData => ({
  pqrId: pqr.id,
  product: pqr.productName,
  productCode: pqr.productCode,
  batchNumber: '',
  studyNumber: '',
  studyType: 'Long Term',
  storageCondition: '25°C / 60% RH',
  pullingInterval: 'Initial',
  samplePullingDueDate: '',
  actualPullingDate: '',
  testDate: new Date().toISOString().slice(0, 10),
  studyStartDate: '',
  parameterName: 'Assay',
  observedResult: '',
  lowerLimit: 0,
  upperLimit: 1,
  unit: '',
  resultStatus: 'Complies',
  samplePullStatus: 'Pending',
  ootCount: 0,
  oosCount: 0,
  capaCount: 0,
  impactOnShelfLife: 'No',
  impactOnProductQuality: 'No',
  conclusion: '',
  remarks: '',
});

export function StabilityReviewFormDialog({
  open, onOpenChange, pqr, record, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pqr: PqrOption;
  record?: PqrStabilityReviewRecord | null;
  onSubmit: (data: StabilityReviewFormData) => Promise<void>;
  loading?: boolean;
}) {
  const form = useForm<StabilityReviewFormData>({
    resolver: zodResolver(stabilityReviewFormSchema),
    defaultValues: defaults(pqr),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(record ? {
      pqrId: pqr.id,
      product: record.product,
      productCode: record.productCode,
      batchNumber: record.batchNumber,
      studyNumber: record.studyNumber,
      studyType: record.studyType as StabilityReviewFormData['studyType'],
      storageCondition: record.storageCondition as StabilityReviewFormData['storageCondition'],
      pullingInterval: record.pullingInterval as StabilityReviewFormData['pullingInterval'],
      samplePullingDueDate: record.samplePullingDueDate,
      actualPullingDate: record.actualPullingDate,
      testDate: record.testDate,
      studyStartDate: record.studyStartDate,
      parameterName: record.parameterName,
      observedResult: record.observedResult,
      lowerLimit: record.lowerLimit,
      upperLimit: record.upperLimit,
      unit: record.unit,
      resultStatus: (record.resultStatus as StabilityReviewFormData['resultStatus']) || 'Complies',
      samplePullStatus: record.samplePullStatus,
      ootCount: record.ootCount,
      oosCount: record.oosCount,
      capaCount: record.capaCount,
      impactOnShelfLife: record.impactOnShelfLife,
      impactOnProductQuality: record.impactOnProductQuality,
      conclusion: record.conclusion,
      remarks: record.remarks,
    } : defaults(pqr));
  }, [open, record, pqr, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{record ? 'Edit Stability Review' : 'Add Stability Review Record'}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="rounded-md border bg-slate-50 p-3 text-sm grid gap-1 sm:grid-cols-2">
              <p><span className="text-muted-foreground">PQR:</span> {pqr.pqrNumber}</p>
              <p><span className="text-muted-foreground">Product:</span> {pqr.productName} ({pqr.productCode})</p>
              <p><span className="text-muted-foreground">Period:</span> {pqr.reviewPeriodFrom || '—'} — {pqr.reviewPeriodTo || '—'}</p>
              {(pqr.strength || pqr.dosageForm) && (
                <p><span className="text-muted-foreground">Strength / Form:</span> {[pqr.strength, pqr.dosageForm].filter(Boolean).join(' / ')}</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="batchNumber" render={({ field }) => (
                <FormItem><FormLabel>Batch Number *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="studyNumber" render={({ field }) => (
                <FormItem><FormLabel>Study Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="studyType" render={({ field }) => (
                <FormItem><FormLabel>Study Type *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{STABILITY_STUDY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="storageCondition" render={({ field }) => (
                <FormItem><FormLabel>Storage Condition *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{STABILITY_STORAGE_CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="pullingInterval" render={({ field }) => (
                <FormItem><FormLabel>Pulling Interval *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{STABILITY_PULLING_INTERVALS.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="parameterName" render={({ field }) => (
                <FormItem><FormLabel>Parameter *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      const lim = DEFAULT_STABILITY_LIMITS[v];
                      if (lim) {
                        form.setValue('lowerLimit', lim.lower);
                        form.setValue('upperLimit', lim.upper);
                        form.setValue('unit', lim.unit || '');
                      }
                    }}
                  >
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{DEFAULT_STABILITY_PARAMETERS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="observedResult" render={({ field }) => (
                <FormItem><FormLabel>Observed Result *</FormLabel><FormControl><Input {...field} value={String(field.value ?? '')} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="testDate" render={({ field }) => (
                <FormItem><FormLabel>Test Date *</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="studyStartDate" render={({ field }) => (
                <FormItem><FormLabel>Study Start Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="samplePullingDueDate" render={({ field }) => (
                <FormItem><FormLabel>Sample Pull Due Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="actualPullingDate" render={({ field }) => (
                <FormItem><FormLabel>Actual Pulling Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="lowerLimit" render={({ field }) => (
                <FormItem><FormLabel>Lower Limit *</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="upperLimit" render={({ field }) => (
                <FormItem><FormLabel>Upper Limit *</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="unit" render={({ field }) => (
                <FormItem><FormLabel>Unit</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="resultStatus" render={({ field }) => (
                <FormItem><FormLabel>Result Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_STABILITY_RESULT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="impactOnShelfLife" render={({ field }) => (
                <FormItem><FormLabel>Impact On Shelf Life</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="No">No</SelectItem><SelectItem value="Yes">Yes</SelectItem></SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="impactOnProductQuality" render={({ field }) => (
                <FormItem><FormLabel>Impact On Product Quality</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="No">No</SelectItem><SelectItem value="Yes">Yes</SelectItem></SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea {...field} /></FormControl></FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
