'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, CircleHelp, ListOrdered, MessageCircleQuestion, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  GUIDE_FAB_POS_KEY,
  GUIDE_OPEN_EVENT,
  GUIDE_SEEN_KEY,
  matchGuideStepIndex,
  matchGuideTopic,
} from '@/lib/user-guide';
import { GuideSteps } from '@/components/user-guide/guide-steps';
import { GuideAskPanel } from '@/components/user-guide/guide-ask-panel';

const FAB_SIZE = 44;
const FAB_MARGIN = 12;
const DRAG_THRESHOLD_PX = 8;

type FabPos = { x: number; y: number };

function clampFabPosition(x: number, y: number): FabPos {
  if (typeof window === 'undefined') return { x, y };
  const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN);
  const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN);
  return {
    x: Math.min(maxX, Math.max(FAB_MARGIN, x)),
    y: Math.min(maxY, Math.max(FAB_MARGIN, y)),
  };
}

function defaultFabPosition(): FabPos {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return clampFabPosition(
    window.innerWidth - FAB_SIZE - 20,
    window.innerHeight - FAB_SIZE - 20,
  );
}

export function GuideCoach({ hidden = false }: { hidden?: boolean }) {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [tab, setTab] = useState<'steps' | 'ask'>('ask');
  const [pos, setPos] = useState<FabPos | null>(null);
  const [dragging, setDragging] = useState(false);
  const skipClickRef = useRef(false);
  const dragRef = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

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
    const loadPos = () => {
      try {
        const raw = window.localStorage.getItem(GUIDE_FAB_POS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<FabPos>;
          if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
            setPos(clampFabPosition(parsed.x, parsed.y));
            return;
          }
        }
      } catch {
        /* ignore */
      }
      setPos(defaultFabPosition());
    };
    loadPos();
    const onResize = () => setPos((current) => (current ? clampFabPosition(current.x, current.y) : current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onOpen = () => {
      setTab('ask');
      setOpen(true);
    };
    window.addEventListener(GUIDE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(GUIDE_OPEN_EVENT, onOpen);
  }, []);

  const persistPos = (next: FabPos) => {
    const clamped = clampFabPosition(next.x, next.y);
    setPos(clamped);
    try {
      window.localStorage.setItem(GUIDE_FAB_POS_KEY, JSON.stringify(clamped));
    } catch {
      /* ignore */
    }
  };

  const onFabPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const current = pos ?? defaultFabPosition();
    dragRef.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startY: event.clientY,
      origX: current.x,
      origY: current.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onFabPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.active) return;
    const dx = event.clientX - dragRef.current.startX;
    const dy = event.clientY - dragRef.current.startY;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
      dragRef.current.moved = true;
      setDragging(true);
    }
    if (!dragRef.current.moved) return;
    setPos(clampFabPosition(dragRef.current.origX + dx, dragRef.current.origY + dy));
  };

  const onFabPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!dragRef.current.active) return;
    const moved = dragRef.current.moved;
    dragRef.current.active = false;
    setDragging(false);
    if (moved) {
      skipClickRef.current = true;
      persistPos({
        x: dragRef.current.origX + (event.clientX - dragRef.current.startX),
        y: dragRef.current.origY + (event.clientY - dragRef.current.startY),
      });
    }
  };

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
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onPointerCancel={onFabPointerUp}
          onClick={() => {
            if (skipClickRef.current) {
              skipClickRef.current = false;
              return;
            }
            setTab('ask');
            markSeen(true);
          }}
          style={
            pos
              ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
              : undefined
          }
          className={cn(
            'group fixed z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#2563EB] text-white shadow-lg shadow-[#2563EB]/30 transition-[background-color,box-shadow,transform] hover:bg-[#1d4ed8]',
            'touch-none select-none focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:ring-offset-2',
            dragging ? 'cursor-grabbing scale-105' : 'cursor-grab',
            !pos && 'bottom-5 right-5',
          )}
          title="Ask / How to use — drag to move"
          aria-label="Ask / How to use. Drag to move."
        >
          <CircleHelp className="pointer-events-none h-5 w-5" />
          {unseen && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-white" />
          )}
          {!dragging && (
            <span className="pointer-events-none absolute right-full mr-2 hidden whitespace-nowrap rounded-full bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:inline">
              Ask / How to use
            </span>
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
