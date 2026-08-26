'use client';

import { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  basePath?: string;
  sectionLabel?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  basePath = '/admin',
  sectionLabel = 'Admin',
}: PageHeaderProps) {
  return (
    <div className="space-y-4 mb-6">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard" className="flex items-center gap-1 hover:text-blue-600">
          <Home className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href={basePath} className="hover:text-blue-600">{sectionLabel}</Link>
      </nav>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            {title}
          </h1>
          {description && (
            <p className="text-muted-foreground mt-1 text-sm">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
