'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DocumentNumberingAccessGuard } from '@/components/admin/document-numbering/document-numbering-access-guard';
import { DocumentNumberingForm } from '@/components/admin/document-numbering/document-numbering-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditDocumentNumbering } from '@/lib/permissions';
import {
  fetchDocumentNumberingById, updateDocumentNumbering,
} from '@/components/admin/document-numbering/document-numbering-api';
import { fetchCompanySites } from '@/lib/admin/company-site-service';
import { fetchDepartments } from '@/lib/admin/department-service';
import { fetchProducts } from '@/lib/admin/product-service';
import type { DocumentNumbering, DocumentNumberingFormData } from '@/lib/admin/schemas';

function EditDocumentNumberingContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [format, setFormat] = useState<DocumentNumbering | null>(null);
  const [sites, setSites] = useState<{ code: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ code: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [record, s, d, p] = await Promise.all([
        fetchDocumentNumberingById(id, true),
        fetchCompanySites(),
        fetchDepartments(),
        fetchProducts(),
      ]);
      if (!record) setError('Numbering format not found');
      setFormat(record);
      setSites(s.map((site) => ({ code: site.siteCode || site.siteName, name: site.siteName })));
      setDepartments(d.map((dept) => ({ code: dept.departmentCode || dept.departmentName, name: dept.departmentName })));
      setProducts(p.filter((pr) => pr.productStatus === 'Active').map((pr) => ({ code: pr.productCode, name: pr.productName })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!canEditDocumentNumbering(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit numbering formats." />;
  }

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !format) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  const initial: Partial<DocumentNumberingFormData> = {
    numberingCode: format.numberingCode,
    numberingName: format.numberingName,
    description: format.description,
    moduleName: format.moduleName as DocumentNumberingFormData['moduleName'],
    documentType: format.documentType,
    documentCategory: format.documentCategory,
    department: format.department,
    site: format.site,
    businessUnit: format.businessUnit,
    company: format.company,
    location: format.location,
    product: format.product,
    workflowCode: format.workflowCode,
    prefix: format.prefix,
    suffix: format.suffix,
    siteCode: format.siteCode,
    departmentCode: format.departmentCode,
    productCodeOptional: format.productCodeOptional,
    yearFormat: format.yearFormat,
    monthFormat: format.monthFormat,
    separator: format.separator,
    runningNumberLength: format.runningNumberLength,
    startingNumber: format.startingNumber,
    currentRunningNumber: format.currentRunningNumber,
    resetFrequency: format.resetFrequency,
    revisionFormat: format.revisionFormat,
    formatTokens: format.formatTokens,
    numberingVersion: format.numberingVersion,
    effectiveDate: format.effectiveDate,
    reviewDate: format.reviewDate,
    autoGenerateEnabled: format.autoGenerateEnabled,
    manualOverrideAllowed: format.manualOverrideAllowed,
    allowSkipSequence: format.allowSkipSequence,
    remarks: format.remarks,
    changeReason: '',
  };

  const onSubmit = async (data: DocumentNumberingFormData) => {
    setSubmitting(true);
    const result = await updateDocumentNumbering(id, data, format, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Numbering format updated');
    router.push(`/admin/document-numbering/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Numbering Format" description={format.numberingCode} basePath="/admin" />
      <DocumentNumberingForm
        initial={initial}
        sites={sites}
        departments={departments}
        products={products}
        isEdit
        onSubmit={onSubmit}
        onCancel={() => router.push(`/admin/document-numbering/${id}`)}
        submitting={submitting}
      />
    </div>
  );
}

export default function EditDocumentNumberingPage() {
  return (
    <DocumentNumberingAccessGuard>
      <EditDocumentNumberingContent />
    </DocumentNumberingAccessGuard>
  );
}
