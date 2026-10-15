// The custom-UI `Frame` component (ADR 0021, #454 unit 1: the declaration
// contract). Unit 1 ships no renderer, so these tests prove the tree is
// accepted only for a custom-UI Plugin and refused otherwise, and that `src`
// obeys the same relative-`.html` rules as a page `frame`. `Frame` is
// non-interactive ("Frames get no accessibility test", #402), so it carries a
// `@ui:maibuk-frame` semantics test and no keyboard test.

import {
  MUTATION_TYPE_INSERT_CHILD,
  type RemoteMutationRecord,
  type RemoteNodeSerialization,
} from "@remote-dom/core";
import { RemoteReceiver } from "@remote-dom/core/receivers";
import { afterEach, describe, expect, it } from "vitest";
import "@/i18n";
import {
  createValidatedConnection,
  type PluginUiViolation,
} from "@/features/plugins/remote-ui/validate";
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

function validate(customUi: boolean, child: RemoteNodeSerialization = frameElement()) {
  const receiver = new RemoteReceiver();
  const violations: PluginUiViolation[] = [];
  const connection = createValidatedConnection({
    receiver,
    customUi,
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
    harness = renderRemoteUi({ customUi: true });
    await harness.mount(<ui.Frame src="ui/report.html" title="Custom report" />);
    expect(harness.violations).toEqual([]);
  });

  it("refuses a Frame tree when the Plugin manifest lacks customUi", () => {
    const { receiver, violations } = validate(false);
    expect(violations[0]?.code).toBe("custom-ui-required");
    expect(violations[0]?.tag).toBe("maibuk-frame");
    // Nothing was committed: Remote DOM does not roll a refused batch back, so
    // the whole batch is refused before any record reaches the receiver.
    expect(receiver.root.children).toHaveLength(0);
  });

  it("accepts a Frame tree when the Plugin manifest sets customUi", () => {
    const { receiver, violations } = validate(
      true,
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
        true,
        frameElement({ properties: { src, title: "Custom report" } })
      );
      expect(violations[0]?.code, src).toBe("invalid-prop");
      expect(violations[0]?.prop).toBe("src");
    }
  });

  it("refuses a Frame without its required title", () => {
    const { violations } = validate(
      true,
      frameElement({ properties: { src: "ui/report.html" } })
    );
    expect(violations[0]?.code).toBe("invalid-prop");
    expect(violations[0]?.prop).toBe("title");
  });
});
