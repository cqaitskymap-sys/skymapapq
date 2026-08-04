'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { EsignSettingsAccessGuard } from '@/components/admin/esign-settings/esign-settings-access-guard';
import { EsignSettingForm } from '@/components/admin/esign-settings/esign-setting-form';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditEsignSettings } from '@/lib/permissions';
import { fetchEsignSettingById, updateEsignSetting } from '@/lib/admin/esign-settings-service';
import type { EsignSettings, EsignSettingFormData } from '@/lib/admin/schemas';

function EditEsignSettingContent() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [setting, setSetting] = useState<EsignSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const record = await fetchEsignSettingById(id);
      if (!record) setError('E-signature setting not found');
      setSetting(record);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!canEditEsignSettings(role)) {
    return <ErrorCard accessDenied message="You do not have permission to edit e-signature settings." />;
  }

  if (loading) return <LoadingSkeleton rows={3} />;
  if (error || !setting) return <ErrorCard message={error || 'Not found'} onRetry={load} />;

  const initial: Partial<EsignSettingFormData> = {
    settingCode: setting.settingCode,
    moduleName: setting.moduleName,
    actionType: setting.actionType,
    moduleAliases: (setting.moduleAliases || []).join(', '),
    actionAliases: (setting.actionAliases || []).join(', '),
    signatureMeaning: setting.signatureMeaning,
    requirePasswordReAuthentication: setting.requirePasswordReAuthentication,
    requireCommentReason: setting.requireCommentReason,
    requireRoleVerification: setting.requireRoleVerification,
    requireDepartmentVerification: setting.requireDepartmentVerification,
    requireActiveSession: setting.requireActiveSession,
    sessionTimeoutMinutes: setting.sessionTimeoutMinutes,
    maxFailedEsignAttempts: setting.maxFailedEsignAttempts,
    lockAccountAfterFailedAttempts: setting.lockAccountAfterFailedAttempts,
    allowDelegatedSignature: setting.allowDelegatedSignature,
    requireFinalApprovalSignature: setting.requireFinalApprovalSignature,
    showSignatureStatement: setting.showSignatureStatement,
    signatureStatementText: setting.signatureStatementText,
    allowedRoles: (setting.allowedRoles || []).join(', '),
    allowedDepartments: (setting.allowedDepartments || []).join(', '),
    remarks: setting.remarks,
    changeReason: '',
  };

  const onSubmit = async (data: EsignSettingFormData) => {
    setSubmitting(true);
    const result = await updateEsignSetting(id, data, setting, {
      userId: user?.uid || 'system',
      userName: profile?.full_name || profile?.email || 'Admin',
    });
    setSubmitting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success('E-signature setting updated');
    router.push(`/admin/esign-settings/${id}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Edit E-Signature Setting" description={setting.settingCode} basePath="/admin" />
      <EsignSettingForm
        initial={initial}
        onSubmit={onSubmit}
        onCancel={() => router.push(`/admin/esign-settings/${id}`)}
        submitting={submitting}
      />
    </div>
  );
}

export default function EditEsignSettingPage() {
  return (
    <EsignSettingsAccessGuard>
      <EditEsignSettingContent />
    </EsignSettingsAccessGuard>
  );
}
