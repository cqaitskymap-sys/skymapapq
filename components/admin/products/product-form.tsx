'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DOSAGE_FORMS, MARKET_OPTIONS, PRODUCT_PRESET,
  CONTAINER_CLOSURE_TYPES, PRODUCT_STATUSES,
} from '@/lib/admin/constants';
import { productFormEditSchema, productFormSchema, type ProductFormData } from '@/lib/admin/schemas';
import { CompositionTable } from './composition-table';
import { PackingTable } from './packing-table';
import { BrandNamesInput } from './brand-names-input';
import { BprNumbersInput } from './bpr-numbers-input';

interface ProductFormProps {
  initial?: Partial<ProductFormData>;
  readOnly?: boolean;
  onSubmit: (data: ProductFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function ProductForm({ initial, readOnly, onSubmit, onCancel, submitting }: ProductFormProps) {
  const isEdit = Boolean(initial?.productCode);
  const form = useForm<ProductFormData>({
    resolver: zodResolver(isEdit ? productFormEditSchema : productFormSchema),
    defaultValues: {
      productCode: '',
      productName: '',
      genericName: '',
      brandName: '',
      productFamily: '',
      category: '',
      strength: '',
      dosageForm: 'Injection',
      routeOfAdministration: '',
      packSize: '',
      packType: '',
      containerClosure: '',
      market: 'Domestic',
      country: 'India',
      manufacturingSite: '',
      businessUnit: '',
      department: '',
      productOwner: '',
      lifecycleStatus: 'Commercial',
      therapeuticCategory: '',
      shelfLife: '24',
      storageCondition: '',
      standardBatchSize: '',
      manufacturingLicenseNumber: '',
      registrationNumber: '',
      licenseNumber: '',
      mfrNumber: '',
      bmrNumber: '',
      bprNumber: '',
      specificationNumber: '',
      stpNumber: '',
      batchPrefix: '',
      hsnCode: '',
      gtin: '',
      barcode: '',
      qrCode: '',
      productStatus: 'Active',
      description: '',
      remarks: '',
      compositions: [],
      packingDetails: [],
      changeReason: '',
      ...initial,
    },
  });

  const initialKey = initial?.productCode || '';
  useEffect(() => {
    if (!initial) return;
    form.reset({ ...form.getValues(), ...initial, changeReason: initial.changeReason || '' });
    // Reset only when the loaded product identity changes — avoid wiping in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  const applyPreset = () => {
    form.setValue('productName', PRODUCT_PRESET.productName);
    form.setValue('genericName', PRODUCT_PRESET.genericName);
    form.setValue('strength', PRODUCT_PRESET.strength);
    form.setValue('dosageForm', PRODUCT_PRESET.dosageForm as ProductFormData['dosageForm']);
    form.setValue('shelfLife', PRODUCT_PRESET.shelfLife);
    form.setValue('storageCondition', PRODUCT_PRESET.storageCondition);
    form.setValue('standardBatchSize', PRODUCT_PRESET.standardBatchSize);
    form.setValue('productStatus', PRODUCT_PRESET.productStatus);
    form.setValue('compositions', [{
      ingredientName: 'Amikacin Sulphate IP',
      ingredientType: 'API',
      grade: 'IP',
      quantity: 500,
      unit: 'mg',
      functionPurpose: 'API',
      specificationNo: '',
      stpNo: '',
    }]);
  };

  const compositions = form.watch('compositions') || [];
  const packingDetails = form.watch('packingDetails') || [];

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {!initial?.productCode && (
        <Button type="button" variant="outline" size="sm" onClick={applyPreset}>Load Amikacin Example</Button>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Product Identity</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <Label>Product Code *</Label>
            <Input {...form.register('productCode')} disabled={readOnly || !!initial?.productCode} />
            {form.formState.errors.productCode && <p className="text-xs text-red-500">{form.formState.errors.productCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Product Name *</Label>
            <Input {...form.register('productName')} disabled={readOnly} />
            {form.formState.errors.productName && <p className="text-xs text-red-500">{form.formState.errors.productName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Generic Name *</Label>
            <Input {...form.register('genericName')} disabled={readOnly} />
            {form.formState.errors.genericName && <p className="text-xs text-red-500">{form.formState.errors.genericName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Brand Names</Label>
            <BrandNamesInput
              value={form.watch('brandName') || ''}
              onChange={(v) => form.setValue('brandName', v)}
              disabled={readOnly}
            />
            <p className="text-xs text-muted-foreground">Add multiple brand names (Enter or +)</p>
          </div>
          <div className="space-y-2">
            <Label>Strength *</Label>
            <Input {...form.register('strength')} disabled={readOnly} />
            {form.formState.errors.strength && <p className="text-xs text-red-500">{form.formState.errors.strength.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Dosage Form *</Label>
            <Select value={form.watch('dosageForm')} onValueChange={(v) => form.setValue('dosageForm', v as ProductFormData['dosageForm'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DOSAGE_FORMS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Product Status *</Label>
            <Select value={form.watch('productStatus')} onValueChange={(v) => form.setValue('productStatus', v as ProductFormData['productStatus'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRODUCT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Pack Size</Label><Input {...form.register('packSize')} disabled={readOnly} /></div>
          <div className="space-y-2">
            <Label>Container Closure</Label>
            <Select value={form.watch('containerClosure') || 'none'} onValueChange={(v) => form.setValue('containerClosure', v === 'none' ? '' : v as ProductFormData['containerClosure'])} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select closure" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {CONTAINER_CLOSURE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Market</Label>
            <Select value={form.watch('market')} onValueChange={(v) => form.setValue('market', v as ProductFormData['market'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MARKET_OPTIONS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Shelf Life (months) *</Label>
            <Input {...form.register('shelfLife')} disabled={readOnly} placeholder="24" />
            {form.formState.errors.shelfLife && <p className="text-xs text-red-500">{form.formState.errors.shelfLife.message}</p>}
          </div>
          <div className="space-y-2"><Label>Storage Condition</Label><Input {...form.register('storageCondition')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Standard Batch Size</Label><Input {...form.register('standardBatchSize')} disabled={readOnly} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Regulatory & Document Numbers</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2"><Label>Mfg License No</Label><Input {...form.register('manufacturingLicenseNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>MFR Number</Label><Input {...form.register('mfrNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>BMR Number</Label><Input {...form.register('bmrNumber')} disabled={readOnly} /></div>
          <div className="space-y-2 sm:col-span-2 xl:col-span-3">
            <Label>BPR Number</Label>
            <BprNumbersInput
              value={form.watch('bprNumber') || ''}
              onChange={(v) => form.setValue('bprNumber', v, { shouldDirty: true, shouldValidate: true })}
              disabled={readOnly}
            />
            <p className="text-xs text-muted-foreground">Add multiple BPR numbers</p>
            {form.formState.errors.bprNumber && <p className="text-xs text-red-500">{form.formState.errors.bprNumber.message}</p>}
          </div>
          <div className="space-y-2"><Label>Specification Number</Label><Input {...form.register('specificationNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>STP Number</Label><Input {...form.register('stpNumber')} disabled={readOnly} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Label Claim</CardTitle></CardHeader>
        <CardContent>
          <Textarea {...form.register('description')} disabled={readOnly} rows={3} placeholder="Product label for reports and integrations" />
          <div className="mt-4 space-y-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} />
          </div>
          <div className="mt-4 space-y-2">
            <Label>Change reason{isEdit ? ' *' : ''}</Label>
            <Textarea
              {...form.register('changeReason')}
              disabled={readOnly}
              rows={2}
              placeholder="Reason for this product master change"
            />
            {form.formState.errors.changeReason && (
              <p className="text-xs text-red-500">{form.formState.errors.changeReason.message}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Composition per batch</CardTitle></CardHeader>
        <CardContent>
          <CompositionTable rows={compositions} onChange={(r) => form.setValue('compositions', r, { shouldDirty: true, shouldValidate: true })} readOnly={readOnly} />
          {form.formState.errors.compositions && (
            <p className="text-xs text-red-500 mt-2">{String(form.formState.errors.compositions.message)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Packing Details</CardTitle></CardHeader>
        <CardContent>
          <PackingTable rows={packingDetails} onChange={(r) => form.setValue('packingDetails', r)} readOnly={readOnly} />
          {form.formState.errors.packingDetails && (
            <p className="text-xs text-red-500 mt-2">{String(form.formState.errors.packingDetails.message || form.formState.errors.packingDetails.root?.message || 'Check packing rows')}</p>
          )}
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save Product'}
          </Button>
        </div>
      )}
    </form>
  );
}
