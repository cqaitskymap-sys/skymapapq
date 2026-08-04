'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  PQR_CALIBRATION_STATUSES, PQR_EQUIPMENT_CATEGORIES, PQR_EQUIPMENT_TYPES,
  PQR_PM_STATUSES, PQR_QUALIFICATION_STATUSES, PQR_RISK_LEVELS,
  equipmentReviewFormSchema, type EquipmentReviewFormData, type PqrEquipmentReviewRecord,
} from '@/lib/pqr-equipment-review-records';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
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

function toDateInput(value?: string) {
  if (!value) return '';
  if (value.length === 7) return `${value}-01`;
  return value.slice(0, 10);
}

const emptyDefaults = (pqr: PqrOption): EquipmentReviewFormData => ({
  pqrId: pqr.id,
  product: pqr.productName,
  productCode: pqr.productCode,
  equipmentId: '',
  equipmentCode: '',
  equipmentName: '',
  equipmentCategory: 'Manufacturing Equipment',
  equipmentType: 'Other',
  department: '',
  area: '',
  modelNumber: '',
  serialNumber: '',
  manufacturer: '',
  installationDate: '',
  // Honest defaults — do not pretend equipment is already qualified/calibrated
  qualificationStatus: 'Qualification Due',
  iqStatus: '',
  oqStatus: '',
  pqStatus: '',
  calibrationStatus: 'Not Calibrated',
  lastCalibrationDate: '',
  nextCalibrationDate: '',
  pmStatus: 'Not Applicable',
  lastPmDate: '',
  nextPmDate: '',
  breakdownCount: 0,
  downtimeHours: 0,
  linkedDeviations: 0,
  linkedCapa: 0,
  linkedChangeControls: 0,
  impactOnProduct: 'None',
  riskLevel: 'Medium',
  remarks: '',
});

export function EquipmentReviewFormDialog({
  open, onOpenChange, pqr, record, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pqr: PqrOption;
  record?: PqrEquipmentReviewRecord | null;
  onSubmit: (data: EquipmentReviewFormData) => Promise<void>;
  loading?: boolean;
}) {
  const form = useForm<EquipmentReviewFormData>({
    resolver: zodResolver(equipmentReviewFormSchema),
    defaultValues: emptyDefaults(pqr),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(record ? {
      pqrId: pqr.id,
      product: record.product || pqr.productName,
      productCode: record.productCode || pqr.productCode,
      equipmentId: record.equipmentId,
      equipmentCode: record.equipmentCode,
      equipmentName: record.equipmentName,
      equipmentCategory: (PQR_EQUIPMENT_CATEGORIES.includes(record.equipmentCategory as typeof PQR_EQUIPMENT_CATEGORIES[number])
        ? record.equipmentCategory
        : 'Manufacturing Equipment') as EquipmentReviewFormData['equipmentCategory'],
      equipmentType: (PQR_EQUIPMENT_TYPES.includes(record.equipmentType as typeof PQR_EQUIPMENT_TYPES[number])
        ? record.equipmentType
        : 'Other') as EquipmentReviewFormData['equipmentType'],
      department: record.department,
      area: record.area,
      modelNumber: record.modelNumber,
      serialNumber: record.serialNumber,
      manufacturer: record.manufacturer,
      installationDate: toDateInput(record.installationDate),
      qualificationStatus: (PQR_QUALIFICATION_STATUSES.includes(record.qualificationStatus as typeof PQR_QUALIFICATION_STATUSES[number])
        ? record.qualificationStatus
        : 'Qualification Due') as EquipmentReviewFormData['qualificationStatus'],
      iqStatus: record.iqStatus,
      oqStatus: record.oqStatus,
      pqStatus: record.pqStatus,
      calibrationStatus: (PQR_CALIBRATION_STATUSES.includes(record.calibrationStatus as typeof PQR_CALIBRATION_STATUSES[number])
        ? record.calibrationStatus
        : 'Not Calibrated') as EquipmentReviewFormData['calibrationStatus'],
      lastCalibrationDate: toDateInput(record.lastCalibrationDate),
      nextCalibrationDate: toDateInput(record.nextCalibrationDate),
      pmStatus: (PQR_PM_STATUSES.includes(record.pmStatus as typeof PQR_PM_STATUSES[number])
        ? record.pmStatus
        : 'Not Applicable') as EquipmentReviewFormData['pmStatus'],
      lastPmDate: toDateInput(record.lastPmDate),
      nextPmDate: toDateInput(record.nextPmDate),
      breakdownCount: record.breakdownCount ?? 0,
      downtimeHours: record.downtimeHours ?? 0,
      linkedDeviations: record.linkedDeviations ?? 0,
      linkedCapa: record.linkedCapa ?? 0,
      linkedChangeControls: record.linkedChangeControls ?? 0,
      impactOnProduct: record.impactOnProduct || 'None',
      riskLevel: (PQR_RISK_LEVELS.includes(record.riskLevel as typeof PQR_RISK_LEVELS[number])
        ? record.riskLevel
        : 'Medium') as EquipmentReviewFormData['riskLevel'],
      remarks: record.remarks,
    } : emptyDefaults(pqr));
  }, [open, record, pqr, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? 'Edit Equipment Review' : 'Add Equipment Review'}</DialogTitle>
        </DialogHeader>
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
              <FormField control={form.control} name="equipmentName" render={({ field }) => (
                <FormItem><FormLabel>Equipment Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="equipmentId" render={({ field }) => (
                <FormItem><FormLabel>Equipment ID *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="equipmentCode" render={({ field }) => (
                <FormItem><FormLabel>Equipment Code</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="equipmentCategory" render={({ field }) => (
                <FormItem><FormLabel>Category *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_EQUIPMENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="equipmentType" render={({ field }) => (
                <FormItem><FormLabel>Equipment Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_EQUIPMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="department" render={({ field }) => (
                <FormItem><FormLabel>Department</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="area" render={({ field }) => (
                <FormItem><FormLabel>Area / Location</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="manufacturer" render={({ field }) => (
                <FormItem><FormLabel>Manufacturer</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="modelNumber" render={({ field }) => (
                <FormItem><FormLabel>Model</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="serialNumber" render={({ field }) => (
                <FormItem><FormLabel>Serial Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="installationDate" render={({ field }) => (
                <FormItem><FormLabel>Installation Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="qualificationStatus" render={({ field }) => (
                <FormItem><FormLabel>Qualification Status *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_QUALIFICATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="iqStatus" render={({ field }) => (
                <FormItem><FormLabel>IQ Status</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="oqStatus" render={({ field }) => (
                <FormItem><FormLabel>OQ Status</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="pqStatus" render={({ field }) => (
                <FormItem><FormLabel>PQ Status</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="calibrationStatus" render={({ field }) => (
                <FormItem><FormLabel>Calibration Status *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_CALIBRATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="lastCalibrationDate" render={({ field }) => (
                <FormItem><FormLabel>Last Calibration</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="nextCalibrationDate" render={({ field }) => (
                <FormItem><FormLabel>Next Calibration</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="pmStatus" render={({ field }) => (
                <FormItem><FormLabel>PM Status *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_PM_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="lastPmDate" render={({ field }) => (
                <FormItem><FormLabel>Last PM Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="nextPmDate" render={({ field }) => (
                <FormItem><FormLabel>Next PM Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="breakdownCount" render={({ field }) => (
                <FormItem><FormLabel>Breakdown Count</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="downtimeHours" render={({ field }) => (
                <FormItem><FormLabel>Downtime (hours)</FormLabel><FormControl><Input type="number" min={0} step="0.1" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="impactOnProduct" render={({ field }) => (
                <FormItem><FormLabel>Impact on Product</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="riskLevel" render={({ field }) => (
                <FormItem><FormLabel>Risk Level</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_RISK_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
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
