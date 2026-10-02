import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import githubReleases from "@/test/fixtures/releases/github-releases.json";
import {
  checkForNewerReleases,
  installReleaseCheck,
  newerReleasesFrom,
  RELEASE_CHECK_INTERVAL_MS,
  RELEASES_URL,
} from "@/features/releases/release-check";
import { compareReleaseNumbers, isNewerRelease } from "@/features/releases/compare";
import { useReleaseStore } from "@/features/releases/store";

function release(tag: string, extra: Record<string, unknown> = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    published_at: "2026-10-05T10:00:00Z",
    html_url: `https://github.com/M4ss1ck/maibuk/releases/tag/${tag}`,
    body: "### Fixed\n- Something",
    ...extra,
  };
}

function okResponse(payload: unknown): Response {
  return { ok: true, json: async () => payload } as Response;
}

beforeEach(() => {
  useReleaseStore.setState({ newerReleases: [], isNotesOpen: false });
});

describe("compareReleaseNumbers()", () => {
  it.each([
    ["v1.0.0", "v2.0.0", true],
    ["0.9.9", "0.10.0", true],
    ["v1.2.3", "1.2.3", false],
    ["v1", "v1.0.1", true],
    ["v1.3.0", "v1.2.9", false],
  ])("%s → %s newer: %s", (installed, candidate, newer) => {
    expect(isNewerRelease(candidate, installed)).toBe(newer);
  });

  it("sorts newest first when negated", () => {
    expect(["0.9.0", "0.10.1", "0.10.0"].sort((a, b) => compareReleaseNumbers(b, a))).toEqual([
      "0.10.1",
      "0.10.0",
      "0.9.0",
    ]);
  });
});

describe("newerReleasesFrom()", () => {
  it("keeps every published Release newer than the installed one, newest first", () => {
    const releases = newerReleasesFrom(
      [release("v0.10.0"), release("v0.11.0"), release("v0.10.2"), release("v0.10.1")],
      "v0.10.1"
    );
    expect(releases.map((r) => r.number)).toEqual(["0.11.0", "0.10.2"]);
    expect(releases[0]).toMatchObject({
      date: "2026-10-05",
      url: "https://github.com/M4ss1ck/maibuk/releases/tag/v0.11.0",
      sections: [{ kind: "fixed", items: [[{ kind: "text", text: "Something" }]] }],
    });
  });

  it("drops drafts, prereleases, and tags that are not Release numbers", () => {
    const releases = newerReleasesFrom(
      [
        release("v2.0.0", { draft: true }),
        release("v1.9.0", { prerelease: true }),
        release("nightly"),
        release("v1.1.0-beta.1"),
        { nonsense: true },
        null,
      ],
      "v1.0.0"
    );
    expect(releases).toEqual([]);
  });

  it("ignores a payload that is not a list (a rate-limit message)", () => {
    expect(newerReleasesFrom({ message: "API rate limit exceeded" }, "v1.0.0")).toEqual([]);
  });

  it("drops a non-https Release page", () => {
    const [only] = newerReleasesFrom(
      [release("v2.0.0", { html_url: "javascript:alert(1)" })],
      "v1.0.0"
    );
    expect(only.url).toBeUndefined();
  });

  it("reads the real GitHub payload", () => {
    const releases = newerReleasesFrom(githubReleases, "v0.9.0");
    expect(releases.map((r) => r.number)).toEqual(["0.10.1", "0.10.0"]);
    expect(releases[0].sections.map((s) => s.kind)).toEqual(["added", "changed", "fixed"]);
  });
});

describe("checkForNewerReleases()", () => {
  it("asks for Releases, not tags, and stores the newer ones", async () => {
    const fetchImpl = vi.fn(async () => okResponse([release("v9.0.0")]));
    await checkForNewerReleases(fetchImpl, "v1.0.0");
    expect(fetchImpl).toHaveBeenCalledWith(RELEASES_URL, expect.anything());
    expect(RELEASES_URL).toContain("/releases");
    expect(useReleaseStore.getState().newerReleases.map((r) => r.number)).toEqual(["9.0.0"]);
  });

  it("keeps what the last check found when the request fails", async () => {
    await checkForNewerReleases(async () => okResponse([release("v9.0.0")]), "v1.0.0");
    await checkForNewerReleases(async () => {
      throw new TypeError("offline");
    }, "v1.0.0");
    await checkForNewerReleases(async () => ({ ok: false }) as Response, "v1.0.0");
    expect(useReleaseStore.getState().newerReleases.map((r) => r.number)).toEqual(["9.0.0"]);
  });

  it("clears the list once the installed Release is the newest", async () => {
    useReleaseStore.setState({
      newerReleases: [{ number: "9.0.0", date: null, sections: [] }],
    });
    await checkForNewerReleases(async () => okResponse([release("v9.0.0")]), "v9.0.0");
    expect(useReleaseStore.getState().newerReleases).toEqual([]);
  });
});

describe("installReleaseCheck()", () => {
  let visibility: DocumentVisibilityState = "visible";
  let uninstall: () => void = () => {};

  beforeEach(() => {
    visibility = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
  });

  function setVisibility(state: DocumentVisibilityState) {
    visibility = state;
    document.dispatchEvent(new Event("visibilitychange"));
  }

  it("never checks on the web build", () => {
    const fetchImpl = vi.fn(async () => okResponse([]));
    uninstall = installReleaseCheck({ fetchImpl, isWeb: true });
    setVisibility("visible");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks at launch and again on return only after 30 minutes", async () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => okResponse([]));
    uninstall = installReleaseCheck({ fetchImpl, now: () => clock, isWeb: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // Let the first check settle, so it is no longer in flight.
    await new Promise((resolve) => setTimeout(resolve, 0));

    clock = RELEASE_CHECK_INTERVAL_MS - 1;
    setVisibility("hidden");
    setVisibility("visible");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock = RELEASE_CHECK_INTERVAL_MS;
    setVisibility("hidden");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not start a second check while one is in flight", () => {
    let clock = 0;
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    uninstall = installReleaseCheck({ fetchImpl, now: () => clock, isWeb: false });
    clock = RELEASE_CHECK_INTERVAL_MS * 3;
    setVisibility("visible");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops listening once uninstalled", () => {
    let clock = 0;
    const fetchImpl = vi.fn(async () => okResponse([]));
    installReleaseCheck({ fetchImpl, now: () => clock, isWeb: false })();
    clock = RELEASE_CHECK_INTERVAL_MS * 3;
    setVisibility("visible");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
