import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useVersionCheck } from "../../../../features/version/useVersionCheck";

describe("useVersionCheck()", () => {
  const GITHUB_API_URL = "https://api.github.com/repos/M4ss1ck/maibuk/tags";

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches latest version from GitHub tags", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve([{ name: "v2.0.0" }, { name: "v1.9.0" }]),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useVersionCheck("v1.0.0"));

    await waitFor(() => {
      expect(result.current.latestVersion).toBe("v2.0.0");
    });

    expect(mockFetch).toHaveBeenCalledWith(GITHUB_API_URL);
  });

  it("reports outdated when latest is newer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve([{ name: "v2.0.0" }]),
      })
    );

    const { result } = renderHook(() => useVersionCheck("v1.0.0"));

    await waitFor(() => {
      expect(result.current.isOutdated).toBe(true);
    });
  });

  it("reports not outdated when current matches latest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve([{ name: "v1.5.0" }]),
      })
    );

    const { result } = renderHook(() => useVersionCheck("v1.5.0"));

    await waitFor(() => {
      expect(result.current.latestVersion).toBe("v1.5.0");
    });

    expect(result.current.isOutdated).toBe(false);
  });

  it("reports not outdated when current is newer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve([{ name: "v1.0.0" }]),
      })
    );

    const { result } = renderHook(() => useVersionCheck("v2.0.0"));

    await waitFor(() => {
      expect(result.current.latestVersion).toBe("v1.0.0");
    });

    expect(result.current.isOutdated).toBe(false);
  });

  it("handles fetch errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const { result } = renderHook(() => useVersionCheck("v1.0.0"));

    // Should not crash, latestVersion stays null
    // Wait a tick to ensure the effect has run
    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.latestVersion).toBeNull();
    expect(result.current.isOutdated).toBe(false);
  });

  it("handles empty tags array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve([]),
      })
    );

    const { result } = renderHook(() => useVersionCheck("v1.0.0"));

    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.latestVersion).toBeNull();
    expect(result.current.isOutdated).toBe(false);
  });

  it("detects minor version updates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve([{ name: "v1.2.0" }]),
      })
    );

    const { result } = renderHook(() => useVersionCheck("v1.1.0"));

    await waitFor(() => {
      expect(result.current.isOutdated).toBe(true);
    });
  });

  it("detects patch version updates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: () => Promise.resolve([{ name: "v1.0.3" }]),
      })
    );

    const { result } = renderHook(() => useVersionCheck("v1.0.2"));

    await waitFor(() => {
      expect(result.current.isOutdated).toBe(true);
    });
  });
});
