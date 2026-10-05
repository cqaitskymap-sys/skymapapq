'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Shield, Building2, BadgeCheck, Factory,
  FlaskConical, Package, SlidersHorizontal, GitBranch, CheckSquare, Hash,
  FileSearch, PenLine, Bell, Database, Settings, PanelLeftClose,
  PanelLeftOpen, ChevronRight, ShieldCheck, LogIn, UserCheck, KeyRound,
  Mail, Blocks, FileUp, HardDrive, Cloud, Activity, LayoutGrid, Wrench, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ADMIN_NAV_ITEMS } from '@/lib/admin/constants';
import { useAdminPermissions } from '@/hooks/use-admin-permissions';
import {
  canViewApprovalMatrix, canViewAuditTrail, canViewLoginActivity, canViewBackup, canViewBatches,
  canViewCompanySites, canViewDepartments, canViewDesignations,
  canViewDocumentNumbering, canViewEsignSettings, canViewNotificationSettings,
  canViewParameters, canViewProducts, canViewEquipmentMaster, canViewRoles, canViewSystemSettings,
  canViewModuleConfiguration, canViewMasterDataImportExport, canViewUsers, canViewWorkflows, canViewAccessReview,
} from '@/lib/permissions';

const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard, Users, Shield, Building2, BadgeCheck, Factory,
  FlaskConical, Package, SlidersHorizontal, GitBranch, CheckSquare, Hash,
  FileSearch, PenLine, Bell, Database, Settings, LogIn, UserCheck, KeyRound,
  Mail, Blocks, FileUp, HardDrive, Cloud, Activity, Wrench,
};

interface AdminSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  embedded?: boolean;
}

export function AdminSidebar({ collapsed, onToggle, embedded = false }: AdminSidebarProps) {
  const pathname = usePathname();
  const { role } = useAdminPermissions();
  const [navQuery, setNavQuery] = useState('');

  const isActive = (href: string) => {
    if (href === '/admin') {
      return pathname === '/admin' || pathname === '/dashboard/admin';
    }
    if (href === '/admin/users') {
      return pathname.startsWith('/admin/users') || pathname.startsWith('/dashboard/admin/users');
    }
    if (href === '/admin/roles') {
      return pathname.startsWith('/admin/roles') || pathname.startsWith('/dashboard/admin/roles');
    }
    if (href === '/admin/departments') {
      return pathname.startsWith('/admin/departments') || pathname.startsWith('/dashboard/admin/departments');
    }
    if (href === '/admin/designations') {
      return pathname.startsWith('/admin/designations') || pathname.startsWith('/dashboard/admin/designations');
    }
    if (href === '/admin/company-site') {
      return pathname.startsWith('/admin/company-site') || pathname.startsWith('/dashboard/admin/company-sites');
    }
    if (href === '/admin/products') {
      return pathname.startsWith('/admin/products') || pathname.startsWith('/dashboard/admin/products');
    }
    if (href === '/admin/equipment') {
      return pathname.startsWith('/admin/equipment') || pathname.startsWith('/dashboard/admin/equipment');
    }
    if (href === '/admin/batches') {
      return pathname.startsWith('/admin/batches') || pathname.startsWith('/dashboard/admin/batches');
    }
    if (href === '/admin/parameters') {
      return pathname.startsWith('/admin/parameters') || pathname.startsWith('/dashboard/admin/parameters');
    }
    if (href === '/admin/workflows') {
      return pathname.startsWith('/admin/workflows') || pathname.startsWith('/dashboard/admin/workflows');
    }
    if (href === '/admin/approval-matrix') {
      return pathname.startsWith('/admin/approval-matrix') || pathname.startsWith('/dashboard/admin/approval-matrix');
    }
    if (href === '/admin/firebase-status') {
      return pathname.startsWith('/admin/firebase-status')
        || pathname.startsWith('/dashboard/admin/firebase-status');
    }
    if (href === '/admin/system-health') {
      return pathname.startsWith('/admin/system-health')
        || pathname.startsWith('/dashboard/admin/system-health');
    }
    return pathname === href || pathname.startsWith(href + '/');
  };

  const routeAccess: Array<[string, (currentRole: string) => boolean]> = [
    ['/admin/users', canViewUsers],
    ['/admin/roles', canViewRoles],
    ['/admin/departments', canViewDepartments],
    ['/admin/designations', canViewDesignations],
    ['/admin/company-site', canViewCompanySites],
    ['/admin/products', canViewProducts],
    ['/admin/equipment', canViewEquipmentMaster],
    ['/admin/batches', canViewBatches],
    ['/admin/parameters', canViewParameters],
    ['/admin/workflows', canViewWorkflows],
    ['/admin/approval-matrix', canViewApprovalMatrix],
    ['/admin/document-numbering', canViewDocumentNumbering],
    ['/admin/audit-trail', canViewAuditTrail],
    ['/admin/login-activity', canViewLoginActivity],
    ['/dashboard/admin/login-activity', canViewLoginActivity],
    ['/admin/user-access-review', canViewAccessReview],
    ['/dashboard/admin/user-access-review', canViewAccessReview],
    ['/admin/esign-settings', canViewEsignSettings],
    ['/admin/notifications', canViewNotificationSettings],
    ['/admin/email-sms-templates', canViewNotificationSettings],
    ['/dashboard/admin/email-sms-templates', canViewNotificationSettings],
    ['/admin/module-configuration', canViewModuleConfiguration],
    ['/dashboard/admin/module-configuration', canViewModuleConfiguration],
    ['/admin/master-data-import-export', canViewMasterDataImportExport],
    ['/dashboard/admin/master-data-import-export', canViewMasterDataImportExport],
    ['/admin/backup', canViewBackup],
    ['/admin/backup/history', canViewBackup],
    ['/dashboard/admin/data-backup-log', canViewBackup],
    ['/admin/system-settings', canViewSystemSettings],
    ['/admin/firebase-status', canViewSystemSettings],
    ['/admin/system-health', canViewSystemSettings],
    ['/dashboard/admin/password-policy', canViewSystemSettings],
    ['/admin/system-settings/password-policy', canViewSystemSettings],
    ['/dashboard/admin/firebase-status', canViewSystemSettings],
    ['/dashboard/admin/system-health', canViewSystemSettings],
  ];
  const filteredNav = useMemo(() => {
    const allowed = ADMIN_NAV_ITEMS.filter((item) => {
      const accessRule = routeAccess.find(([prefix]) =>
        item.href === prefix || item.href.startsWith(`${prefix}/`),
      );
      return accessRule ? accessRule[1](role) : true;
    });
    const q = navQuery.trim().toLowerCase();
    if (!q) return allowed;
    return allowed.filter((item) => item.label.toLowerCase().includes(q));
  }, [role, navQuery]);

  return (
    <aside
      className={cn(
        'min-h-0 flex-col overflow-hidden border-r bg-slate-50 transition-all duration-300 dark:bg-slate-950',
        embedded ? 'flex h-dvh w-full' : 'hidden h-full lg:flex',
        !embedded && (collapsed ? 'w-[68px]' : 'w-[280px]')
      )}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b bg-white px-4 dark:bg-slate-900">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-blue-600" />
            <div>
              <p className="text-sm font-bold text-blue-700 dark:text-blue-400">Admin Panel</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Pharma QMS</p>
            </div>
          </div>
        )}
        <Button variant="ghost" size="icon" onClick={onToggle} className="shrink-0">
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && (
        <div className="shrink-0 border-b px-4 py-3">
          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
            {role.replace(/_/g, ' ').toUpperCase()}
          </Badge>
        </div>
      )}

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-y-contain px-2 py-2">
        {!collapsed && (
          <>
            <Link
              href="/launcher"
              className="mb-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <LayoutGrid className="h-4 w-4 shrink-0" />
              All Modules
            </Link>
            <div className="relative mb-2 px-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={navQuery}
                onChange={(event) => setNavQuery(event.target.value)}
                placeholder="Find a setting…"
                aria-label="Find a setting in Admin"
                className="h-8 bg-white pl-8 text-xs dark:bg-slate-900"
              />
            </div>
          </>
        )}
        {filteredNav.map((item) => {
          const Icon = ICON_MAP[item.icon] || Settings;
          const active = isActive(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-blue-50 hover:text-blue-700 dark:text-slate-300 dark:hover:bg-slate-800'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', active && 'text-white')} />
              {!collapsed && (
                <>
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  {active && <ChevronRight className="h-3 w-3 opacity-70" />}
                </>
              )}
            </Link>
          );
        })}
        {!collapsed && navQuery.trim() && filteredNav.length === 0 && (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            No settings match “{navQuery.trim()}”.
          </p>
        )}
      </nav>

      {!collapsed && (
        <div className="shrink-0 border-t p-4 text-xs text-muted-foreground">
          <p>GxP control framework enabled</p>
          <p className="mt-1">Validation evidence must be maintained</p>
        </div>
      )}
    </aside>
  );
}
