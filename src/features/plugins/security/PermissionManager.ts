/**
 * Permission Manager
 *
 * Handles permission checking, granting, and enforcement for plugins.
 * Provides a centralized way to verify plugin permissions before
 * allowing access to sensitive APIs.
 */

import type { Permission } from "../types";
import { PERMISSION_INFO } from "../types";
import { usePluginStore } from "../store";

/**
 * Permission dependency map - some permissions imply others
 */
const PERMISSION_DEPENDENCIES: Partial<Record<Permission, Permission[]>> = {
  "editor:write": ["editor:read"],
  "editor:commands": ["editor:read"],
  "clipboard:write": [],
  "storage:book": ["storage:local"],
};

/**
 * Permissions that are considered high risk and require explicit warning
 */
const HIGH_RISK_PERMISSIONS: Permission[] = [
  "network:fetch",
  "editor:write",
  "editor:commands",
  "clipboard:read",
];

/**
 * Permission Manager class
 */
export class PermissionManager {
  private static instance: PermissionManager | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): PermissionManager {
    if (!PermissionManager.instance) {
      PermissionManager.instance = new PermissionManager();
    }
    return PermissionManager.instance;
  }

  /**
   * Check if a plugin has a specific permission
   */
  hasPermission(pluginId: string, permission: Permission): boolean {
    const plugin = usePluginStore.getState().getPlugin(pluginId);
    if (!plugin) return false;

    return plugin.grantedPermissions.includes(permission);
  }

  /**
   * Check if a plugin has all of the specified permissions
   */
  hasAllPermissions(pluginId: string, permissions: Permission[]): boolean {
    return permissions.every((perm) => this.hasPermission(pluginId, perm));
  }

  /**
   * Check if a plugin has any of the specified permissions
   */
  hasAnyPermission(pluginId: string, permissions: Permission[]): boolean {
    return permissions.some((perm) => this.hasPermission(pluginId, perm));
  }

  /**
   * Get all granted permissions for a plugin
   */
  getGrantedPermissions(pluginId: string): Permission[] {
    const plugin = usePluginStore.getState().getPlugin(pluginId);
    return plugin?.grantedPermissions ?? [];
  }

  /**
   * Get missing required permissions for a plugin
   */
  getMissingPermissions(pluginId: string): Permission[] {
    const plugin = usePluginStore.getState().getPlugin(pluginId);
    if (!plugin) return [];

    return plugin.manifest.permissions.filter(
      (perm) => !plugin.grantedPermissions.includes(perm)
    );
  }

  /**
   * Check if all required permissions are granted
   */
  hasAllRequiredPermissions(pluginId: string): boolean {
    return this.getMissingPermissions(pluginId).length === 0;
  }

  /**
   * Grant a permission to a plugin
   */
  grantPermission(pluginId: string, permission: Permission): void {
    const store = usePluginStore.getState();

    // Grant the permission
    store.grantPermission(pluginId, permission);

    // Also grant any dependent permissions
    const dependencies = PERMISSION_DEPENDENCIES[permission];
    if (dependencies) {
      dependencies.forEach((dep) => {
        if (!this.hasPermission(pluginId, dep)) {
          store.grantPermission(pluginId, dep);
        }
      });
    }
  }

  /**
   * Grant all required permissions for a plugin
   */
  grantAllRequiredPermissions(pluginId: string): void {
    const plugin = usePluginStore.getState().getPlugin(pluginId);
    if (!plugin) return;

    plugin.manifest.permissions.forEach((perm) => {
      this.grantPermission(pluginId, perm);
    });
  }

  /**
   * Revoke a permission from a plugin
   */
  revokePermission(pluginId: string, permission: Permission): void {
    usePluginStore.getState().revokePermission(pluginId, permission);
  }

  /**
   * Revoke all permissions from a plugin
   */
  revokeAllPermissions(pluginId: string): void {
    const granted = this.getGrantedPermissions(pluginId);
    granted.forEach((perm) => {
      this.revokePermission(pluginId, perm);
    });
  }

  /**
   * Get human-readable info about a permission
   */
  getPermissionInfo(permission: Permission): {
    label: string;
    description: string;
    risk: "low" | "medium" | "high";
  } {
    return PERMISSION_INFO[permission];
  }

  /**
   * Check if a permission is high risk
   */
  isHighRiskPermission(permission: Permission): boolean {
    return HIGH_RISK_PERMISSIONS.includes(permission);
  }

  /**
   * Get high risk permissions from a list
   */
  getHighRiskPermissions(permissions: Permission[]): Permission[] {
    return permissions.filter((perm) => this.isHighRiskPermission(perm));
  }

  /**
   * Analyze permissions for a plugin manifest
   */
  analyzePermissions(permissions: Permission[]): {
    required: Permission[];
    highRisk: Permission[];
    dependencies: Permission[];
    riskLevel: "low" | "medium" | "high";
  } {
    const highRisk = this.getHighRiskPermissions(permissions);

    // Collect all implied dependencies
    const dependencies = new Set<Permission>();
    permissions.forEach((perm) => {
      const deps = PERMISSION_DEPENDENCIES[perm];
      if (deps) {
        deps.forEach((dep) => {
          if (!permissions.includes(dep)) {
            dependencies.add(dep);
          }
        });
      }
    });

    // Determine overall risk level
    let riskLevel: "low" | "medium" | "high" = "low";
    if (highRisk.length > 0) {
      riskLevel = "high";
    } else if (
      permissions.some((p) => PERMISSION_INFO[p]?.risk === "medium")
    ) {
      riskLevel = "medium";
    }

    return {
      required: permissions,
      highRisk,
      dependencies: Array.from(dependencies),
      riskLevel,
    };
  }

  /**
   * Create a permission check function for use in API proxies
   */
  createPermissionChecker(
    pluginId: string
  ): (permission: Permission) => boolean {
    return (permission: Permission) => this.hasPermission(pluginId, permission);
  }

  /**
   * Assert that a plugin has a permission, throwing if not
   */
  assertPermission(pluginId: string, permission: Permission): void {
    if (!this.hasPermission(pluginId, permission)) {
      throw new PermissionDeniedError(pluginId, permission);
    }
  }

  /**
   * Assert that a plugin has all specified permissions
   */
  assertAllPermissions(pluginId: string, permissions: Permission[]): void {
    const missing = permissions.filter(
      (perm) => !this.hasPermission(pluginId, perm)
    );
    if (missing.length > 0) {
      throw new PermissionDeniedError(pluginId, missing[0], missing);
    }
  }
}

/**
 * Error thrown when a plugin lacks required permission
 */
export class PermissionDeniedError extends Error {
  public readonly pluginId: string;
  public readonly permission: Permission;
  public readonly missingPermissions: Permission[];

  constructor(
    pluginId: string,
    permission: Permission,
    missingPermissions?: Permission[]
  ) {
    const info = PERMISSION_INFO[permission];
    super(
      `Plugin "${pluginId}" lacks required permission: ${info?.label ?? permission}`
    );
    this.name = "PermissionDeniedError";
    this.pluginId = pluginId;
    this.permission = permission;
    this.missingPermissions = missingPermissions ?? [permission];
  }
}

/**
 * Get the permission manager singleton
 */
export function getPermissionManager(): PermissionManager {
  return PermissionManager.getInstance();
}

/**
 * Hook-friendly permission check
 */
export function checkPermission(
  pluginId: string,
  permission: Permission
): boolean {
  return PermissionManager.getInstance().hasPermission(pluginId, permission);
}

/**
 * Hook-friendly permission assertion
 */
export function requirePermission(
  pluginId: string,
  permission: Permission
): void {
  PermissionManager.getInstance().assertPermission(pluginId, permission);
}
