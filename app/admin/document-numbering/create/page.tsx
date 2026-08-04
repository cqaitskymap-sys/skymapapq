'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { DocumentNumberingAccessGuard } from '@/components/admin/document-numbering/document-numbering-access-guard';
import { DocumentNumberingForm } from '@/components/admin/document-numbering/document-numbering-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditDocumentNumbering } from '@/lib/permissions';
import { createDocumentNumbering } from '@/components/admin/document-numbering/document-numbering-api';
import { fetchCompanySites } from '@/lib/admin/company-site-service';
import { fetchDepartments } from '@/lib/admin/department-service';
import { fetchProducts } from '@/lib/admin/product-service';
import type { DocumentNumberingFormData } from '@/lib/admin/schemas';

function CreateDocumentNumberingContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [sites, setSites] = useState<{ code: string; name: string }[]>([]);
  const [departments, setDepartments] = useState<{ code: string; name: string }[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([fetchCompanySites(), fetchDepartments(), fetchProducts()]).then(([s, d, p]) => {
      setSites(s.map((site) => ({ code: site.siteCode || site.siteName, name: site.siteName })));
      setDepartments(d.map((dept) => ({ code: dept.departmentCode || dept.departmentName, name: dept.departmentName })));
      setProducts(p.filter((pr) => pr.productStatus === 'Active').map((pr) => ({ code: pr.productCode, name: pr.productName })));
    });
  }, []);

  if (!canEditDocumentNumbering(role)) {
    return <ErrorCard accessDenied message="You do not have permission to create numbering formats." />;
  }

  const onSubmit = async (data: DocumentNumberingFormData) => {
    setSubmitting(true);
    const result = await createDocumentNumbering(data, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Numbering format created');
    router.push(`/admin/document-numbering/${result.format?.id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Create Numbering Format" description="Define automatic document numbering" basePath="/admin" />
      <DocumentNumberingForm
        sites={sites}
        departments={departments}
        products={products}
        onSubmit={onSubmit}
        onCancel={() => router.push('/admin/document-numbering')}
        submitting={submitting}
      />
    </div>
  );
}

export default function CreateDocumentNumberingPage() {
  return (
    <DocumentNumberingAccessGuard>
      <CreateDocumentNumberingContent />
    </DocumentNumberingAccessGuard>
  );
}
