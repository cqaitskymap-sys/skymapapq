'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircleQuestion, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { askGuideQuestion } from '@/lib/ai/client';
import {
  collectScreenFields,
  resolveFieldFromElement,
  type ScreenField,
} from '@/lib/user-guide-fields';

type ChatMsg = { role: 'user' | 'assistant'; content: string };

const QUICK_PROMPTS = [
  { id: 'why', label: 'Why is this field shown?', build: (f: string) => `Why is the "${f}" field shown on this screen?` },
  { id: 'what', label: 'What should I enter?', build: (f: string) => `What should I select or type in the "${f}" field? Give a brief example.` },
  { id: 'next', label: 'What happens next?', build: () => 'After I save or submit this screen, what happens next?' },
];

export function GuideAskPanel({
  pathname,
  enabled,
}: {
  pathname: string;
  enabled: boolean;
}) {
  const [fields, setFields] = useState<ScreenField[]>([]);
  const [focused, setFocused] = useState<string>('');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    setFields(collectScreenFields());
    const timer = window.setTimeout(() => setFields(collectScreenFields()), 400);
    return () => window.clearTimeout(timer);
  }, [enabled, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const onFocus = (event: FocusEvent) => {
      const field = resolveFieldFromElement(event.target);
      if (field) setFocused(field.label);
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, [enabled]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const chips = useMemo(() => fields.slice(0, 12), [fields]);

  const ask = async (text: string, fieldName = focused) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = messages.slice(-6);
    setQuestion('');
    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setBusy(true);
    const result = await askGuideQuestion({
      question: q,
      pathname,
      focusedField: fieldName,
      fields,
      history,
    });
    setMessages((prev) => [...prev, { role: 'assistant', content: result.text }]);
    setBusy(false);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void ask(question);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b px-5 py-3">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          Click a field to ask
        </p>
        {focused ? (
          <p className="rounded-lg bg-[#2563EB]/10 px-2.5 py-1.5 text-xs text-[#1d4ed8] dark:text-blue-300">
            Selected field: <span className="font-semibold">{focused}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Click a form field, then ask below — for example “Why is this shown?” or “What should I enter?”
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((prompt) => (
            <Button
              key={prompt.id}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={busy || (prompt.id !== 'next' && !focused)}
              onClick={() => void ask(prompt.build(focused), focused)}
            >
              {prompt.label}
            </Button>
          ))}
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {chips.map((field) => (
              <button
                key={field.label}
                type="button"
                onClick={() => setFocused(field.label)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[11px]',
                  focused === field.label
                    ? 'border-[#2563EB] bg-[#2563EB] text-white'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {field.label}{field.required ? ' *' : ''}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
            Example: <span className="italic">“Why is Batch Number required?”</span>
            {' '}or{' '}
            <span className="italic">“What should I enter in Root cause?”</span>
          </div>
        )}
        {messages.map((msg, index) => (
          <div
            key={`${msg.role}-${index}`}
            className={cn(
              'whitespace-pre-wrap rounded-xl px-3 py-2 text-sm',
              msg.role === 'user'
                ? 'ml-6 bg-[#2563EB] text-white'
                : 'mr-4 border bg-muted/60',
            )}
          >
            {msg.role === 'assistant' && (
              <Sparkles className="mb-1 inline h-3 w-3 text-[#2563EB]" />
            )}
            {msg.content}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Answering…
          </p>
        )}
      </div>

      <form onSubmit={submit} className="border-t p-3">
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={focused ? `Ask about "${focused}"…` : 'Type your question…'}
          rows={2}
          maxLength={500}
          className="resize-none text-sm"
        />
        <div className="mt-2 flex justify-end">
          <Button type="submit" size="sm" disabled={busy || !question.trim()}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Ask
          </Button>
        </div>
      </form>
    </div>
  );
}
