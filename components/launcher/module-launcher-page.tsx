'use client';

import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { LauncherHeader } from '@/components/launcher/Header';
import { SearchBar } from '@/components/launcher/SearchBar';
import { StatsCards } from '@/components/launcher/StatsCards';
import { ModuleGrid } from '@/components/launcher/ModuleGrid';
import { QuickActions } from '@/components/launcher/QuickActions';
import { RecentModules } from '@/components/launcher/RecentModules';
import { LAUNCHER_MODULES } from '@/lib/launcher/module-definitions';
import {
  addRecentModule,
  getFavoriteModules,
  setFavoriteModules,
  toggleFavoriteModule,
  DEFAULT_FAVORITE_MODULES,
  MAX_FAVORITE_MODULES,
} from '@/lib/launcher/recent-modules';
import { toast } from 'sonner';
import { useLauncherStats } from '@/hooks/use-launcher-stats';
import { useAuth } from '@/contexts/auth-context';
import { usePermissions } from '@/hooks/usePermissions';

function formatRole(role?: string): string {
  if (!role) return 'Super Admin';
  return role.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function getTimeGreeting(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export function ModuleLauncherPage() {
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [favoriteIds, setFavoriteIds] = useState<string[]>(DEFAULT_FAVORITE_MODULES);
  const stats = useLauncherStats();
  const { profile } = useAuth();
  const { canAccessModule } = usePermissions();

  useEffect(() => {
    setFavoriteIds(getFavoriteModules());
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const accessibleModules = useMemo(() => {
    return LAUNCHER_MODULES.filter((mod) => {
      if (!mod.permissionModules?.length) return true;
      return mod.permissionModules.some((m) => canAccessModule(m));
    });
  }, [canAccessModule]);

  const visibleModules = useMemo(() => {
    if (!search.trim()) return accessibleModules;
    const q = search.toLowerCase();
    return accessibleModules.filter(
      (mod) =>
        mod.name.toLowerCase().includes(q)
        || mod.description.toLowerCase().includes(q)
        || mod.keywords.some((k) => k.includes(q)),
    );
  }, [search, accessibleModules]);

  const handleModuleOpen = (moduleId: string) => {
    addRecentModule(moduleId);
  };

  const handleToggleFavorite = (moduleId: string) => {
    if (!favoriteIds.includes(moduleId) && favoriteIds.length >= MAX_FAVORITE_MODULES) {
      toast.error(`You can pin up to ${MAX_FAVORITE_MODULES} favorite modules`);
      return;
    }
    setFavoriteIds(toggleFavoriteModule(moduleId));
  };

  const handleSetFavorites = (moduleIds: string[]) => {
    setFavoriteIds(setFavoriteModules(moduleIds));
  };

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-[#F4F7FB] dark:bg-background">
      {/* Atmospheric background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
      >
        <div className="absolute -left-32 top-0 h-[420px] w-[420px] rounded-full bg-[#2563EB]/[0.07] blur-3xl dark:bg-[#2563EB]/10" />
        <div className="absolute right-0 top-24 h-[360px] w-[360px] rounded-full bg-sky-400/10 blur-3xl dark:bg-sky-500/10" />
        <div className="absolute bottom-0 left-1/3 h-[280px] w-[480px] rounded-full bg-indigo-400/[0.06] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.35] dark:opacity-[0.15]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgb(37 99 235 / 0.08) 1px, transparent 0)',
            backgroundSize: '28px 28px',
          }}
        />
      </div>

      <LauncherHeader searchQuery={search} onSearchChange={setSearch} />

      <main className="mx-auto max-w-[1600px] px-3 py-5 xs:px-4 sm:px-6 sm:py-8">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="relative overflow-hidden rounded-3xl border border-white/70 bg-white/70 p-5 shadow-[0_8px_40px_-12px_rgba(37,99,235,0.12)] backdrop-blur-xl dark:border-border/50 dark:bg-card/70 sm:p-6">
            <div
              aria-hidden
              className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#2563EB] via-sky-400 to-indigo-400"
            />
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-sm font-medium tracking-wide text-muted-foreground">
                  {getTimeGreeting(now)},
                </p>
                <h1 className="mt-0.5 bg-gradient-to-r from-foreground to-[#2563EB] bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl">
                  {profile?.full_name || 'Super Admin'}
                </h1>
                <p className="mt-1.5 inline-flex items-center rounded-full bg-[#2563EB]/10 px-2.5 py-0.5 text-xs font-medium capitalize text-[#2563EB] dark:bg-[#2563EB]/20">
                  {formatRole(profile?.role)}
                </p>
              </div>
              <div className="text-left lg:text-right">
                <p className="text-sm font-medium text-muted-foreground">{dateStr}</p>
                <p className="mt-0.5 bg-gradient-to-br from-[#2563EB] to-sky-500 bg-clip-text text-3xl font-bold tabular-nums tracking-tight text-transparent">
                  {timeStr}
                </p>
              </div>
            </div>

            <div className="mt-6">
              <StatsCards stats={stats} />
            </div>
          </div>
        </motion.section>

        <section className="mb-8">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Modules</h2>
              <p className="text-sm text-muted-foreground">
                Tap a tile to begin. Each card says when to use that module.
              </p>
            </div>
            <SearchBar
              value={search}
              onChange={setSearch}
              className="sm:max-w-xs lg:hidden"
            />
          </div>
          <ModuleGrid
            modules={visibleModules}
            onModuleOpen={handleModuleOpen}
            favoriteIds={favoriteIds}
            onToggleFavorite={handleToggleFavorite}
          />
        </section>

        <div className="mb-8">
          <RecentModules
            onModuleOpen={handleModuleOpen}
            favoriteIds={favoriteIds}
            accessibleModules={accessibleModules}
            onSetFavorites={handleSetFavorites}
          />
        </div>

        <QuickActions />

        <p className="mt-10 pb-2 text-center text-xs text-muted-foreground">
          Developed by Satyajit Patri from Odisha
        </p>
      </main>
    </div>
  );
}
