'use client';

import Link from 'next/link';
import Image from 'next/image';
import {
  LogOut, Moon, Search, Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { NotificationBell } from '@/components/layout/notification-bell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/lib/utils';

interface LauncherHeaderProps {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
}

export function LauncherHeader({ searchQuery = '', onSearchChange }: LauncherHeaderProps) {
  const { theme, setTheme } = useTheme();
  const { profile, signOut } = useAuth();

  const handleSearch = (value: string) => {
    onSearchChange?.(value);
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-white/75 shadow-[0_1px_0_0_rgba(37,99,235,0.06)] backdrop-blur-xl dark:bg-background/80">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-3 sm:h-16 sm:gap-4 sm:px-6">
        {/* Logo & Brand */}
        <Link href="/launcher" className="flex min-w-fit items-center gap-2.5 transition-opacity hover:opacity-90">
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
          <div className="hidden flex-col leading-none sm:flex">
            <span className="text-sm font-bold tracking-tight text-[#2563EB]">SKYMAP QMS</span>
            <span className="text-[10px] font-medium tracking-wide text-muted-foreground">Enterprise Pharma</span>
          </div>
        </Link>

        {/* Global Search */}
        <div className="relative mx-auto hidden flex-1 md:block md:max-w-md lg:max-w-xl">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search modules, workflows…"
            aria-label="Global search"
            className="h-10 rounded-2xl border-border/40 bg-muted/50 pl-10 text-sm shadow-inner transition-all focus:border-[#2563EB]/40 focus:bg-background focus:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]"
          />
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl md:hidden"
            aria-label="Search"
            onClick={() => {
              const el = document.getElementById('launcher-mobile-search');
              el?.focus();
            }}
          >
            <Search className="h-4 w-4" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-xl"
            aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          </Button>

          <NotificationBell />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="h-9 gap-2 rounded-xl px-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#2563EB] to-sky-500 text-xs font-bold text-white shadow-sm shadow-[#2563EB]/25">
                  {(profile?.full_name || 'U').charAt(0).toUpperCase()}
                </div>
                <span className="hidden max-w-[100px] truncate text-sm font-medium lg:block">
                  {profile?.full_name || 'User'}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="font-medium">{profile?.full_name || 'User'}</p>
                <p className="text-xs text-muted-foreground">{profile?.email}</p>
                <span className={cn(
                  'mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                  'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
                )}>
                  {profile?.role?.replace(/_/g, ' ') || 'Super Admin'}
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/profile">Profile & Settings</Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut()} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            className="hidden h-9 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 sm:flex"
            onClick={() => signOut()}
          >
            <LogOut className="mr-1.5 h-3.5 w-3.5" />
            Logout
          </Button>
        </div>
      </div>

      {/* Mobile search bar */}
      <div className="border-t border-border/40 px-4 py-2 md:hidden">
        <Input
          id="launcher-mobile-search"
          type="search"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search modules…"
          className="h-9 rounded-xl text-sm"
        />
      </div>
    </header>
  );
}
