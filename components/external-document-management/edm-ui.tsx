'use client';

import { PageLoader } from '@/components/loading/loaders';
import { cn } from '@/lib/utils';
import { externalDocStatusColor } from '@/lib/external-document-types';
import type { ExternalDocumentRecord, LinkedInternalDocument } from '@/lib/external-document-types';
import { Building2, Link2, FileText, Globe } from 'lucide-react';

export function ExternalStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', externalDocStatusColor(status), className)}>
      {status}
    </span>
  );
}

export function DocumentSourceCard({ record }: { record: ExternalDocumentRecord }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">{record.document_number}</p>
        <ExternalStatusBadge status={record.status} />
      </div>
      <h3 className="font-semibold truncate">{record.title}</h3>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Building2 className="h-3 w-3" /> {record.source_organization}
      </p>
      <div className="flex gap-2 flex-wrap text-xs">
        <span className="rounded bg-muted px-2 py-0.5">{record.document_type}</span>
        <span className="text-muted-foreground">{record.document_category}</span>
      </div>
      {record.revision_available && (
        <p className="text-xs text-amber-700 font-medium">Revision update available</p>
      )}
    </div>
  );
}

export function ExternalDocumentTable({
  records, selectedIds, toggleSelect, toggleSelectAll, isReadOnly,
  onReview, onApprove, onDetail,
}: {
  records: ExternalDocumentRecord[];
  selectedIds: string[];
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  isReadOnly?: boolean;
  onReview?: (id: string) => void;
  onApprove?: (id: string) => void;
  onDetail?: (r: ExternalDocumentRecord) => void;
}) {
  if (!records.length) return <p className="text-sm text-muted-foreground p-6 text-center">No external documents.</p>;
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
            <th className="p-3 text-left font-medium">Document #</th>
            <th className="p-3 text-left font-medium">Title</th>
            <th className="p-3 text-left font-medium">Type</th>
            <th className="p-3 text-left font-medium">Source</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Next Review</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b hover:bg-muted/30">
              {!isReadOnly && (
                <td className="p-3"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} /></td>
              )}
              <td className="p-3 font-mono text-xs">{r.document_number}</td>
              <td className="p-3">
                <p className="font-medium truncate max-w-[200px]">{r.title}</p>
                <p className="text-xs text-muted-foreground">v{r.current_version}</p>
              </td>
              <td className="p-3 text-xs">{r.document_type}</td>
              <td className="p-3 text-xs truncate max-w-[120px]">{r.source_organization}</td>
              <td className="p-3"><ExternalStatusBadge status={r.status} /></td>
              <td className="p-3 text-xs">{r.next_review_date || '—'}</td>
              <td className="p-3">
                <div className="flex gap-1 flex-wrap">
                  {onDetail && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onDetail(r)}>View</button>}
                  {onReview && r.status === 'Draft' && (
                    <button type="button" className="text-xs text-amber-600 hover:underline" onClick={() => onReview(r.id)}>Submit Review</button>
                  )}
                  {onApprove && r.status === 'Pending Review' && (
                    <button type="button" className="text-xs text-green-600 hover:underline" onClick={() => onApprove(r.id)}>Approve</button>
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

export function LinkedDocumentViewer({ links }: { links: LinkedInternalDocument[] }) {
  if (!links.length) return <p className="text-sm text-muted-foreground py-4 text-center">No linked internal documents.</p>;
  return (
    <div className="space-y-2">
      {links.map((l) => (
        <div key={l.id} className="flex gap-2 rounded border p-3 text-sm">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
          <div>
            <p className="font-medium">{l.internal_document_number}</p>
            <p className="text-xs text-muted-foreground truncate">{l.internal_document_title}</p>
            <p className="text-xs text-muted-foreground">{l.link_type}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function VersionHistory({ versions }: { versions: Array<{ id: string; revision_number?: string; revision_date?: string; change_summary?: string }> }) {
  if (!versions.length) return <p className="text-sm text-muted-foreground py-4 text-center">No version history.</p>;
  return (
    <div className="space-y-2">
      {versions.map((v) => (
        <div key={v.id} className="rounded border p-3 text-sm">
          <p className="font-medium">v{v.revision_number} — {v.revision_date}</p>
          <p className="text-xs text-muted-foreground">{v.change_summary}</p>
        </div>
      ))}
    </div>
  );
}

export function ReviewCalendar({ records }: { records: ExternalDocumentRecord[] }) {
  const upcoming = records
    .filter((r) => r.next_review_date)
    .sort((a, b) => (a.next_review_date || '').localeCompare(b.next_review_date || ''))
    .slice(0, 12);
  if (!upcoming.length) return <p className="text-sm text-muted-foreground py-4 text-center">No scheduled reviews.</p>;
  return (
    <div className="space-y-2">
      {upcoming.map((r) => (
        <div key={r.id} className="flex items-center gap-3 rounded border p-2 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{r.document_number}</p>
            <p className="text-xs text-muted-foreground">{r.next_review_date}</p>
          </div>
          <ExternalStatusBadge status={r.status} />
        </div>
      ))}
    </div>
  );
}

export function RegulatoryLibrary({ records }: { records: ExternalDocumentRecord[] }) {
  if (!records.length) return <p className="text-sm text-muted-foreground py-8 text-center">No regulatory documents.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {records.map((r) => (
        <div key={r.id} className="rounded-lg border p-4 space-y-1">
          <p className="font-mono text-xs text-muted-foreground">{r.document_number}</p>
          <h3 className="font-semibold text-sm">{r.title}</h3>
          <p className="text-xs flex items-center gap-1 text-muted-foreground">
            <Globe className="h-3 w-3" /> {r.issuing_authority || r.source_organization}
          </p>
          <ExternalStatusBadge status={r.status} />
        </div>
      ))}
    </div>
  );
}

export function LoadingSkeleton(_props: { rows?: number } = {}) {
  return <PageLoader message="Loading..." />;
}
