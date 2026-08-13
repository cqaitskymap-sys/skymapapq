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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  cpvProductFormSchema,
  CPV_PRODUCT_STATUSES,
  CPV_REVIEW_FREQUENCIES,
  type CpvProductFormData,
  type CpvProductRecord,
} from '@/lib/cpv-product-master';
import { adminProductToCpvAutofill } from '@/lib/cpv-product-master-service';
import type { AdminProduct } from '@/lib/admin/schemas';
import { DOSAGE_FORMS, MARKET_OPTIONS } from '@/lib/admin/constants';

const today = () => new Date().toISOString().split('T')[0];

interface CpvProductFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: CpvProductRecord | null;
  adminProducts: AdminProduct[];
  onSubmit: (data: CpvProductFormData) => Promise<void>;
  submitting?: boolean;
}

const emptyDefaults: CpvProductFormData = {
  adminProductId: '',
  productCode: '',
  productName: '',
  genericName: '',
  brandName: '',
  productCategory: '',
  productFamily: '',
  strength: '',
  dosageForm: '',
  routeOfAdministration: '',
  packSize: '',
  packType: '',
  market: 'Domestic',
  manufacturingSite: '',
  businessUnit: '',
  department: '',
  productOwner: '',
  lifecycleStatus: '',
  developmentStage: '',
  validationStatus: '',
  marketStatus: '',
  version: '1.0',
  revision: '00',
  effectiveDate: '',
  reviewDate: '',
  expiryDate: '',
  description: '',
  manufacturingProcess: '',
  productionLine: '',
  manufacturingArea: '',
  packagingProcess: '',
  shelfLife: '',
  storageCondition: '',
  standardBatchSize: '',
  manufacturingLicenseNumber: '',
  mfrNumber: '',
  bmrNumber: '',
  bprNumber: '',
  specificationNumber: '',
  specificationVersion: '',
  stpNumber: '',
  upperSpecificationLimit: '',
  lowerSpecificationLimit: '',
  targetValue: '',
  samplingPlan: '',
  testingFrequency: '',
  cpvStatus: 'Active',
  cpvStartDate: today(),
  cpvReviewFrequency: 'Yearly',
  cpvOwner: 'QA Reviewer',
  qaReviewer: '',
  remarks: '',
  changeReason: 'Add Product to CPV',
  linkedCppParameterIds: [],
  linkedCqaParameterIds: [],
};

export function CpvProductFormSheet({
  open,
  onOpenChange,
  editing,
  adminProducts,
  onSubmit,
  submitting,
}: CpvProductFormSheetProps) {
  const form = useForm<CpvProductFormData>({
    resolver: zodResolver(cpvProductFormSchema),
    defaultValues: emptyDefaults,
  });

  useEffect(() => {
    if (!open) return;
    if (editing) {
      form.reset({
        ...emptyDefaults,
        adminProductId: editing.adminProductId,
        productCode: editing.productCode,
        productName: editing.productName,
        genericName: editing.genericName,
        brandName: editing.brandName,
        productCategory: editing.productCategory || '',
        productFamily: editing.productFamily || '',
        strength: editing.strength,
        dosageForm: editing.dosageForm,
        routeOfAdministration: editing.routeOfAdministration,
        packSize: editing.packSize,
        packType: editing.packType || '',
        market: editing.market || 'Domestic',
        manufacturingSite: editing.manufacturingSite || '',
        businessUnit: editing.businessUnit || '',
        department: editing.department || '',
        productOwner: editing.productOwner || '',
        lifecycleStatus: editing.lifecycleStatus || '',
        developmentStage: editing.developmentStage || '',
        validationStatus: editing.validationStatus || '',
        marketStatus: editing.marketStatus || '',
        version: editing.version || '1.0',
        revision: editing.revision || '00',
        effectiveDate: editing.effectiveDate || '',
        reviewDate: editing.reviewDate || '',
        expiryDate: editing.expiryDate || '',
        description: editing.description || '',
        manufacturingProcess: editing.manufacturingProcess || '',
        productionLine: editing.productionLine || '',
        manufacturingArea: editing.manufacturingArea || '',
        packagingProcess: editing.packagingProcess || '',
        shelfLife: editing.shelfLife,
        storageCondition: editing.storageCondition,
        standardBatchSize: editing.standardBatchSize,
        manufacturingLicenseNumber: editing.manufacturingLicenseNumber,
        mfrNumber: editing.mfrNumber,
        bmrNumber: editing.bmrNumber,
        bprNumber: editing.bprNumber,
        specificationNumber: editing.specificationNumber,
        specificationVersion: editing.specificationVersion || '',
        stpNumber: editing.stpNumber,
        upperSpecificationLimit: editing.upperSpecificationLimit || '',
        lowerSpecificationLimit: editing.lowerSpecificationLimit || '',
        targetValue: editing.targetValue || '',
        samplingPlan: editing.samplingPlan || '',
        testingFrequency: editing.testingFrequency || '',
        cpvStatus: editing.cpvStatus,
        cpvStartDate: editing.cpvStartDate,
        cpvReviewFrequency: editing.cpvReviewFrequency,
        cpvOwner: editing.cpvOwner,
        qaReviewer: editing.qaReviewer,
        remarks: editing.remarks,
        changeReason: 'Update CPV Product',
        linkedCppParameterIds: editing.linkedCppParameterIds || [],
        linkedCqaParameterIds: editing.linkedCqaParameterIds || [],
      });
    } else {
      form.reset({ ...emptyDefaults, cpvStartDate: today(), changeReason: 'Add Product to CPV' });
    }
  }, [open, editing, form]);

  const handleAdminProductSelect = (adminId: string) => {
    const product = adminProducts.find((p) => p.id === adminId);
    if (!product) return;
    const fill = adminProductToCpvAutofill(product);
    form.setValue('adminProductId', adminId);
    Object.entries(fill).forEach(([key, val]) => {
      if (key !== 'adminProductId' && val !== undefined) {
        form.setValue(key as keyof CpvProductFormData, val as never);
      }
    });
  };

  const submit = form.handleSubmit(async (values) => {
    await onSubmit({
      ...values,
      changeReason: values.changeReason?.trim() || (editing ? 'Update CPV Product' : 'Add Product to CPV'),
    });
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? 'Edit CPV Product' : 'Add Product to CPV'}</SheetTitle>
          <SheetDescription>
            Register or update a product under Continued Process Verification. Change reason is required (ALCOA+ / Part 11).
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <FormField
              control={form.control}
              name="adminProductId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Admin Product Master *</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(v) => handleAdminProductSelect(v)}
                    disabled={Boolean(editing)}
                  >
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select product from master" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {adminProducts.map((p) => (
                        <SelectItem key={p.id} value={p.id || ''}>
                          {p.productCode} — {p.productName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <FormField control={form.control} name="productCode" render={({ field }) => (
                <FormItem><FormLabel>Product Code *</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="productName" render={({ field }) => (
                <FormItem><FormLabel>Product Name *</FormLabel><FormControl><Input {...field} readOnly /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="genericName" render={({ field }) => (
                <FormItem><FormLabel>Generic Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="brandName" render={({ field }) => (
                <FormItem><FormLabel>Brand Name</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="strength" render={({ field }) => (
                <FormItem><FormLabel>Strength *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="dosageForm" render={({ field }) => (
                <FormItem>
                  <FormLabel>Dosage Form *</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {DOSAGE_FORMS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="packSize" render={({ field }) => (
                <FormItem><FormLabel>Pack Size</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="market" render={({ field }) => (
                <FormItem>
                  <FormLabel>Market</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {MARKET_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />
              <FormField control={form.control} name="shelfLife" render={({ field }) => (
                <FormItem><FormLabel>Shelf Life</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="storageCondition" render={({ field }) => (
                <FormItem><FormLabel>Storage Condition</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="standardBatchSize" render={({ field }) => (
                <FormItem><FormLabel>Standard Batch Size</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="manufacturingLicenseNumber" render={({ field }) => (
                <FormItem><FormLabel>Mfg License No.</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="mfrNumber" render={({ field }) => (
                <FormItem><FormLabel>MFR Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bmrNumber" render={({ field }) => (
                <FormItem><FormLabel>BMR</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="bprNumber" render={({ field }) => (
                <FormItem><FormLabel>BPR Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="specificationNumber" render={({ field }) => (
                <FormItem><FormLabel>Specification Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="stpNumber" render={({ field }) => (
                <FormItem><FormLabel>STP Number</FormLabel><FormControl><Input {...field} /></FormControl></FormItem>
              )} />
              <FormField control={form.control} name="cpvOwner" render={({ field }) => (
                <FormItem><FormLabel>CPV Owner *</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>

            <FormField control={form.control} name="remarks" render={({ field }) => (
              <FormItem><FormLabel>Remarks</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl></FormItem>
            )} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : editing ? 'Update Product' : 'Add to CPV'}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
