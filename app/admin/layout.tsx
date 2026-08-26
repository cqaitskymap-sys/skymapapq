'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { AdminAuthGuard } from '@/components/admin/admin-auth-guard';
import { Header } from '@/components/layout/header';
import { AppShell } from '@/components/layout/AppShell';
import { PageTransition } from '@/components/loading/page-transition';
import { GuideCoach } from '@/components/user-guide/guide-coach';
import { isMasterDataPath } from '@/lib/launcher/module-scope';
import { cn } from '@/lib/utils';

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  if (isMasterDataPath(pathname ?? '')) {
    return (
      <AdminAuthGuard>
        <AppShell>{children}</AppShell>
      </AdminAuthGuard>
    );
  }

  return (
    <AdminAuthGuard>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to content
      </a>
      <div className="flex h-dvh max-h-dvh overflow-hidden bg-slate-100/50 dark:bg-slate-950">
        <AdminSidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          <main id="main-content" className={cn('min-w-0 flex-1 overflow-x-hidden overflow-y-auto scrollbar-thin')}>
            <PageTransition routeKey={pathname ?? 'admin'} variant="fade" className="mx-auto min-h-full max-w-[1600px] p-3 xs:p-4 sm:p-6">
              {children}
            </PageTransition>
          </main>
        </div>
      </div>
      <GuideCoach />
    </AdminAuthGuard>
  );
}
