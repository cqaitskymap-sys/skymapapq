'use client';

import { FormEvent, useState } from 'react';
import {
  ChevronRight, Compass, CircleHelp, LifeBuoy, LogOut, Moon, Search, Settings, Sun,
} from 'lucide-react';
import { NotificationBell } from '@/components/layout/notification-bell';
import { MobileNav } from '@/components/layout/mobile-nav';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { formatBreadcrumbLabel } from '@/lib/breadcrumb-labels';

function getBreadcrumbs(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);
  const crumbs = [{ label: 'Home', href: '/launcher' }];
  let path = '';
  for (const part of parts) {
    path += `/${part}`;
    if (path === '/dashboard') continue;
    crumbs.push({ label: formatBreadcrumbLabel(part, pathname), href: path });
  }
  return crumbs;
}

export function Header() {
  const { theme, setTheme } = useTheme();
  const { profile, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const crumbs = getBreadcrumbs(pathname);

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    const value = searchQuery.trim();
    if (!value) return;
    router.push(`/dashboard/search?q=${encodeURIComponent(value)}`);
  };

  const getRoleBadgeColor = (role?: string) => {
    switch (role) {
      case 'super_admin': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'qa': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'qc': return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400';
      case 'production': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400';
    }
  };

  return (
    <header className="h-16 border-b bg-background/95 backdrop-blur-sm flex items-center px-4 gap-4 sticky top-0 z-30">
      <MobileNav />
      {/* Company Logo & Name */}
      <div className="flex items-center gap-2 min-w-fit">
        <div className="relative h-8">
          <Image
            src="/logo-1.png"
            alt="Skymap Logo"
            width={298}
            height={143}
            className="h-8 w-auto object-contain"
            priority
          />
        </div>
        <div className="flex flex-col leading-none">
          <span className="font-bold text-sm bg-gradient-to-r from-blue-600 to-green-500 bg-clip-text text-transparent">SKYMAP</span>
          <span className="text-xs text-muted-foreground">Pharmaceuticals</span>
        </div>
      </div>

      {/* Divider */}
      <div className="hidden md:block w-px h-6 bg-border" />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="hidden md:flex items-center gap-1 text-sm text-muted-foreground flex-1">
        {crumbs.map((crumb, i) => (
          <span key={`${crumb.href}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />}
            {i === crumbs.length - 1 ? (
              <span className="text-foreground font-medium">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="hover:text-foreground transition-colors">{crumb.label}</Link>
            )}
          </span>
        ))}
      </nav>

      {/* Search */}
      <form onSubmit={submitSearch} role="search" className="relative hidden lg:block w-64">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search modules and workflows…"
          aria-label="Search modules and workflows"
          className="pl-8 h-8 text-sm bg-muted/50 border-muted-foreground/20 focus:bg-background"
        />
      </form>

      {/* Right actions */}
      <div className="flex items-center gap-2 ml-auto md:ml-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="hidden h-8 gap-1.5 px-2 xl:inline-flex"
          asChild
        >
          <Link href="/dashboard/help">
            <Compass className="h-4 w-4" />
            How to use
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 xl:hidden"
          asChild
        >
          <Link href="/dashboard/help" aria-label="How to use SKYMAP">
            <CircleHelp className="h-4 w-4" />
          </Link>
        </Button>

        <NotificationBell />

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-2.5 text-sm">
              <div className="w-6 h-6 bg-primary/10 rounded-full flex items-center justify-center text-xs font-bold text-primary">
                {(profile?.full_name || 'DU').charAt(0).toUpperCase()}
              </div>
              <span className="hidden md:block max-w-[120px] truncate">{profile?.full_name || 'User'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div>
                <p className="font-medium">{profile?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{profile?.email || ''}</p>
                <span className={cn('inline-block mt-1 text-xs px-2 py-0.5 rounded-full font-medium capitalize', getRoleBadgeColor(profile?.role))}>
                  {profile?.role?.replace('_', ' ') || 'Super Admin'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/profile"><Settings className="h-4 w-4 mr-2" />Profile & Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/help"><CircleHelp className="h-4 w-4 mr-2" />How to use (A–Z guide)</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/dashboard/support"><LifeBuoy className="h-4 w-4 mr-2" />Support</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()} className="text-red-600 dark:text-red-400">
              <LogOut className="h-4 w-4 mr-2" />Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
