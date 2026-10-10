'use client';

import { PageLoader } from '@/components/loading/loaders';
import { cn } from '@/lib/utils';
import { watermarkStatusColor } from '@/lib/watermark-types';
import type {
  WatermarkTemplateRecord, WatermarkRuleRecord, WatermarkHistoryRecord, DocumentWatermarkRecord,
} from '@/lib/watermark-types';
import { QrCode, ScanLine, Droplets } from 'lucide-react';

export function WatermarkStatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', watermarkStatusColor(status), className)}>
      {status}
    </span>
  );
}

export function WatermarkPreview({ template, previewText }: { template: WatermarkTemplateRecord; previewText?: string }) {
  const text = previewText || template.display_text;
  return (
    <div className="relative rounded-lg border bg-white dark:bg-slate-900 aspect-[4/3] overflow-hidden">
      <div className="absolute inset-0 p-4">
        <div className="h-full w-full rounded border border-dashed border-muted-foreground/30 bg-muted/20 flex items-center justify-center">
          <p
            className="select-none font-bold text-center whitespace-pre-wrap pointer-events-none"
            style={{
              color: template.color,
              opacity: template.opacity,
              fontSize: Math.min(template.font_size, 32),
              fontFamily: template.font_family,
              transform: template.position === 'Diagonal' ? `rotate(${template.rotation}deg)` : undefined,
            }}
          >
            {text}
          </p>
        </div>
      </div>
      <div className="absolute bottom-2 left-2 flex gap-2 text-[10px] text-muted-foreground">
        {template.qr_code_enabled && <span className="flex items-center gap-0.5"><QrCode className="h-3 w-3" /> QR</span>}
        {template.barcode_enabled && <span className="flex items-center gap-0.5"><ScanLine className="h-3 w-3" /> Barcode</span>}
      </div>
    </div>
  );
}

export function QRCodePanel({ qrCode }: { qrCode: string }) {
  if (!qrCode) return null;
  return (
    <div className="rounded-lg border bg-card p-4 text-sm space-y-2">
      <p className="font-medium flex items-center gap-2"><QrCode className="h-4 w-4" /> QR Code Metadata</p>
      <p className="font-mono text-xs break-all text-muted-foreground">{qrCode}</p>
    </div>
  );
}

export function BarcodePanel({ barcode }: { barcode: string }) {
  if (!barcode) return null;
  return (
    <div className="rounded-lg border bg-card p-4 text-sm space-y-2">
      <p className="font-medium flex items-center gap-2"><ScanLine className="h-4 w-4" /> Barcode</p>
      <p className="font-mono text-lg tracking-widest">{barcode}</p>
    </div>
  );
}

export function WatermarkTemplateCard({ template, onSelect }: { template: WatermarkTemplateRecord; onSelect?: (t: WatermarkTemplateRecord) => void }) {
  return (
    <button type="button" onClick={() => onSelect?.(template)}
      className="rounded-lg border bg-card p-4 text-left space-y-2 hover:border-blue-300 transition-colors w-full">
      <div className="flex justify-between gap-2">
        <p className="font-semibold truncate flex items-center gap-1"><Droplets className="h-4 w-4 text-blue-500" /> {template.template_name}</p>
        <WatermarkStatusBadge status={template.status} />
      </div>
      <p className="text-xs text-muted-foreground">{template.watermark_type} · {template.trigger_event}</p>
      <p className="text-sm truncate" style={{ color: template.color }}>{template.display_text}</p>
    </button>
  );
}

export function WatermarkTemplateTable({
  templates, selectedIds, toggleSelect, toggleSelectAll, isReadOnly, onPreview,
}: {
  templates: WatermarkTemplateRecord[];
  selectedIds: string[];
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  isReadOnly?: boolean;
  onPreview?: (t: WatermarkTemplateRecord) => void;
}) {
  if (!templates.length) return <p className="text-sm text-muted-foreground p-6 text-center">No watermark templates.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            {!isReadOnly && (
              <th className="p-3 w-8">
                <input type="checkbox" onChange={toggleSelectAll} checked={templates.every((t) => selectedIds.includes(t.id))} />
              </th>
            )}
            <th className="p-3 text-left font-medium">Template</th>
            <th className="p-3 text-left font-medium">Type</th>
            <th className="p-3 text-left font-medium">Trigger</th>
            <th className="p-3 text-left font-medium">Visibility</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.id} className="border-b hover:bg-muted/30">
              {!isReadOnly && (
                <td className="p-3"><input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleSelect(t.id)} /></td>
              )}
              <td className="p-3">
                <p className="font-medium">{t.template_name}</p>
                <p className="text-xs text-muted-foreground truncate max-w-[200px]">{t.display_text}</p>
              </td>
              <td className="p-3 text-xs">{t.watermark_type}</td>
              <td className="p-3 text-xs">{t.trigger_event}</td>
              <td className="p-3 text-xs">{t.visibility}</td>
              <td className="p-3"><WatermarkStatusBadge status={t.status} /></td>
              <td className="p-3">
                {onPreview && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onPreview(t)}>Preview</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WatermarkHistoryTable({ events }: { events: WatermarkHistoryRecord[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground p-6 text-center">No watermark events.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Type</th>
            <th className="p-3 text-left font-medium">Trigger</th>
            <th className="p-3 text-left font-medium">Rendered Text</th>
            <th className="p-3 text-left font-medium">User</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className="border-b hover:bg-muted/30">
              <td className="p-3">
                <p className="font-medium truncate max-w-[160px]">{e.document_title || e.document_number}</p>
                <p className="text-xs text-muted-foreground">{e.document_number} v{e.version}</p>
              </td>
              <td className="p-3 text-xs">{e.watermark_type}</td>
              <td className="p-3 text-xs">{e.trigger_event}</td>
              <td className="p-3 text-xs truncate max-w-[180px]">{e.rendered_text || e.display_text}</td>
              <td className="p-3 text-xs">{e.user_name}</td>
              <td className="p-3"><WatermarkStatusBadge status={e.event_status} /></td>
              <td className="p-3 text-xs text-muted-foreground">{e.created_at?.slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocumentWatermarkTable({ records, onDetail }: {
  records: DocumentWatermarkRecord[];
  onDetail?: (r: DocumentWatermarkRecord) => void;
}) {
  if (!records.length) return <p className="text-sm text-muted-foreground p-6 text-center">No watermarked documents.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Document</th>
            <th className="p-3 text-left font-medium">Watermark Type</th>
            <th className="p-3 text-left font-medium">Trigger</th>
            <th className="p-3 text-left font-medium">Copy #</th>
            <th className="p-3 text-left font-medium">Applied By</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id} className="border-b hover:bg-muted/30">
              <td className="p-3">
                <p className="font-medium truncate max-w-[180px]">{r.document_title}</p>
                <p className="text-xs text-muted-foreground">{r.document_number} v{r.version}</p>
              </td>
              <td className="p-3 text-xs">{r.watermark_type}</td>
              <td className="p-3 text-xs">{r.trigger_event}</td>
              <td className="p-3 font-mono text-xs">{r.copy_number || '—'}</td>
              <td className="p-3 text-xs">{r.applied_by_name}</td>
              <td className="p-3">
                {onDetail && <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => onDetail(r)}>View</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RuleEngineTable({
  rules, isReadOnly, onApprove,
}: {
  rules: WatermarkRuleRecord[];
  isReadOnly?: boolean;
  onApprove?: (id: string) => void;
}) {
  if (!rules.length) return <p className="text-sm text-muted-foreground p-6 text-center">No watermark rules configured.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="p-3 text-left font-medium">Rule</th>
            <th className="p-3 text-left font-medium">Template</th>
            <th className="p-3 text-left font-medium">Doc Status</th>
            <th className="p-3 text-left font-medium">Trigger</th>
            <th className="p-3 text-left font-medium">Priority</th>
            <th className="p-3 text-left font-medium">Status</th>
            <th className="p-3 text-left font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} className="border-b hover:bg-muted/30">
              <td className="p-3 font-medium">{r.rule_name}</td>
              <td className="p-3 text-xs">{r.template_name}</td>
              <td className="p-3 text-xs">{r.document_status}</td>
              <td className="p-3 text-xs">{r.trigger_event}</td>
              <td className="p-3">{r.priority}</td>
              <td className="p-3"><WatermarkStatusBadge status={r.status} /></td>
              <td className="p-3">
                {!isReadOnly && onApprove && r.status === 'Pending Approval' && (
                  <button type="button" className="text-xs text-green-600 hover:underline" onClick={() => onApprove(r.id)}>Approve</button>
                )}
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
