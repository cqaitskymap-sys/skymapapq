'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { FIREBASE_STATUS_SECTIONS } from '@/lib/admin/firebase-status-service';

export function FirebaseStatusSubnav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b pb-2" aria-label="Firebase Status sections">
      {FIREBASE_STATUS_SECTIONS.map((section) => {
        const active = pathname === section.href
          || (section.id === 'dashboard' && pathname === '/admin/firebase-status');
        return (
          <Link
            key={section.id}
            href={section.href}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-blue-600 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
