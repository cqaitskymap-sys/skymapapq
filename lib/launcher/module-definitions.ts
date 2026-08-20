import type { LucideIcon } from 'lucide-react';
import {
  Factory,
  ShieldCheck,
  LineChart,
  ClipboardList,
  Scale,
  Cog,
  Database,
  BarChart3,
  Bell,
  Settings,
} from 'lucide-react';
import type { AppModule } from '@/lib/permissions';

export interface LauncherModule {
  id: string;
  name: string;
  description: string;
  /** Plain-language hint shown on the launcher card */
  useWhen: string;
  href: string;
  icon: LucideIcon;
  emoji: string;
  color: string;
  iconBg: string;
  /** Sidebar nav group label for module-scoped navigation */
  navGroupLabel: string;
  keywords: string[];
  permissionModules?: AppModule[];
  submoduleCount: number;
}

export const LAUNCHER_MODULES: LauncherModule[] = [
  {
    id: 'manufacturing',
    name: 'Manufacturing',
    description: 'Batch management, production tracking, and yield monitoring',
    useWhen: 'Open this for production batches, yield, and shop-floor tracking.',
    href: '/manufacturing/dashboard',
    icon: Factory,
    emoji: '🏭',
    color: 'from-orange-500 to-amber-500',
    iconBg: 'bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400',
    navGroupLabel: 'Manufacturing',
    keywords: ['manufacturing', 'batch', 'production', 'yield'],
    submoduleCount: 3,
  },
  {
    id: 'qms',
    name: 'QMS',
    description: 'Quality management — deviations, CAPA, change control & audits',
    useWhen: 'Open this when something went wrong or needs a controlled change.',
    href: '/qms/dashboard',
    icon: ShieldCheck,
    emoji: '📋',
    color: 'from-blue-600 to-blue-500',
    iconBg: 'bg-blue-50 text-[#2563EB] dark:bg-blue-950/50 dark:text-blue-400',
    navGroupLabel: 'QMS',
    keywords: ['qms', 'quality', 'deviation', 'capa', 'change control', 'audit'],
    permissionModules: ['qms', 'deviation', 'capa', 'change_control', 'audit'],
    submoduleCount: 17,
  },
  {
    id: 'cpv',
    name: 'Continued Process Verification',
    description: 'Process monitoring, SPC, trend analysis & annual CPV review',
    useWhen: 'Open this for ongoing process checks (CPP, CQA, SPC, trends).',
    href: '/cpv/dashboard',
    icon: LineChart,
    emoji: '📈',
    color: 'from-violet-500 to-purple-500',
    iconBg: 'bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400',
    navGroupLabel: 'Continued Process Verification',
    keywords: ['cpv', 'process verification', 'spc', 'trend', 'monitoring'],
    permissionModules: ['cpv'],
    submoduleCount: 24,
  },
  {
    id: 'pqr',
    name: 'Product Quality Review',
    description: 'Annual product quality reviews, batch & material assessments',
    useWhen: 'Open this once a year to review each product from A to Z.',
    href: '/pqr/dashboard',
    icon: ClipboardList,
    emoji: '📑',
    color: 'from-teal-500 to-cyan-500',
    iconBg: 'bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-400',
    navGroupLabel: 'PQR Management',
    keywords: ['pqr', 'product quality review', 'annual review'],
    permissionModules: ['pqr'],
    submoduleCount: 10,
  },
  {
    id: 'regulatory',
    name: 'Regulatory & Compliance',
    description: 'Audit trails, document control & regulatory submissions',
    useWhen: 'Open this to see who did what, and for compliance evidence.',
    href: '/dashboard/audit-trail',
    icon: Scale,
    emoji: '⚖️',
    color: 'from-indigo-500 to-blue-600',
    iconBg: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400',
    navGroupLabel: 'Regulatory & Compliance',
    keywords: ['regulatory', 'compliance', 'audit trail', 'fda', 'gmp'],
    submoduleCount: 2,
  },
  {
    id: 'operations',
    name: 'Operations',
    description: 'Equipment, environmental monitoring, vendors & warehouse',
    useWhen: 'Open this for equipment, warehouse, vendors, and environment.',
    href: '/qms/equipment',
    icon: Cog,
    emoji: '⚙️',
    color: 'from-slate-500 to-gray-600',
    iconBg: 'bg-slate-50 text-slate-600 dark:bg-slate-800/50 dark:text-slate-300',
    navGroupLabel: 'Operations',
    keywords: ['operations', 'equipment', 'monitoring', 'vendor', 'warehouse'],
    permissionModules: ['equipment', 'monitoring', 'vendors', 'warehouse'],
    submoduleCount: 4,
  },
  {
    id: 'master-data',
    name: 'Master Data',
    description: 'Products, materials, vendors & reference data management',
    useWhen: 'Open this to add products, materials, and other master lists.',
    href: '/admin/products',
    icon: Database,
    emoji: '📂',
    color: 'from-emerald-500 to-green-500',
    iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
    navGroupLabel: 'Master Data',
    keywords: ['master data', 'product', 'material', 'vendor', 'abbreviation'],
    submoduleCount: 4,
  },
  {
    id: 'reports',
    name: 'Reports & Analytics',
    description: 'Cross-module reports, KPIs & regulatory intelligence',
    useWhen: 'Open this for dashboards, KPIs, and printable reports.',
    href: '/dashboard/reports',
    icon: BarChart3,
    emoji: '📊',
    color: 'from-sky-500 to-blue-500',
    iconBg: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400',
    navGroupLabel: 'Reports',
    keywords: ['reports', 'analytics', 'kpi', 'dashboard'],
    submoduleCount: 1,
  },
  {
    id: 'notifications',
    name: 'Notifications',
    description: 'Alerts, reminders & system notification center',
    useWhen: 'Open this to see alerts, reminders, and items waiting for you.',
    href: '/dashboard/notifications',
    icon: Bell,
    emoji: '🔔',
    color: 'from-amber-500 to-yellow-500',
    iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
    navGroupLabel: 'Notifications',
    keywords: ['notifications', 'alerts', 'reminders'],
    submoduleCount: 1,
  },
  {
    id: 'admin',
    name: 'Administration',
    description: 'Users, roles, workflows, system settings & configuration',
    useWhen: 'Open this to set up users, roles, numbering, and system rules.',
    href: '/admin',
    icon: Settings,
    emoji: '👥',
    color: 'from-rose-500 to-red-500',
    iconBg: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
    navGroupLabel: 'Admin',
    keywords: ['admin', 'administration', 'users', 'roles', 'settings'],
    permissionModules: ['admin'],
    submoduleCount: 19,
  },
];

export function getModuleById(id: string): LauncherModule | undefined {
  return LAUNCHER_MODULES.find((m) => m.id === id);
}
