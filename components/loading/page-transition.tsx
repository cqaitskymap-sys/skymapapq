'use client';

import { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
  /** @deprecated variant is ignored; kept for call-site compatibility */
  variant?: 'fade' | 'scale' | 'slide' | 'blur';
  routeKey?: string;
}

/**
 * Route content wrapper. Avoid AnimatePresence `mode="wait"` here — it left the main
 * panel empty when switching between sibling routes (e.g. Material ↔ Vendor Master).
 */
export function PageTransition({
  children,
  className,
  routeKey,
}: PageTransitionProps) {
  const reducedMotion = useReducedMotion();

  if (reducedMotion) {
    return (
      <div key={routeKey} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      key={routeKey}
      className={cn('min-h-full', className)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

interface StaggerContainerProps {
  children: ReactNode;
  className?: string;
  stagger?: number;
}

export function StaggerContainer({ children, className, stagger = 0.06 }: StaggerContainerProps) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: stagger } },
      }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 10 },
        visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } },
      }}
    >
      {children}
    </motion.div>
  );
}
