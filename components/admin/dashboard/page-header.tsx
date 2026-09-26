'use client';

import type { ReactNode } from 'react';
import { AppPageHeader } from '@/components/layout/app-page-header';

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Kept for call-site compatibility. Module context is inferred from the route. */
  basePath?: string;
  /** Kept for call-site compatibility. Module context is inferred from the route. */
  sectionLabel?: string;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return <AppPageHeader title={title} description={description} actions={actions} />;
}
