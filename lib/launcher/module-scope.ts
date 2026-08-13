import { LAUNCHER_MODULES } from '@/lib/launcher/module-definitions';

/** Path prefixes that map to a launcher module's sidebar scope */
const PATH_MODULE_MAP: Array<{ prefixes: string[]; navGroupLabel: string }> = [
  { prefixes: ['/manufacturing', '/dashboard/batches', '/dashboard/products'], navGroupLabel: 'Manufacturing' },
  { prefixes: ['/qms'], navGroupLabel: 'QMS' },
  { prefixes: ['/cpv'], navGroupLabel: 'Continued Process Verification' },
  { prefixes: ['/pqr', '/dashboard/pqr'], navGroupLabel: 'PQR Management' },
  { prefixes: ['/dashboard/audit-trail'], navGroupLabel: 'Regulatory & Compliance' },
  { prefixes: ['/dashboard/master', '/admin/products'], navGroupLabel: 'Master Data' },
  { prefixes: ['/dashboard/reports'], navGroupLabel: 'Reports' },
  { prefixes: ['/dashboard/notifications', '/notifications'], navGroupLabel: 'Notifications' },
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
