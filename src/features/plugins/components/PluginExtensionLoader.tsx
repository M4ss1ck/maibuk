/**
 * Plugin Extension Loader
 *
 * Utility component that wraps plugin-provided UI components
 * with error boundaries and loading states.
 */

import React, { Component, type ReactNode } from "react";
import { usePluginStore } from "../store";

/**
 * Props for PluginErrorBoundary
 */
interface PluginErrorBoundaryProps {
  pluginId: string;
  pluginName: string;
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * State for PluginErrorBoundary
 */
interface PluginErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorCount: number;
}

/**
 * Maximum errors before auto-disable
 */
const MAX_ERRORS_BEFORE_DISABLE = 3;

/**
 * Error boundary specifically for plugin components
 */
export class PluginErrorBoundary extends Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<PluginErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { pluginId, pluginName, onError } = this.props;

    console.error(`Plugin "${pluginName}" (${pluginId}) error:`, error, errorInfo);

    // Report error to store
    usePluginStore.getState().reportError({
      pluginId,
      error: error.message,
      stack: error.stack,
    });

    // Increment error count
    const newErrorCount = this.state.errorCount + 1;
    this.setState({ errorCount: newErrorCount });

    // Auto-disable plugin after too many errors
    if (newErrorCount >= MAX_ERRORS_BEFORE_DISABLE) {
      console.warn(
        `Plugin "${pluginName}" disabled due to repeated errors (${newErrorCount})`
      );
      usePluginStore.getState().disablePlugin(pluginId);
    }

    // Call optional error handler
    onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="p-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
          <p className="font-medium">Plugin Error</p>
          <p className="text-xs opacity-80">
            {this.props.pluginName} encountered an error
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Props for PluginComponentWrapper
 */
interface PluginComponentWrapperProps {
  pluginId: string;
  pluginName: string;
  component: React.ComponentType<Record<string, unknown>>;
  props?: Record<string, unknown>;
  fallback?: ReactNode;
}

/**
 * Wrapper component that renders a plugin component with error boundary
 */
export function PluginComponentWrapper({
  pluginId,
  pluginName,
  component: PluginComponent,
  props = {},
  fallback,
}: PluginComponentWrapperProps) {
  return (
    <PluginErrorBoundary
      pluginId={pluginId}
      pluginName={pluginName}
      fallback={fallback}
    >
      <PluginComponent {...props} />
    </PluginErrorBoundary>
  );
}

/**
 * Props for PluginLoadingState
 */
interface PluginLoadingStateProps {
  message?: string;
}

/**
 * Loading state component for plugin content
 */
export function PluginLoadingState({ message = "Loading plugin..." }: PluginLoadingStateProps) {
  return (
    <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
      <div className="animate-pulse">{message}</div>
    </div>
  );
}

/**
 * Props for PluginDisabledState
 */
interface PluginDisabledStateProps {
  pluginName: string;
  reason?: string;
}

/**
 * Disabled state component for plugin content
 */
export function PluginDisabledState({ pluginName, reason }: PluginDisabledStateProps) {
  return (
    <div className="p-4 text-sm text-muted-foreground bg-muted/50 rounded">
      <p className="font-medium">{pluginName} is disabled</p>
      {reason && <p className="text-xs opacity-80 mt-1">{reason}</p>}
    </div>
  );
}

/**
 * Hook to get plugin error state
 */
export function usePluginErrorState(pluginId: string) {
  const errors = usePluginStore((state) =>
    state.errors.filter((e) => e.pluginId === pluginId)
  );

  const plugin = usePluginStore((state) => state.plugins[pluginId]);

  return {
    hasErrors: errors.length > 0,
    errors,
    isDisabled: plugin ? !plugin.enabled : true,
    recentErrorCount: errors.filter(
      (e) => Date.now() - e.timestamp < 5 * 60 * 1000 // Last 5 minutes
    ).length,
  };
}
