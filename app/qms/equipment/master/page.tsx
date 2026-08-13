'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { EquipmentFiltersBar } from '@/components/equipment-mgmt/equipment-filters';
import { EquipmentForm } from '@/components/equipment-mgmt/equipment-form';
import { EquipmentStatusBadge } from '@/components/equipment-mgmt/equipment-sub-nav';
import { useEquipment, useEquipmentActor } from '@/hooks/use-equipment-mgmt';
import { createEquipment, exportEquipmentCsv } from '@/lib/equipment-mgmt-service';
import type { EquipmentFilters } from '@/lib/equipment-mgmt-types';
import type { EquipmentCreateInput } from '@/lib/equipment-mgmt-schemas';
import { canManageEquipment } from '@/lib/equipment-mgmt-types';

export default function EquipmentMasterPage() {
  const [filters, setFilters] = useState<EquipmentFilters>({});
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const { equipment, loading, error, refresh } = useEquipment(filters);
  const actor = useEquipmentActor();

  const handleCreate = async (data: EquipmentCreateInput) => {
    setSaving(true);
    try {
      await createEquipment(data, actor);
      toast.success('Equipment created');
      setOpen(false);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Equipment Master</h1>
          <p className="text-muted-foreground text-sm">Create and manage equipment profiles for calibration and PM tracking</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => exportEquipmentCsv(equipment)}>Export CSV</Button>
          {canManageEquipment(actor.role) && (
            <Button className="bg-blue-600 hover:bg-blue-700 gap-2" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New Equipment</Button>
          )}
        </div>
      </div>
      <EquipmentFiltersBar filters={filters} onChange={setFilters} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading ? <LoadingSpinner /> : (
        <Card><CardHeader><CardTitle>All Equipment ({equipment.length})</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table><TableHeader><TableRow>
              <TableHead>ID</TableHead><TableHead>Name</TableHead>
              <TableHead>Qualification</TableHead><TableHead>Manufacturing Line</TableHead><TableHead></TableHead>
            </TableRow></TableHeader><TableBody>
              {equipment.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No equipment — create your first record</TableCell></TableRow>
                : equipment.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-mono text-sm">{e.equipment_id}</TableCell>
                    <TableCell>{e.equipment_name}</TableCell>
                    <TableCell><EquipmentStatusBadge status={e.qualification_status || '—'} /></TableCell>
                    <TableCell>{e.manufacturing_line || '—'}</TableCell>
                    <TableCell><Link href={`/qms/equipment/${e.id}`}><Button variant="ghost" size="sm"><Eye className="h-4 w-4" /></Button></Link></TableCell>
                  </TableRow>
                ))}
            </TableBody></Table>
          </CardContent></Card>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader><SheetTitle>Create Equipment</SheetTitle></SheetHeader>
          <div className="mt-6"><EquipmentForm onSubmit={handleCreate} onCancel={() => setOpen(false)} saving={saving} submitLabel="Create Equipment" /></div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
