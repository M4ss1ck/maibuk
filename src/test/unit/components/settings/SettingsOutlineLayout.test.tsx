import { act, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { outlineRenders } = vi.hoisted(() => ({ outlineRenders: { count: 0 } }));
vi.mock("@/components/settings/SettingsOutline", () => ({
  SettingsOutline: () => {
    outlineRenders.count += 1;
    return null;
  },
}));

const { SettingsOutlineLayout } = await import("@/components/settings/SettingsOutlineLayout");

function Page() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={scrollerRef} data-testid="scroller">
      <SettingsOutlineLayout scrollerRef={scrollerRef}>
        <section>
          <h2 data-settings-section="appearance">Appearance</h2>
        </section>
      </SettingsOutlineLayout>
    </div>
  );
}

describe("SettingsOutlineLayout", () => {
  // The menu bar's progress line changes on every scroll frame; the outline
  // tree has a hundred items and must not re-render with it.
  it("a scroll that moves only the progress line leaves the outline alone", async () => {
    const { getByTestId, container } = render(<Page />);
    const scroller = getByTestId("scroller");
    Object.defineProperty(scroller, "scrollHeight", { value: 2000 });
    Object.defineProperty(scroller, "clientHeight", { value: 1000 });
    const progressLine = () =>
      container.querySelector<HTMLElement>("[data-settings-navigation] > div[aria-hidden]")!;
    await waitFor(() => expect(outlineRenders.count).toBeGreaterThan(0));
    const before = outlineRenders.count;

    act(() => {
      scroller.scrollTop = 500;
      scroller.dispatchEvent(new Event("scroll"));
    });

    await waitFor(() => expect(progressLine().style.transform).toBe("scaleX(0.5)"));
    expect(outlineRenders.count).toBe(before);
  });
});
