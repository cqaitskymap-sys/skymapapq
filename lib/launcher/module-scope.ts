import { LAUNCHER_MODULES } from '@/lib/launcher/module-definitions';

/** Masters that still live under /admin routes belong to the Master Data module, not Super Admin. */
export const MASTER_DATA_HOME = '/admin/products';

export const MASTER_DATA_PATH_PREFIXES = [
  '/dashboard/master',
  '/admin/products',
  '/admin/equipment',
  '/admin/batches',
  '/admin/parameters',
  '/admin/departments',
  '/admin/designations',
  '/admin/company-site',
  '/admin/master-data-import-export',
  '/dashboard/admin/products',
  '/dashboard/admin/equipment',
  '/dashboard/admin/batches',
  '/dashboard/admin/parameters',
  '/dashboard/admin/departments',
  '/dashboard/admin/designations',
  '/dashboard/admin/company-sites',
  '/dashboard/admin/master-data-import-export',
] as const;

export function isMasterDataPath(pathname: string): boolean {
  return MASTER_DATA_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Path prefixes that map to a launcher module's sidebar scope */
const PATH_MODULE_MAP: Array<{ prefixes: string[]; navGroupLabel: string }> = [
  { prefixes: ['/manufacturing', '/dashboard/batches', '/dashboard/products'], navGroupLabel: 'Manufacturing' },
  { prefixes: ['/qms'], navGroupLabel: 'QMS' },
  { prefixes: ['/cpv'], navGroupLabel: 'Continued Process Verification' },
  { prefixes: ['/pqr', '/dashboard/pqr'], navGroupLabel: 'PQR Management' },
  { prefixes: [...MASTER_DATA_PATH_PREFIXES], navGroupLabel: 'Master Data' },
  { prefixes: ['/dashboard/reports'], navGroupLabel: 'Reports' },
  { prefixes: ['/admin', '/dashboard/admin'], navGroupLabel: 'Admin' },
];

const OPERATIONS_PREFIXES = [
  '/qms/equipment',
  '/qms/monitoring',
  '/qms/vendors',
  '/qms/warehouse',
];

export function resolveNavGroupFromPath(pathname: string): string | null {
  if (!pathname || pathname === '/launcher') return null;

  if (OPERATIONS_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return 'Operations';
  }

  for (const { prefixes, navGroupLabel } of PATH_MODULE_MAP) {
    if (prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return navGroupLabel;
    }
  }

  return null;
}

export function resolveLauncherModuleFromPath(pathname: string) {
  const group = resolveNavGroupFromPath(pathname);
  if (!group) return null;
  return LAUNCHER_MODULES.find((m) => m.navGroupLabel === group) ?? null;
}

export function isLauncherHome(pathname: string): boolean {
  return pathname === '/launcher';
}
