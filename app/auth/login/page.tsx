'use client';

import { Suspense } from 'react';
import { LoginHeroPanel, LoginMobileHeader } from '@/components/auth/login/login-hero-panel';
import { LoginFormPanel } from '@/components/auth/login/login-form-panel';

function LoginPageContent() {
  return (
    <div className="flex min-h-dvh flex-col bg-white lg:flex-row">
      <LoginMobileHeader />
      <LoginHeroPanel />
      <Suspense fallback={null}>
        <LoginFormPanel />
      </Suspense>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50/40">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
            <p className="text-sm text-slate-500">Loading SKYMAP QMS...</p>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
