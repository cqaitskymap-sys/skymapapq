'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { EquipmentAccessGuard } from '@/components/admin/equipment/equipment-access-guard';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { EQUIPMENT_QUALIFICATION_STATUSES, EQUIPMENT_MANUFACTURING_LINES } from '@/lib/equipment-mgmt-types';
import { canEditEquipmentMaster } from '@/lib/permissions';
import { createEquipment } from '@/lib/equipment-mgmt-service';
import type { EquipmentCreateInput } from '@/lib/equipment-mgmt-schemas';

const emptyRow = (): EquipmentCreateInput => ({
  equipment_name: '',
  equipment_id: '',
  qualification_status: 'Not Qualified',
  manufacturing_line: 'A1',
});

function CreateEquipmentContent() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<EquipmentCreateInput[]>([emptyRow()]);

  if (!canEditEquipmentMaster(role)) {
    return <ErrorCard accessDenied message="You do not have permission to create equipment." />;
  }

  const updateRow = (index: number, patch: Partial<EquipmentCreateInput>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  const validateRows = (items: EquipmentCreateInput[]) => {
    const seenIds = new Set<string>();
    for (let i = 0; i < items.length; i += 1) {
      const row = items[i];
      if (!row.equipment_name.trim()) return `Row ${i + 1}: Equipment Name is required`;
      if (!row.equipment_id.trim()) return `Row ${i + 1}: Equipment ID is required`;
      if (!row.manufacturing_line.trim()) return `Row ${i + 1}: Manufacturing Line is required`;
      const idKey = row.equipment_id.trim().toLowerCase();
      if (seenIds.has(idKey)) return `Row ${i + 1}: Duplicate Equipment ID "${row.equipment_id.trim()}" in form`;
      seenIds.add(idKey);
    }
    return null;
  };

  const handleSubmit = async () => {
    const validationError = validateRows(rows);
    if (validationError) {
      toast.error(validationError);
      return;
    }

    setSaving(true);
    try {
      const actor = {
        id: user?.uid || 'system',
        name: profile?.full_name || profile?.email || 'Admin',
        role: role || 'admin',
      };

      for (const row of rows) {
        await createEquipment(row, actor);
      }

      toast.success(`${rows.length} equipment record(s) created`);
      router.push('/admin/equipment');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Equipment"
        description="Add a new equipment profile to the master register"
        basePath="/admin"
      />
      <Card>
        <CardContent className="p-6">
          <div className="space-y-4">
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Equipment Name *</TableHead>
                    <TableHead>Equipment ID *</TableHead>
                    <TableHead>Equipment Qualification Status *</TableHead>
                    <TableHead>Manufacturing Line *</TableHead>
                    <TableHead className="w-[64px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={`${row.equipment_id}-${i}`}>
                      <TableCell>
                        <Input
                          value={row.equipment_name}
                          onChange={(e) => updateRow(i, { equipment_name: e.target.value })}
                          placeholder="e.g. Tablet Compression Machine"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.equipment_id}
                          onChange={(e) => updateRow(i, { equipment_id: e.target.value })}
                          placeholder="e.g. EQP-001"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.qualification_status}
                          onValueChange={(v) => updateRow(i, { qualification_status: v as EquipmentCreateInput['qualification_status'] })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {EQUIPMENT_QUALIFICATION_STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>{status}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.manufacturing_line}
                          onValueChange={(v) => updateRow(i, { manufacturing_line: v })}
                        >
                          <SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger>
                          <SelectContent>
                            {EQUIPMENT_MANUFACTURING_LINES.map((line) => (
                              <SelectItem key={line} value={line}>{line}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(i)}
                          disabled={rows.length === 1 || saving}
                          aria-label="Remove row"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="outline" onClick={addRow} disabled={saving}>
                <Plus className="h-4 w-4 mr-1" />Add Row
              </Button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => router.push('/admin/equipment')} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={handleSubmit} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                  {saving ? 'Saving…' : `Create ${rows.length} Equipment`}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CreateEquipmentPage() {
  return (
    <EquipmentAccessGuard>
      <CreateEquipmentContent />
    </EquipmentAccessGuard>
  );
}
