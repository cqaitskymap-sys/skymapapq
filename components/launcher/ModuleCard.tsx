'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Layers, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { LauncherModule } from '@/lib/launcher/module-definitions';

interface ModuleCardProps {
  module: LauncherModule;
  index?: number;
  onOpen?: (moduleId: string) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (moduleId: string) => void;
}

export function ModuleCard({
  module,
  index = 0,
  onOpen,
  isFavorite = false,
  onToggleFavorite,
}: ModuleCardProps) {
  const Icon = module.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: 'easeOut' }}
      whileHover={{ y: -6 }}
      className="group h-full"
    >
      <div
        className={cn(
          'relative flex h-full min-h-[280px] w-full flex-col overflow-hidden rounded-2xl',
          'border border-border/40 bg-white/90 p-5 shadow-[0_4px_24px_-8px_rgba(15,23,42,0.08)]',
          'backdrop-blur-sm transition-all duration-300',
          'hover:border-[#2563EB]/25 hover:shadow-[0_20px_40px_-16px_rgba(37,99,235,0.25)]',
          'dark:bg-card/90',
        )}
      >
        {/* Module-colored top accent */}
        <div
          aria-hidden
          className={cn(
            'absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r opacity-80 transition-opacity duration-300 group-hover:opacity-100',
            module.color,
          )}
        />

        {/* Soft glow on hover */}
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-30',
            module.color,
          )}
        />

        <div className="relative flex items-start justify-between gap-3">
          <div
            className={cn(
              'flex h-14 w-14 items-center justify-center rounded-2xl text-2xl shadow-sm ring-1 ring-black/[0.04] transition-transform duration-300 group-hover:scale-105 dark:ring-white/10',
              module.iconBg,
            )}
          >
            <span role="img" aria-hidden>{module.emoji}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {onToggleFavorite && (
              <button
                type="button"
                onClick={() => onToggleFavorite(module.id)}
                aria-label={isFavorite ? `Remove ${module.name} from favorites` : `Add ${module.name} to favorites`}
                aria-pressed={isFavorite}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground transition-colors',
                  'hover:border-amber-300 hover:bg-amber-50 hover:text-amber-500',
                  'dark:hover:bg-amber-950/40',
                  isFavorite && 'border-amber-300/70 bg-amber-50 text-amber-500 dark:bg-amber-950/40',
                )}
              >
                <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-amber-400')} />
              </button>
            )}
            <div className="flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
              <Layers className="h-3 w-3" />
              {module.submoduleCount}
            </div>
          </div>
        </div>

        <div className="relative mt-4 flex-1">
          <h3 className="text-base font-semibold leading-tight tracking-tight text-foreground transition-colors group-hover:text-[#2563EB]">
            {module.name}
          </h3>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {module.description}
          </p>
        </div>

        <Link
          href={module.href}
          onClick={() => onOpen?.(module.id)}
          className="relative mt-4"
        >
          <Button
            className={cn(
              'h-10 w-full rounded-xl text-sm font-medium text-white shadow-md',
              'bg-gradient-to-r transition-all duration-300',
              'hover:brightness-110 hover:shadow-lg',
              'relative overflow-hidden group/btn',
              module.color,
            )}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Icon className="h-3.5 w-3.5" />
              Open
              <ArrowRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover/btn:translate-x-1" />
            </span>
            <span className="absolute inset-0 translate-y-full bg-white/20 transition-transform duration-300 group-hover/btn:translate-y-0" />
          </Button>
        </Link>
      </div>
    </motion.div>
  );
}
