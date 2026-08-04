'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, AlertTriangle, Star, History, Link2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { SiteTypeBadge } from './site-type-badge';
import { DocumentPreviewCard } from './document-preview-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditCompanySites } from '@/lib/permissions';
import type { CompanySite } from '@/lib/admin/schemas';
import {
  fetchCompanySiteById, fetchCompanySiteAuditTrail, setDefaultCompanySite,
  countLinkedSiteReferences, isSystemSite, buildSiteRecordId, exportCompanySitesCsv,
} from '@/lib/admin/company-site-service';

export function CompanySiteDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditCompanySites(role);

  const [site, setSite] = useState<CompanySite | null>(null);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [linkedRefs, setLinkedRefs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaultConfirm, setDefaultConfirm] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [busy, setBusy] = useState(false);

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const load = useCallback(async () => {
    try {
      const record = await fetchCompanySiteById(id, true);
      if (!record) {
        setError('Site not found');
        return;
      }
      setSite(record);
      setAuditTrail(await fetchCompanySiteAuditTrail(id));
      setLinkedRefs(await countLinkedSiteReferences(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const setDefault = async () => {
    if (!site || changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setBusy(true);
    const result = await setDefaultCompanySite(id, site, auditMeta, changeReason);
    if (result.success) {
      toast.success('Default site updated');
      load();
    } else toast.error(result.error || 'Failed');
    setBusy(false);
    setDefaultConfirm(false);
    setChangeReason('');
  };

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !site) return <ErrorCard title="Not Found" message={error || 'Site not found'} />;

  const infoFields = [
    { label: 'Site ID', value: site.id },
    { label: 'Site Record ID', value: site.siteRecordId || buildSiteRecordId(site.siteCode || '') },
    { label: 'Company ID', value: site.companyId },
    { label: 'Company Code', value: site.companyCode },
    { label: 'Legal Name', value: site.legalName },
    { label: 'Short Name', value: site.shortName },
    { label: 'Company Type', value: site.companyType },
    { label: 'Industry', value: site.industry },
    { label: 'Company Email', value: site.companyEmail },
    { label: 'Company Phone', value: site.companyPhone },
    { label: 'Registration No.', value: site.registrationNumber },
    { label: 'PAN', value: site.panNumber },
    { label: 'Site Code', value: site.siteCode },
    { label: 'Business Unit', value: site.businessUnit },
    { label: 'Plant Name', value: site.plantName },
    { label: 'GST Number', value: site.gstNumber },
    { label: 'Mfg License', value: site.manufacturingLicenseNumber },
    { label: 'Drug License', value: site.drugLicenseNumber },
    { label: 'Site Head', value: site.siteHead },
    { label: 'Quality Head', value: site.qualityHead },
    { label: 'Contact Person', value: site.contactPerson },
    { label: 'Contact Email', value: site.contactEmail },
    { label: 'Contact Phone', value: site.contactPhone },
    { label: 'Website', value: site.website },
    { label: 'Timezone', value: site.timezone },
    { label: 'Date Format', value: site.dateFormat },
    { label: 'Currency', value: site.defaultCurrency },
    { label: 'Created By', value: site.createdBy },
    { label: 'Created At', value: site.createdAt ? new Date(site.createdAt).toLocaleString() : '-' },
    { label: 'Updated By', value: site.updatedBy },
    { label: 'Updated At', value: site.updatedAt ? new Date(site.updatedAt).toLocaleString() : '-' },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/company-site')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Company / Sites
      </Button>

      <PageHeader
        title={site.siteName}
        description={`${site.companyName} · ${site.companyId || site.companyCode}`}
        basePath="/admin"
        actions={
          <div className="flex gap-2">
            {canEdit && !site.isDefault && site.status === 'Active' && !site.isDeleted && (
              <Button variant="outline" size="sm" onClick={() => setDefaultConfirm(true)}>
                <Star className="h-4 w-4 mr-1" />Set Default
              </Button>
            )}
            {canEdit && !site.isDeleted && (
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/company-site/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <StatusBadge status={site.status} />
        <SiteTypeBadge type={site.siteType} />
        {site.isDefault && <Badge className="bg-blue-100 text-blue-800">Default Site</Badge>}
        {isSystemSite(site) && <Badge variant="outline">System Site</Badge>}
        {site.isDeleted && <Badge variant="destructive">Deleted</Badge>}
        {site.status === 'Inactive' && (
          <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
            <AlertTriangle className="h-3 w-3" />
            Inactive — new records cannot be created under this site
          </span>
        )}
      </div>

      {site.companyLogo && (
        <Image
          src={site.companyLogo}
          alt="Company logo"
          width={240}
          height={64}
          className="h-16 w-auto rounded border bg-white p-2 object-contain"
        />
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="document">Document Preview</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader><CardTitle className="text-base">Company & Site Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {infoFields.map((field) => (
                <div key={field.label}>
                  <p className="text-xs text-muted-foreground">{field.label}</p>
                  <p className="font-medium break-words">{String(field.value ?? '-')}</p>
                </div>
              ))}
              <div className="sm:col-span-2 md:col-span-3">
                <p className="text-xs text-muted-foreground">Site Address</p>
                <p className="font-medium">{site.plantAddress || site.siteAddress}</p>
                <p className="text-sm text-muted-foreground">
                  {[site.city, site.state, site.country, site.pinZipCode].filter(Boolean).join(', ')}
                </p>
              </div>
              <div className="sm:col-span-2 md:col-span-3 flex flex-wrap gap-2">
                {site.isManufacturingUnit && <Badge variant="secondary">Manufacturing</Badge>}
                {site.isWarehouse && <Badge variant="secondary">Warehouse</Badge>}
                {site.isLaboratory && <Badge variant="secondary">Laboratory</Badge>}
                {site.isOffice && <Badge variant="secondary">Office</Badge>}
              </div>
              {site.remarks && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{site.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="document">
          <Card>
            <CardHeader><CardTitle className="text-base">Document Preview</CardTitle></CardHeader>
            <CardContent>
              <DocumentPreviewCard site={site} />
              <p className="text-xs text-muted-foreground mt-3">
                Used in PQR, CPV, Deviation, OOS, CAPA, Change Control, Stability, Audit, DMS, Validation, and CSV reports.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Link2 className="h-4 w-4" />Linked Records</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>{linkedRefs} linked user, department, or designation record(s) reference this site.</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline"><Link href={`/admin/users?siteId=${id}`}>Users</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`/admin/departments?siteId=${id}`}>Departments</Link></Button>
                <Button asChild size="sm" variant="outline"><Link href={`/admin/designations?siteId=${id}`}>Designations</Link></Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Site and company name changes cascade automatically to linked master data when updated via Cloud Functions.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reports">
          <Card>
            <CardHeader><CardTitle className="text-base">Site Reports</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-3">
              <p>Linked master records: <span className="font-medium">{linkedRefs}</span></p>
              <p>Company: <span className="font-medium">{site.companyName}</span> ({site.companyCode})</p>
              <p>Business unit: <span className="font-medium">{site.businessUnit || '—'}</span></p>
              <p>Status: <span className="font-medium">{site.status}</span>{site.isDefault ? ' · Default site' : ''}</p>
              <p className="text-muted-foreground">
                Export site configuration or use Audit Trail for formal Part 11 / ALCOA+ evidence.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const csv = exportCompanySitesCsv([site]);
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const anchor = document.createElement('a');
                    anchor.href = url;
                    anchor.download = `site-${site.siteCode || site.id}-report.csv`;
                    anchor.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export Site Report
                </Button>
                <Button asChild size="sm" variant="outline"><Link href="/admin/audit-trail">Audit Trail Report</Link></Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState message="No audit events for this site." />
              ) : (
                <div className="space-y-2 text-sm max-h-96 overflow-y-auto">
                  {auditTrail.map((entry, index) => (
                    <div key={String(entry.id || index)} className="p-3 border rounded">
                      <p className="font-medium">{String(entry.action)}</p>
                      <p className="text-xs text-muted-foreground">
                        {String(entry.timestamp || entry.dateTime)} — {String(entry.userName || '')}
                      </p>
                      {entry.reason ? <p className="text-xs mt-1">Reason: {String(entry.reason)}</p> : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><History className="h-4 w-4" />Change History</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState message="No history recorded yet." />
              ) : (
                <div className="space-y-2 text-sm">
                  {auditTrail.map((entry, index) => (
                    <div key={`history-${String(entry.id || index)}`} className="flex justify-between gap-4 border-b pb-2">
                      <span>{String(entry.action)}</span>
                      <span className="text-muted-foreground">{String(entry.timestamp || entry.dateTime)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={defaultConfirm} onOpenChange={setDefaultConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set Default Site</AlertDialogTitle>
            <AlertDialogDescription>
              Set &quot;{site.siteName}&quot; as the default site for all document headers?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(event) => setChangeReason(event.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={setDefault} disabled={busy} className="bg-blue-600">
              {busy ? 'Saving…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
