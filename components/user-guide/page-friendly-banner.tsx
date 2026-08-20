'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, ChevronUp, Compass, MessageCircleQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  BANNER_COLLAPSED_KEY,
  GUIDE_SEEN_KEY,
  matchGuideStepIndex,
  matchGuideTopic,
  requestOpenUserGuide,
} from '@/lib/user-guide';

const HIDDEN_PREFIXES = ['/auth', '/dashboard/help', '/launcher'];

export function PageFriendlyBanner({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname() || '/';
  const [collapsed, setCollapsed] = useState(true);

  const topic = useMemo(() => matchGuideTopic(pathname), [pathname]);
  const activeIndex = useMemo(
    () => matchGuideStepIndex(topic, pathname),
    [topic, pathname],
  );
  const step = topic.steps[activeIndex] ?? topic.steps[0];

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BANNER_COLLAPSED_KEY);
      if (stored === '0') setCollapsed(false);
      else if (stored === '1') setCollapsed(true);
      else setCollapsed(Boolean(window.localStorage.getItem(GUIDE_SEEN_KEY)));
    } catch {
      setCollapsed(true);
    }
  }, []);

  const persist = (next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(BANNER_COLLAPSED_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  if (hidden || HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return null;
  }

  return (
    <section
      aria-label="How to use this page"
      className="mb-4 overflow-hidden rounded-xl border border-[#2563EB]/20 bg-[#2563EB]/[0.06] shadow-sm dark:bg-[#2563EB]/10"
    >
      <div className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#2563EB]/15 text-[#2563EB]">
          <Compass className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#2563EB]">
            What to do here
          </p>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-foreground">
            {step?.title || topic.title}
          </p>
          {!collapsed && (
            <div className="mt-1.5 space-y-1.5 text-sm text-muted-foreground">
              <p>{step?.detail || topic.summary}</p>
              <p>
                <span className="font-medium text-foreground">Who:</span> {topic.who}
              </p>
              <p>
                <span className="font-medium text-foreground">After this:</span> {topic.whatNext}
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden h-8 px-2 text-xs sm:inline-flex"
            onClick={() => requestOpenUserGuide()}
          >
            <MessageCircleQuestion className="mr-1 h-3.5 w-3.5" />
            Ask
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Show how to use this page' : 'Hide page help'}
            onClick={() => persist(!collapsed)}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div className="flex flex-wrap gap-2 border-t border-[#2563EB]/10 px-3 py-2 sm:px-4">
          <Button type="button" size="sm" className="h-8" onClick={() => requestOpenUserGuide()}>
            Ask about a field
          </Button>
          <Button asChild variant="outline" size="sm" className="h-8">
            <Link href="/dashboard/help">Open A–Z guide</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
