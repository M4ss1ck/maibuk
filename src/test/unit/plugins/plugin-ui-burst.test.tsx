import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ui } from "@/plugin-sdk/ui";
import { renderRemoteUi, type RemoteUiHarness } from "@/test/support/plugin-remote-ui";

const ROWS = 1_000;
let harness: RemoteUiHarness | null = null;

afterEach(() => {
  harness?.cleanup();
  harness = null;
});

describe("burst typing over 1,000 updating rows", () => {
  it("never loses text and applies a Clear once the echoes have drained", async () => {
    let setValue: (next: string) => void = () => {};
    function Plugin() {
      const [value, set] = useState("");
      setValue = set;
      const rows = Array.from({ length: ROWS }, (_, index) => `${value.length}-${index}`);
      return (
        <>
          <ui.TextField label="Query" value={value} onInput={(event) => set(event.detail)} />
          <ui.View>
            {rows.map((row, index) => (
              <ui.Text key={index}>{row}</ui.Text>
            ))}
          </ui.View>
        </>
      );
    }

    harness = renderRemoteUi();
    await harness.mount(<Plugin />);
    const field = screen.getByRole("textbox", { name: "Query" });

    // A burst with no delay: the host owns the live value, so every keystroke
    // shows even while 1,000 rows re-render behind it. The Backspace sends ""
    // to the Plugin, so "" is in the host's sent history by the time Clear runs.
    await userEvent.type(field, "a{Backspace}abc");
    expect(field).toHaveValue("abc");

    // The Plugin's Clear. The channel is FIFO: by now every echo has drained,
    // so the reset is real and must reach the field (regression: the permanent
    // history made this a no-op and the field stayed "abc").
    await act(async () => {
      setValue("");
    });
    expect(field).toHaveValue("");
  });
});
