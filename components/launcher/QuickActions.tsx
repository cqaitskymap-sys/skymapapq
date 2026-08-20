'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  PackagePlus,
  AlertTriangle,
  CheckSquare,
  RefreshCw,
  ClipboardList,
  FileBarChart,
  Compass,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const QUICK_ACTIONS = [
  {
    label: 'How to use SKYMAP',
    href: '/dashboard/help',
    icon: Compass,
    iconBg: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400',
    color: 'hover:border-indigo-200 hover:bg-indigo-50/80 dark:hover:bg-indigo-950/30',
  },
  {
    label: 'Create Batch',
    href: '/cpv/batch-registration',
    icon: PackagePlus,
    iconBg: 'bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-400',
    color: 'hover:border-orange-200 hover:bg-orange-50/80 dark:hover:bg-orange-950/30',
  },
  {
    label: 'Raise Deviation',
    href: '/qms/deviation',
    icon: AlertTriangle,
    iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
    color: 'hover:border-amber-200 hover:bg-amber-50/80 dark:hover:bg-amber-950/30',
  },
  {
    label: 'Create CAPA',
    href: '/qms/capa',
    icon: CheckSquare,
    iconBg: 'bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
    color: 'hover:border-violet-200 hover:bg-violet-50/80 dark:hover:bg-violet-950/30',
  },
  {
    label: 'Create Change Control',
    href: '/qms/change-control',
    icon: RefreshCw,
    iconBg: 'bg-blue-50 text-[#2563EB] dark:bg-blue-950/40 dark:text-blue-400',
    color: 'hover:border-blue-200 hover:bg-blue-50/80 dark:hover:bg-blue-950/30',
  },
  {
    label: 'Open Audit',
    href: '/qms/audit',
    icon: ClipboardList,
    iconBg: 'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-400',
    color: 'hover:border-teal-200 hover:bg-teal-50/80 dark:hover:bg-teal-950/30',
  },
  {
    label: 'Generate Report',
    href: '/dashboard/reports',
    icon: FileBarChart,
    iconBg: 'bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400',
    color: 'hover:border-sky-200 hover:bg-sky-50/80 dark:hover:bg-sky-950/30',
  },
];

export function QuickActions() {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        Quick Actions
      </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {QUICK_ACTIONS.map((action, index) => (
          <motion.div
            key={action.label}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 + index * 0.05 }}
            whileHover={{ y: -3 }}
          >
            <Link
              href={action.href}
              className={cn(
                'flex flex-col items-center gap-2.5 rounded-2xl border border-border/40 bg-white/80 p-4 text-center',
                'shadow-sm backdrop-blur-sm transition-all duration-200',
                'hover:shadow-md dark:bg-card/80',
                action.color,
              )}
            >
              <div
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-xl shadow-sm ring-1 ring-black/[0.03] dark:ring-white/10',
                  action.iconBg,
                )}
              >
                <action.icon className="h-5 w-5" />
              </div>
              <span className="text-xs font-medium leading-tight text-foreground">
                {action.label}
              </span>
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
