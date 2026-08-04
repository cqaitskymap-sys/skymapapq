'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, AlertTriangle, Users } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { DesignationLevelBadge } from './designation-level-badge';
import { DepartmentBadge } from './department-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditDesignations } from '@/lib/permissions';
import type { AdminUser, Designation } from '@/lib/admin/schemas';
import {
  fetchDesignationById, fetchUsersWithDesignation, fetchDesignationAuditTrail,
  countChildDesignations, isSystemDesignation,
} from '@/lib/admin/designation-service';

export function DesignationDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { role } = useAdminPermissions();
  const canEdit = canEditDesignations(role);

  const [des, setDes] = useState<Designation | null>(null);
  const [linkedUsers, setLinkedUsers] = useState<AdminUser[]>([]);
  const [childCount, setChildCount] = useState(0);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const designation = await fetchDesignationById(id, true);
      if (!designation) {
        setError('Designation not found');
        return;
      }
      setDes(designation);
      setLinkedUsers(await fetchUsersWithDesignation(designation));
      setChildCount(await countChildDesignations(id));
      setAuditTrail(await fetchDesignationAuditTrail(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !des) return <ErrorCard title="Not Found" message={error || 'Designation not found'} />;

  const employeesLink = `/admin/users?designation=${encodeURIComponent(des.designationName)}`;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/designations')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Designations
      </Button>

      <PageHeader
        title={des.designationName}
        description={des.designationId || des.designationCode}
        basePath="/admin"
        actions={
          canEdit && !des.isDeleted ? (
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline">
                <Link href={employeesLink}>
                  <Users className="h-4 w-4 mr-1" />Employees ({linkedUsers.length})
                </Link>
              </Button>
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/designations/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Designation</Link>
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <StatusBadge status={des.isDeleted ? 'Inactive' : des.status} />
        <DepartmentBadge department={des.department} />
        <DesignationLevelBadge level={des.designationLevel} />
        {isSystemDesignation(des) && (
          <span className="text-xs uppercase text-muted-foreground border rounded px-2 py-0.5">System</span>
        )}
        <span className="text-sm text-muted-foreground">{linkedUsers.length} employees</span>
        <span className="text-sm text-muted-foreground">{childCount} child designation(s)</span>
        {des.status === 'Inactive' && !des.isDeleted && (
          <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="h-3 w-3" />
            Inactive — new user assignments blocked
          </span>
        )}
        {des.isDeleted && (
          <span className="flex items-center gap-1 text-xs text-red-700 bg-red-50 dark:bg-red-950/40 px-2 py-1 rounded border border-red-200 dark:border-red-800">
            <AlertTriangle className="h-3 w-3" />
            Soft-deleted — restore from list to reactivate
          </span>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
          <TabsTrigger value="hierarchy">Hierarchy</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Designation Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {[
                { label: 'Designation ID', value: des.designationId },
                { label: 'Designation Code', value: des.designationCode },
                { label: 'Short Name', value: des.shortName || '-' },
                { label: 'Department', value: des.department },
                { label: 'Parent Designation', value: des.parentDesignationName || 'Top-level' },
                { label: 'Designation Level', value: des.designationLevel },
                { label: 'Reporting Level', value: des.reportingLevel || '-' },
                { label: 'Job Grade', value: des.jobGrade || '-' },
                { label: 'Job Band', value: des.jobBand || '-' },
                { label: 'Job Level', value: des.jobLevel || '-' },
                { label: 'Employment Category', value: des.employmentCategory || '-' },
                { label: 'Minimum Experience (years)', value: des.minimumExperience ?? 0 },
                { label: 'Business Unit', value: des.businessUnit || '-' },
                { label: 'Site', value: des.siteName || '-' },
                { label: 'Approval Level', value: des.approvalLevel },
                { label: 'Created At', value: des.createdAt ? new Date(des.createdAt).toLocaleString() : '-' },
                { label: 'Updated At', value: des.updatedAt ? new Date(des.updatedAt).toLocaleString() : '-' },
                { label: 'Created By', value: des.createdBy },
                { label: 'Updated By', value: des.updatedBy },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium break-words">{String(f.value ?? '-')}</p>
                </div>
              ))}
              {des.requiredQualification && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Required Qualification</p>
                  <p className="font-medium">{des.requiredQualification}</p>
                </div>
              )}
              {des.requiredSkills && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Required Skills</p>
                  <p className="font-medium">{des.requiredSkills}</p>
                </div>
              )}
              {des.description && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{des.description}</p>
                </div>
              )}
              {des.remarks && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{des.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Approval & Authority</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              {[
                { label: 'Approval Authority', value: des.approvalAuthority },
                { label: 'Can Review', value: des.canReview },
                { label: 'Can Approve', value: des.canApprove },
                { label: 'Can E-Sign', value: des.canESign },
              ].map((f) => (
                <div key={f.label} className="p-3 border rounded-lg bg-card">
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{f.value ? 'Yes' : 'No'}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employees">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Designation Employees</CardTitle>
              <Button asChild size="sm" variant="outline">
                <Link href={employeesLink}>View in User Management</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {linkedUsers.length === 0 ? (
                <EmptyState message="No users linked to this designation." />
              ) : (
                <div className="space-y-2">
                  {linkedUsers.map((u) => (
                    <div key={u.id} className="flex justify-between items-center p-3 border rounded-lg text-sm bg-card">
                      <div>
                        <p className="font-medium">{u.fullName}</p>
                        <p className="text-xs text-muted-foreground">{u.email} · {u.employeeId} · {u.department || '—'}</p>
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

        <TabsContent value="hierarchy">
          <Card>
            <CardHeader><CardTitle className="text-base">Hierarchy Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Parent Designation</p>
                <p className="font-medium">
                  {des.parentDesignationName || 'Top-level (no parent)'}
                </p>
                {des.parentDesignationId && (
                  <Button asChild size="sm" variant="link" className="h-auto p-0 mt-1">
                    <Link href={`/admin/designations/${des.parentDesignationId}`}>Open parent</Link>
                  </Button>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Child Designations</p>
                <p className="font-medium">{childCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Reporting Level</p>
                <p className="font-medium">{des.reportingLevel || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Designation Level</p>
                <p className="font-medium">{des.designationLevel}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Job Grade / Band / Level</p>
                <p className="font-medium">
                  {[des.jobGrade, des.jobBand, des.jobLevel].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Business Unit / Site</p>
                <p className="font-medium">
                  {[des.businessUnit, des.siteName].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader><CardTitle className="text-base">Designation Reports</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-3">
              <p>Active employees: <span className="font-medium">{linkedUsers.filter((u) => u.userStatus === 'Active').length}</span></p>
              <p>Total linked users: <span className="font-medium">{linkedUsers.length}</span></p>
              <p>Child designations: <span className="font-medium">{childCount}</span></p>
              <p>Approval authority: <span className="font-medium">{des.approvalAuthority ? 'Yes' : 'No'}</span></p>
              <p className="text-muted-foreground">
                Use User Management filters and Audit Trail exports for formal compliance reporting.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={employeesLink}>User Report</Link>
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
                <EmptyState message="No audit events for this designation." />
              ) : (
                <div className="space-y-2 text-sm max-h-80 overflow-y-auto">
                  {auditTrail.map((l, i) => (
                    <div key={String(l.id || i)} className="p-3 border rounded-lg bg-card">
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
              <p>Created: {des.createdAt ? new Date(des.createdAt).toLocaleString() : '-'} by {des.createdBy || '-'}</p>
              <p>Last updated: {des.updatedAt ? new Date(des.updatedAt).toLocaleString() : '-'} by {des.updatedBy || '-'}</p>
              <p className="text-muted-foreground">
                Hierarchy, approval flags, and status changes are retained immutably in Audit Trail for ALCOA+ / Part 11 evidence.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
