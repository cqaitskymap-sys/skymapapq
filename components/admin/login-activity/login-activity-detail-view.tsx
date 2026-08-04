'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, Shield, Lock, LogOut, Unlock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canManageLoginSessions } from '@/lib/permissions';
import type { LoginActivity } from '@/lib/admin/schemas';
import { terminateSession, unlockAccount } from '@/lib/admin/login-activity-service';

function FieldRow({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm sm:col-span-2 break-all font-mono">
        {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)}
      </span>
    </div>
  );
}

export function LoginActivityDetailView({
  entry,
  onRefresh,
}: {
  entry: LoginActivity;
  onRefresh?: () => void;
}) {
  const { role } = useAdminPermissions();
  const canManage = canManageLoginSessions(role);
  const [reason, setReason] = useState('');
  const [dialog, setDialog] = useState<'terminate' | 'unlock' | null>(null);
  const [loading, setLoading] = useState(false);

  const runAction = async () => {
    if (reason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setLoading(true);
    if (dialog === 'terminate' && entry.id) {
      const result = await terminateSession(entry.id, reason.trim());
      if (result.error) toast.error(result.error);
      else {
        toast.success('Session terminated');
        setDialog(null);
        onRefresh?.();
      }
    }
    if (dialog === 'unlock' && entry.userId) {
      const result = await unlockAccount(entry.userId, reason.trim());
      if (result.error) toast.error(result.error);
      else {
        toast.success('Account unlocked');
        setDialog(null);
        onRefresh?.();
      }
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={entry.loginId || 'Login Record'}
        description={`${entry.userName} · ${entry.eventType || entry.loginStatus}`}
        basePath="/admin"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/login-activity"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin/audit-trail"><Shield className="h-4 w-4 mr-1" />Audit Trail</Link>
            </Button>
            {canManage && entry.status === 'Active' && (
              <Button variant="destructive" size="sm" onClick={() => { setReason(''); setDialog('terminate'); }}>
                <LogOut className="h-4 w-4 mr-1" />Terminate
              </Button>
            )}
            {canManage && (entry.loginStatus === 'Locked' || entry.eventType === 'Account Lock') && entry.userId && (
              <Button variant="outline" size="sm" onClick={() => { setReason(''); setDialog('unlock'); }}>
                <Unlock className="h-4 w-4 mr-1" />Unlock Account
              </Button>
            )}
          </div>
        }
      />

      <Card className="border-amber-200 bg-amber-50/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Lock className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-950">Immutable Login Record — Read Only</p>
            <p className="text-sm text-amber-900/90 mt-1">
              FDA 21 CFR Part 11 / ISO 27001 aligned. Cannot be edited or deleted from this interface.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={entry.loginStatus} />
        <StatusBadge status={entry.status} />
        {entry.riskLevel && (
          <span className="text-xs px-2 py-1 rounded bg-slate-100">{entry.riskLevel} risk</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="Login ID" value={entry.loginId} />
            <FieldRow label="Session ID" value={entry.sessionId} />
            <FieldRow label="User ID" value={entry.userId} />
            <FieldRow label="Employee ID" value={entry.employeeId} />
            <FieldRow label="Username" value={entry.username} />
            <FieldRow label="Full Name" value={entry.fullName || entry.userName} />
            <FieldRow label="Email" value={entry.email} />
            <FieldRow label="Role" value={entry.role} />
            <FieldRow label="Department" value={entry.department} />
            <FieldRow label="Business Unit" value={entry.businessUnit} />
            <FieldRow label="Company" value={entry.company} />
            <FieldRow label="Site" value={entry.site} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Session & Security</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="Login Time" value={entry.loginTime ? new Date(entry.loginTime).toLocaleString() : ''} />
            <FieldRow label="Logout Time" value={entry.logoutTime ? new Date(entry.logoutTime).toLocaleString() : ''} />
            <FieldRow label="Duration (min)" value={entry.sessionDurationMinutes} />
            <FieldRow label="Event Type" value={entry.eventType} />
            <FieldRow label="Failure Reason" value={entry.failureReason} />
            <FieldRow label="Auth Method" value={entry.authenticationMethod} />
            <FieldRow label="MFA Status" value={entry.mfaStatus} />
            <FieldRow label="Remember Me" value={entry.rememberMe} />
            <FieldRow label="Risk Level" value={entry.riskLevel} />
            <FieldRow label="Terminated By" value={entry.terminatedBy} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Device & Network</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <FieldRow label="Device Name" value={entry.deviceName} />
            <FieldRow label="Device Type" value={entry.deviceType} />
            <FieldRow label="Browser" value={`${entry.browser} ${entry.browserVersion}`.trim()} />
            <FieldRow label="Operating System" value={entry.operatingSystem} />
            <FieldRow label="IP Address" value={entry.ipAddress} />
            <FieldRow label="MAC Address" value={entry.macAddress} />
            <FieldRow label="Geo Location" value={entry.geoLocation} />
            <FieldRow label="Device Fingerprint" value={entry.deviceFingerprint} />
            <div className="md:col-span-2">
              <FieldRow label="Raw Device Info" value={entry.deviceInfo} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(dialog)} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === 'unlock' ? 'Unlock Account' : 'Terminate Session'}</DialogTitle>
            <DialogDescription>This action is audited. Provide a change reason.</DialogDescription>
          </DialogHeader>
          <div>
            <Label>Change reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Cancel</Button>
            <Button variant={dialog === 'terminate' ? 'destructive' : 'default'} onClick={runAction} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
