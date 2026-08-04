'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, Download, Link2, History } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { ParameterTypeBadge } from './parameter-type-badge';
import { CriticalityBadge } from './criticality-badge';
import { ProductLinkBadge } from './product-link-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  canEditParameters, canEditQcParameters, canEditUtilityParameters, canViewCppParametersOnly,
} from '@/lib/permissions';
import type { Parameter } from '@/lib/admin/schemas';
import {
  fetchParameterById, fetchParameterAuditTrail, countLinkedParameterUsage,
  exportParametersCsv,
} from '@/lib/admin/parameter-service';

const INTEGRATION_MODULES = [
  'CPV', 'APQR / PQR', 'Validation', 'LIMS', 'Equipment', 'Calibration',
  'Maintenance', 'Environmental Monitoring', 'Water System', 'HVAC',
  'Manufacturing', 'Quality Control', 'Risk Assessment', 'CAPA', 'Deviation', 'Change Control',
];

export function ParameterDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { role } = useAdminPermissions();
  const canEdit = canEditParameters(role) || canEditQcParameters(role) || canEditUtilityParameters(role);
  const cppOnly = canViewCppParametersOnly(role);

  const [param, setParam] = useState<Parameter | null>(null);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [linkedCount, setLinkedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const p = await fetchParameterById(id, true);
      if (!p) {
        setError('Parameter not found');
        return;
      }
      setParam(p);
      setAuditTrail(await fetchParameterAuditTrail(id));
      setLinkedCount(await countLinkedParameterUsage(id, p.parameterCode));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !param) return <ErrorCard title="Not Found" message={error || 'Parameter not found'} />;

  if (cppOnly && param.parameterType !== 'CPP' && param.parameterType !== 'IPC' && param.parameterType !== 'Yield Parameter') {
    return <ErrorCard accessDenied message="You can only view CPP parameters." />;
  }

  const overviewFields = [
    { label: 'Parameter ID', value: param.parameterId },
    { label: 'Parameter Code', value: param.parameterCode },
    { label: 'Short Name', value: param.shortName },
    { label: 'Description', value: param.description },
    { label: 'Category', value: param.parameterCategory },
    { label: 'Group', value: param.parameterGroup },
    { label: 'Module', value: param.moduleName },
    { label: 'Sub Module', value: param.subModule },
    { label: 'Process Stage', value: param.processStage },
    { label: 'Department', value: param.department },
    { label: 'Product Category', value: param.productCategory },
    { label: 'Test Method / STP', value: param.testMethodStp },
    { label: 'Specification No', value: param.specificationNo },
    { label: 'Data Type', value: param.dataType },
    { label: 'Result Type', value: param.resultType },
    { label: 'Calculation Type', value: param.calculationType },
    { label: 'Unit', value: param.unit },
    { label: 'Frequency', value: param.frequency },
    { label: 'Target Value', value: param.targetValue },
    { label: 'Default Value', value: param.defaultValue },
    { label: 'Lower Limit', value: param.lowerLimit },
    { label: 'Upper Limit', value: param.upperLimit },
    { label: 'Alert Limit Low', value: param.alertLimitLow },
    { label: 'Alert Limit High', value: param.alertLimitHigh },
    { label: 'Action Limit Low', value: param.actionLimitLow },
    { label: 'Action Limit High', value: param.actionLimitHigh },
    { label: 'Critical Limit', value: param.criticalLimit },
    { label: 'Precision', value: param.precision },
    { label: 'Formula', value: param.formula },
    { label: 'Mandatory', value: param.mandatory ? 'Yes' : 'No' },
    { label: 'Display Order', value: param.displayOrder },
    { label: 'Sequence Number', value: param.sequenceNumber },
    { label: 'Applicable Site', value: param.applicableSite },
    { label: 'Business Unit', value: param.businessUnit },
    { label: 'Created By', value: param.createdBy },
    { label: 'Created At', value: param.createdAt },
    { label: 'Updated By', value: param.updatedBy },
    { label: 'Updated At', value: param.updatedAt },
  ];

  const handleExport = () => {
    const csv = exportParametersCsv([param]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `parameter-${param.parameterCode}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Parameter exported');
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/parameters')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Parameters
      </Button>

      <PageHeader
        title={param.parameterName}
        description={param.parameterId || param.parameterCode}
        basePath="/admin"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>
            {canEdit && !cppOnly && !param.isDeleted && (
              <Button asChild className="bg-blue-600 hover:bg-blue-700">
                <Link href={`/admin/parameters/${id}/edit`}><Pencil className="h-4 w-4 mr-1" />Edit Parameter</Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <ParameterTypeBadge type={param.parameterType} />
        <CriticalityBadge criticality={param.criticality} />
        <StatusBadge status={param.isDeleted ? 'Deleted' : param.status} />
        <ProductLinkBadge product={param.productLink} />
        {param.isArchived && <Badge variant="outline" className="text-amber-700 border-amber-300">Archived</Badge>}
        {linkedCount > 0 && (
          <Badge variant="secondary"><Link2 className="h-3 w-3 mr-1" />{linkedCount} linked record(s)</Badge>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="categories">Categories & Groups</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Parameter Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {overviewFields.map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium break-words">{String(f.value ?? '-')}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-base">Automation Rules</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                { label: 'OOT Applicable', value: param.ootApplicable },
                { label: 'OOS Applicable', value: param.oosApplicable },
                { label: 'Auto Deviation', value: param.autoDeviationRequired },
                { label: 'Auto CAPA', value: param.autoCapaRequired },
              ].map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium">{f.value ? 'Yes' : 'No'}</p>
                </div>
              ))}
              {param.remarks && (
                <div className="sm:col-span-2 md:col-span-4">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{param.remarks}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <Card>
            <CardContent className="p-4 grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Parameter Category</p>
                <p className="font-medium text-lg">{param.parameterCategory || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Parameter Group</p>
                <p className="font-medium text-lg">{param.parameterGroup || 'General'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Module</p>
                <p className="font-medium">{param.moduleName || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Sub Module</p>
                <p className="font-medium">{param.subModule || '-'}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">QMS Module Integrations</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                This parameter is registered for use across SkyMap QMS modules. Linked CPV records: {linkedCount}.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {INTEGRATION_MODULES.map((mod) => {
                  const active = param.moduleName === mod || (mod === 'CPV' && ['CPP', 'CQA', 'IPC'].includes(param.parameterType));
                  return (
                    <div key={mod} className={`border rounded-lg p-3 text-sm ${active ? 'border-blue-300 bg-blue-50' : 'opacity-60'}`}>
                      <p className="font-medium">{mod}</p>
                      <p className="text-xs text-muted-foreground">{active ? 'Primary module' : 'Available'}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Immutable Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState title="No audit entries" />
              ) : (
                <div className="space-y-2">
                  {auditTrail.map((entry, i) => (
                    <div key={i} className="flex flex-col sm:flex-row sm:items-center gap-1 p-3 border rounded text-sm bg-slate-50">
                      <span className="font-medium">{String(entry.action ?? entry.eventType ?? '-')}</span>
                      {Boolean(entry.reason) && (
                        <span className="text-xs text-muted-foreground">Reason: {String(entry.reason)}</span>
                      )}
                      <span className="text-xs text-muted-foreground sm:ml-auto">
                        {String(entry.userName ?? entry.actorName ?? entry.performedBy ?? '-')} · {String(entry.timestamp ?? entry.dateTime ?? '-')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Parameter History</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex gap-3 border-l-2 border-blue-500 pl-4">
                  <div>
                    <p className="font-medium">Created</p>
                    <p className="text-muted-foreground">{param.createdBy || '-'} · {param.createdAt || '-'}</p>
                  </div>
                </div>
                {param.updatedAt && (
                  <div className="flex gap-3 border-l-2 border-amber-500 pl-4">
                    <div>
                      <p className="font-medium">Last Updated</p>
                      <p className="text-muted-foreground">{param.updatedBy || '-'} · {param.updatedAt}</p>
                    </div>
                  </div>
                )}
                {param.isArchived && (
                  <div className="flex gap-3 border-l-2 border-slate-400 pl-4">
                    <div>
                      <p className="font-medium">Archived</p>
                      <p className="text-muted-foreground">Parameter marked as archived</p>
                    </div>
                  </div>
                )}
                {param.isDeleted && (
                  <div className="flex gap-3 border-l-2 border-red-500 pl-4">
                    <div>
                      <p className="font-medium">Soft Deleted</p>
                      <p className="text-muted-foreground">{param.deletedBy || '-'} · {param.deletedAt || '-'}</p>
                    </div>
                  </div>
                )}
                {auditTrail.slice(0, 10).map((entry, i) => (
                  <div key={i} className="flex gap-3 border-l-2 border-slate-200 pl-4">
                    <div>
                      <p className="font-medium">{String(entry.action ?? entry.eventType ?? 'Change')}</p>
                      <p className="text-muted-foreground">
                        {String(entry.userName ?? entry.actorName ?? '-')} · {String(entry.timestamp ?? entry.dateTime ?? '-')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
