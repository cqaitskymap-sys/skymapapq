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
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { RiskBadge } from './risk-badge';
import { DepartmentBadge } from './department-badge';
import { ApprovalFlowPreview } from './approval-flow-preview';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditApprovalMatrix } from '@/lib/permissions';
import type { ApprovalMatrix } from '@/lib/admin/schemas';
import {
  fetchApprovalMatrixById, fetchApprovalMatrixAuditTrail, isMatrixActive,
  countLinkedMatrixUsage, exportApprovalMatricesCsv, buildApprovalFlow,
} from '@/lib/admin/approval-matrix-service';

const INTEGRATION_MODULES = [
  'Document Management', 'CAPA', 'Deviation', 'Change Control',
  'Risk Management', 'Audit', 'Validation', 'Qualification', 'Equipment',
  'Calibration', 'Maintenance', 'Complaint', 'Supplier Qualification',
  'PQR', 'CPV', 'OOS', 'eBMR', 'DMS', 'Stability', 'Recall', 'CSV',
];

export function ApprovalMatrixDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { role } = useAdminPermissions();
  const canEdit = canEditApprovalMatrix(role);

  const [matrix, setMatrix] = useState<ApprovalMatrix | null>(null);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [linkedCount, setLinkedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await fetchApprovalMatrixById(id, true);
      if (!m) {
        setError('Approval matrix not found');
        return;
      }
      setMatrix(m);
      setAuditTrail(await fetchApprovalMatrixAuditTrail(id));
      setLinkedCount(await countLinkedMatrixUsage(m.approvalMatrixId || m.matrixId || id, m.matrixCode));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !matrix) return <ErrorCard title="Not Found" message={error || 'Matrix not found'} />;

  const overviewFields = [
    { label: 'Matrix ID', value: matrix.approvalMatrixId || matrix.matrixId },
    { label: 'Matrix Code', value: matrix.matrixCode },
    { label: 'Module', value: matrix.moduleName },
    { label: 'Sub Module', value: matrix.subModule },
    { label: 'Department', value: matrix.department },
    { label: 'Site / Location', value: matrix.siteLocation },
    { label: 'Business Unit', value: matrix.businessUnit },
    { label: 'Workflow Code', value: matrix.workflowCode },
    { label: 'Document Type', value: matrix.documentType },
    { label: 'Category', value: matrix.category },
    { label: 'Priority', value: matrix.priority },
    { label: 'Risk Level', value: matrix.riskLevel },
    { label: 'Approval Mode', value: matrix.approvalMode },
    { label: 'Version', value: matrix.matrixVersion },
    { label: 'Product', value: matrix.productOptional || 'All' },
    { label: 'Process', value: matrix.processOptional },
    { label: 'Min Approval Level', value: matrix.minimumApprovalLevel },
    { label: 'Approval Group', value: matrix.approvalGroup },
    { label: 'Quorum Count', value: matrix.quorumCount },
    { label: 'SLA Hours', value: matrix.slaHours },
    { label: 'Reminder Hours', value: matrix.reminderHours },
    { label: 'Auto Escalation Hours', value: matrix.autoEscalationHours },
    { label: 'Escalation Role', value: matrix.escalationRole?.replace(/_/g, ' ') },
    { label: 'Effective Date', value: matrix.effectiveDate },
    { label: 'Review Date', value: matrix.reviewDate },
    { label: 'Created By', value: matrix.createdBy },
    { label: 'Created At', value: matrix.createdAt },
    { label: 'Updated By', value: matrix.updatedBy },
    { label: 'Updated At', value: matrix.updatedAt },
  ];

  const approvalLevels = buildApprovalFlow(matrix);

  const handleExport = () => {
    const csv = exportApprovalMatricesCsv([matrix]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `approval-matrix-${matrix.matrixCode}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Approval matrix exported');
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/approval-matrix')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Approval Matrix
      </Button>

      <PageHeader
        title={matrix.matrixName}
        description={matrix.approvalMatrixId || matrix.matrixCode}
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/workflows"><GitBranch className="h-4 w-4 mr-1" />Workflows</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canEdit && !matrix.isDeleted && (
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/approval-matrix/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Matrix</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <ModuleBadge module={matrix.moduleName} />
        <DepartmentBadge department={matrix.department} />
        <RiskBadge risk={matrix.riskLevel} />
        <StatusBadge status={matrix.isDeleted ? 'Deleted' : matrix.status} />
        {matrix.isArchived && <Badge variant="outline" className="text-amber-700 border-amber-300">Archived</Badge>}
        {!isMatrixActive(matrix) && !matrix.isDeleted && (
          <Badge variant="secondary">Not active for new records</Badge>
        )}
        {matrix.workflowCode && (
          <Badge variant="outline">Workflow: {matrix.workflowCode}</Badge>
        )}
        {linkedCount > 0 && (
          <Badge variant="secondary"><Link2 className="h-3 w-3 mr-1" />{linkedCount} linked record(s)</Badge>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="levels">Approval Levels</TabsTrigger>
          <TabsTrigger value="conditions">Conditions</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Matrix Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {overviewFields.map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium break-words">{String(f.value ?? '-')}</p>
                </div>
              ))}
              {matrix.description && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{matrix.description}</p>
                </div>
              )}
              {matrix.remarks && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{matrix.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="levels" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Approval Authority</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              {[
                { label: 'Prepared By', value: matrix.preparedByRole },
                { label: 'Reviewed By', value: matrix.reviewedByRole },
                { label: 'Verified By', value: matrix.verifiedByRole },
                { label: 'Approved By', value: matrix.approvedByRole },
                { label: 'Final Approver', value: matrix.finalApproverRole },
                { label: 'Escalation Role', value: matrix.escalationRole },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">
                    {f.value ? f.value.split(',').map((r) => r.trim().replace(/_/g, ' ')).join(' · ') : '-'}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Approval Flow ({approvalLevels.length} levels)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {approvalLevels.length === 0 ? (
                <EmptyState title="No approval levels configured" />
              ) : (
                approvalLevels.map((level, idx) => (
                  <div key={level.label} className="border rounded-lg p-3 text-sm flex flex-wrap gap-2 justify-between">
                    <div>
                      <span className="font-mono text-xs text-muted-foreground mr-2">#{idx + 1}</span>
                      <span className="font-medium">{level.label}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {level.roles.split(',').map((r) => r.trim().replace(/_/g, ' ')).join(' · ')}
                    </div>
                  </div>
                ))
              )}
              <div className="pt-2">
                <ApprovalFlowPreview matrix={matrix} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conditions" className="mt-4">
          <Card>
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: 'E-Signature Required', value: matrix.eSignatureRequired },
                { label: 'Digital Signature Required', value: matrix.digitalSignatureRequired },
                { label: 'Comment Required', value: matrix.approvalCommentRequired },
                { label: 'Parallel Approval', value: matrix.parallelApprovalAllowed },
                { label: 'Sequential Approval', value: matrix.sequentialApprovalRequired },
                { label: 'Conditional Approval', value: matrix.conditionalApprovalEnabled },
                { label: 'Delegation Allowed', value: matrix.delegationAllowed },
                { label: 'Allow Reject', value: matrix.allowReject },
                { label: 'Allow Return', value: matrix.allowReturn },
                { label: 'Allow Rework', value: matrix.allowRework },
                { label: 'Allow Resubmit', value: matrix.allowResubmit },
                { label: 'Allow Cancel', value: matrix.allowCancel },
                { label: 'Allow Skip', value: matrix.allowSkip },
                { label: 'Auto Escalation', value: matrix.autoEscalationEnabled },
                { label: 'Auto Approve', value: matrix.autoApproveEnabled },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{f.value ? 'Yes' : 'No'}</p>
                </div>
              ))}
              {matrix.conditionExpression && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Condition Expression</p>
                  <p className="font-mono text-xs bg-slate-50 p-3 rounded mt-1">{matrix.conditionExpression}</p>
                </div>
              )}
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
                Active matrices are resolved via <code className="text-xs">fetchActiveMatrixForModule</code>.
                Linked records: {linkedCount}.
                {matrix.workflowCode && (
                  <> Linked workflow code: <code className="text-xs">{matrix.workflowCode}</code>.</>
                )}
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {INTEGRATION_MODULES.map((mod) => {
                  const active = matrix.moduleName === mod
                    || (mod === 'Document Management' && matrix.moduleName === 'DMS')
                    || (mod === 'CPV' && matrix.moduleName === 'CPV Annual Review');
                  return (
                    <div key={mod} className={`border rounded-lg p-3 text-sm ${active ? 'border-blue-300 bg-blue-50' : 'opacity-60'}`}>
                      <p className="font-medium">{mod}</p>
                      <p className="text-xs text-muted-foreground">{active ? 'Primary module' : 'Available'}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState title="No audit entries" />
              ) : (
                <div className="space-y-2">
                  {auditTrail.map((entry, i) => (
                    <div key={String(entry.id ?? i)} className="flex flex-col sm:flex-row sm:items-center gap-1 p-2 border rounded text-sm">
                      <span className="font-medium">{String(entry.action ?? '-')}</span>
                      <span className="text-xs text-muted-foreground">
                        {String(entry.userName ?? entry.actorName ?? '-')} · {String(entry.timestamp ?? entry.dateTime ?? '-')}
                      </span>
                      {entry.reason ? (
                        <span className="text-xs text-muted-foreground sm:ml-auto">{String(entry.reason)}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Change History</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Created</p>
                  <p className="font-medium">{matrix.createdBy || '-'} · {matrix.createdAt || '-'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Last Updated</p>
                  <p className="font-medium">{matrix.updatedBy || '-'} · {matrix.updatedAt || '-'}</p>
                </div>
                {matrix.clonedFrom && (
                  <div>
                    <p className="text-xs text-muted-foreground">Cloned From</p>
                    <p className="font-medium font-mono text-xs">{matrix.clonedFrom}</p>
                  </div>
                )}
                {matrix.isDeleted && (
                  <div>
                    <p className="text-xs text-muted-foreground">Deleted</p>
                    <p className="font-medium">{matrix.deletedBy || '-'} · {matrix.deletedAt || '-'}</p>
                  </div>
                )}
              </div>
              {auditTrail.length > 0 ? (
                <div className="border-t pt-3 space-y-2">
                  {auditTrail.slice(0, 10).map((entry, i) => (
                    <div key={`hist-${String(entry.id ?? i)}`} className="text-xs text-muted-foreground">
                      {String(entry.timestamp ?? entry.dateTime ?? '-')} — {String(entry.action ?? '-')} by {String(entry.userName ?? entry.actorName ?? '-')}
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No history entries" />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
