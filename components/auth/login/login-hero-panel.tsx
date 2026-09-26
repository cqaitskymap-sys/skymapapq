'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  FileCheck,
  ClipboardCheck,
  Sparkles,
  TrendingUp,
  Users,
  FileText,
  AlertCircle,
} from 'lucide-react';

const HERO_BG =
  'https://images.unsplash.com/photo-1532187863486-abf9dbad1b69?auto=format&fit=crop&w=2400&q=80';

const FEATURES = [
  { icon: ShieldCheck, label: 'GMP Compliant' },
  { icon: FileCheck, label: '21 CFR Part 11 Ready' },
  { icon: ClipboardCheck, label: 'Audit Trail & e-Signatures' },
  { icon: Sparkles, label: 'AI Powered Analytics' },
] as const;

const FLOATING_STATS = [
  {
    icon: TrendingUp,
    value: '98.7%',
    label: 'Compliance Score',
    className: 'top-[18%] right-[8%] animate-float-gentle',
    delay: 0,
  },
  {
    icon: Users,
    value: '150+',
    label: 'Active Users',
    className: 'top-[42%] right-[18%] animate-float-gentle-delayed',
    delay: 0.2,
  },
  {
    icon: FileText,
    value: '1250+',
    label: 'Documents',
    className: 'bottom-[32%] right-[6%] animate-float-gentle',
    delay: 0.4,
  },
  {
    icon: AlertCircle,
    value: '45',
    label: 'Open CAPAs',
    className: 'bottom-[18%] right-[22%] animate-float-gentle-delayed',
    delay: 0.6,
  },
] as const;

function FloatingStatCard({
  icon: Icon,
  value,
  label,
  className,
}: {
  icon: typeof TrendingUp;
  value: string;
  label: string;
  className: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={false}
      className={`absolute hidden lg:block ${className}`}
    >
      <div className="group rounded-2xl border border-white/20 bg-white/10 px-4 py-3 shadow-xl backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/30 hover:bg-white/15 hover:shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/30">
            <Icon className="h-4 w-4 text-blue-100" />
          </div>
          <div>
            <p className="text-lg font-bold leading-none text-white">{value}</p>
            <p className="mt-1 text-xs text-blue-100/80">{label}</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function LoginHeroPanel() {
  return (
    <div className="relative hidden min-h-screen flex-col overflow-hidden lg:flex lg:w-[60%] xl:w-[65%]">
      {/* Background with slow zoom */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-0 scale-110 animate-slow-zoom bg-cover bg-center"
          style={{ backgroundImage: `url('${HERO_BG}')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/90 via-blue-900/85 to-slate-950/90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(59,130,246,0.15),transparent_50%)]" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-1 flex-col justify-between p-8 lg:p-12">
        <motion.div
          initial={false}
          className="max-w-2xl"
        >
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white/10 backdrop-blur-sm">
              {/* Native img avoids next/image fetchPriority hydration mismatches on this SSR'd client page. */}
              <img
                src="/logo-1.png"
                alt="Skymap Pharmaceuticals"
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
              />
            </div>
            <span className="text-sm font-medium tracking-widest text-blue-200/80 uppercase">
              Enterprise Platform
            </span>
          </div>

          <h1 className="text-4xl font-bold tracking-tight text-white lg:text-5xl">
            SKYMAP QMS
          </h1>
          <p className="mt-2 text-xl font-medium text-blue-200">
            Quality Management System
          </p>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-blue-100/90">
            &ldquo;Ensuring GMP Compliance, Quality Excellence, and Digital Transformation for
            Pharmaceutical Manufacturing.&rdquo;
          </p>
        </motion.div>

        {/* Feature cards */}
        <motion.div
          initial={false}
          className="mt-8 hidden grid-cols-2 gap-3 lg:grid xl:grid-cols-4"
        >
          {FEATURES.map(({ icon: Icon, label }) => (
            <motion.div
              key={label}
              whileHover={{ y: -4, scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="group rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl transition-shadow duration-300 hover:border-white/25 hover:bg-white/15 hover:shadow-xl"
            >
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 transition-colors group-hover:bg-emerald-500/30">
                <Icon className="h-4 w-4 text-emerald-300" />
              </div>
              <p className="text-sm font-semibold text-white">{label}</p>
            </motion.div>
          ))}
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={false}
          className="mt-8 hidden text-xs text-blue-200/60 lg:block"
        >
          <p className="font-medium text-blue-200/80">Version 2.0</p>
          <p className="mt-1">&copy; 2026 SKYMAP Pharmaceuticals</p>
          <p className="mt-1">Developed by Satyajit Patri from Odisha</p>
        </motion.div>
      </div>

      {/* Floating stat cards */}
      <div className="pointer-events-none absolute inset-0 z-20">
        {FLOATING_STATS.map((stat) => (
          <FloatingStatCard key={stat.label} {...stat} />
        ))}
      </div>
    </div>
  );
}

export function LoginMobileHeader() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative h-36 overflow-hidden lg:hidden">
      {mounted ? (
        <>
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center blur-sm"
            style={{ backgroundImage: `url('${HERO_BG}')` }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-blue-950/80 to-blue-900/90" />
          <div className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
            <img
              src="/logo-1.png"
              alt="Skymap Pharmaceuticals"
              width={48}
              height={48}
              className="mb-2 h-12 w-12 rounded-xl object-contain"
            />
            <h1 className="text-xl font-bold tracking-tight text-white">SKYMAP QMS</h1>
            <p className="mt-1 text-xs text-blue-200/80">Quality Management System</p>
          </div>
        </>
      ) : (
        <div className="h-full bg-blue-950" />
      )}
    </div>
  );
}
