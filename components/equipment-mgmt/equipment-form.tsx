'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { equipmentCreateSchema, type EquipmentCreateInput } from '@/lib/equipment-mgmt-schemas';
import { EQUIPMENT_QUALIFICATION_STATUSES, EQUIPMENT_MANUFACTURING_LINES } from '@/lib/equipment-mgmt-types';

export function EquipmentForm({ defaultValues, onSubmit, onCancel, submitLabel = 'Save', saving }: {
  defaultValues?: Partial<EquipmentCreateInput>; onSubmit: (d: EquipmentCreateInput) => Promise<void>;
  onCancel?: () => void; submitLabel?: string; saving?: boolean;
}) {
  const form = useForm<EquipmentCreateInput>({
    resolver: zodResolver(equipmentCreateSchema),
    defaultValues: {
      equipment_name: '',
      equipment_id: '',
      qualification_status: 'Not Qualified',
      manufacturing_line: 'A1',
      ...defaultValues,
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField control={form.control} name="equipment_name" render={({ field }) => (
            <FormItem>
              <FormLabel>Equipment Name *</FormLabel>
              <FormControl><Input {...field} placeholder="e.g. Tablet Compression Machine" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="equipment_id" render={({ field }) => (
            <FormItem>
              <FormLabel>Equipment ID *</FormLabel>
              <FormControl><Input {...field} placeholder="e.g. EQP-001" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="qualification_status" render={({ field }) => (
            <FormItem>
              <FormLabel>Equipment Qualification Status *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger></FormControl>
                <SelectContent>
                  {EQUIPMENT_QUALIFICATION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={form.control} name="manufacturing_line" render={({ field }) => (
            <FormItem>
              <FormLabel>Manufacturing Line *</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl><SelectTrigger><SelectValue placeholder="Select line" /></SelectTrigger></FormControl>
                <SelectContent>
                  {EQUIPMENT_MANUFACTURING_LINES.map((line) => (
                    <SelectItem key={line} value={line}>{line}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        <div className="flex gap-2 justify-end">
          {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
          <Button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700">{saving ? 'Saving…' : submitLabel}</Button>
        </div>
      </form>
    </Form>
  );
}
