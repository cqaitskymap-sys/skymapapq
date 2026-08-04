'use client';

import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Save, RotateCcw, Download, Upload, Settings, ShieldCheck, Send } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/dashboard/page-header';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/contexts/auth-context';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import { canEditSystemSettings, canEditSecuritySystemSettings } from '@/lib/permissions';
import { SYSTEM_SETTINGS_TABS } from '@/lib/admin/constants';
import type { SystemSettings } from '@/lib/admin/schemas';
import {
  fetchSystemSettings,
  updateSystemSettings,
  resetSystemSettingsToDefault,
  exportSystemSettingsJson,
  importSystemSettingsJson,
  getDefaultSystemSettings,
  publishSystemSettings,
  logSystemSettingsExport,
  isCriticalSettingsSection,
  subscribeSystemSettings,
} from '@/lib/admin/system-settings-service';
import { useSystemSettings } from '@/contexts/system-settings-context';

export function SystemSettingsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, profile } = useAuth();
  const { role } = useAdminPermissions();
  const { refresh: refreshGlobal } = useSystemSettings();
  const canEdit = canEditSystemSettings(role);
  const canEditSecurity = canEditSecuritySystemSettings(role);

  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetReason, setResetReason] = useState('');
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishReason, setPublishReason] = useState('Publish system configuration');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const auditMeta = useMemo(() => ({
    userId: user?.uid || 'system',
    userName: profile?.full_name || profile?.email || 'Admin',
  }), [profile?.email, profile?.full_name, user?.uid]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchSystemSettings();
      setSettings(s || normalizeDefaults());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const unsub = subscribeSystemSettings((s) => {
      if (s) setSettings(s);
    });
    return () => unsub();
  }, []);

  function normalizeDefaults(): SystemSettings {
    return { ...getDefaultSystemSettings(), id: '' } as SystemSettings;
  }

  const handleExport = async () => {
    if (!settings) return;
    const json = exportSystemSettingsJson(settings);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system_settings_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await logSystemSettingsExport('System settings JSON export');
    toast.success('Settings exported');
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const result = await importSystemSettingsJson(text, auditMeta, {
      changeReason: 'Import system configuration JSON',
      esignConfirmed: true,
    });
    if (result.settings) {
      setSettings(result.settings);
      await refreshGlobal();
      toast.success('Settings imported');
    } else toast.error(result.error || 'Import failed');
    e.target.value = '';
  };

  const handleReset = async () => {
    if (resetReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    try {
      const result = await resetSystemSettingsToDefault(auditMeta, {
        changeReason: resetReason,
        esignConfirmed: true,
      });
      if (result) {
        setSettings(result);
        await refreshGlobal();
        toast.success('Settings reset to defaults');
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
    setResetOpen(false);
    setResetReason('');
  };

  const handlePublish = async () => {
    if (publishReason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    try {
      const result = await publishSystemSettings({
        changeReason: publishReason,
        esignConfirmed: true,
      });
      if (result) {
        setSettings(result);
        await refreshGlobal();
        toast.success('Configuration published');
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
    setPublishOpen(false);
  };

  if (loading) return <LoadingSkeleton rows={4} />;
  if (error) return <ErrorCard message={error} onRetry={load} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Settings"
        description="Centralized Pharma QMS configuration — versioned, audited, Part 11 / Annex 11 aligned"
        actions={
          <div className="flex gap-2 flex-wrap">
            {settings && (
              <Badge variant="outline" className="h-8 px-3">
                v{settings.configVersion || 1} · {settings.configurationStatus || 'Published'}
              </Badge>
            )}
            {(canEdit || canEditSecurity) && (
              <>
                <Button variant="outline" size="sm" onClick={() => setPublishOpen(true)}>
                  <Send className="h-4 w-4 mr-1" />Publish
                </Button>
                <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
                  <RotateCcw className="h-4 w-4 mr-1" />Reset
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />Export
            </Button>
            {canEditSecurity && (
              <>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-1" />Import
                </Button>
                <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              </>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-1 border-b pb-2 max-h-28 overflow-y-auto">
        {SYSTEM_SETTINGS_TABS.map((tab) => (
          <Link
            key={tab.id}
            href={tab.href}
            className={cn(
              'px-2.5 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap',
              pathname === tab.href || pathname.startsWith(tab.href + '/')
                ? 'bg-blue-600 text-white'
                : 'text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <SettingsFormProvider
        settings={settings!}
        auditMeta={auditMeta}
        canEdit={canEdit}
        canEditSecurity={canEditSecurity}
        onSaved={async (s) => {
          setSettings(s);
          await refreshGlobal();
        }}
      >
        {children}
      </SettingsFormProvider>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to Default Settings?</AlertDialogTitle>
            <AlertDialogDescription>
              Restores factory defaults. Requires change reason and is recorded as an e-signed configuration reset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label>Change reason *</Label>
            <Textarea value={resetReason} onChange={(e) => setResetReason(e.target.value)} rows={2} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset} className="bg-red-600">Reset Defaults</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={publishOpen} onOpenChange={setPublishOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish Configuration</DialogTitle>
            <DialogDescription>Marks the current configuration as published for enterprise consumption.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Change reason *</Label>
            <Textarea value={publishReason} onChange={(e) => setPublishReason(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)}>Cancel</Button>
            <Button onClick={handlePublish} className="bg-blue-600">Publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface SettingsFormContextValue {
  settings: SystemSettings;
  auditMeta: { userId: string; userName: string };
  canEdit: boolean;
  canEditSecurity: boolean;
  onSaved: (s: SystemSettings) => void;
  saveSection: (
    section: string,
    data: Partial<SystemSettings>,
    options?: { changeReason?: string; esignConfirmed?: boolean },
  ) => Promise<void>;
}

const SettingsFormContext = createContext<SettingsFormContextValue | null>(null);

export function useSettingsForm() {
  const ctx = useContext(SettingsFormContext);
  if (!ctx) throw new Error('useSettingsForm must be used within SystemSettingsShell');
  return ctx;
}

function SettingsFormProvider({
  settings, auditMeta, canEdit, canEditSecurity, onSaved, children,
}: {
  settings: SystemSettings;
  auditMeta: { userId: string; userName: string };
  canEdit: boolean;
  canEditSecurity: boolean;
  onSaved: (s: SystemSettings) => void;
  children: React.ReactNode;
}) {
  const saveSection = async (
    section: string,
    data: Partial<SystemSettings>,
    options?: { changeReason?: string; esignConfirmed?: boolean },
  ) => {
    try {
      const updated = await updateSystemSettings(data, auditMeta, section, options);
      if (updated) {
        onSaved(updated);
        toast.success('Settings saved');
      } else toast.error('Failed to save settings');
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };

  return (
    <SettingsFormContext.Provider value={{
      settings, auditMeta, canEdit, canEditSecurity, onSaved, saveSection,
    }}>
      {children}
    </SettingsFormContext.Provider>
  );
}

export function SectionSaveBar({
  section,
  onSave,
  readOnly,
  saving,
}: {
  section: string;
  onSave: (opts: { changeReason: string; esignConfirmed: boolean }) => void | Promise<void>;
  readOnly?: boolean;
  saving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(`${section} configuration updated`);
  const [esign, setEsign] = useState(false);
  const critical = isCriticalSettingsSection(section);

  if (readOnly) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <Settings className="h-3 w-3" />View only — you cannot edit {section} settings
      </p>
    );
  }

  const confirm = async () => {
    if (reason.trim().length < 5) {
      toast.error('Change reason must be at least 5 characters');
      return;
    }
    if (critical && !esign) {
      toast.error('Confirm electronic signature for critical changes');
      return;
    }
    await onSave({ changeReason: reason.trim(), esignConfirmed: critical ? esign : true });
    setOpen(false);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={saving} className="bg-blue-600">
        <Save className="h-4 w-4 mr-2" />{saving ? 'Saving...' : 'Save Changes'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm configuration change</DialogTitle>
            <DialogDescription>
              {critical
                ? 'Critical section — change reason and electronic signature confirmation are required (21 CFR Part 11).'
                : 'Provide a GMP change reason before saving.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Change reason *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
            </div>
            {critical && (
              <label className="flex items-start gap-2 text-sm border rounded-md p-3">
                <Input
                  type="checkbox"
                  className="h-4 w-4 mt-0.5"
                  checked={esign}
                  onChange={(e) => setEsign(e.target.checked)}
                />
                <span className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-blue-600 mt-0.5" />
                  I electronically confirm this critical configuration change is accurate and authorized.
                </span>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={confirm} className="bg-blue-600" disabled={saving}>
              {saving ? 'Saving...' : 'Confirm & Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
