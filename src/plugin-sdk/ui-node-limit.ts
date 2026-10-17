/**
 * The Remote UI element limit a Plugin's Worker enforces before the host does,
 * and the marker its error carries (#516, decision 2a). One module, so the
 * Worker that throws and the lifecycle that maps the throw never drift apart.
 * The limit is the host's `PLUGIN_UI_LIMITS.maxNodes`; it is not a second number.
 */

import { PLUGIN_UI_LIMITS } from "@/plugin-sdk/ui-table";

/** The most elements a Plugin's live interface may hold: the host's own limit. */
export const PLUGIN_UI_NODE_LIMIT = PLUGIN_UI_LIMITS.maxNodes;

/**
 * The fixed text the Worker's error carries when a Plugin's live elements pass
 * the limit. `lifecycle.ts` maps an error containing it to `remote-ui-limit`, the
 * stop the host itself raises for an oversized interface.
 */
export const PLUGIN_UI_NODE_LIMIT_MARKER = "maibuk:remote-ui-node-limit";
