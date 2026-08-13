'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { PACKING_MATERIAL_TYPES } from '@/lib/admin/constants';
import type { ProductPackingRow } from '@/lib/admin/schemas';

interface PackingTableProps {
  rows: ProductPackingRow[];
  onChange: (rows: ProductPackingRow[]) => void;
  readOnly?: boolean;
}

const emptyRow = (): ProductPackingRow => ({
  packingMaterial: '',
  materialType: 'Primary Packing',
  packSize: '',
  quantity: 0,
  unit: '',
  specificationNo: '',
  stpNo: '',
});

export function PackingTable({ rows, onChange, readOnly }: PackingTableProps) {
  const update = (index: number, patch: Partial<ProductPackingRow>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Material</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Pack Size</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Spec No</TableHead>
              <TableHead>STP No</TableHead>
              {!readOnly && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={readOnly ? 7 : 8} className="text-center text-sm text-muted-foreground">No packing rows</TableCell></TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={row.id || i}>
                  <TableCell><Input value={row.packingMaterial} disabled={readOnly} onChange={(e) => update(i, { packingMaterial: e.target.value })} className="h-8" /></TableCell>
                  <TableCell>
                    <Select
                      value={PACKING_MATERIAL_TYPES.includes(row.materialType as typeof PACKING_MATERIAL_TYPES[number]) ? row.materialType : 'Primary Packing'}
                      onValueChange={(v) => update(i, { materialType: v as ProductPackingRow['materialType'] })}
                      disabled={readOnly}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{PACKING_MATERIAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input value={row.packSize} disabled={readOnly} onChange={(e) => update(i, { packSize: e.target.value })} className="h-8" /></TableCell>
                  <TableCell><Input type="number" min={0} step="any" value={row.quantity} disabled={readOnly} onChange={(e) => update(i, { quantity: Number(e.target.value) || 0 })} className="h-8 w-24" /></TableCell>
                  <TableCell><Input value={row.unit} disabled={readOnly} onChange={(e) => update(i, { unit: e.target.value })} className="h-8 w-20" /></TableCell>
                  <TableCell><Input value={row.specificationNo} disabled={readOnly} onChange={(e) => update(i, { specificationNo: e.target.value })} className="h-8" /></TableCell>
                  <TableCell><Input value={row.stpNo} disabled={readOnly} onChange={(e) => update(i, { stpNo: e.target.value })} className="h-8" /></TableCell>
                  {!readOnly && (
                    <TableCell>
                      <Button type="button" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...rows, emptyRow()])}>
          <Plus className="h-4 w-4 mr-1" />Add Packing Row
        </Button>
      )}
    </div>
  );
}
