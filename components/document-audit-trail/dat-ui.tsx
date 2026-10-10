'use client';

import { PageLoader } from '@/components/loading/loaders';
import { cn } from '@/lib/utils';
import { auditStatusColor, riskLevelColor } from '@/lib/document-audit-trail-types';
import type { DocumentAuditEntry, AuditExportRecord } from '@/lib/document-audit-trail-types';
import { formatAuditLocalTime } from '@/lib/document-audit-trail-records';
import { Shield, ShieldCheck, ShieldAlert, Lock, Hash } from 'lucide-react';

export function AuditStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', auditStatusColor(status), className)}>
      {status}
    </span>
  );
}

export function RiskBadge({ level }: { level: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', riskLevelColor(level))}>{level}</span>
  );
}

export function AuditTimeline({ events, onSelect }: { events: DocumentAuditEntry[]; onSelect?: (e: DocumentAuditEntry) => void }) {
  if (!events.length) return <p className="text-sm text-muted-foreground p-6 text-center">No audit events.</p>;
  return (
    <div className="relative pl-6 space-y-4 py-4">
      <div className="absolute left-2 top-0 bottom-0 w-0.5 bg-border" />
      {events.map((e) => (
        <button key={e.id || e.audit_id} type="button" onClick={() => onSelect?.(e)}
          className="relative block w-full text-left rounded-lg border bg-card p-3 hover:border-blue-300 transition-colors">
          <span className="absolute -left-[22px] top-4 h-3 w-3 rounded-full bg-blue-500 ring-2 ring-background" />
          <div className="flex flex-wrap justify-between gap-2">
            <p className="font-medium text-sm">{e.event_type}</p>
            <RiskBadge level={e.risk_level} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{e.document_number || e.entity_id} · {e.performer_name}</p>
          <p className="text-xs text-muted-foreground">{formatAuditLocalTime(e.timestamp_utc)}</p>
          {e.action_summary && <p className="text-xs mt-1 truncate">{e.action_summary}</p>}
        </button>
      ))}
    </div>
  );
}

export function AuditTable({ entries, onSelect }: { entries: DocumentAuditEntry[]; onSelect?: (e: DocumentAuditEntry) => void }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground p-6 text-center">No audit records.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Audit #</th>
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Event</th>
            <th className="p-3 text-left font-medium">Category</th>
            <th className="p-3 text-left font-medium">User</th>
            <th className="p-3 text-left font-medium">Risk</th>
            <th className="p-3 text-left font-medium">Timestamp</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id || e.audit_id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-mono text-xs">{e.audit_number.slice(0, 16)}</td>
              <td className="p-3">
                <p className="font-medium truncate max-w-[140px]">{e.document_number || e.entity_id}</p>
                <p className="text-xs text-muted-foreground">{e.module}</p>
              </td>
              <td className="p-3 text-xs">{e.event_type}</td>
              <td className="p-3 text-xs">{e.event_category}</td>
              <td className="p-3 text-xs">{e.performer_name}</td>
              <td className="p-3"><RiskBadge level={e.risk_level} /></td>
              <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{formatAuditLocalTime(e.timestamp_utc)}</td>
              <td className="p-3">
                {onSelect && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onSelect(e)}>Details</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HashVerificationPanel({ entry, verification }: {
  entry: DocumentAuditEntry;
  verification?: { valid: boolean; computed: string; stored: string; message?: string };
}) {
  const valid = verification?.valid ?? true;
  return (
    <div className={cn('rounded-lg border p-4 space-y-3', valid ? 'border-green-200 bg-green-50/50' : 'border-red-200 bg-red-50/50')}>
      <div className="flex items-center gap-2">
        {valid ? <ShieldCheck className="h-5 w-5 text-green-600" /> : <ShieldAlert className="h-5 w-5 text-red-600" />}
        <p className="font-medium text-sm">{valid ? 'Integrity Verified' : 'Tamper Detected'}</p>
      </div>
      <div className="text-xs space-y-1 font-mono">
        <p className="flex items-center gap-1"><Hash className="h-3 w-3" /> Stored: {verification?.stored || entry.record_hash || '—'}</p>
        <p className="flex items-center gap-1"><Hash className="h-3 w-3" /> Computed: {verification?.computed || '—'}</p>
        <p>Fingerprint: {entry.digital_fingerprint}</p>
      </div>
      {verification?.message && <p className="text-xs text-muted-foreground">{verification.message}</p>}
    </div>
  );
}

export function CorrelationViewer({ events, correlationId }: { events: DocumentAuditEntry[]; correlationId: string }) {
  if (!correlationId) return null;
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <p className="font-medium text-sm flex items-center gap-2"><Lock className="h-4 w-4" /> Correlation: {correlationId}</p>
      <AuditTimeline events={events} />
    </div>
  );
}

export function EntityHistoryViewer({ events, entityId }: { events: DocumentAuditEntry[]; entityId: string }) {
  if (!entityId) return null;
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="font-medium text-sm mb-2">Entity History: {entityId}</p>
      <AuditTimeline events={events} />
    </div>
  );
}

export function ExportHistoryTable({ records }: { records: AuditExportRecord[] }) {
  if (!records.length) return <p className="text-sm text-muted-foreground p-6 text-center">No export history.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Export ID</th>
            <th className="p-3 text-left font-medium">Format</th>
            <th className="p-3 text-left font-medium">Records</th>
            <th className="p-3 text-left font-medium">Exported By</th>
            <th className="p-3 text-left font-medium">Date</th>
            <th className="p-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-mono text-xs">{r.export_id}</td>
              <td className="p-3 uppercase text-xs">{r.format}</td>
              <td className="p-3">{r.record_count}</td>
              <td className="p-3 text-xs">{r.exported_by_name}</td>
              <td className="p-3 text-xs">{formatAuditLocalTime(r.exported_at)}</td>
              <td className="p-3"><AuditStatusBadge status={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditDetailPanel({ entry, verification }: {
  entry: DocumentAuditEntry;
  verification?: { valid: boolean; computed: string; stored: string; message?: string };
}) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
      <div className="flex justify-between gap-2">
        <h3 className="font-semibold">{entry.event_type}</h3>
        <RiskBadge level={entry.risk_level} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <p><span className="text-muted-foreground">Audit #:</span> {entry.audit_number}</p>
        <p><span className="text-muted-foreground">Module:</span> {entry.module}</p>
        <p><span className="text-muted-foreground">Document:</span> {entry.document_number || entry.document_id}</p>
        <p><span className="text-muted-foreground">Version:</span> {entry.document_version || '—'}</p>
        <p><span className="text-muted-foreground">User:</span> {entry.performer_name} ({entry.performer_role})</p>
        <p><span className="text-muted-foreground">Department:</span> {entry.department || '—'}</p>
        <p><span className="text-muted-foreground">UTC:</span> {entry.timestamp_utc}</p>
        <p><span className="text-muted-foreground">Local:</span> {entry.local_timestamp}</p>
        <p><span className="text-muted-foreground">IP:</span> {entry.ip_address || '—'}</p>
        <p><span className="text-muted-foreground">Device:</span> {entry.device_information || '—'}</p>
        {entry.correlation_id && <p className="sm:col-span-2"><span className="text-muted-foreground">Correlation:</span> {entry.correlation_id}</p>}
        {entry.electronic_signature_id && <p className="sm:col-span-2"><span className="text-muted-foreground">E-Signature:</span> {entry.electronic_signature_id}</p>}
        {entry.reason_for_change && <p className="sm:col-span-2"><span className="text-muted-foreground">Reason:</span> {entry.reason_for_change}</p>}
      </div>
      {(entry.previous_value || entry.new_value) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {entry.previous_value && <div className="rounded bg-muted/50 p-2 text-xs"><p className="font-medium mb-1">Previous</p><p className="break-all">{entry.previous_value.slice(0, 300)}</p></div>}
          {entry.new_value && <div className="rounded bg-muted/50 p-2 text-xs"><p className="font-medium mb-1">New</p><p className="break-all">{entry.new_value.slice(0, 300)}</p></div>}
        </div>
      )}
      <HashVerificationPanel entry={entry} verification={verification} />
    </div>
  );
}

export function LoadingSkeleton(_props: { rows?: number } = {}) {
  return <PageLoader message="Loading..." />;
}
