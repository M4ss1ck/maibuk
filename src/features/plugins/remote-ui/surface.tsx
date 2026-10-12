/**
 * The React surface a Plugin page mounts to draw its remote tree. The host
 * renderer is imported by the page lazily (it is only needed when a Plugin page
 * opens), and an error boundary keeps a broken declaration from taking the
 * route down: it reports the failure, which stops the Plugin.
 */

import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RemoteRootRenderer } from "@remote-dom/react/host";
import type { PluginRemoteUi } from "@/features/plugins/remote-ui/receiver";

interface BoundaryProps {
  fallback: ReactNode;
  onError: (message: string) => void;
  children: ReactNode;
}

class RemoteUiErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    this.props.onError(error.message);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function PluginRemoteUiSurface({
  ui,
  onError,
}: {
  ui: PluginRemoteUi;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <RemoteUiErrorBoundary
      onError={onError}
      fallback={
        <p role="alert" className="text-sm text-muted-foreground">
          {t("plugins.ui.couldNotDisplay")}
        </p>
      }
    >
      <RemoteRootRenderer receiver={ui.receiver} components={ui.components} />
    </RemoteUiErrorBoundary>
  );
}
