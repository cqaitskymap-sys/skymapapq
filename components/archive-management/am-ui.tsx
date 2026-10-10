'use client';

import { PageLoader } from '@/components/loading/loaders';
import { cn } from '@/lib/utils';
import { archiveStatusColor } from '@/lib/archive-management-types';
import type { ArchiveRecord } from '@/lib/archive-management-types';
import { formatStorageBytes } from '@/lib/archive-management-records';
import { AlertTriangle, Archive, Lock, Shield, CheckCircle2, XCircle } from 'lucide-react';

export function ArchiveStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', archiveStatusColor(status), className)}>
      {status}
    </span>
  );
}

export function ArchiveCard({ record }: { record: ArchiveRecord }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">{record.archive_number}</p>
        <ArchiveStatusBadge status={record.archive_status} />
      </div>
      <h3 className="font-semibold truncate">{record.document_title}</h3>
      <p className="text-xs text-muted-foreground">{record.document_number} · v{record.version}</p>
      <div className="flex gap-2 flex-wrap text-xs">
        <span className="rounded bg-muted px-2 py-0.5">{record.archive_category}</span>
        <span className="text-muted-foreground">{record.department}</span>
      </div>
      {(record.legal_hold || record.regulatory_hold) && (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <Lock className="h-3 w-3" /> Hold active
        </p>
      )}
    </div>
  );
}

export function ChecksumCard({ record, onVerify }: { record: ArchiveRecord; onVerify?: () => void }) {
  return (
    <div className={cn('rounded-lg border p-4 space-y-2 text-sm', record.checksum_verified ? 'border-green-300 bg-green-50/30' : 'bg-card')}>
      <p className="font-medium flex items-center gap-2">
        {record.checksum_verified ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}
        Integrity Checksum
      </p>
      <p className="font-mono text-xs break-all text-muted-foreground">{record.checksum || 'Not generated'}</p>
      {record.checksum_verified_at && (
        <p className="text-xs text-muted-foreground">Verified: {new Date(record.checksum_verified_at).toLocaleString()}</p>
      )}
      {onVerify && !record.checksum_verified && (
        <button type="button" onClick={onVerify} className="text-xs text-blue-600 hover:underline">Verify checksum</button>
      )}
    </div>
  );
}

export function RetentionPolicyViewer({ record }: { record: ArchiveRecord }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
      <p className="font-medium">Retention Policy</p>
      <p>{record.retention_policy || 'Not specified'}</p>
      {record.retention_expiry_date && (
        <p className="text-xs text-muted-foreground">Expires: {record.retention_expiry_date}</p>
      )}
      {record.archive_location && (
        <p className="text-xs"><span className="text-muted-foreground">Location:</span> {record.archive_location}</p>
      )}
      <p className="text-xs text-muted-foreground">Storage: {record.storage_class} / {record.storage_tier}</p>
    </div>
  );
}

export function LegalHoldPanel({ record }: { record: ArchiveRecord }) {
  if (!record.legal_hold && !record.regulatory_hold) return null;
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-4 space-y-2 text-sm">
      <p className="font-medium flex items-center gap-2 text-amber-800">
        <Shield className="h-4 w-4" /> Active Holds
      </p>
      {record.legal_hold && <p className="flex items-center gap-1"><Lock className="h-3 w-3" /> Legal Hold</p>}
      {record.regulatory_hold && <p className="flex items-center gap-1"><Lock className="h-3 w-3" /> Regulatory Hold</p>}
    </div>
  );
}

export function StorageViewer({ records }: { records: ArchiveRecord[] }) {
  const total = records.reduce((s, r) => s + (r.storage_bytes || 0), 0);
  const byTier = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.storage_tier] = (acc[r.storage_tier] || 0) + (r.storage_bytes || 0);
    return acc;
  }, {});
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3 text-sm">
      <p className="font-medium flex items-center gap-2"><Archive className="h-4 w-4" /> Storage Overview</p>
      <p>Total: <strong>{formatStorageBytes(total)}</strong></p>
      <div className="space-y-1">
        {Object.entries(byTier).map(([tier, bytes]) => (
          <div key={tier} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{tier}</span>
            <span>{formatStorageBytes(bytes)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ArchiveBrowser({ records, onSelect }: { records: ArchiveRecord[]; onSelect?: (r: ArchiveRecord) => void }) {
  if (!records.length) return <p className="text-sm text-muted-foreground py-8 text-center">No archived documents found.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {records.map((r) => (
        <button key={r.id} type="button" onClick={() => onSelect?.(r)} className="text-left">
          <ArchiveCard record={r} />
        </button>
      ))}
    </div>
  );
}

export function ArchiveTable({
  records, selectedIds, toggleSelect, toggleSelectAll, isReadOnly,
  onApprove, onComplete, onRestore, onVerify, onDetail,
}: {
  records: ArchiveRecord[];
  selectedIds: string[];
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  isReadOnly?: boolean;
  onApprove?: (id: string) => void;
  onComplete?: (id: string) => void;
  onRestore?: (r: ArchiveRecord) => void;
  onVerify?: (id: string) => void;
  onDetail?: (r: ArchiveRecord) => void;
}) {
  if (!records.length) return <p className="text-sm text-muted-foreground p-6 text-center">No records.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {!isReadOnly && (
              <th className="p-3 w-8">
                <input type="checkbox" onChange={toggleSelectAll}
                  checked={records.length > 0 && records.every((r) => selectedIds.includes(r.id))} />
              </th>
            )}
            <th className="p-3 text-left font-medium">Archive #</th>
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Category</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Department</th>
            <th className="p-3 text-left font-medium">Archive Date</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b hover:bg-muted/30">
              {!isReadOnly && (
                <td className="p-3">
                  <input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} />
                </td>
              )}
              <td className="p-3 font-mono text-xs">{r.archive_number}</td>
              <td className="p-3">
                <p className="font-medium truncate max-w-[200px]">{r.document_title}</p>
                <p className="text-xs text-muted-foreground">{r.document_number} v{r.version}</p>
              </td>
              <td className="p-3">{r.archive_category}</td>
              <td className="p-3"><ArchiveStatusBadge status={r.archive_status} /></td>
              <td className="p-3">{r.department}</td>
              <td className="p-3 text-xs">{r.archive_date || '—'}</td>
              <td className="p-3">
                <div className="flex gap-1 flex-wrap">
                  {onDetail && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onDetail(r)}>View</button>}
                  {onApprove && r.archive_status === 'Pending' && (
                    <button type="button" className="text-xs text-green-600 hover:underline" onClick={() => onApprove(r.id)}>Approve</button>
                  )}
                  {onComplete && r.archive_status === 'Approved' && (
                    <button type="button" className="text-xs text-purple-600 hover:underline" onClick={() => onComplete(r.id)}>Complete</button>
                  )}
                  {onRestore && r.archive_status === 'Archived' && r.restoration_allowed && (
                    <button type="button" className="text-xs text-orange-600 hover:underline" onClick={() => onRestore(r)}>Restore</button>
                  )}
                  {onVerify && r.checksum && !r.checksum_verified && (
                    <button type="button" className="text-xs text-muted-foreground hover:underline" onClick={() => onVerify(r.id)}>Verify</button>
                  )}
                  {(r.legal_hold || r.regulatory_hold) && (
                    <AlertTriangle className="h-3 w-3 text-amber-600 inline" />
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

export function LoadingSkeleton(_props: { rows?: number } = {}) {
  return <PageLoader message="Loading..." />;
}
