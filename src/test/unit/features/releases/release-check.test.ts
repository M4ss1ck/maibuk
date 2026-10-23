import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import githubReleases from "@/test/fixtures/releases/github-releases.json";
import {
  checkForNewerReleases,
  fetchLocalizedReleaseNotes,
  installReleaseCheck,
  loadLocalizedNewerReleases,
  localizedReleaseNotesUrl,
  newerReleasesFrom,
  RELEASE_CHECK_INTERVAL_MS,
  RELEASES_URL,
} from "@/features/releases/release-check";
import { compareReleaseNumbers, isNewerRelease } from "@/features/releases/compare";
import type { ReleaseNotes } from "@/features/releases/release-notes";
import { newerReleasesIn, useReleaseStore } from "@/features/releases/store";

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

function okText(text: string): Response {
  return { ok: true, status: 200, text: async () => text } as Response;
}

const SPANISH_FILE = "## [9.0.0] - 2026-10-05\n\n### Fixed\n- Corrige algo";

beforeEach(async () => {
  useReleaseStore.setState({
    newerReleases: [],
    localizedNewerReleases: new Map(),
    isNotesOpen: false,
  });
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
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

  it("fetches the app language's notes for the newest newer Release, once", async () => {
    await i18n.changeLanguage("es");
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === RELEASES_URL
        ? okResponse([release("v8.0.0"), release("v9.0.0")])
        : okText(SPANISH_FILE)
    );

    await checkForNewerReleases(fetchImpl, "v1.0.0");

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      RELEASES_URL,
      localizedReleaseNotesUrl("v9.0.0", "es"),
    ]);
    expect(useReleaseStore.getState().localizedNewerReleases.get("es")?.has("9.0.0")).toBe(true);
  });

  it("asks for no changelog in English", async () => {
    const fetchImpl = vi.fn(async () => okResponse([release("v9.0.0")]));

    await checkForNewerReleases(fetchImpl, "v1.0.0");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(RELEASES_URL, expect.anything());
  });
});

describe("fetchLocalizedReleaseNotes()", () => {
  it("reads that language's changelog at the Release tag", async () => {
    const fetchImpl = vi.fn(async () => okText(SPANISH_FILE));

    const notes = await fetchLocalizedReleaseNotes("es-ES", "v9.0.0", fetchImpl);

    const url = localizedReleaseNotesUrl("v9.0.0", "es");
    expect(url).toBe(
      "https://raw.githubusercontent.com/M4ss1ck/maibuk/v9.0.0/CHANGELOG.es.md"
    );
    expect(fetchImpl).toHaveBeenCalledWith(url);
    expect(notes.get("9.0.0")?.sections).toEqual([
      { kind: "fixed", items: [[{ kind: "text", text: "Corrige algo" }]] },
    ]);
  });

  it("makes no request in English", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchLocalizedReleaseNotes("en", "v9.0.0", fetchImpl)).toEqual(new Map());
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("answers an empty map when the request fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    expect(await fetchLocalizedReleaseNotes("es", "v9.0.0", fetchImpl)).toEqual(new Map());
  });

  it("answers an empty map on a 404", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }) as Response);
    expect(await fetchLocalizedReleaseNotes("fr", "v9.0.0", fetchImpl)).toEqual(new Map());
  });

  it("answers an empty map when the file does not parse", async () => {
    const fetchImpl = vi.fn(async () => okText("## [9.0.0]\n\na line outside the grammar\n"));
    expect(await fetchLocalizedReleaseNotes("es", "v9.0.0", fetchImpl)).toEqual(new Map());
  });
});

describe("loadLocalizedNewerReleases()", () => {
  it("loads a language on demand without asking for Releases", async () => {
    useReleaseStore.setState({
      newerReleases: [{ number: "9.0.0", date: null, sections: [] }],
    });
    const fetchImpl = vi.fn(async () => okText(SPANISH_FILE));

    await loadLocalizedNewerReleases("es", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(localizedReleaseNotesUrl("v9.0.0", "es"));
    expect(useReleaseStore.getState().localizedNewerReleases.get("es")?.has("9.0.0")).toBe(true);
  });

  it("asks once for a language and Release it already has", async () => {
    useReleaseStore.setState({
      newerReleases: [{ number: "9.0.0", date: null, sections: [] }],
    });
    const fetchImpl = vi.fn(async () => okText(SPANISH_FILE));

    await loadLocalizedNewerReleases("es", fetchImpl);
    await loadLocalizedNewerReleases("es", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a failed request on the next load instead of caching the empty result", async () => {
    useReleaseStore.setState({
      newerReleases: [{ number: "9.0.0", date: null, sections: [] }],
    });
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError("offline");
      return okText(SPANISH_FILE);
    });

    await loadLocalizedNewerReleases("es", fetchImpl);
    expect(useReleaseStore.getState().localizedNewerReleases.has("es")).toBe(false);

    await loadLocalizedNewerReleases("es", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(useReleaseStore.getState().localizedNewerReleases.get("es")?.has("9.0.0")).toBe(true);
  });

  it("retries a non-404 error response on the next load", async () => {
    useReleaseStore.setState({
      newerReleases: [{ number: "9.0.0", date: null, sections: [] }],
    });
    let attempt = 0;
    const fetchImpl = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, status: 503 } as Response;
      return okText(SPANISH_FILE);
    });

    await loadLocalizedNewerReleases("es", fetchImpl);
    expect(useReleaseStore.getState().localizedNewerReleases.has("es")).toBe(false);

    await loadLocalizedNewerReleases("es", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(useReleaseStore.getState().localizedNewerReleases.get("es")?.has("9.0.0")).toBe(true);
  });

  it("keeps a 404 cached, so a missing file is not requested again", async () => {
    useReleaseStore.setState({
      newerReleases: [{ number: "9.0.0", date: null, sections: [] }],
    });
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }) as Response);

    await loadLocalizedNewerReleases("es", fetchImpl);
    await loadLocalizedNewerReleases("es", fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(useReleaseStore.getState().localizedNewerReleases.get("es")?.size).toBe(0);
  });

  it("does nothing in English and with no newer Release", async () => {
    const fetchImpl = vi.fn(async () => okText(SPANISH_FILE));

    await loadLocalizedNewerReleases("es", fetchImpl);
    await loadLocalizedNewerReleases("en", fetchImpl);

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("newerReleasesIn()", () => {
  const english: ReleaseNotes = {
    number: "9.0.0",
    date: "2026-10-05",
    url: "https://github.com/M4ss1ck/maibuk/releases/tag/v9.0.0",
    sections: [{ kind: "fixed", items: [[{ kind: "text", text: "Fixed it" }]] }],
  };
  const other: ReleaseNotes = {
    number: "8.0.0",
    date: null,
    sections: [{ kind: "fixed", items: [[{ kind: "text", text: "Fixed that" }]] }],
  };

  it("replaces the notes a language has and keeps that Release's page", () => {
    const localized = new Map([
      ["9.0.0", { number: "9.0.0", date: "2026-10-05", sections: [] }],
    ]);
    expect(newerReleasesIn([english, other], localized)).toEqual([
      { ...english, sections: [] },
      other,
    ]);
  });

  it("keeps every English body when the language has nothing", () => {
    expect(newerReleasesIn([english, other], undefined)).toEqual([english, other]);
    expect(newerReleasesIn([english, other], new Map())).toEqual([english, other]);
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

  /**
   * Resolves once the next check that starts after this call has stored its
   * result. Call it right after installing, before the fetch can settle.
   */
  function nextCheckStored(): Promise<void> {
    const before = useReleaseStore.getState().newerReleases;
    return vi.waitFor(() =>
      expect(useReleaseStore.getState().newerReleases).not.toBe(before)
    );
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
    const launchCheckStored = nextCheckStored();
    uninstall = installReleaseCheck({ fetchImpl, now: () => clock, isWeb: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    // The in-flight flag clears a microtask after the result is stored, so the
    // timing checks below run with no check in flight.
    await launchCheckStored;

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
