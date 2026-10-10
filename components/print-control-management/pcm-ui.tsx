'use client';

import { PageLoader } from '@/components/loading/loaders';
import { cn } from '@/lib/utils';
import { printStatusColor } from '@/lib/print-control-types';
import type { PrintRequestRecord, PrintCopyRecord } from '@/lib/print-control-types';
import { QrCode, ScanLine, Copy } from 'lucide-react';

export function PrintStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', printStatusColor(status), className)}>
      {status}
    </span>
  );
}

export function ControlledCopyCard({ copy }: { copy: PrintCopyRecord }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-2">
      <div className="flex justify-between gap-2">
        <p className="font-mono text-xs text-muted-foreground">{copy.controlled_copy_number}</p>
        <PrintStatusBadge status={copy.copy_status} />
      </div>
      <h3 className="font-semibold truncate">{copy.document_title}</h3>
      <p className="text-xs text-muted-foreground">{copy.document_number} · v{copy.version}</p>
      <div className="flex gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><ScanLine className="h-3 w-3" /> {copy.barcode.slice(0, 12)}</span>
      </div>
      {copy.issued_to_name && <p className="text-xs">Issued to: {copy.issued_to_name}</p>}
      {copy.is_replacement && <p className="text-xs text-amber-700">Replacement copy</p>}
    </div>
  );
}

export function BarcodeViewer({ barcode }: { barcode: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-sm space-y-2">
      <p className="font-medium flex items-center gap-2"><ScanLine className="h-4 w-4" /> Barcode</p>
      <p className="font-mono text-lg tracking-widest">{barcode}</p>
    </div>
  );
}

export function QRCodeViewer({ qrCode }: { qrCode: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-sm space-y-2">
      <p className="font-medium flex items-center gap-2"><QrCode className="h-4 w-4" /> QR Code Data</p>
      <p className="font-mono text-xs break-all text-muted-foreground">{qrCode}</p>
    </div>
  );
}

export function PrintRequestTable({
  requests, selectedIds, toggleSelect, toggleSelectAll, isReadOnly,
  onApprove, onGenerate, onDetail,
}: {
  requests: PrintRequestRecord[];
  selectedIds: string[];
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  isReadOnly?: boolean;
  onApprove?: (id: string) => void;
  onGenerate?: (id: string) => void;
  onDetail?: (r: PrintRequestRecord) => void;
}) {
  if (!requests.length) return <p className="text-sm text-muted-foreground p-6 text-center">No print requests.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {!isReadOnly && (
              <th className="p-3 w-8">
                <input type="checkbox" onChange={toggleSelectAll}
                  checked={requests.every((r) => selectedIds.includes(r.id))} />
              </th>
            )}
            <th className="p-3 text-left font-medium">Print #</th>
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Type</th>
            <th className="p-3 text-left font-medium">Copies</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} className="border-b hover:bg-muted/30">
              {!isReadOnly && (
                <td className="p-3"><input type="checkbox" checked={selectedIds.includes(r.id)} onChange={() => toggleSelect(r.id)} /></td>
              )}
              <td className="p-3 font-mono text-xs">{r.print_number}</td>
              <td className="p-3">
                <p className="font-medium truncate max-w-[180px]">{r.document_title}</p>
                <p className="text-xs text-muted-foreground">{r.document_number} v{r.version}</p>
              </td>
              <td className="p-3 text-xs">{r.print_type}</td>
              <td className="p-3">{r.total_copies}</td>
              <td className="p-3"><PrintStatusBadge status={r.print_status} /></td>
              <td className="p-3">
                <div className="flex gap-1 flex-wrap">
                  {onDetail && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onDetail(r)}>View</button>}
                  {onApprove && r.print_status === 'Pending Approval' && (
                    <button type="button" className="text-xs text-green-600 hover:underline" onClick={() => onApprove(r.id)}>Approve</button>
                  )}
                  {onGenerate && r.print_status === 'Approved' && (
                    <button type="button" className="text-xs text-indigo-600 hover:underline" onClick={() => onGenerate(r.id)}>Generate</button>
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

export function CopyTrackingTable({
  copies, isReadOnly, onIssue, onReturn, onReconcile, onDestroy,
}: {
  copies: PrintCopyRecord[];
  isReadOnly?: boolean;
  onIssue?: (c: PrintCopyRecord) => void;
  onReturn?: (c: PrintCopyRecord) => void;
  onReconcile?: (c: PrintCopyRecord) => void;
  onDestroy?: (c: PrintCopyRecord) => void;
}) {
  if (!copies.length) return <p className="text-sm text-muted-foreground p-6 text-center">No copies tracked.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Copy #</th>
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Issued To</th>
            <th className="p-3 text-left font-medium">Return Due</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {copies.map((c) => (
            <tr key={c.id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-mono text-xs">{c.controlled_copy_number}</td>
              <td className="p-3">{c.document_number}</td>
              <td className="p-3"><PrintStatusBadge status={c.copy_status} /></td>
              <td className="p-3 text-xs">{c.issued_to_name || '—'}</td>
              <td className="p-3 text-xs">{c.return_due_date || '—'}</td>
              <td className="p-3">
                <div className="flex gap-1 flex-wrap">
                  {onIssue && c.copy_status === 'Printed' && (
                    <button type="button" className="text-xs text-green-600 hover:underline" onClick={() => onIssue(c)}>Issue</button>
                  )}
                  {onReturn && c.copy_status === 'Issued' && (
                    <button type="button" className="text-xs text-teal-600 hover:underline" onClick={() => onReturn(c)}>Return</button>
                  )}
                  {onReconcile && c.copy_status === 'Returned' && (
                    <button type="button" className="text-xs text-purple-600 hover:underline" onClick={() => onReconcile(c)}>Reconcile</button>
                  )}
                  {onDestroy && ['Returned', 'Reconciled'].includes(c.copy_status) && (
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onDestroy(c)}>Destroy</button>
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

export function ReconciliationPanel({ copy }: { copy: PrintCopyRecord }) {
  return (
    <div className="rounded-lg border bg-card p-4 text-sm space-y-2">
      <p className="font-medium flex items-center gap-2"><Copy className="h-4 w-4" /> Reconciliation</p>
      <p>Copy: {copy.controlled_copy_number}</p>
      <p>Status: {copy.reconciliation_status}</p>
      {copy.return_date && <p className="text-xs text-muted-foreground">Returned: {copy.return_date}</p>}
    </div>
  );
}

export function LoadingSkeleton(_props: { rows?: number } = {}) {
  return <PageLoader message="Loading..." />;
}
