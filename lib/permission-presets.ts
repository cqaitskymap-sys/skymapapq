import { ROLE_MATRIX_MODULES, ROLE_MATRIX_ACTIONS } from './admin/constants';

export type PermissionMatrixData = Record<string, Record<string, boolean>>;

export interface PermissionPreset {
  id: string;
  name: string;
  description: string;
  permissions: PermissionMatrixData;
}

function emptyMatrix(): PermissionMatrixData {
  const matrix: PermissionMatrixData = {};
  for (const mod of ROLE_MATRIX_MODULES) {
    matrix[mod] = {};
    for (const action of ROLE_MATRIX_ACTIONS) {
      matrix[mod][action] = false;
    }
  }
  return matrix;
}

function cloneMatrix(source: PermissionMatrixData): PermissionMatrixData {
  const matrix = emptyMatrix();
  for (const mod of ROLE_MATRIX_MODULES) {
    for (const action of ROLE_MATRIX_ACTIONS) {
      matrix[mod][action] = source[mod]?.[action] ?? false;
    }
  }
  return matrix;
}

function setModule(
  matrix: PermissionMatrixData,
  module: (typeof ROLE_MATRIX_MODULES)[number],
  actions: (typeof ROLE_MATRIX_ACTIONS)[number][],
) {
  for (const action of ROLE_MATRIX_ACTIONS) {
    matrix[module][action] = actions.includes(action);
  }
}

function setModulesViewOnly(
  matrix: PermissionMatrixData,
  modules: (typeof ROLE_MATRIX_MODULES)[number][],
) {
  for (const mod of modules) {
    setModule(matrix, mod, ['View', 'Read Only', 'Export', 'Print']);
  }
}

function setFullModule(
  matrix: PermissionMatrixData,
  module: (typeof ROLE_MATRIX_MODULES)[number],
) {
  setModule(matrix, module, [...ROLE_MATRIX_ACTIONS]);
}

function setQaModules(matrix: PermissionMatrixData) {
  const mods: (typeof ROLE_MATRIX_MODULES)[number][] = [
    'PQR', 'CPV', 'Deviation', 'OOS', 'CAPA', 'Change Control', 'Risk Management',
    'Stability', 'Complaint', 'Recall', 'DMS', 'Audit',
  ];
  for (const mod of mods) {
    setModule(matrix, mod, [
      'View', 'Create', 'Edit', 'Review', 'Approve', 'Reject', 'Assign',
      'Close', 'Archive', 'Export', 'Import', 'Print', 'Electronic Signature',
    ]);
  }
}

export const PERMISSION_PRESETS: PermissionPreset[] = [
  {
    id: 'super_admin',
    name: 'Super Admin',
    description: 'Full access to all modules and actions',
    permissions: (() => {
      const m = emptyMatrix();
      for (const mod of ROLE_MATRIX_MODULES) setFullModule(m, mod);
      return m;
    })(),
  },
  {
    id: 'cpv_viewer',
    name: 'CPV Viewer',
    description: 'Read-only access to Continued Process Verification',
    permissions: (() => {
      const m = emptyMatrix();
      setModule(m, 'CPV', ['View', 'Read Only', 'Export', 'Print']);
      return m;
    })(),
  },
  {
    id: 'cpv_editor',
    name: 'CPV Editor',
    description: 'Create and edit CPV records',
    permissions: (() => {
      const m = emptyMatrix();
      setModule(m, 'CPV', ['View', 'Create', 'Edit', 'Export', 'Print']);
      return m;
    })(),
  },
  {
    id: 'cpv_approver',
    name: 'CPV Approver',
    description: 'Review and approve CPV records',
    permissions: (() => {
      const m = emptyMatrix();
      setModule(m, 'CPV', ['View', 'Review', 'Approve', 'Reject', 'Export', 'Print']);
      return m;
    })(),
  },
  {
    id: 'pqr_viewer',
    name: 'PQR Viewer',
    description: 'Read-only access to Product Quality Review',
    permissions: (() => {
      const m = emptyMatrix();
      setModule(m, 'PQR', ['View', 'Read Only', 'Export', 'Print']);
      return m;
    })(),
  },
  {
    id: 'pqr_editor',
    name: 'PQR Editor',
    description: 'Create and edit PQR records',
    permissions: (() => {
      const m = emptyMatrix();
      setModule(m, 'PQR', ['View', 'Create', 'Edit', 'Export', 'Print']);
      return m;
    })(),
  },
  {
    id: 'qms_viewer',
    name: 'QMS Viewer',
    description: 'View QMS modules (deviation, OOS, CAPA, etc.)',
    permissions: (() => {
      const m = emptyMatrix();
      setModulesViewOnly(m, ['Deviation', 'OOS', 'CAPA', 'Change Control', 'Stability', 'Complaint', 'Recall']);
      return m;
    })(),
  },
  {
    id: 'qa_full_access',
    name: 'QA Full Access',
    description: 'Full QA access across QMS, PQR, and CPV',
    permissions: (() => {
      const m = emptyMatrix();
      setQaModules(m);
      setFullModule(m, 'CPV');
      setFullModule(m, 'PQR');
      return m;
    })(),
  },
  {
    id: 'auditor_read_only',
    name: 'Auditor Read Only',
    description: 'View-only access across assigned modules',
    permissions: (() => {
      const m = emptyMatrix();
      setModulesViewOnly(m, [...ROLE_MATRIX_MODULES]);
      return m;
    })(),
  },
];

export function getPresetById(presetId: string): PermissionPreset | undefined {
  return PERMISSION_PRESETS.find((p) => p.id === presetId);
}

export function getPresetMatrix(presetId: string): PermissionMatrixData {
  const preset = getPresetById(presetId);
  return preset ? cloneMatrix(preset.permissions) : emptyMatrix();
}

export function emptyPermissionMatrix(): PermissionMatrixData {
  return emptyMatrix();
}
