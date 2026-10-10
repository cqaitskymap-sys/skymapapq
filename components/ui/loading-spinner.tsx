'use client';

import { PageLoader } from '@/components/loading/loaders';
import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  className?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function LoadingSpinner({ className, label = 'Loading...', size = 'md' }: LoadingSpinnerProps) {
  return (
    <PageLoader
      message={label}
      className={cn(size === 'sm' && 'min-h-[8rem]', className)}
    />
  );
}
