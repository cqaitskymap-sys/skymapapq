'use client';

import { ModuleCard } from '@/components/launcher/ModuleCard';
import type { LauncherModule } from '@/lib/launcher/module-definitions';

interface ModuleGridProps {
  modules: LauncherModule[];
  onModuleOpen?: (moduleId: string) => void;
}

export function ModuleGrid({ modules, onModuleOpen }: ModuleGridProps) {
  if (!modules.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-muted/20 py-16 text-center">
        <p className="text-sm font-medium text-muted-foreground">No modules match your search</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Try a different keyword</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
      {modules.map((module, index) => (
        <div key={module.id} className="mx-auto h-full w-full max-w-[320px] sm:max-w-none">
          <ModuleCard module={module} index={index} onOpen={onModuleOpen} />
        </div>
      ))}
    </div>
  );
}
