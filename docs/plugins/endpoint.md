# Plugin Endpoint

The **Plugin Endpoint** is the local HTTP address where an outside program reaches a running Plugin: `http://127.0.0.1:<port>/plugin/<pluginId>/`. Maibuk accepts an HTTP request on that address and hands it to the Plugin its path names, and the Plugin answers it. An Agent, a script, or any other HTTP client on the same machine reaches the Plugin this way, so the Plugin needs no socket of its own.

The Plugin Endpoint exists on the desktop app only, and only while an enabled Plugin holds the `serve` Plugin Permission. With no such Plugin, Maibuk unbinds the port, so a request is refused at the connection instead of answered. When the port is bound, a request never reaches the wrong Plugin: one that is disabled, holds no `serve` grant, or is not running is answered 404 by Maibuk itself.

## Requesting `serve`

Declare `serve` in the manifest, under `permissions.required` or `permissions.optional`:

```json
"permissions": { "required": ["serve"], "optional": [] }
```

A required entry makes the author approve `serve` to enable the Plugin. An optional entry lets the author revoke it on its own, and a revoke takes effect at once with no restart: while another enabled Plugin still holds `serve` and keeps the port bound, the next request for the revoked Plugin is answered 404; when it was the last one, Maibuk unbinds the port and the connection is refused. A Plugin that is enabled and holds `serve` keeps the port bound whether or not its Worker is running, though a request it cannot answer yet is a 404 until it runs. The endpoint is desktop only, so on Android and in the web build a Plugin that holds `serve` still runs, but no port is bound and no request arrives.

## Reading the address

A Plugin holding `serve` reads its own base URL with `client.endpoint.address()`: `http://127.0.0.1:<port>/plugin/<pluginId>/`, or null while the Plugin Endpoint is not listening. Maibuk keeps no "moved" state: compare the address with the one you last showed and treat a different string as a move, such as showing "reconnect your Agents" or refilling pasted snippets.

Subscribe with `client.on("endpoint.addressChanged", listener)` to hear it whenever the bound port changes, including the endpoint going off and coming back. The current address arrives on subscription, so a Plugin that starts after a move never misses it. A Plugin without `serve` is refused both the read and the subscription with `permission-denied`.

## Answering a request

Register one handler with `client.onEndpointRequest`. The request comes from Maibuk, like a Command run, so it is not a Plugin-called method and it does not appear in the [Plugin API reference](api-reference.md). The one handler answers every request that reaches the Plugin, whatever the method and path:

```ts
import type { PluginClient, PluginEndpointAnswer } from "@maibuk/plugin-sdk";

export function answerEndpoint(client: PluginClient, pluginId: string, key: string): void {
  client.onEndpointRequest((request): PluginEndpointAnswer => {
    const authorized = request.headers.some(
      ([name, value]) => name === "authorization" && value === `Bearer ${key}`
    );
    if (!authorized) return { status: 401, body: "Missing or wrong Key" };
    if (request.method !== "POST" || request.path !== `/plugin/${pluginId}/tools/list`) {
      return { status: 404, body: "No such route" };
    }
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tools: [] }),
    };
  });
}
```

The request the handler receives:

| Field     | Value                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------ |
| `method`  | the HTTP method, uppercase, such as `GET` or `POST`                                               |
| `path`    | the full path, including the `/plugin/<pluginId>/` prefix and the query, such as `/plugin/acme/mcp?x=1` |
| `headers` | `[name, value]` pairs, with names lower-cased and duplicates kept in order                        |
| `body`    | the raw request bytes, as a `Uint8Array`                                                          |
| `text()`  | the same bytes decoded as UTF-8                                                                   |

The answer is `{ status, headers?, body? }`:

| Field     | Value                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------- |
| `status`  | the HTTP status code                                                                              |
| `headers` | optional response headers, as a `Record<string, string>` or `[name, value]` pairs                  |
| `body`    | optional `string`, `Uint8Array`, or `AsyncIterable<string \| Uint8Array>`                         |

An `AsyncIterable` body streams: Maibuk sends the head, then each piece as it arrives, with chunked transfer and no `Content-Length`. Any other body is sent whole, with a `Content-Length`. Maibuk sets the framing headers itself, so a `content-length`, `transfer-encoding`, `connection`, or `host` header in the answer is dropped. A Plugin that never called `onEndpointRequest` answers 404.

## What Maibuk checks first

Maibuk enforces the HTTP rules once, for every Plugin, before the Plugin sees anything. It checks them in this order:

| Check                                                                                   | Answer |
| --------------------------------------------------------------------------------------- | ------ |
| `Host` is missing, or names anything other than `127.0.0.1:<port>` or `localhost:<port>`       | 421    |
| `Origin` is present and is neither `http://127.0.0.1:<port>` nor `http://localhost:<port>` | 403    |
| the path names a Plugin that is disabled, holds no `serve` grant, or does not declare it | 404    |
| the path names an enabled Plugin that holds `serve` but is not running                   | 404    |
| the request body is over 4 MiB                                                           | 413    |

Then, once the request reaches the Plugin:

| Check                            | Answer |
| -------------------------------- | ------ |
| the handler throws               | 500    |
| no answer arrives within 30 s    | 504    |

A request with no `Origin` is allowed, because a program is not a page. The `Host` check is what stops a page that rebinds a name to `127.0.0.1`: it carries its own name in `Host` and is refused 421.

Maibuk does not authenticate the caller. The grant makes the Plugin reachable by any program running as the same user, so a Plugin that must keep other programs out checks its own auth, such as a bearer Key, on every request, as the example above does.

## Whole answers and streams

A whole, non-streamed answer travels as one message, and a Plugin to host message is capped at 4 MB. Base64 makes bytes a third larger on the wire, so a whole answer holds about 3 MB of body, and a larger one is answered 500. A streamed answer has no total: each piece is capped at 64 KB, and the SDK splits a bigger piece for you.

Stream any body that can grow, such as a long document, a page of results, or a log. A body of a few kilobytes is simpler to return whole.

## Testing

`createTestHost().endpoint()` hands the Plugin one request through the same host side the app routes with, and resolves with the answer, with no socket involved. It proves the route, the handler, and the answer, including a streamed one. See [Testing](testing.md#requesting-the-plugin-endpoint).

## The port

Maibuk picks the port once, keeps it, moves it only when another app holds it at launch, and binds the kept port again on every launch. The author never sees or sets it, and there is no port setting. Treat the port as something Maibuk owns: do not hardcode the number in anything you ship, and write setup text so an address that changes can be replaced. Read `endpoint.address` and listen to `endpoint.addressChanged` as described above.
