'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ApprovalMatrixAccessGuard } from '@/components/admin/approval-matrix/approval-matrix-access-guard';
import { ApprovalMatrixForm } from '@/components/admin/approval-matrix/approval-matrix-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditApprovalMatrix } from '@/lib/permissions';
import {
  fetchApprovalMatrixById, updateApprovalMatrix,
} from '@/lib/admin/approval-matrix-service';
import { fetchRoles } from '@/lib/admin/role-service';
import { fetchCompanySites } from '@/lib/admin/department-service';
import { fetchProducts } from '@/lib/admin/product-service';
import type { ApprovalMatrix, ApprovalMatrixFormData } from '@/lib/admin/schemas';

function EditApprovalMatrixContent({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [initial, setInitial] = useState<ApprovalMatrixFormData | null>(null);
  const [existing, setExisting] = useState<ApprovalMatrix | null>(null);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [sites, setSites] = useState<string[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<ApprovalMatrixFormData | null>(null);

  useEffect(() => {
    Promise.all([
      fetchApprovalMatrixById(id),
      fetchRoles(),
      fetchCompanySites(),
      fetchProducts(),
    ]).then(([m, r, s, p]) => {
      if (!m) {
        setLoading(false);
        return;
      }
      setRoles(r.map((x) => ({ id: x.roleId || x.id || '', name: x.roleName || x.roleId || '' })));
      setSites(s.map((site) => site.siteName).filter(Boolean));
      setProducts(p.map((pr) => ({ code: pr.productCode, name: pr.productName })));
      setExisting(m);
      setInitial({
        matrixCode: m.matrixCode,
        matrixName: m.matrixName,
        description: m.description || '',
        moduleName: m.moduleName as ApprovalMatrixFormData['moduleName'],
        subModule: m.subModule || '',
        department: m.department,
        siteLocation: m.siteLocation || '',
        businessUnit: m.businessUnit || '',
        workflowCode: m.workflowCode || '',
        documentType: m.documentType || '',
        category: m.category || '',
        priority: m.priority || 'Medium',
        productOptional: m.productOptional || '',
        processOptional: m.processOptional || '',
        riskLevel: m.riskLevel,
        approvalMode: (m.approvalMode as ApprovalMatrixFormData['approvalMode']) || 'Sequential',
        matrixVersion: m.matrixVersion || '1.0',
        effectiveDate: m.effectiveDate || '',
        reviewDate: m.reviewDate || '',
        preparedByRole: m.preparedByRole || '',
        reviewedByRole: m.reviewedByRole || '',
        verifiedByRole: m.verifiedByRole || '',
        approvedByRole: m.approvedByRole || '',
        finalApproverRole: m.finalApproverRole || '',
        escalationRole: m.escalationRole || '',
        approvalGroup: m.approvalGroup || '',
        quorumCount: m.quorumCount,
        minimumApprovalLevel: Number(m.minimumApprovalLevel ?? 1),
        slaHours: m.slaHours,
        reminderHours: m.reminderHours,
        autoEscalationEnabled: m.autoEscalationEnabled ?? false,
        autoEscalationHours: m.autoEscalationHours,
        autoApproveEnabled: m.autoApproveEnabled ?? false,
        allowReject: m.allowReject ?? true,
        allowReturn: m.allowReturn ?? true,
        allowRework: m.allowRework ?? true,
        allowResubmit: m.allowResubmit ?? true,
        allowCancel: m.allowCancel ?? false,
        allowSkip: m.allowSkip ?? false,
        eSignatureRequired: m.eSignatureRequired ?? true,
        digitalSignatureRequired: m.digitalSignatureRequired ?? false,
        approvalCommentRequired: m.approvalCommentRequired ?? true,
        parallelApprovalAllowed: m.parallelApprovalAllowed ?? false,
        sequentialApprovalRequired: m.sequentialApprovalRequired ?? true,
        conditionalApprovalEnabled: m.conditionalApprovalEnabled ?? false,
        conditionExpression: m.conditionExpression || '',
        delegationAllowed: m.delegationAllowed ?? false,
        remarks: m.remarks || '',
        changeReason: '',
      });
      setLoading(false);
    });
  }, [id]);

  if (!canEditApprovalMatrix(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit approval matrices." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;
  if (!initial || !existing) return <ErrorCard title="Not Found" message="Matrix not found" />;

  const confirmSave = async (data: ApprovalMatrixFormData) => {
    setSubmitting(true);
    const result = await updateApprovalMatrix(id, data, existing, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Approval matrix updated');
    router.push(`/admin/approval-matrix/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Approval Matrix" description={existing.matrixName} basePath="/admin" />
      <ApprovalMatrixForm
        initial={initial}
        isEdit
        roles={roles}
        sites={sites}
        products={products}
        onSubmit={(data) => setPending(data)}
        onCancel={() => router.push(`/admin/approval-matrix/${id}`)}
        submitting={submitting}
      />
      <AlertDialog open={!!pending} onOpenChange={() => setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
            <AlertDialogDescription>Save changes to &quot;{pending?.matrixName}&quot;?</AlertDialogDescription>
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

export default function EditApprovalMatrixPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <ApprovalMatrixAccessGuard>
      <EditApprovalMatrixContent id={params.id} />
    </ApprovalMatrixAccessGuard>
  );
}
