// The MCP Server Agent eval's deterministic rules (#595): what crossed the
// wire, what it cost in tokens, what headless Claude Code reported, and the
// verdict table `pnpm eval:mcp` prints. Pure, so every rule is tested without
// a paid run; `e2e/run-mcp-eval.ts` is the process shell around them.

/** One JSON-RPC request the Agent sent to the Plugin Endpoint, with its answer. */
export interface WireEntry {
  /** The JSON-RPC method, or null for a body that was not one (a GET, a notification batch). */
  method: string | null;
  /** The parsed request body, or null when there was none. */
  request: any;
  /** The parsed JSON-RPC answer (the last SSE `data:` frame or the JSON body), or null. */
  response: any;
  status: number;
}

/** One `tools/call` as the Agent saw it. */
export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  /** Every text block of the result, joined with a newline. */
  text: string;
  isError: boolean;
}

/** A Chapter as the Library holds it after a task, in Book order. */
export interface ChapterState {
  bookId: string;
  /** 1-based, the numbering `get_book` prints. */
  position: number;
  /** The full id for a Chapter the fixture holds, else the short id `get_book` printed. */
  id: string;
  title: string;
  html: string;
  text: string;
}

/** What the Library holds after a task, read back after the Agent exited. */
export interface LibrarySnapshot {
  books: Array<{
    id: string;
    title: string;
    authorName: string;
    genre: string | null;
    status: string;
  }>;
  chapters: ChapterState[];
  notes: Array<{ id: string; bookId: string | null; title: string; tags: string[]; html: string }>;
  checkpoints: Array<{ bookId: string; label: string }>;
}

/** Everything a task's checks judge: the Library afterwards, the wire, the answer. */
export interface TaskRun {
  before: LibrarySnapshot;
  after: LibrarySnapshot;
  wire: WireEntry[];
  calls: ToolCall[];
  /** The tool names the Agent was offered (the first `tools/list` answer). */
  toolsOffered: string[];
  /** The Agent's final answer text. */
  answer: string;
}

/** One named check on a task's outcome. */
export interface CheckResult {
  name: string;
  ok: boolean;
  /** What was found, shown when the check fails. */
  detail: string;
}

/** Parses JSON text; an empty or malformed body is kept as null. */
function jsonOrNull(text: string): any {
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Parses one Plugin Endpoint answer body: plain JSON, or the SDK's SSE stream framing it. */
export function parseMcpBody(text: string): any {
  const frames = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"));
  return jsonOrNull(frames.length > 0 ? frames[frames.length - 1].slice("data:".length) : text);
}

/** Parses a request body; anything that is not JSON is kept as null. */
export function parseRequestBody(text: string): any {
  return jsonOrNull(text);
}

function textOfResult(result: any): string {
  const content: unknown = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

/** Every `tools/call` on the wire, in order, with what the Agent got back. */
export function toolCallsOf(wire: readonly WireEntry[]): ToolCall[] {
  return wire
    .filter((entry) => entry.method === "tools/call")
    .map((entry) => {
      const params = entry.request?.params ?? {};
      const error = entry.response?.error;
      return {
        name: String(params.name ?? ""),
        args: (params.arguments ?? {}) as Record<string, unknown>,
        text: error ? String(error.message ?? "") : textOfResult(entry.response?.result),
        isError: error !== undefined || entry.response?.result?.isError === true,
      };
    });
}

/** The tool names of the first `tools/list` answer: what the Agent was offered. */
export function toolsOfferedOf(wire: readonly WireEntry[]): string[] {
  const first = wire.find((entry) => entry.method === "tools/list" && entry.response?.result);
  const tools: unknown = first?.response.result.tools;
  return Array.isArray(tools) ? tools.map((tool) => String(tool?.name)) : [];
}

/** The token proxy the research uses for definitions: four characters a token. */
export function tokensOf(characters: number): number {
  return Math.ceil(characters / 4);
}

/** What the MCP Server put in front of the model, split by where it came from. */
export interface McpTokens {
  /** Tool definitions (name, title, description, schemas, annotations), counted once a session. */
  definitions: number;
  /** Server instructions, counted once a session. */
  instructions: number;
  /** Every tool result's text. */
  results: number;
  /** Every tool call's arguments, as the model wrote them. */
  arguments: number;
  total: number;
}

/**
 * Counts what the MCP Server put in the model's context, from the wire alone.
 * A client that asks for the tool list or the instructions twice still shows
 * them to the model once, so each is counted once; every call's arguments and
 * result count every time. Characters over four, the proxy
 * `docs/research/mcp-server-token-efficiency.md` sizes the definitions with.
 */
export function mcpTokensOf(wire: readonly WireEntry[]): McpTokens {
  const list = wire.find((entry) => entry.method === "tools/list" && entry.response?.result);
  const definitions = tokensOf(JSON.stringify(list?.response.result.tools ?? []).length);
  const greeting = wire.find(
    (entry) =>
      (entry.method === "initialize" || entry.method === "server/discover") &&
      typeof entry.response?.result?.instructions === "string"
  );
  const instructions = tokensOf(String(greeting?.response.result.instructions ?? "").length);
  let results = 0;
  let args = 0;
  for (const call of toolCallsOf(wire)) {
    results += tokensOf(call.text.length);
    args += tokensOf(JSON.stringify(call.args).length);
  }
  return {
    definitions,
    instructions,
    results,
    arguments: args,
    total: definitions + instructions + results + args,
  };
}

/** What headless Claude Code reported for one session (`--output-format json`). */
export interface AgentSession {
  answer: string;
  isError: boolean;
  turns: number;
  costUsd: number;
  /** Fresh input, cache writes, cache reads, and output, summed over every turn. */
  sessionTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  models: string[];
}

/**
 * Reads the final `result` object of `claude -p --output-format json`. Throws
 * on output that is not that object, so a crashed or logged-out CLI is an
 * unmeasured run, never a silent zero.
 */
export function parseAgentSession(stdout: string): AgentSession {
  let parsed: any;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Claude Code did not print its JSON result: ${stdout.slice(0, 300)}`);
  }
  if (parsed?.type !== "result" || typeof parsed.usage !== "object" || parsed.usage === null) {
    throw new Error(`Claude Code printed no result object: ${stdout.slice(0, 300)}`);
  }
  const usage = parsed.usage;
  const input = Number(usage.input_tokens ?? 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  return {
    answer: typeof parsed.result === "string" ? parsed.result : "",
    isError: parsed.is_error === true,
    turns: Number(parsed.num_turns ?? 0),
    costUsd: Number(parsed.total_cost_usd ?? 0),
    sessionTokens: input + cacheWrite + cacheRead + output,
    inputTokens: input + cacheWrite,
    cacheReadTokens: cacheRead,
    outputTokens: output,
    models: Object.keys(parsed.modelUsage ?? {}),
  };
}

/** One task's measured outcome. */
export interface TaskOutcome {
  id: string;
  title: string;
  budget: number;
  mcp: McpTokens;
  session: AgentSession;
  checks: CheckResult[];
  /** Every check held and the MCP tokens stayed within the budget. */
  pass: boolean;
}

/** Judges one task: success is every check holding, then the budget decides. */
export function judgeTask(
  task: { id: string; title: string; budget: number },
  mcp: McpTokens,
  session: AgentSession,
  checks: CheckResult[]
): TaskOutcome {
  const withinBudget: CheckResult = {
    name: `MCP tokens within ${task.budget}`,
    ok: mcp.total <= task.budget,
    detail: `${mcp.total} MCP tokens (definitions ${mcp.definitions}, instructions ${mcp.instructions}, results ${mcp.results}, arguments ${mcp.arguments})`,
  };
  const all = [...checks, withinBudget];
  return {
    ...task,
    mcp,
    session,
    checks: all,
    pass: all.every((check) => check.ok),
  };
}

/** The eval's exit code: 0 every task passed, 1 any failed. */
export function exitCodeOf(outcomes: readonly TaskOutcome[]): number {
  return outcomes.length > 0 && outcomes.every((outcome) => outcome.pass) ? 0 : 1;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

/**
 * The table the eval prints: one row a task with its verdict, MCP tokens
 * against the budget, and what the whole Agent session cost; then each failed
 * check with what was found.
 */
export function formatReport(outcomes: readonly TaskOutcome[]): string {
  const header = ["task", "result", "mcp tokens", "budget", "session tokens", "turns", "cost"];
  const rows = outcomes.map((outcome) => [
    `${outcome.id} ${outcome.title}`,
    outcome.pass ? "PASS" : "FAIL",
    String(outcome.mcp.total),
    String(outcome.budget),
    String(outcome.session.sessionTokens),
    String(outcome.session.turns),
    `$${outcome.session.costUsd.toFixed(4)}`,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column].length))
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => pad(cell, widths[column]))
      .join("  ")
      .trimEnd();
  const out = [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
  for (const outcome of outcomes) {
    for (const check of outcome.checks.filter((entry) => !entry.ok)) {
      out.push(`${outcome.id}: FAILED ${check.name}: ${check.detail}`);
    }
  }
  const passed = outcomes.filter((outcome) => outcome.pass).length;
  const cost = outcomes.reduce((sum, outcome) => sum + outcome.session.costUsd, 0);
  out.push(`${passed}/${outcomes.length} passed, $${cost.toFixed(4)} spent`);
  return out.join("\n");
}

/** The options `pnpm eval:mcp` runs on. */
export interface EvalOptions {
  /** Task ids to run, in the given order; null runs all six. */
  tasks: string[] | null;
  /** The Claude Code model alias or id the Agent runs on. */
  model: string;
  /** Where the JSON report goes; each task's wire log is written beside it. */
  out: string;
  /** Turns one task may take before Claude Code stops it. */
  maxTurns: number;
  /** Minutes one task may take before the eval stops it as unmeasured. */
  timeoutMinutes: number;
  help: boolean;
}

export const EVAL_USAGE = `usage: pnpm eval:mcp [options]
  --task <ids>          comma-separated task ids to run (default: 1,2,3,4,5,6,7)
  --model <model>       Claude Code model alias or id (default: sonnet)
  --out <path>          JSON report path (default: .bench/mcp-eval.json)
  --max-turns <n>       turns a task may take (default: 20)
  --timeout <minutes>   minutes a task may take (default: 5)
  --help                print this and exit
Paid: every task is one headless Claude Code session. Never in CI.
Exit 0 every task passed, 1 a task failed, 2 nothing could be measured.`;

export class EvalUsageError extends Error {}

function positiveInteger(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new EvalUsageError(`${flag} takes a whole number above 0, not ${value ?? "nothing"}`);
  }
  return parsed;
}

/** Parses `pnpm eval:mcp` arguments; throws `EvalUsageError` on anything unknown. */
export function parseEvalArgs(argv: readonly string[], knownTasks: readonly string[]): EvalOptions {
  const options: EvalOptions = {
    tasks: null,
    model: "sonnet",
    out: ".bench/mcp-eval.json",
    maxTurns: 20,
    timeoutMinutes: 5,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = (): string => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new EvalUsageError(`${flag} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (flag) {
      case "--task": {
        const ids = value()
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        const unknown = ids.filter((id) => !knownTasks.includes(id));
        if (ids.length === 0 || unknown.length > 0) {
          throw new EvalUsageError(
            `--task takes ids from ${knownTasks.join(",")}, not ${unknown.join(",") || "nothing"}`
          );
        }
        options.tasks = ids;
        break;
      }
      case "--model":
        options.model = value();
        break;
      case "--out":
        options.out = value();
        break;
      case "--max-turns":
        options.maxTurns = positiveInteger(flag, value());
        break;
      case "--timeout":
        options.timeoutMinutes = positiveInteger(flag, value());
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new EvalUsageError(`unknown option ${flag}`);
    }
  }
  return options;
}

/**
 * The headless Claude Code command line for one task: JSON result, the
 * eval's MCP server only, its tools allowed without a prompt, no built-in
 * tools (so the Agent cannot reach the Library any other way), and no saved
 * session. Not `--bare`: it reads only `ANTHROPIC_API_KEY`, and the eval runs
 * on the author's own login.
 */
export function claudeArgs(prompt: string, options: EvalOptions, mcpConfigPath: string): string[] {
  return [
    "-p",
    prompt,
    "--output-format",
    "json",
    "--model",
    options.model,
    "--max-turns",
    String(options.maxTurns),
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--allowedTools",
    "mcp__maibuk",
    "--tools",
    "",
    "--no-session-persistence",
  ];
}
