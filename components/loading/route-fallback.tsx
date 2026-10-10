import { cn } from '@/lib/utils';

type RouteFallbackVariant = 'dashboard' | 'table' | 'form' | 'list' | 'auth' | 'full';

function BrandedRouteLoader({
  message = 'Loading',
  fullScreen = false,
  className,
}: {
  message?: string;
  fullScreen?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex w-full items-center justify-center',
        fullScreen ? 'min-h-screen bg-background' : 'min-h-[calc(100vh-9rem)]',
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="premium-loader-card">
        <div className="premium-loader-glow" aria-hidden="true" />
        <div className="premium-loader-mark" aria-hidden="true">
          <div className="premium-loader-orbit premium-loader-orbit-outer">
            <span />
          </div>
          <div className="premium-loader-orbit premium-loader-orbit-inner">
            <span />
          </div>
          <div className="premium-loader-core">
            <div className="premium-loader-core-shine" />
            <span>S</span>
          </div>
        </div>
        <div className="relative text-center">
          <p className="premium-loader-title">Skymap QMS</p>
          <p className="premium-loader-message justify-center">
            <span>{message}</span>
            <span className="premium-loader-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export function RouteLoadingFallback({
  variant = 'dashboard',
  className,
}: {
  variant?: RouteFallbackVariant;
  className?: string;
}) {
  const fullScreen = variant === 'auth' || variant === 'full';
  const message = variant === 'auth' ? 'Signing in' : 'Loading';
  return <BrandedRouteLoader message={message} fullScreen={fullScreen} className={className} />;
}
