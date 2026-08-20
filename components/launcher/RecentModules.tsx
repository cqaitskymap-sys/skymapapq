'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Clock, Star, ArrowRight, Pencil } from 'lucide-react';
import { LAUNCHER_MODULES, type LauncherModule } from '@/lib/launcher/module-definitions';
import { getRecentModules, MAX_FAVORITE_MODULES } from '@/lib/launcher/recent-modules';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface RecentModulesProps {
  onModuleOpen?: (moduleId: string) => void;
  favoriteIds: string[];
  accessibleModules?: LauncherModule[];
  onSetFavorites: (moduleIds: string[]) => void;
}

export function RecentModules({
  onModuleOpen,
  favoriteIds,
  accessibleModules = LAUNCHER_MODULES,
  onSetFavorites,
}: RecentModulesProps) {
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);

  useEffect(() => {
    setRecentIds(getRecentModules());
  }, []);

  const recentModules = recentIds
    .map((id) => LAUNCHER_MODULES.find((m) => m.id === id))
    .filter(Boolean)
    .slice(0, 4);

  const favoriteModules = favoriteIds
    .map((id) => accessibleModules.find((m) => m.id === id) ?? LAUNCHER_MODULES.find((m) => m.id === id))
    .filter(Boolean);

  const openManage = () => {
    setDraftIds(favoriteIds);
    setManageOpen(true);
  };

  const toggleDraft = (moduleId: string) => {
    setDraftIds((current) => {
      if (current.includes(moduleId)) {
        return current.filter((id) => id !== moduleId);
      }
      if (current.length >= MAX_FAVORITE_MODULES) return current;
      return [...current, moduleId];
    });
  };

  const saveFavorites = () => {
    onSetFavorites(draftIds);
    setManageOpen(false);
  };

  const renderModuleChip = (module: LauncherModule, index: number) => (
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
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40">
              <Star className="h-3.5 w-3.5 text-amber-500" />
            </div>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Favorite Modules
            </h2>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={openManage}
            className="h-8 gap-1.5 rounded-lg px-2.5 text-xs"
          >
            <Pencil className="h-3 w-3" />
            Manage
          </Button>
        </div>
        {favoriteModules.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {favoriteModules.map((m, i) => renderModuleChip(m!, i))}
          </div>
        ) : (
          <button
            type="button"
            onClick={openManage}
            className="w-full rounded-xl border border-dashed border-border/60 bg-white/50 px-4 py-6 text-center text-sm text-muted-foreground backdrop-blur-sm transition-colors hover:border-amber-300 hover:bg-amber-50/40 dark:bg-muted/20 dark:hover:bg-amber-950/20"
          >
            No favorite modules yet. Click to pick the ones you use most.
          </button>
        )}
      </section>

      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select favorite modules</DialogTitle>
            <DialogDescription>
              Choose up to {MAX_FAVORITE_MODULES} modules to pin in Favorite Modules.
              {draftIds.length > 0 ? ` ${draftIds.length} selected.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5 py-1">
            {accessibleModules.map((module) => {
              const checked = draftIds.includes(module.id);
              const atLimit = !checked && draftIds.length >= MAX_FAVORITE_MODULES;
              return (
                <label
                  key={module.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors',
                    'hover:bg-muted/50',
                    checked && 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30',
                    atLimit && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={atLimit}
                    onCheckedChange={() => toggleDraft(module.id)}
                    aria-label={module.name}
                  />
                  <div
                    className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base',
                      module.iconBg,
                    )}
                  >
                    {module.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{module.name}</p>
                    <p className="text-xs text-muted-foreground">{module.submoduleCount} submodules</p>
                  </div>
                  {checked && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />}
                </label>
              );
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setManageOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={saveFavorites}>
              Save favorites
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
