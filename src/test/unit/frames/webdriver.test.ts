// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  createSession,
  keyPressActions,
  type FetchLike,
  WebDriverError,
  isUnsupportedAction,
  type WebDriverSession,
  webdriverFramePage,
  webdriverKey,
} from "../../support/frames/webdriver";

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

/** A fetch stub: records each request and answers with `respond`'s status and JSON body. */
function fakeFetch(respond: (request: Recorded) => { status?: number; body: unknown }) {
  const requests: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const request: Recorded = {
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    requests.push(request);
    const reply = respond(request);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, requests };
}

/** A session that records `call`s and answers each with `respond`. No HTTP involved. */
function recordingSession(respond: (path: string, body: unknown) => unknown = () => null) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const session: WebDriverSession = {
    id: "session-1",
    async call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
      calls.push({ method, path, body });
      return respond(path, body) as T;
    },
  };
  return { session, calls };
}

describe("createSession and call", () => {
  it("posts the capabilities and uses the returned sessionId", async () => {
    const capabilities = { alwaysMatch: { "tauri:options": { application: "/opt/maibuk" } } };
    const { fetchImpl, requests } = fakeFetch(() => ({
      body: { value: { sessionId: "abc", capabilities: {} } },
    }));

    const session = await createSession("http://127.0.0.1:4444", capabilities, fetchImpl);

    expect(session.id).toBe("abc");
    expect(requests).toEqual([
      { url: "http://127.0.0.1:4444/session", method: "POST", body: { capabilities } },
    ]);
  });

  it("unwraps value from a call response and hits the session path", async () => {
    const { fetchImpl, requests } = fakeFetch((request) =>
      request.url.endsWith("/window/rect")
        ? { body: { value: { x: 0, y: 0, width: 800, height: 600 } } }
        : { body: { value: { sessionId: "abc", capabilities: {} } } }
    );
    const session = await createSession("http://127.0.0.1:4444", {}, fetchImpl);

    const rect = await session.call<{ width: number }>("GET", "/window/rect");

    expect(rect).toEqual({ x: 0, y: 0, width: 800, height: 600 });
    expect(requests[1]).toEqual({
      url: "http://127.0.0.1:4444/session/abc/window/rect",
      method: "GET",
      body: undefined,
    });
  });

  it("throws WebDriverError with status and W3C error code on a 404", async () => {
    const { fetchImpl } = fakeFetch((request) =>
      request.url.endsWith("/session")
        ? { body: { value: { sessionId: "abc", capabilities: {} } } }
        : { status: 404, body: { value: { error: "no such element", message: "x" } } }
    );
    const session = await createSession("http://127.0.0.1:4444", {}, fetchImpl);

    const error = await session
      .call("POST", "/element", { using: "css selector" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(WebDriverError);
    expect(error).toMatchObject({ status: 404, error: "no such element" });
    expect((error as Error).message).toContain("x");
  });
});

describe("webdriverKey", () => {
  it("passes single characters through", () => {
    expect(webdriverKey("a")).toBe("a");
    expect(webdriverKey("1")).toBe("1");
    expect(webdriverKey("+")).toBe("+");
  });

  it("maps named keys to W3C code points", () => {
    expect(webdriverKey("Enter")).toBe("");
    expect(webdriverKey("PageUp")).toBe("");
    expect(webdriverKey("ArrowDown")).toBe("");
    expect(webdriverKey("F6")).toBe("");
    expect(webdriverKey("F1")).toBe("");
    expect(webdriverKey("F12")).toBe("");
    expect(webdriverKey("Space")).toBe(" ");
  });

  it("maps ControlOrMeta to Control on Linux", () => {
    expect(webdriverKey("ControlOrMeta")).toBe("");
  });

  it("throws for an unknown key name, naming it", () => {
    expect(() => webdriverKey("Hyper")).toThrow(/Hyper/);
  });
});

describe("keyPressActions", () => {
  it("presses modifiers down in order and releases them in reverse", () => {
    expect(keyPressActions("ControlOrMeta+End")).toEqual([
      { type: "keyDown", value: "" },
      { type: "keyDown", value: "" },
      { type: "keyUp", value: "" },
      { type: "keyUp", value: "" },
    ]);
  });

  it("handles Shift+F6", () => {
    expect(keyPressActions("Shift+F6")).toEqual([
      { type: "keyDown", value: "" },
      { type: "keyDown", value: "" },
      { type: "keyUp", value: "" },
      { type: "keyUp", value: "" },
    ]);
  });

  it("treats a lone + as the plus key", () => {
    expect(keyPressActions("+")).toEqual([
      { type: "keyDown", value: "+" },
      { type: "keyUp", value: "+" },
    ]);
  });

  it("treats a trailing + after a modifier as the plus key", () => {
    expect(keyPressActions("Control++")).toEqual([
      { type: "keyDown", value: "" },
      { type: "keyDown", value: "+" },
      { type: "keyUp", value: "+" },
      { type: "keyUp", value: "" },
    ]);
  });

  it("presses a single character", () => {
    expect(keyPressActions("1")).toEqual([
      { type: "keyDown", value: "1" },
      { type: "keyUp", value: "1" },
    ]);
  });
});

describe("webdriverFramePage", () => {
  const origin = "http://localhost:4173";

  it("press sends one /actions call with the key source", async () => {
    const { session, calls } = recordingSession();
    const page = webdriverFramePage(session, { origin });

    await page.keyboard.press("Enter");

    expect(calls).toEqual([
      {
        method: "POST",
        path: "/actions",
        body: {
          actions: [
            {
              type: "key",
              id: "keyboard",
              actions: [
                { type: "keyDown", value: "" },
                { type: "keyUp", value: "" },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("type sends one /actions call per character", async () => {
    const { session, calls } = recordingSession();
    const page = webdriverFramePage(session, { origin });

    await page.keyboard.type("ab", { delay: 0 });

    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.path)).toEqual(["/actions", "/actions"]);
    expect(calls[1].body).toEqual({
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: "b" },
            { type: "keyUp", value: "b" },
          ],
        },
      ],
    });
  });

  it("gives every wheel tick its own source, so repeated ticks each scroll their full delta", async () => {
    // WebKitWebDriver dispatches only the change from a source's last delta:
    // on one source, a second +100 would scroll 0.
    const { session, calls } = recordingSession();
    const page = webdriverFramePage(session, { origin });

    await page.mouse.wheel(0, 100);
    await page.mouse.wheel(0, 100);

    const ids = calls.map((c) => (c.body as { actions: { id: string }[] }).actions[0].id);
    expect(ids).toEqual(["wheel-1", "wheel-2"]);
  });

  it("wheel scrolls at the last moved position", async () => {
    const { session, calls } = recordingSession();
    const page = webdriverFramePage(session, { origin });

    await page.mouse.move(120.4, 33.6);
    await page.mouse.wheel(0, 300);

    expect(calls[0].body).toEqual({
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [{ type: "pointerMove", duration: 0, x: 120, y: 34, origin: "viewport" }],
        },
      ],
    });
    expect(calls[1].body).toEqual({
      actions: [
        {
          type: "wheel",
          id: "wheel-1",
          actions: [
            {
              type: "scroll",
              x: 120,
              y: 34,
              deltaX: 0,
              deltaY: 300,
              duration: 0,
              origin: "viewport",
            },
          ],
        },
      ],
    });
  });

  it("goto posts the origin-resolved URL, waits for readyState, then runs afterNavigate", async () => {
    const afterNavigate = vi.fn(async () => {});
    const { session, calls } = recordingSession((path) =>
      path === "/execute/sync" ? "complete" : null
    );
    const page = webdriverFramePage(session, { origin, afterNavigate });

    await page.goto("/frames?scenario=1");

    expect(calls[0]).toEqual({
      method: "POST",
      path: "/url",
      body: { url: "http://localhost:4173/frames?scenario=1" },
    });
    expect(calls[1].path).toBe("/execute/sync");
    expect(afterNavigate).toHaveBeenCalledTimes(1);
  });

  it("evaluate unwraps ok and sends the argument", async () => {
    const { session, calls } = recordingSession(() => ({ ok: 42 }));
    const page = webdriverFramePage(session, { origin });

    const result = await page.evaluate((n: number) => n * 2, 21);

    expect(result).toBe(42);
    expect(calls[0].path).toBe("/execute/async");
    expect(calls[0].body).toMatchObject({ args: [21] });
  });

  it("evaluate throws the in-page error on err", async () => {
    const { session } = recordingSession(() => ({ err: "Error: boom" }));
    const page = webdriverFramePage(session, { origin });

    await expect(page.evaluate(() => 1)).rejects.toThrow("boom");
  });

  it("locator count sends a script with locateAll and the serialized steps", async () => {
    const { session, calls } = recordingSession(() => ({ ok: 2 }));
    const page = webdriverFramePage(session, { origin });

    const count = await page.locator("tr").count();

    expect(count).toBe(2);
    const body = calls[0].body as { script: string; args: unknown[] };
    expect(body.script).toContain("locateAll");
    expect(body.args[0]).toEqual([{ kind: "css", selector: "tr" }]);
  });

  it("describes a chained locator readably", () => {
    const { session } = recordingSession();
    const page = webdriverFramePage(session, { origin });

    const locator = page.getByRole("row", { name: /^Log 1\b/ }).first();

    expect(locator.toString()).toBe('getByRole("row", { name: /^Log 1\\b/ }).first()');
  });

  describe("isUnsupportedAction", () => {
    it("is true only for the driver refusing an input it does not implement", () => {
      expect(isUnsupportedAction(new WebDriverError(500, "unsupported operation", "wheel"))).toBe(
        true
      );
      expect(isUnsupportedAction(new WebDriverError(404, "unknown command", "x"))).toBe(true);
      expect(isUnsupportedAction(new WebDriverError(404, "no such element", "x"))).toBe(false);
      expect(isUnsupportedAction(new Error("unsupported operation"))).toBe(false);
    });
  });
});
