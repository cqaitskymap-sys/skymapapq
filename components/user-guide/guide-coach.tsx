'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CircleHelp, ListOrdered, MessageCircleQuestion, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  GUIDE_OPEN_EVENT,
  GUIDE_SEEN_KEY,
  matchGuideStepIndex,
  matchGuideTopic,
} from '@/lib/user-guide';
import { GuideSteps } from '@/components/user-guide/guide-steps';
import { GuideAskPanel } from '@/components/user-guide/guide-ask-panel';

export function GuideCoach({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [tab, setTab] = useState<'steps' | 'ask'>('ask');

  const topic = useMemo(() => matchGuideTopic(pathname), [pathname]);
  const activeIndex = useMemo(
    () => matchGuideStepIndex(topic, pathname),
    [topic, pathname],
  );

  useEffect(() => {
    try {
      setUnseen(!window.localStorage.getItem(GUIDE_SEEN_KEY));
    } catch {
      setUnseen(false);
    }
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setTab('ask');
      setOpen(true);
    };
    window.addEventListener(GUIDE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(GUIDE_OPEN_EVENT, onOpen);
  }, []);

  const markSeen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      try {
        window.localStorage.setItem(GUIDE_SEEN_KEY, '1');
      } catch {
        /* ignore */
      }
      setUnseen(false);
    }
  };

  if (hidden || pathname.startsWith('/auth')) return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => {
            setTab('ask');
            markSeen(true);
          }}
          className={cn(
            'fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full bg-[#2563EB] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-[#2563EB]/30 transition hover:bg-[#1d4ed8]',
            'focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2',
          )}
          aria-label="Ask about this screen"
        >
          <CircleHelp className="h-5 w-5" />
          <span className="hidden sm:inline">Ask / How to use</span>
          {unseen && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white" />
          )}
        </button>
      )}

      {open && (
        <aside
          data-guide-coach="true"
          className="fixed bottom-0 right-0 z-40 flex h-[58dvh] w-full flex-col border-t bg-background shadow-2xl sm:bottom-4 sm:right-4 sm:h-[min(88dvh,700px)] sm:w-[420px] sm:rounded-2xl sm:border sm:border-t"
        >
          <div className="border-b px-5 py-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#2563EB]" />
                  <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                    In-app coach
                  </Badge>
                </div>
                <h2 className="mt-1 text-base font-semibold leading-tight">{topic.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{topic.summary}</p>
              </div>
              <button
                type="button"
                onClick={() => markSeen(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close guide"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1 border-b p-2">
            <button
              type="button"
              onClick={() => setTab('ask')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium',
                tab === 'ask' ? 'bg-[#2563EB] text-white' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <MessageCircleQuestion className="h-4 w-4" />
              Ask
            </button>
            <button
              type="button"
              onClick={() => setTab('steps')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-medium',
                tab === 'steps' ? 'bg-[#2563EB] text-white' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <ListOrdered className="h-4 w-4" />
              Steps
            </button>
          </div>

          {tab === 'ask' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <GuideAskPanel pathname={pathname} enabled={open && tab === 'ask'} />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1 px-5 py-4">
              <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                You are on step {activeIndex + 1} of {topic.steps.length}
              </p>
              <GuideSteps
                steps={topic.steps}
                activeIndex={activeIndex}
                whatNext={topic.whatNext}
                compact
              />
            </ScrollArea>
          )}

          <div className="flex gap-2 border-t p-4">
            <Button asChild className="flex-1">
              <Link href="/dashboard/help">
                <BookOpen className="mr-2 h-4 w-4" />
                Full A–Z guide
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={topic.href}>Open module</Link>
            </Button>
          </div>
        </aside>
      )}
    </>
  );
}
