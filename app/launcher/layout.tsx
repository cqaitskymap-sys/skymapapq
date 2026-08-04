import { LauncherShell } from '@/components/layout/LauncherShell';

export default function LauncherLayout({ children }: { children: React.ReactNode }) {
  return <LauncherShell>{children}</LauncherShell>;
}
