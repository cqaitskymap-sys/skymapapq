'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Copy, Users } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { PermissionMatrix } from './permission-matrix';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditRoles } from '@/lib/permissions';
import type { AdminRole, PermissionMatrix as PermMatrix } from '@/lib/admin/schemas';
import {
  fetchRoleWithPermissions, countUsersWithRole, fetchRoleAuditTrail, isSystemRoleId,
} from '@/lib/admin/role-service';
import { buildDefaultRoleMatrix } from '@/lib/permissions';

export function RoleDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { role: currentRole } = useAdminPermissions();
  const canEdit = canEditRoles(currentRole);

  const [role, setRole] = useState<AdminRole | null>(null);
  const [permissions, setPermissions] = useState<PermMatrix | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { role: r, permissions: p } = await fetchRoleWithPermissions(id);
        if (!r) {
          setError('Role not found');
          return;
        }
        setRole(r);
        setPermissions(p);
        setUserCount(await countUsersWithRole(r.roleId));
        setAuditTrail(await fetchRoleAuditTrail(id));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !role) return <ErrorCard title="Not Found" message={error || 'Role not found'} />;

  const matrix = permissions?.permissions || buildDefaultRoleMatrix(role.roleId);
  const isSystem = Boolean(role.isSystemRole || isSystemRoleId(role.roleId));

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/roles')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Roles
      </Button>

      <PageHeader
        title={role.roleName}
        description={role.roleDescription || role.roleId}
        basePath="/admin"
        actions={
          canEdit && !role.isDeleted ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={`/admin/users?role=${encodeURIComponent(role.roleId)}`}>
                  <Users className="h-4 w-4 mr-1" />Assignments ({userCount})
                </Link>
              </Button>
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/roles/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Role</Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <StatusBadge status={role.isDeleted ? 'Inactive' : role.status} />
        <span className="text-sm text-muted-foreground">{isSystem ? 'System Role' : 'Custom Role'}</span>
        <span className="text-sm text-muted-foreground">Level {role.roleLevel ?? role.level}</span>
        <span className="text-sm text-muted-foreground">{userCount} users assigned</span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="matrix">Permission Matrix</TabsTrigger>
          <TabsTrigger value="security">Field / Row Security</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Role Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: 'Role ID', value: role.roleId },
                { label: 'Data Scope', value: role.dataScope || 'Organization Records' },
                { label: 'Department Access', value: role.departmentAccess || 'All' },
                { label: 'Site Access', value: role.siteAccess || 'All' },
                { label: 'Business Unit', value: role.businessUnitAccess || 'All' },
                { label: 'Created At', value: role.createdAt ? new Date(role.createdAt).toLocaleString() : '-' },
                { label: 'Updated At', value: role.updatedAt ? new Date(role.updatedAt).toLocaleString() : '-' },
                { label: 'Created By', value: role.createdBy },
                { label: 'Updated By', value: role.updatedBy },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium break-words">{String(f.value ?? '-')}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Role Assignment</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-2">
              <p>{userCount} active directory user(s) currently use this role.</p>
              <p className="text-muted-foreground">
                Permission changes take effect on the next authenticated session refresh for assigned users across User Management, QMS, Documents, and all integrated modules.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link href={`/admin/users?role=${encodeURIComponent(role.roleId)}`}>Open User Management</Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="matrix">
          <Card>
            <CardHeader><CardTitle className="text-base">Module Permissions</CardTitle></CardHeader>
            <CardContent>
              <PermissionMatrix permissions={matrix} onChange={() => {}} readOnly />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Row-Level Security</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Default Scope</p>
                <p className="font-medium">{role.dataScope || 'Organization Records'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Department / Site / BU</p>
                <p className="font-medium">
                  {[role.departmentAccess || 'All depts', role.siteAccess || 'All sites', role.businessUnitAccess || 'All BUs'].join(' · ')}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Field-Level Policies</CardTitle></CardHeader>
            <CardContent>
              {!role.fieldPolicies?.length ? (
                <EmptyState message="No field-level policies configured for this role." />
              ) : (
                <div className="space-y-2 text-sm">
                  {role.fieldPolicies.map((policy, index) => (
                    <div key={`${policy.fieldKey}-${index}`} className="rounded border p-3">
                      <p className="font-medium">{policy.fieldKey}</p>
                      <p className="text-xs text-muted-foreground">
                        {policy.access}
                        {policy.condition ? ` · ${policy.condition}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">Immutable Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState message="No audit events for this role." />
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
              <p>Created: {role.createdAt ? new Date(role.createdAt).toLocaleString() : '-'} by {role.createdBy || '-'}</p>
              <p>Last updated: {role.updatedAt ? new Date(role.updatedAt).toLocaleString() : '-'} by {role.updatedBy || '-'}</p>
              <p className="text-muted-foreground">
                Full immutable change history is retained in Audit Trail. Use Admin → Audit Trail reports for exportable compliance evidence.
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/audit-trail">Open Audit Trail Reports</Link>
                </Button>
                {canEdit && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/roles`}><Copy className="h-4 w-4 mr-1" />Back to Role List (Clone)</Link>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
