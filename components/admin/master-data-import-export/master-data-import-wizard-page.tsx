'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditMasterDataImportExport } from '@/lib/permissions';
import { MASTER_DATA_IMPORT_MODES } from '@/lib/admin/constants';
import {
  getMasterDataTypeOptions, parseImportFile,
  validateMasterDataImport, importMasterData,
} from '@/lib/admin/master-data-import-export-service';

export function MasterDataImportWizardPage() {
  const { profile } = useAuth();
  const { role } = useAdminPermissions();
  const canEdit = canEditMasterDataImportExport(role);
  const masters = useMemo(() => getMasterDataTypeOptions(), []);

  const [step, setStep] = useState(1);
  const [masterType, setMasterType] = useState<string>(masters[0]?.value || 'departments');
  const [importMode, setImportMode] = useState<string>('Dry Run');
  const [changeReason, setChangeReason] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileFormat, setFileFormat] = useState<'JSON' | 'CSV'>('JSON');
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<Array<Record<string, unknown>>>([]);
  const [validation, setValidation] = useState<{ valid: number; duplicates: number; errorCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const selected = masters.find((m) => m.value === masterType);

  if (!canEdit) {
    return <ErrorCard accessDenied message="You do not have permission to import master data." />;
  }

  const onFile = async (file: File | null) => {
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    const text = await file.text();
    const parsed = parseImportFile(text, file.name);
    if (parsed.error) {
      toast.error(parsed.error);
      setRows([]);
      return;
    }
    setRows(parsed.rows);
    setFileFormat(parsed.format);
    setStep(2);
    toast.success(`Loaded ${parsed.rows.length} rows (${parsed.format})`);
  };

  const runValidate = async () => {
    if (changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setBusy(true);
    const res = await validateMasterDataImport({
      masterType,
      rows,
      fileName,
      fileFormat,
      changeReason,
    });
    setBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setErrors(res.errors || []);
    setPreview(res.preview || []);
    setValidation({
      valid: res.valid || 0,
      duplicates: res.duplicates || 0,
      errorCount: res.errorCount || 0,
    });
    setStep(3);
    toast.success('Validation complete');
  };

  const runImport = async () => {
    if (changeReason.trim().length < 5) {
      toast.error('Change reason is required (min 5 characters)');
      return;
    }
    setBusy(true);
    const res = await importMasterData({
      masterType,
      rows,
      importMode,
      fileName,
      fileFormat,
      changeReason,
    });
    setBusy(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setErrors(res.errors || []);
    setResult(
      `${res.status}: ${res.successCount} ok, ${res.skippedCount} skipped, ${res.errorCount} failed`
      + (res.dryRun ? ' (dry run — no writes)' : ''),
    );
    setStep(4);
    toast.success(res.dryRun ? 'Dry run completed' : 'Import completed');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Wizard"
        description={`Step ${step} of 4 · ${selected?.label || masterType}`}
        basePath="/admin"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/admin/master-data-import-export"><ArrowLeft className="h-4 w-4 mr-1" />Dashboard</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base">1. Select Master & Mode</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Master Type</Label>
            <Select value={masterType} onValueChange={setMasterType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {masters.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            {selected && (
              <p className="text-[11px] text-muted-foreground">
                Unique key: {selected.uniqueKey} · Required: {selected.required.join(', ')}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Import Mode</Label>
            <Select value={importMode} onValueChange={setImportMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MASTER_DATA_IMPORT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Change Reason *</Label>
            <Textarea
              rows={2}
              value={changeReason}
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder={`Import by ${profile?.full_name || 'Admin'} — reason required`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">2. Upload File (JSON or CSV)</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900">
            <Upload className="h-5 w-5 mb-2 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              {fileName || 'Click to upload .json, .csv, or .tsv'}
            </span>
            <Input
              type="file"
              accept=".json,.csv,.tsv,application/json,text/csv,text/tab-separated-values"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] || null)}
            />
          </label>
          {rows.length > 0 && (
            <p className="text-sm">Loaded <strong>{rows.length}</strong> rows ({fileFormat}). Max processed per job: 200.</p>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <div className="flex gap-2">
          <Button disabled={busy} variant="outline" onClick={runValidate}>
            {busy && step < 3 ? 'Validating…' : 'Validate / Preview'}
          </Button>
          <Button disabled={busy} className="bg-sky-600 hover:bg-sky-700" onClick={runImport}>
            {busy && step >= 3 ? 'Importing…' : importMode === 'Dry Run' ? 'Run Dry Run' : 'Commit Import'}
          </Button>
        </div>
      )}

      {validation && (
        <Card>
          <CardHeader><CardTitle className="text-base">3. Validation Summary</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>Valid: {validation.valid} · Field errors: {validation.errorCount} · Existing keys: {validation.duplicates}</p>
            {preview.length > 0 && (
              <div className="overflow-x-auto rounded border max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {Object.keys(preview[0]).filter((k) => !k.startsWith('__')).slice(0, 6).map((k) => (
                        <TableHead key={k}>{k}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.slice(0, 10).map((row, i) => (
                      <TableRow key={i}>
                        {Object.keys(preview[0]).filter((k) => !k.startsWith('__')).slice(0, 6).map((k) => (
                          <TableCell key={k} className="text-xs max-w-[140px] truncate">{String(row[k] ?? '')}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(result || errors.length > 0) && (
        <Card>
          <CardHeader><CardTitle className="text-base">4. Result / Errors</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {result && <p className="text-sm font-medium">{result}</p>}
            {errors.length > 0 && (
              <pre className="text-xs whitespace-pre-wrap border rounded p-3 bg-slate-50 dark:bg-slate-900/40 max-h-56 overflow-auto">
                {errors.join('\n')}
              </pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
