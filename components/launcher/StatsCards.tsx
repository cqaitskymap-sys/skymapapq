'use client';

import { motion } from 'framer-motion';
import { LayoutGrid, ListTodo, AlertTriangle, CheckSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LauncherStats } from '@/hooks/use-launcher-stats';

interface StatsCardsProps {
  stats: LauncherStats;
}

const STAT_ITEMS = [
  {
    key: 'totalModules' as const,
    label: 'Total Modules',
    icon: LayoutGrid,
    color: 'text-[#2563EB]',
    bg: 'bg-blue-50 dark:bg-blue-950/40',
    accent: 'from-[#2563EB] to-sky-400',
    ring: 'group-hover:ring-[#2563EB]/20',
  },
  {
    key: 'pendingTasks' as const,
    label: 'Pending Tasks',
    icon: ListTodo,
    color: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/40',
    accent: 'from-amber-500 to-orange-400',
    ring: 'group-hover:ring-amber-500/20',
  },
  {
    key: 'openCapas' as const,
    label: 'Open CAPAs',
    icon: CheckSquare,
    color: 'text-violet-600',
    bg: 'bg-violet-50 dark:bg-violet-950/40',
    accent: 'from-violet-500 to-purple-400',
    ring: 'group-hover:ring-violet-500/20',
  },
  {
    key: 'openDeviations' as const,
    label: 'Open Deviations',
    icon: AlertTriangle,
    color: 'text-rose-600',
    bg: 'bg-rose-50 dark:bg-rose-950/40',
    accent: 'from-rose-500 to-pink-400',
    ring: 'group-hover:ring-rose-500/20',
  },
];

export function StatsCards({ stats }: StatsCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {STAT_ITEMS.map((item, index) => (
        <motion.div
          key={item.key}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.08, duration: 0.35 }}
          whileHover={{ y: -2 }}
          className={cn(
            'group relative overflow-hidden rounded-2xl border border-border/40 bg-white/80 p-4',
            'shadow-sm backdrop-blur-sm transition-all duration-300',
            'hover:shadow-md ring-1 ring-transparent',
            item.ring,
            'dark:bg-card/80',
          )}
        >
          <div
            aria-hidden
            className={cn('absolute inset-y-0 left-0 w-1 bg-gradient-to-b', item.accent)}
          />
          <div className="flex items-center gap-3 pl-1.5">
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl shadow-sm transition-transform duration-300 group-hover:scale-105',
                item.bg,
              )}
            >
              <item.icon className={cn('h-5 w-5', item.color)} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {item.label}
              </p>
              <p className="text-2xl font-bold tabular-nums tracking-tight text-foreground">
                {stats.loading ? '—' : stats[item.key]}
              </p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
