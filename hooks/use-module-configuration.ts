'use client';

import { useEffect, useState } from 'react';
import type { ModuleConfig } from '@/lib/admin/schemas';
import {
  subscribeToModuleConfigurations,
  isPathAllowedByModuleConfig,
  isModuleConfigActive,
} from '@/lib/admin/module-configuration-service';

/**
 * Subscribes to module_configuration for sidebar/route consumers.
 * Empty catalog = fail-open (do not hide navigation).
 */
export function useModuleConfigurationCatalog() {
  const [modules, setModules] = useState<ModuleConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToModuleConfigurations(
      (rows) => {
        setModules(rows);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return () => unsub();
  }, []);

  return {
    modules,
    loading,
    isPathAllowed: (pathname: string) => isPathAllowedByModuleConfig(pathname, modules),
    isModuleEnabled: (code: string) => {
      if (!modules.length) return true;
      const row = modules.find((m) => m.moduleCode.toUpperCase() === code.toUpperCase());
      if (!row) return true;
      return isModuleConfigActive(row);
    },
  };
}
