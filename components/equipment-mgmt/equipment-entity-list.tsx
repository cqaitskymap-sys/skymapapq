'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Eye, Download } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { useEquipmentActor } from '@/hooks/use-equipment-mgmt';
import { canManageEquipment, canReportBreakdown } from '@/lib/equipment-mgmt-types';
import type { EquipmentRecord } from '@/lib/equipment-mgmt-types';

interface EquipmentEntityListProps {
  title: string;
  description: string;
  records: Record<string, unknown>[];
  loading: boolean;
  columns: { key: string; label: string; render?: (r: Record<string, unknown>) => React.ReactNode }[];
  equipment: EquipmentRecord[];
  onRefresh: () => void;
  renderForm: (props: { equipment: EquipmentRecord[]; onSuccess: () => void; onClose: () => void }) => React.ReactNode;
  exportFn?: () => void;
  allowBreakdown?: boolean;
}

export function EquipmentEntityList({
  title, description, records, loading, columns, equipment, onRefresh, renderForm, exportFn, allowBreakdown,
}: EquipmentEntityListProps) {
  const actor = useEquipmentActor();
  const [open, setOpen] = useState(false);
  const canAdd = allowBreakdown ? canReportBreakdown(actor.role) : canManageEquipment(actor.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        <div className="flex gap-2">
          {exportFn && <Button variant="outline" onClick={exportFn}><Download className="h-4 w-4 mr-1" />Export</Button>}
          {canAdd && (
            <Button className="bg-blue-600 hover:bg-blue-700 gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add Record</Button>
          )}
        </div>
      </div>
      {loading ? <LoadingSpinner /> : (
        <Card><CardHeader><CardTitle>Records ({records.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table><TableHeader><TableRow>
              {columns.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
              <TableHead></TableHead>
            </TableRow></TableHeader><TableBody>
              {records.length === 0 ? <TableRow><TableCell colSpan={columns.length + 1} className="text-center py-8 text-muted-foreground">No records</TableCell></TableRow>
                : records.map((r) => (
                  <TableRow key={String(r.id)}>
                    {columns.map((c) => (
                      <TableCell key={c.key} className="max-w-[180px] truncate text-sm">
                        {c.render ? c.render(r) : String(r[c.key] ?? '—')}
                      </TableCell>
                    ))}
                    <TableCell>
                      {typeof r.equipment_doc_id === 'string' && (
                        <Link href={`/qms/equipment/${r.equipment_doc_id}`}><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></Link>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody></Table>
          </CardContent></Card>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader><SheetTitle>Add {title}</SheetTitle></SheetHeader>
          <div className="mt-6">{renderForm({
            equipment,
            onSuccess: () => {
              // Blur before close so Select triggers aren't focused under aria-hidden.
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              setOpen(false);
              onRefresh();
              toast.success('Saved');
            },
            onClose: () => {
              if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
              setOpen(false);
            },
          })}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
