/**
 * The test-only conformance route's module (#447, D3). App.tsx imports it
 * lazily and only under `VITE_PLUGIN_CONFORMANCE=1`, so the module (and the
 * whole runtime graph it pulls in) never reaches a shipped bundle.
 */
export { default } from "@/features/plugins/conformance/ConformancePage";
