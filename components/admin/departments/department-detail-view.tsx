'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, AlertTriangle, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { DepartmentTypeBadge } from './department-type-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditDepartments } from '@/lib/permissions';
import type { AdminUser, Department } from '@/lib/admin/schemas';
import {
  fetchDepartmentById, fetchUsersInDepartment, fetchDepartmentAuditTrail,
  fetchActiveUsers, linkUsersToDepartment, countChildDepartments, isSystemDepartment,
} from '@/lib/admin/department-service';

function departmentMatches(d: Department, u: AdminUser) {
  return u.department === d.departmentName
    || u.department === d.departmentCode
    || u.department === d.shortName;
}

export function DepartmentDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditDepartments(role);

  const [dept, setDept] = useState<Department | null>(null);
  const [linkedUsers, setLinkedUsers] = useState<AdminUser[]>([]);
  const [childCount, setChildCount] = useState(0);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AdminUser[]>([]);
  const [linkUserId, setLinkUserId] = useState('');
  const [linkReason, setLinkReason] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
    role,
  };

  const load = useCallback(async () => {
    try {
      const department = await fetchDepartmentById(id, true);
      if (!department) {
        setError('Department not found');
        return;
      }
      setDept(department);
      setLinkedUsers(await fetchUsersInDepartment(department));
      setChildCount(await countChildDepartments(id));
      setAuditTrail(await fetchDepartmentAuditTrail(id));
      const active = await fetchActiveUsers();
      setAvailableUsers(active.filter((u) => !departmentMatches(department, u)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleLink = async () => {
    if (!dept || !linkUserId) return;
    if (linkReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setLinking(true);
    const result = await linkUsersToDepartment(dept, [linkUserId], auditMeta, linkReason);
    setLinking(false);
    if (result.success) {
      toast.success(`${result.count ?? 0} user(s) linked`);
      setLinkOpen(false);
      setLinkUserId('');
      setLinkReason('');
      load();
    } else {
      toast.error(result.error || 'Failed to link user');
    }
  };

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !dept) return <ErrorCard title="Not Found" message={error || 'Department not found'} />;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/departments')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Departments
      </Button>

      <PageHeader
        title={dept.departmentName}
        description={dept.departmentId || dept.departmentCode}
        basePath="/admin"
        actions={
          canEdit && !dept.isDeleted ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={`/admin/users?department=${encodeURIComponent(dept.departmentName)}`}>
                  <Users className="h-4 w-4 mr-1" />Employees ({linkedUsers.length})
                </Link>
              </Button>
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/departments/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Department</Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <StatusBadge status={dept.isDeleted ? 'Inactive' : dept.status} />
        <DepartmentTypeBadge type={dept.departmentType} />
        {isSystemDepartment(dept) && (
          <span className="text-xs uppercase text-muted-foreground border rounded px-2 py-0.5">System</span>
        )}
        <span className="text-sm text-muted-foreground">{linkedUsers.length} employees</span>
        <span className="text-sm text-muted-foreground">{childCount} child dept(s)</span>
        {dept.status === 'Inactive' && (
          <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-3 w-3" />
            Inactive — new user assignments blocked
          </span>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Department Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: 'Department ID', value: dept.departmentId },
                { label: 'Department Code', value: dept.departmentCode },
                { label: 'Short Name', value: dept.shortName || '-' },
                { label: 'Parent Department', value: dept.parentDepartmentName || 'Top-level' },
                { label: 'Department Head', value: dept.departmentHead },
                { label: 'Manager', value: dept.manager || '-' },
                { label: 'HOD Email', value: dept.hodEmail },
                { label: 'Email', value: dept.email || '-' },
                { label: 'Phone', value: dept.phone || '-' },
                { label: 'Extension', value: dept.extension || '-' },
                { label: 'Business Unit', value: dept.businessUnit || '-' },
                { label: 'Site', value: dept.siteLocation || '-' },
                { label: 'Location', value: dept.location || '-' },
                { label: 'Cost Center', value: dept.costCenter || '-' },
                { label: 'Created At', value: dept.createdAt ? new Date(dept.createdAt).toLocaleString() : '-' },
                { label: 'Updated At', value: dept.updatedAt ? new Date(dept.updatedAt).toLocaleString() : '-' },
                { label: 'Created By', value: dept.createdBy },
                { label: 'Updated By', value: dept.updatedBy },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium break-words">{String(f.value ?? '-')}</p>
                </div>
              ))}
              {dept.description && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{dept.description}</p>
                </div>
              )}
              {dept.remarks && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{dept.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employees">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Department Employees</CardTitle>
              {canEdit && dept.status === 'Active' && !dept.isDeleted && (
                <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-1" />Link User
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {linkedUsers.length === 0 ? (
                <EmptyState message="No users linked to this department." />
              ) : (
                <div className="space-y-2">
                  {linkedUsers.map((u) => (
                    <div key={u.id} className="flex justify-between items-center p-3 border rounded-lg text-sm">
                      <div>
                        <p className="font-medium">{u.fullName}</p>
                        <p className="text-xs text-muted-foreground">{u.email} · {u.employeeId} · {u.designation || '—'}</p>
                      </div>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/admin/users/${u.id}`}>Open</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader><CardTitle className="text-base">Department Reports</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-3">
              <p>Active employees: <span className="font-medium">{linkedUsers.filter((u) => u.userStatus === 'Active').length}</span></p>
              <p>Total linked users: <span className="font-medium">{linkedUsers.length}</span></p>
              <p>Child departments: <span className="font-medium">{childCount}</span></p>
              <p className="text-muted-foreground">
                Use User Management filters and Audit Trail exports for formal compliance reporting.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/users?department=${encodeURIComponent(dept.departmentName)}`}>User Report</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/audit-trail">Audit Trail Report</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">Immutable Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState message="No audit events for this department." />
              ) : (
                <div className="space-y-2 text-sm max-h-80 overflow-y-auto">
                  {auditTrail.map((l, i) => (
                    <div key={String(l.id || i)} className="p-3 border rounded-lg">
                      <p className="font-medium">{String(l.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(l.timestamp || l.dateTime)} — {String(l.userName || '')}
                      </p>
                      {l.reason ? <p className="text-xs mt-1">Reason: {String(l.reason)}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="text-base">Configuration History</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>Created: {dept.createdAt ? new Date(dept.createdAt).toLocaleString() : '-'} by {dept.createdBy || '-'}</p>
              <p>Last updated: {dept.updatedAt ? new Date(dept.updatedAt).toLocaleString() : '-'} by {dept.updatedBy || '-'}</p>
              <p className="text-muted-foreground">
                Hierarchy, HOD, and status changes are retained immutably in Audit Trail for ALCOA+ / Part 11 evidence.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={linkOpen} onOpenChange={setLinkOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Link User to Department</AlertDialogTitle>
            <AlertDialogDescription>
              Assign an active user to {dept.departmentName}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <Select value={linkUserId} onValueChange={setLinkUserId}>
              <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
              <SelectContent>
                {availableUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id || u.employeeId}>
                    {u.fullName} ({u.employeeId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1">
              <Label>Change Reason *</Label>
              <Textarea value={linkReason} onChange={(e) => setLinkReason(e.target.value)} rows={2} />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={linking} onClick={handleLink} className="bg-blue-600">
              {linking ? 'Linking…' : 'Link User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
