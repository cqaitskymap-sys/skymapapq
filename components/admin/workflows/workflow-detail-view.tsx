'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Download, Link2, History, GitBranch } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { ModuleBadge } from './module-badge';
import { WorkflowTypeBadge } from './workflow-type-badge';
import { WorkflowFlowchart } from './workflow-flowchart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditWorkflows } from '@/lib/permissions';
import type { Workflow, WorkflowStep } from '@/lib/admin/schemas';
import {
  fetchWorkflowById, fetchWorkflowSteps, fetchWorkflowAuditTrail, isWorkflowActive,
  countLinkedWorkflowUsage, exportWorkflowsCsv,
} from '@/lib/admin/workflow-service';

const INTEGRATION_MODULES = [
  'Document Management', 'CAPA', 'Deviation', 'Change Control',
  'Risk Management', 'Audit', 'Validation', 'Qualification', 'Equipment',
  'Calibration', 'Maintenance', 'Complaint', 'Supplier Qualification',
  'PQR', 'CPV', 'OOS', 'eBMR',
];

export function WorkflowDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { role } = useAdminPermissions();
  const canEdit = canEditWorkflows(role);

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [linkedCount, setLinkedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const w = await fetchWorkflowById(id, true);
      if (!w) {
        setError('Workflow not found');
        return;
      }
      setWorkflow(w);
      setSteps(await fetchWorkflowSteps(id));
      setAuditTrail(await fetchWorkflowAuditTrail(id));
      setLinkedCount(await countLinkedWorkflowUsage(id, w.workflowCode));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !workflow) return <ErrorCard title="Not Found" message={error || 'Workflow not found'} />;

  const overviewFields = [
    { label: 'Workflow ID', value: workflow.workflowId },
    { label: 'Workflow Code', value: workflow.workflowCode },
    { label: 'Module', value: workflow.moduleName },
    { label: 'Sub Module', value: workflow.subModule },
    { label: 'Category', value: workflow.workflowCategory },
    { label: 'Type', value: workflow.workflowType },
    { label: 'Version', value: workflow.workflowVersion },
    { label: 'Priority', value: workflow.priority },
    { label: 'SLA (Hours)', value: workflow.slaHours },
    { label: 'Department', value: workflow.department },
    { label: 'Business Unit', value: workflow.businessUnit },
    { label: 'Site', value: workflow.site },
    { label: 'Trigger Event', value: workflow.triggerEvent },
    { label: 'Initiator Role', value: workflow.initiatorRole },
    { label: 'Final Approver', value: workflow.finalApproverRole },
    { label: 'Escalation Role', value: workflow.escalationRole },
    { label: 'Approval Levels', value: workflow.approvalLevels },
    { label: 'Effective Date', value: workflow.effectiveDate },
    { label: 'Review Date', value: workflow.reviewDate },
    { label: 'Expiry Date', value: workflow.expiryDate },
    { label: 'Created By', value: workflow.createdBy },
    { label: 'Created At', value: workflow.createdAt },
    { label: 'Updated By', value: workflow.updatedBy },
    { label: 'Updated At', value: workflow.updatedAt },
  ];

  const handleExport = () => {
    const csv = exportWorkflowsCsv([workflow]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${workflow.workflowCode}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Workflow exported');
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/workflows')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Workflows
      </Button>

      <PageHeader
        title={workflow.workflowName}
        description={workflow.workflowId || workflow.workflowCode}
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/approval-matrix"><GitBranch className="h-4 w-4 mr-1" />Approval Matrix</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canEdit && !workflow.isDeleted && (
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/workflows/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Workflow</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <ModuleBadge module={workflow.moduleName} />
        <WorkflowTypeBadge type={workflow.workflowType} />
        <StatusBadge status={workflow.isDeleted ? 'Deleted' : workflow.status} />
        {workflow.isArchived && <Badge variant="outline" className="text-amber-700 border-amber-300">Archived</Badge>}
        {!isWorkflowActive(workflow) && !workflow.isDeleted && (
          <Badge variant="secondary">Not active for new records</Badge>
        )}
        {linkedCount > 0 && (
          <Badge variant="secondary"><Link2 className="h-3 w-3 mr-1" />{linkedCount} linked record(s)</Badge>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="designer">Designer</TabsTrigger>
          <TabsTrigger value="approvals">Approval Engine</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Workflow Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {overviewFields.map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium break-words">{String(f.value ?? '-')}</p>
                </div>
              ))}
              {workflow.description && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{workflow.description}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="designer" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Workflow Chain</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm mb-4 font-mono bg-slate-50 p-3 rounded">{workflow.workflowChain || steps.map((s) => s.stepName).join(' → ') || '-'}</p>
              <WorkflowFlowchart steps={steps} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Steps ({steps.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {steps.length === 0 ? (
                <EmptyState title="No steps" />
              ) : (
                steps.map((step) => (
                  <div key={step.id || step.stepNumber} className="border rounded-lg p-3 text-sm flex flex-wrap gap-2 justify-between">
                    <div>
                      <span className="font-mono text-xs text-muted-foreground mr-2">#{step.stepNumber}</span>
                      <span className="font-medium">{step.stepName}</span>
                      <span className="text-muted-foreground ml-2">({step.stepType})</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {step.assignedRole} · {step.department || '-'} · Due {step.dueDays}d
                      {step.requireESignature ? ' · E-Sign' : ''}
                      {step.isParallel ? ' · Parallel' : ''}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <Card>
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: 'E-Signature Required', value: workflow.requireESignature },
                { label: 'Remarks Required', value: workflow.requireRemarks },
                { label: 'Allow Rejection', value: workflow.allowRejection },
                { label: 'Allow Resubmission / Rework', value: workflow.allowResubmission },
                { label: 'Allow Delegation', value: workflow.allowDelegation },
                { label: 'Auto Escalation', value: workflow.autoEscalationEnabled },
                { label: 'Parallel Approval', value: workflow.parallelApproval },
                { label: 'Sequential Approval', value: workflow.sequentialApproval },
                { label: 'Conditional Routing', value: workflow.conditionalRouting },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{f.value ? 'Yes' : 'No'}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">QMS Module Integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Active workflows are resolved via <code className="text-xs">fetchActiveWorkflowForModule</code>.
                Linked records: {linkedCount}.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {INTEGRATION_MODULES.map((mod) => {
                  const active = workflow.moduleName === mod
                    || (mod === 'Document Management' && workflow.moduleName === 'DMS')
                    || (mod === 'Complaint' && workflow.moduleName === 'Complaint');
                  return (
                    <div key={mod} className={`border rounded-lg p-3 text-sm ${active ? 'border-blue-300 bg-blue-50' : 'opacity-60'}`}>
                      <p className="font-medium">{mod}</p>
                      <p className="text-xs text-muted-foreground">{active ? 'Primary module' : 'Reusable across platform'}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Immutable Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState title="No audit entries" />
              ) : (
                <div className="space-y-2">
                  {auditTrail.map((entry, i) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-1 p-3 border rounded text-sm bg-slate-50">
                      <span className="font-medium">{String(entry.action ?? entry.eventType ?? '-')}</span>
                      {Boolean(entry.reason) && (
                        <span className="text-xs text-muted-foreground">Reason: {String(entry.reason)}</span>
                      )}
                      <span className="text-xs text-muted-foreground sm:ml-auto">
                        {String(entry.userName ?? entry.actorName ?? '-')} · {String(entry.timestamp ?? entry.dateTime ?? '-')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Workflow History</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex gap-3 border-l-2 border-blue-500 pl-4">
                  <div>
                    <p className="font-medium">Created</p>
                    <p className="text-muted-foreground">{workflow.createdBy || '-'} · {workflow.createdAt || '-'}</p>
                  </div>
                </div>
                {workflow.clonedFrom && (
                  <div className="flex gap-3 border-l-2 border-violet-500 pl-4">
                    <div>
                      <p className="font-medium">Cloned From</p>
                      <p className="text-muted-foreground">{workflow.clonedFrom}</p>
                    </div>
                  </div>
                )}
                {workflow.updatedAt && (
                  <div className="flex gap-3 border-l-2 border-amber-500 pl-4">
                    <div>
                      <p className="font-medium">Last Updated</p>
                      <p className="text-muted-foreground">{workflow.updatedBy || '-'} · {workflow.updatedAt}</p>
                    </div>
                  </div>
                )}
                {workflow.isArchived && (
                  <div className="flex gap-3 border-l-2 border-slate-400 pl-4">
                    <div><p className="font-medium">Archived</p></div>
                  </div>
                )}
                {workflow.isDeleted && (
                  <div className="flex gap-3 border-l-2 border-red-500 pl-4">
                    <div>
                      <p className="font-medium">Soft Deleted</p>
                      <p className="text-muted-foreground">{workflow.deletedBy || '-'} · {workflow.deletedAt || '-'}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
