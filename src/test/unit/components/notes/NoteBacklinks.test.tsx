import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { NoteBacklinks } from "../../../../components/notes/NoteBacklinks";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
vi.mock("../../../../features/links/link-index", () => ({
  getBacklinksForNote: vi.fn(async () => [{ sourceId: "a", title: "Note A" }]),
}));

describe("NoteBacklinks", () => {
  it("lists backlinks and calls onOpen when clicked", async () => {
    const onOpen = vi.fn();
    render(<NoteBacklinks noteId="target" onOpen={onOpen} />);
    await waitFor(() => expect(screen.getByText("Note A")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Note A"));
    expect(onOpen).toHaveBeenCalledWith("a");
  });

  it("renders nothing when there are no backlinks", async () => {
    const mod = await import("../../../../features/links/link-index");
    (mod.getBacklinksForNote as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      [],
    );
    const { container } = render(
      <NoteBacklinks noteId="lonely" onOpen={() => {}} />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
