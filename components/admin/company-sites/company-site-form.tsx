'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Upload } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  SITE_TYPES, COMPANY_TYPES, INDUSTRIES, RECORD_STATUSES, DATE_FORMATS, TIME_FORMATS,
  CURRENCY_OPTIONS, TIMEZONE_OPTIONS, LOGO_MAX_BYTES,
} from '@/lib/admin/constants';
import { companySiteFormSchema, type CompanySiteFormData, type CompanySite } from '@/lib/admin/schemas';
import { validateLogoFile } from '@/lib/admin/company-site-service';
import { fetchActiveUsers } from '@/lib/admin/department-service';
import type { AdminUser } from '@/lib/admin/schemas';
import { DocumentPreviewCard } from './document-preview-card';

interface CompanySiteFormProps {
  initial?: Partial<CompanySiteFormData>;
  existingLogo?: string;
  readOnly?: boolean;
  onSubmit: (data: CompanySiteFormData) => void;
  onCancel: () => void;
  onLogoSelect?: (file: File | null) => void;
  submitting?: boolean;
}

export function CompanySiteForm({
  initial,
  existingLogo,
  readOnly,
  onSubmit,
  onCancel,
  onLogoSelect,
  submitting,
}: CompanySiteFormProps) {
  const [logoPreview, setLogoPreview] = useState(existingLogo || '');
  const [logoError, setLogoError] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const form = useForm<CompanySiteFormData>({
    resolver: zodResolver(companySiteFormSchema),
    defaultValues: {
      companyName: '',
      companyCode: '',
      legalName: '',
      shortName: '',
      companyType: '',
      industry: '',
      registrationNumber: '',
      panNumber: '',
      licenseNumber: '',
      companyEmail: '',
      companyPhone: '',
      siteName: '',
      siteCode: '',
      siteType: 'Manufacturing Plant',
      businessUnit: '',
      isManufacturingUnit: false,
      isWarehouse: false,
      isLaboratory: false,
      isOffice: false,
      plantName: '',
      plantCode: '',
      plantAddress: '',
      city: '',
      state: '',
      country: 'India',
      pinZipCode: '',
      gstNumber: '',
      manufacturingLicenseNumber: '',
      drugLicenseNumber: '',
      contactPerson: '',
      contactEmail: '',
      contactPhone: '',
      siteHead: '',
      siteHeadId: '',
      qualityHead: '',
      qualityHeadId: '',
      website: '',
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '24h',
      defaultCurrency: 'INR',
      documentHeaderFormat: '',
      documentFooterText: '',
      remarks: '',
      status: 'Active',
      isDefault: false,
      changeReason: '',
      ...initial,
    },
  });

  useEffect(() => {
    fetchActiveUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    if (initial) form.reset({ ...form.getValues(), ...initial, changeReason: initial.changeReason || '' });
  }, [initial, form]);

  useEffect(() => {
    if (existingLogo) setLogoPreview(existingLogo);
  }, [existingLogo]);

  const watched = form.watch();
  const previewSite: Partial<CompanySite> = { ...watched, companyLogo: logoPreview };

  const handleLogo = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const check = validateLogoFile(file);
    if (!check.valid) {
      setLogoError(check.error || 'Invalid file');
      return;
    }
    setLogoError(null);
    setLogoPreview(URL.createObjectURL(file));
    onLogoSelect?.(file);
  };

  const selectUser = (field: 'siteHead' | 'qualityHead', userId: string) => {
    const user = users.find((item) => item.id === userId || item.userId === userId);
    if (!user) {
      form.setValue(`${field}Id`, '');
      form.setValue(field, '');
      return;
    }
    form.setValue(`${field}Id`, user.id || user.userId || '');
    form.setValue(field, user.fullName || '');
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Company Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Company Name *</Label>
            <Input {...form.register('companyName')} disabled={readOnly} />
            {form.formState.errors.companyName && <p className="text-xs text-red-500">{form.formState.errors.companyName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Company Code *</Label>
            <Input {...form.register('companyCode')} disabled={readOnly} className="uppercase" />
            {form.formState.errors.companyCode && <p className="text-xs text-red-500">{form.formState.errors.companyCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Legal Name</Label>
            <Input {...form.register('legalName')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Short Name</Label>
            <Input {...form.register('shortName')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Company Type</Label>
            <Select
              value={form.watch('companyType') || 'none'}
              onValueChange={(value) => form.setValue('companyType', value === 'none' ? '' : value as CompanySiteFormData['companyType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {COMPANY_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Industry</Label>
            <Select
              value={form.watch('industry') || 'none'}
              onValueChange={(value) => form.setValue('industry', value === 'none' ? '' : value as CompanySiteFormData['industry'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select industry" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not specified</SelectItem>
                {INDUSTRIES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Registration Number</Label>
            <Input {...form.register('registrationNumber')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>PAN Number</Label>
            <Input {...form.register('panNumber')} disabled={readOnly} className="uppercase" />
          </div>
          <div className="space-y-2">
            <Label>License Number</Label>
            <Input {...form.register('licenseNumber')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Company Email</Label>
            <Input type="email" {...form.register('companyEmail')} disabled={readOnly} />
            {form.formState.errors.companyEmail && <p className="text-xs text-red-500">{form.formState.errors.companyEmail.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Company Phone</Label>
            <Input {...form.register('companyPhone')} disabled={readOnly} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Company Logo</Label>
            <div className="flex items-center gap-4">
              {logoPreview && (
                <Image src={logoPreview} alt="Logo" width={180} height={48} className="h-12 w-auto rounded border p-1 object-contain" />
              )}
              {!readOnly && (
                <div>
                  <Button type="button" variant="outline" size="sm" asChild>
                    <label className="cursor-pointer">
                      <Upload className="h-4 w-4 mr-1" />Upload Logo
                      <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleLogo} />
                    </label>
                  </Button>
                  <p className="text-xs text-muted-foreground mt-1">PNG, JPG, WEBP — max {LOGO_MAX_BYTES / 1024 / 1024} MB</p>
                </div>
              )}
            </div>
            {logoError && <p className="text-xs text-red-500">{logoError}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Site Identity</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Site Name *</Label>
            <Input {...form.register('siteName')} disabled={readOnly} />
            {form.formState.errors.siteName && <p className="text-xs text-red-500">{form.formState.errors.siteName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Site Code *</Label>
            <Input {...form.register('siteCode')} disabled={readOnly} className="uppercase" />
            {form.formState.errors.siteCode && <p className="text-xs text-red-500">{form.formState.errors.siteCode.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Site Type</Label>
            <Select
              value={form.watch('siteType')}
              onValueChange={(value) => form.setValue('siteType', value as CompanySiteFormData['siteType'])}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SITE_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Business Unit</Label>
            <Input {...form.register('businessUnit')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Plant Name</Label>
            <Input {...form.register('plantName')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Plant Code</Label>
            <Input {...form.register('plantCode')} disabled={readOnly} />
          </div>
          <div className="flex flex-wrap gap-4 sm:col-span-2">
            {([
              ['isManufacturingUnit', 'Manufacturing Unit'],
              ['isWarehouse', 'Warehouse'],
              ['isLaboratory', 'Laboratory'],
              ['isOffice', 'Office'],
            ] as const).map(([field, label]) => (
              <label key={field} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={form.watch(field)}
                  onCheckedChange={(checked) => form.setValue(field, Boolean(checked))}
                  disabled={readOnly}
                />
                {label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Address & Licenses</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2 sm:col-span-2">
            <Label>Site Address *</Label>
            <Textarea {...form.register('plantAddress')} disabled={readOnly} rows={2} />
            {form.formState.errors.plantAddress && <p className="text-xs text-red-500">{form.formState.errors.plantAddress.message}</p>}
          </div>
          <div className="space-y-2"><Label>City</Label><Input {...form.register('city')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>State</Label><Input {...form.register('state')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Country</Label><Input {...form.register('country')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Postal Code</Label><Input {...form.register('pinZipCode')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>GST Number</Label><Input {...form.register('gstNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Manufacturing License</Label><Input {...form.register('manufacturingLicenseNumber')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Drug License Number</Label><Input {...form.register('drugLicenseNumber')} disabled={readOnly} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Site Leadership & Contact</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Site Head</Label>
            <Select
              value={form.watch('siteHeadId') || 'none'}
              onValueChange={(value) => selectUser('siteHead', value === 'none' ? '' : value)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select site head" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id || user.userId} value={user.id || user.userId || ''}>
                    {user.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Quality Head</Label>
            <Select
              value={form.watch('qualityHeadId') || 'none'}
              onValueChange={(value) => selectUser('qualityHead', value === 'none' ? '' : value)}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select quality head" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Not assigned</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id || user.userId} value={user.id || user.userId || ''}>
                    {user.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Contact Person</Label><Input {...form.register('contactPerson')} disabled={readOnly} /></div>
          <div className="space-y-2">
            <Label>Contact Email</Label>
            <Input type="email" {...form.register('contactEmail')} disabled={readOnly} />
            {form.formState.errors.contactEmail && <p className="text-xs text-red-500">{form.formState.errors.contactEmail.message}</p>}
          </div>
          <div className="space-y-2"><Label>Contact Phone</Label><Input {...form.register('contactPhone')} disabled={readOnly} /></div>
          <div className="space-y-2"><Label>Website</Label><Input {...form.register('website')} disabled={readOnly} /></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Regional Settings</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Timezone</Label>
            <Select value={form.watch('timezone')} onValueChange={(value) => form.setValue('timezone', value)} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEZONE_OPTIONS.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Date Format</Label>
            <Select value={form.watch('dateFormat')} onValueChange={(value) => form.setValue('dateFormat', value as CompanySiteFormData['dateFormat'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DATE_FORMATS.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Time Format</Label>
            <Select value={form.watch('timeFormat')} onValueChange={(value) => form.setValue('timeFormat', value as CompanySiteFormData['timeFormat'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIME_FORMATS.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Default Currency</Label>
            <Select value={form.watch('defaultCurrency')} onValueChange={(value) => form.setValue('defaultCurrency', value as CompanySiteFormData['defaultCurrency'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCY_OPTIONS.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.watch('status')} onValueChange={(value) => form.setValue('status', value as CompanySiteFormData['status'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RECORD_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between p-3 border rounded-lg">
            <Label>Default Site</Label>
            <Switch checked={form.watch('isDefault')} onCheckedChange={(value) => form.setValue('isDefault', value)} disabled={readOnly} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} disabled={readOnly} rows={2} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Document Header & Footer</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Custom Header Format (optional)</Label>
            <Textarea {...form.register('documentHeaderFormat')} disabled={readOnly} rows={3} placeholder="Leave blank to use auto-generated header" />
          </div>
          <div className="space-y-2">
            <Label>Document Footer Text</Label>
            <Textarea {...form.register('documentFooterText')} disabled={readOnly} rows={2} />
          </div>
          <DocumentPreviewCard site={previewSite} logoUrl={logoPreview} />
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
              placeholder="Document why this company/site change is required"
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
            {submitting ? 'Saving…' : 'Save Company / Site'}
          </Button>
        </div>
      )}
    </form>
  );
}
