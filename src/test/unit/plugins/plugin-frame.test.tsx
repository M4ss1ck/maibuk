// The custom-UI `Frame` surface (#454 unit 3, ADR 0021): refusals without
// `customUi` or on a platform where Frames are off, the reused custom-UI
// notice, the sandboxed iframe and its one `frame-load`, the `frame-ready`
// handshake accepted only from the Frame's own window, and teardown. Frames
// get no accessibility test beyond the tab-order test (#402).

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import "@/i18n";
import { PluginFrame, type PluginFrameHost } from "@/components/plugins/PluginFrame";
import {
  FRAME_LOAD_MESSAGE,
  FRAME_READY_MESSAGE,
  FRAME_THEME_MESSAGE,
} from "@/features/plugins/frame";
import { isPluginFrameAvailable } from "@/features/plugins/host-platform";
import type { PluginManifest } from "@/features/plugins/types";

vi.mock("@/features/plugins/host-platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/plugins/host-platform")>();
  return { ...actual, isPluginFrameAvailable: vi.fn(() => true) };
});

const encoder = new TextEncoder();

function frameHost(overrides: Partial<PluginManifest> = {}): PluginFrameHost {
  return {
    manifest: { customUi: true, ...overrides } as PluginManifest,
    files: [
      { path: "manifest.json", bytes: encoder.encode("{}") },
      { path: "ui/index.html", bytes: encoder.encode("<html><body>hi</body></html>") },
    ],
    sendFrame: vi.fn(),
  };
}

function renderFrame(host: PluginFrameHost, extra: Partial<{ variant: "page" | "embedded" }> = {}) {
  return render(
    <PluginFrame
      runtime={host}
      src="ui/index.html"
      title="Custom report"
      variant={extra.variant ?? "embedded"}
    />
  );
}

afterEach(() => {
  vi.mocked(isPluginFrameAvailable).mockReturnValue(true);
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove("dark");
});

describe("PluginFrame", () => {
  it("refuses without customUi: a placeholder, never an iframe", () => {
    const { container, queryByText } = renderFrame(frameHost({ customUi: false }));
    expect(queryByText("This Plugin cannot use custom UI.")).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("refuses when the platform has Frames off: a placeholder, never an iframe", () => {
    vi.mocked(isPluginFrameAvailable).mockReturnValue(false);
    const { container, queryByText } = renderFrame(frameHost());
    expect(queryByText("Custom UI is not available on this platform.")).toBeInTheDocument();
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("shows the reused custom-UI notice above the Frame", () => {
    const { getByText, container } = renderFrame(frameHost());
    expect(getByText("Custom UI: accessibility not verified by Maibuk")).toBeInTheDocument();
    // The notice sits before the Frame's container in document order.
    const notice = getByText("Custom UI: accessibility not verified by Maibuk");
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(notice.compareDocumentPosition(frame as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders a named iframe that can only run scripts", () => {
    const { container } = renderFrame(frameHost());
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe?.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe?.title).toBe("Custom report");
  });

  it("on load posts the frame-load message with one transferred port and sends port B to the Worker", () => {
    const host = frameHost();
    const { container } = renderFrame(host);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const win = iframe.contentWindow as Window;
    const postMessage = vi.spyOn(win, "postMessage").mockImplementation(() => {});

    iframe.dispatchEvent(new Event("load"));

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [message, origin, transfer] = postMessage.mock.calls[0] as unknown as [
      { kind: string; html: string },
      string,
      Transferable[],
    ];
    expect(origin).toBe("*");
    expect(message.kind).toBe(FRAME_LOAD_MESSAGE.kind);
    expect(message.html).toBe("ui/index.html");
    expect(transfer).toHaveLength(1);

    expect(host.sendFrame).toHaveBeenCalledTimes(1);
    const [frameId, src, port] = (host.sendFrame as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(frameId)).toMatch(/^frame:/);
    expect(src).toBe("ui/index.html");
    // Port B is the other end of the channel, never the port posted to the Frame.
    expect(port).not.toBe(transfer[0]);
  });

  it("loads a frame whose src carries a `./` prefix, posting the normalized path", () => {
    const host = frameHost();
    const { container } = render(
      <PluginFrame runtime={host} src="./ui/index.html" title="Custom report" variant="page" />
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const win = iframe.contentWindow as Window;
    const postMessage = vi.spyOn(win, "postMessage").mockImplementation(() => {});

    iframe.dispatchEvent(new Event("load"));

    const [message] = postMessage.mock.calls[0] as unknown as [{ kind: string; html: string }];
    expect(message.html).toBe("ui/index.html");
    expect(host.sendFrame).toHaveBeenCalledTimes(1);
  });

  it("closes the previous channel before a second load opens a new one", () => {
    const close = vi.spyOn(MessagePort.prototype, "close");
    const host = frameHost();
    const { container } = renderFrame(host);
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const win = iframe.contentWindow as Window;
    vi.spyOn(win, "postMessage").mockImplementation(() => {});

    iframe.dispatchEvent(new Event("load"));
    iframe.dispatchEvent(new Event("load"));

    // The first frame-load's MessageChannel is done once the Frame reloads: its
    // two ports are closed before the second channel is created.
    expect(close).toHaveBeenCalledTimes(2);
    expect(host.sendFrame).toHaveBeenCalledTimes(2);
    close.mockRestore();
  });

  it("ignores a frame-ready from a foreign window and accepts its own", () => {
    const { container } = renderFrame(frameHost());
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const busy = container.querySelector("[aria-busy]");
    expect(busy?.getAttribute("aria-busy")).toBe("true");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { kind: FRAME_READY_MESSAGE.kind }, source: window })
      );
    });
    expect(busy?.getAttribute("aria-busy")).toBe("true");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { kind: FRAME_READY_MESSAGE.kind },
          source: iframe.contentWindow,
        })
      );
    });
    expect(busy?.getAttribute("aria-busy")).toBe("false");
  });

  it("closes both ports and removes the iframe on unmount", () => {
    const close = vi.spyOn(MessagePort.prototype, "close");
    const { container, unmount } = renderFrame(frameHost());
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    const win = iframe.contentWindow as Window;
    vi.spyOn(win, "postMessage").mockImplementation(() => {});
    iframe.dispatchEvent(new Event("load"));

    unmount();

    expect(container.querySelector("iframe")).toBeNull();
    expect(close.mock.calls.length).toBeGreaterThanOrEqual(2);
    close.mockRestore();
  });

  it("is reachable by Tab from the preceding control", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <div>
        <button type="button">Before</button>
        <PluginFrame
          runtime={frameHost()}
          src="ui/index.html"
          title="Custom report"
          variant="embedded"
        />
      </div>
    );
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;

    await user.tab();
    expect(document.activeElement).toBe(container.querySelector("button"));
    await user.tab();
    expect(document.activeElement).toBe(iframe);
  });
});

// The live theme-token bridge (#454 unit U4, D3). jsdom does not apply the
// stylesheet, so a real theme flip (which swaps values through `.dark`) is
// simulated the way the app's own writers do it: the inline custom property on
// the root changes, which is the attribute the hook observes.
describe("PluginFrame theme tokens", () => {
  function loadedFrame() {
    document.documentElement.style.setProperty("--color-primary", "#101010");
    const host = frameHost();
    const rendered = renderFrame(host);
    const iframe = rendered.container.querySelector("iframe") as HTMLIFrameElement;
    const win = iframe.contentWindow as Window;
    const postMessage = vi.spyOn(win, "postMessage").mockImplementation(() => {});
    return { ...rendered, iframe, win, postMessage };
  }

  it("carries the current tokens on frame-load", async () => {
    const { iframe, postMessage } = loadedFrame();

    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
    });

    const [message] = postMessage.mock.calls[0] as unknown as [
      { kind: string; tokens: Record<string, string> },
    ];
    expect(message.kind).toBe(FRAME_LOAD_MESSAGE.kind);
    expect(message.tokens["--maibuk-color-primary"]).toBe("#101010");
    expect(message.tokens["--maibuk-color-scheme"]).toBe("light");
  });

  it("posts nothing before load, then exactly one frame-theme per change", async () => {
    const { iframe, postMessage } = loadedFrame();

    // A change before the Frame is loaded is not posted.
    await act(async () => {
      document.documentElement.style.setProperty("--color-primary", "#202020");
    });
    expect(postMessage).not.toHaveBeenCalled();

    // Load carries the changed value.
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
    });
    const afterLoad = postMessage.mock.calls.length;
    expect(afterLoad).toBe(1);
    const loadMessage = postMessage.mock.calls[0][0] as unknown as {
      tokens: Record<string, string>;
    };
    expect(loadMessage.tokens["--maibuk-color-primary"]).toBe("#202020");

    // A change after load posts exactly one frame-theme with the new value.
    await act(async () => {
      document.documentElement.style.setProperty("--color-primary", "#303030");
    });
    expect(postMessage.mock.calls.length).toBe(afterLoad + 1);
    const themeMessage = postMessage.mock.calls[afterLoad][0] as unknown as {
      kind: string;
      tokens: Record<string, string>;
    };
    expect(themeMessage.kind).toBe(FRAME_THEME_MESSAGE.kind);
    expect(themeMessage.tokens["--maibuk-color-primary"]).toBe("#303030");
  });

  it("does not post the same values twice", async () => {
    const { iframe, postMessage } = loadedFrame();
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
    });
    const afterLoad = postMessage.mock.calls.length;

    // Re-writing the same value is not a change.
    await act(async () => {
      document.documentElement.style.setProperty("--color-primary", "#101010");
    });

    expect(postMessage.mock.calls.length).toBe(afterLoad);
  });

  it("posts nothing after unmount", async () => {
    const { iframe, postMessage, unmount } = loadedFrame();
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
    });
    const afterLoad = postMessage.mock.calls.length;

    unmount();
    await act(async () => {
      document.documentElement.style.setProperty("--color-primary", "#404040");
    });

    expect(postMessage.mock.calls.length).toBe(afterLoad);
  });
});
