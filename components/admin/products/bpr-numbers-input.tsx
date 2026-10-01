'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function splitBprNumbers(value: string): string[] {
  const parts = value
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [''];
}

export function joinBprNumbers(values: string[]): string {
  return values.map((s) => s.trim()).filter(Boolean).join(', ');
}

interface BprNumbersInputProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function BprNumbersInput({ value, onChange, disabled }: BprNumbersInputProps) {
  const [rows, setRows] = useState<string[]>(() => splitBprNumbers(value));

  useEffect(() => {
    const incoming = joinBprNumbers(splitBprNumbers(value));
    if (joinBprNumbers(rows) !== incoming) {
      setRows(splitBprNumbers(value));
    }
    // Only resync when the saved value changes from outside (edit load / reset).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: string[]) => {
    const safe = next.length > 0 ? next : [''];
    setRows(safe);
    onChange(joinBprNumbers(safe));
  };

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={`bpr-${index}`} className="flex gap-2">
          <Input
            value={row}
            disabled={disabled}
            placeholder={`BPR Number ${index + 1}`}
            onChange={(e) => {
              const next = [...rows];
              next[index] = e.target.value;
              update(next);
            }}
          />
          {!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={rows.length <= 1}
              onClick={() => update(rows.filter((_, i) => i !== index))}
              aria-label={`Remove BPR ${index + 1}`}
            >
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button type="button" variant="outline" size="sm" onClick={() => update([...rows, ''])}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add BPR
        </Button>
      )}
    </div>
  );
}
