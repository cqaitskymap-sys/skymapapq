'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  PQR_QUALIFICATION_STATUSES,
  equipmentReviewFormSchema, type EquipmentReviewFormData, type PqrEquipmentReviewRecord,
} from '@/lib/pqr-equipment-review-records';
import type { PqrOption } from '@/lib/pqr-batch-review-records';
import { EQUIPMENT_MANUFACTURING_LINES, type EquipmentRecord } from '@/lib/equipment-mgmt-types';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const emptyDefaults = (pqr: PqrOption): EquipmentReviewFormData => ({
  pqrId: pqr.id,
  product: pqr.productName,
  productCode: pqr.productCode,
  batchNumber: '',
  manufacturingLine: '',
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
  open, onOpenChange, pqr, record, onSubmit, loading, productNames = [], equipmentMaster = [], batchByProduct = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pqr: PqrOption;
  record?: PqrEquipmentReviewRecord | null;
  onSubmit: (data: EquipmentReviewFormData) => Promise<void>;
  loading?: boolean;
  productNames?: string[];
  equipmentMaster?: EquipmentRecord[];
  batchByProduct?: Record<string, string[]>;
}) {
  const form = useForm<EquipmentReviewFormData>({
    resolver: zodResolver(equipmentReviewFormSchema),
    defaultValues: emptyDefaults(pqr),
  });

  useEffect(() => {
    if (!open) return;
    form.reset(record ? {
      ...emptyDefaults(pqr),
      product: record.product || pqr.productName,
      productCode: record.productCode || pqr.productCode,
      batchNumber: record.batchNumber || (record.batchesUsed?.[0] || ''),
      manufacturingLine: record.manufacturingLine || '',
      equipmentId: record.equipmentId,
      equipmentCode: record.equipmentCode,
      equipmentName: record.equipmentName,
      qualificationStatus: (PQR_QUALIFICATION_STATUSES.includes(record.qualificationStatus as typeof PQR_QUALIFICATION_STATUSES[number])
        ? record.qualificationStatus
        : 'Qualification Due') as EquipmentReviewFormData['qualificationStatus'],
    } : emptyDefaults(pqr));
  }, [open, record, pqr, form]);

  const selectedProduct = form.watch('product');
  const selectedEquipmentId = form.watch('equipmentId');
  const selectedEquipmentName = form.watch('equipmentName');
  const selectedBatchNumber = form.watch('batchNumber');
  const selectedManufacturingLine = form.watch('manufacturingLine');
  const batchOptions = batchByProduct[selectedProduct] || [];
  const equipmentSelected = Boolean(selectedEquipmentId || selectedEquipmentName);

  const toQualificationStatus = (status?: string): EquipmentReviewFormData['qualificationStatus'] => (
    PQR_QUALIFICATION_STATUSES.includes(status as typeof PQR_QUALIFICATION_STATUSES[number])
      ? status as EquipmentReviewFormData['qualificationStatus']
      : 'Qualification Due'
  );

  // Official lines only — do not pull free-text / test values from equipment master
  const manufacturingLineOptions = Array.from(new Set([
    ...EQUIPMENT_MANUFACTURING_LINES,
    selectedManufacturingLine,
  ].filter(Boolean)));

  // Equipment options filtered by selected manufacturing line
  const equipmentOnLine = useMemo(
    () => (selectedManufacturingLine
      ? equipmentMaster.filter((item) => item.manufacturing_line === selectedManufacturingLine)
      : []),
    [equipmentMaster, selectedManufacturingLine],
  );
  const equipmentNameOptions = Array.from(new Set(
    equipmentOnLine.map((item) => item.equipment_name).filter(Boolean),
  ));
  const equipmentIdOptions = Array.from(new Set(
    equipmentOnLine.map((item) => item.equipment_id).filter(Boolean),
  ));

  useEffect(() => {
    if (!open || !selectedEquipmentId || !selectedManufacturingLine) return;
    const selected = equipmentOnLine.find((item) => item.equipment_id === selectedEquipmentId);
    if (!selected) return;
    if (form.getValues('equipmentName') !== selected.equipment_name) {
      form.setValue('equipmentName', selected.equipment_name, { shouldDirty: true });
    }
    form.setValue('qualificationStatus', toQualificationStatus(selected.qualification_status), { shouldDirty: true });
  }, [open, selectedEquipmentId, selectedManufacturingLine, equipmentOnLine, form]);

  useEffect(() => {
    if (!open || !selectedEquipmentName || !selectedManufacturingLine) return;
    const selected = equipmentOnLine.find((item) => item.equipment_name === selectedEquipmentName);
    if (!selected) return;
    if (form.getValues('equipmentId') !== selected.equipment_id) {
      form.setValue('equipmentId', selected.equipment_id, { shouldDirty: true });
    }
    form.setValue('qualificationStatus', toQualificationStatus(selected.qualification_status), { shouldDirty: true });
  }, [open, selectedEquipmentName, selectedManufacturingLine, equipmentOnLine, form]);

  useEffect(() => {
    if (!open || batchOptions.length === 0) return;
    if (!selectedBatchNumber || !batchOptions.includes(selectedBatchNumber)) {
      form.setValue('batchNumber', batchOptions[0], { shouldDirty: true });
    }
  }, [open, batchOptions, selectedBatchNumber, form]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? 'Edit Equipment Review' : 'Add Equipment Review'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="product" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Product Name *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select product name" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {productNames.length > 0 ? productNames.map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      )) : (
                        <SelectItem value={pqr.productName}>{pqr.productName}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="batchNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch Number *</FormLabel>
                  {batchOptions.length > 0 ? (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select batch number" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {batchOptions.map((batch) => (
                          <SelectItem key={batch} value={batch}>{batch}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <FormControl><Input {...field} placeholder="Enter batch number" /></FormControl>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="manufacturingLine" render={({ field }) => (
                <FormItem>
                  <FormLabel>Manufacturing Line *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      form.setValue('equipmentName', '');
                      form.setValue('equipmentId', '');
                      form.setValue('qualificationStatus', 'Qualification Due');
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select manufacturing line" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {manufacturingLineOptions.map((line) => (
                        <SelectItem key={`line-${line}`} value={line}>{line}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="equipmentName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Equipment Name *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!selectedManufacturingLine}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={selectedManufacturingLine ? 'Select equipment name' : 'Select line first'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {equipmentNameOptions.length > 0 ? equipmentNameOptions.map((name) => (
                        <SelectItem key={`eq-name-${name}`} value={name}>{name}</SelectItem>
                      )) : (
                        <SelectItem value="__none__" disabled>
                          {selectedManufacturingLine ? 'No equipment on this line' : 'Select line first'}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="equipmentId" render={({ field }) => (
                <FormItem>
                  <FormLabel>Equipment ID *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!selectedManufacturingLine}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={selectedManufacturingLine ? 'Select equipment ID' : 'Select line first'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {equipmentIdOptions.length > 0 ? equipmentIdOptions.map((id) => (
                        <SelectItem key={`eq-id-${id}`} value={id}>{id}</SelectItem>
                      )) : (
                        <SelectItem value="__none__" disabled>
                          {selectedManufacturingLine ? 'No equipment on this line' : 'Select line first'}
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="qualificationStatus" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Qualification Status *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={!equipmentSelected}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={equipmentSelected ? 'Qualification status' : 'Select equipment first'} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PQR_QUALIFICATION_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
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
