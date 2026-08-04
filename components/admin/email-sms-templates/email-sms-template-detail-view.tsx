'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Send, UserCheck, UserX, History, CheckCircle2, Archive } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditEmailSmsTemplates, canApproveEmailSmsTemplates } from '@/lib/permissions';
import type { EmailSmsTemplate } from '@/lib/admin/schemas';
import {
  setEmailSmsTemplateStatus, transitionEmailSmsTemplate,
  previewTemplateLocally, previewEmailSmsTemplateRemote,
} from '@/lib/admin/email-sms-templates-service';

interface EmailSmsTemplateDetailViewProps {
  template: EmailSmsTemplate;
  onRefresh: () => void;
}

export function EmailSmsTemplateDetailView({ template, onRefresh }: EmailSmsTemplateDetailViewProps) {
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditEmailSmsTemplates(role);
  const canApprove = canApproveEmailSmsTemplates(role);
  const [loading, setLoading] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const preview = previewTemplateLocally(template);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const toggleStatus = async () => {
    setLoading(true);
    const activate = template.status !== 'Active';
    const result = await setEmailSmsTemplateStatus(
      template.id!,
      activate ? 'Active' : 'Inactive',
      auditMeta,
      activate ? 'Activated via detail' : 'Deactivated via detail',
    );
    setLoading(false);
    if (result.success) {
      toast.success(activate ? 'Template activated' : 'Template deactivated');
      onRefresh();
    } else toast.error(result.error || 'Action failed');
    setConfirmDeactivate(false);
  };

  const runTransition = async (approvalStatus: string) => {
    setLoading(true);
    const result = await transitionEmailSmsTemplate(
      template.id!,
      approvalStatus,
      auditMeta,
      `Transition to ${approvalStatus}`,
    );
    setLoading(false);
    if (result.success) {
      toast.success(`Template set to ${approvalStatus}`);
      onRefresh();
    } else toast.error(result.error || 'Transition failed');
  };

  const runTest = async () => {
    setLoading(true);
    const result = await previewEmailSmsTemplateRemote(template.id!, true);
    setLoading(false);
    if (result.error) toast.error(result.error);
    else toast.success(`Test preview logged (${result.smsLength} SMS chars)`);
  };

  const widthClass = previewMode === 'mobile' ? 'max-w-sm' : previewMode === 'tablet' ? 'max-w-md' : 'max-w-2xl';

  return (
    <div className="space-y-6">
      <PageHeader
        title={template.templateCode}
        description={`${template.templateName} · ${template.templateType} · v${template.version || 1}`}
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/email-sms-templates/${template.id}/versions`}>
                <History className="h-4 w-4 mr-1" />Versions
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={runTest} disabled={loading}>
              <Send className="h-4 w-4 mr-1" />Test Preview
            </Button>
            {canEdit && template.approvalStatus === 'Draft' && (
              <Button variant="outline" size="sm" disabled={loading} onClick={() => runTransition('Under Review')}>
                Submit Review
              </Button>
            )}
            {canApprove && template.approvalStatus === 'Under Review' && (
              <Button variant="outline" size="sm" disabled={loading} onClick={() => runTransition('Approved')}>
                <CheckCircle2 className="h-4 w-4 mr-1" />Approve
              </Button>
            )}
            {canApprove && (template.approvalStatus === 'Approved' || template.approvalStatus === 'Under Review') && (
              <Button size="sm" className="bg-sky-600 hover:bg-sky-700" disabled={loading} onClick={() => runTransition('Published')}>
                Publish
              </Button>
            )}
            {canEdit && template.approvalStatus === 'Published' && (
              <Button variant="outline" size="sm" disabled={loading} onClick={() => runTransition('Archived')}>
                <Archive className="h-4 w-4 mr-1" />Archive
              </Button>
            )}
            {canEdit && (
              <>
                {template.status === 'Active' ? (
                  <Button variant="outline" size="sm" onClick={() => setConfirmDeactivate(true)} disabled={loading}>
                    <UserX className="h-4 w-4 mr-1" />Deactivate
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={toggleStatus} disabled={loading}>
                    <UserCheck className="h-4 w-4 mr-1" />Activate
                  </Button>
                )}
                <Button size="sm" asChild className="bg-sky-600 hover:bg-sky-700">
                  <Link href={`/admin/email-sms-templates/${template.id}/edit`}>
                    <Pencil className="h-4 w-4 mr-1" />Edit
                  </Link>
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={template.status} />
        <StatusBadge status={template.approvalStatus || 'Draft'} />
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{template.templateType}</span>
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{template.category}</span>
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{template.language}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Configuration</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <span className="text-muted-foreground">Template ID</span><span className="font-mono text-xs">{template.templateId}</span>
            <span className="text-muted-foreground">Module</span><span>{template.module}</span>
            <span className="text-muted-foreground">Sub Module</span><span>{template.subModule || '—'}</span>
            <span className="text-muted-foreground">Workflow</span><span>{template.workflow || '—'}</span>
            <span className="text-muted-foreground">Priority</span><span>{template.priority}</span>
            <span className="text-muted-foreground">Version</span><span>v{template.version || 1}</span>
            <span className="text-muted-foreground">Effective</span><span>{template.effectiveDate || '—'}</span>
            <span className="text-muted-foreground">Review / Expiry</span>
            <span>{template.reviewDate || '—'} / {template.expiryDate || '—'}</span>
            <span className="text-muted-foreground">Placeholders</span>
            <span className="text-xs col-span-1">{(template.placeholders || []).join(', ') || '—'}</span>
            <span className="text-muted-foreground">Site / Dept</span>
            <span>{template.site || '—'} / {template.department || '—'}</span>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Preview</CardTitle>
              <div className="flex gap-1">
                {(['desktop', 'tablet', 'mobile'] as const).map((m) => (
                  <Button
                    key={m}
                    size="sm"
                    variant={previewMode === m ? 'default' : 'outline'}
                    className={previewMode === m ? 'bg-sky-600 hover:bg-sky-700 h-7 text-xs' : 'h-7 text-xs'}
                    onClick={() => setPreviewMode(m)}
                  >
                    {m}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className={`mx-auto border rounded-lg p-4 bg-white dark:bg-slate-950 ${widthClass}`}>
              {template.templateType !== 'SMS' && (
                <p className="font-semibold text-sm mb-2 border-b pb-2">{preview.subject || '—'}</p>
              )}
              <pre className="whitespace-pre-wrap text-xs">
                {template.templateType === 'SMS' ? preview.smsBody : preview.body}
              </pre>
              {template.templateType === 'SMS' && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  {preview.smsLength} chars · {Math.ceil(preview.smsLength / 160) || 1} SMS part(s)
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate template?</AlertDialogTitle>
            <AlertDialogDescription>
              Inactive templates will not be resolved for production notifications until reactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={toggleStatus}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
