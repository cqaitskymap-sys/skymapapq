'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditMasterDataImportExport } from '@/lib/permissions';
import { MASTER_DATA_EXPORT_FORMATS } from '@/lib/admin/constants';
import {
  getMasterDataTypeOptions, exportMasterData, downloadTextFile,
} from '@/lib/admin/master-data-import-export-service';

export function MasterDataExportWizardPage() {
  const { profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditMasterDataImportExport(role);
  const masters = useMemo(() => getMasterDataTypeOptions(), []);

  const [masterType, setMasterType] = useState<string>(masters[0]?.value || 'departments');
  const [format, setFormat] = useState<'JSON' | 'CSV'>('JSON');
  const [changeReason, setChangeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastCount, setLastCount] = useState<number | null>(null);

  if (!canEdit) {
    return <ErrorCard accessDenied message="You do not have permission to export master data." />;
  }

  const runExport = async () => {
    if (changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setBusy(true);
    const res = await exportMasterData({ masterType, format, changeReason });
    setBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    const fileName = res.fileName || `${masterType}-export.${format.toLowerCase()}`;
    if (format === 'CSV') {
      downloadTextFile(res.csv || '', fileName, 'text/csv;charset=utf-8');
    } else {
      downloadTextFile(JSON.stringify(res.records || [], null, 2), fileName, 'application/json');
    }
    setLastCount(res.count || 0);
    toast.success(`Exported ${res.count || 0} records`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Export Wizard"
        description="Server-attested master data export with audit logging"
        basePath="/admin"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/master-data-import-export"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Export Configuration</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Master Type</Label>
            <Select value={masterType} onValueChange={setMasterType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {masters.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Format</Label>
            <Select value={format} onValueChange={(v) => setFormat(v as 'JSON' | 'CSV')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASTER_DATA_EXPORT_FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Change Reason *</Label>
            <Textarea
              rows={2}
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder={`Export by ${profile?.full_name || 'Admin'} — reason required`}
            />
          </div>
          <div className="md:col-span-2">
            <Button disabled={busy} className="bg-sky-600 hover:bg-sky-700" onClick={runExport}>
              <Download className="h-4 w-4 mr-1" />
              {busy ? 'Exporting…' : `Export ${format}`}
            </Button>
            {lastCount != null && (
              <p className="text-sm text-muted-foreground mt-3">Last export: {lastCount} records (logged to history).</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
