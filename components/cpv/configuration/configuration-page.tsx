'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import {
  CheckCircle2, Download, Plus, RefreshCw, RotateCcw, Save, TestTube2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import {
  ANNUAL_REVIEW_SECTIONS, CONFIGURATION_SECTIONS,
  alertRuleConfigSchema, annualReviewTemplateSchema, capabilitySettingsSchema,
  cppConfigurationSchema, cqaConfigurationSchema, dataSourceMappingSchema,
  exportReportSettingsSchema, generalSettingsSchema, globalOrgSettingsSchema,
  aiSettingsSchema, notificationSettingsSchema, dashboardSettingsSchema,
  securitySettingsSchema, backupSettingsSchema, featureFlagsSchema,
  limitRuleSchema,
  productCpvSettingsSchema, reviewFrequencySchema, riskScoringSettingsSchema,
  spcSettingsSchema, summarizeConfiguration, validateConfiguration,
  workflowMappingSchema, type ConfigurationSectionId, type CpvConfigurationBundle,
  canApproveCpvConfiguration, canEditCpvConfiguration, canImportExportCpvConfiguration,
  isCpvConfigurationViewOnly,
} from '@/lib/cpv-configuration-records';
import { CQA_STAGE_PARAMETERS, CQA_TEST_STAGES } from '@/lib/cpv-cqa-monitoring';
import {
  CONFIG_LIST_COLLECTIONS as LIST_COLS,
  createConfigListRecord, exportConfigurationJson, fetchCpvConfiguration,
  importConfigurationJson, logConfigurationExport, resetConfigurationDefaults,
  saveCapabilitySettings, saveExportSettings, saveGeneralSettings, saveRiskSettings,
  saveSpcSettings, saveGlobalOrgSettings, saveAiSettings, saveNotificationSettings,
  saveDashboardSettings, saveSecuritySettings, saveBackupSettings, saveFeatureFlags,
  approveCpvConfiguration, softDeleteConfigRecord, testConfiguration, updateConfigListRecord,
} from '@/lib/cpv-configuration-service';
import { CpvPageHeader } from '@/components/cpv/product-master/cpv-page-header';
import { ResponsiveDataTable } from '@/components/cpv/product-master/responsive-data-table';
import { ConfigurationAccessGuard } from './configuration-access-guard';
import { ConfigurationTabPanel, ConfigurationTabs } from './configuration-tabs';
import { KpiCard } from '@/components/cpv/cpv-ui';
import { ErrorCard } from '@/components/admin/dashboard/error-card';
import { EmptyState } from '@/components/admin/dashboard/empty-state';
import { LoadingSkeleton } from '@/components/admin/dashboard/loading-skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { ColumnDef } from '@/components/admin/admin-data-table';

type Actor = { id: string; name: string; role?: string };
type ConfirmAction = 'reset' | 'save' | 'approve' | 'import' | null;

const LIST_SECTIONS: ConfigurationSectionId[] = [
  'product', 'cpp', 'cqa', 'limits', 'review-frequency', 'alert-rules', 'annual-template', 'workflow', 'data-source',
];

const CROSS_NAV = [
  { label: 'Dashboard', href: '/cpv/dashboard' },
  { label: 'Alert Engine', href: '/cpv/alert-engine' },
  { label: 'Reports', href: '/cpv/reports-analytics' },
  { label: 'Annual Review', href: '/cpv/annual-review' },
  { label: 'Risk', href: '/cpv/risk-assessment' },
  { label: 'SPC', href: '/cpv/statistical-process-control' },
  { label: 'Capability', href: '/cpv/process-capability' },
  { label: 'AI Analytics', href: '/cpv/ai-analytics' },
  { label: 'Audit Trail', href: '/qms/audit-trail' },
  { label: 'System Health', href: '/admin/system-health' },
  { label: 'Backup', href: '/admin/backup' },
] as const;

function StatusBadge({ status }: { status?: string }) {
  const cls = status === 'Active'
    ? 'bg-green-50 text-green-700 border-green-200'
    : 'bg-slate-50 text-slate-600 border-slate-200';
  return <span className={`rounded-md border px-2 py-0.5 text-xs font-medium ${cls}`}>{status || 'Active'}</span>;
}

function SwitchField({ form, name, label }: { form: UseFormReturn<any>; name: string; label: string }) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem className="flex items-center justify-between rounded-lg border p-3">
        <FormLabel className="font-normal">{label}</FormLabel>
        <FormControl><Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} /></FormControl>
      </FormItem>
    )} />
  );
}

function NumberField({ form, name, label }: { form: UseFormReturn<any>; name: string; label: string }) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl>
          <Input type="number" step="any" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))} />
        </FormControl>
        <FormMessage />
      </FormItem>
    )} />
  );
}

function TextField({ form, name, label }: { form: UseFormReturn<any>; name: string; label: string }) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <FormControl><Input {...field} value={field.value ?? ''} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
  );
}

function SelectField({ form, name, label, options }: { form: UseFormReturn<any>; name: string; label: string; options: readonly string[] }) {
  return (
    <FormField control={form.control} name={name} render={({ field }) => (
      <FormItem>
        <FormLabel>{label}</FormLabel>
        <Select value={String(field.value ?? '')} onValueChange={field.onChange}>
          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
          <SelectContent>{options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    )} />
  );
}

function ListSectionPanel({
  sectionId, records, columns, readOnly, onAdd, onEdit, onDelete,
}: {
  sectionId: ConfigurationSectionId;
  records: Array<Record<string, unknown> & { id?: string }>;
  columns: ColumnDef<Record<string, unknown> & { id?: string }>[];
  readOnly: boolean;
  onAdd: () => void;
  onEdit: (row: Record<string, unknown> & { id?: string }) => void;
  onDelete: (id: string) => void;
}) {
  const meta = CONFIGURATION_SECTIONS.find((s) => s.id === sectionId);
  const cols: ColumnDef<Record<string, unknown> & { id?: string }>[] = [
    ...columns,
    ...(readOnly ? [] : [{
      key: 'actions', header: '',
      render: (r: Record<string, unknown> & { id?: string }) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>Edit</Button>
          {r.id && <Button variant="ghost" size="sm" className="text-red-600" onClick={() => onDelete(String(r.id))}>Delete</Button>}
        </div>
      ),
    }]),
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{meta?.label}</CardTitle>
          <CardDescription>{meta?.description}</CardDescription>
        </div>
        {!readOnly && <Button size="sm" onClick={onAdd}><Plus className="h-4 w-4 mr-1" />Add</Button>}
      </CardHeader>
      <CardContent>
        {records.length ? (
          <ResponsiveDataTable columns={cols} data={records} searchKeys={columns.map((c) => String(c.key))} />
        ) : (
          <EmptyState title="No records" message={`Configure ${meta?.label?.toLowerCase()} or reset to defaults.`} />
        )}
      </CardContent>
    </Card>
  );
}

export function ConfigurationPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const role = profile?.role;
  const canEdit = canEditCpvConfiguration(role);
  const canImportExport = canImportExportCpvConfiguration(role);
  const readOnly = isCpvConfigurationViewOnly(role) || !canEdit;
  const needsApproval = canApproveCpvConfiguration(role);

  const [bundle, setBundle] = useState<CpvConfigurationBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ConfigurationSectionId>('general');
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [changeReason, setChangeReason] = useState('');
  const [esignConfirmed, setEsignConfirmed] = useState(false);
  const [listDialogOpen, setListDialogOpen] = useState(false);
  const [listSection, setListSection] = useState<ConfigurationSectionId>('product');
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; details: string[] } | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const actor: Actor = useMemo(() => ({
    id: user?.uid || 'system',
    name: profile?.full_name || profile?.email || 'System',
    role,
  }), [user?.uid, profile?.full_name, profile?.email, role]);

  const generalForm = useForm({ resolver: zodResolver(generalSettingsSchema), defaultValues: generalSettingsSchema.parse({ defaultReviewFrequency: 'Yearly' }) });
  const globalForm = useForm({ resolver: zodResolver(globalOrgSettingsSchema), defaultValues: globalOrgSettingsSchema.parse({}) });
  const capabilityForm = useForm({ resolver: zodResolver(capabilitySettingsSchema), defaultValues: capabilitySettingsSchema.parse({}) });
  const spcForm = useForm({ resolver: zodResolver(spcSettingsSchema), defaultValues: spcSettingsSchema.parse({}) });
  const riskForm = useForm({ resolver: zodResolver(riskScoringSettingsSchema), defaultValues: riskScoringSettingsSchema.parse({}) });
  const aiForm = useForm({ resolver: zodResolver(aiSettingsSchema), defaultValues: aiSettingsSchema.parse({}) });
  const notificationForm = useForm({ resolver: zodResolver(notificationSettingsSchema), defaultValues: notificationSettingsSchema.parse({}) });
  const dashboardForm = useForm({ resolver: zodResolver(dashboardSettingsSchema), defaultValues: dashboardSettingsSchema.parse({}) });
  const exportForm = useForm({ resolver: zodResolver(exportReportSettingsSchema), defaultValues: exportReportSettingsSchema.parse({}) });
  const securityForm = useForm({ resolver: zodResolver(securitySettingsSchema), defaultValues: securitySettingsSchema.parse({}) });
  const backupForm = useForm({ resolver: zodResolver(backupSettingsSchema), defaultValues: backupSettingsSchema.parse({}) });
  const featureFlagsForm = useForm({ resolver: zodResolver(featureFlagsSchema), defaultValues: featureFlagsSchema.parse({}) });
  const listForm = useForm<FieldValues>({ defaultValues: {} });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCpvConfiguration();
      setBundle(data);
      if (data.general) generalForm.reset(data.general);
      if (data.global) globalForm.reset(data.global);
      if (data.capability) capabilityForm.reset(data.capability);
      if (data.spc) spcForm.reset(data.spc);
      if (data.risk) riskForm.reset(data.risk);
      if (data.ai) aiForm.reset(data.ai);
      if (data.notification) notificationForm.reset(data.notification);
      if (data.dashboard) dashboardForm.reset(data.dashboard);
      if (data.exportSettings) exportForm.reset(data.exportSettings);
      if (data.security) securityForm.reset(data.security);
      if (data.backup) backupForm.reset(data.backup);
      if (data.featureFlags) featureFlagsForm.reset(data.featureFlags);
    } catch {
      setError('Failed to load CPV configuration.');
    } finally {
      setLoading(false);
    }
  }, [
    generalForm, globalForm, capabilityForm, spcForm, riskForm, aiForm,
    notificationForm, dashboardForm, exportForm, securityForm, backupForm, featureFlagsForm,
  ]);

  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(
    () => (bundle ? summarizeConfiguration(bundle) : { totalRecords: 0, activeSections: 0, sectionCount: CONFIGURATION_SECTIONS.length }),
    [bundle],
  );
  const validation = useMemo(() => (bundle ? validateConfiguration(bundle) : null), [bundle]);

  const sectionCounts: Partial<Record<ConfigurationSectionId, number>> = useMemo(() => {
    if (!bundle) return {};
    return {
      product: bundle.products.length,
      cpp: bundle.cppParameters.length,
      cqa: bundle.cqaParameters.length,
      limits: bundle.limitRules.length,
      'review-frequency': bundle.reviewFrequency.length,
      'alert-rules': bundle.alertRules.length,
      'annual-template': bundle.annualTemplates.length,
      workflow: bundle.workflows.length,
      'data-source': bundle.dataSourceMappings.length,
    };
  }, [bundle]);

  const requiresEsignForConfirm = confirmAction === 'reset'
    || confirmAction === 'approve'
    || confirmAction === 'import'
    || (confirmAction === 'save' && (activeTab === 'security' || activeTab === 'backup'));

  const openConfirm = (action: ConfirmAction, tab?: ConfigurationSectionId) => {
    if (tab) setActiveTab(tab);
    setConfirmAction(action);
    setChangeReason('');
    setEsignConfirmed(false);
    setConfirmOpen(true);
  };

  const openListCreate = (section: ConfigurationSectionId, defaults: FieldValues) => {
    setListSection(section);
    setEditingListId(null);
    listForm.reset(defaults);
    setChangeReason('Configuration list update');
    setListDialogOpen(true);
  };

  const openListEdit = (section: ConfigurationSectionId, row: Record<string, unknown> & { id?: string }) => {
    setListSection(section);
    setEditingListId(row.id || null);
    listForm.reset(row);
    setChangeReason('Configuration list update');
    setListDialogOpen(true);
  };

  const getListSchema = (section: ConfigurationSectionId) => {
    const map: Record<string, z.ZodTypeAny> = {
      product: productCpvSettingsSchema,
      cpp: cppConfigurationSchema,
      cqa: cqaConfigurationSchema,
      limits: limitRuleSchema,
      'review-frequency': reviewFrequencySchema,
      'alert-rules': alertRuleConfigSchema,
      'annual-template': annualReviewTemplateSchema,
      workflow: workflowMappingSchema,
      'data-source': dataSourceMappingSchema,
    };
    return map[section];
  };

  const saveListRecord = listForm.handleSubmit(async (values) => {
    const reason = changeReason.trim();
    if (reason.length < 5) {
      toast.error('Reason for change must be at least 5 characters.');
      return;
    }
    const schema = getListSchema(listSection);
    const parsed = schema.parse(values);
    const col = LIST_COLS[listSection as keyof typeof LIST_COLS];
    setSaving(true);
    const result = editingListId
      ? await updateConfigListRecord(col, editingListId, parsed, actor, reason)
      : await createConfigListRecord(col, parsed, actor, reason);
    setSaving(false);
    if (result.error) return toast.error(result.error);
    toast.success(editingListId ? 'Configuration updated' : 'Configuration saved');
    setListDialogOpen(false);
    setChangeReason('');
    await load();
  });

  const deleteListRecord = async (section: ConfigurationSectionId, id: string) => {
    const reason = changeReason.trim().length >= 5 ? changeReason.trim() : 'Configuration list record deleted';
    const col = LIST_COLS[section as keyof typeof LIST_COLS];
    const { error: err } = await softDeleteConfigRecord(col, id, actor, reason);
    if (err) return toast.error(err);
    toast.success('Record removed');
    await load();
  };

  const saveSingleton = async (section: ConfigurationSectionId) => {
    const reason = changeReason.trim();
    if (reason.length < 5) {
      return toast.error('Reason for change must be at least 5 characters.');
    }
    const needsEsign = section === 'security'
      || section === 'backup'
      || (section === 'general'
        && Boolean(generalForm.getValues().requireESignatureForApproval)
        && Boolean(securityForm.getValues().requireEsignForConfig));
    if (needsEsign && !esignConfirmed) {
      return toast.error('Electronic signature confirmation is required.');
    }

    setSaving(true);
    let result: { error: string | null } = { error: null };
    if (section === 'general') {
      result = await saveGeneralSettings(
        generalForm.getValues() as never,
        actor,
        reason,
        needsEsign ? { esignConfirmed } : undefined,
      );
    } else if (section === 'global') {
      result = await saveGlobalOrgSettings(globalForm.getValues() as never, actor, reason);
    } else if (section === 'capability') {
      result = await saveCapabilitySettings(capabilityForm.getValues() as never, actor, reason);
    } else if (section === 'spc') {
      result = await saveSpcSettings(spcForm.getValues() as never, actor, reason);
    } else if (section === 'risk') {
      result = await saveRiskSettings(riskForm.getValues() as never, actor, reason);
    } else if (section === 'ai') {
      result = await saveAiSettings(aiForm.getValues() as never, actor, reason);
    } else if (section === 'notification') {
      result = await saveNotificationSettings(notificationForm.getValues() as never, actor, reason);
    } else if (section === 'dashboard') {
      result = await saveDashboardSettings(dashboardForm.getValues() as never, actor, reason);
    } else if (section === 'export') {
      result = await saveExportSettings(exportForm.getValues() as never, actor, reason);
    } else if (section === 'security') {
      result = await saveSecuritySettings(securityForm.getValues() as never, actor, reason, { esignConfirmed });
    } else if (section === 'backup') {
      result = await saveBackupSettings(backupForm.getValues() as never, actor, reason, { esignConfirmed });
    } else if (section === 'feature-flags') {
      result = await saveFeatureFlags(featureFlagsForm.getValues() as never, actor, reason);
    }
    setSaving(false);
    setConfirmOpen(false);
    setChangeReason('');
    setEsignConfirmed(false);
    if (result.error) return toast.error(result.error);
    toast.success('Configuration saved');
    await load();
  };

  const handleExportJson = async () => {
    const { json, error: err } = await exportConfigurationJson();
    if (err || !json) return toast.error(err || 'Export failed');
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cpv-configuration.json';
    a.click();
    URL.revokeObjectURL(url);
    await logConfigurationExport(actor);
    toast.success('Configuration exported');
  };

  const handleImportJson = async () => {
    if (!pendingImportFile) return toast.error('No import file selected.');
    const reason = changeReason.trim();
    if (reason.length < 5) return toast.error('Reason for change must be at least 5 characters.');
    if (!esignConfirmed) return toast.error('Electronic signature confirmation is required.');
    const text = await pendingImportFile.text();
    setSaving(true);
    const { error: err } = await importConfigurationJson(text, actor, { changeReason: reason, esignConfirmed: true });
    setSaving(false);
    setConfirmOpen(false);
    setChangeReason('');
    setEsignConfirmed(false);
    setPendingImportFile(null);
    if (err) return toast.error(err);
    toast.success('Configuration imported');
    await load();
  };

  const handleReset = async () => {
    const reason = changeReason.trim();
    if (reason.length < 5) return toast.error('Reason for change must be at least 5 characters.');
    if (!esignConfirmed) return toast.error('Electronic signature confirmation is required.');
    setSaving(true);
    const { error: err } = await resetConfigurationDefaults(actor, { changeReason: reason, esignConfirmed: true });
    setSaving(false);
    setConfirmOpen(false);
    setChangeReason('');
    setEsignConfirmed(false);
    if (err) return toast.error(err);
    toast.success('Configuration reset to defaults');
    await load();
  };

  const handleApprove = async () => {
    const reason = changeReason.trim();
    if (reason.length < 5) return toast.error('Reason for change must be at least 5 characters.');
    if (!esignConfirmed) return toast.error('Electronic signature confirmation is required.');
    setSaving(true);
    const { error: err } = await approveCpvConfiguration(actor, {
      changeReason: reason,
      esignConfirmed: true,
      snapshotSummary: `CPV configuration approved (${CONFIGURATION_SECTIONS.length} sections)`,
    });
    setSaving(false);
    setConfirmOpen(false);
    setChangeReason('');
    setEsignConfirmed(false);
    if (err) return toast.error(err);
    toast.success('Configuration approved');
    await load();
  };

  const handleTest = async () => {
    const result = await testConfiguration();
    setTestResult(result);
    toast[result.ok ? 'success' : 'error'](result.message);
  };

  const listDefaults: Record<string, DefaultValues<FieldValues>> = {
    product: { product: '', cpvRequired: true, reviewFrequency: 'Yearly', cpvOwner: 'production', qaReviewer: 'qa', finalApprover: 'head_qa', status: 'Active' },
    cpp: { parameterCode: '', parameterName: '', processStage: 'Manufacturing', targetValue: 0, lowerLimit: 0, upperLimit: 0, unit: '', frequency: 'Per Batch', criticality: 'Medium', autoDeviationRequired: false, autoCapaRequired: false, status: 'Active' },
    cqa: { parameterCode: '', parameterName: '', testStage: 'Finished Product Testing', targetValue: 0, lowerLimit: 0, upperLimit: 0, unit: '', resultType: 'Numeric', criticality: 'Medium', oosRequired: true, autoCapaRequired: false, status: 'Active' },
    limits: { ruleName: '', parameterType: 'CPP', moduleName: 'CPP Monitoring', alertLimitPercent: 80, actionLimitPercent: 95, repeatedFailureCount: 3, triggerDeviation: true, triggerOos: true, triggerCapa: false, status: 'Active' },
    'review-frequency': { product: 'All Products', moduleName: 'CPP', reviewFrequency: 'Quarterly', dueDay: 1, reminderBeforeDays: 7, escalationAfterDays: 3, responsibleRole: 'qa', reviewerRole: 'head_qa', status: 'Active' },
    'alert-rules': { ruleCode: '', ruleName: '', sourceModule: 'CPP Monitoring', condition: 'Value Outside Limit', priority: 'High', severity: 'Major', notifyRole: 'qa', escalationRole: 'head_qa', autoCreateDeviation: false, autoCreateOos: false, autoSuggestCapa: false, status: 'Active' },
    'annual-template': { templateName: '', templateVersion: '1.0', sectionsEnabled: [...ANNUAL_REVIEW_SECTIONS], requireAllSectionsBeforeApproval: true, status: 'Active' },
    workflow: {
      moduleName: '',
      workflow: 'Standard CPV Workflow',
      approvalMode: 'Sequential',
      eSignatureRequired: true,
      preparedByRole: 'qa',
      reviewedByRole: 'qa_manager',
      approvedByRole: 'head_qa',
      finalApproverRole: 'head_qa',
      slaHours: 48,
      allowDelegation: true,
      status: 'Active',
    },
    'data-source': { cpvSection: '', sourceCollection: '', productField: 'productName', batchField: 'batchNumber', parameterField: 'parameterName', observedValueField: 'observedValue', dateField: 'recordedDate', statusField: 'status', status: 'Active' },
  };

  const listColumns: Record<string, ColumnDef<Record<string, unknown> & { id?: string }>[]> = {
    product: [
      { key: 'product', header: 'Product' },
      { key: 'reviewFrequency', header: 'Frequency' },
      { key: 'cpvRequired', header: 'CPV Required', render: (r) => r.cpvRequired ? 'Yes' : 'No' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    cpp: [
      { key: 'parameterCode', header: 'Code' },
      { key: 'parameterName', header: 'Parameter' },
      { key: 'targetValue', header: 'Target' },
      { key: 'criticality', header: 'Criticality' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    cqa: [
      { key: 'parameterCode', header: 'Code' },
      { key: 'parameterName', header: 'Parameter' },
      { key: 'resultType', header: 'Type' },
      { key: 'criticality', header: 'Criticality' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    limits: [
      { key: 'ruleName', header: 'Rule' },
      { key: 'alertLimitPercent', header: 'Alert %' },
      { key: 'actionLimitPercent', header: 'Action %' },
      { key: 'repeatedFailureCount', header: 'Failures' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    'review-frequency': [
      { key: 'product', header: 'Product' },
      { key: 'moduleName', header: 'Module' },
      { key: 'reviewFrequency', header: 'Frequency' },
      { key: 'responsibleRole', header: 'Owner' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    'alert-rules': [
      { key: 'ruleCode', header: 'Code' },
      { key: 'ruleName', header: 'Rule' },
      { key: 'priority', header: 'Priority' },
      { key: 'sourceModule', header: 'Source' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    'annual-template': [
      { key: 'templateName', header: 'Template' },
      { key: 'templateVersion', header: 'Version' },
      { key: 'sectionsEnabled', header: 'Sections', render: (r) => Array.isArray(r.sectionsEnabled) ? r.sectionsEnabled.length : 0 },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    workflow: [
      { key: 'moduleName', header: 'Module' },
      { key: 'workflow', header: 'Workflow' },
      { key: 'finalApproverRole', header: 'Final Approver' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
    'data-source': [
      { key: 'cpvSection', header: 'CPV Section' },
      { key: 'sourceCollection', header: 'Collection' },
      { key: 'productField', header: 'Product Field' },
      { key: 'status', header: 'Status', render: (r) => <StatusBadge status={String(r.status)} /> },
    ],
  };

  const listRecords: Record<string, Array<Record<string, unknown> & { id?: string }>> = useMemo(() => ({
    product: bundle?.products || [],
    cpp: bundle?.cppParameters || [],
    cqa: bundle?.cqaParameters || [],
    limits: bundle?.limitRules || [],
    'review-frequency': bundle?.reviewFrequency || [],
    'alert-rules': bundle?.alertRules || [],
    'annual-template': bundle?.annualTemplates || [],
    workflow: bundle?.workflows || [],
    'data-source': bundle?.dataSourceMappings || [],
  }), [bundle]);

  if (loading) return <div className="p-4 sm:p-6"><LoadingSkeleton rows={2} /></div>;
  if (error || !bundle) return <div className="p-4 sm:p-6"><ErrorCard message={error || 'Configuration unavailable'} onRetry={load} /></div>;

  return (
    <div className="space-y-6">
      <CpvPageHeader
        title="CPV Configuration"
        description="Configure CPV rules, limits, workflows, reports and automation logic"
        trail={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Continued Process Verification', href: '/cpv/dashboard' },
          { label: 'CPV Configuration' },
        ]}
        actions={(
          <>
            <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
            <Button variant="outline" size="sm" onClick={() => void handleTest()}><TestTube2 className="h-4 w-4 mr-1" />Test</Button>
            {needsApproval && (
              <Button variant="outline" size="sm" onClick={() => openConfirm('approve')}>
                <CheckCircle2 className="h-4 w-4 mr-1" />Approve
              </Button>
            )}
            {canImportExport && (
              <>
                <Button variant="outline" size="sm" onClick={() => void handleExportJson()}><Download className="h-4 w-4 mr-1" />Export JSON</Button>
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4 mr-1" />Import JSON</Button>
                <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setPendingImportFile(file);
                    openConfirm('import');
                  }
                  e.target.value = '';
                }} />
                {!readOnly && (
                  <Button variant="outline" size="sm" onClick={() => openConfirm('reset')}>
                    <RotateCcw className="h-4 w-4 mr-1" />Reset Defaults
                  </Button>
                )}
              </>
            )}
          </>
        )}
      />

      <div className="flex flex-wrap gap-2">
        {CROSS_NAV.map((item) => (
          <Button
            key={item.href}
            type="button"
            variant="secondary"
            size="sm"
            className="h-8"
            onClick={() => router.push(item.href)}
          >
            {item.label}
          </Button>
        ))}
      </div>

      {readOnly && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 text-sm text-amber-900">
            {needsApproval ? 'Head QA can approve configuration changes.' : 'View-only mode — contact Admin to modify CPV configuration.'}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Records" value={summary.totalRecords} tone="blue" />
        <KpiCard label="Active Sections" value={`${summary.activeSections}/${summary.sectionCount}`} tone="green" />
        <KpiCard label="Completeness" value={`${validation?.completenessPct || 0}%`} tone={(validation?.completenessPct || 0) >= 80 ? 'green' : 'amber'} />
        <KpiCard label="Validation" value={validation?.valid ? 'Pass' : 'Issues'} tone={validation?.valid ? 'green' : 'red'} />
      </div>

      {testResult && (
        <Card className={testResult.ok ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
          <CardContent className="flex items-start gap-3 py-4 text-sm">
            <CheckCircle2 className={`h-5 w-5 shrink-0 ${testResult.ok ? 'text-green-700' : 'text-red-700'}`} />
            <div>
              <p className="font-medium">{testResult.message}</p>
              {testResult.details.map((d) => <p key={d} className="text-muted-foreground">{d}</p>)}
            </div>
          </CardContent>
        </Card>
      )}

      <ConfigurationTabs
        sections={CONFIGURATION_SECTIONS.map((s) => ({ id: s.id, label: s.label }))}
        active={activeTab}
        onChange={setActiveTab}
        counts={sectionCounts}
      >
        <ConfigurationTabPanel id="general">
          <Card>
            <CardHeader><CardTitle>General CPV Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...generalForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={generalForm.handleSubmit(() => openConfirm('save', 'general'))}>
                  <SwitchField form={generalForm} name="cpvEnabled" label="CPV Enabled" />
                  <SelectField form={generalForm} name="defaultReviewFrequency" label="Default Review Frequency *" options={['Monthly', 'Quarterly', 'Half Yearly', 'Yearly']} />
                  <TextField form={generalForm} name="defaultReviewPeriod" label="Default Review Period" />
                  <TextField form={generalForm} name="defaultProductOwnerRole" label="Default Product Owner Role" />
                  <TextField form={generalForm} name="defaultQaReviewerRole" label="Default QA Reviewer Role" />
                  <TextField form={generalForm} name="defaultFinalApproverRole" label="Default Final Approver Role" />
                  <TextField form={generalForm} name="configurationVersion" label="Configuration Version" />
                  <SwitchField form={generalForm} name="autoGenerateCpvReviewNumber" label="Auto Generate CPV Review Number" />
                  <SwitchField form={generalForm} name="autoPullDataFromModules" label="Auto Pull Data From Modules" />
                  <SwitchField form={generalForm} name="autoCreateAlerts" label="Auto Create Alerts" />
                  <SwitchField form={generalForm} name="autoCreateRiskRecords" label="Auto Create Risk Records" />
                  <SwitchField form={generalForm} name="autoSuggestCapa" label="Auto Suggest CAPA" />
                  <SwitchField form={generalForm} name="requireESignatureForApproval" label="Require E-Signature For Approval" />
                  <SwitchField form={generalForm} name="allowQaOverride" label="Allow QA Override" />
                  <SelectField form={generalForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save General Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="global">
          <Card>
            <CardHeader><CardTitle>Global / Organization Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...globalForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={globalForm.handleSubmit(() => openConfirm('save', 'global'))}>
                  <TextField form={globalForm} name="organizationName" label="Organization Name" />
                  <TextField form={globalForm} name="companyName" label="Company Name" />
                  <TextField form={globalForm} name="plantName" label="Plant Name" />
                  <TextField form={globalForm} name="siteName" label="Site Name" />
                  <TextField form={globalForm} name="department" label="Department" />
                  <TextField form={globalForm} name="timeZone" label="Time Zone" />
                  <TextField form={globalForm} name="language" label="Language" />
                  <TextField form={globalForm} name="dateFormat" label="Date Format" />
                  <TextField form={globalForm} name="numberFormat" label="Number Format" />
                  <TextField form={globalForm} name="currency" label="Currency" />
                  <NumberField form={globalForm} name="fiscalYearStartMonth" label="Fiscal Year Start Month" />
                  <SelectField form={globalForm} name="environment" label="Environment" options={['Development', 'Testing', 'Production']} />
                  <SwitchField form={globalForm} name="businessCalendarEnabled" label="Business Calendar Enabled" />
                  <SwitchField form={globalForm} name="holidayCalendarEnabled" label="Holiday Calendar Enabled" />
                  <SwitchField form={globalForm} name="shiftCalendarEnabled" label="Shift Calendar Enabled" />
                  <SelectField form={globalForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save Global Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        {LIST_SECTIONS.slice(0, 6).map((section) => (
          <ConfigurationTabPanel key={section} id={section}>
            <ListSectionPanel
              sectionId={section}
              records={listRecords[section]}
              columns={listColumns[section]}
              readOnly={readOnly}
              onAdd={() => openListCreate(section, listDefaults[section])}
              onEdit={(row) => openListEdit(section, row)}
              onDelete={(id) => void deleteListRecord(section, id)}
            />
          </ConfigurationTabPanel>
        ))}

        <ConfigurationTabPanel id="capability">
          <Card>
            <CardHeader><CardTitle>Process Capability Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...capabilityForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={capabilityForm.handleSubmit(() => openConfirm('save', 'capability'))}>
                  <NumberField form={capabilityForm} name="minimumSampleCount" label="Minimum Sample Count *" />
                  <NumberField form={capabilityForm} name="cpkExcellentLimit" label="Cpk Excellent Limit" />
                  <NumberField form={capabilityForm} name="cpkAcceptableLimit" label="Cpk Acceptable Limit" />
                  <NumberField form={capabilityForm} name="cpkWarningLimit" label="Cpk Warning Limit" />
                  <NumberField form={capabilityForm} name="cpkCriticalLimit" label="Cpk Critical Limit" />
                  <NumberField form={capabilityForm} name="autoRiskIfCpkBelow" label="Auto Risk If Cpk Below" />
                  <NumberField form={capabilityForm} name="autoCapaIfCpkBelow" label="Auto CAPA If Cpk Below" />
                  <NumberField form={capabilityForm} name="sigmaLimits" label="Sigma Limits" />
                  <TextField form={capabilityForm} name="cpFormula" label="Cp Formula" />
                  <TextField form={capabilityForm} name="cpkFormula" label="Cpk Formula" />
                  <SwitchField form={capabilityForm} name="cpRequired" label="Cp Required" />
                  <SwitchField form={capabilityForm} name="ppPpkRequired" label="Pp/Ppk Required" />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit"><Save className="h-4 w-4 mr-1" />Save Capability Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="spc">
          <Card>
            <CardHeader><CardTitle>SPC Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...spcForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={spcForm.handleSubmit(() => openConfirm('save', 'spc'))}>
                  <SelectField form={spcForm} name="defaultChartType" label="Default Chart Type" options={['Individuals Chart', 'X-Bar R Chart', 'X-Bar S Chart', 'P Chart', 'NP Chart']} />
                  <TextField form={spcForm} name="samplingFrequency" label="Sampling Frequency" />
                  <NumberField form={spcForm} name="defaultSampleSize" label="Default Sample Size" />
                  <NumberField form={spcForm} name="ewmaLambda" label="EWMA Lambda" />
                  <SwitchField form={spcForm} name="enableRule1OutsideControlLimit" label="Rule 1: Outside Control Limit" />
                  <SwitchField form={spcForm} name="enableRule2SevenPointsSameSide" label="Rule 2: Seven Points Same Side" />
                  <SwitchField form={spcForm} name="enableRule3SixIncreasingDecreasing" label="Rule 3: Six Increasing/Decreasing" />
                  <SwitchField form={spcForm} name="enableRule4TwoOfThreeNearLimit" label="Rule 4: Two of Three Near Limit" />
                  <SwitchField form={spcForm} name="enableWesternElectricRules" label="Enable Western Electric Rules" />
                  <SwitchField form={spcForm} name="enableNelsonRules" label="Enable Nelson Rules" />
                  <SwitchField form={spcForm} name="enableCusum" label="Enable CUSUM" />
                  <SwitchField form={spcForm} name="enableEwma" label="Enable EWMA" />
                  <SwitchField form={spcForm} name="enableAutoRiskCreation" label="Enable Auto Risk Creation" />
                  <SwitchField form={spcForm} name="enableCapaSuggestion" label="Enable CAPA Suggestion" />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit"><Save className="h-4 w-4 mr-1" />Save SPC Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="risk">
          <Card>
            <CardHeader><CardTitle>Risk Scoring Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...riskForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={riskForm.handleSubmit(() => openConfirm('save', 'risk'))}>
                  <SelectField form={riskForm} name="riskMethod" label="Risk Method" options={['RPN', 'Matrix', 'Qualitative']} />
                  <NumberField form={riskForm} name="severityScale" label="Severity Scale" />
                  <NumberField form={riskForm} name="occurrenceScale" label="Occurrence Scale" />
                  <NumberField form={riskForm} name="detectionScale" label="Detection Scale" />
                  <NumberField form={riskForm} name="lowRiskMaxRpn" label="Low Risk Max RPN" />
                  <NumberField form={riskForm} name="mediumRiskMaxRpn" label="Medium Risk Max RPN" />
                  <NumberField form={riskForm} name="highRiskMaxRpn" label="High Risk Max RPN" />
                  <NumberField form={riskForm} name="criticalRiskMinRpn" label="Critical Risk Min RPN" />
                  <SwitchField form={riskForm} name="autoCapaForCriticalRisk" label="Auto CAPA For Critical Risk" />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit"><Save className="h-4 w-4 mr-1" />Save Risk Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="ai">
          <Card>
            <CardHeader><CardTitle>AI Configuration</CardTitle></CardHeader>
            <CardContent>
              <Form {...aiForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={aiForm.handleSubmit(() => openConfirm('save', 'ai'))}>
                  <SwitchField form={aiForm} name="aiEnabled" label="AI Enabled" />
                  <SwitchField form={aiForm} name="enablePredictiveAlerts" label="Enable Predictive Alerts" />
                  <SwitchField form={aiForm} name="enableInsights" label="Enable Insights" />
                  <SwitchField form={aiForm} name="enableRecommendations" label="Enable Recommendations" />
                  <SwitchField form={aiForm} name="enableRiskPrediction" label="Enable Risk Prediction" />
                  <SwitchField form={aiForm} name="enableTrendPrediction" label="Enable Trend Prediction" />
                  <SwitchField form={aiForm} name="enableRootCauseAnalysis" label="Enable Root Cause Analysis" />
                  <SwitchField form={aiForm} name="enablePreventiveRecommendations" label="Enable Preventive Recommendations" />
                  <NumberField form={aiForm} name="confidenceThreshold" label="Confidence Threshold" />
                  <NumberField form={aiForm} name="predictionThreshold" label="Prediction Threshold" />
                  <SwitchField form={aiForm} name="enableForCpp" label="Enable for CPP" />
                  <SwitchField form={aiForm} name="enableForCqa" label="Enable for CQA" />
                  <SwitchField form={aiForm} name="enableForYield" label="Enable for Yield" />
                  <SwitchField form={aiForm} name="enableForSpc" label="Enable for SPC" />
                  <SwitchField form={aiForm} name="enableForRisk" label="Enable for Risk" />
                  <SwitchField form={aiForm} name="enableForAlerts" label="Enable for Alerts" />
                  <SelectField form={aiForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save AI Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="notification">
          <Card>
            <CardHeader><CardTitle>Notification Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...notificationForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={notificationForm.handleSubmit(() => openConfirm('save', 'notification'))}>
                  <SwitchField form={notificationForm} name="enableInApp" label="Enable In-App" />
                  <SwitchField form={notificationForm} name="enableEmail" label="Enable Email" />
                  <SwitchField form={notificationForm} name="enableSms" label="Enable SMS" />
                  <SwitchField form={notificationForm} name="enableWhatsApp" label="Enable WhatsApp" />
                  <SwitchField form={notificationForm} name="enableTeams" label="Enable Teams" />
                  <SwitchField form={notificationForm} name="enableSlack" label="Enable Slack" />
                  <SwitchField form={notificationForm} name="enablePush" label="Enable Push" />
                  <SwitchField form={notificationForm} name="enableFcm" label="Enable FCM" />
                  <SwitchField form={notificationForm} name="reminderEnabled" label="Reminder Enabled" />
                  <NumberField form={notificationForm} name="reminderBeforeHours" label="Reminder Before Hours" />
                  <NumberField form={notificationForm} name="retryAttempts" label="Retry Attempts" />
                  <NumberField form={notificationForm} name="retryIntervalMinutes" label="Retry Interval (Minutes)" />
                  <SwitchField form={notificationForm} name="quietHoursEnabled" label="Quiet Hours Enabled" />
                  <TextField form={notificationForm} name="quietHoursStart" label="Quiet Hours Start" />
                  <TextField form={notificationForm} name="quietHoursEnd" label="Quiet Hours End" />
                  <TextField form={notificationForm} name="defaultTemplate" label="Default Template" />
                  <SelectField form={notificationForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save Notification Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        {LIST_SECTIONS.slice(6).map((section) => (
          <ConfigurationTabPanel key={section} id={section}>
            <ListSectionPanel
              sectionId={section}
              records={listRecords[section]}
              columns={listColumns[section]}
              readOnly={readOnly}
              onAdd={() => openListCreate(section, listDefaults[section])}
              onEdit={(row) => openListEdit(section, row)}
              onDelete={(id) => void deleteListRecord(section, id)}
            />
          </ConfigurationTabPanel>
        ))}

        <ConfigurationTabPanel id="dashboard">
          <Card>
            <CardHeader><CardTitle>Dashboard Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...dashboardForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={dashboardForm.handleSubmit(() => openConfirm('save', 'dashboard'))}>
                  <SwitchField form={dashboardForm} name="enableExecutiveDashboard" label="Enable Executive Dashboard" />
                  <SwitchField form={dashboardForm} name="enableRoleBasedLayouts" label="Enable Role-Based Layouts" />
                  <SelectField form={dashboardForm} name="defaultTheme" label="Default Theme" options={['System', 'Light', 'Dark']} />
                  <SwitchField form={dashboardForm} name="showKpiCards" label="Show KPI Cards" />
                  <SwitchField form={dashboardForm} name="showTrendCharts" label="Show Trend Charts" />
                  <SwitchField form={dashboardForm} name="showAlertFeed" label="Show Alert Feed" />
                  <SwitchField form={dashboardForm} name="showAiPanel" label="Show AI Panel" />
                  <NumberField form={dashboardForm} name="refreshIntervalSeconds" label="Refresh Interval (Seconds)" />
                  <TextField form={dashboardForm} name="savedLayoutName" label="Saved Layout Name" />
                  <SelectField form={dashboardForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save Dashboard Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="export">
          <Card>
            <CardHeader><CardTitle>Export & Report Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...exportForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={exportForm.handleSubmit(() => openConfirm('save', 'export'))}>
                  <SwitchField form={exportForm} name="enablePdfExport" label="Enable PDF Export" />
                  <SwitchField form={exportForm} name="enableExcelExport" label="Enable Excel Export" />
                  <SwitchField form={exportForm} name="enableCsvExport" label="Enable CSV Export" />
                  <SwitchField form={exportForm} name="enablePrint" label="Enable Print" />
                  <SwitchField form={exportForm} name="enableScheduledReports" label="Enable Scheduled Reports" />
                  <SwitchField form={exportForm} name="enableWatermark" label="Enable Watermark" />
                  <TextField form={exportForm} name="watermarkText" label="Watermark Text" />
                  <TextField form={exportForm} name="reportHeaderSource" label="Report Header Source" />
                  <SwitchField form={exportForm} name="showCompanyLogo" label="Show Company Logo" />
                  <SwitchField form={exportForm} name="showPageNumber" label="Show Page Number" />
                  <SwitchField form={exportForm} name="showRevisionNumber" label="Show Revision Number" />
                  <SwitchField form={exportForm} name="showESignatureBlock" label="Show E-Signature Block" />
                  <SwitchField form={exportForm} name="showAuditTrailSummary" label="Show Audit Trail Summary" />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit"><Save className="h-4 w-4 mr-1" />Save Export Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="security">
          <Card>
            <CardHeader><CardTitle>Security Configuration</CardTitle></CardHeader>
            <CardContent>
              <Form {...securityForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={securityForm.handleSubmit(() => openConfirm('save', 'security'))}>
                  <SwitchField form={securityForm} name="enforceRbac" label="Enforce RBAC" />
                  <SwitchField form={securityForm} name="requireMfaForCriticalChanges" label="Require MFA for Critical Changes" />
                  <NumberField form={securityForm} name="sessionTimeoutMinutes" label="Session Timeout (Minutes)" />
                  <NumberField form={securityForm} name="passwordMinLength" label="Password Min Length" />
                  <SwitchField form={securityForm} name="ipWhitelistEnabled" label="IP Whitelist Enabled" />
                  <TextField form={securityForm} name="ipWhitelist" label="IP Whitelist" />
                  <SwitchField form={securityForm} name="auditAllConfigChanges" label="Audit All Config Changes" />
                  <SwitchField form={securityForm} name="encryptNotificationPayloads" label="Encrypt Notification Payloads" />
                  <SwitchField form={securityForm} name="requireEsignForConfig" label="Require E-Sign for Config" />
                  <SelectField form={securityForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save Security Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="backup">
          <Card>
            <CardHeader><CardTitle>Backup & Restore Settings</CardTitle></CardHeader>
            <CardContent>
              <Form {...backupForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={backupForm.handleSubmit(() => openConfirm('save', 'backup'))}>
                  <SwitchField form={backupForm} name="autoBackupEnabled" label="Auto Backup Enabled" />
                  <SelectField form={backupForm} name="backupFrequency" label="Backup Frequency" options={['Daily', 'Weekly', 'Monthly']} />
                  <NumberField form={backupForm} name="retentionDays" label="Retention Days" />
                  <SwitchField form={backupForm} name="verifyAfterBackup" label="Verify After Backup" />
                  <SwitchField form={backupForm} name="storeInCloudStorage" label="Store in Cloud Storage" />
                  <SwitchField form={backupForm} name="includeAuditTrail" label="Include Audit Trail" />
                  <SwitchField form={backupForm} name="disasterRecoveryEnabled" label="Disaster Recovery Enabled" />
                  <TextField form={backupForm} name="lastBackupAt" label="Last Backup At" />
                  <SelectField form={backupForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save Backup Settings</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>

        <ConfigurationTabPanel id="feature-flags">
          <Card>
            <CardHeader><CardTitle>Feature Flags</CardTitle></CardHeader>
            <CardContent>
              <Form {...featureFlagsForm}>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={featureFlagsForm.handleSubmit(() => openConfirm('save', 'feature-flags'))}>
                  <SwitchField form={featureFlagsForm} name="enableYieldModule" label="Enable Yield Module" />
                  <SwitchField form={featureFlagsForm} name="enableEnvironmentalModule" label="Enable Environmental Module" />
                  <SwitchField form={featureFlagsForm} name="enableUtilityModule" label="Enable Utility Module" />
                  <SwitchField form={featureFlagsForm} name="enableHoldTimeModule" label="Enable Hold Time Module" />
                  <SwitchField form={featureFlagsForm} name="enableStabilityModule" label="Enable Stability Module" />
                  <SwitchField form={featureFlagsForm} name="enableSpcModule" label="Enable SPC Module" />
                  <SwitchField form={featureFlagsForm} name="enableCapabilityModule" label="Enable Capability Module" />
                  <SwitchField form={featureFlagsForm} name="enableRiskModule" label="Enable Risk Module" />
                  <SwitchField form={featureFlagsForm} name="enableAlertEngine" label="Enable Alert Engine" />
                  <SwitchField form={featureFlagsForm} name="enableAiAnalytics" label="Enable AI Analytics" />
                  <SwitchField form={featureFlagsForm} name="enableAnnualReview" label="Enable Annual Review" />
                  <SwitchField form={featureFlagsForm} name="enableReportsAnalytics" label="Enable Reports Analytics" />
                  <SelectField form={featureFlagsForm} name="status" label="Status" options={['Active', 'Inactive']} />
                  {!readOnly && <div className="sm:col-span-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4 mr-1" />Save Feature Flags</Button></div>}
                </form>
              </Form>
            </CardContent>
          </Card>
        </ConfigurationTabPanel>
      </ConfigurationTabs>

      <Dialog open={listDialogOpen} onOpenChange={setListDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingListId ? 'Edit' : 'Add'} {CONFIGURATION_SECTIONS.find((s) => s.id === listSection)?.label}</DialogTitle>
          </DialogHeader>
          <Form {...listForm}>
            <form onSubmit={saveListRecord} className="grid gap-4 sm:grid-cols-2">
              {listSection === 'product' && (
                <>
                  <TextField form={listForm} name="product" label="Product *" />
                  <SwitchField form={listForm} name="cpvRequired" label="CPV Required" />
                  <TextField form={listForm} name="cpvStartDate" label="CPV Start Date" />
                  <SelectField form={listForm} name="reviewFrequency" label="Review Frequency" options={['Monthly', 'Quarterly', 'Half Yearly', 'Yearly']} />
                  <TextField form={listForm} name="cpvOwner" label="CPV Owner" />
                  <TextField form={listForm} name="qaReviewer" label="QA Reviewer" />
                </>
              )}
              {listSection === 'cpp' && (
                <>
                  <TextField form={listForm} name="parameterCode" label="Parameter Code *" />
                  <TextField form={listForm} name="parameterName" label="Parameter Name *" />
                  <TextField form={listForm} name="processStage" label="Process Stage" />
                  <NumberField form={listForm} name="targetValue" label="Target Value *" />
                  <NumberField form={listForm} name="lowerLimit" label="Lower Limit *" />
                  <NumberField form={listForm} name="upperLimit" label="Upper Limit *" />
                  <TextField form={listForm} name="unit" label="Unit *" />
                </>
              )}
              {listSection === 'cqa' && (
                <>
                  <TextField form={listForm} name="parameterCode" label="Parameter Code *" />
                  <SelectField
                    form={listForm}
                    name="testStage"
                    label="Test Stage *"
                    options={[...CQA_TEST_STAGES]}
                  />
                  <SelectField
                    form={listForm}
                    name="parameterName"
                    label="Parameter Name *"
                    options={[...CQA_STAGE_PARAMETERS[(listForm.watch('testStage') as typeof CQA_TEST_STAGES[number]) || CQA_TEST_STAGES[1]]]}
                  />
                  <TextField form={listForm} name="specificationNumber" label="Specification Number" />
                  <NumberField form={listForm} name="targetValue" label="Target Value *" />
                  <NumberField form={listForm} name="lowerLimit" label="Lower Limit *" />
                  <NumberField form={listForm} name="upperLimit" label="Upper Limit *" />
                  <TextField form={listForm} name="unit" label="Unit *" />
                </>
              )}
              {listSection === 'limits' && (
                <>
                  <TextField form={listForm} name="ruleName" label="Rule Name *" />
                  <NumberField form={listForm} name="alertLimitPercent" label="Alert Limit %" />
                  <NumberField form={listForm} name="actionLimitPercent" label="Action Limit %" />
                  <NumberField form={listForm} name="repeatedFailureCount" label="Repeated Failure Count" />
                </>
              )}
              {listSection === 'review-frequency' && (
                <>
                  <TextField form={listForm} name="product" label="Product *" />
                  <SelectField form={listForm} name="moduleName" label="Module Name" options={['CPP', 'CQA', 'Yield', 'Stability', 'Risk', 'Annual CPV Review']} />
                  <SelectField form={listForm} name="reviewFrequency" label="Review Frequency" options={['Monthly', 'Quarterly', 'Half Yearly', 'Yearly']} />
                  <NumberField form={listForm} name="dueDay" label="Due Day" />
                </>
              )}
              {listSection === 'alert-rules' && (
                <>
                  <TextField form={listForm} name="ruleCode" label="Rule Code *" />
                  <TextField form={listForm} name="ruleName" label="Rule Name *" />
                  <TextField form={listForm} name="sourceModule" label="Source Module" />
                  <TextField form={listForm} name="condition" label="Condition" />
                </>
              )}
              {listSection === 'annual-template' && (
                <>
                  <TextField form={listForm} name="templateName" label="Template Name *" />
                  <TextField form={listForm} name="templateVersion" label="Template Version" />
                  <FormField control={listForm.control} name="sectionsEnabled" render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel>Sections Enabled</FormLabel>
                      <div className="flex flex-wrap gap-2 rounded-md border p-3 max-h-40 overflow-y-auto">
                        {ANNUAL_REVIEW_SECTIONS.map((section) => {
                          const selected = Array.isArray(field.value) && field.value.includes(section);
                          return (
                            <Badge
                              key={section}
                              variant={selected ? 'default' : 'outline'}
                              className="cursor-pointer"
                              onClick={() => {
                                const current = Array.isArray(field.value) ? field.value : [];
                                field.onChange(selected ? current.filter((s: string) => s !== section) : [...current, section]);
                              }}
                            >
                              {section}
                            </Badge>
                          );
                        })}
                      </div>
                    </FormItem>
                  )} />
                </>
              )}
              {listSection === 'workflow' && (
                <>
                  <TextField form={listForm} name="moduleName" label="Module Name *" />
                  <TextField form={listForm} name="workflow" label="Workflow" />
                  <SelectField form={listForm} name="approvalMode" label="Approval Mode" options={['Sequential', 'Parallel', 'Conditional']} />
                  <NumberField form={listForm} name="slaHours" label="SLA Hours" />
                  <SwitchField form={listForm} name="allowDelegation" label="Allow Delegation" />
                  <TextField form={listForm} name="preparedByRole" label="Prepared By Role" />
                  <TextField form={listForm} name="finalApproverRole" label="Final Approver Role" />
                </>
              )}
              {listSection === 'data-source' && (
                <>
                  <TextField form={listForm} name="cpvSection" label="CPV Section *" />
                  <TextField form={listForm} name="sourceCollection" label="Source Collection *" />
                  <TextField form={listForm} name="productField" label="Product Field" />
                  <TextField form={listForm} name="batchField" label="Batch Field" />
                  <TextField form={listForm} name="parameterField" label="Parameter Field" />
                  <TextField form={listForm} name="observedValueField" label="Observed Value Field" />
                </>
              )}
              <SelectField form={listForm} name="status" label="Status" options={['Active', 'Inactive']} />
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="listChangeReason">Reason for change *</Label>
                <Textarea
                  id="listChangeReason"
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  rows={3}
                  placeholder="ALCOA+ change reason (min 5 characters)"
                />
              </div>
              <DialogFooter className="sm:col-span-2">
                <Button type="button" variant="outline" onClick={() => setListDialogOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>Save</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => {
        setConfirmOpen(open);
        if (!open) {
          setPendingImportFile(null);
          setEsignConfirmed(false);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === 'reset'
                ? 'Reset to default configuration?'
                : confirmAction === 'approve'
                  ? 'Approve CPV configuration?'
                  : confirmAction === 'import'
                    ? 'Import configuration JSON?'
                    : 'Confirm configuration change'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === 'reset'
                ? 'This will restore default CPV settings. Existing singleton settings will be overwritten and default list records added.'
                : confirmAction === 'approve'
                  ? 'Approve the current CPV configuration package. An electronic signature and change reason are required.'
                  : confirmAction === 'import'
                    ? 'Imported settings will overwrite the current configuration. An electronic signature and change reason are required.'
                    : 'Provide a reason for this configuration change. The change will be recorded in the audit trail.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="changeReason">Reason for change *</Label>
              <Textarea id="changeReason" value={changeReason} onChange={(e) => setChangeReason(e.target.value)} rows={3} />
            </div>
            {requiresEsignForConfirm && (
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="esignConfirmed"
                  checked={esignConfirmed}
                  onCheckedChange={(checked) => setEsignConfirmed(checked === true)}
                />
                <Label htmlFor="esignConfirmed" className="font-normal leading-snug">
                  I confirm this change with my electronic signature (ALCOA+ / Part 11).
                </Label>
              </div>
            )}
            {confirmAction === 'save'
              && activeTab === 'general'
              && Boolean(generalForm.getValues().requireESignatureForApproval)
              && Boolean(securityForm.getValues().requireEsignForConfig) && (
              <div className="flex items-start gap-3 rounded-lg border p-3">
                <Checkbox
                  id="esignConfirmedGeneral"
                  checked={esignConfirmed}
                  onCheckedChange={(checked) => setEsignConfirmed(checked === true)}
                />
                <Label htmlFor="esignConfirmedGeneral" className="font-normal leading-snug">
                  I confirm this general settings change with my electronic signature.
                </Label>
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (confirmAction === 'reset') void handleReset();
              else if (confirmAction === 'approve') void handleApprove();
              else if (confirmAction === 'import') void handleImportJson();
              else if (confirmAction === 'save') void saveSingleton(activeTab);
            }}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ConfigurationPageWithGuard() {
  return (
    <ConfigurationAccessGuard>
      <ConfigurationPage />
    </ConfigurationAccessGuard>
  );
}
