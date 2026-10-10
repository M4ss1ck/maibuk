/**
 * The host-side Plugin API handlers this slice wires. `notifications.show`
 * renders a toast naming the Plugin; the API slice (#440) extends this module
 * with the Library, storage, navigation, and language handlers, and the
 * broker already enforces the row's rate limit and input schema.
 */

import { toast } from "@/components/ui/Toast";
import type { PluginApiHandlers, PluginManifest } from "@/features/plugins/types";

export function createPluginHandlers(manifest: PluginManifest): PluginApiHandlers {
  return {
    "notifications.show": ({ variant, message }) => {
      const text = `${manifest.name}: ${message}`;
      if (variant === "error") toast.error(text);
      else if (variant === "success") toast.success(text);
      else toast.info(text);
      return null;
    },
  };
}
