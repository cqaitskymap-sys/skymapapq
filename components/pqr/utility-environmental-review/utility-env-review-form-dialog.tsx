'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { CLEANROOM_GRADES } from '@/lib/cpv-environmental-monitoring';
import { UTILITY_TYPES } from '@/lib/cpv-utility-monitoring';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import {
  PQR_REVIEW_TYPES, utilityEnvReviewFormSchema, type PqrUtilityEnvironmentalReviewRecord,
  type UtilityEnvReviewFormData,
} from '@/lib/pqr-utility-environmental-review-records';
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

const defaults = (pqr: PqrOption): UtilityEnvReviewFormData => ({
  pqrId: pqr.id,
  product: pqr.productName,
  productCode: pqr.productCode,
  reviewPeriodFrom: pqr.reviewPeriodFrom?.slice(0, 10) || '',
  reviewPeriodTo: pqr.reviewPeriodTo?.slice(0, 10) || '',
  reviewType: 'Utility Review',
  systemAreaName: '',
  systemAreaCode: '',
  utilityType: 'Other',
  cleanroomGrade: 'Unclassified',
  roomNumber: '',
  monitoringParameter: '',
  observedMinimum: null,
  observedMaximum: null,
  observedAverage: null,
  // Honest placeholder — user must set real configured limits from monitoring specs
  lowerLimit: 0,
  upperLimit: 1,
  alertCount: 0,
  actionCount: 0,
  excursionCount: 0,
  deviationCount: 0,
  capaCount: 0,
  changeControlCount: 0,
  impactOnProductQuality: 'No',
  conclusion: '',
  remarks: '',
});

export function UtilityEnvReviewFormDialog({
  open, onOpenChange, pqr, record, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pqr: PqrOption;
  record?: PqrUtilityEnvironmentalReviewRecord | null;
  onSubmit: (data: UtilityEnvReviewFormData) => Promise<void>;
  loading?: boolean;
}) {
  const form = useForm<UtilityEnvReviewFormData>({
    resolver: zodResolver(utilityEnvReviewFormSchema),
    defaultValues: defaults(pqr),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(record ? {
      pqrId: pqr.id,
      product: record.product || pqr.productName,
      productCode: record.productCode || pqr.productCode,
      reviewPeriodFrom: record.reviewPeriodFrom || pqr.reviewPeriodFrom?.slice(0, 10) || '',
      reviewPeriodTo: record.reviewPeriodTo || pqr.reviewPeriodTo?.slice(0, 10) || '',
      reviewType: (PQR_REVIEW_TYPES.includes(record.reviewType as typeof PQR_REVIEW_TYPES[number])
        ? record.reviewType
        : 'Utility Review') as UtilityEnvReviewFormData['reviewType'],
      systemAreaName: record.systemAreaName,
      systemAreaCode: record.systemAreaCode,
      utilityType: (UTILITY_TYPES.includes(record.utilityType as typeof UTILITY_TYPES[number])
        ? record.utilityType
        : 'Other') as UtilityEnvReviewFormData['utilityType'],
      cleanroomGrade: (CLEANROOM_GRADES.includes(record.cleanroomGrade as typeof CLEANROOM_GRADES[number])
        ? record.cleanroomGrade
        : 'Unclassified') as UtilityEnvReviewFormData['cleanroomGrade'],
      roomNumber: record.roomNumber,
      monitoringParameter: record.monitoringParameter,
      observedMinimum: record.observedMinimum,
      observedMaximum: record.observedMaximum,
      observedAverage: record.observedAverage,
      lowerLimit: record.lowerLimit,
      upperLimit: record.upperLimit,
      alertCount: record.alertCount,
      actionCount: record.actionCount,
      excursionCount: record.excursionCount,
      deviationCount: record.deviationCount,
      capaCount: record.capaCount,
      changeControlCount: record.changeControlCount,
      impactOnProductQuality: record.impactOnProductQuality || 'No',
      conclusion: record.conclusion,
      remarks: record.remarks,
    } : defaults(pqr));
  }, [open, record, pqr, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{record ? 'Edit Review Record' : 'Add Review Record'}</DialogTitle></DialogHeader>
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
              <FormField control={form.control} name="reviewType" render={({ field }) => (
                <FormItem><FormLabel>Review Type *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_REVIEW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="systemAreaName" render={({ field }) => (
                <FormItem><FormLabel>System / Area Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="systemAreaCode" render={({ field }) => (
                <FormItem><FormLabel>System / Area Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="monitoringParameter" render={({ field }) => (
                <FormItem><FormLabel>Parameter *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="utilityType" render={({ field }) => (
                <FormItem><FormLabel>Utility Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{UTILITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="cleanroomGrade" render={({ field }) => (
                <FormItem><FormLabel>Cleanroom Grade</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{CLEANROOM_GRADES.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="roomNumber" render={({ field }) => (
                <FormItem><FormLabel>Room Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="lowerLimit" render={({ field }) => (
                <FormItem><FormLabel>Lower Limit *</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="upperLimit" render={({ field }) => (
                <FormItem><FormLabel>Upper Limit *</FormLabel><FormControl><Input type="number" step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="observedMinimum" render={({ field }) => (
                <FormItem><FormLabel>Observed Min</FormLabel>
                  <FormControl><Input type="number" step="any" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="observedMaximum" render={({ field }) => (
                <FormItem><FormLabel>Observed Max</FormLabel>
                  <FormControl><Input type="number" step="any" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="observedAverage" render={({ field }) => (
                <FormItem><FormLabel>Observed Avg</FormLabel>
                  <FormControl><Input type="number" step="any" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? null : Number(e.target.value))} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="alertCount" render={({ field }) => (
                <FormItem><FormLabel>Alert Count</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="actionCount" render={({ field }) => (
                <FormItem><FormLabel>Action Count</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="excursionCount" render={({ field }) => (
                <FormItem><FormLabel>Excursion Count</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="impactOnProductQuality" render={({ field }) => (
                <FormItem><FormLabel>Product Quality Impact</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="No">No</SelectItem>
                      <SelectItem value="Yes">Yes</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="conclusion" render={({ field }) => (
                <FormItem><FormLabel>Conclusion</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
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
