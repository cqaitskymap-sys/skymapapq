'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/auth-context';
import {
  hasPermission, normalizeRole, canManageRoles, canManagePermissions,
  canDeleteRecords, canChangeSystemSettings, canRestoreBackup,
  canManageUsers, canManageMasterData, isReadOnlyRole, canAccessAdminPanel,
  type AdminModule, type PermissionAction,
} from '@/lib/permissions';
import { resolveUserPermissions } from '@/services/permissionService';
import type { PermissionMatrix } from '@/lib/admin/schemas';

export function useAdminPermissions() {
  const { profile, user } = useAuth();
  const role = normalizeRole(profile?.role);
  const [permissions, setPermissions] = useState<PermissionMatrix | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!profile?.role || !user?.uid) {
        setPermissions(null);
        setLoading(false);
        return;
      }

      try {
        const matrix = await resolveUserPermissions(user.uid, profile.role);
        setPermissions({
          roleId: role,
          roleName: role,
          permissions: matrix,
          status: 'Active',
          createdBy: 'system',
          updatedBy: 'system',
        });
      } catch {
        setPermissions(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [profile?.role, role, user?.uid]);

  return {
    role,
    permissions,
    loading,
    canAccessAdmin: canAccessAdminPanel(profile?.role),
    canManageRoles: canManageRoles(profile?.role),
    canManagePermissions: canManagePermissions(profile?.role),
    canDelete: canDeleteRecords(profile?.role),
    canChangeSystemSettings: canChangeSystemSettings(profile?.role),
    canRestoreBackup: canRestoreBackup(profile?.role),
    canManageUsers: canManageUsers(profile?.role),
    canManageMasterData: canManageMasterData(profile?.role),
    isReadOnly: isReadOnlyRole(profile?.role),
    hasPermission: (module: AdminModule, action: PermissionAction) =>
      hasPermission(permissions, module, action, profile?.role),
  };
}
