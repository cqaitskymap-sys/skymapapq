'use client';

import type { ReactNode } from 'react';
import { AppPageHeader } from '@/components/layout/app-page-header';

interface CpvPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Kept for call-site compatibility. Top header already shows breadcrumbs. */
  trail?: { label: string; href?: string }[];
}

export function CpvPageHeader({ title, description, actions }: CpvPageHeaderProps) {
  return <AppPageHeader title={title} description={description} actions={actions} />;
}
