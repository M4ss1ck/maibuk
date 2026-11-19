/**
 * A Canvas Reference source a Plugin declares, shaped like a host source so the
 * registry, the picker, and the cards never know which one they hold (#836).
 * The Plugin answers through its running broker, and only the host's own
 * sources stay live by subscribing, so this one has no `subscribe`.
 */

import { createElement } from "react";
import { PluginIcon } from "@/components/plugins/PluginIcon";
import {
  listPluginCanvasReferences,
  openPluginCanvasReference,
  resolvePluginCanvasReferences,
} from "@/features/plugins/canvas-reference-requests";
import type { PluginCanvasReferenceSourceDef } from "@/features/plugins/contributions-registry";
import { getPluginLifecycle } from "@/features/plugins/lifecycle-instance";
import { withPluginPageReturnTarget } from "@/features/plugins/navigation";
import type { CanvasReferenceSource } from "@/features/canvas/references";

/** The picker tab's icon draws the Plugin's declared icon in the app's icon box. */
function pluginSourceIcon(def: PluginCanvasReferenceSourceDef): CanvasReferenceSource["icon"] {
  function PluginSourceIcon({ className }: { className?: string }) {
    return createElement(PluginIcon, { icon: def.icon, className });
  }
  return PluginSourceIcon;
}

/**
 * One Plugin-declared source: its id and label come from the contribution, its
 * card is Generic, and its three answers are the Plugin's own requests. The lifecycle is read per call, so a restarted Plugin
 * answers the next ask.
 */
export function pluginReferenceSource(def: PluginCanvasReferenceSourceDef): CanvasReferenceSource {
  return {
    id: def.id,
    label: def.label,
    icon: pluginSourceIcon(def),
    card: "generic",
    fromPlugin: true,

    list(query) {
      return listPluginCanvasReferences(getPluginLifecycle(), def, query);
    },

    resolve(ids) {
      return resolvePluginCanvasReferences(getPluginLifecycle(), def, ids);
    },

    open(id, { canvasId, canvasTitle }) {
      return withPluginPageReturnTarget(
        def.pluginId,
        { to: `/canvas/${canvasId}`, label: canvasTitle },
        () => openPluginCanvasReference(getPluginLifecycle(), def, id)
      );
    },
  };
}
