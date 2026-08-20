'use client';

import { ReactNode, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { PageTransition } from '@/components/loading/page-transition';
import { GuideCoach } from '@/components/user-guide/guide-coach';
import { PageFriendlyBanner } from '@/components/user-guide/page-friendly-banner';
import { cn } from '@/lib/utils';

interface AppShellProps {
  children: ReactNode;
  className?: string;
}

export function AppShell({ children, className }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow-md"
      >
        Skip to content
      </a>
      <div className="flex min-w-0 flex-1 overflow-hidden">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Header />
          <main id="main-content" className={cn('flex-1 overflow-y-auto', className)}>
            <PageTransition routeKey={pathname ?? 'app'} variant="fade" className="min-h-full p-4 md:p-6">
              <PageFriendlyBanner hidden={pathname === '/dashboard/help'} />
              {children}
            </PageTransition>
          </main>
        </div>
      </div>
      <GuideCoach hidden={pathname === '/dashboard/help'} />
    </div>
  );
}

export default AppShell;
