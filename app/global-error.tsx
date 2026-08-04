'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global application error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
            <p className="text-slate-600 text-sm">
              A critical error occurred. Please try again or reload the page.
            </p>
            {process.env.NODE_ENV === 'development' && error.message ? (
              <p className="text-xs text-slate-500 bg-slate-100 p-3 rounded-lg font-mono break-all">
                {error.message}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
