// A FramePage (e2e/frames/frame-page.ts) over W3C WebDriver, for the desktop
// frame-rate source: tauri-driver proxies WebDriver to the Tauri binary on
// 127.0.0.1. Node and global fetch only; no dependencies.

import { setTimeout as sleep } from "node:timers/promises";
import type { FrameLocator, FramePage, RoleOptions } from "../../../../e2e/frames/frame-page";
import { type LocateStep, locateAll, serializableName } from "./locate";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class WebDriverError extends Error {
  readonly status: number;
  readonly error: string;

  constructor(status: number, error: string, message: string) {
    super(`${error}: ${message}`);
    this.name = "WebDriverError";
    this.status = status;
    this.error = error;
  }
}

/** W3C error codes for an action or command this driver does not implement. */
const UNSUPPORTED = new Set(["unsupported operation", "unknown command", "unknown method"]);

/**
 * Whether `error` is the driver refusing an input it does not implement (a
 * wheel source, a pointer type). The desktop source reports such a scenario
 * `unmeasured` with the reason; it never fakes the input with DOM events.
 */
export function isUnsupportedAction(error: unknown): error is WebDriverError {
  return error instanceof WebDriverError && UNSUPPORTED.has(error.error);
}

export interface WebDriverSession {
  readonly id: string;
  call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

async function send(
  fetchImpl: FetchLike,
  method: "GET" | "POST" | "DELETE",
  url: string,
  body?: unknown
): Promise<unknown> {
  const res = await fetchImpl(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { value: { error: "unknown error", message: text } };
  }
  const value = isRecord(json) && "value" in json ? json.value : json;
  if (!res.ok) {
    const detail = isRecord(value) ? value : {};
    const error = typeof detail.error === "string" ? detail.error : "unknown error";
    const message = typeof detail.message === "string" ? detail.message : text;
    throw new WebDriverError(res.status, error, message);
  }
  return value;
}

function makeSession(baseUrl: string, id: string, fetchImpl: FetchLike): WebDriverSession {
  return {
    id,
    call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
      const payload = method === "POST" ? (body ?? {}) : undefined;
      return send(fetchImpl, method, `${baseUrl}/session/${id}${path}`, payload) as Promise<T>;
    },
  };
}

/** Starts a session. `capabilities` is the W3C object, e.g. `{ alwaysMatch: {...} }`. */
export async function createSession(
  baseUrl: string,
  capabilities: Record<string, unknown>,
  fetchImpl: FetchLike = fetch
): Promise<WebDriverSession> {
  const created = await send(fetchImpl, "POST", `${baseUrl}/session`, { capabilities });
  const sessionId = isRecord(created) ? created.sessionId : undefined;
  if (typeof sessionId !== "string") {
    throw new Error(`POST /session returned no sessionId: ${JSON.stringify(created)}`);
  }
  return makeSession(baseUrl, sessionId, fetchImpl);
}

export async function deleteSession(session: WebDriverSession): Promise<void> {
  await session.call("DELETE", "");
}

// W3C WebDriver code points for named keys (https://w3c.github.io/webdriver/#keyboard-actions).
const NAMED_KEYS = new Map<string, string>([
  ["Backspace", ""],
  ["Tab", ""],
  ["Enter", ""],
  ["Shift", ""],
  ["Control", ""],
  ["Alt", ""],
  ["Escape", ""],
  ["PageUp", ""],
  ["PageDown", ""],
  ["End", ""],
  ["Home", ""],
  ["ArrowLeft", ""],
  ["ArrowUp", ""],
  ["ArrowRight", ""],
  ["ArrowDown", ""],
  ["Delete", ""],
  ["Meta", ""],
  ["Space", " "],
  // Linux has no Meta key for the app shortcut; Control is the platform modifier.
  ["ControlOrMeta", ""],
  ...Array.from({ length: 12 }, (_, i): [string, string] => [
    `F${i + 1}`,
    String.fromCodePoint(0xe031 + i),
  ]),
]);

/** One Playwright key name as its WebDriver value. */
export function webdriverKey(name: string): string {
  if (name.length === 1) return name;
  const value = NAMED_KEYS.get(name);
  if (value === undefined) throw new Error(`Unknown key name for WebDriver: "${name}"`);
  return value;
}

/**
 * A Playwright combo ("Shift+F6", "ControlOrMeta+End", "+") as W3C key actions:
 * every key down in order, then every key up in reverse.
 */
export function keyPressActions(combo: string): { type: "keyDown" | "keyUp"; value: string }[] {
  // A trailing "+" is the plus key itself ("+" alone, or "Control++").
  const parts = combo.endsWith("+")
    ? [...(combo.length > 1 ? combo.slice(0, -2).split("+") : []), "+"]
    : combo.split("+");
  const values = parts.map(webdriverKey);
  return [
    ...values.map((value) => ({ type: "keyDown" as const, value })),
    ...values
      .slice()
      .reverse()
      .map((value) => ({ type: "keyUp" as const, value })),
  ];
}

/**
 * Runs `body` in the page as an async script. The envelope is `{ ok }` or
 * `{ err }`; an `err` rejects here with the in-page stack.
 */
async function runInPage<R>(
  session: WebDriverSession,
  prelude: string,
  body: string,
  args: unknown[]
): Promise<R> {
  const script =
    `var __name = (f) => f; ${prelude}const done = arguments[arguments.length - 1]; ` +
    `Promise.resolve().then(() => { ${body} }).then((v) => done({ ok: v === undefined ? null : v }), ` +
    `(e) => done({ err: String(e && e.stack || e) }));`;
  const result = await session.call<{ ok?: R; err?: string }>("POST", "/execute/async", {
    script,
    args,
  });
  if (result.err !== undefined) throw new Error(result.err);
  return result.ok as R;
}

function roleLabel(role: string, options?: RoleOptions): string {
  const props: string[] = [];
  const name = options?.name;
  if (name !== undefined) {
    props.push(`name: ${typeof name === "string" ? JSON.stringify(name) : String(name)}`);
  }
  if (options?.exact !== undefined) props.push(`exact: ${options.exact}`);
  if (options?.selected !== undefined) props.push(`selected: ${options.selected}`);
  if (options?.level !== undefined) props.push(`level: ${options.level}`);
  const args = [JSON.stringify(role)];
  if (props.length > 0) args.push(`{ ${props.join(", ")} }`);
  return `getByRole(${args.join(", ")})`;
}

function makeLocator(
  session: WebDriverSession,
  steps: LocateStep[],
  labels: string[]
): FrameLocator {
  const extend = (step: LocateStep, label: string) =>
    makeLocator(session, [...steps, step], [...labels, label]);

  return {
    getByRole(role, options) {
      return extend(
        {
          kind: "role",
          role,
          name: serializableName(options?.name),
          exact: options?.exact,
          selected: options?.selected,
          level: options?.level,
        },
        roleLabel(role, options)
      );
    },
    locator(css) {
      return extend({ kind: "css", selector: css }, `locator(${JSON.stringify(css)})`);
    },
    first() {
      return extend({ kind: "first" }, "first()");
    },
    visible() {
      return extend({ kind: "visible" }, "visible()");
    },
    evaluate<R, A = undefined>(fn: (el: Element, arg: A) => R, arg?: A): Promise<R> {
      return runInPage<R>(
        session,
        `const locateAll = ${locateAll.toString()}; `,
        `const els = locateAll(arguments[0]); ` +
          `if (els.length === 0) throw new Error("no element matches " + arguments[2]); ` +
          `return (${fn.toString()})(els[0], arguments[1]);`,
        [steps, arg ?? null, labels.join(".")]
      );
    },
    count() {
      return runInPage<number>(
        session,
        `const locateAll = ${locateAll.toString()}; `,
        `return locateAll(arguments[0]).length;`,
        [steps]
      );
    },
    toString() {
      return labels.length > 0 ? labels.join(".") : "page";
    },
  };
}

export function webdriverFramePage(
  session: WebDriverSession,
  options: { origin: string; afterNavigate?: () => Promise<void> }
): FramePage {
  const pointer = { x: 0, y: 0 };
  let wheelTicks = 0;
  const perform = (source: unknown) =>
    session.call<null>("POST", "/actions", { actions: [source] });
  const mouseSource = (action: unknown) => ({
    type: "pointer",
    id: "mouse",
    parameters: { pointerType: "mouse" },
    actions: [action],
  });
  const root = () => makeLocator(session, [], []);

  return {
    keyboard: {
      press: (combo) =>
        perform({ type: "key", id: "keyboard", actions: keyPressActions(combo) }).then(
          () => undefined
        ),
      async type(text, opts) {
        for (const ch of text) {
          await perform({
            type: "key",
            id: "keyboard",
            actions: [
              { type: "keyDown", value: ch },
              { type: "keyUp", value: ch },
            ],
          });
          await sleep(opts?.delay ?? 0);
        }
      },
    },
    mouse: {
      async move(x, y) {
        pointer.x = Math.round(x);
        pointer.y = Math.round(y);
        await perform(
          mouseSource({
            type: "pointerMove",
            duration: 0,
            x: pointer.x,
            y: pointer.y,
            origin: "viewport",
          })
        );
      },
      async down() {
        await perform(mouseSource({ type: "pointerDown", button: 0 }));
      },
      async up() {
        await perform(mouseSource({ type: "pointerUp", button: 0 }));
      },
      async wheel(dx, dy) {
        // A fresh source per tick: WebKitWebDriver keeps a wheel source's last
        // delta and dispatches only the change from it, so ten +400 ticks on
        // one source scroll 400 px, and a +100 after them scrolls back 300.
        wheelTicks += 1;
        await perform({
          type: "wheel",
          id: `wheel-${wheelTicks}`,
          actions: [
            {
              type: "scroll",
              x: pointer.x,
              y: pointer.y,
              deltaX: Math.round(dx),
              deltaY: Math.round(dy),
              duration: 0,
              origin: "viewport",
            },
          ],
        });
      },
    },
    evaluate<R, A = undefined>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R> {
      return runInPage<R>(session, "", `return (${fn.toString()})(arguments[0]);`, [arg ?? null]);
    },
    getByRole: (role, opts) => root().getByRole(role, opts),
    getByText(text, opts) {
      const exact = opts?.exact;
      const label = `getByText(${JSON.stringify(text)}${exact ? ", { exact: true }" : ""})`;
      return makeLocator(session, [{ kind: "text", text, exact }], [label]);
    },
    locator: (css) => root().locator(css),
    async goto(path) {
      await session.call("POST", "/url", { url: new URL(path, options.origin).href });
      const deadline = Date.now() + 30_000;
      let lastError: unknown;
      for (;;) {
        try {
          const state = await session.call<string>("POST", "/execute/sync", {
            script: "return document.readyState",
            args: [],
          });
          if (state === "complete") break;
        } catch (error) {
          lastError = error;
        }
        if (Date.now() > deadline) {
          throw new Error(
            `timed out after 30000 ms loading ${path}; last error: ${String(lastError)}`
          );
        }
        await sleep(50);
      }
      await options.afterNavigate?.();
    },
  };
}
