'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  BACKUP_TYPES, BACKUP_SCOPES, BACKUP_FREQUENCIES, BACKUP_EXPORT_COLLECTIONS,
} from '@/lib/admin/constants';
import { backupFormSchema, type BackupFormData } from '@/lib/admin/schemas';
import { buildBackupNumber } from '@/lib/admin/backup-service';

interface BackupFormProps {
  onSubmit: (data: BackupFormData) => void;
  onCancel: () => void;
  submitting?: boolean;
  progress?: number;
  progressLabel?: string;
}

export function BackupForm({ onSubmit, onCancel, submitting, progress, progressLabel }: BackupFormProps) {
  const form = useForm<BackupFormData>({
    resolver: zodResolver(backupFormSchema),
    defaultValues: {
      backupNumber: buildBackupNumber(),
      backupType: 'Manual Backup',
      backupScope: 'Full System',
      selectedCollections: [],
      backupFrequency: 'Manual Only',
      remarks: '',
      changeReason: '',
      isProtected: false,
    },
  });

  const scope = form.watch('backupScope');
  const selected = form.watch('selectedCollections');

  const toggleCollection = (col: string) => {
    const next = selected.includes(col) ? selected.filter((c) => c !== col) : [...selected, col];
    form.setValue('selectedCollections', next);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Backup Configuration</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Backup Number *</Label>
            <Input {...form.register('backupNumber')} />
            {form.formState.errors.backupNumber && (
              <p className="text-xs text-red-500">{form.formState.errors.backupNumber.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Backup Type *</Label>
            <Select value={form.watch('backupType')} onValueChange={(v) => form.setValue('backupType', v as BackupFormData['backupType'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKUP_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Backup Scope *</Label>
            <Select value={scope} onValueChange={(v) => form.setValue('backupScope', v as BackupFormData['backupScope'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKUP_SCOPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select value={form.watch('backupFrequency')} onValueChange={(v) => form.setValue('backupFrequency', v as BackupFormData['backupFrequency'])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKUP_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Change Reason *</Label>
            <Textarea {...form.register('changeReason')} rows={2} placeholder="GMP justification for creating this backup (min 5 characters)" />
            {form.formState.errors.changeReason && (
              <p className="text-xs text-red-500">{form.formState.errors.changeReason.message}</p>
            )}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Remarks</Label>
            <Textarea {...form.register('remarks')} rows={2} />
          </div>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox
              checked={form.watch('isProtected')}
              onCheckedChange={(v) => form.setValue('isProtected', v === true)}
            />
            Protect this backup (prevent soft-delete / retention purge)
          </label>
        </CardContent>
      </Card>

      {scope === 'Selected Collections' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Select Collections</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
            {BACKUP_EXPORT_COLLECTIONS.map((col) => (
              <label key={col} className="flex items-center gap-2 text-sm">
                <Checkbox checked={selected.includes(col)} onCheckedChange={() => toggleCollection(col)} />
                {col}
              </label>
            ))}
          </CardContent>
          {form.formState.errors.selectedCollections && (
            <p className="text-xs text-red-500 px-6">{form.formState.errors.selectedCollections.message}</p>
          )}
        </Card>
      )}

      {submitting && progress !== undefined && (
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>{progressLabel || 'Processing...'}</span>
                <span>{progress}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3">
        <Button type="submit" disabled={submitting} className="bg-blue-600">
          {submitting ? 'Creating Backup...' : 'Create Backup'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>
      </div>
    </form>
  );
}
