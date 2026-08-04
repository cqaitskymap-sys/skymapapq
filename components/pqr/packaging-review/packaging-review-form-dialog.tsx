'use client';

import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import {
  PQR_AVL_STATUSES, PQR_PACKAGING_CATEGORIES, PQR_PACKAGING_TYPES, PQR_QC_STATUSES, PQR_RISK_LEVELS,
  packagingReviewFormSchema, type PackagingReviewFormData, type PqrPackagingReviewRecord,
} from '@/lib/pqr-packaging-review-records';
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

export function PackagingReviewFormDialog({
  open, onOpenChange, pqr, record, onSubmit, loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pqr: PqrOption;
  record?: PqrPackagingReviewRecord | null;
  onSubmit: (data: PackagingReviewFormData) => Promise<void>;
  loading?: boolean;
}) {
  const form = useForm<PackagingReviewFormData>({
    resolver: zodResolver(packagingReviewFormSchema),
    defaultValues: {
      pqrId: pqr.id, product: pqr.productName, productCode: pqr.productCode,
      batchNumber: '', packagingMaterialType: 'Primary Packaging Material',
      packagingMaterialCategory: 'Glass Vial', materialName: '', materialCode: '',
      manufacturerName: '', supplierName: '', vendorAvlStatus: 'Not Approved',
      grnNumber: '', arNumber: '', coaNumber: '', materialLotNumber: '',
      mfgDate: '', expDate: '', receivedQuantity: 0, issuedQuantity: 0,
      usedQuantity: 0, rejectedQuantity: 0, returnedQuantity: 0,
      unit: 'Nos', qcStatus: 'Under Test', coaAvailable: 'No',
      specificationNumber: '', stpNumber: '', riskLevel: 'Low', remarks: '',
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset(record ? {
      pqrId: pqr.id,
      product: record.product || pqr.productName,
      productCode: record.productCode || pqr.productCode,
      batchNumber: record.batchNumber,
      packagingMaterialType: (PQR_PACKAGING_TYPES.includes(record.packagingMaterialType as typeof PQR_PACKAGING_TYPES[number])
        ? record.packagingMaterialType
        : 'Secondary Packaging Material') as PackagingReviewFormData['packagingMaterialType'],
      packagingMaterialCategory: (PQR_PACKAGING_CATEGORIES.includes(record.packagingMaterialCategory as typeof PQR_PACKAGING_CATEGORIES[number])
        ? record.packagingMaterialCategory
        : 'Other') as PackagingReviewFormData['packagingMaterialCategory'],
      materialName: record.materialName,
      materialCode: record.materialCode,
      manufacturerName: record.manufacturerName,
      supplierName: record.supplierName,
      vendorAvlStatus: (PQR_AVL_STATUSES.includes(record.vendorAvlStatus as typeof PQR_AVL_STATUSES[number])
        ? record.vendorAvlStatus
        : 'Not Approved') as PackagingReviewFormData['vendorAvlStatus'],
      grnNumber: record.grnNumber,
      arNumber: record.arNumber,
      coaNumber: record.coaNumber,
      materialLotNumber: record.materialLotNumber,
      mfgDate: toDateInput(record.mfgDate),
      expDate: toDateInput(record.expDate),
      receivedQuantity: record.receivedQuantity,
      issuedQuantity: record.issuedQuantity,
      usedQuantity: record.usedQuantity,
      rejectedQuantity: record.rejectedQuantity ?? 0,
      returnedQuantity: record.returnedQuantity ?? 0,
      unit: record.unit || 'Nos',
      qcStatus: (PQR_QC_STATUSES.includes(record.qcStatus as typeof PQR_QC_STATUSES[number])
        ? record.qcStatus
        : 'Under Test') as PackagingReviewFormData['qcStatus'],
      coaAvailable: record.coaAvailable === 'Yes' ? 'Yes' : 'No',
      specificationNumber: record.specificationNumber,
      stpNumber: record.stpNumber,
      riskLevel: (PQR_RISK_LEVELS.includes(record.riskLevel as typeof PQR_RISK_LEVELS[number])
        ? record.riskLevel
        : 'Low') as PackagingReviewFormData['riskLevel'],
      remarks: record.remarks,
    } : {
      pqrId: pqr.id, product: pqr.productName, productCode: pqr.productCode,
      batchNumber: '', packagingMaterialType: 'Primary Packaging Material',
      packagingMaterialCategory: 'Glass Vial', materialName: '', materialCode: '',
      manufacturerName: '', supplierName: '', vendorAvlStatus: 'Not Approved',
      grnNumber: '', arNumber: '', coaNumber: '', materialLotNumber: '',
      mfgDate: '', expDate: '', receivedQuantity: 0, issuedQuantity: 0,
      usedQuantity: 0, rejectedQuantity: 0, returnedQuantity: 0,
      unit: 'Nos', qcStatus: 'Under Test', coaAvailable: 'No',
      specificationNumber: '', stpNumber: '', riskLevel: 'Low', remarks: '',
    });
  }, [open, record, pqr, form]);

  const qcStatus = form.watch('qcStatus');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{record ? 'Edit Packaging Review' : 'Add Packaging Review'}</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="rounded-md border bg-slate-50 p-3 text-sm grid gap-1 sm:grid-cols-2">
              <p><span className="text-muted-foreground">PQR:</span> {pqr.pqrNumber}</p>
              <p><span className="text-muted-foreground">Product:</span> {pqr.productName} ({pqr.productCode})</p>
              <p><span className="text-muted-foreground">Period:</span> {pqr.reviewPeriodFrom} — {pqr.reviewPeriodTo}</p>
              {(pqr.strength || pqr.dosageForm) && (
                <p><span className="text-muted-foreground">Strength / Form:</span> {[pqr.strength, pqr.dosageForm].filter(Boolean).join(' / ')}</p>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField control={form.control} name="materialName" render={({ field }) => (
                <FormItem><FormLabel>Material Name *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="packagingMaterialType" render={({ field }) => (
                <FormItem><FormLabel>Packaging Type *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_PACKAGING_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="packagingMaterialCategory" render={({ field }) => (
                <FormItem><FormLabel>Category *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_PACKAGING_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="materialCode" render={({ field }) => (
                <FormItem><FormLabel>Material Code</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="manufacturerName" render={({ field }) => (
                <FormItem><FormLabel>Manufacturer *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="supplierName" render={({ field }) => (
                <FormItem><FormLabel>Supplier *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="arNumber" render={({ field }) => (
                <FormItem><FormLabel>AR Number *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="materialLotNumber" render={({ field }) => (
                <FormItem><FormLabel>Material Lot No.</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="batchNumber" render={({ field }) => (
                <FormItem><FormLabel>FP Batch Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="grnNumber" render={({ field }) => (
                <FormItem><FormLabel>GRN Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="receivedQuantity" render={({ field }) => (
                <FormItem><FormLabel>Received Quantity</FormLabel><FormControl><Input type="number" min={0} step="any" {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="issuedQuantity" render={({ field }) => (
                <FormItem><FormLabel>Issued Quantity *</FormLabel><FormControl><Input type="number" min={0} step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="usedQuantity" render={({ field }) => (
                <FormItem><FormLabel>Used Quantity *</FormLabel><FormControl><Input type="number" min={0} step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="rejectedQuantity" render={({ field }) => (
                <FormItem><FormLabel>Rejected Quantity</FormLabel><FormControl><Input type="number" min={0} step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="returnedQuantity" render={({ field }) => (
                <FormItem><FormLabel>Returned Quantity</FormLabel><FormControl><Input type="number" min={0} step="any" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="unit" render={({ field }) => (
                <FormItem><FormLabel>Unit *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="qcStatus" render={({ field }) => (
                <FormItem><FormLabel>QC Status *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_QC_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="coaAvailable" render={({ field }) => (
                <FormItem><FormLabel>COA Available *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent><SelectItem value="Yes">Yes</SelectItem><SelectItem value="No">No</SelectItem></SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="vendorAvlStatus" render={({ field }) => (
                <FormItem><FormLabel>AVL Status</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_AVL_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="specificationNumber" render={({ field }) => (
                <FormItem><FormLabel>Specification No.</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="mfgDate" render={({ field }) => (
                <FormItem><FormLabel>MFG Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="expDate" render={({ field }) => (
                <FormItem><FormLabel>EXP Date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="riskLevel" render={({ field }) => (
                <FormItem><FormLabel>Risk Level</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>{PQR_RISK_LEVELS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem>
                <FormLabel>{qcStatus === 'Rejected' ? 'Rejection Reason / Remarks *' : 'Remarks'}</FormLabel>
                <FormControl><Textarea {...field} /></FormControl>
                <FormMessage />
              </FormItem>
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
