'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ParameterAccessGuard } from '@/components/admin/parameters/parameter-access-guard';
import { ParameterForm } from '@/components/admin/parameters/parameter-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditParameterType } from '@/lib/permissions';
import { fetchParameterById, updateParameter } from '@/lib/admin/parameter-service';
import { fetchProducts } from '@/lib/admin/product-service';
import type { Parameter, AdminProduct, ParameterFormData } from '@/lib/admin/schemas';

function EditParameterContent({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [initial, setInitial] = useState<ParameterFormData | null>(null);
  const [existing, setExisting] = useState<Parameter | null>(null);
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<ParameterFormData | null>(null);

  useEffect(() => {
    Promise.all([fetchParameterById(id), fetchProducts()]).then(([p, prods]) => {
      if (!p) {
        setLoading(false);
        return;
      }
      setExisting(p);
      setProducts(prods);
      setInitial({
        parameterCode: p.parameterCode,
        parameterName: p.parameterName,
        shortName: p.shortName || '',
        description: p.description || '',
        parameterType: p.parameterType,
        parameterCategory: (p.parameterCategory as ParameterFormData['parameterCategory']) || 'Manufacturing',
        parameterGroup: (p.parameterGroup as ParameterFormData['parameterGroup']) || 'General',
        moduleName: (p.moduleName as ParameterFormData['moduleName']) || 'General',
        subModule: p.subModule || '',
        productLink: p.productLink || '',
        productCategory: p.productCategory || '',
        processStage: (p.processStage as ParameterFormData['processStage']) || 'Mixing',
        department: p.department || '',
        testMethodStp: p.testMethodStp || '',
        specificationNo: p.specificationNo || '',
        targetValue: p.targetValue || '',
        lowerLimit: p.lowerLimit || '',
        upperLimit: p.upperLimit || '',
        alertLimitLow: p.alertLimitLow || '',
        alertLimitHigh: p.alertLimitHigh || '',
        actionLimitLow: p.actionLimitLow || '',
        actionLimitHigh: p.actionLimitHigh || '',
        criticalLimit: p.criticalLimit || '',
        defaultValue: p.defaultValue || '',
        precision: p.precision || '',
        formula: p.formula || '',
        dataType: (p.dataType as ParameterFormData['dataType']) || 'Numeric',
        calculationType: (p.calculationType as ParameterFormData['calculationType']) || 'Manual',
        unit: p.unit || '',
        resultType: p.resultType,
        frequency: (p.frequency as ParameterFormData['frequency']) || 'Per Batch',
        criticality: (p.criticality as ParameterFormData['criticality']) || 'Major',
        mandatory: p.mandatory ?? false,
        displayOrder: p.displayOrder,
        sequenceNumber: p.sequenceNumber || '',
        applicableSite: p.applicableSite || '',
        businessUnit: p.businessUnit || '',
        ootApplicable: p.ootApplicable ?? false,
        oosApplicable: p.oosApplicable ?? false,
        autoDeviationRequired: p.autoDeviationRequired ?? false,
        autoCapaRequired: p.autoCapaRequired ?? false,
        remarks: p.remarks || '',
        changeReason: '',
      });
      setLoading(false);
    });
  }, [id]);

  if (loading) return <LoadingSkeleton rows={1} />;
  if (!initial || !existing) return <ErrorCard title="Not Found" message="Parameter not found" />;

  if (!canEditParameterType(role, existing.parameterType)) {
    return <ErrorCard accessDenied message="You do not have permission to edit this parameter type." />;
  }

  const confirmSave = async (data: ParameterFormData) => {
    setSubmitting(true);
    const result = await updateParameter(id, data, existing, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Parameter updated');
    router.push(`/admin/parameters/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Parameter" description={existing.parameterName} basePath="/admin" />
      <ParameterForm
        initial={initial}
        products={products}
        isEdit
        onSubmit={(data) => setPending(data)}
        onCancel={() => router.push(`/admin/parameters/${id}`)}
        submitting={submitting}
      />
      <AlertDialog open={!!pending} onOpenChange={() => setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
            <AlertDialogDescription>Save changes to &quot;{pending?.parameterName}&quot;?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-blue-600" onClick={() => pending && confirmSave(pending)}>Save Changes</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function EditParameterPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <ParameterAccessGuard>
      <EditParameterContent id={params.id} />
    </ParameterAccessGuard>
  );
}
