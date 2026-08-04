'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { WorkflowAccessGuard } from '@/components/admin/workflows/workflow-access-guard';
import { WorkflowForm } from '@/components/admin/workflows/workflow-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditWorkflows } from '@/lib/permissions';
import {
  fetchWorkflowById, fetchWorkflowSteps, updateWorkflow,
} from '@/lib/admin/workflow-service';
import { fetchRoles } from '@/lib/admin/role-service';
import type { Workflow, WorkflowFormData } from '@/lib/admin/schemas';

function EditWorkflowContent({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [initial, setInitial] = useState<WorkflowFormData | null>(null);
  const [existing, setExisting] = useState<Workflow | null>(null);
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState<WorkflowFormData | null>(null);

  useEffect(() => {
    Promise.all([fetchWorkflowById(id), fetchWorkflowSteps(id), fetchRoles()]).then(([w, steps, roleList]) => {
      if (!w) {
        setLoading(false);
        return;
      }
      setRoles(roleList.map((x) => ({ id: x.roleId || x.id || '', name: x.roleName || x.roleId || '' })));
      setExisting(w);
      setInitial({
        workflowCode: w.workflowCode,
        workflowName: w.workflowName,
        moduleName: w.moduleName as WorkflowFormData['moduleName'],
        subModule: w.subModule || '',
        workflowCategory: w.workflowCategory || 'Approval',
        businessUnit: w.businessUnit || '',
        site: w.site || '',
        department: w.department || '',
        workflowType: w.workflowType,
        triggerEvent: w.triggerEvent || '',
        priority: w.priority || 'Medium',
        slaHours: w.slaHours,
        parallelApproval: w.parallelApproval ?? false,
        sequentialApproval: w.sequentialApproval ?? true,
        conditionalRouting: w.conditionalRouting ?? false,
        workflowVersion: w.workflowVersion || '1.0',
        effectiveDate: w.effectiveDate || '',
        reviewDate: w.reviewDate || '',
        expiryDate: w.expiryDate || '',
        initiatorRole: w.initiatorRole || '',
        reviewerRoles: w.reviewerRoles || '',
        approverRoles: w.approverRoles || '',
        finalApproverRole: w.finalApproverRole || '',
        escalationRole: w.escalationRole || '',
        approvalLevels: Number(w.approvalLevels) || steps.length,
        requireESignature: w.requireESignature ?? true,
        requireRemarks: w.requireRemarks ?? true,
        allowRejection: w.allowRejection ?? true,
        allowResubmission: w.allowResubmission ?? true,
        allowDelegation: w.allowDelegation ?? false,
        autoEscalationEnabled: w.autoEscalationEnabled ?? false,
        escalationDays: Number(w.escalationDays ?? 3),
        targetCompletionDays: Number(w.targetCompletionDays ?? 30),
        description: w.description || '',
        remarks: w.remarks || '',
        changeReason: '',
        steps: steps.map((s) => ({
          id: s.id,
          stepNumber: s.stepNumber,
          stepName: s.stepName,
          stepType: s.stepType,
          department: s.department || '',
          assignedRole: s.assignedRole,
          assignedUser: s.assignedUser || '',
          isMandatory: s.isMandatory ?? true,
          canApprove: s.canApprove ?? false,
          canReject: s.canReject ?? false,
          canSendBack: s.canSendBack ?? false,
          requireESignature: s.requireESignature ?? false,
          requireComment: s.requireComment ?? false,
          dueDays: Number(s.dueDays ?? 3),
          escalationRole: s.escalationRole || '',
          conditionExpression: s.conditionExpression || '',
          nextStepOnApprove: s.nextStepOnApprove || '',
          nextStepOnReject: s.nextStepOnReject || '',
          isParallel: s.isParallel ?? false,
          status: (s.status as WorkflowFormData['steps'][0]['status']) || 'Active',
        })),
      });
      setLoading(false);
    });
  }, [id]);

  if (!canEditWorkflows(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit workflows." />;
  }

  if (loading) return <LoadingSkeleton rows={1} />;
  if (!initial || !existing) return <ErrorCard title="Not Found" message="Workflow not found" />;

  const confirmSave = async (data: WorkflowFormData) => {
    setSubmitting(true);
    const result = await updateWorkflow(id, data, existing, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('Workflow updated');
    router.push(`/admin/workflows/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit Workflow" description={existing.workflowName} basePath="/admin" />
      <WorkflowForm
        initial={initial}
        roles={roles}
        isEdit
        onSubmit={(data) => setPending(data)}
        onCancel={() => router.push(`/admin/workflows/${id}`)}
        submitting={submitting}
      />
      <AlertDialog open={!!pending} onOpenChange={() => setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Changes</AlertDialogTitle>
            <AlertDialogDescription>Save changes to &quot;{pending?.workflowName}&quot;?</AlertDialogDescription>
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

export default function EditWorkflowPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  return (
    <WorkflowAccessGuard>
      <EditWorkflowContent id={params.id} />
    </WorkflowAccessGuard>
  );
}
