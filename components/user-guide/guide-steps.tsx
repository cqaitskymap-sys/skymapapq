'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GuideStep } from '@/lib/user-guide';
import { Button } from '@/components/ui/button';

export function GuideSteps({
  steps,
  activeIndex = 0,
  whatNext,
  compact = false,
}: {
  steps: GuideStep[];
  activeIndex?: number;
  whatNext?: string;
  compact?: boolean;
}) {
  return (
    <ol className={cn('space-y-3', compact && 'space-y-2')}>
      {steps.map((step, index) => {
        const active = index === activeIndex;
        const done = index < activeIndex;
        return (
          <li
            key={`${step.title}-${index}`}
            className={cn(
              'rounded-xl border p-3 transition-colors',
              active
                ? 'border-[#2563EB]/40 bg-[#2563EB]/5 shadow-sm'
                : 'border-border/60 bg-card',
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  done && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400',
                  active && 'bg-[#2563EB] text-white',
                  !done && !active && 'bg-muted text-muted-foreground',
                )}
              >
                {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold leading-tight">{step.title}</p>
                <p className={cn('mt-1 text-muted-foreground', compact ? 'text-xs' : 'text-sm')}>
                  {step.detail}
                </p>
                {step.href && (
                  <Button asChild variant={active ? 'default' : 'outline'} size="sm" className="mt-2 h-7 px-2 text-xs">
                    <Link href={step.href}>
                      Open this step
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
      {whatNext && (
        <li className="rounded-xl border border-dashed border-amber-300/70 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-400">
            <Circle className="h-3 w-3 fill-current" />
            After this
          </p>
          <p className="mt-1 text-sm text-amber-950 dark:text-amber-100">{whatNext}</p>
        </li>
      )}
    </ol>
  );
}
