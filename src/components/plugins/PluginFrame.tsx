/**
 * The custom-UI `Frame` surface (ADR 0021, #454 unit 3): a visible, named
 * sandboxed iframe whose document is the fixed host shim, loaded from the
 * Plugin's *verified* folder. The host never parses Frame traffic: the Frame
 * talks to its owning Worker only over the port the host hands it, and the host
 * accepts one `frame-ready` handshake from that iframe's own window (D1).
 *
 * The surface refuses and shows a localized placeholder when the manifest does
 * not set `customUi` (D2) or the platform has Frames off (D6), and always shows
 * the reused custom-UI notice above the Frame (D5). It carries the public theme
 * tokens on `frame-load` and posts each later change as a `frame-theme` (U4).
 * Frames get no accessibility test beyond the tab-order test (#402).
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildFrameLoadMessage,
  createFrameElement,
  FRAME_FULLSCREEN_MESSAGE,
  FRAME_FULLSCREEN_STATE_MESSAGE,
  FRAME_HOST_FOCUS_MESSAGE,
  FRAME_READY_MESSAGE,
  FRAME_THEME_MESSAGE,
} from "@/features/plugins/frame";
import { setWindowFullscreen } from "@/lib/platform";
import { isPluginFrameAvailable } from "@/features/plugins/host-platform";
import { useFrameThemeTokens } from "@/components/plugins/useFrameThemeTokens";
import { pluginRunKey } from "@/components/plugins/plugin-run-key";
import { useInstalledPluginLifecycle, usePluginLifecycleRevision } from "@/hooks/usePluginSurface";
import type { PluginFolderFile, PluginManifest, PluginRuntime } from "@/features/plugins/types";

/**
 * What a `Frame` needs from its owning run: the manifest (for `customUi`), the
 * verified folder files, and the path to hand a Frame port to the Worker. A
 * real `PluginRuntime` satisfies it; the embedded kit `Frame` receives it from
 * the mount the host drew.
 */
export interface PluginFrameHost {
  readonly manifest: PluginManifest;
  readonly files: readonly PluginFolderFile[];
  sendFrame(frameId: string, src: string, port: MessagePort): void;
}

let nextFrameId = 0;

function FramePlaceholder({ variant, message }: { variant: "page" | "embedded"; message: string }) {
  return (
    <div data-plugin-frame={variant}>
      <p role="alert" className="text-sm text-muted-foreground">
        {message}
      </p>
    </div>
  );
}

/**
 * One mounted Frame. `variant: "page"` fills the page content area; `"embedded"`
 * is a kit `Frame` with a sensible default height. The iframe is created on
 * mount, appended to the surface's own container, and torn down on unmount (both
 * ports closed, the element removed); a different runtime key remounts it.
 */
export function PluginFrame({
  runtime,
  src,
  title,
  variant,
}: {
  runtime: PluginFrameHost;
  src: string;
  title: string;
  variant: "page" | "embedded";
}) {
  const { t } = useTranslation();
  const available = isPluginFrameAvailable();
  const customUi = runtime.manifest.customUi === true;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  // The Frame asked to fill the screen (`frame-fullscreen`).
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);
  // The public tokens, and the loaded iframe they update. `loadedRef` stays
  // false until `frame-load` has gone out, so no `frame-theme` can precede it.
  const tokens = useFrameThemeTokens();
  const tokensRef = useRef(tokens);
  const loadedRef = useRef(false);
  const frameWindowRef = useRef<Window | null>(null);

  useEffect(() => {
    tokensRef.current = tokens;
  }, [tokens]);

  useEffect(() => {
    if (!customUi || !available) return;
    const container = containerRef.current;
    if (container === null) return;
    const iframe = createFrameElement(document, { title });
    // The iframe is focusable in every engine by default; an explicit
    // `tabindex="0"` states it for the tab-order test (user-event only follows
    // `[tabindex]`), and never removes the Frame from the tab order.
    iframe.tabIndex = 0;
    container.appendChild(iframe);
    frameWindowRef.current = iframe.contentWindow;
    loadedRef.current = false;

    const frameId = `frame:${++nextFrameId}`;
    let channel: MessageChannel | null = null;

    const onLoad = () => {
      try {
        const message = buildFrameLoadMessage(runtime.files, src, tokensRef.current);
        // A Frame that reloads itself fires `load` again: close the previous
        // channel's ports before opening a new one so its port is not leaked.
        channel?.port1.close();
        channel?.port2.close();
        channel = new MessageChannel();
        // Port A goes to the Frame (the shim exposes it as `window.maibuk.port`);
        // port B goes to the owning Worker (D1). The host parses neither.
        iframe.contentWindow?.postMessage(message, "*", [channel.port1]);
        runtime.sendFrame(frameId, src, channel.port2);
        // Only now may a `frame-theme` follow: the shim is listening.
        loadedRef.current = true;
      } catch {
        // A `src` outside the verified set (HashChanged since approval, or a
        // misdeclared path) fails closed: no Frame, a localized placeholder.
        setFailed(true);
      }
    };
    iframe.addEventListener("load", onLoad);

    const onMessage = (event: MessageEvent) => {
      // Only this iframe's own window; every other Frame and every host window
      // message is ignored (D1).
      if (event.source !== iframe.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const kind = (data as { kind?: unknown }).kind;
      if (kind === FRAME_FULLSCREEN_MESSAGE) {
        setFullscreen((data as { on?: unknown }).on === true);
        return;
      }
      if (kind !== FRAME_READY_MESSAGE.kind) return;
      setReady(true);
    };
    window.addEventListener("message", onMessage);

    // Focus landing on a host control tells the Frame to drop its own focused
    // element, which Firefox would otherwise restore on the next Tab in and
    // trap Shift+Tab inside. The window losing focus is no host `focusin`, so
    // nothing is sent then and a Frame field keeps focus across an app switch.
    const onHostFocus = (event: FocusEvent) => {
      if (event.target === iframe) return;
      iframe.contentWindow?.postMessage({ kind: FRAME_HOST_FOCUS_MESSAGE.kind }, "*");
    };
    document.addEventListener("focusin", onHostFocus);

    return () => {
      iframe.removeEventListener("load", onLoad);
      window.removeEventListener("message", onMessage);
      document.removeEventListener("focusin", onHostFocus);
      channel?.port1.close();
      channel?.port2.close();
      iframe.remove();
      frameWindowRef.current = null;
      loadedRef.current = false;
    };
  }, [customUi, available, runtime, src, title]);

  // Full screen: the Frame fills the window, the desktop window fills the
  // screen, and the web asks the browser. Every change, the host's own Escape
  // included, is reported back to the Frame.
  useEffect(() => {
    frameWindowRef.current?.postMessage(
      { kind: FRAME_FULLSCREEN_STATE_MESSAGE, on: fullscreen },
      "*"
    );
    if (!fullscreen) return;
    void setWindowFullscreen(true).catch(() => {});
    const wrapper = wrapperRef.current;
    if (wrapper && typeof wrapper.requestFullscreen === "function" && !document.fullscreenElement) {
      void Promise.resolve(wrapper.requestFullscreen()).catch(() => {});
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    const onBrowserExit = () => {
      if (!document.fullscreenElement) setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onBrowserExit);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onBrowserExit);
      void setWindowFullscreen(false).catch(() => {});
      if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
        void Promise.resolve(document.exitFullscreen()).catch(() => {});
      }
    };
  }, [fullscreen]);

  // A live update (theme, accent, font): push the changed tokens to the loaded
  // Frame. `tokens` is a new object only when a value actually changed, and the
  // guard keeps every post after `frame-load` and none after unmount.
  useEffect(() => {
    if (!loadedRef.current) return;
    frameWindowRef.current?.postMessage({ kind: FRAME_THEME_MESSAGE.kind, tokens }, "*");
  }, [tokens]);

  if (!customUi) {
    return <FramePlaceholder variant={variant} message={t("plugins.frame.customUiRequired")} />;
  }
  if (!available) {
    return <FramePlaceholder variant={variant} message={t("plugins.frame.unavailable")} />;
  }
  if (failed) {
    return <FramePlaceholder variant={variant} message={t("plugins.ui.couldNotDisplay")} />;
  }

  const wrapperClass = fullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-background"
    : variant === "page"
      ? "flex min-h-0 flex-1 flex-col"
      : "flex w-full flex-col";
  const frameClass = fullscreen
    ? "relative min-h-0 flex-1 overflow-hidden bg-card"
    : variant === "page"
      ? "relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card"
      : "relative h-64 w-full overflow-hidden rounded-lg border border-border bg-card";

  return (
    <div
      ref={wrapperRef}
      data-plugin-frame={variant}
      data-fullscreen={fullscreen ? "true" : undefined}
      className={wrapperClass}
    >
      <div ref={containerRef} aria-busy={!ready} className={frameClass} />
    </div>
  );
}

/**
 * The page surface a whole-page Frame renders through: it reads the running
 * runtime and renders `PluginFrame variant="page"`, keyed so a restarted Plugin
 * (a fresh runtime) remounts the Frame instead of reusing the old connection.
 * While the Plugin is starting, or stopped, it renders nothing — the same
 * stopped-Plugin state the Remote UI surface shows.
 */
export function PluginFrameSurface({
  pluginId,
  src,
  title,
  variant,
}: {
  pluginId: string;
  src: string;
  title: string;
  variant: "page" | "embedded";
}) {
  const lifecycle = useInstalledPluginLifecycle();
  usePluginLifecycleRevision(lifecycle);
  const runtime: PluginRuntime | null = lifecycle?.runtime(pluginId) ?? null;
  const status = lifecycle?.state(pluginId)?.status ?? null;
  if (status === "starting") return null;
  if (runtime === null || (status !== "ready" && status !== "unavailable")) return null;
  return (
    <PluginFrame
      key={pluginRunKey(runtime)}
      runtime={runtime}
      src={src}
      title={title}
      variant={variant}
    />
  );
}
