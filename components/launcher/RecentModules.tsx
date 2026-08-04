'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Clock, Star, ArrowRight } from 'lucide-react';
import { LAUNCHER_MODULES } from '@/lib/launcher/module-definitions';
import { getRecentModules, getFavoriteModules } from '@/lib/launcher/recent-modules';
import { cn } from '@/lib/utils';

interface RecentModulesProps {
  onModuleOpen?: (moduleId: string) => void;
}

export function RecentModules({ onModuleOpen }: RecentModulesProps) {
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(getRecentModules());
    setFavoriteIds(getFavoriteModules());
  }, []);

  const recentModules = recentIds
    .map((id) => LAUNCHER_MODULES.find((m) => m.id === id))
    .filter(Boolean)
    .slice(0, 4);

  const favoriteModules = favoriteIds.length
    ? favoriteIds.map((id) => LAUNCHER_MODULES.find((m) => m.id === id)).filter(Boolean)
    : LAUNCHER_MODULES.filter((m) => ['manufacturing', 'qms', 'cpv'].includes(m.id));

  const renderModuleChip = (module: (typeof LAUNCHER_MODULES)[0], index: number) => (
    <motion.div
      key={module.id}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06 }}
      whileHover={{ x: 2 }}
    >
      <Link
        href={module.href}
        onClick={() => onModuleOpen?.(module.id)}
        className={cn(
          'group flex items-center gap-3 rounded-xl border border-border/40 bg-white/80 px-4 py-3',
          'shadow-sm backdrop-blur-sm transition-all duration-200',
          'hover:border-[#2563EB]/30 hover:shadow-md dark:bg-card/80',
        )}
      >
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-xl text-lg shadow-sm ring-1 ring-black/[0.03] transition-transform group-hover:scale-105 dark:ring-white/10',
            module.iconBg,
          )}
        >
          {module.emoji}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground group-hover:text-[#2563EB]">
            {module.name}
          </p>
          <p className="text-xs text-muted-foreground">{module.submoduleCount} submodules</p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-[#2563EB]" />
      </Link>
    </motion.div>
  );

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted/60">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Recently Opened
          </h2>
        </div>
        {recentModules.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {recentModules.map((m, i) => renderModuleChip(m!, i))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border/60 bg-white/50 px-4 py-6 text-center text-sm text-muted-foreground backdrop-blur-sm dark:bg-muted/20">
            Open a module to see it here
          </p>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40">
            <Star className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Favorite Modules
          </h2>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {favoriteModules.slice(0, 4).map((m, i) => renderModuleChip(m!, i))}
        </div>
      </section>
    </div>
  );
}
