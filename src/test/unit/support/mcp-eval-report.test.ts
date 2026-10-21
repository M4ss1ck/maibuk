import { describe, expect, it } from "vitest";
import {
  EvalUsageError,
  claudeArgs,
  exitCodeOf,
  formatReport,
  judgeTask,
  mcpTokensOf,
  parseAgentSession,
  parseEvalArgs,
  parseMcpBody,
  toolCallsOf,
  toolsOfferedOf,
  type AgentSession,
  type WireEntry,
} from "@/test/support/mcp-eval/report";

const TASK_IDS = ["1", "2", "3", "4", "5", "6"];

function call(
  name: string,
  args: Record<string, unknown>,
  text: string,
  isError = false
): WireEntry {
  return {
    method: "tools/call",
    request: { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name, arguments: args } },
    response: {
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text }], ...(isError ? { isError } : {}) },
    },
    status: 200,
  };
}

const tools = [{ name: "list_books", description: "List Books." }];
const WIRE: WireEntry[] = [
  {
    method: "server/discover",
    request: { method: "server/discover" },
    response: { result: { instructions: "12345678" } },
    status: 200,
  },
  {
    method: "tools/list",
    request: { method: "tools/list" },
    response: { result: { tools } },
    status: 200,
  },
  // A client asking twice still shows the model the definitions once.
  {
    method: "tools/list",
    request: { method: "tools/list" },
    response: { result: { tools } },
    status: 200,
  },
  call("list_books", {}, "Books 1-1 of 1"),
  call("get_book", { book: "abc" }, "No Book has that id.", true),
];

const SESSION_JSON = JSON.stringify({
  type: "result",
  is_error: false,
  result: "Two Books.",
  num_turns: 3,
  total_cost_usd: 0.0123,
  usage: {
    input_tokens: 10,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 3000,
    output_tokens: 40,
  },
  modelUsage: { "claude-sonnet-5-5": {} },
});

describe("parseMcpBody", () => {
  it("reads plain JSON and the last SSE data frame", () => {
    expect(parseMcpBody('{"id":1}')).toEqual({ id: 1 });
    expect(parseMcpBody('event: message\ndata: {"id":1}\n\ndata: {"id":2}\n\n')).toEqual({ id: 2 });
  });

  it("keeps an empty or non-JSON body as null", () => {
    expect(parseMcpBody("")).toBeNull();
    expect(parseMcpBody("Not Found")).toBeNull();
  });
});

describe("the wire", () => {
  it("lists every tool call with its text and error flag", () => {
    expect(toolCallsOf(WIRE)).toEqual([
      { name: "list_books", args: {}, text: "Books 1-1 of 1", isError: false },
      { name: "get_book", args: { book: "abc" }, text: "No Book has that id.", isError: true },
    ]);
  });

  it("treats a JSON-RPC error as an error call carrying its message", () => {
    const entry: WireEntry = {
      method: "tools/call",
      request: { params: { name: "nope", arguments: {} } },
      response: { error: { code: -32602, message: "Tool nope not found" } },
      status: 200,
    };
    expect(toolCallsOf([entry])[0]).toMatchObject({ isError: true, text: "Tool nope not found" });
  });

  it("reads the offered tools from the first tool list", () => {
    expect(toolsOfferedOf(WIRE)).toEqual(["list_books"]);
    expect(toolsOfferedOf([])).toEqual([]);
  });

  it("counts definitions and instructions once, and every call's arguments and result", () => {
    const tokens = mcpTokensOf(WIRE);
    expect(tokens).toEqual({
      definitions: Math.ceil(JSON.stringify(tools).length / 4),
      instructions: 2,
      // "Books 1-1 of 1" (14) and the error sentence (20).
      results: 4 + 5,
      // "{}" (2) and '{"book":"abc"}' (14).
      arguments: 1 + 4,
      total: Math.ceil(JSON.stringify(tools).length / 4) + 2 + 9 + 5,
    });
  });
});

describe("parseAgentSession", () => {
  it("sums every input, cache, and output token of the session", () => {
    expect(parseAgentSession(SESSION_JSON)).toEqual({
      answer: "Two Books.",
      isError: false,
      turns: 3,
      costUsd: 0.0123,
      sessionTokens: 3250,
      inputTokens: 210,
      cacheReadTokens: 3000,
      outputTokens: 40,
      models: ["claude-sonnet-5-5"],
    });
  });

  it("throws on output that is not Claude Code's result, so the task is unmeasured", () => {
    expect(() => parseAgentSession("Invalid API key")).toThrow(/did not print its JSON/);
    expect(() => parseAgentSession('{"type":"system"}')).toThrow(/no result object/);
  });
});

describe("judging and the report", () => {
  const session: AgentSession = parseAgentSession(SESSION_JSON);
  const task = { id: "1", title: "Find a Note", budget: 100 };
  const mcp = { definitions: 50, instructions: 5, results: 20, arguments: 5, total: 80 };

  it("passes only when every check holds and the MCP tokens fit the budget", () => {
    expect(judgeTask(task, mcp, session, [{ name: "a", ok: true, detail: "" }]).pass).toBe(true);
    expect(judgeTask(task, mcp, session, [{ name: "a", ok: false, detail: "x" }]).pass).toBe(false);
    const over = judgeTask({ ...task, budget: 79 }, mcp, session, []);
    expect(over.pass).toBe(false);
    expect(over.checks.at(-1)).toMatchObject({ name: "MCP tokens within 79", ok: false });
  });

  it("exits 0 only when every task passed", () => {
    const pass = judgeTask(task, mcp, session, []);
    const fail = judgeTask({ ...task, budget: 1 }, mcp, session, []);
    expect(exitCodeOf([pass])).toBe(0);
    expect(exitCodeOf([pass, fail])).toBe(1);
    expect(exitCodeOf([])).toBe(1);
  });

  it("prints a row a task with tokens and budget, then each failed check", () => {
    const fail = judgeTask(task, mcp, session, [
      { name: "answer names the keeper", ok: false, detail: "Abel" },
    ]);
    const report = formatReport([fail]).split("\n");
    expect(report[0]).toMatch(
      /^task\s+result\s+mcp tokens\s+budget\s+session tokens\s+turns\s+cost$/
    );
    expect(report[2]).toMatch(/^1 Find a Note\s+FAIL\s+80\s+100\s+3250\s+3\s+\$0\.0123$/);
    expect(report).toContain("1: FAILED answer names the keeper: Abel");
    expect(report.at(-1)).toBe("0/1 passed, $0.0123 spent");
  });
});

describe("parseEvalArgs", () => {
  it("defaults to every task on sonnet", () => {
    expect(parseEvalArgs([], TASK_IDS)).toEqual({
      tasks: null,
      model: "sonnet",
      out: ".bench/mcp-eval.json",
      maxTurns: 20,
      timeoutMinutes: 5,
      help: false,
    });
  });

  it("reads every option", () => {
    expect(
      parseEvalArgs(
        [
          "--task",
          "5,1",
          "--model",
          "opus",
          "--out",
          "x.json",
          "--max-turns",
          "9",
          "--timeout",
          "2",
          "--help",
        ],
        TASK_IDS
      )
    ).toEqual({
      tasks: ["5", "1"],
      model: "opus",
      out: "x.json",
      maxTurns: 9,
      timeoutMinutes: 2,
      help: true,
    });
  });

  it("refuses unknown tasks, flags, missing values, and bad numbers", () => {
    expect(() => parseEvalArgs(["--task", "7"], TASK_IDS)).toThrow(EvalUsageError);
    expect(() => parseEvalArgs(["--verbose"], TASK_IDS)).toThrow(/unknown option/);
    expect(() => parseEvalArgs(["--model"], TASK_IDS)).toThrow(/needs a value/);
    expect(() => parseEvalArgs(["--max-turns", "0"], TASK_IDS)).toThrow(/whole number/);
  });
});

describe("claudeArgs", () => {
  it("runs headless on the eval's server alone, its tools allowed, no built-in tools", () => {
    const args = claudeArgs("Do it.", parseEvalArgs([], TASK_IDS), "/tmp/mcp.json");
    expect(args.slice(0, 2)).toEqual(["-p", "Do it."]);
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(flag("--output-format")).toBe("json");
    expect(flag("--mcp-config")).toBe("/tmp/mcp.json");
    expect(flag("--allowedTools")).toBe("mcp__maibuk");
    expect(flag("--tools")).toBe("");
    expect(flag("--model")).toBe("sonnet");
    expect(flag("--max-turns")).toBe("20");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
  });
});
