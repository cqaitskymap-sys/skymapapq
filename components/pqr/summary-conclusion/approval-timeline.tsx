'use client';

import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import type { PqrSummaryStatus } from '@/lib/pqr-summary-conclusion-records';

/** Honest single-track workflow — no fake multi-level QA steps all keyed to Approved. */
const STEPS: Array<{ key: PqrSummaryStatus; label: string }> = [
  { key: 'Draft', label: 'Draft' },
  { key: 'Generated', label: 'Generated' },
  { key: 'Under Review', label: 'Under Review' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Archived', label: 'Archived' },
];

function stepIndex(status: string): number {
  if (status === 'Draft') return 0;
  if (status === 'Generated') return 1;
  if (status === 'Under Review') return 2;
  if (status === 'Rejected') return 2;
  if (status === 'Approved') return 3;
  if (status === 'Archived') return 4;
  return 0;
}

export function ApprovalTimeline({
  status,
  approvalDate,
  reviewedBy,
  approvedBy,
}: {
  status: string;
  approvalDate?: string;
  reviewedBy?: string;
  approvedBy?: string;
}) {
  const current = stepIndex(status);
  const rejected = status === 'Rejected';

  return (
    <ol className="relative space-y-0 border-l border-slate-200 pl-6">
      {STEPS.map((step, i) => {
        const done =
          i < current
          || (status === 'Approved' && i <= 3)
          || (status === 'Archived' && i <= 4);
        const active = i === current && !rejected;
        const failed = rejected && i === 2;
        return (
          <li key={step.key} className="relative pb-6 last:pb-0">
            <span className={`absolute -left-[1.65rem] top-0.5 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-white ${
              failed
                ? 'border-red-500 text-red-500'
                : done
                  ? 'border-green-600 text-green-600'
                  : active
                    ? 'border-blue-600 text-blue-600'
                    : 'border-slate-300 text-slate-300'
            }`}>
              {failed ? <XCircle className="h-4 w-4" /> : done ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-3 w-3" />}
            </span>
            <div className="rounded-md border bg-white p-3 text-sm shadow-sm">
              <p className="font-medium">{failed ? 'Rejected' : step.label}</p>
              {i === 2 && reviewedBy && !failed && (
                <p className="text-xs text-muted-foreground">Reviewer: {reviewedBy}</p>
              )}
              {failed && reviewedBy && (
                <p className="text-xs text-muted-foreground">Reviewer: {reviewedBy}</p>
              )}
              {i === 3 && approvedBy && (status === 'Approved' || status === 'Archived') && (
                <p className="text-xs text-muted-foreground">Approver: {approvedBy}</p>
              )}
              {i === 3 && approvalDate && (status === 'Approved' || status === 'Archived') && (
                <p className="text-xs text-muted-foreground">Date: {approvalDate}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
