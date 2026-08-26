'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Sidebar } from '@/components/layout/sidebar';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { isMasterDataPath } from '@/lib/launcher/module-scope';

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const showAdminNav =
    Boolean(pathname?.startsWith('/admin') || pathname?.startsWith('/dashboard/admin'))
    && !isMasterDataPath(pathname ?? '');

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 lg:hidden" aria-label="Open navigation menu">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[min(280px,calc(100vw-2rem))] border-r p-0">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <div key={pathname} onClick={() => setOpen(false)} className="h-full">
          {showAdminNav ? (
            <AdminSidebar collapsed={false} onToggle={() => setOpen(false)} embedded />
          ) : (
            <Sidebar collapsed={false} onToggle={() => setOpen(false)} embedded />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
