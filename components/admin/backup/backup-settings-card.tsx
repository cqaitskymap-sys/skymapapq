'use client';

import { useState } from 'react';
import { Clock, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { BACKUP_SCOPES, BACKUP_FREQUENCIES } from '@/lib/admin/constants';
import type { BackupSettings } from '@/lib/admin/schemas';
import { updateBackupSettings } from '@/lib/admin/backup-service';

interface BackupSettingsCardProps {
  settings: BackupSettings | null;
  canEdit: boolean;
  auditMeta: { userId: string; userName: string };
  onSaved: () => void;
}

export function BackupSettingsCard({ settings, canEdit, auditMeta, onSaved }: BackupSettingsCardProps) {
  const [form, setForm] = useState({
    autoBackupEnabled: settings?.autoBackupEnabled ?? false,
    backupFrequency: settings?.backupFrequency ?? 'Weekly',
    backupTime: settings?.backupTime ?? '02:00',
    backupScope: settings?.backupScope ?? 'Full System',
    retentionPeriodDays: settings?.retentionPeriodDays ?? 90,
    notifyAdminOnSuccess: settings?.notifyAdminOnSuccess ?? true,
    notifyAdminOnFailure: settings?.notifyAdminOnFailure ?? true,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    const result = await updateBackupSettings({
      ...form,
      changeReason: 'Scheduled backup / retention configuration updated',
    }, auditMeta);
    setSaving(false);
    if (result) {
      toast.success('Backup schedule saved');
      onSaved();
    } else toast.error('Failed to save backup settings');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-5 w-5" />Scheduled Backup Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          When enabled, Cloud Scheduler runs `scheduledAdminBackup` daily (02:00 Asia/Kolkata) and applies Weekly/Monthly cadence gates. Payloads are AES-256-GCM encrypted in Cloud Storage.
        </p>
        <div className="flex items-center justify-between">
          <Label>Auto Backup Enabled</Label>
          <Switch
            checked={form.autoBackupEnabled}
            disabled={!canEdit}
            onCheckedChange={(v) => setForm({ ...form, autoBackupEnabled: v })}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Backup Frequency</Label>
            <Select
              value={form.backupFrequency}
              disabled={!canEdit}
              onValueChange={(v) => setForm({ ...form, backupFrequency: v as BackupSettings['backupFrequency'] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKUP_FREQUENCIES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Backup Time (UTC)</Label>
            <Input type="time" value={form.backupTime} disabled={!canEdit}
              onChange={(e) => setForm({ ...form, backupTime: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Backup Scope</Label>
            <Select
              value={form.backupScope}
              disabled={!canEdit}
              onValueChange={(v) => setForm({ ...form, backupScope: v as BackupSettings['backupScope'] })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BACKUP_SCOPES.filter((s) => s !== 'Selected Collections').map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Retention Period (Days)</Label>
            <Input
              type="number"
              min={1}
              disabled={!canEdit}
              value={form.retentionPeriodDays}
              onChange={(e) => setForm({ ...form, retentionPeriodDays: Number(e.target.value) })}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Label>Notify Admin On Success</Label>
          <Switch
            checked={form.notifyAdminOnSuccess}
            disabled={!canEdit}
            onCheckedChange={(v) => setForm({ ...form, notifyAdminOnSuccess: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label>Notify Admin On Failure</Label>
          <Switch
            checked={form.notifyAdminOnFailure}
            disabled={!canEdit}
            onCheckedChange={(v) => setForm({ ...form, notifyAdminOnFailure: v })}
          />
        </div>
        {settings?.lastBackupDate && (
          <p className="text-xs text-muted-foreground">Last backup: {new Date(settings.lastBackupDate).toLocaleString()}</p>
        )}
        {settings?.nextBackupDate && (
          <p className="text-xs text-muted-foreground">Next backup due: {new Date(settings.nextBackupDate).toLocaleString()}</p>
        )}
        {canEdit && (
          <Button onClick={handleSave} disabled={saving} variant="outline">
            <Save className="h-4 w-4 mr-2" />{saving ? 'Saving...' : 'Save Schedule'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
