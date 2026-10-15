// The custom-UI `Frame` component (ADR 0021, #454 unit 1: the declaration
// contract). A tree that declares `Frame` is accepted whatever the manifest's
// `customUi` (D2): the host renders the Frame surface, which itself refuses
// with a localized placeholder when the manifest lacks `customUi`, so the rest
// of the Plugin keeps running. `src` obeys the same relative-`.html` rules as a
// page `frame`. `Frame` is non-interactive ("Frames get no accessibility test",
// #402), so it carries a `@ui:maibuk-frame` semantics test and no keyboard test.

import {
  MUTATION_TYPE_INSERT_CHILD,
  type RemoteMutationRecord,
  type RemoteNodeSerialization,
} from "@remote-dom/core";
import { RemoteReceiver } from "@remote-dom/core/receivers";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@/i18n";
import type { PluginFrameHost } from "@/components/plugins/PluginFrame";
import {
  createValidatedConnection,
  type PluginUiViolation,
} from "@/features/plugins/remote-ui/validate";
import type { PluginManifest } from "@/features/plugins/types";
import { ui } from "@/plugin-sdk/ui";
import { renderRemoteUi, type RemoteUiHarness } from "@/test/support/plugin-remote-ui";

const ROOT = "~";

function frameElement(extra: Partial<RemoteNodeSerialization> = {}): RemoteNodeSerialization {
  return {
    id: "1",
    type: 1,
    element: "maibuk-frame",
    children: [],
    ...extra,
  } as RemoteNodeSerialization;
}

/** A run whose manifest may or may not declare `customUi`, with one Frame file. */
function frameHost(customUi: boolean): PluginFrameHost {
  return {
    manifest: { customUi } as PluginManifest,
    files: [
      { path: "ui/report.html", bytes: new TextEncoder().encode("<html></html>") },
    ],
    sendFrame: () => {},
  };
}

function validate(child: RemoteNodeSerialization = frameElement()) {
  const receiver = new RemoteReceiver();
  const violations: PluginUiViolation[] = [];
  const connection = createValidatedConnection({
    receiver,
    onViolation: (violation) => violations.push(violation),
  });
  const record: RemoteMutationRecord = [MUTATION_TYPE_INSERT_CHILD, ROOT, child, 0];
  connection.mutate([record]);
  return { receiver, violations };
}

describe("the Frame kit component", () => {
  let harness: RemoteUiHarness | null = null;

  afterEach(() => {
    harness?.cleanup();
    harness = null;
  });

  it("renders a Frame placeholder for a custom-UI Plugin @ui:maibuk-frame", async () => {
    harness = renderRemoteUi({ frameHost: frameHost(true) });
    await harness.mount(<ui.Frame src="ui/report.html" title="Custom report" />);
    expect(harness.violations).toEqual([]);
  });

  it("shows the customUi placeholder, and keeps the Plugin running, when the manifest lacks customUi", async () => {
    harness = renderRemoteUi({ frameHost: frameHost(false) });
    await harness.mount(<ui.Frame src="ui/report.html" title="Custom report" />);

    // D2: the kit `Frame` renders a localized placeholder instead of the
    // iframe; the tree is not refused, so the Plugin is not stopped.
    expect(harness.violations).toEqual([]);
    expect(harness.ui.receiver.root.children).toHaveLength(1);
    expect(screen.getByText("This Plugin cannot use custom UI.")).toBeInTheDocument();
  });

  it("accepts a Frame tree when the Plugin manifest sets customUi", () => {
    const { receiver, violations } = validate(
      frameElement({ properties: { src: "ui/report.html", title: "Custom report" } })
    );
    expect(violations).toEqual([]);
    expect(receiver.root.children).toHaveLength(1);
  });

  it("refuses a Frame src that is not a relative .html path", () => {
    for (const src of [
      "/ui/report.html",
      "../report.html",
      "ui/../report.html",
      "ui\\report.html",
      "https://example.com/report.html",
      "ui/report.js",
      "ui/report.html?x=1",
    ]) {
      const { violations } = validate(
        frameElement({ properties: { src, title: "Custom report" } })
      );
      expect(violations[0]?.code, src).toBe("invalid-prop");
      expect(violations[0]?.prop).toBe("src");
    }
  });

  it("refuses a Frame without its required title", () => {
    const { violations } = validate(
      frameElement({ properties: { src: "ui/report.html" } })
    );
    expect(violations[0]?.code).toBe("invalid-prop");
    expect(violations[0]?.prop).toBe("title");
  });
});
