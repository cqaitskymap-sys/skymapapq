'use client';

import type { ReactNode } from 'react';
import { AppPageHeader } from '@/components/layout/app-page-header';

interface AdminPageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function AdminPageHeader({ title, description, actions }: AdminPageHeaderProps) {
  return <AppPageHeader title={title} description={description} actions={actions} />;
}
