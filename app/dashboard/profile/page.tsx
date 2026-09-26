'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  EmailAuthProvider, reauthenticateWithCredential, sendEmailVerification, updatePassword,
} from 'firebase/auth';
import { httpsCallable } from '@/lib/callable';
import { toast } from 'sonner';
import { KeyRound, MailCheck, Save, UserCircle } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { getFirebaseFunctions } from '@/lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { recordSecurityEvent } from '@/lib/admin/login-activity-service';

export default function ProfilePage() {
  const { user, profile, loading, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [checkingVerification, setCheckingVerification] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    setFullName(profile?.full_name || '');
    setPhone(profile?.phone || '');
    setEmailVerified(Boolean(user?.emailVerified));
  }, [profile?.full_name, profile?.phone, user?.emailVerified]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (!user || !profile) {
    return <ErrorCard accessDenied title="Profile unavailable" message="Sign in to view your profile." />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = fullName.trim();
    const normalizedPhone = phone.trim();
    if (normalizedName.length < 2 || normalizedName.length > 120) {
      toast.error('Name must be between 2 and 120 characters');
      return;
    }
    if (normalizedPhone.length > 30) {
      toast.error('Phone number is too long');
      return;
    }

    setSaving(true);
    try {
      const updateProfile = httpsCallable<
        { fullName: string; phone: string },
        { fullName: string; phone: string; updatedAt: string }
      >(getFirebaseFunctions(), 'updateOwnUserProfile');
      await updateProfile({ fullName: normalizedName, phone: normalizedPhone });
      await refreshProfile();
      toast.success('Profile updated');
    } catch (error) {
      toast.error((error as Error).message || 'Profile update failed');
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!user.email) {
      toast.error('This account does not have an email sign-in identity');
      return;
    }
    if (
      newPassword.length < 12
      || !/[A-Z]/.test(newPassword)
      || !/[a-z]/.test(newPassword)
      || !/\d/.test(newPassword)
      || !/[^A-Za-z0-9]/.test(newPassword)
    ) {
      toast.error('Use 12+ characters with uppercase, lowercase, number, and special character');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await reauthenticateWithCredential(
        user,
        EmailAuthProvider.credential(user.email, currentPassword),
      );
      await updatePassword(user, newPassword);
      await user.getIdToken(true);
      const recordPasswordChange = httpsCallable<Record<string, never>, { success: boolean }>(
        getFirebaseFunctions(),
        'recordOwnPasswordChange',
      );
      await recordPasswordChange({});
      await recordSecurityEvent('Password Change', {
        email: user.email || undefined,
        riskLevel: 'Medium',
      }).catch(() => undefined);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      toast.success('Password changed successfully');
    } catch (error) {
      toast.error((error as Error).message || 'Password change failed');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleEmailVerification = async () => {
    setSendingVerification(true);
    try {
      await sendEmailVerification(user);
      toast.success('Verification email sent');
    } catch (error) {
      toast.error((error as Error).message || 'Unable to send verification email');
    } finally {
      setSendingVerification(false);
    }
  };

  const handleRefreshVerification = async () => {
    setCheckingVerification(true);
    try {
      await user.reload();
      await user.getIdToken(true);
      const syncVerification = httpsCallable<Record<string, never>, { verified: boolean }>(
        getFirebaseFunctions(),
        'syncOwnEmailVerification',
      );
      const result = await syncVerification({});
      setEmailVerified(result.data.verified);
      if (result.data.verified) toast.success('Email verification confirmed');
      else toast.info('Email is not verified yet');
    } catch (error) {
      toast.error((error as Error).message || 'Unable to refresh verification status');
    } finally {
      setCheckingVerification(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile & Settings</h1>
        <p className="text-muted-foreground">Manage your personal contact information.</p>
      </div>

      <Card className="overflow-hidden rounded-xl shadow-sm">
        <CardHeader className="border-b bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-600 p-3 text-white shadow-lg shadow-blue-600/20">
              <UserCircle className="h-6 w-6" />
            </div>
            <div>
              <CardTitle>{profile.full_name}</CardTitle>
              <Badge variant="outline" className="mt-1 capitalize">
                {profile.role.replace(/_/g, ' ')}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Full name</Label>
              <Input
                id="profile-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                maxLength={120}
                autoComplete="name"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="profile-phone">Phone</Label>
              <Input
                id="profile-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={30}
                autoComplete="tel"
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input value={profile.email} disabled aria-describedby="email-help" />
              <p id="email-help" className="text-xs text-muted-foreground">
                Contact an administrator to change your sign-in email.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Employee ID</Label>
              <Input value={profile.employee_id || '—'} disabled />
            </div>
            <div className="space-y-2">
              <Label>Department</Label>
              <Input value={profile.department || '—'} disabled />
            </div>
            <div className="flex items-end justify-end sm:col-span-2">
              <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-5 w-5" />Authentication Security
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Email verification</p>
              <p className="text-sm text-muted-foreground">
                {emailVerified ? 'Your email address is verified.' : 'Verify your email address to strengthen account recovery.'}
              </p>
            </div>
            {!emailVerified && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handleEmailVerification} disabled={sendingVerification}>
                  <MailCheck className="mr-2 h-4 w-4" />
                  {sendingVerification ? 'Sending…' : 'Send verification'}
                </Button>
                <Button type="button" variant="ghost" onClick={handleRefreshVerification} disabled={checkingVerification}>
                  {checkingVerification ? 'Checking…' : 'Refresh status'}
                </Button>
              </div>
            )}
          </div>

          <form onSubmit={handlePasswordChange} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Minimum 12 characters with uppercase, lowercase, number, and special character.
            </p>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" disabled={changingPassword}>
                {changingPassword ? 'Changing…' : 'Change password'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
