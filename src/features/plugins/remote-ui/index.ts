// The Remote UI host renderer's public API (#438). `src/pages/PluginPage.tsx`
// imports this lazily; the test harness imports the SDK components it renders.

export { createEchoTracker, ECHO_HISTORY_LIMIT } from "@/features/plugins/remote-ui/echo";
export type { PluginEchoTracker } from "@/features/plugins/remote-ui/echo";
export { createPluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
export type { PluginRemoteUi } from "@/features/plugins/remote-ui/receiver";
export { usePluginRemoteUi } from "@/features/plugins/remote-ui/use-plugin-remote-ui";
export {
  PluginRemoteUiBoundary,
  stopRemoteUi,
} from "@/features/plugins/remote-ui/boundary";
export { PluginRemoteUiSurface } from "@/features/plugins/remote-ui/surface";
export { createPluginUiComponents } from "@/features/plugins/remote-ui/components";
export { createValidatedConnection } from "@/features/plugins/remote-ui/validate";
export type {
  PluginUiValidatorOptions,
  PluginUiViolation,
  PluginUiViolationCode,
} from "@/features/plugins/remote-ui/validate";
