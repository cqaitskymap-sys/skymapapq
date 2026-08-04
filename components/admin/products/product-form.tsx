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
  DOSAGE_FORMS, ROUTE_OPTIONS, MARKET_OPTIONS, PRODUCT_STATUSES, PRODUCT_PRESET,
  PRODUCT_LIFECYCLE_STATUSES, PRODUCT_CATEGORIES, PACK_TYPES, CONTAINER_CLOSURE_TYPES,
} from '@/lib/admin/constants';
import { productFormSchema, type ProductFormData } from '@/lib/admin/schemas';
import { CompositionTable } from './composition-table';
import { PackingTable } from './packing-table';

interface ProductFormProps {
  initial?: Partial<ProductFormData>;
  readOnly?: boolean;
  onSubmit: (data: ProductFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
}

export function ProductForm({ initial, readOnly, onSubmit, onCancel, submitting }: ProductFormProps) {
  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
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
      compositions: [{
        ingredientName: 'Amikacin Sulphate IP', ingredientType: 'API', grade: 'IP',
        quantity: 500, unit: 'mg', functionPurpose: 'API', specificationNo: '', stpNo: '',
      }],
      packingDetails: [],
      changeReason: '',
      ...initial,
    },
  });

  useEffect(() => {
    if (initial) form.reset({ ...form.getValues(), ...initial, changeReason: initial.changeReason || '' });
  }, [initial, form]);

  const applyPreset = () => {
    form.setValue('productName', PRODUCT_PRESET.productName);
    form.setValue('genericName', PRODUCT_PRESET.genericName);
    form.setValue('strength', PRODUCT_PRESET.strength);
    form.setValue('dosageForm', PRODUCT_PRESET.dosageForm as ProductFormData['dosageForm']);
    form.setValue('routeOfAdministration', PRODUCT_PRESET.routeOfAdministration);
    form.setValue('shelfLife', PRODUCT_PRESET.shelfLife);
    form.setValue('storageCondition', PRODUCT_PRESET.storageCondition);
    form.setValue('standardBatchSize', PRODUCT_PRESET.standardBatchSize);
    form.setValue('productStatus', PRODUCT_PRESET.productStatus);
  };

  const compositions = form.watch('compositions') || [];
  const packingDetails = form.watch('packingDetails') || [];

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      {!initial?.productCode && (
        <Button type="button" variant="outline" size="sm" onClick={applyPreset}>Load Amikacin Example</Button>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Product Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <div className="space-y-2"><Label>Brand Name</Label><Input {...form.register('brandName')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Product Family</Label><Input {...form.register('productFamily')} disabled={readOnly} placeholder="e.g. Injectable Antibiotics" /></div>
          <div className="space-y-2">
            <Label>Category</Label>
            <Select value={form.watch('category') || 'none'} onValueChange={(v) => form.setValue('category', v === 'none' ? '' : v as ProductFormData['category'])} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {PRODUCT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
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
            <Label>Route of Administration</Label>
            <Select value={form.watch('routeOfAdministration') || 'none'} onValueChange={(v) => form.setValue('routeOfAdministration', v === 'none' ? '' : v)} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select route" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {ROUTE_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Pack Size</Label><Input {...form.register('packSize')} disabled={readOnly} /></div>
          <div className="space-y-2">
            <Label>Pack Type</Label>
            <Select value={form.watch('packType') || 'none'} onValueChange={(v) => form.setValue('packType', v === 'none' ? '' : v as ProductFormData['packType'])} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select pack type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {PACK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
          <div className="space-y-2"><Label>Therapeutic Category</Label><Input {...form.register('therapeuticCategory')} disabled={readOnly} /></div>
          <div className="space-y-2">
            <Label>Shelf Life (months) *</Label>
            <Input {...form.register('shelfLife')} disabled={readOnly} placeholder="24" />
            {form.formState.errors.shelfLife && <p className="text-xs text-red-500">{form.formState.errors.shelfLife.message}</p>}
          </div>
          <div className="space-y-2"><Label>Storage Condition</Label><Input {...form.register('storageCondition')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Standard Batch Size</Label><Input {...form.register('standardBatchSize')} disabled={readOnly} /></div>
          <div className="space-y-2">
            <Label>Product Status</Label>
            <Select value={form.watch('productStatus')} onValueChange={(v) => form.setValue('productStatus', v as ProductFormData['productStatus'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRODUCT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Lifecycle Status</Label>
            <Select value={form.watch('lifecycleStatus')} onValueChange={(v) => form.setValue('lifecycleStatus', v as ProductFormData['lifecycleStatus'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PRODUCT_LIFECYCLE_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Organization & Site</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Country</Label><Input {...form.register('country')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Manufacturing Site</Label><Input {...form.register('manufacturingSite')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Business Unit</Label><Input {...form.register('businessUnit')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Department</Label><Input {...form.register('department')} disabled={readOnly} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>Product Owner</Label><Input {...form.register('productOwner')} disabled={readOnly} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Regulatory & Document Numbers</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2"><Label>Mfg License No</Label><Input {...form.register('manufacturingLicenseNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Registration Number</Label><Input {...form.register('registrationNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>License Number</Label><Input {...form.register('licenseNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>MFR Number</Label><Input {...form.register('mfrNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>BMR Number</Label><Input {...form.register('bmrNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>BPR Number</Label><Input {...form.register('bprNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Specification Number</Label><Input {...form.register('specificationNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>STP Number</Label><Input {...form.register('stpNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Batch Prefix</Label><Input {...form.register('batchPrefix')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>HSN Code</Label><Input {...form.register('hsnCode')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>GTIN</Label><Input {...form.register('gtin')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Barcode</Label><Input {...form.register('barcode')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>QR Code</Label><Input {...form.register('qrCode')} disabled={readOnly} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
        <CardContent>
          <Textarea {...form.register('description')} disabled={readOnly} rows={3} placeholder="Product description for reports and integrations" />
          <div className="mt-4 space-y-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Composition</CardTitle></CardHeader>
        <CardContent>
          <CompositionTable rows={compositions} onChange={(r) => form.setValue('compositions', r)} readOnly={readOnly} />
          {form.formState.errors.compositions && (
            <p className="text-xs text-red-500 mt-2">{String(form.formState.errors.compositions.message)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Packing Details</CardTitle></CardHeader>
        <CardContent>
          <PackingTable rows={packingDetails} onChange={(r) => form.setValue('packingDetails', r)} readOnly={readOnly} />
        </CardContent>
      </Card>

      {!readOnly && (
        <Card>
          <CardHeader><CardTitle className="text-base">Change Control</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="changeReason">Change Reason * (ALCOA+ / Part 11)</Label>
            <Textarea
              id="changeReason"
              {...form.register('changeReason')}
              rows={2}
              placeholder="Document why this product master change is required"
            />
            {form.formState.errors.changeReason && (
              <p className="text-xs text-destructive">{form.formState.errors.changeReason.message}</p>
            )}
          </CardContent>
        </Card>
      )}

      {!readOnly && (
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit" disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
            {submitting ? 'Saving...' : 'Save Product'}
          </Button>
        </div>
      )}
    </form>
  );
}
