'use client';

import { X, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FORMAT_TOKENS } from '@/lib/admin/constants';
import { parseFormatTokens, buildDocumentNumberPreview } from './document-numbering-api';
import type { DocumentNumberingFormData } from '@/lib/admin/schemas';

interface FormatBuilderProps {
  tokens: string[];
  onChange: (tokens: string[]) => void;
  formValues: Partial<DocumentNumberingFormData>;
  readOnly?: boolean;
}

export function FormatBuilder({ tokens, onChange, formValues, readOnly }: FormatBuilderProps) {
  const available = FORMAT_TOKENS.filter((t) => !tokens.includes(t));

  const preview = buildDocumentNumberPreview({
    ...formValues,
    formatTokens: tokens.join(','),
    documentType: formValues.documentType || '',
    prefix: formValues.prefix || '',
  }, {
    runningNumber: Number(formValues.currentRunningNumber ?? 0) + 1,
  });

  const addToken = (token: string) => {
    if (readOnly) return;
    onChange([...tokens, token]);
  };

  const removeToken = (index: number) => {
    if (readOnly) return;
    onChange(tokens.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <Card className="border-emerald-200 bg-emerald-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-emerald-900">Live Number Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-mono font-semibold text-emerald-800 break-all">{preview || '—'}</p>
          <p className="text-xs text-emerald-700 mt-1">Uses next running number for preview</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Format Builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2 min-h-[40px] p-3 rounded-md border bg-muted/30">
            {tokens.length === 0 && (
              <span className="text-sm text-muted-foreground">Add tokens to build format</span>
            )}
            {tokens.map((token, index) => (
              <Badge key={`${token}-${index}`} variant="secondary" className="gap-1 pr-1 font-mono text-xs">
                {'{'}{token}{'}'}
                {!readOnly && (
                  <button type="button" onClick={() => removeToken(index)} className="ml-1 hover:text-red-600">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </Badge>
            ))}
          </div>

          {!readOnly && available.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Add token</p>
              <div className="flex flex-wrap gap-2">
                {available.map((token) => (
                  <Button
                    key={token}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs font-mono"
                    onClick={() => addToken(token)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {'{'}{token}{'}'}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
