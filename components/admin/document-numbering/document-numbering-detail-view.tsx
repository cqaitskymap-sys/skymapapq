'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Pencil, Download, Play, RotateCcw, UserCheck, UserX, Copy, Archive, Trash2,
  History, Link2,
} from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { ResetFrequencyBadge } from './reset-frequency-badge';
import { FormatBuilder } from './format-builder';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditDocumentNumbering } from '@/lib/permissions';
import type { DocumentNumbering, DocumentNumberingFormData } from '@/lib/admin/schemas';
import {
  fetchDocumentNumberingById, fetchDocumentNumberingAudit, listDocumentNumberHistory,
  buildDocumentNumberPreview, exportDocumentNumberingsCsv, isNumberingActive,
  setDocumentNumberingStatus, archiveDocumentNumbering, softDeleteDocumentNumbering,
  restoreDocumentNumbering, cloneDocumentNumbering, resetRunningNumber,
  previewDocumentNumber, generateDocumentNumber, parseFormatTokens,
  getNumberingIntegrationModules, canDeleteNumberingRecord,
} from './document-numbering-api';

const INTEGRATION_MODULES = [
  'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability',
  'Complaint', 'Recall', 'DMS', 'Audit', 'Validation', 'CSV',
  'Equipment', 'Warehouse', 'eBMR', 'Batch', 'Product', 'Risk Management',
];

type ActionDialog = 'activate' | 'deactivate' | 'archive' | 'delete' | 'restore' | 'reset' | 'clone' | 'generate' | null;

export function DocumentNumberingDetailView({ id }: { id: string }) {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role, canDelete } = useAdminPermissions();
  const canEdit = canEditDocumentNumbering(role);

  const [format, setFormat] = useState<DocumentNumbering | null>(null);
  const [auditTrail, setAuditTrail] = useState<Record<string, unknown>[]>([]);
  const [history, setHistory] = useState<Record<string, unknown>[]>([]);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [generatedResult, setGeneratedResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionDialog, setActionDialog] = useState<ActionDialog>(null);
  const [changeReason, setChangeReason] = useState('');
  const [cloneCode, setCloneCode] = useState('');
  const [cloneName, setCloneName] = useState('');

  const auditMeta = {
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  };

  const load = useCallback(async () => {
    try {
      const record = await fetchDocumentNumberingById(id, true);
      if (!record) {
        setError('Numbering rule not found');
        return;
      }
      setFormat(record);
      setAuditTrail(await fetchDocumentNumberingAudit(id));
      setHistory(await listDocumentNumberHistory(record.numberingId, id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const requireReason = () => {
    if (changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return false;
    }
    return true;
  };

  const closeDialog = () => {
    setActionDialog(null);
    setChangeReason('');
    setCloneCode('');
    setCloneName('');
  };

  const runTestPreview = async () => {
    if (!format) return;
    setActionLoading(true);
    const result = await previewDocumentNumber(format.moduleName, format.documentType, {
      siteCode: format.siteCode,
      departmentCode: format.departmentCode,
      productCode: format.productCodeOptional,
    });
    setActionLoading(false);
    if (result.number) {
      setPreviewResult(result.number);
      toast.success('Preview generated (no sequence increment)');
    } else toast.error(result.error || 'Preview failed');
  };

  const runRealGenerate = async () => {
    if (!format) return;
    if (!requireReason()) return;
    setActionLoading(true);
    const result = await generateDocumentNumber(format.moduleName, format.documentType, {
      increment: true,
      siteCode: format.siteCode,
      departmentCode: format.departmentCode,
    });
    setActionLoading(false);
    if (result.number) {
      setGeneratedResult(result.number);
      toast.success('Document number generated');
      load();
    } else toast.error(result.error || 'Generate failed');
    closeDialog();
  };

  const runStatusToggle = async (activate: boolean) => {
    if (!format?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await setDocumentNumberingStatus(
      format.id, format, activate ? 'Active' : 'Inactive', auditMeta, changeReason,
    );
    setActionLoading(false);
    if (result.success) {
      toast.success(activate ? 'Rule activated' : 'Rule deactivated');
      closeDialog();
      load();
    } else toast.error(result.error || 'Action failed');
  };

  const runArchive = async () => {
    if (!format?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await archiveDocumentNumbering(format.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Rule archived');
      closeDialog();
      load();
    } else toast.error(result.error || 'Archive failed');
  };

  const runDelete = async () => {
    if (!format?.id || !requireReason()) return;
    const check = canDeleteNumberingRecord(format);
    if (!check.allowed) {
      toast.error(check.reason || 'Cannot delete');
      return;
    }
    setActionLoading(true);
    const result = await softDeleteDocumentNumbering(format.id, format, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Rule soft-deleted');
      closeDialog();
      load();
    } else toast.error(result.error || 'Delete failed');
  };

  const runRestore = async () => {
    if (!format?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await restoreDocumentNumbering(format.id, changeReason);
    setActionLoading(false);
    if (result.success) {
      toast.success('Rule restored');
      closeDialog();
      load();
    } else toast.error(result.error || 'Restore failed');
  };

  const runReset = async () => {
    if (!format?.id || !requireReason()) return;
    setActionLoading(true);
    const result = await resetRunningNumber(format.id, format, auditMeta, changeReason, 0);
    setActionLoading(false);
    if (result.success) {
      toast.success('Sequence reset to 0');
      closeDialog();
      load();
    } else toast.error(result.error || 'Reset failed');
  };

  const runClone = async () => {
    if (!format?.id || !cloneCode.trim() || !requireReason()) return;
    setActionLoading(true);
    const result = await cloneDocumentNumbering(
      format.id, cloneCode.trim(), cloneName.trim() || `${format.numberingCode}-COPY`,
      auditMeta, changeReason,
    );
    setActionLoading(false);
    if (result.error) toast.error(result.error);
    else {
      toast.success('Rule cloned');
      closeDialog();
      if (result.format?.id) router.push(`/admin/document-numbering/${result.format.id}`);
    }
  };

  const handleExport = () => {
    if (!format) return;
    const csv = exportDocumentNumberingsCsv([format]);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `document-numbering-${format.numberingCode}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Rule exported');
  };

  if (loading) return <LoadingSkeleton rows={2} />;
  if (error || !format) return <ErrorCard title="Not Found" message={error || 'Rule not found'} />;

  const tokens = parseFormatTokens(format.formatTokens || '');
  const livePreview = buildDocumentNumberPreview(format, {
    runningNumber: Number(format.currentRunningNumber ?? 0) + 1,
  });
  const primaryModules = getNumberingIntegrationModules(format);

  const overviewFields = [
    { label: 'Numbering ID', value: format.numberingId },
    { label: 'Numbering Code', value: format.numberingCode },
    { label: 'Numbering Name', value: format.numberingName },
    { label: 'Module', value: format.moduleName },
    { label: 'Document Type', value: format.documentType },
    { label: 'Document Category', value: format.documentCategory },
    { label: 'Department', value: format.department },
    { label: 'Site / Location', value: format.site || format.siteCode },
    { label: 'Business Unit', value: format.businessUnit },
    { label: 'Workflow Code', value: format.workflowCode },
    { label: 'Prefix', value: format.prefix },
    { label: 'Suffix', value: format.suffix },
    { label: 'Site Code', value: format.siteCode },
    { label: 'Department Code', value: format.departmentCode },
    { label: 'Product Code', value: format.productCodeOptional || 'All' },
    { label: 'Year / Month', value: `${format.yearFormat} / ${format.monthFormat}` },
    { label: 'Separator', value: format.separator },
    { label: 'Running Length', value: format.runningNumberLength },
    { label: 'Starting Number', value: format.startingNumber },
    { label: 'Current Number', value: format.currentRunningNumber },
    { label: 'Reset Frequency', value: format.resetFrequency },
    { label: 'Revision Format', value: format.revisionFormat },
    { label: 'Format Tokens', value: format.formatTokens },
    { label: 'Version', value: format.numberingVersion },
    { label: 'Effective Date', value: format.effectiveDate },
    { label: 'Review Date', value: format.reviewDate },
    { label: 'Auto Generate', value: format.autoGenerateEnabled ? 'Yes' : 'No' },
    { label: 'Manual Override', value: format.manualOverrideAllowed ? 'Yes' : 'No' },
    { label: 'Allow Skip Sequence', value: format.allowSkipSequence ? 'Yes' : 'No' },
    { label: 'Created By', value: format.createdBy },
    { label: 'Created At', value: format.createdAt },
    { label: 'Updated By', value: format.updatedBy },
    { label: 'Updated At', value: format.updatedAt },
  ];

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push('/admin/document-numbering')}>
        <ArrowLeft className="h-4 w-4 mr-1" />Back to Document Numbering
      </Button>

      <PageHeader
        title={format.numberingName || format.numberingCode}
        description={`${format.moduleName} · ${format.documentType}`}
        basePath="/admin"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
            {canEdit && !format.isDeleted && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/document-numbering/${id}/edit`}>
                    <Pencil className="h-4 w-4 mr-1" />Edit
                  </Link>
                </Button>
                {format.status === 'Active' ? (
                  <Button variant="outline" size="sm" onClick={() => setActionDialog('deactivate')}>
                    <UserX className="h-4 w-4 mr-1" />Deactivate
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setActionDialog('activate')}>
                    <UserCheck className="h-4 w-4 mr-1" />Activate
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => {
                  setCloneCode(`${format.numberingCode}-COPY`);
                  setCloneName(`${format.numberingName || format.numberingCode} (Copy)`);
                  setActionDialog('clone');
                }}>
                  <Copy className="h-4 w-4 mr-1" />Clone
                </Button>
                <Button variant="outline" size="sm" onClick={() => setActionDialog('archive')}>
                  <Archive className="h-4 w-4 mr-1" />Archive
                </Button>
                {canDelete && (
                  <Button variant="outline" size="sm" onClick={() => setActionDialog('delete')}>
                    <Trash2 className="h-4 w-4 mr-1" />Delete
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => setActionDialog('reset')}>
                  <RotateCcw className="h-4 w-4 mr-1" />Reset Sequence
                </Button>
              </>
            )}
            {format.isDeleted && canEdit && (
              <Button variant="outline" size="sm" onClick={() => setActionDialog('restore')}>
                <RotateCcw className="h-4 w-4 mr-1" />Restore
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <ModuleBadge module={format.moduleName} />
        <ResetFrequencyBadge value={format.resetFrequency} />
        <StatusBadge status={format.isDeleted ? 'Deleted' : format.status} />
        {format.isArchived && <Badge variant="outline" className="text-amber-700 border-amber-300">Archived</Badge>}
        {!isNumberingActive(format) && !format.isDeleted && (
          <Badge variant="secondary">Not active for new records</Badge>
        )}
        {format.autoGenerateEnabled && (
          <Badge variant="outline" className="text-green-700">Auto Generate</Badge>
        )}
        {format.manualOverrideAllowed && (
          <Badge variant="outline" className="text-orange-700">Manual Override</Badge>
        )}
        {primaryModules.length > 0 && (
          <Badge variant="secondary"><Link2 className="h-3 w-3 mr-1" />{primaryModules.length} module link(s)</Badge>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="preview">Number Preview</TabsTrigger>
          <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />Generated Numbers</TabsTrigger>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Rule Profile</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              {overviewFields.map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-muted-foreground">{f.label}</p>
                  <p className="font-medium break-words">{String(f.value ?? '-')}</p>
                </div>
              ))}
              {format.description && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{format.description}</p>
                </div>
              )}
              {format.remarks && (
                <div className="sm:col-span-2 md:col-span-3">
                  <p className="text-xs text-muted-foreground">Remarks</p>
                  <p className="font-medium">{format.remarks}</p>
                </div>
              )}
              <div className="sm:col-span-2 md:col-span-3">
                <p className="text-xs text-muted-foreground">Example Preview</p>
                <p className="font-mono font-semibold">{format.exampleNumberPreview || livePreview}</p>
              </div>
            </CardContent>
          </Card>
          <FormatBuilder
            tokens={tokens}
            onChange={() => {}}
            formValues={{
              numberingCode: format.numberingCode,
              moduleName: format.moduleName as DocumentNumberingFormData['moduleName'],
              documentType: format.documentType,
              prefix: format.prefix,
              siteCode: format.siteCode,
              departmentCode: format.departmentCode,
              productCodeOptional: format.productCodeOptional,
              yearFormat: format.yearFormat,
              monthFormat: format.monthFormat,
              separator: format.separator,
              runningNumberLength: format.runningNumberLength,
              currentRunningNumber: format.currentRunningNumber,
              resetFrequency: format.resetFrequency,
              revisionFormat: format.revisionFormat,
              formatTokens: format.formatTokens,
              autoGenerateEnabled: format.autoGenerateEnabled,
              manualOverrideAllowed: format.manualOverrideAllowed,
              remarks: format.remarks,
            }}
            readOnly
          />
        </TabsContent>

        <TabsContent value="preview" className="mt-4 space-y-4">
          <Card className="border-emerald-200 bg-emerald-50/50">
            <CardHeader><CardTitle className="text-base text-emerald-900">Live Preview</CardTitle></CardHeader>
            <CardContent>
              <p className="text-2xl font-mono font-semibold text-emerald-800 break-all">{livePreview}</p>
              <p className="text-sm text-emerald-700 mt-2">Next sequence based on current running number</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex flex-wrap gap-3">
              <Button variant="outline" disabled={actionLoading} onClick={runTestPreview}>
                <Play className="h-4 w-4 mr-1" />Test Generate (Preview)
              </Button>
              {canEdit && isNumberingActive(format) && (
                <Button className="bg-blue-600" disabled={actionLoading} onClick={() => setActionDialog('generate')}>
                  <Play className="h-4 w-4 mr-1" />Generate Number (Real)
                </Button>
              )}
            </CardContent>
          </Card>
          {(previewResult || generatedResult) && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="pt-4 space-y-2">
                {previewResult && (
                  <p className="text-sm">Preview: <span className="font-mono font-semibold">{previewResult}</span></p>
                )}
                {generatedResult && (
                  <p className="text-sm">Generated: <span className="font-mono font-semibold">{generatedResult}</span></p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Generated Numbers / History</CardTitle></CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <EmptyState title="No generated numbers yet" />
              ) : (
                <div className="space-y-2">
                  {history.map((entry, i) => (
                    <div key={String(entry.id ?? i)} className="flex flex-col sm:flex-row sm:items-center gap-1 p-2 border rounded text-sm">
                      <span className="font-mono font-medium">{String(entry.lastGeneratedNumber ?? entry.number ?? '-')}</span>
                      <span className="text-xs text-muted-foreground">
                        Period: {String(entry.periodKey ?? '-')} · Updated: {String(entry.updatedAt ?? '-')}
                      </span>
                      <span className="text-xs text-muted-foreground sm:ml-auto">
                        Seq: {String(entry.currentValue ?? '-')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Audit Trail</CardTitle></CardHeader>
            <CardContent>
              {auditTrail.length === 0 ? (
                <EmptyState title="No audit entries" />
              ) : (
                <div className="space-y-2">
                  {auditTrail.map((entry, i) => (
                    <div key={String(entry.id ?? i)} className="flex flex-col sm:flex-row sm:items-center gap-1 p-2 border rounded text-sm">
                      <span className="font-medium">{String(entry.action ?? entry.actionType ?? '-')}</span>
                      <span className="text-xs text-muted-foreground">
                        {String(entry.userName ?? entry.changedByUserName ?? '-')} · {String(entry.timestamp ?? entry.dateTime ?? '-')}
                      </span>
                      {(entry.reason ?? entry.reasonForChange) ? (
                        <span className="text-xs text-muted-foreground sm:ml-auto">
                          {String(entry.reason ?? entry.reasonForChange)}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">QMS Module Integrations</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Active rules are resolved via module name and document type when generating numbers.
                Primary module: <strong>{format.moduleName}</strong> / {format.documentType}.
              </p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {INTEGRATION_MODULES.map((mod) => {
                  const active = format.moduleName === mod || primaryModules.includes(mod);
                  return (
                    <div key={mod} className={`border rounded-lg p-3 text-sm ${active ? 'border-blue-300 bg-blue-50' : 'opacity-60'}`}>
                      <p className="font-medium">{mod}</p>
                      <p className="text-xs text-muted-foreground">{active ? 'Uses this rule' : 'Available'}</p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={actionDialog === 'activate'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate Numbering Rule</DialogTitle>
            <DialogDescription>Activate &quot;{format.numberingCode}&quot; for new records?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button className="bg-green-600" disabled={actionLoading} onClick={() => runStatusToggle(true)}>
              {actionLoading ? 'Processing...' : 'Activate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === 'generate'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generate Document Number</DialogTitle>
            <DialogDescription>
              This will increment the sequence and assign a real document number. Audited action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button className="bg-blue-600" disabled={actionLoading} onClick={runRealGenerate}>
              {actionLoading ? 'Generating...' : 'Generate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === 'deactivate'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate Numbering Rule</DialogTitle>
            <DialogDescription>New records will not use this rule until reactivated.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={actionLoading} onClick={() => runStatusToggle(false)}>
              {actionLoading ? 'Processing...' : 'Deactivate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === 'archive'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive Numbering Rule</DialogTitle>
            <DialogDescription>Archive &quot;{format.numberingCode}&quot;?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={actionLoading} onClick={runArchive}>{actionLoading ? 'Archiving...' : 'Archive'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === 'delete'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Soft Delete Numbering Rule</DialogTitle>
            <DialogDescription>Deactivate the rule before deleting.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button variant="destructive" disabled={actionLoading} onClick={runDelete}>
              {actionLoading ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === 'restore'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore Numbering Rule</DialogTitle>
            <DialogDescription>Restore &quot;{format.numberingCode}&quot;?</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button className="bg-green-600" disabled={actionLoading} onClick={runRestore}>
              {actionLoading ? 'Restoring...' : 'Restore'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === 'reset'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Sequence</DialogTitle>
            <DialogDescription>Resets the current sequence to 0 for the current period. This action is audited.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change Reason *</Label>
            <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button disabled={actionLoading} onClick={runReset}>{actionLoading ? 'Resetting...' : 'Reset to 0'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={actionDialog === 'clone'} onOpenChange={() => closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clone Numbering Rule</DialogTitle>
            <DialogDescription>Create a copy with a new code.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>New Code *</Label>
              <Input value={cloneCode} onChange={(e) => setCloneCode(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>New Name</Label>
              <Input value={cloneName} onChange={(e) => setCloneName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Change Reason *</Label>
              <Textarea value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>Cancel</Button>
            <Button className="bg-blue-600" disabled={actionLoading} onClick={runClone}>
              {actionLoading ? 'Cloning...' : 'Clone'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
