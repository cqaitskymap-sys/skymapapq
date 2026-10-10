'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DmsPageHeader } from '@/components/dms/dms-page-header';
import { useAuth } from '@/contexts/auth-context';
import { normalizeRole } from '@/lib/permissions';
import { fetchApprovalWorkflowDefinitions, saveApprovalWorkflowDefinition } from '@/lib/document-approval-service';
import type { ApprovalWorkflowDefinition } from '@/lib/document-approval-types';
import { APPROVAL_TYPES } from '@/lib/document-approval-types';
import { PageLoader } from '@/components/loading/loaders';

export function ApprovalWorkflowDesignerPage() {
  const { user, profile } = useAuth();
  const [workflows, setWorkflows] = useState<ApprovalWorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void fetchApprovalWorkflowDefinitions().then((w) => { setWorkflows(w); setLoading(false); });
  }, []);

  const handleSave = async (workflow: ApprovalWorkflowDefinition) => {
    try {
      await saveApprovalWorkflowDefinition(workflow, {
        id: user?.uid || 'anonymous',
        name: profile?.full_name || 'Unknown',
        role: normalizeRole(profile?.role),
      });
      toast.success(`Workflow "${workflow.name}" saved`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed'); }
  };

  if (loading) return <PageLoader message="Loading workflows..." />;

  return (
    <div className="space-y-6 max-w-3xl">
      <DmsPageHeader
        title="Approval Workflow Designer"
        description="Configure sequential, parallel, hybrid, and multi-level approval chains with e-signature requirements"
        trail={[{ label: 'Approval Workflow', href: '/qms/documents/approval-workflow' }, { label: 'Workflows' }]}
      />
      {workflows.map((wf) => (
        <Card key={wf.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span>{wf.name}</span>
              <span className="text-xs font-normal bg-indigo-50 text-indigo-700 rounded-full px-2 py-0.5">{wf.approval_type}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              {wf.steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3 rounded border px-3 py-2 text-sm flex-wrap">
                  <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5">{step.order}</span>
                  <span className="font-medium">{step.name}</span>
                  <span className="text-muted-foreground">{step.role.replace(/_/g, ' ')}</span>
                  {step.mandatory && <span className="text-xs text-red-600">Required</span>}
                  {step.e_signature_required && <span className="text-xs text-indigo-600">E-Sign</span>}
                  <span className="text-xs text-muted-foreground">{step.due_days}d SLA</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <select
                className="rounded-md border px-3 py-2 text-sm"
                value={wf.approval_type}
                onChange={(e) => setWorkflows((prev) => prev.map((w) => w.id === wf.id ? { ...w, approval_type: e.target.value as ApprovalWorkflowDefinition['approval_type'] } : w))}
              >
                {APPROVAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <Button size="sm" onClick={() => void handleSave(wf)}>Save Workflow</Button>
            </div>
          </CardContent>
        </Card>
      ))}
      <Button variant="outline" asChild><Link href="/qms/documents/approval-workflow">Back to Approvals</Link></Button>
    </div>
  );
}
