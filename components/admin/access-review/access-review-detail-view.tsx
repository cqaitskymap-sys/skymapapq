'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Shield, Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  canManageAccessReview, canCompleteAccessReview,
} from '@/lib/permissions';
import {
  ACCESS_REVIEW_DECISIONS, ACCESS_REVIEW_RECOMMENDATIONS,
} from '@/lib/admin/constants';
import type { AccessReview } from '@/lib/admin/schemas';
import {
  transitionAccessReview, completeAccessReview, updateAccessReview,
} from '@/lib/admin/access-review-service';

function FieldRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm sm:col-span-2 break-all">
        {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
      </span>
    </div>
  );
}

const WORKFLOW_ACTIONS: Array<{ label: string; status: string }> = [
  { label: 'Start Review', status: 'In Progress' },
  { label: 'Self Review', status: 'Self Review' },
  { label: 'Manager Review', status: 'Manager Review' },
  { label: 'QA Review', status: 'QA Review' },
  { label: 'IT Review', status: 'IT Review' },
  { label: 'Submit for Approval', status: 'Pending Approval' },
  { label: 'Request Changes', status: 'Changes Requested' },
  { label: 'Reject', status: 'Rejected' },
  { label: 'Close', status: 'Closed' },
  { label: 'Reopen', status: 'Pending' },
];

export function AccessReviewDetailView({
  entry,
  onRefresh,
}: {
  entry: AccessReview;
  onRefresh?: () => void;
}) {
  const { role } = useAdminPermissions();
  const canManage = canManageAccessReview(role);
  const canComplete = canCompleteAccessReview(role);
  const locked = Boolean(entry.immutable) || ['Completed', 'Archived'].includes(entry.reviewStatus);

  const [reason, setReason] = useState('');
  const [comments, setComments] = useState(entry.reviewComments || '');
  const [recommendation, setRecommendation] = useState(entry.recommendation || '');
  const [decision, setDecision] = useState(entry.finalDecision || 'Maintain Access');
  const [dialog, setDialog] = useState<'transition' | 'complete' | 'save' | null>(null);
  const [targetStatus, setTargetStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const runTransition = async () => {
    if (!entry.id || reason.trim().length < 5) {
      toast.error('Change reason required (min 5 characters)');
      return;
    }
    setLoading(true);
    const result = await transitionAccessReview(entry.id, targetStatus, reason.trim(), comments);
    setLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success(`Moved to ${targetStatus}`);
      setDialog(null);
      onRefresh?.();
    }
  };

  const runComplete = async () => {
    if (!entry.id || reason.trim().length < 5 || comments.trim().length < 5) {
      toast.error('Comments and change reason are required');
      return;
    }
    setLoading(true);
    const result = await completeAccessReview({
      id: entry.id,
      changeReason: reason.trim(),
      reviewComments: comments.trim(),
      recommendation: recommendation || 'No Change',
      finalDecision: decision,
      signatureMeaning: 'I have reviewed this user access and attest the decision is accurate',
      requirePassword: false,
    });
    setLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Review completed with electronic signature');
      setDialog(null);
      onRefresh?.();
    }
  };

  const runSave = async () => {
    if (!entry.id || reason.trim().length < 5) {
      toast.error('Change reason required');
      return;
    }
    setLoading(true);
    const result = await updateAccessReview({
      id: entry.id,
      changeReason: reason.trim(),
      findings: entry.findings,
      reviewComments: comments,
      recommendation,
      finalDecision: decision,
      actionTaken: entry.actionTaken,
    });
    setLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Review updated');
      setDialog(null);
      onRefresh?.();
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={entry.reviewId || 'Access Review'}
        description={`${entry.userName} · ${entry.reviewPeriod} · ${entry.reviewStatus}`}
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/user-access-review"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail"><Shield className="h-4 w-4 mr-1" />Audit Trail</Link>
            </Button>
            {entry.userId && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/users/${entry.userId}`}>User Master</Link>
              </Button>
            )}
            {canManage && !locked && (
              <>
                <Button variant="outline" size="sm" onClick={() => { setReason(''); setDialog('save'); }}>
                  Save Comments
                </Button>
                {WORKFLOW_ACTIONS.map((a) => (
                  <Button
                    key={a.status}
                    variant="outline"
                    size="sm"
                    onClick={() => { setTargetStatus(a.status); setReason(''); setDialog('transition'); }}
                  >
                    {a.label}
                  </Button>
                ))}
              </>
            )}
            {canComplete && !locked && (
              <Button size="sm" onClick={() => { setReason(''); setDialog('complete'); }}>
                <CheckCircle2 className="h-4 w-4 mr-1" />Complete + E-Sign
              </Button>
            )}
          </div>
        }
      />

      {locked && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardContent className="p-4 flex items-start gap-3">
            <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-950">Immutable Completed Review</p>
              <p className="text-sm text-amber-900/90 mt-1">
                This record is locked. Electronic signature and audit trail preserve Part 11 integrity.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={entry.reviewStatus} />
        <StatusBadge status={entry.status} />
        {entry.riskLevel && (
          <span className="text-xs px-2 py-1 rounded bg-slate-100">{entry.riskLevel} risk</span>
        )}
        {entry.privileged && (
          <span className="text-xs px-2 py-1 rounded bg-red-50 text-red-700">Privileged</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Subject User</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="Review ID" value={entry.reviewId} />
            <FieldRow label="Review Number" value={entry.reviewNumber} />
            <FieldRow label="User ID" value={entry.userId} />
            <FieldRow label="Employee ID" value={entry.employeeId} />
            <FieldRow label="Username" value={entry.username} />
            <FieldRow label="Employee Name" value={entry.employeeName || entry.userName} />
            <FieldRow label="Email" value={entry.email} />
            <FieldRow label="Department" value={entry.department} />
            <FieldRow label="Designation" value={entry.designation} />
            <FieldRow label="Role" value={entry.role} />
            <FieldRow label="Business Unit" value={entry.businessUnit} />
            <FieldRow label="Company" value={entry.company} />
            <FieldRow label="Site" value={entry.site} />
            <FieldRow label="Manager" value={entry.manager} />
            <FieldRow label="Account Status" value={entry.accountStatus} />
            <FieldRow label="Access Status" value={entry.accessStatus} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Review & Decision</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="Reviewer" value={entry.reviewerName} />
            <FieldRow label="Reviewer Role" value={entry.reviewerRole} />
            <FieldRow label="Period" value={entry.reviewPeriod} />
            <FieldRow label="Review Date" value={entry.reviewDate} />
            <FieldRow label="Due Date" value={entry.dueDate} />
            <FieldRow label="Completion Date" value={entry.completionDate} />
            <FieldRow label="Next Review" value={entry.nextReviewDate} />
            <FieldRow label="Recommendation" value={entry.recommendation} />
            <FieldRow label="Final Decision" value={entry.finalDecision} />
            <FieldRow label="Signed By" value={entry.signedBy} />
            <FieldRow label="Signed At" value={entry.signedAt} />
            <FieldRow label="Signature Meaning" value={entry.signatureMeaning} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Findings & Comments</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <FieldRow label="Findings" value={entry.findings} />
            <FieldRow label="Action Taken" value={entry.actionTaken} />
            <FieldRow label="Comments" value={entry.reviewComments} />
            {(entry.issues || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Issues / SoD</p>
                {(entry.issues || []).map((issue, idx) => (
                  <div key={`${issue.code}-${idx}`} className="text-sm border rounded-md p-2 bg-slate-50">
                    <span className="font-mono text-xs mr-2">{issue.code}</span>
                    <StatusBadge status={issue.severity} />
                    <p className="mt-1">{issue.message}</p>
                  </div>
                ))}
              </div>
            )}
            {!locked && canManage && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div>
                  <Label>Review comments</Label>
                  <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={3} />
                </div>
                <div className="space-y-3">
                  <div>
                    <Label>Recommendation</Label>
                    <Select value={recommendation || 'No Change'} onValueChange={setRecommendation}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACCESS_REVIEW_RECOMMENDATIONS.map((r) => (
                          <SelectItem key={r} value={r}>{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Final decision</Label>
                    <Select value={decision} onValueChange={setDecision}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ACCESS_REVIEW_DECISIONS.map((d) => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(dialog)} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'complete' ? 'Complete with Electronic Signature' : dialog === 'save' ? 'Save Review' : `Transition → ${targetStatus}`}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'complete'
                ? 'Attests your review decision. Completed records become immutable.'
                : 'This action is audited. Provide a change reason.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {dialog === 'complete' && (
              <>
                <div>
                  <Label>Comments (required)</Label>
                  <Textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2} />
                </div>
                <div>
                  <Label>Recommendation</Label>
                  <Input value={recommendation} onChange={(e) => setRecommendation(e.target.value)} />
                </div>
                <div>
                  <Label>Final decision</Label>
                  <Select value={decision} onValueChange={setDecision}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCESS_REVIEW_DECISIONS.map((d) => (
                        <SelectItem key={d} value={d}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
            <div>
              <Label>Change reason</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (dialog === 'complete') void runComplete();
                else if (dialog === 'save') void runSave();
                else void runTransition();
              }}
              disabled={loading}
            >
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
