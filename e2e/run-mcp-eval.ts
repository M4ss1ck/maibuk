// `pnpm eval:mcp [options]`: the MCP Server Agent eval (#595). For each task
// it starts the real MCP Server Plugin over a fresh fixture Library (the
// Plugin test kit, loaded through Vite SSR), opens a real HTTP listener in
// front of its Plugin Endpoint, runs one headless Claude Code session against
// it, reads the Library back, and judges the task: every check must hold and
// the MCP tokens must stay within the task's budget. Prints the table, writes
// the JSON report and each task's wire log under `.bench/`, and exits 0 all
// passed, 1 a task failed, 2 a task could not be measured (no `claude`, a
// crash, a timeout). Paid and never in CI: each task is a real model session.
//
// The rules (tasks, budgets, checks, token counting) live in
// `src/test/support/mcp-eval/` and are proven by
// `src/test/integration/mcp-eval-tasks.test.ts` without a paid run; this file
// is the process and socket shell around them.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  EVAL_USAGE,
  EvalUsageError,
  claudeArgs,
  exitCodeOf,
  formatReport,
  judgeTask,
  mcpTokensOf,
  parseAgentSession,
  parseEvalArgs,
  toolCallsOf,
  toolsOfferedOf,
  type EvalOptions,
  type TaskOutcome,
} from "../src/test/support/mcp-eval/report";
import type * as LibraryModule from "../src/test/support/mcp-eval/library";
import type * as TasksModule from "../src/test/support/mcp-eval/tasks";
import { REPO_ROOT, createSsrServer, installDomGlobals } from "./support/seed/seeds";

type EvalTask = TasksModule.EvalTask;

/**
 * The seeds' DOM globals plus every other jsdom window global Node lacks
 * (MutationObserver and the like): the test kit imports the host's UI
 * modules, which touch them at load, as the Vitest jsdom environment allows.
 */
function installTestKitGlobals(): void {
  installDomGlobals();
  const window = (globalThis as unknown as { window: Record<string, unknown> }).window;
  const g = globalThis as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(window)) {
    if (name in g) continue;
    try {
      g[name] = window[name];
    } catch {
      // A jsdom getter that throws outside a document context; nothing loads it.
    }
  }
}

/** Environment a nested Claude Code would read as "running inside a session". */
const NESTED_SESSION_VARIABLES = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SSE_PORT"];

function refuse(message: string): never {
  console.error(`eval:mcp: ${message}`);
  process.exit(2);
}

function claudeVersion(): string {
  try {
    return execFileSync("claude", ["--version"], { encoding: "utf8" }).trim();
  } catch {
    refuse("Claude Code (`claude`) is not on PATH; install it and log in first");
  }
}

function readBody(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(new Uint8Array(Buffer.concat(chunks))));
    request.on("error", reject);
  });
}

/** A loopback listener that hands every request to the eval's Plugin Endpoint. */
async function listen(library: LibraryModule.EvalLibrary): Promise<{ url: string; close(): void }> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const headers: [string, string][] = [];
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        headers.push([request.rawHeaders[index], request.rawHeaders[index + 1]]);
      }
      const closed = new Promise<void>((done) => response.on("close", () => done()));
      await library.handle(
        {
          method: request.method ?? "GET",
          path: (request.url ?? "/").split("?")[0],
          headers,
          body: await readBody(request),
        },
        {
          head: (status, answerHeaders) => {
            for (const [name, value] of answerHeaders) response.appendHeader(name, value);
            response.writeHead(status);
            response.flushHeaders();
          },
          write: (chunk) => response.write(chunk),
          end: () => response.end(),
          closed,
        }
      );
    })().catch((error: unknown) => {
      console.error("eval:mcp: the Plugin Endpoint failed a request:", error);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/plugin/maibuk-mcp/mcp`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

/** Runs headless Claude Code in `cwd`; resolves with its stdout, or rejects on a timeout. */
function runClaude(
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env = { ...process.env };
  for (const name of NESTED_SESSION_VARIABLES) delete env[name];
  return new Promise((done, fail) => {
    const child = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error(`timed out after ${Math.round(timeoutMs / 60_000)} minutes`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done({ stdout, stderr, code });
    });
  });
}

async function runTask(
  library: typeof LibraryModule,
  task: EvalTask,
  options: EvalOptions,
  wireDir: string
): Promise<TaskOutcome> {
  const served = await library.startEvalLibrary(task);
  const listener = await listen(served);
  const cwd = mkdtempSync(join(tmpdir(), "maibuk-mcp-eval-"));
  try {
    const before = await served.snapshot();
    const configPath = join(cwd, "mcp.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          maibuk: {
            type: "http",
            url: listener.url,
            headers: { Authorization: `Bearer ${served.key}` },
          },
        },
      })
    );
    const started = Date.now();
    const result = await runClaude(
      claudeArgs(task.prompt, options, configPath),
      cwd,
      options.timeoutMinutes * 60_000
    );
    const session = parseAgentSession(result.stdout);
    const after = await served.snapshot();
    const run = {
      before,
      after,
      wire: served.wire,
      calls: toolCallsOf(served.wire),
      toolsOffered: toolsOfferedOf(served.wire),
      answer: session.answer,
    };
    const outcome = judgeTask(task, mcpTokensOf(served.wire), session, task.check(run));
    writeFileSync(
      join(wireDir, `task-${task.id}.json`),
      `${JSON.stringify(
        {
          task: task.id,
          seconds: (Date.now() - started) / 1000,
          session,
          calls: run.calls,
          wire: served.wire,
          before,
          after,
        },
        null,
        2
      )}\n`
    );
    return outcome;
  } finally {
    listener.close();
    served.stop();
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  installTestKitGlobals();
  const vite = await createSsrServer();
  let exitCode = 2;
  try {
    const tasksModule = (await vite.ssrLoadModule(
      "/src/test/support/mcp-eval/tasks.ts"
    )) as typeof TasksModule;
    const libraryModule = (await vite.ssrLoadModule(
      "/src/test/support/mcp-eval/library.ts"
    )) as typeof LibraryModule;
    const known = tasksModule.EVAL_TASKS.map((task) => task.id);
    let options: EvalOptions;
    try {
      options = parseEvalArgs(process.argv.slice(2), known);
    } catch (error) {
      if (!(error instanceof EvalUsageError)) throw error;
      console.error(`${error.message}\n${EVAL_USAGE}`);
      return;
    }
    if (options.help) {
      console.log(EVAL_USAGE);
      exitCode = 0;
      return;
    }
    const version = claudeVersion();
    const out = resolve(REPO_ROOT, options.out);
    const wireDir = join(dirname(out), "mcp-eval");
    mkdirSync(wireDir, { recursive: true });
    const selected = (options.tasks ?? known).map(
      (id) => tasksModule.EVAL_TASKS.find((task) => task.id === id) as EvalTask
    );
    console.log(`eval:mcp: ${selected.length} tasks on ${options.model}, ${version}`);

    const outcomes: TaskOutcome[] = [];
    const unmeasured: string[] = [];
    for (const task of selected) {
      console.log(`eval:mcp: task ${task.id} ${task.title}...`);
      try {
        const outcome = await runTask(libraryModule, task, options, wireDir);
        outcomes.push(outcome);
        console.log(
          `eval:mcp: task ${task.id} ${outcome.pass ? "PASS" : "FAIL"}, ${outcome.mcp.total}/${outcome.budget} MCP tokens`
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        unmeasured.push(`${task.id}: ${reason}`);
        console.error(`eval:mcp: task ${task.id} UNMEASURED: ${reason}`);
      }
    }

    writeFileSync(
      out,
      `${JSON.stringify(
        {
          date: new Date().toISOString(),
          model: options.model,
          claude: version,
          outcomes,
          unmeasured,
        },
        null,
        2
      )}\n`
    );
    console.log(`\n${formatReport(outcomes)}`);
    for (const line of unmeasured) console.log(`UNMEASURED ${line}`);
    console.log(`\nreport: ${out}\nwire logs: ${wireDir}/`);
    exitCode = unmeasured.length > 0 ? 2 : exitCodeOf(outcomes);
  } finally {
    await vite.close();
    process.exit(exitCode);
  }
}

void main();
