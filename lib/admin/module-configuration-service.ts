import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { ADMIN_COLLECTIONS } from './constants';
import type { ModuleConfig, ModuleConfigFormData } from './schemas';

export interface ModuleConfigAuditMeta {
  userId: string;
  userName: string;
}

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function buildModuleConfigId(code: string): string {
  return `MOD-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function normalizeModuleConfig(m: ModuleConfig): ModuleConfig {
  const path = m.navigationPath || m.route || '';
  const order = Number(m.displayOrder ?? m.sortOrder ?? 0);
  return {
    ...m,
    moduleConfigId: m.moduleConfigId || buildModuleConfigId(m.moduleCode || 'MOD'),
    displayName: m.displayName || m.moduleName,
    navigationPath: path,
    route: path,
    displayOrder: order,
    sortOrder: order,
    dependencies: Array.isArray(m.dependencies) ? m.dependencies : [],
    featureFlags: Array.isArray(m.featureFlags) ? m.featureFlags : [],
    configurationJson: m.configurationJson || '{}',
    isEnabled: m.isEnabled !== false,
    isInstalled: m.isInstalled !== false,
    isVisible: m.isVisible !== false,
    visibility: m.visibility || (m.isVisible === false ? 'Hidden' : 'Visible'),
    licenseStatus: m.licenseStatus || 'Licensed',
    featureStatus: m.featureStatus || 'GA',
    environment: m.environment || 'Production',
    moduleCategory: m.moduleCategory || 'QMS',
    version: m.version || '1.0.0',
  };
}

export function isModuleConfigActive(m: ModuleConfig): boolean {
  return m.isEnabled === true && m.isInstalled !== false && !m.isDeleted && m.status !== 'Inactive';
}

export function getModuleConfigSummary(modules: ModuleConfig[]) {
  return {
    total: modules.length,
    enabled: modules.filter((m) => m.isEnabled).length,
    disabled: modules.filter((m) => !m.isEnabled).length,
    critical: modules.filter((m) => m.isCritical || m.isSystemModule).length,
    beta: modules.filter((m) => m.featureStatus === 'Beta' || m.featureStatus === 'Experimental').length,
    licensed: modules.filter((m) => m.licenseStatus === 'Licensed' || m.licenseStatus === 'Enterprise').length,
  };
}

export async function fetchModuleConfigurations(): Promise<ModuleConfig[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.moduleConfiguration),
      orderBy('displayOrder', 'asc'),
      limit(400),
    ));
    return snap.docs
      .map((d) => normalizeModuleConfig({ id: d.id, ...d.data() } as ModuleConfig))
      .filter((m) => !m.isDeleted);
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.moduleConfiguration));
      return snap.docs
        .map((d) => normalizeModuleConfig({ id: d.id, ...d.data() } as ModuleConfig))
        .filter((m) => !m.isDeleted)
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
    } catch {
      return [];
    }
  }
}

export function subscribeToModuleConfigurations(
  onData: (rows: ModuleConfig[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  return onSnapshot(
    query(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.moduleConfiguration), limit(400)),
    (snapshot) => {
      onData(snapshot.docs
        .map((d) => normalizeModuleConfig({ id: d.id, ...d.data() } as ModuleConfig))
        .filter((m) => !m.isDeleted)
        .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)
          || String(a.moduleCode).localeCompare(String(b.moduleCode))));
    },
    (error) => onError?.(new Error(error.message)),
  );
}

export async function fetchModuleConfigurationById(id: string): Promise<ModuleConfig | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snap = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.moduleConfiguration, id));
    if (!snap.exists() || snap.data().isDeleted === true) return null;
    return normalizeModuleConfig({ id: snap.id, ...snap.data() } as ModuleConfig);
  } catch {
    return null;
  }
}

export async function fetchModuleConfigurationByCode(code: string): Promise<ModuleConfig | null> {
  if (!isFirebaseConfigured() || !code) return null;
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.moduleConfiguration),
      where('moduleCode', '==', code.toUpperCase()),
      limit(1),
    ));
    if (snap.empty || snap.docs[0].data().isDeleted === true) return null;
    return normalizeModuleConfig({ id: snap.docs[0].id, ...snap.docs[0].data() } as ModuleConfig);
  } catch {
    return null;
  }
}

export async function fetchModuleConfigVersions(moduleDocId: string): Promise<Array<Record<string, unknown>>> {
  if (!isFirebaseConfigured() || !moduleDocId) return [];
  try {
    const snap = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.moduleConfigurationVersions),
      where('moduleDocId', '==', moduleDocId),
      orderBy('snapshotAt', 'desc'),
      limit(50),
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.moduleConfigurationVersions));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
        .filter((v) => v.moduleDocId === moduleDocId)
        .sort((a, b) => String(b.snapshotAt || '').localeCompare(String(a.snapshotAt || '')));
    } catch {
      return [];
    }
  }
}

/** Client-side enabled map for sidebar / route consumers */
export async function getEnabledModuleCodeSet(): Promise<Set<string>> {
  const rows = await fetchModuleConfigurations();
  if (!rows.length) return new Set(); // empty catalog = do not block navigation
  return new Set(
    rows.filter((m) => isModuleConfigActive(m) && m.isVisible !== false)
      .map((m) => m.moduleCode.toUpperCase()),
  );
}

export function isPathAllowedByModuleConfig(
  pathname: string,
  modules: ModuleConfig[],
): boolean {
  if (!modules.length) return true;
  const match = modules.find((m) => {
    const path = m.navigationPath || m.route || '';
    if (!path || path === '/') return false;
    return pathname === path || pathname.startsWith(`${path}/`);
  });
  if (!match) return true; // unconfigured paths remain available
  return isModuleConfigActive(match) && match.isVisible !== false && match.visibility !== 'Hidden';
}

function formToCallable(data: ModuleConfigFormData, changeReason: string) {
  return {
    moduleCode: data.moduleCode,
    moduleName: data.moduleName,
    displayName: data.displayName || data.moduleName,
    moduleCategory: data.moduleCategory,
    description: data.description,
    displayOrder: data.displayOrder,
    menuGroup: data.menuGroup,
    navigationPath: data.navigationPath,
    icon: data.icon,
    version: data.version,
    buildNumber: data.buildNumber,
    isEnabled: data.isEnabled,
    isInstalled: data.isInstalled,
    isSystemModule: data.isSystemModule,
    isCritical: data.isCritical,
    isVisible: data.isVisible,
    visibility: data.visibility,
    licenseStatus: data.licenseStatus,
    featureStatus: data.featureStatus,
    environment: data.environment,
    company: data.company,
    businessUnit: data.businessUnit,
    site: data.site,
    department: data.department,
    requiredRole: data.requiredRole,
    dependencies: data.dependencies,
    featureFlagsJson: data.featureFlagsJson,
    configurationJson: data.configurationJson,
    remarks: data.remarks,
    changeReason,
  };
}

export async function createModuleConfiguration(
  data: ModuleConfigFormData,
  meta: ModuleConfigAuditMeta,
): Promise<{ module: ModuleConfig | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Created by ${meta.userName}`;
    if (reason.trim().length < 5) return { module: null, error: 'Change reason is required (min 5 characters)' };
    const fn = httpsCallable(getFirebaseFunctions(), 'createAdminModuleConfiguration');
    const result = await fn(formToCallable(data, reason));
    const id = (result.data as { id?: string })?.id;
    return { module: id ? await fetchModuleConfigurationById(id) : null, error: null };
  } catch (e) {
    return { module: null, error: callableErrorMessage(e, 'Unable to create module configuration') };
  }
}

export async function updateModuleConfiguration(
  id: string,
  data: ModuleConfigFormData,
  meta: ModuleConfigAuditMeta,
): Promise<{ module: ModuleConfig | null; error: string | null }> {
  try {
    const reason = data.changeReason || `Updated by ${meta.userName}`;
    if (reason.trim().length < 5) return { module: null, error: 'Change reason is required (min 5 characters)' };
    const fn = httpsCallable(getFirebaseFunctions(), 'updateAdminModuleConfiguration');
    await fn({ id, ...formToCallable(data, reason) });
    return { module: await fetchModuleConfigurationById(id), error: null };
  } catch (e) {
    return { module: null, error: callableErrorMessage(e, 'Unable to update module configuration') };
  }
}

export async function setModuleEnabled(
  id: string,
  isEnabled: boolean,
  meta: ModuleConfigAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `${isEnabled ? 'Enabled' : 'Disabled'} by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminModuleEnabled');
    await fn({ id, isEnabled, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to update module status') };
  }
}

export async function setModuleFeatureFlag(
  id: string,
  flagKey: string,
  enabled: boolean,
  meta: ModuleConfigAuditMeta,
  rollout?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminModuleFeatureFlag');
    await fn({
      id,
      flagKey,
      enabled,
      rollout: rollout || (enabled ? 'GA' : 'Off'),
      changeReason: `Feature ${flagKey} ${enabled ? 'enabled' : 'disabled'} by ${meta.userName}`,
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to update feature flag') };
  }
}

export async function softDeleteModuleConfiguration(
  id: string,
  meta: ModuleConfigAuditMeta,
  changeReason = '',
): Promise<{ success: boolean; error?: string }> {
  try {
    const reason = changeReason || `Uninstalled by ${meta.userName}`;
    const fn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminModuleConfiguration');
    await fn({ id, changeReason: reason });
    return { success: true };
  } catch (e) {
    return { success: false, error: callableErrorMessage(e, 'Unable to uninstall module') };
  }
}

export async function seedDefaultModuleConfigurations(
  meta: ModuleConfigAuditMeta,
): Promise<{ created: number; skipped: number }> {
  try {
    const fn = httpsCallable<
      { changeReason: string },
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminModuleConfigurations');
    const result = await fn({ changeReason: `Seeded by ${meta.userName}` });
    return { created: result.data.created || 0, skipped: result.data.skipped || 0 };
  } catch {
    return { created: 0, skipped: 0 };
  }
}

export function exportModuleConfigurationsCsv(modules: ModuleConfig[]): string {
  const headers = [
    'Code', 'Name', 'Category', 'Enabled', 'Visible', 'License', 'Feature', 'Environment', 'Path', 'Dependencies',
  ];
  const rows = modules.map((m) => [
    m.moduleCode, m.moduleName, m.moduleCategory, m.isEnabled ? 'Yes' : 'No',
    m.isVisible ? 'Yes' : 'No', m.licenseStatus, m.featureStatus, m.environment,
    m.navigationPath, (m.dependencies || []).join('|'),
  ].map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  return `\uFEFF${[headers.join(','), ...rows].join('\n')}`;
}

export async function logModuleConfigurationExport(
  meta: ModuleConfigAuditMeta,
  count: number,
): Promise<void> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminModuleConfigurationExport');
    await fn({ format: 'CSV', count, userName: meta.userName });
  } catch (error) {
    console.error('MODULE_CONFIGURATION_FAILURE: export log', error);
  }
}

export function moduleToFormData(m: ModuleConfig): Partial<ModuleConfigFormData> {
  return {
    moduleCode: m.moduleCode,
    moduleName: m.moduleName,
    displayName: m.displayName || m.moduleName,
    moduleCategory: m.moduleCategory || 'QMS',
    description: m.description || '',
    displayOrder: m.displayOrder || 0,
    menuGroup: m.menuGroup || '',
    navigationPath: m.navigationPath || m.route || '',
    icon: m.icon || '',
    version: m.version || '1.0.0',
    buildNumber: m.buildNumber || '',
    isEnabled: m.isEnabled !== false,
    isInstalled: m.isInstalled !== false,
    isSystemModule: m.isSystemModule === true,
    isCritical: m.isCritical === true,
    isVisible: m.isVisible !== false,
    visibility: m.visibility || 'Visible',
    licenseStatus: m.licenseStatus || 'Licensed',
    featureStatus: m.featureStatus || 'GA',
    environment: m.environment || 'Production',
    company: m.company || '',
    businessUnit: m.businessUnit || '',
    site: m.site || '',
    department: m.department || '',
    requiredRole: m.requiredRole || '',
    dependencies: (m.dependencies || []).join(', '),
    featureFlagsJson: JSON.stringify(m.featureFlags || [], null, 2),
    configurationJson: m.configurationJson || '{}',
    remarks: m.remarks || '',
    changeReason: '',
  };
}

export function evaluateFeatureFlag(
  module: ModuleConfig,
  flagKey: string,
  ctx?: { role?: string; department?: string; site?: string },
): boolean {
  const flag = (module.featureFlags || []).find((f) => f.key === flagKey);
  if (!flag || !flag.enabled) return false;
  if (flag.rollout === 'Off') return false;
  if (flag.roles?.length && ctx?.role && !flag.roles.includes(ctx.role)) return false;
  if (flag.departments?.length && ctx?.department && !flag.departments.includes(ctx.department)) return false;
  if (flag.sites?.length && ctx?.site && !flag.sites.includes(ctx.site)) return false;
  return true;
}
