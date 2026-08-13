import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/auth-context';
import { LoadingProvider } from '@/contexts/loading-context';
import { QueryProvider } from '@/providers/query-provider';
import { AuthLoadingBridge } from '@/components/loading/auth-loading-bridge';
import { FirebaseSetupBanner } from '@/components/layout/firebase-setup-banner';
import { SystemSettingsProvider } from '@/contexts/system-settings-context';
import { MaintenanceBanner } from '@/components/layout/maintenance-banner';
import { MaintenanceGuard } from '@/components/layout/maintenance-guard';

export const metadata: Metadata = {
  title: 'Skymap QMS — Enterprise Quality Management System',
  description: 'Skymap Pharmaceuticals QMS — GMP, FDA, WHO compliant. Built by Satyajit Patri.',
  icons: {
    icon: '/logo-1.png',
    apple: '/logo-1.png',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          <LoadingProvider>
            <QueryProvider>
              <AuthProvider>
                <AuthLoadingBridge />
                <SystemSettingsProvider>
                  <FirebaseSetupBanner />
                  <MaintenanceBanner />
                  <MaintenanceGuard>
                    <Suspense fallback={null}>
                      {children}
                    </Suspense>
                  </MaintenanceGuard>
                  <Toaster />
                </SystemSettingsProvider>
              </AuthProvider>
            </QueryProvider>
          </LoadingProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
