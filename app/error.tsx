'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <div className="max-w-md w-full text-center space-y-4">
        <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
        <p className="text-muted-foreground text-sm">
          An unexpected error occurred. Please try again or return to the dashboard.
        </p>
        {process.env.NODE_ENV === 'development' && error.message ? (
          <p className="text-xs text-muted-foreground bg-slate-100 p-3 rounded-lg font-mono break-all">
            {error.message}
          </p>
        ) : null}
        <div className="flex gap-3 justify-center">
          <Button onClick={reset} className="bg-blue-600 hover:bg-blue-700">Try Again</Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Go to Dashboard</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
