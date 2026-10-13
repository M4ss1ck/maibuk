// The Node-side request recorder for the @sandbox lane (issue #446): a plain
// node:http server the E2E global setup starts on a free port (0), so the
// fixture-hostile Plugin's escape targets reach it and two runs never clash.
// Every incoming request and every WebSocket upgrade is appended as one JSON
// line to `e2e/.output/request-log-<port>.jsonl`, a file unique to this run and
// truncated at setup. It answers 200 with a short body, so an escape that
// reaches it is recorded, not refused.
//
// The origin and the file are published to the test workers through the
// environment (`E2E_REQUEST_LOG_URL` / `E2E_REQUEST_LOG_FILE`); Playwright
// forks its workers after global setup runs, so they inherit both. The fixture
// bundle gets the origin at build time instead (a Vite `define`). The pass rule
// is that the file stays empty: a spec reads it from Node with
// `loggedRequests`, never with `page.evaluate`. The recorder is on 127.0.0.1,
// the one origin the hermetic network lets through, so the plugin CSP is the
// only thing between the sandbox and this log.

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve } from "node:path";

const OUTPUT_DIR = resolve(import.meta.dirname, "..", ".output");

/** The env var the recorder's origin is published under, for the test workers. */
export const REQUEST_LOG_URL_ENV = "E2E_REQUEST_LOG_URL";
/** The env var the recorder's log file is published under, for the test workers. */
export const REQUEST_LOG_FILE_ENV = "E2E_REQUEST_LOG_FILE";

/** One recorded request or WebSocket upgrade. */
export interface LoggedRequest {
  method: string;
  url: string;
  ts: number;
}

/** A running recorder: where escapes target it and the file it writes. */
export interface RequestLogServer {
  /** The recorder's origin, e.g. `http://127.0.0.1:53111`. */
  origin: string;
  /** The log file for this run, unique to the bound port. */
  file: string;
  /** Stops the recorder. */
  close(): Promise<void>;
}

/**
 * Starts the recorder on a free port, truncates this run's log, and publishes
 * the origin and file to `process.env` for the workers. Answers every request
 * 200 with a short `text/javascript` body; records an upgrade and drops its
 * socket. The returned `close` is the global teardown.
 */
export function startRequestLog(): Promise<RequestLogServer> {
  return new Promise((resolveServer, reject) => {
    let file = "";
    const record = (entry: LoggedRequest): void => {
      if (file !== "") appendFileSync(file, `${JSON.stringify(entry)}\n`);
    };
    const server = createServer((request, response) => {
      record({ method: request.method ?? "GET", url: request.url ?? "", ts: Date.now() });
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end("// recorded\n");
    });
    server.on("upgrade", (request, socket) => {
      record({ method: request.method ?? "GET", url: request.url ?? "", ts: Date.now() });
      socket.destroy();
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      const origin = `http://127.0.0.1:${port}`;
      file = resolve(OUTPUT_DIR, `request-log-${port}.jsonl`);
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(file, "");
      process.env[REQUEST_LOG_URL_ENV] = origin;
      process.env[REQUEST_LOG_FILE_ENV] = file;
      resolveServer({
        origin,
        file,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Reads this run's request log (Node fs, never `page.evaluate`). Throws when
 * the recorder did not publish its file, so a broken wiring fails loudly rather
 * than reading as "no leaks"; a truncated (empty) file returns `[]`.
 */
export async function loggedRequests(): Promise<LoggedRequest[]> {
  const file = process.env[REQUEST_LOG_FILE_ENV];
  if (file === undefined || file === "") {
    throw new Error(`${REQUEST_LOG_FILE_ENV} is unset: the request recorder did not start`);
  }
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as LoggedRequest);
}
