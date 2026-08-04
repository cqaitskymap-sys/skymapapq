'use client';

import Link from 'next/link';
import { Shield, ArrowLeft, Lock, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { StatusBadge } from '@/components/admin/dashboard/status-badge';
import { ModuleBadge } from '@/components/admin/workflows/module-badge';
import { ActionTypeBadge } from './action-type-badge';
import { AuditTimeline } from './audit-timeline';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AuditTrailEntry } from '@/lib/admin/schemas';
import { getRecordTimeline } from '@/lib/admin/audit-trail-service';

interface AuditTrailDetailViewProps {
  entry: AuditTrailEntry;
  allEntries?: AuditTrailEntry[];
  timelineLoading?: boolean;
}

function FieldRow({ label, value }: { label: string; value?: string | boolean | null }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 py-2 border-b border-slate-100 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm sm:col-span-2 break-all font-mono text-slate-800">
        {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}
      </span>
    </div>
  );
}

function toDiffString(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const str = toDiffString(value) ?? '—';
  try {
    const parsed = JSON.parse(str);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return str;
  }
}

function AuditDiffViewer({ oldValue, newValue, fieldName }: {
  oldValue?: string;
  newValue?: string;
  fieldName?: string;
}) {
  const oldFormatted = formatDiffValue(oldValue);
  const newFormatted = formatDiffValue(newValue);
  const hasChange = oldFormatted !== newFormatted;

  return (
    <div className="space-y-3">
      {fieldName && (
        <p className="text-sm font-medium text-slate-700">
          Field: <span className="font-mono">{fieldName}</span>
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-2">Previous Value</p>
          <pre className="text-xs bg-red-50 border border-red-100 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
            {oldFormatted}
          </pre>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 mb-2">New Value</p>
          <pre className="text-xs bg-emerald-50 border border-emerald-100 rounded-lg p-4 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
            {newFormatted}
          </pre>
        </div>
      </div>
      {!hasChange && (
        <p className="text-xs text-muted-foreground italic">Values are identical or empty.</p>
      )}
    </div>
  );
}

export function AuditTrailDetailView({
  entry,
  allEntries = [],
  timelineLoading = false,
}: AuditTrailDetailViewProps) {
  const recordTimeline = entry.recordId
    ? getRecordTimeline(allEntries, entry.recordId)
    : [entry];

  const hasFieldChange = Boolean(entry.fieldName || entry.oldValue || entry.newValue || entry.changedFields);

  return (
    <div className="space-y-6">
      <PageHeader
        title={entry.auditId || 'Audit Entry'}
        description={`${entry.moduleName}${entry.subModule ? ` · ${entry.subModule}` : ''} · ${entry.actionType}`}
        basePath="/admin"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/audit-trail">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Audit Trail
            </Link>
          </Button>
        }
      />

      <Card className="border-amber-200 bg-gradient-to-r from-amber-50/80 to-orange-50/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Shield className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-950 flex items-center gap-2">
              <Lock className="h-3.5 w-3.5" />
              Immutable Audit Record — Read Only
            </p>
            <p className="text-sm text-amber-900/90 mt-1">
              Tamper-proof append-only log compliant with FDA 21 CFR Part 11 and EU GMP Annex 11.
              Records cannot be edited or deleted from this interface.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <ActionTypeBadge action={entry.actionType} />
        <StatusBadge status={entry.status} />
        <ModuleBadge module={entry.moduleName} />
        {entry.isArchived && (
          <span className="text-xs px-2 py-1 rounded bg-slate-200 text-slate-700">Archived</span>
        )}
        {entry.eSignatureRequired && (
          <span className="text-xs px-2 py-1 rounded bg-indigo-100 text-indigo-800">E-Signature Required</span>
        )}
        {entry.integrityHash && (
          <span className="text-xs px-2 py-1 rounded bg-teal-100 text-teal-800">Integrity Verified</span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Audit Identity</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="Audit ID" value={entry.auditId} />
            <FieldRow label="Transaction ID" value={entry.transactionId} />
            <FieldRow label="Date Time" value={new Date(entry.dateTime).toLocaleString()} />
            <FieldRow label="Timezone" value={entry.timezone} />
            <FieldRow label="Module" value={entry.moduleName} />
            <FieldRow label="Sub Module" value={entry.subModule} />
            <FieldRow label="Screen" value={entry.screen} />
            <FieldRow label="Collection" value={entry.collectionName} />
            <FieldRow label="Record ID" value={entry.recordId} />
            <FieldRow label="Reference ID" value={entry.referenceId} />
            <FieldRow label="Document Number" value={entry.documentNumber} />
            <FieldRow label="Action Type" value={entry.actionType} />
            <FieldRow label="Description" value={entry.actionDescription} />
            <FieldRow label="Status" value={entry.status} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">User & Organization</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="User ID" value={entry.changedByUserId || entry.userId} />
            <FieldRow label="Employee ID" value={entry.employeeId} />
            <FieldRow label="Username" value={entry.username} />
            <FieldRow label="Full Name" value={entry.fullName || entry.changedByUserName} />
            <FieldRow label="Role" value={entry.changedByRole || entry.role} />
            <FieldRow label="Department" value={entry.department} />
            <FieldRow label="Site" value={entry.site} />
            <FieldRow label="Business Unit" value={entry.businessUnit} />
            <FieldRow label="Company" value={entry.company} />
            <FieldRow label="Reason for Change" value={entry.reasonForChange || entry.reason} />
            <FieldRow label="Remarks" value={entry.remarks} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Session & Device</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="IP Address" value={entry.ipAddress} />
            <FieldRow label="Device" value={entry.deviceInfo || entry.device} />
            <FieldRow label="Browser" value={entry.browserInfo} />
            <FieldRow label="Operating System" value={entry.operatingSystem} />
            <FieldRow label="Session ID" value={entry.sessionId} />
            <FieldRow label="Request ID" value={entry.requestId} />
            <FieldRow label="Location" value={entry.location} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Workflow & E-Signature</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="Workflow ID" value={entry.workflowId} />
            <FieldRow label="Approval Level" value={entry.approvalLevel} />
            <FieldRow label="E-Sign Required" value={entry.eSignatureRequired} />
            <FieldRow label="E-Sign Status" value={entry.eSignatureStatus} />
            <FieldRow label="E-Sign ID" value={entry.eSignatureId} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Data Integrity Chain</CardTitle></CardHeader>
          <CardContent>
            <FieldRow label="Integrity Hash" value={entry.integrityHash} />
            <FieldRow label="Previous Hash" value={entry.previousHash} />
            {!entry.integrityHash && (
              <p className="text-xs text-muted-foreground mt-2">
                No integrity hash on this record (legacy entry or non-chain log).
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {hasFieldChange && (
        <Card>
          <CardHeader><CardTitle className="text-base">Field Change Diff</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <FieldRow label="Changed Fields" value={entry.changedFields} />
            <AuditDiffViewer
              fieldName={entry.fieldName}
              oldValue={toDiffString(entry.oldValue)}
              newValue={toDiffString(entry.newValue)}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Record History Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading related record activity…
            </div>
          ) : (
            <AuditTimeline
              entries={recordTimeline}
              emptyMessage="No related record activity found"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
