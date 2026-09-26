import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from '@/lib/callable';
import { getFirebaseApp, getFirebaseFirestore, isFirebaseConfigured, getFirebaseFunctions } from '@/lib/firebase';
import { CQA_PARAMETER_STAGE_MAP } from '@/lib/cpv-cqa-monitoring';
import { CPP_MONITORING_HIERARCHY } from '@/lib/cpv-cpp-monitoring';
import {
  ADMIN_COLLECTIONS, PARAMETER_GROUPS, PARAMETER_CATEGORIES,
} from './constants';
import type { Parameter, ParameterFormData } from './schemas';

export interface ParameterAuditMeta {
  userId: string;
  userName: string;
}

export type ParameterResultStatus = 'Pass' | 'OOS' | 'Alert' | 'Action' | 'OOT';

export interface ParameterEvaluation {
  status: ParameterResultStatus;
  triggers: {
    oosDraft?: boolean;
    deviationDraft?: boolean;
    capaSuggested?: boolean;
  };
}

const DEFAULT_CQA_PARAMETER_MASTER = [
  'Description', 'pH', 'Weight per mL', 'Colour Index', 'Viscosity', 'Assay', 'Preservative Content',
  'Identification', 'Extractable Vol (mL)', 'Particulate Matter', 'Bacterial Endotoxin Test', 'Sterility',
  'Related Substance', 'API Assay (ODB)', 'Water/ LOD', 'Relative Substance',
] as const;

const DEFAULT_UTILITY_PARAMETER_MASTER = [
  'WFI Conductivity', 'WFI TOC', 'WFI Microbial Count', 'Purified Water Conductivity',
  'Compressed Air Pressure', 'Compressed Air Dew Point', 'Nitrogen Pressure',
  'HVAC Temperature', 'HVAC RH', 'Differential Pressure',
] as const;

const CPP_STAGE_TO_ADMIN_STAGE: Record<string, ParameterFormData['processStage']> = {
  'Environment Monitoring': 'Environmental Monitoring',
  'Sterilization of Equipments': 'Sterilization',
  'Batch Manufacturing': 'Mixing',
  'Filtration Process': 'Filtration',
  'Glass Container Washing': 'Vial Washing',
  'Glass Container Depyrogenation': 'Depyrogenation',
  'Filling Process': 'Filling',
  'Leak Test': 'Sealing',
};

const DEPYRO_ZONE_NAME_MAP: Record<string, { dp: string; temp: string }> = {
  'Preheating Zone': { dp: 'Preheat Zone DP (Pa)', temp: 'Preheat Zone Temperature (°C)' },
  'Sterilization Zone': { dp: 'Heating Zone DP (Pa)', temp: 'Heating Zone Temperature (°C)' },
  'Cooling Zone': { dp: 'Cooling Zone DP (Pa)', temp: 'Cooling Zone Temperature (°C)' },
};

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/[₂]/g, '2')
    .replace(/[µ]/g, 'u')
    .replace(/[³]/g, '3')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCppMasterDefaults(): Array<{ name: string; stage: ParameterFormData['processStage'] }> {
  const out: Array<{ name: string; stage: ParameterFormData['processStage'] }> = [];
  const seen = new Set<string>();

  for (const stageCfg of CPP_MONITORING_HIERARCHY) {
    const stage = CPP_STAGE_TO_ADMIN_STAGE[stageCfg.stage] || 'Mixing';
    if (stageCfg.areas?.length) {
      for (const areaCfg of stageCfg.areas) {
        for (const p of areaCfg.parameters) {
          let name = p;
          if (stageCfg.stage === 'Glass Container Depyrogenation') {
            const mapped = DEPYRO_ZONE_NAME_MAP[p];
            if (mapped) {
              name = areaCfg.area.includes('Differential Pressure') ? mapped.dp : mapped.temp;
            }
          }
          const key = normalizeName(name);
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ name, stage });
          }
        }
      }
    } else if (stageCfg.parameters?.length) {
      for (const p of stageCfg.parameters) {
        const key = normalizeName(p);
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ name: p, stage });
        }
      }
    }
  }

  return out;
}

const CPP_PARAMETER_NAME_ALIASES: Record<string, string> = {
  [normalizeName('N2 Pressure Pre fill')]: 'N₂ Pressure Pre-Fill',
  [normalizeName('Filling m/c Speed')]: 'Filling M/C Speed',
  [normalizeName('NVPC 0.5µm / ft3 (Max)')]: 'NVPC 0.5 µm / ft³ (Max)',
  [normalizeName('NVPC 5µm/ ft3 (Max)')]: 'NVPC 5 µm / ft³ (Max)',
  [normalizeName('Units filled')]: 'Units Filled',
  [normalizeName('Filling hr')]: 'Filling Hr',
};

function callableErrorMessage(error: unknown, fallback: string): string {
  const err = error as { message?: string };
  return (err.message || fallback)
    .replace(/^Firebase:\s*/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim() || fallback;
}

export function buildParameterId(code: string): string {
  return `PARAM-${code.toUpperCase().replace(/\s+/g, '-')}`;
}

export function normalizeParameter(p: Parameter): Parameter {
  const lower = p.lowerLimit || p.lsl || '';
  const upper = p.upperLimit || p.usl || '';
  const target = p.targetValue || p.target || '';
  const productLink = p.productLink || p.product || '';
  return {
    ...p,
    parameterId: p.parameterId || buildParameterId(p.parameterCode),
    lowerLimit: lower,
    lsl: lower,
    upperLimit: upper,
    usl: upper,
    targetValue: target,
    target,
    productLink,
    product: productLink,
    parameterGroup: p.parameterGroup || 'General',
    moduleName: p.moduleName || 'General',
    dataType: p.dataType || 'Numeric',
    calculationType: p.calculationType || 'Manual',
    isDeleted: Boolean(p.isDeleted),
    isArchived: p.isArchived ?? false,
  };
}

function mapParameterDoc(snapshot: { id: string; data: () => Record<string, unknown> }): Parameter {
  return normalizeParameter({ id: snapshot.id, ...snapshot.data() } as Parameter);
}

export function evaluateParameterResult(param: Parameter, observedValue: number): ParameterEvaluation {
  const lower = Number(param.lowerLimit || param.lsl);
  const upper = Number(param.upperLimit || param.usl);
  const alertLow = param.alertLimitLow ? Number(param.alertLimitLow) : null;
  const alertHigh = param.alertLimitHigh ? Number(param.alertLimitHigh) : null;
  const actionLow = param.actionLimitLow ? Number(param.actionLimitLow) : null;
  const actionHigh = param.actionLimitHigh ? Number(param.actionLimitHigh) : null;

  let status: ParameterResultStatus = 'Pass';
  const triggers: ParameterEvaluation['triggers'] = {};

  if (!Number.isNaN(lower) && !Number.isNaN(upper)) {
    if (observedValue < lower || observedValue > upper) {
      status = 'OOS';
      if (param.oosApplicable) triggers.oosDraft = true;
      if (param.autoDeviationRequired) triggers.deviationDraft = true;
      if (param.autoCapaRequired) triggers.capaSuggested = true;
      return { status, triggers };
    }
  }

  if (actionLow !== null && observedValue < actionLow) status = 'Action';
  if (actionHigh !== null && observedValue > actionHigh) status = 'Action';

  if (status !== 'Action') {
    if (alertLow !== null && observedValue < alertLow) status = 'Alert';
    if (alertHigh !== null && observedValue > alertHigh) status = 'Alert';
  }

  if (param.ootApplicable && status === 'Alert') status = 'OOT';

  return { status, triggers };
}

export async function fetchParameters(includeDeleted = false): Promise<Parameter[]> {
  if (!isFirebaseConfigured()) return [];
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.parameters),
      orderBy('createdAt', 'desc'),
    ));
    return snapshot.docs
      .map((document) => mapParameterDoc(document))
      .filter((param) => includeDeleted || !param.isDeleted);
  } catch (error) {
    console.error('fetchParameters failed:', error);
    throw new Error('Unable to load parameters. Check your connection and permissions.');
  }
}

export function subscribeToParameters(
  includeDeleted: boolean,
  onData: (parameters: Parameter[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!isFirebaseConfigured()) {
    onData([]);
    return () => undefined;
  }
  const parametersQuery = query(
    collection(getFirebaseFirestore(), ADMIN_COLLECTIONS.parameters),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(
    parametersQuery,
    (snapshot) => {
      const parameters = snapshot.docs
        .map((document) => mapParameterDoc(document))
        .filter((param) => includeDeleted || !param.isDeleted);
      onData(parameters);
    },
    (error) => {
      console.error('subscribeToParameters failed:', error);
      onError?.(new Error(error.message || 'Unable to subscribe to parameters'));
    },
  );
}

export async function fetchParameterById(id: string, includeDeleted = false): Promise<Parameter | null> {
  if (!isFirebaseConfigured() || !id) return null;
  try {
    const snapshot = await getDoc(doc(getFirebaseFirestore(), ADMIN_COLLECTIONS.parameters, id));
    if (!snapshot.exists()) return null;
    const param = mapParameterDoc(snapshot);
    if (param.isDeleted && !includeDeleted) return null;
    return param;
  } catch (error) {
    console.error('fetchParameterById failed:', error);
    throw new Error('Unable to load parameter details.');
  }
}

export function getParameterSummaryCounts(params: Parameter[]) {
  const active = params.filter((p) => !p.isDeleted);
  const byType = (type: string) => active.filter((p) => p.parameterType === type).length;
  return {
    total: active.length,
    cpp: byType('CPP'),
    cqa: byType('CQA'),
    ipc: byType('IPC'),
    utility: byType('Utility Parameter'),
    environmental: byType('Environmental Parameter'),
    active: active.filter((p) => p.status === 'Active').length,
    inactive: active.filter((p) => p.status === 'Inactive').length,
    critical: active.filter((p) => p.criticality === 'Critical').length,
    archived: active.filter((p) => p.isArchived).length,
  };
}

export function buildParameterCategoryGroups(parameters: Parameter[]) {
  const map = new Map<string, Map<string, Parameter[]>>();
  parameters.filter((p) => !p.isDeleted).forEach((param) => {
    const category = param.parameterCategory || 'Uncategorized';
    const group = param.parameterGroup || 'General';
    if (!map.has(category)) map.set(category, new Map());
    const groupMap = map.get(category)!;
    const list = groupMap.get(group) || [];
    list.push(param);
    groupMap.set(group, list);
  });
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, groupMap]) => ({
      category,
      groups: Array.from(groupMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([parameterGroup, items]) => ({
          parameterGroup,
          parameters: items.sort((a, b) => a.parameterName.localeCompare(b.parameterName)),
        })),
    }));
}

export function canDeleteParameterRecord(param: Parameter): { allowed: boolean; reason?: string } {
  if (param.isDeleted) return { allowed: false, reason: 'Parameter is already deleted.' };
  if (param.status === 'Active' && param.criticality === 'Critical') {
    return { allowed: false, reason: 'Deactivate critical parameters before deleting.' };
  }
  return { allowed: true };
}

export async function createParameter(
  data: ParameterFormData,
  _meta: ParameterAuditMeta,
): Promise<{ parameter: Parameter | null; error: string | null }> {
  try {
    const createFn = httpsCallable<Record<string, unknown>, Parameter>(
      getFirebaseFunctions(),
      'createAdminParameter',
    );
    const response = await createFn({
      ...data,
      reason: data.changeReason || 'Initial parameter registration',
    });
    return { parameter: normalizeParameter(response.data), error: null };
  } catch (error) {
    return { parameter: null, error: callableErrorMessage(error, 'Unable to create parameter') };
  }
}

export async function updateParameter(
  id: string,
  data: ParameterFormData,
  _existing: Parameter,
  _meta: ParameterAuditMeta,
): Promise<{ parameter: Parameter | null; error: string | null }> {
  try {
    const updateFn = httpsCallable<
      Record<string, unknown>,
      { parameter: Parameter }
    >(getFirebaseFunctions(), 'updateAdminParameter');
    const response = await updateFn({
      parameterDocId: id,
      updates: data,
      reason: data.changeReason,
    });
    return { parameter: normalizeParameter(response.data.parameter), error: null };
  } catch (error) {
    return { parameter: null, error: callableErrorMessage(error, 'Unable to update parameter') };
  }
}

export async function setParameterStatus(
  id: string,
  _param: Parameter,
  status: 'Active' | 'Inactive',
  _meta: ParameterAuditMeta,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'setAdminParameterStatus');
    await fn({ parameterDocId: id, parameterStatus: status, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to update parameter status') };
  }
}

export async function archiveParameter(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'archiveAdminParameter');
    await fn({ parameterDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to archive parameter') };
  }
}

export async function deleteParameter(
  id: string,
  param: Parameter,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const check = canDeleteParameterRecord(param);
  if (!check.allowed) return { success: false, error: check.reason };
  try {
    const deleteFn = httpsCallable(getFirebaseFunctions(), 'softDeleteAdminParameter');
    await deleteFn({ parameterDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to delete parameter') };
  }
}

export async function restoreParameter(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const restoreFn = httpsCallable(getFirebaseFunctions(), 'restoreAdminParameter');
    await restoreFn({ parameterDocId: id, reason });
    return { success: true };
  } catch (error) {
    return { success: false, error: callableErrorMessage(error, 'Unable to restore parameter') };
  }
}

export async function bulkUpdateParameters(
  parameterIds: string[],
  action: 'activate' | 'deactivate' | 'archive',
  reason: string,
): Promise<{ successCount: number; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number }
    >(getFirebaseFunctions(), 'bulkUpdateAdminParameters');
    const response = await bulkFn({ parameterDocIds: parameterIds, action, reason });
    return { successCount: response.data.successCount };
  } catch (error) {
    return { successCount: 0, error: callableErrorMessage(error, 'Bulk update failed') };
  }
}

export async function bulkDeleteParameters(
  parameterIds: string[],
  reason: string,
): Promise<{ successCount: number; errors: string[]; error?: string }> {
  try {
    const bulkFn = httpsCallable<
      Record<string, unknown>,
      { successCount: number; errors: string[] }
    >(getFirebaseFunctions(), 'bulkSoftDeleteAdminParameters');
    const response = await bulkFn({ parameterDocIds: parameterIds, reason });
    return response.data;
  } catch (error) {
    return { successCount: 0, errors: [], error: callableErrorMessage(error, 'Bulk delete failed') };
  }
}

export async function fetchParameterAuditTrail(recordId: string) {
  if (!isFirebaseConfigured() || !recordId) return [];
  try {
    const firestore = getFirebaseFirestore();
    const [trailSnap, logsSnap] = await Promise.all([
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditTrail),
        where('documentId', '==', recordId),
        orderBy('timestamp', 'desc'),
        limit(30),
      )).catch(() => ({ docs: [] })),
      getDocs(query(
        collection(firestore, ADMIN_COLLECTIONS.auditLogs),
        where('recordId', '==', recordId),
        orderBy('dateTime', 'desc'),
        limit(30),
      )).catch(() => ({ docs: [] })),
    ]);
    return [...trailSnap.docs, ...logsSnap.docs]
      .map((document): Record<string, unknown> & { id: string } => {
        const data = document.data() as Record<string, unknown>;
        return { id: document.id, ...data };
      })
      .sort((a, b) => String(b.timestamp ?? b.dateTime).localeCompare(String(a.timestamp ?? a.dateTime)))
      .slice(0, 30);
  } catch (error) {
    console.error('fetchParameterAuditTrail failed:', error);
    return [];
  }
}

export async function countLinkedParameterUsage(parameterId: string, parameterCode: string): Promise<number> {
  if (!isFirebaseConfigured()) return 0;
  const firestore = getFirebaseFirestore();
  const collections: Array<{ name: string; field: string; value: string }> = [
    { name: 'cpp_results', field: 'parameterCode', value: parameterCode },
    { name: 'cqa_results', field: 'parameterCode', value: parameterCode },
    { name: 'cpv_cpp', field: 'parameterCode', value: parameterCode },
    { name: 'cpv_cqa', field: 'parameterCode', value: parameterCode },
  ];
  let total = 0;
  for (const link of collections) {
    try {
      const snap = await getDocs(query(
        collection(firestore, link.name),
        where(link.field, '==', link.value),
        limit(5),
      ));
      total += snap.docs.filter((doc) => doc.data().isDeleted !== true).length;
    } catch {
      // skip
    }
  }
  if (parameterId) {
    try {
      const snap = await getDocs(query(
        collection(firestore, 'cpp_results'),
        where('parameterId', '==', parameterId),
        limit(5),
      ));
      total += snap.docs.length;
    } catch {
      // skip
    }
  }
  return total;
}

export function exportParametersCsv(params: Parameter[]): string {
  const headers = [
    'Parameter Code', 'Parameter Name', 'Short Name', 'Type', 'Category', 'Group', 'Module',
    'Product', 'Stage', 'Lower Limit', 'Upper Limit', 'Alert Low', 'Alert High',
    'Action Low', 'Action High', 'Critical Limit', 'Unit', 'Data Type', 'Result Type',
    'Criticality', 'Status',
  ];
  const rows = params.map((p) => [
    p.parameterCode, p.parameterName, p.shortName, p.parameterType, p.parameterCategory,
    p.parameterGroup, p.moduleName, p.productLink, p.processStage,
    p.lowerLimit, p.upperLimit, p.alertLimitLow, p.alertLimitHigh,
    p.actionLimitLow, p.actionLimitHigh, p.criticalLimit,
    p.unit, p.dataType, p.resultType, p.criticality, p.status,
  ]);
  return [headers.join(','), ...rows.map((row) =>
    row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','),
  )].join('\n');
}

export async function logParameterExport(meta: ParameterAuditMeta, count: number, reason = 'Parameter list export') {
  try {
    const fn = httpsCallable(getFirebaseFunctions(), 'logAdminParameterExport');
    await fn({ count, reason, userId: meta.userId });
  } catch (error) {
    console.error('logParameterExport failed:', error);
  }
}

function rowToImportParameter(cols: string[], headers: string[]): Record<string, string> | null {
  const idx = (name: string) => headers.findIndex((h) => h.includes(name));
  const code = cols[idx('parameter code')] || cols[idx('code')] || '';
  const name = cols[idx('parameter name')] || cols[idx('name')] || '';
  if (!code || !name) return null;
  return {
    parameterCode: code,
    parameterName: name,
    parameterType: cols[idx('type')] || 'CPP',
    parameterCategory: cols[idx('category')] || 'Manufacturing',
    productLink: cols[idx('product')] || '',
    department: cols[idx('department')] || '',
    testMethodStp: cols[idx('stp')] || cols[idx('test method')] || '',
    specificationNo: cols[idx('specification')] || '',
    targetValue: cols[idx('target')] || '',
    lowerLimit: cols[idx('lower')] || '0',
    upperLimit: cols[idx('upper')] || '1',
    unit: cols[idx('unit')] || 'units',
    remarks: 'Imported',
  };
}

export async function importParametersFromFile(
  file: File,
  meta: ParameterAuditMeta,
  reason = 'CSV parameter import',
): Promise<{ imported: number; errors: string[] }> {
  const text = await file.text();
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { imported: 0, errors: ['No data rows found'] };

  const headers = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.match(/("([^"]|"")*"|[^,]*)/g)?.map((c) =>
      c.replace(/^"|"$/g, '').replace(/""/g, '"').trim(),
    ) || [];
    const row = rowToImportParameter(cols, headers);
    if (row) rows.push(row);
  }
  if (!rows.length) return { imported: 0, errors: ['No valid rows found'] };

  try {
    const importFn = httpsCallable<
      Record<string, unknown>,
      { imported: number; errors: string[] }
    >(getFirebaseFunctions(), 'importAdminParameters');
    const response = await importFn({ rows, reason, userId: meta.userId });
    return response.data;
  } catch (error) {
    return { imported: 0, errors: [callableErrorMessage(error, 'Import failed')] };
  }
}

function presetToForm(
  name: string,
  type: ParameterFormData['parameterType'],
  category: ParameterFormData['parameterCategory'],
  stage: ParameterFormData['processStage'],
): ParameterFormData {
  const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20);
  return {
    parameterCode: `${type === 'CPP' ? 'CPP' : type === 'CQA' ? 'CQA' : 'UTL'}_${code}`,
    parameterName: name,
    shortName: name.slice(0, 20),
    description: '',
    parameterType: type,
    parameterCategory: category,
    parameterGroup: type === 'CPP' ? 'CPP Group' : type === 'CQA' ? 'CQA Group' : 'Utility Group',
    moduleName: type === 'CPP' ? 'CPV' : type === 'CQA' ? 'Quality Control' : 'Environmental Monitoring',
    subModule: '',
    productLink: '',
    productCategory: '',
    processStage: stage,
    department: category === 'Utility' ? 'Engineering' : category === 'Quality Control' ? 'QC' : 'Production',
    testMethodStp: '',
    specificationNo: '',
    targetValue: '',
    lowerLimit: type === 'CQA' ? '0' : '0',
    upperLimit: type === 'CQA' ? '100' : '1',
    alertLimitLow: '',
    alertLimitHigh: '',
    actionLimitLow: '',
    actionLimitHigh: '',
    criticalLimit: '',
    defaultValue: '',
    precision: '',
    formula: '',
    dataType: 'Numeric',
    calculationType: 'Manual',
    unit: type === 'CQA' ? '%' : type === 'Utility Parameter' ? 'varies' : '',
    resultType: type === 'CQA' && ['Description', 'Colour', 'Clarity', 'Identification', 'Sterility'].includes(name)
      ? 'Complies/Does Not Comply' : 'Numeric',
    frequency: type === 'Utility Parameter' ? 'Daily' : 'Per Batch',
    criticality: ['Assay', 'Sterility', 'Bacterial Endotoxin Test', 'Fill Volume'].includes(name) ? 'Critical' : 'Major',
    mandatory: false,
    displayOrder: undefined,
    sequenceNumber: '',
    applicableSite: '',
    businessUnit: '',
    ootApplicable: type === 'CPP',
    oosApplicable: type === 'CQA' || type === 'IPC',
    autoDeviationRequired: type === 'CPP',
    autoCapaRequired: false,
    remarks: 'Default preset',
    changeReason: 'Default parameter seed',
  };
}

export async function seedDefaultParameters(
  meta: ParameterAuditMeta,
  reason = 'Seed default CPV parameters',
): Promise<{ created: number; skipped: number }> {
  const cppDefaults = getCppMasterDefaults();
  const presets: ParameterFormData[] = [
    ...cppDefaults.map((d) => presetToForm(d.name, 'CPP', 'Manufacturing', d.stage)),
    ...DEFAULT_CQA_PARAMETER_MASTER.map((n) => presetToForm(
      n,
      'CQA',
      'Quality Control',
      (CQA_PARAMETER_STAGE_MAP[n]?.[0] || 'Finished Product Testing') as ParameterFormData['processStage'],
    )),
    ...DEFAULT_UTILITY_PARAMETER_MASTER.map((n) => presetToForm(n, 'Utility Parameter', 'Utility', 'Utility Monitoring')),
  ];

  try {
    const seedFn = httpsCallable<
      Record<string, unknown>,
      { created: number; skipped: number }
    >(getFirebaseFunctions(), 'seedAdminDefaultParameters');
    const response = await seedFn({ presets, reason, userId: meta.userId });
    return response.data;
  } catch (error) {
    console.error('seedDefaultParameters failed:', error);
    return { created: 0, skipped: presets.length };
  }
}

export { PARAMETER_CATEGORIES, PARAMETER_GROUPS };
