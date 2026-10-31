/**
 * The host side of `network.fetch`: it fetches a URL on a host the broker has
 * already allowed, injects named secrets into the headers the Plugin declared,
 * and streams the response body back as chunks. A secret's value is written
 * only into the outgoing request; it never enters the response head, a chunk,
 * or an error message.
 *
 * The broker owns which hosts are reachable and the stream envelope; this
 * module owns the request and the body.
 */

import type { PluginSecretStore } from "@/features/plugins/secret-store";
import type {
  PluginApiChunk,
  PluginApiInput,
  PluginApiOutput,
  PluginStreamResult,
} from "@/features/plugins/types";
import type { PluginFetchAdapter } from "@/lib/platform/types";
import {
  PLUGIN_STREAM_CHUNK_MAX_BYTES,
  PluginApiError,
  utf8ByteLength,
} from "@/plugin-sdk/protocol";

type FetchChunk = PluginApiChunk<"network.fetch">;
type FetchOutput = PluginApiOutput<"network.fetch">;

/** What one `network.fetch` call needs to run. */
export interface PluginFetchContext {
  pluginId: string;
  /** The registered secret store, read only to fill a declared header. */
  store: PluginSecretStore;
  /** The platform fetch; the broker is the host gate, not this adapter. */
  fetch: PluginFetchAdapter;
  /** An external cancellation; aborts the request when it fires. */
  signal?: AbortSignal;
}

function invalidParams(message: string): PluginApiError {
  return new PluginApiError({ code: "invalid-params", message });
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** A transport failure. The message names the host, never a header value. */
function networkError(url: string): PluginApiError {
  return new PluginApiError({ code: "network-error", message: `Could not fetch ${hostOf(url)}` });
}

/**
 * The outgoing headers: the Plugin's own first, then one per `secretHeaders`
 * entry. A secret the store does not hold refuses the call before any request
 * is sent; a secret header that would override one the Plugin set refuses too.
 */
async function buildHeaders(
  params: PluginApiInput<"network.fetch">,
  { pluginId, store }: PluginFetchContext
): Promise<Headers> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(params.headers ?? {})) headers.set(name, value);
  for (const [headerName, secretName] of Object.entries(params.secretHeaders ?? {})) {
    if (headers.has(headerName)) {
      throw invalidParams(`Header ${headerName} is already set, so it cannot name a secret`);
    }
    const value = await store.read(pluginId, secretName);
    if (value === null) throw invalidParams(`secret ${secretName} is not set`);
    headers.set(headerName, value);
  }
  return headers;
}

/** One code point's JSON-serialized byte cost and its UTF-16 width at `index`. */
function serializedCost(text: string, index: number): { bytes: number; width: number } {
  const code = text.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    const next = text.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return { bytes: 4, width: 2 };
  }
  // A lone surrogate is escaped as `\uXXXX`.
  if (code >= 0xd800 && code <= 0xdfff) return { bytes: 6, width: 1 };
  if (code === 0x22 || code === 0x5c) return { bytes: 2, width: 1 }; // " and \
  if (code < 0x20) {
    // `\b` `\t` `\n` `\f` `\r` are two bytes; every other control char is `\uXXXX`.
    if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      return { bytes: 2, width: 1 };
    }
    return { bytes: 6, width: 1 };
  }
  if (code < 0x80) return { bytes: 1, width: 1 };
  if (code < 0x800) return { bytes: 2, width: 1 };
  return { bytes: 3, width: 1 };
}

/**
 * The bytes `JSON.stringify` adds around one chunk's text: the `{"text":""}`
 * envelope the broker measures. ASCII, so its length is its UTF-8 byte length.
 */
const CHUNK_ENVELOPE_BYTES = utf8ByteLength(JSON.stringify({ text: "" }));

/**
 * Splits one decoded piece at code-point boundaries so that every part's
 * serialized `{"text":"…"}` chunk is within the stream chunk size once JSON
 * escaping (quotes, backslashes, control characters, lone surrogates) is
 * counted, and no surrogate pair is cut in half. One O(n) pass: each code
 * point's serialized cost is added incrementally, never re-stringified.
 */
function splitChunk(text: string): string[] {
  if (text.length === 0) return [];
  const budget = PLUGIN_STREAM_CHUNK_MAX_BYTES - CHUNK_ENVELOPE_BYTES;
  const parts: string[] = [];
  let start = 0;
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    const { bytes: size, width } = serializedCost(text, index);
    if (bytes + size > budget) {
      parts.push(text.slice(start, index));
      start = index;
      bytes = 0;
    }
    bytes += size;
    index += width;
  }
  parts.push(text.slice(start));
  return parts;
}

function readHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

/**
 * The response body as chunks: each read is decoded and yielded as soon as it
 * arrives, so a Server-Sent Events stream is delivered live rather than only
 * once 64 KB has piled up. Cancelling (a `return` on the iterator) aborts the
 * underlying request, which is how a stopped Plugin closes the connection.
 */
function bodyOf(
  response: Response,
  controller: AbortController,
  url: string
): AsyncIterable<FetchChunk> {
  const stream = response.body;
  return {
    [Symbol.asyncIterator](): AsyncIterator<FetchChunk> {
      if (!stream) {
        return { next: () => Promise.resolve({ done: true, value: undefined }) };
      }
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let queue: string[] = [];
      let ended = false;

      return {
        async next(): Promise<IteratorResult<FetchChunk>> {
          while (queue.length === 0) {
            if (ended) return { done: true, value: undefined };
            let step: ReadableStreamReadResult<Uint8Array>;
            try {
              step = await reader.read();
            } catch {
              throw networkError(url);
            }
            queue = splitChunk(
              step.done ? decoder.decode() : decoder.decode(step.value, { stream: true })
            );
            if (step.done) ended = true;
          }
          const text = queue.shift() as string;
          return { done: false, value: { text } };
        },
        async return(): Promise<IteratorResult<FetchChunk>> {
          ended = true;
          controller.abort();
          try {
            await reader.cancel();
          } catch {
            // The request is already torn down; there is nothing left to cancel.
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}

function linkSignal(external: AbortSignal | undefined, controller: AbortController): void {
  if (!external) return;
  if (external.aborted) {
    controller.abort();
    return;
  }
  external.addEventListener("abort", () => controller.abort(), { once: true });
}

/**
 * A redirect response. The web build's `fetch` rejects it (because of
 * `redirect: "error"`), but the desktop http plugin only stops following and
 * returns the 3xx, so the status is checked here to make both platforms agree.
 */
function redirectRefused(): PluginApiError {
  return new PluginApiError({ code: "network-error", message: "redirect refused" });
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399 && status !== 304;
}

/**
 * Runs one `network.fetch`: refuses a request whose named secret is missing,
 * fetches, and returns the response head plus its streamed body. Redirects are
 * refused — the request carries `redirect: "error"`, and a 3xx response (any
 * 300-399 except 304 Not Modified) is turned into a `network-error` and its
 * body cancelled, so the desktop http plugin (which ignores `redirect` and,
 * with `maxRedirections: 0`, only stops following) behaves like the web. A
 * granted host therefore cannot forward the request, or an injected secret
 * header, to a host the Plugin was never granted. A transport failure (DNS,
 * refused, CORS, a refused redirect, an abort before the head) is a
 * `network-error`; any other HTTP 4xx/5xx is not an error, it is the head.
 */
export async function pluginFetch(
  params: PluginApiInput<"network.fetch">,
  context: PluginFetchContext
): Promise<PluginStreamResult<FetchOutput, FetchChunk>> {
  const headers = await buildHeaders(params, context);
  const controller = new AbortController();
  linkSignal(context.signal, controller);

  let response: Response;
  try {
    response = await context.fetch(params.url, {
      method: params.method ?? "GET",
      headers,
      body: params.body,
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw networkError(params.url);
  }

  if (isRedirect(response.status)) {
    controller.abort();
    try {
      await response.body?.cancel();
    } catch {
      // The response is already torn down; there is nothing left to cancel.
    }
    throw redirectRefused();
  }

  return {
    result: {
      status: response.status,
      statusText: response.statusText,
      headers: readHeaders(response.headers),
    },
    body: bodyOf(response, controller, params.url),
  };
}
