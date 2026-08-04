'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Loader2,
  KeyRound,
  Mail,
  Lock,
  HelpCircle,
} from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/contexts/auth-context';
import { isFirebaseConfigured } from '@/lib/firebase-config';

const REMEMBER_KEY = 'skymap-login-remember';

const schema = z.object({
  email: z
    .string()
    .min(1, 'Username is required')
    .email('Enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  rememberMe: z.boolean().default(false),
});

type FormData = z.infer<typeof schema>;

function SkymapLogo() {
  return (
    <div className="mx-auto flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl shadow-lg shadow-blue-600/25">
      <Image
        src="/logo-1.png"
        alt="Skymap Pharmaceuticals"
        width={64}
        height={64}
        className="h-16 w-16 object-contain"
        priority
      />
    </div>
  );
}

function RippleLoginButton({
  loading,
  disabled,
}: {
  loading: boolean;
  disabled: boolean;
}) {
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!btnRef.current || loading || disabled) return;
    const rect = btnRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();
    setRipples((prev) => [...prev, { id, x, y }]);
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 600);
  };

  return (
    <Button
      ref={btnRef}
      type="submit"
      disabled={loading || disabled}
      onClick={handleClick}
      className="relative h-12 w-full overflow-hidden rounded-xl bg-gradient-to-r from-blue-600 to-blue-700 text-base font-semibold text-white shadow-lg shadow-blue-600/30 transition-all duration-200 hover:from-blue-500 hover:to-blue-600 hover:shadow-blue-500/40 disabled:opacity-60"
    >
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="pointer-events-none absolute animate-ping rounded-full bg-white/30"
          style={{
            left: ripple.x - 10,
            top: ripple.y - 10,
            width: 20,
            height: 20,
            animationDuration: '0.6s',
            animationIterationCount: 1,
          }}
        />
      ))}
      {loading ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Signing in...
        </>
      ) : (
        'Login'
      )}
    </Button>
  );
}

export function LoginFormPanel() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const firebaseReady = isFirebaseConfigured();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { rememberMe: false },
  });

  const rememberMe = watch('rememberMe');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_KEY);
      if (saved) {
        setValue('email', saved);
        setValue('rememberMe', true);
      }
    } catch {
      /* ignore */
    }
  }, [setValue]);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      if (data.rememberMe) {
        localStorage.setItem(REMEMBER_KEY, data.email);
      } else {
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {
      /* ignore */
    }

    const { error } = await signIn(data.email, data.password);
    if (error) {
      toast.error('Authentication failed', { description: error.message });
      setLoading(false);
    } else {
      toast.success('Welcome back!', { description: 'Opening module launcher...' });
      const redirectTo = searchParams.get('redirect') || '/launcher';
      router.push(redirectTo);
    }
  };

  const handleSsoLogin = () => {
    toast.info('SSO Login', {
      description: 'Single Sign-On integration is not yet configured. Contact your administrator.',
    });
  };

  return (
    <div className="flex flex-1 items-center justify-center bg-gradient-to-br from-slate-50 via-white to-blue-50/40 px-4 py-8 md:px-8 md:w-full lg:w-[40%] lg:py-12 xl:w-[35%]">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="w-full max-w-[420px]"
      >
        <div className="rounded-[24px] border border-white/60 bg-white/70 p-8 shadow-[0_8px_40px_rgba(15,23,42,0.08)] backdrop-blur-2xl md:p-10">
          <div className="mb-8 text-center">
            <SkymapLogo />
            <h2 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
              Welcome Back
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">Sign in to continue</p>
          </div>

          {!firebaseReady && (
            <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              Firebase is not configured. Add{' '}
              <code className="rounded bg-amber-100 px-1">NEXT_PUBLIC_FIREBASE_*</code>{' '}
              environment variables to enable authentication.
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium text-slate-700">
                Username
              </Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="email"
                  {...register('email')}
                  type="email"
                  placeholder="username@company.com"
                  autoComplete="username"
                  disabled={!firebaseReady}
                  className="h-12 rounded-xl border-slate-200 bg-white/80 pl-10 transition-all duration-200 focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] focus:ring-blue-500/30"
                />
              </div>
              {errors.email && (
                <p className="text-xs text-red-500">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm font-medium text-slate-700">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="password"
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  disabled={!firebaseReady}
                  className="h-12 rounded-xl border-slate-200 bg-white/80 pl-10 pr-11 transition-all duration-200 focus:border-blue-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.15)] focus:ring-blue-500/30"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:text-slate-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className="text-xs text-red-500">{errors.password.message}</p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="rememberMe"
                  checked={rememberMe}
                  onCheckedChange={(checked) =>
                    setValue('rememberMe', checked === true)
                  }
                  className="border-slate-300 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600"
                />
                <Label
                  htmlFor="rememberMe"
                  className="cursor-pointer text-sm font-normal text-slate-600"
                >
                  Remember Me
                </Label>
              </div>
              <Link
                href="/auth/forgot-password"
                className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700"
              >
                Forgot Password
              </Link>
            </div>

            <RippleLoginButton loading={loading} disabled={!firebaseReady} />

            <Button
              type="button"
              variant="outline"
              disabled={!firebaseReady}
              onClick={handleSsoLogin}
              className="h-12 w-full rounded-xl border-slate-200 bg-white/60 text-slate-700 transition-all duration-200 hover:border-blue-200 hover:bg-blue-50/50 hover:text-blue-700"
            >
              <KeyRound className="mr-2 h-4 w-4" />
              SSO Login
            </Button>
          </form>

          <div className="relative my-7">
            <Separator className="bg-slate-200" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white/80 px-3 text-xs font-medium uppercase tracking-wider text-slate-400">
              OR
            </span>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-4 text-center">
            <div className="mb-1 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-700">
              <HelpCircle className="h-4 w-4 text-blue-500" />
              Need Help?
            </div>
            <a
              href="mailto:admin@skymap-pharma.com?subject=SKYMAP%20QMS%20Access%20Request"
              className="text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 hover:underline"
            >
              Contact Administrator
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400 md:hidden">
          Version 2.0 &middot; &copy; 2026 SKYMAP Pharmaceuticals
        </p>
      </motion.div>
    </div>
  );
}
