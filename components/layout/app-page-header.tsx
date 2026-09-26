'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { resolveLauncherModuleFromPath } from '@/lib/launcher/module-scope';
import { cn } from '@/lib/utils';

interface AppPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  eyebrow?: string;
  className?: string;
}

export function AppPageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: AppPageHeaderProps) {
  const pathname = usePathname() ?? '';
  const moduleName = resolveLauncherModuleFromPath(pathname)?.name;
  const label = eyebrow ?? moduleName;

  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="min-w-0 space-y-1">
        {label ? (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
