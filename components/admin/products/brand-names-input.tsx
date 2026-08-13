'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

function parseBrandNames(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function serializeBrandNames(names: string[]): string {
  return names.join(', ');
}

interface BrandNamesInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function BrandNamesInput({ value, onChange, disabled }: BrandNamesInputProps) {
  const [draft, setDraft] = useState('');
  const names = parseBrandNames(value);

  const addName = () => {
    const next = draft.trim();
    if (!next || disabled) return;
    if (names.some((n) => n.toLowerCase() === next.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange(serializeBrandNames([...names, next]));
    setDraft('');
  };

  const removeName = (name: string) => {
    if (disabled) return;
    onChange(serializeBrandNames(names.filter((n) => n !== name)));
  };

  return (
    <div className="space-y-2">
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {names.map((name) => (
            <Badge key={name} variant="secondary" className="gap-1 pr-1 font-normal">
              {name}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeName(name)}
                  className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
                  aria-label={`Remove ${name}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>
      )}
      {!disabled && (
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addName();
              }
            }}
            placeholder="Type brand name and press Enter"
          />
          <Button type="button" variant="outline" size="icon" onClick={addName} aria-label="Add brand name">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
      {disabled && names.length === 0 && (
        <p className="text-sm text-muted-foreground">—</p>
      )}
    </div>
  );
}

export { parseBrandNames };
