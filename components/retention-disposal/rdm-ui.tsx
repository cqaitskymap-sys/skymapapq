'use client';

import { PageLoader } from '@/components/loading/loaders';
import { cn } from '@/lib/utils';
import { retentionStatusColor } from '@/lib/retention-disposal-types';
import type {
  RetentionPolicyRecord, RetentionScheduleRecord, DisposalRequestRecord, DisposalCertificateRecord,
} from '@/lib/retention-disposal-types';
import { Lock, Shield, FileText, Calendar } from 'lucide-react';

export function RetentionStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', retentionStatusColor(status), className)}>
      {status}
    </span>
  );
}

export function RetentionPolicyCard({ policy }: { policy: RetentionPolicyRecord }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">{policy.policy_number}</p>
        <RetentionStatusBadge status={policy.status} />
      </div>
      <h3 className="font-semibold">{policy.policy_name}</h3>
      <p className="text-xs text-muted-foreground">{policy.document_type} · {policy.department}</p>
      <p className="text-xs">
        {policy.retention_period} {policy.retention_unit} from {policy.retention_trigger}
      </p>
      <p className="text-xs text-muted-foreground truncate">{policy.disposal_method}</p>
    </div>
  );
}

export function RetentionScheduleTable({
  schedules, selectedIds, toggleSelect, toggleSelectAll, isReadOnly,
  onDisposal, onHold, onDetail,
}: {
  schedules: RetentionScheduleRecord[];
  selectedIds: string[];
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  isReadOnly?: boolean;
  onDisposal?: (s: RetentionScheduleRecord) => void;
  onHold?: (s: RetentionScheduleRecord, type: 'legal' | 'regulatory') => void;
  onDetail?: (s: RetentionScheduleRecord) => void;
}) {
  if (!schedules.length) return <p className="text-sm text-muted-foreground p-6 text-center">No retention schedules.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {!isReadOnly && (
              <th className="p-3 w-8">
                <input type="checkbox" onChange={toggleSelectAll}
                  checked={schedules.every((r) => selectedIds.includes(r.id))} />
              </th>
            )}
            <th className="p-3 text-left font-medium">Schedule #</th>
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Policy</th>
            <th className="p-3 text-left font-medium">Expiry</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {schedules.map((s) => (
            <tr key={s.id} className="border-b hover:bg-muted/30">
              {!isReadOnly && (
                <td className="p-3"><input type="checkbox" checked={selectedIds.includes(s.id)} onChange={() => toggleSelect(s.id)} /></td>
              )}
              <td className="p-3 font-mono text-xs">{s.schedule_number}</td>
              <td className="p-3">
                <p className="font-medium truncate max-w-[180px]">{s.document_title}</p>
                <p className="text-xs text-muted-foreground">{s.document_number}</p>
              </td>
              <td className="p-3 text-xs">{s.policy_number}</td>
              <td className="p-3 text-xs">{s.retention_expiry_date || 'Permanent'}</td>
              <td className="p-3">
                <RetentionStatusBadge status={s.retention_status} />
                {(s.legal_hold || s.regulatory_hold) && <Lock className="h-3 w-3 inline ml-1 text-amber-600" />}
              </td>
              <td className="p-3">
                <div className="flex gap-1 flex-wrap">
                  {onDetail && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onDetail(s)}>View</button>}
                  {onDisposal && ['Expired', 'Active'].includes(s.retention_status) && !s.legal_hold && !s.regulatory_hold && (
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onDisposal(s)}>Dispose</button>
                  )}
                  {onHold && !s.legal_hold && (
                    <button type="button" className="text-xs text-amber-600 hover:underline" onClick={() => onHold(s, 'legal')}>Legal Hold</button>
                  )}
                  {onHold && !s.regulatory_hold && (
                    <button type="button" className="text-xs text-orange-600 hover:underline" onClick={() => onHold(s, 'regulatory')}>Reg. Hold</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DisposalRequestTable({
  disposals, isReadOnly, onApprove, onComplete,
}: {
  disposals: DisposalRequestRecord[];
  isReadOnly?: boolean;
  onApprove?: (id: string) => void;
  onComplete?: (id: string) => void;
}) {
  if (!disposals.length) return <p className="text-sm text-muted-foreground p-6 text-center">No disposal requests.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Request #</th>
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Method</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {disposals.map((d) => (
            <tr key={d.id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-mono text-xs">{d.request_number}</td>
              <td className="p-3">{d.document_number}</td>
              <td className="p-3 text-xs">{d.disposal_method}</td>
              <td className="p-3"><RetentionStatusBadge status={d.status} /></td>
              <td className="p-3">
                {onApprove && d.status === 'Pending Approval' && (
                  <button type="button" className="text-xs text-green-600 hover:underline" onClick={() => onApprove(d.id)}>Approve</button>
                )}
                {onComplete && d.status === 'Approved' && (
                  <button type="button" className="text-xs text-purple-600 hover:underline ml-2" onClick={() => onComplete(d.id)}>Complete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DisposalCertificateViewer({ certificate }: { certificate: DisposalCertificateRecord }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
      <p className="font-medium flex items-center gap-2"><FileText className="h-4 w-4" /> Disposal Certificate</p>
      <p className="font-mono text-xs">{certificate.certificate_number}</p>
      <p>{certificate.document_number} — {certificate.document_title}</p>
      <p className="text-xs text-muted-foreground">Method: {certificate.disposal_method}</p>
      <p className="text-xs">Disposed: {certificate.disposal_date} by {certificate.disposed_by_name}</p>
    </div>
  );
}

export function LegalHoldPanel({ schedule }: { schedule: RetentionScheduleRecord }) {
  if (!schedule.legal_hold && schedule.retention_status !== 'Legal Hold') return null;
  return (
    <div className="rounded-lg border border-red-300 bg-red-50/50 p-4 text-sm">
      <p className="font-medium flex items-center gap-2 text-red-800"><Lock className="h-4 w-4" /> Legal Hold Active</p>
      <p className="text-xs mt-1">Disposal blocked until hold is released.</p>
    </div>
  );
}

export function RegulatoryHoldPanel({ schedule }: { schedule: RetentionScheduleRecord }) {
  if (!schedule.regulatory_hold && schedule.retention_status !== 'Regulatory Hold') return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-4 text-sm">
      <p className="font-medium flex items-center gap-2 text-amber-800"><Shield className="h-4 w-4" /> Regulatory Hold Active</p>
      <p className="text-xs mt-1">Disposal blocked until hold is released.</p>
    </div>
  );
}

export function RetentionCalendar({ schedules }: { schedules: RetentionScheduleRecord[] }) {
  const upcoming = schedules
    .filter((s) => s.retention_expiry_date)
    .sort((a, b) => (a.retention_expiry_date || '').localeCompare(b.retention_expiry_date || ''))
    .slice(0, 12);
  if (!upcoming.length) return <p className="text-sm text-muted-foreground py-4 text-center">No upcoming expiry dates.</p>;
  return (
    <div className="space-y-2">
      {upcoming.map((s) => (
        <div key={s.id} className="flex items-center gap-3 rounded border p-2 text-sm">
          <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{s.document_number}</p>
            <p className="text-xs text-muted-foreground">{s.retention_expiry_date}</p>
          </div>
          <RetentionStatusBadge status={s.retention_status} />
        </div>
      ))}
    </div>
  );
}

export function LoadingSkeleton(_props: { rows?: number } = {}) {
  return <PageLoader message="Loading..." />;
}
