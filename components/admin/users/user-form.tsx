'use client';

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ADMIN_ROLES, USER_STATUSES } from '@/lib/admin/constants';
import { adminUserSchema, type AdminUser } from '@/lib/admin/schemas';
import { fetchUserMasters } from '@/lib/admin/user-service';
import { UserAccessControl } from '@/components/admin/users/user-access-control';
import { emptyPermissionMatrix, type PermissionMatrixData } from '@/lib/permission-presets';
import { getUserPermissionRecord } from '@/services/permissionService';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';

const GENDER_VALUES = ['', 'Female', 'Male', 'Non-binary', 'Prefer not to say'] as const;
const EMPLOYMENT_VALUES = ['Permanent', 'Contract', 'Temporary', 'Consultant', 'Vendor', 'Intern'] as const;

function asText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function asDateInput(value: unknown): string {
  if (value == null || value === '') return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10);
  const usDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usDate) {
    const [, month, day, year] = usDate;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

function toUserFormValues(user?: AdminUser | null): Partial<AdminUser> {
  const gender = asText(user?.gender);
  const employmentType = asText(user?.employmentType) || 'Permanent';
  return {
    id: user?.id,
    authUid: user?.authUid,
    userId: user?.userId,
    employeeId: asText(user?.employeeId),
    employeeCode: asText(user?.employeeCode),
    firstName: asText(user?.firstName),
    middleName: asText(user?.middleName),
    lastName: asText(user?.lastName),
    fullName: asText(user?.fullName),
    email: asText(user?.email),
    mobileNumber: asText(user?.mobileNumber),
    alternateMobile: asText(user?.alternateMobile),
    username: asText(user?.username),
    profilePhoto: asText(user?.profilePhoto),
    gender: (GENDER_VALUES as readonly string[]).includes(gender)
      ? gender as AdminUser['gender']
      : '',
    dateOfBirth: asDateInput(user?.dateOfBirth),
    department: asText(user?.department),
    designation: asText(user?.designation),
    role: asText(user?.role) || 'qa_executive',
    reportingManager: asText(user?.reportingManager),
    managerId: asText(user?.managerId),
    businessUnit: asText(user?.businessUnit),
    siteId: asText(user?.siteId),
    siteName: asText(user?.siteName),
    location: asText(user?.location),
    shift: asText(user?.shift),
    employmentType: (EMPLOYMENT_VALUES as readonly string[]).includes(employmentType)
      ? employmentType as AdminUser['employmentType']
      : 'Permanent',
    joiningDate: asDateInput(user?.joiningDate),
    remarks: asText(user?.remarks),
    userStatus: user?.userStatus || 'Active',
    accountLocked: Boolean(user?.accountLocked),
    passwordResetRequired: Boolean(user?.passwordResetRequired),
    twoFactorEnabled: Boolean(user?.twoFactorEnabled),
    status: user?.userStatus === 'Active' || !user ? 'Active' : 'Inactive',
  };
}

export interface UserFormSubmitOptions {
  tempPassword?: string;
  modulePermissions?: PermissionMatrixData;
  presetId?: string;
  changeReason?: string;
}

interface UserFormProps {
  initial?: AdminUser | null;
  isCreate?: boolean;
  readOnly?: boolean;
  onSubmit: (data: AdminUser, options?: UserFormSubmitOptions) => Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
}

export function UserForm({
  initial,
  isCreate,
  readOnly,
  onSubmit,
  onCancel,
  submitting,
}: UserFormProps) {
  const { role: currentRole } = useAdminPermissions();
  const [tempPassword, setTempPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const formValues = useMemo(() => toUserFormValues(initial), [initial]);
  const [modulePermissions, setModulePermissions] = useState<PermissionMatrixData>(emptyPermissionMatrix());
  const [presetId, setPresetId] = useState('');
  const [accessDirty, setAccessDirty] = useState(false);
  const [masters, setMasters] = useState<{
    departments: { id?: string; departmentName: string; departmentCode: string; status?: string }[];
    designations: { id?: string; designationName: string; designationCode: string; department: string; status?: string }[];
    sites: {
      id?: string; companyName?: string; siteName: string; siteCode?: string;
      plantAddress?: string; city?: string; state?: string; country?: string;
    }[];
    managers: AdminUser[];
  }>({ departments: [], designations: [], sites: [], managers: [] });

  const form = useForm<AdminUser>({
    resolver: zodResolver(adminUserSchema),
    defaultValues: formValues,
  });

  useEffect(() => {
    fetchUserMasters().then((m) => setMasters(m));
  }, []);

  useEffect(() => {
    form.reset(formValues);
  }, [formValues, form]);

  useEffect(() => {
    const uid = initial?.authUid || initial?.id;
    if (!uid) return;
    getUserPermissionRecord(uid).then((perms) => {
      if (perms?.customPermissions) {
        setModulePermissions(perms.customPermissions);
        setPresetId(perms.presetId || '');
      } else if (perms?.modulePermissions) {
        setModulePermissions(perms.modulePermissions);
        setPresetId(perms.presetId || '');
      }
      setAccessDirty(false);
    });
  }, [initial?.authUid, initial?.id]);

  const deptDesignations = masters.designations.filter(
    (d) => (d.status === 'Active' || !d.status) &&
      (!form.watch('department') || d.department === form.watch('department')),
  );

  const firstFormError = Object.values(form.formState.errors)
    .map((error) => error?.message)
    .find(Boolean);

  const handleSubmit = form.handleSubmit(async (data) => {
    if (isCreate && (
      tempPassword.length < 12
      || !/[A-Z]/.test(tempPassword)
      || !/[a-z]/.test(tempPassword)
      || !/\d/.test(tempPassword)
      || !/[^A-Za-z0-9]/.test(tempPassword)
    )) {
      setPasswordError('Use 12+ characters with uppercase, lowercase, number, and special character.');
      toast.error('Temporary password does not meet the required policy.');
      return;
    }
    if (!isCreate && changeReason.trim().length < 8) {
      setReasonError('Enter at least 8 characters explaining this change.');
      toast.error('Reason for Change is required before saving.');
      document.getElementById('changeReason')?.focus();
      return;
    }
    if (data.profilePhoto && !/^https:\/\//i.test(data.profilePhoto)
      && data.profilePhoto !== asText(initial?.profilePhoto)) {
      form.setError('profilePhoto', { type: 'manual', message: 'Profile picture URL must use HTTPS' });
      toast.error('Profile picture URL must use HTTPS.');
      return;
    }
    setPasswordError('');
    setReasonError('');
    await onSubmit(data, {
      tempPassword: isCreate ? tempPassword : undefined,
      modulePermissions: currentRole === 'super_admin' && (isCreate || accessDirty)
        ? modulePermissions
        : undefined,
      presetId: currentRole === 'super_admin' && (isCreate || accessDirty)
        ? presetId || undefined
        : undefined,
      changeReason: isCreate ? undefined : changeReason.trim(),
    });
  }, (errors) => {
    const message = Object.values(errors).map((error) => error?.message).find(Boolean)
      || 'Please fix the highlighted fields before saving.';
    toast.error(String(message));
  });

  const detailsForm = (
    <div className="space-y-6">
      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Identity and contact</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="employeeId">Employee ID *</Label>
            <Input id="employeeId" {...form.register('employeeId')} disabled={readOnly || !isCreate} />
            {form.formState.errors.employeeId && <p className="text-xs text-destructive">{form.formState.errors.employeeId.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="employeeCode">Employee Code</Label>
            <Input id="employeeCode" {...form.register('employeeCode')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="username" {...form.register('username')} disabled={readOnly} />
            {form.formState.errors.username && <p className="text-xs text-destructive">{form.formState.errors.username.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="firstName">First Name</Label>
            <Input id="firstName" {...form.register('firstName')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="middleName">Middle Name</Label>
            <Input id="middleName" {...form.register('middleName')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last Name</Label>
            <Input id="lastName" {...form.register('lastName')} disabled={readOnly} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="fullName">Full Name *</Label>
            <Input id="fullName" autoComplete="name" {...form.register('fullName')} disabled={readOnly} />
            {form.formState.errors.fullName && <p className="text-xs text-destructive">{form.formState.errors.fullName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} disabled={readOnly} />
            {form.formState.errors.email && <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="mobileNumber">Mobile Number</Label>
            <Input id="mobileNumber" type="tel" autoComplete="tel" {...form.register('mobileNumber')} disabled={readOnly} />
            {form.formState.errors.mobileNumber && <p className="text-xs text-destructive">{form.formState.errors.mobileNumber.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="alternateMobile">Alternate Mobile</Label>
            <Input id="alternateMobile" type="tel" {...form.register('alternateMobile')} disabled={readOnly} />
            {form.formState.errors.alternateMobile && <p className="text-xs text-destructive">{form.formState.errors.alternateMobile.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Gender</Label>
            <Select value={form.watch('gender')} onValueChange={(value) => form.setValue('gender', value as AdminUser['gender'])} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
              <SelectContent>
                {['Female', 'Male', 'Non-binary', 'Prefer not to say'].map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dateOfBirth">Date of Birth</Label>
            <Input id="dateOfBirth" type="date" {...form.register('dateOfBirth')} disabled={readOnly} />
            {form.formState.errors.dateOfBirth && <p className="text-xs text-destructive">{form.formState.errors.dateOfBirth.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="profilePhoto">Profile Picture URL</Label>
            <Input id="profilePhoto" type="url" {...form.register('profilePhoto')} disabled={readOnly} />
            {form.formState.errors.profilePhoto && <p className="text-xs text-destructive">{form.formState.errors.profilePhoto.message}</p>}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold">Organization assignment</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Department *</Label>
            <Select
              value={form.watch('department')}
              onValueChange={(value) => {
                form.setValue('department', value, { shouldValidate: true, shouldDirty: true });
                form.setValue('designation', '', { shouldDirty: true });
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
              <SelectContent>
                {masters.departments
                  .filter((department) => department.status === 'Active' || !department.status)
                  .map((department) => (
                    <SelectItem key={department.id ?? department.departmentName} value={department.departmentName}>
                      {department.departmentName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {!masters.departments.length && <p className="text-xs text-muted-foreground">No active departments are available.</p>}
            {form.formState.errors.department && <p className="text-xs text-destructive">{form.formState.errors.department.message}</p>}
          </div>
          <div className="space-y-2">
            <Label>Designation</Label>
            <Select value={form.watch('designation')} onValueChange={(value) => form.setValue('designation', value, { shouldDirty: true })} disabled={readOnly}>
              <SelectTrigger><SelectValue placeholder="Select designation" /></SelectTrigger>
              <SelectContent>
                {deptDesignations.map((designation) => (
                  <SelectItem key={designation.id ?? `${designation.department}-${designation.designationName}`} value={designation.designationName}>
                    {designation.designationName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Role *</Label>
            <Select value={form.watch('role')} onValueChange={(value) => form.setValue('role', value, { shouldValidate: true, shouldDirty: true })} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ADMIN_ROLES
                  .filter((item) => !['super_admin', 'admin'].includes(item.id) || currentRole === 'super_admin')
                  .map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Reporting Manager</Label>
            <Select
              value={form.watch('managerId') || '__none__'}
              onValueChange={(value) => {
                const managerId = value === '__none__' ? '' : value;
                const manager = masters.managers.find((item) => item.id === managerId);
                form.setValue('managerId', managerId, { shouldDirty: true });
                form.setValue('reportingManager', manager?.fullName || '', { shouldDirty: true });
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No reporting manager</SelectItem>
                {masters.managers
                  .filter((manager) => manager.id !== initial?.id)
                  .map((manager) => (
                    <SelectItem key={manager.id} value={manager.id!}>
                      {manager.fullName} · {manager.department}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {form.formState.errors.managerId && (
              <p className="text-xs text-destructive">{form.formState.errors.managerId.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Site</Label>
            <Select
              value={form.watch('siteId') || '__none__'}
              onValueChange={(value) => {
                const siteId = value === '__none__' ? '' : value;
                const site = masters.sites.find((item) => item.id === siteId);
                form.setValue('siteId', siteId, { shouldDirty: true });
                form.setValue('siteName', site?.siteName || '', { shouldDirty: true });
                form.setValue('businessUnit', site?.companyName || '', { shouldDirty: true });
                form.setValue(
                  'location',
                  [site?.plantAddress, site?.city, site?.state, site?.country].filter(Boolean).join(', '),
                  { shouldDirty: true },
                );
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No site assignment</SelectItem>
                {masters.sites.map((site) => (
                  <SelectItem key={site.id} value={site.id!}>
                    {site.siteName}{site.siteCode ? ` (${site.siteCode})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="businessUnit">Business Unit</Label>
            <Input id="businessUnit" {...form.register('businessUnit')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Location</Label>
            <Input id="location" {...form.register('location')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shift">Shift</Label>
            <Input id="shift" {...form.register('shift')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Employment Type</Label>
            <Select value={form.watch('employmentType')} onValueChange={(value) => form.setValue('employmentType', value as AdminUser['employmentType'])} disabled={readOnly}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['Permanent', 'Contract', 'Temporary', 'Consultant', 'Vendor', 'Intern'].map((value) => (
                  <SelectItem key={value} value={value}>{value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="joiningDate">Joining Date</Label>
            <Input id="joiningDate" type="date" {...form.register('joiningDate')} disabled={readOnly} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.watch('userStatus')}
              onValueChange={(value) => {
                form.setValue('userStatus', value as AdminUser['userStatus'], { shouldDirty: true });
                form.setValue('accountLocked', value === 'Locked', { shouldDirty: true });
              }}
              disabled={readOnly}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{USER_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2 lg:col-span-3">
            <Label htmlFor="remarks">Remarks</Label>
            <Textarea id="remarks" rows={3} {...form.register('remarks')} disabled={readOnly} />
            {form.formState.errors.remarks && <p className="text-xs text-destructive">{form.formState.errors.remarks.message}</p>}
          </div>
        </div>
      </section>

      {!readOnly && isCreate && (
        <section className="space-y-2 rounded-lg border p-4">
          <Label htmlFor="temporaryPassword">Temporary Password *</Label>
          <Input
            id="temporaryPassword"
            type="password"
            value={tempPassword}
            onChange={(event) => setTempPassword(event.target.value)}
            minLength={12}
            autoComplete="new-password"
            aria-invalid={Boolean(passwordError)}
            placeholder="12+ characters with upper, lower, number, and special character"
          />
          {passwordError && <p className="text-xs text-destructive">{passwordError}</p>}
          <p className="text-xs text-muted-foreground">The user must reset this password before normal use.</p>
        </section>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <Label>Account Locked</Label>
          <Switch
            checked={form.watch('accountLocked')}
            onCheckedChange={(value) => {
              form.setValue('accountLocked', value, { shouldDirty: true });
              form.setValue('userStatus', value ? 'Locked' : 'Inactive', { shouldDirty: true });
            }}
            disabled={readOnly}
          />
        </div>
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <Label>Password Reset Required</Label>
          <Switch checked={form.watch('passwordResetRequired')} onCheckedChange={(value) => form.setValue('passwordResetRequired', value)} disabled={readOnly} />
        </div>
        <div className="flex items-center justify-between p-3 border rounded-lg">
          <Label>Two Factor Enabled</Label>
          <Switch checked={form.watch('twoFactorEnabled')} onCheckedChange={(value) => form.setValue('twoFactorEnabled', value)} disabled={readOnly} />
        </div>
      </section>

      {!readOnly && !isCreate && (
        <section className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
          <Label htmlFor="changeReason">Reason for Change *</Label>
          <Textarea
            id="changeReason"
            value={changeReason}
            onChange={(event) => {
              setChangeReason(event.target.value);
              if (event.target.value.trim().length >= 8) setReasonError('');
            }}
            rows={3}
            minLength={8}
            required
            placeholder="Provide an attributable reason for this governed user change"
          />
          {(reasonError || (changeReason.trim().length > 0 && changeReason.trim().length < 8)) && (
            <p className="text-xs text-destructive">{reasonError || 'Enter at least 8 characters.'}</p>
          )}
        </section>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {(firstFormError || reasonError) && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {String(firstFormError || reasonError)}
        </div>
      )}
      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">User Details</TabsTrigger>
          <TabsTrigger value="access">Access Control</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="mt-4">
          {detailsForm}
        </TabsContent>
        <TabsContent value="access" className="mt-4">
          <UserAccessControl
            value={modulePermissions}
            onChange={(permissions) => {
              setModulePermissions(permissions);
              setAccessDirty(true);
            }}
            presetId={presetId}
            onPresetChange={(value) => {
              setPresetId(value);
              setAccessDirty(true);
            }}
            readOnly={readOnly || currentRole !== 'super_admin'}
          />
        </TabsContent>
      </Tabs>

      {!readOnly && (
        <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t bg-background/95 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-end">
          {!isCreate && changeReason.trim().length < 8 && (
            <p className="text-xs text-muted-foreground sm:mr-auto">
              Enter a Reason for Change (min 8 characters), then click Save Changes.
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button
              type="submit"
              className="bg-blue-600 hover:bg-blue-700"
              disabled={submitting}
            >
              {submitting ? 'Saving...' : isCreate ? 'Create User' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
