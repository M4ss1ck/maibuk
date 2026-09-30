import { createContext } from "react";

/**
 * Whether a toolbar command should pull focus into the editor before it runs.
 * The main toolbar always does; the floating selection toolbar keeps focus on
 * its own controls, so activating one must not steal it back from the toolbar.
 */
export const EditorFocusPolicyContext = createContext<() => boolean>(() => true);
