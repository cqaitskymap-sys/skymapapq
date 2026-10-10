'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  DashboardSkeleton,
  TableSkeleton,
  FormSkeleton,
  ChartSkeleton,
  ListSkeleton,
} from './skeletons';

interface PremiumFullScreenLoaderProps {
  message?: string;
  progress?: number;
  showProgress?: boolean;
  className?: string;
  compact?: boolean;
  onFadeComplete?: () => void;
}

function FloatingParticles({ reducedMotion }: { reducedMotion: boolean }) {
  if (reducedMotion) return null;
  const particles = Array.from({ length: 12 });
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {particles.map((_, i) => (
        <motion.span
          key={i}
          className="absolute h-1 w-1 rounded-full bg-primary/30"
          style={{
            left: `${8 + (i * 7.5) % 84}%`,
            top: `${12 + (i * 11) % 76}%`,
          }}
          animate={{
            y: [0, -12 - (i % 3) * 4, 0],
            opacity: [0.2, 0.7, 0.2],
            scale: [1, 1.4, 1],
          }}
          transition={{
            duration: 2.8 + (i % 4) * 0.4,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.15,
          }}
        />
      ))}
    </div>
  );
}

export function PremiumFullScreenLoader({
  message = 'Preparing your workspace',
  progress,
  showProgress = true,
  className,
  compact = false,
  onFadeComplete,
}: PremiumFullScreenLoaderProps) {
  const reducedMotion = useReducedMotion();
  const [estimatedProgress, setEstimatedProgress] = useState(0);

  useEffect(() => {
    if (progress !== undefined) {
      setEstimatedProgress(progress);
      return;
    }
    let frame: number;
    let start: number | null = null;
    const duration = 4200;

    const tick = (timestamp: number) => {
      if (start === null) start = timestamp;
      const elapsed = timestamp - start;
      const next = Math.min(92, (elapsed / duration) * 92 + Math.sin(elapsed / 280) * 2);
      setEstimatedProgress(next);
      if (next < 92) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [progress]);

  const displayProgress = progress ?? estimatedProgress;

  return (
    <motion.div
      className={cn(
        'premium-loader-shell flex w-full items-center justify-center',
        compact ? 'min-h-[12rem]' : 'min-h-[calc(100vh-9rem)]',
        className
      )}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.98, y: 8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, y: -4 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      onAnimationComplete={onFadeComplete}
      role="status"
      aria-live="polite"
      aria-label={`${message}. Loading ${Math.round(displayProgress)} percent`}
    >
      <div className="premium-loader-card relative">
        <FloatingParticles reducedMotion={!!reducedMotion} />
        <div className="premium-loader-glow" aria-hidden="true" />

        <motion.div
          className="premium-loader-mark"
          aria-hidden="true"
          animate={reducedMotion ? undefined : { y: [0, -3, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <div className="premium-loader-orbit premium-loader-orbit-outer">
            <span />
          </div>
          <div className="premium-loader-orbit premium-loader-orbit-inner">
            <span />
          </div>
          <div className="premium-loader-core">
            <div className="premium-loader-core-shine" />
            <span>S</span>
          </div>
        </motion.div>

        <div className="relative text-center">
          <p className="premium-loader-title">Skymap QMS</p>
          <div className="premium-loader-message">
            <span>{message}</span>
            <span className="premium-loader-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        </div>

        {showProgress && (
          <div className="w-full max-w-[8.5rem] mx-auto space-y-1">
            <div className="h-1 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500 shadow-[0_0_10px_rgba(79,70,229,0.45)]"
                initial={false}
                animate={{ width: `${Math.max(8, displayProgress)}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
            <p className="text-center text-[0.6875rem] tabular-nums text-muted-foreground">
              {Math.round(displayProgress)}%
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function FullPageLoader(props: Omit<PremiumFullScreenLoaderProps, 'compact'>) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background/80 backdrop-blur-xl">
      <PremiumFullScreenLoader {...props} />
    </div>
  );
}

export function GlobalLoader({
  visible,
  message,
  progress,
}: {
  visible: boolean;
  message?: string;
  progress?: number;
}) {
  if (!visible) return null;
  return (
    <div
      className="premium-loader-overlay is-visible"
      aria-hidden={!visible}
    >
      <PremiumFullScreenLoader compact message={message} progress={progress} />
    </div>
  );
}

export function PageLoader({ message, className }: { message?: string; className?: string }) {
  return <PremiumFullScreenLoader message={message} compact className={className} />;
}

export function SectionLoader({
  variant = 'dashboard',
  className,
}: {
  variant?: 'dashboard' | 'table' | 'form' | 'chart' | 'list';
  className?: string;
}) {
  // Lazy import avoided — skeletons are lightweight and tree-shaken per route loader.
  const content = {
    dashboard: <DashboardSkeleton />,
    table: <TableSkeleton />,
    form: <FormSkeleton />,
    chart: <ChartSkeleton />,
    list: <ListSkeleton />,
  }[variant];

  return <div className={cn('animate-in', className)}>{content}</div>;
}

export function DialogLoader({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10" role="status">
      <div className="premium-loader-orbit premium-loader-orbit-outer h-12 w-12 relative">
        <span />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

export function ProgressLoader({
  value,
  label,
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      {label && <p className="text-sm text-muted-foreground">{label}</p>}
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500"
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground text-right">{Math.round(value)}%</p>
    </div>
  );
}

export function UploadLoader({
  progress,
  fileName,
  speed,
  remaining,
  className,
}: {
  progress: number;
  fileName?: string;
  speed?: string;
  remaining?: string;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border bg-card p-4 space-y-3', className)} role="status">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium truncate">{fileName ?? 'Uploading file...'}</p>
        <span className="text-xs tabular-nums text-muted-foreground">{Math.round(progress)}%</span>
      </div>
      <ProgressLoader value={progress} />
      {(speed || remaining) && (
        <div className="flex justify-between text-xs text-muted-foreground">
          {speed && <span>{speed}</span>}
          {remaining && <span>{remaining} remaining</span>}
        </div>
      )}
    </div>
  );
}
