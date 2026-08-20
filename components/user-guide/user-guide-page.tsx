'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Compass, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  GUIDE_GROUPS,
  USER_GUIDE_TOPICS,
  type GuideGroup,
  type UserGuideTopic,
} from '@/lib/user-guide';
import { GuideSteps } from '@/components/user-guide/guide-steps';

export function UserGuidePage() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GuideGroup | 'all'>('all');
  const [selectedId, setSelectedId] = useState('getting-started');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return USER_GUIDE_TOPICS.filter((topic) => {
      if (group !== 'all' && topic.group !== group) return false;
      if (!q) return true;
      const blob = [
        topic.title,
        topic.summary,
        topic.who,
        topic.whatNext,
        ...topic.steps.map((s) => `${s.title} ${s.detail}`),
      ].join(' ').toLowerCase();
      return blob.includes(q);
    });
  }, [query, group]);

  const selected: UserGuideTopic =
    filtered.find((t) => t.id === selectedId) || filtered[0] || USER_GUIDE_TOPICS[0];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="rounded-2xl border bg-gradient-to-br from-[#2563EB]/8 via-background to-sky-50 p-6 dark:from-[#2563EB]/15 dark:to-background">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium text-[#2563EB]">
              <Compass className="h-4 w-4" />
              In-app user guide
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">How to use SKYMAP</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Every module, in order: what to open, how to complete it, and what happens next.
              On any form, tap <span className="font-medium text-foreground">Ask / How to use</span>,
              click a field, and ask why it appeared or what to enter.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/launcher">Back to launcher</Link>
          </Button>
        </div>
        <div className="relative mt-5 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules or steps…"
            className="pl-9"
            aria-label="Search user guide"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <FilterChip active={group === 'all'} onClick={() => setGroup('all')}>
          All
        </FilterChip>
        {GUIDE_GROUPS.map((g) => (
          <FilterChip key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
            {g.label}
          </FilterChip>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Modules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 p-2 pt-0">
            {filtered.map((topic) => (
              <button
                key={topic.id}
                type="button"
                onClick={() => setSelectedId(topic.id)}
                className={cn(
                  'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  selected.id === topic.id
                    ? 'bg-[#2563EB] text-white'
                    : 'hover:bg-muted',
                )}
              >
                <span className="block font-medium">{topic.title}</span>
                <span
                  className={cn(
                    'mt-0.5 block text-xs',
                    selected.id === topic.id ? 'text-white/80' : 'text-muted-foreground',
                  )}
                >
                  {topic.steps.length} steps
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">No matching modules.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{GUIDE_GROUPS.find((g) => g.id === selected.group)?.label}</Badge>
              <Badge variant="outline">{selected.steps.length} steps</Badge>
            </div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <BookOpen className="h-5 w-5 text-[#2563EB]" />
              {selected.title}
            </CardTitle>
            <p className="text-sm text-muted-foreground">{selected.summary}</p>
            <p className="text-sm"><span className="font-medium">Who:</span> {selected.who}</p>
            <Button asChild size="sm" className="w-fit">
              <Link href={selected.href}>Open this module</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <GuideSteps steps={selected.steps} activeIndex={0} whatNext={selected.whatNext} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-[#2563EB] bg-[#2563EB] text-white'
          : 'border-border bg-background text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
