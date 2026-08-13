'use client';

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  XCircle,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner } from 'sonner';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      position="top-right"
      expand
      closeButton
      visibleToasts={5}
      duration={4200}
      gap={14}
      offset={16}
      icons={{
        success: <CheckCircle2 className="size-5 shrink-0" strokeWidth={2.25} />,
        error: <XCircle className="size-5 shrink-0" strokeWidth={2.25} />,
        warning: <AlertTriangle className="size-5 shrink-0" strokeWidth={2.25} />,
        info: <Info className="size-5 shrink-0" strokeWidth={2.25} />,
        loading: <Loader2 className="size-5 shrink-0 animate-spin" strokeWidth={2.25} />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group toast skymap-toast group-[.toaster]:pointer-events-auto',
          title: 'skymap-toast-title',
          description: 'skymap-toast-description',
          actionButton: 'skymap-toast-action',
          cancelButton: 'skymap-toast-cancel',
          closeButton: 'skymap-toast-close',
          success: 'skymap-toast-success',
          error: 'skymap-toast-error',
          warning: 'skymap-toast-warning',
          info: 'skymap-toast-info',
          loading: 'skymap-toast-loading',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
