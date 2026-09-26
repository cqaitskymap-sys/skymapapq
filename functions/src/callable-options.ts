/**
 * Options for browser-invoked callable functions.
 *
 * Gen 2 callables sit on Cloud Run. Unauthenticated OPTIONS preflight is
 * rejected (403/500 HTML, no CORS headers) unless Cloud Run invoker is public.
 * Firebase Auth is still enforced inside each handler via request.auth.
 */
export const BROWSER_CALLABLE = {
  cors: true,
  invoker: 'public' as const,
  memory: '512MiB' as const,
};
