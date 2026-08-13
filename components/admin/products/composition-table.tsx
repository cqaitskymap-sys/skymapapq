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
import { INGREDIENT_TYPES } from '@/lib/admin/constants';
import type { ProductCompositionRow } from '@/lib/admin/schemas';

interface CompositionTableProps {
  rows: ProductCompositionRow[];
  onChange: (rows: ProductCompositionRow[]) => void;
  readOnly?: boolean;
}

const emptyRow = (): ProductCompositionRow => ({
  ingredientName: '',
  ingredientType: 'API',
  grade: '',
  quantity: 1,
  unit: 'mg',
  functionPurpose: '',
  specificationNo: '',
  stpNo: '',
});

export function CompositionTable({ rows, onChange, readOnly }: CompositionTableProps) {
  const update = (index: number, patch: Partial<ProductCompositionRow>) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const add = () => onChange([...rows, emptyRow()]);
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Grade</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead>Function</TableHead>
              {!readOnly && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={readOnly ? 6 : 7} className="text-center text-sm text-muted-foreground">No ingredients</TableCell></TableRow>
            ) : (
              rows.map((row, i) => (
                <TableRow key={row.id || i}>
                  <TableCell><Input value={row.ingredientName} disabled={readOnly} onChange={(e) => update(i, { ingredientName: e.target.value })} className="h-8" /></TableCell>
                  <TableCell>
                    <Select value={row.ingredientType} onValueChange={(v) => update(i, { ingredientType: v as ProductCompositionRow['ingredientType'] })} disabled={readOnly}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>{INGREDIENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell><Input value={row.grade} disabled={readOnly} onChange={(e) => update(i, { grade: e.target.value })} className="h-8" /></TableCell>
                  <TableCell><Input type="number" min={0.0001} step="any" value={Number.isFinite(row.quantity) && row.quantity > 0 ? row.quantity : ''} disabled={readOnly} onChange={(e) => {
                    const raw = e.target.value;
                    update(i, { quantity: raw === '' ? (Number.NaN as unknown as number) : Number(raw) });
                  }} className="h-8 w-24" /></TableCell>
                  <TableCell><Input value={row.unit} disabled={readOnly} onChange={(e) => update(i, { unit: e.target.value })} className="h-8 w-20" /></TableCell>
                  <TableCell><Input value={row.functionPurpose} disabled={readOnly} onChange={(e) => update(i, { functionPurpose: e.target.value })} className="h-8" /></TableCell>
                  {!readOnly && (
                    <TableCell>
                      <Button type="button" variant="ghost" size="icon" onClick={() => remove(i)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" onClick={add}><Plus className="h-4 w-4 mr-1" />Add Ingredient</Button>
      )}
    </div>
  );
}
