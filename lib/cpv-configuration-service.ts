import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseFirestore, getFirebaseFunctions, isFirebaseConfigured } from '@/lib/firebase';
import {
  CPV_CONFIG_COLLECTIONS,
  type AiSettings,
  type AlertRuleConfig,
  type AnnualReviewTemplate,
  type BackupSettings,
  type CapabilitySettings,
  type CpvConfigurationBundle,
  type CppConfiguration,
  type CqaConfiguration,
  type DashboardSettings,
  type DataSourceMapping,
  type ExportReportSettings,
  type FeatureFlags,
  type GeneralSettings,
  type GlobalOrgSettings,
  type LimitRule,
  type NotificationSettings,
  type ProductCpvSettings,
  type ReviewFrequencyConfig,
  type RiskScoringSettings,
  type SecuritySettings,
  type SpcSettings,
  type WorkflowMapping,
  validateConfiguration,
  withConfigurationDefaults,
} from '@/lib/cpv-configuration-records';

export type CpvConfigActor = { id: string; name: string; role?: string };

const SINGLETON_DOCS = {
  general: 'general_settings',
  global: 'global_org_settings',
  capability: 'process_capability_settings',
  spc: 'spc_settings',
  risk: 'risk_scoring_settings',
  ai: 'ai_settings',
  notification: 'notification_settings',
  dashboard: 'dashboard_settings',
  export: 'export_report_settings',
  security: 'security_settings',
  backup: 'backup_settings',
  featureFlags: 'feature_flags',
} as const;

export const CONFIG_LIST_COLLECTIONS = {
  product: CPV_CONFIG_COLLECTIONS.products,
  cpp: CPV_CONFIG_COLLECTIONS.cppParameters,
  cqa: CPV_CONFIG_COLLECTIONS.cqaParameters,
  limits: CPV_CONFIG_COLLECTIONS.limitRules,
  'review-frequency': CPV_CONFIG_COLLECTIONS.reviewFrequency,
  'alert-rules': CPV_CONFIG_COLLECTIONS.alertRules,
  'annual-template': CPV_CONFIG_COLLECTIONS.reportTemplates,
  workflow: CPV_CONFIG_COLLECTIONS.workflows,
  'data-source': CPV_CONFIG_COLLECTIONS.integrationMapping,
} as const;

function callableErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = String((e as { message?: string }).message || '');
    if (msg) return msg.replace(/^Firebase:\s*/i, '').replace(/\s*\([^)]*\)\.?$/, '').trim() || fallback;
  }
  return fallback;
}

function resolveChangeReason(primary?: string | null, defaultReason?: string): string | null {
  const candidate = (primary || defaultReason || '').trim();
  return candidate.length >= 5 ? candidate : null;
}

async function listCollection<T extends { id?: string; isDeleted?: boolean }>(
  collectionName: string,
  max = 500,
): Promise<T[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), collectionName),
      where('isDeleted', '==', false),
      orderBy('updatedAt', 'desc'),
      limit(max),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as T));
  } catch {
    try {
      const snap = await getDocs(query(collection(getFirebaseFirestore(), collectionName), limit(max)));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as T))
        .filter((r) => r.isDeleted !== true);
    } catch (e) {
      console.error(`listCollection ${collectionName} failed`, e);
      return [];
    }
  }
}

async function getSingleton<T>(docId: string): Promise<(T & { id: string }) | null> {
  if (!isFirebaseConfigured()) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), CPV_CONFIG_COLLECTIONS.main, docId));
    if (!snap.exists() || snap.data()?.isDeleted) return null;
    return { id: snap.id, ...snap.data() } as T & { id: string };
  } catch (e) {
    console.error(`getSingleton ${docId} failed`, e);
    return null;
  }
}

function emptyBundle(): CpvConfigurationBundle {
  return {
    general: null, global: null, products: [], cppParameters: [], cqaParameters: [], limitRules: [],
    reviewFrequency: [], alertRules: [], capability: null, spc: null, risk: null, ai: null,
    notification: null, annualTemplates: [], workflows: [], dataSourceMappings: [],
    dashboard: null, exportSettings: null, security: null, backup: null, featureFlags: null,
  };
}

export async function fetchCpvConfiguration(): Promise<CpvConfigurationBundle> {
  if (!isFirebaseConfigured()) return withConfigurationDefaults(emptyBundle());

  try {
    const [
      products, cppParameters, cqaParameters, limitRules, reviewFrequency,
      alertRules, annualTemplates, workflows, dataSourceMappings,
    ] = await Promise.all([
      listCollection<ProductCpvSettings>(CPV_CONFIG_COLLECTIONS.products),
      listCollection<CppConfiguration>(CPV_CONFIG_COLLECTIONS.cppParameters),
      listCollection<CqaConfiguration>(CPV_CONFIG_COLLECTIONS.cqaParameters),
      listCollection<LimitRule>(CPV_CONFIG_COLLECTIONS.limitRules),
      listCollection<ReviewFrequencyConfig>(CPV_CONFIG_COLLECTIONS.reviewFrequency),
      listCollection<AlertRuleConfig>(CPV_CONFIG_COLLECTIONS.alertRules),
      listCollection<AnnualReviewTemplate>(CPV_CONFIG_COLLECTIONS.reportTemplates),
      listCollection<WorkflowMapping>(CPV_CONFIG_COLLECTIONS.workflows),
      listCollection<DataSourceMapping>(CPV_CONFIG_COLLECTIONS.integrationMapping),
    ]);

    const [
      general, global, capability, spc, risk, ai, notification, dashboard,
      exportSettings, security, backup, featureFlags,
    ] = await Promise.all([
      getSingleton<GeneralSettings>(SINGLETON_DOCS.general),
      getSingleton<GlobalOrgSettings>(SINGLETON_DOCS.global),
      getSingleton<CapabilitySettings>(SINGLETON_DOCS.capability),
      getSingleton<SpcSettings>(SINGLETON_DOCS.spc),
      getSingleton<RiskScoringSettings>(SINGLETON_DOCS.risk),
      getSingleton<AiSettings>(SINGLETON_DOCS.ai),
      getSingleton<NotificationSettings>(SINGLETON_DOCS.notification),
      getSingleton<DashboardSettings>(SINGLETON_DOCS.dashboard),
      getSingleton<ExportReportSettings>(SINGLETON_DOCS.export),
      getSingleton<SecuritySettings>(SINGLETON_DOCS.security),
      getSingleton<BackupSettings>(SINGLETON_DOCS.backup),
      getSingleton<FeatureFlags>(SINGLETON_DOCS.featureFlags),
    ]);

    return withConfigurationDefaults({
      general,
      global,
      products,
      cppParameters,
      cqaParameters,
      limitRules,
      reviewFrequency,
      alertRules,
      capability,
      spc,
      risk,
      ai,
      notification,
      annualTemplates,
      workflows,
      dataSourceMappings,
      dashboard,
      exportSettings,
      security,
      backup,
      featureFlags,
    });
  } catch (e) {
    console.error('fetchCpvConfiguration failed', e);
    return withConfigurationDefaults(emptyBundle());
  }
}

async function saveSingletonViaCf(
  docId: string,
  data: Record<string, unknown>,
  changeReason: string,
  esignConfirmed = false,
) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'saveAdminCpvConfigSingleton');
    await fn({ docId, data, changeReason, esignConfirmed });
    return { error: null };
  } catch (e) {
    console.error(`saveSingletonViaCf ${docId} failed`, e);
    return { error: callableErrorMessage(e, 'Failed to save configuration.') };
  }
}

export async function saveGeneralSettings(
  data: GeneralSettings,
  _actor: CpvConfigActor,
  reason?: string,
  options?: { esignConfirmed?: boolean },
) {
  const changeReason = resolveChangeReason(reason, 'General CPV settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  if (data.cpvEnabled === undefined || data.cpvEnabled === null) return { error: 'CPV Enabled is required.' };
  if (!data.defaultReviewFrequency) return { error: 'Default Review Frequency is required.' };
  return saveSingletonViaCf(SINGLETON_DOCS.general, data as unknown as Record<string, unknown>, changeReason, options?.esignConfirmed === true);
}

export async function saveGlobalOrgSettings(
  data: GlobalOrgSettings,
  _actor: CpvConfigActor,
  reason?: string,
) {
  const changeReason = resolveChangeReason(reason, 'Global organization settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.global, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveCapabilitySettings(data: CapabilitySettings, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'Process capability settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  if (data.minimumSampleCount < 1) return { error: 'Minimum sample count must be at least 1.' };
  return saveSingletonViaCf(SINGLETON_DOCS.capability, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveSpcSettings(data: SpcSettings, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'SPC settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.spc, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveRiskSettings(data: RiskScoringSettings, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'Risk scoring settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.risk, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveAiSettings(data: AiSettings, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'AI configuration updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.ai, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveNotificationSettings(data: NotificationSettings, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'Notification settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.notification, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveDashboardSettings(data: DashboardSettings, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'Dashboard settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.dashboard, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveExportSettings(data: ExportReportSettings, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'Export and report settings updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.export, data as unknown as Record<string, unknown>, changeReason);
}

export async function saveSecuritySettings(
  data: SecuritySettings,
  _actor: CpvConfigActor,
  reason?: string,
  options?: { esignConfirmed?: boolean },
) {
  const changeReason = resolveChangeReason(reason, 'Security configuration updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  if (options?.esignConfirmed !== true) return { error: 'Electronic signature required for security changes.' };
  return saveSingletonViaCf(SINGLETON_DOCS.security, data as unknown as Record<string, unknown>, changeReason, true);
}

export async function saveBackupSettings(
  data: BackupSettings,
  _actor: CpvConfigActor,
  reason?: string,
  options?: { esignConfirmed?: boolean },
) {
  const changeReason = resolveChangeReason(reason, 'Backup configuration updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  if (options?.esignConfirmed !== true) return { error: 'Electronic signature required for backup changes.' };
  return saveSingletonViaCf(SINGLETON_DOCS.backup, data as unknown as Record<string, unknown>, changeReason, true);
}

export async function saveFeatureFlags(data: FeatureFlags, _actor: CpvConfigActor, reason?: string) {
  const changeReason = resolveChangeReason(reason, 'Feature flags updated');
  if (!changeReason) return { error: 'Change reason must be at least 5 characters.' };
  return saveSingletonViaCf(SINGLETON_DOCS.featureFlags, data as unknown as Record<string, unknown>, changeReason);
}

export async function createConfigListRecord<T extends Record<string, unknown>>(
  collectionName: string,
  data: T,
  _actor: CpvConfigActor,
  changeReason = 'Configuration list record created',
) {
  if (!isFirebaseConfigured()) return { id: null, error: 'Firebase is not configured.' };
  const reason = resolveChangeReason(changeReason, 'Configuration list record created');
  if (!reason) return { id: null, error: 'Change reason must be at least 5 characters.' };
  try {
    const fn = httpsCallable<{ collectionName: string; data: T; changeReason: string }, { id: string }>(
      getFirebaseFunctions(),
      'createAdminCpvConfigListRecord',
    );
    const result = await fn({ collectionName, data, changeReason: reason });
    return { id: result.data?.id || null, error: null };
  } catch (e) {
    console.error(`createConfigListRecord ${collectionName} failed`, e);
    return { id: null, error: callableErrorMessage(e, 'Failed to create configuration record.') };
  }
}

export async function updateConfigListRecord<T extends Record<string, unknown>>(
  collectionName: string,
  id: string,
  data: Partial<T>,
  _actor: CpvConfigActor,
  changeReason = 'Configuration list record updated',
) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  const reason = resolveChangeReason(changeReason, 'Configuration list record updated');
  if (!reason) return { error: 'Change reason must be at least 5 characters.' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminCpvConfigListRecord');
    await fn({ collectionName, id, data, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error(`updateConfigListRecord ${collectionName} failed`, e);
    return { error: callableErrorMessage(e, 'Failed to update configuration record.') };
  }
}

export async function softDeleteConfigRecord(
  collectionName: string,
  id: string,
  _actor: CpvConfigActor,
  changeReason = 'Configuration list record soft-deleted',
) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  const reason = resolveChangeReason(changeReason, 'Configuration list record soft-deleted');
  if (!reason) return { error: 'Change reason must be at least 5 characters.' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminCpvConfigListRecord');
    await fn({ collectionName, id, changeReason: reason });
    return { error: null };
  } catch (e) {
    console.error(`softDeleteConfigRecord ${collectionName} failed`, e);
    return { error: callableErrorMessage(e, 'Failed to delete configuration record.') };
  }
}

export async function resetConfigurationDefaults(
  _actor: CpvConfigActor,
  options?: { changeReason?: string; esignConfirmed?: boolean },
) {
  if (!isFirebaseConfigured()) return { error: 'Firebase is not configured.' };
  const reason = resolveChangeReason(options?.changeReason, 'Reset CPV configuration defaults');
  if (!reason) return { error: 'Change reason must be at least 5 characters.' };
  if (options?.esignConfirmed !== true) return { error: 'Electronic signature required to reset defaults.' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'resetAdminCpvConfigurationDefaults');
    await fn({ changeReason: reason, esignConfirmed: true });
    return { error: null };
  } catch (e) {
    console.error('resetConfigurationDefaults failed', e);
    return { error: callableErrorMessage(e, 'Failed to reset configuration.') };
  }
}

export async function exportConfigurationJson(): Promise<{ json: string; error: string | null }> {
  try {
    const bundle = await fetchCpvConfiguration();
    return { json: JSON.stringify(bundle, null, 2), error: null };
  } catch {
    return { json: '', error: 'Failed to export configuration.' };
  }
}

export async function importConfigurationJson(
  json: string,
  _actor: CpvConfigActor,
  options?: { changeReason?: string; esignConfirmed?: boolean },
) {
  const reason = resolveChangeReason(options?.changeReason, 'Configuration JSON import');
  if (!reason) return { error: 'Change reason must be at least 5 characters.' };
  if (options?.esignConfirmed !== true) return { error: 'Electronic signature required for import.' };
  try {
    const parsed = JSON.parse(json) as Partial<CpvConfigurationBundle>;
    const fn = httpsCallable(getFirebaseFunctions(), 'importAdminCpvConfiguration');
    await fn({ changeReason: reason, esignConfirmed: true, bundle: parsed });
    return { error: null };
  } catch (e) {
    console.error('importConfigurationJson failed', e);
    return { error: callableErrorMessage(e, 'Invalid configuration JSON.') };
  }
}

export async function approveCpvConfiguration(
  _actor: CpvConfigActor,
  options?: { changeReason?: string; esignConfirmed?: boolean; snapshotSummary?: string },
) {
  const reason = resolveChangeReason(options?.changeReason, 'CPV configuration approved');
  if (!reason) return { error: 'Change reason must be at least 5 characters.' };
  if (options?.esignConfirmed !== true) return { error: 'Electronic signature required for approval.' };
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'approveAdminCpvConfiguration');
    await fn({
      changeReason: reason,
      esignConfirmed: true,
      snapshotSummary: options?.snapshotSummary || 'Configuration package approved',
    });
    return { error: null };
  } catch (e) {
    console.error('approveCpvConfiguration failed', e);
    return { error: callableErrorMessage(e, 'Approval failed.') };
  }
}

export async function testConfiguration(): Promise<{ ok: boolean; message: string; details: string[] }> {
  const bundle = await fetchCpvConfiguration();
  const validation = validateConfiguration(bundle);
  const details = [...validation.errors, ...validation.warnings];
  return {
    ok: validation.valid,
    message: validation.valid
      ? `Configuration test passed (${validation.completenessPct}% complete).`
      : 'Configuration test failed.',
    details,
  };
}

export async function logConfigurationExport(_actor: CpvConfigActor, count = 0) {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminCpvConfigurationExport');
    await fn({ changeReason: 'Configuration export', count });
  } catch (e) {
    console.error('logConfigurationExport failed', e);
  }
}

export function isProductCpvRequired(bundle: CpvConfigurationBundle, productName: string): boolean {
  const product = bundle.products.find((p) => p.product === productName && p.status === 'Active');
  if (product) return product.cpvRequired;
  return bundle.general?.cpvEnabled === true;
}

export async function fetchAlertRulesFromConfig(): Promise<AlertRuleConfig[]> {
  const bundle = await fetchCpvConfiguration();
  return bundle.alertRules.filter((r) => r.status === 'Active');
}
