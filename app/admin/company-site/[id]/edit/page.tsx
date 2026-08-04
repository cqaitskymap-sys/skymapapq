'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CompanySiteAccessGuard } from '@/components/admin/company-sites/company-site-access-guard';
import { CompanySiteForm } from '@/components/admin/company-sites/company-site-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditCompanySites } from '@/lib/permissions';
import {
  fetchCompanySiteById, updateCompanySite, uploadCompanyLogo, updateCompanyLogoViaCallable,
} from '@/lib/admin/company-site-service';
import type { CompanySiteFormData } from '@/lib/admin/schemas';

function EditCompanySiteContent({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [initial, setInitial] = useState<CompanySiteFormData | null>(null);
  const [existing, setExisting] = useState<Awaited<ReturnType<typeof fetchCompanySiteById>>>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  useEffect(() => {
    fetchCompanySiteById(id, true).then((record) => {
      if (!record) {
        setLoading(false);
        return;
      }
      setExisting(record);
      setInitial({
        companyName: record.companyName,
        companyCode: record.companyCode || '',
        legalName: record.legalName || '',
        shortName: record.shortName || '',
        companyType: (record.companyType as CompanySiteFormData['companyType']) || '',
        industry: (record.industry as CompanySiteFormData['industry']) || '',
        registrationNumber: record.registrationNumber || '',
        panNumber: record.panNumber || '',
        licenseNumber: record.licenseNumber || '',
        companyEmail: record.companyEmail || '',
        companyPhone: record.companyPhone || '',
        siteName: record.siteName,
        siteCode: record.siteCode || '',
        siteType: (record.siteType as CompanySiteFormData['siteType']) || 'Manufacturing Plant',
        businessUnit: record.businessUnit || '',
        isManufacturingUnit: record.isManufacturingUnit ?? false,
        isWarehouse: record.isWarehouse ?? false,
        isLaboratory: record.isLaboratory ?? false,
        isOffice: record.isOffice ?? false,
        plantName: record.plantName || '',
        plantCode: record.plantCode || '',
        plantAddress: record.plantAddress || record.siteAddress || '',
        city: record.city || '',
        state: record.state || '',
        country: record.country || '',
        pinZipCode: record.pinZipCode || '',
        gstNumber: record.gstNumber || record.gstNo || '',
        manufacturingLicenseNumber: record.manufacturingLicenseNumber || record.licenseNo || '',
        drugLicenseNumber: record.drugLicenseNumber || '',
        contactPerson: record.contactPerson || '',
        contactEmail: record.contactEmail || '',
        contactPhone: record.contactPhone || record.contactNumber || '',
        siteHead: record.siteHead || '',
        siteHeadId: record.siteHeadId || '',
        qualityHead: record.qualityHead || '',
        qualityHeadId: record.qualityHeadId || '',
        website: record.website || '',
        timezone: record.timezone || record.defaultTimezone || 'Asia/Kolkata',
        dateFormat: (record.dateFormat as CompanySiteFormData['dateFormat']) || 'DD/MM/YYYY',
        timeFormat: (record.timeFormat as CompanySiteFormData['timeFormat']) || '24h',
        defaultCurrency: (record.defaultCurrency as CompanySiteFormData['defaultCurrency']) || 'INR',
        documentHeaderFormat: record.documentHeaderFormat || '',
        documentFooterText: record.documentFooterText || '',
        remarks: record.remarks || '',
        status: (record.status as CompanySiteFormData['status']) || 'Active',
        isDefault: record.isDefault ?? false,
        changeReason: '',
      });
      setLoading(false);
    });
  }, [id]);

  if (!canEditCompanySites(role)) {
    return <ErrorCard accessDenied message="Only Super Admin and Admin can edit company/sites." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;
  if (!initial || !existing) return <ErrorCard title="Not Found" message="Site not found" />;

  const onSubmit = async (data: CompanySiteFormData) => {
    setSubmitting(true);
    const result = await updateCompanySite(id, data, existing, auditMeta);
    if (result.error) {
      setSubmitting(false);
      toast.error(result.error);
      return;
    }

    if (logoFile) {
      const upload = await uploadCompanyLogo(id, logoFile, auditMeta, existing.companyLogo);
      if (upload.url) {
        const logoResult = await updateCompanyLogoViaCallable(id, upload.url, existing, data.changeReason);
        if (!logoResult.success) toast.warning(`Saved but logo update failed: ${logoResult.error}`);
      } else if (upload.error) {
        toast.warning(`Saved but logo upload failed: ${upload.error}`);
      }
    }

    setSubmitting(false);
    if (result.cascadeCount && result.cascadeCount > 0) {
      toast.success(`Company/site updated — ${result.cascadeCount} linked record(s) synchronized`);
    } else {
      toast.success('Company/site updated');
    }
    router.push(`/admin/company-site/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Company / Site" description={existing.siteName} basePath="/admin" />
      <CompanySiteForm
        initial={initial}
        existingLogo={existing.companyLogo}
        onSubmit={onSubmit}
        onCancel={() => router.push(`/admin/company-site/${id}`)}
        onLogoSelect={setLogoFile}
        submitting={submitting}
      />
    </div>
  );
}

export default function EditCompanySitePage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <CompanySiteAccessGuard>
      <EditCompanySiteContent id={params.id} />
    </CompanySiteAccessGuard>
  );
}
