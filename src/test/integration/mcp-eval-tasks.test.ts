/**
 * The MCP Server Agent eval's checks and budgets, proven without a paid run
 * (#595). A scripted Agent drives the real MCP Server Plugin through the eval's
 * own fixture Library and Plugin Endpoint handler: the expected path for each
 * task must pass every check within its budget, and a plausible wrong path
 * must fail the check that guards against it. If a check could not tell good
 * from bad here, the paid eval's verdict would mean nothing.
 */
import { describe, expect, it } from "vitest";
import {
  bodyOf,
  ENDPOINT_PREFIX,
  startEvalLibrary,
  type EvalAnswerSink,
  type EvalLibrary,
} from "@/test/support/mcp-eval/library";
import {
  judgeTask,
  mcpTokensOf,
  toolCallsOf,
  toolsOfferedOf,
  type AgentSession,
  type CheckResult,
  type TaskRun,
} from "@/test/support/mcp-eval/report";
import {
  AUTHOR_TYPED,
  EVAL_TASKS,
  FIXED_COST,
  FIXED_COST_READ_ONLY,
  IDS,
  INTERLUDE_TEXT,
  LAMP_ROOM_REWRITE,
  STORM_SCENE,
  WRITE_TOOLS,
  type EvalTask,
} from "@/test/support/mcp-eval/tasks";

const SESSION: AgentSession = {
  answer: "",
  isError: false,
  turns: 1,
  costUsd: 0,
  sessionTokens: 0,
  inputTokens: 0,
  cacheReadTokens: 0,
  outputTokens: 0,
  models: [],
};

function task(id: string): EvalTask {
  const found = EVAL_TASKS.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`No task ${id}`);
  return found;
}

function collectingSink(): EvalAnswerSink & { status: number; text(): string } {
  const chunks: Uint8Array[] = [];
  let status = 0;
  return {
    get status() {
      return status;
    },
    head(code) {
      status = code;
    },
    write(chunk) {
      chunks.push(chunk);
    },
    end() {},
    closed: new Promise<void>(() => {}),
    text: () => chunks.map((chunk) => new TextDecoder().decode(chunk)).join(""),
  };
}

/** A scripted Agent: greets the server like a client, lists tools, then calls them. */
async function scriptedAgent(library: EvalLibrary) {
  let id = 0;
  async function post(body: unknown) {
    const sink = collectingSink();
    await library.handle(
      {
        method: "POST",
        path: `${ENDPOINT_PREFIX}/mcp`,
        headers: [
          ["content-type", "application/json"],
          ["accept", "application/json, text/event-stream"],
          ["authorization", `Bearer ${library.key}`],
        ],
        body: bodyOf(JSON.stringify(body)),
      },
      sink
    );
    return sink;
  }
  await post({
    jsonrpc: "2.0",
    id: ++id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "scripted-agent", version: "0.0.0" },
    },
  });
  await post({ jsonrpc: "2.0", id: ++id, method: "tools/list", params: {} });
  return {
    /** Calls one tool and returns its result text (every block joined). */
    async call(name: string, args: Record<string, unknown>): Promise<string> {
      await post({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name, arguments: args },
      });
      const calls = toolCallsOf(library.wire);
      return calls[calls.length - 1].text;
    },
  };
}

/** Runs one scripted path for `evalTask` and returns the checks and the judged outcome. */
async function runScripted(
  evalTask: EvalTask,
  script: (agent: Awaited<ReturnType<typeof scriptedAgent>>) => Promise<string>
) {
  const library = await startEvalLibrary(evalTask);
  try {
    const before = await library.snapshot();
    const agent = await scriptedAgent(library);
    const answer = await script(agent);
    const run: TaskRun = {
      before,
      after: await library.snapshot(),
      wire: library.wire,
      calls: toolCallsOf(library.wire),
      toolsOffered: toolsOfferedOf(library.wire),
      answer,
    };
    const checks = evalTask.check(run);
    const outcome = judgeTask(evalTask, mcpTokensOf(library.wire), SESSION, checks);
    return { run, checks, outcome };
  } finally {
    library.stop();
  }
}

function failed(checks: readonly CheckResult[]): string[] {
  return checks.filter((entry) => !entry.ok).map((entry) => entry.name);
}

function lastEdited(text: string): string {
  const line = text.split("\n").find((entry) => entry.startsWith("Last Edited: "));
  if (line === undefined) throw new Error(`No Last Edited in ${text}`);
  return line.slice("Last Edited: ".length);
}

const short = (id: string) => id.slice(0, 8);

describe("MCP Server eval budgets", () => {
  // The budgets are the fixed cost plus a task's path. A change to a tool's
  // definitions or the instructions moves the fixed cost; this fails so the
  // budgets are re-derived (src/test/support/mcp-eval/tasks.ts) instead of
  // quietly absorbing it.
  it.each([
    ["read-write", false, FIXED_COST],
    ["read-only", true, FIXED_COST_READ_ONLY],
  ])("the %s fixed cost is what the server sends", async (_mode, readOnly, expected) => {
    const { outcome } = await runScripted({ ...task("1"), readOnly }, async () => "");
    expect(outcome.mcp.definitions + outcome.mcp.instructions).toBe(expected);
  });

  it("every task has its own id and a budget above its fixed cost", () => {
    expect(new Set(EVAL_TASKS.map((entry) => entry.id)).size).toBe(6);
    for (const entry of EVAL_TASKS) {
      expect(entry.budget).toBeGreaterThan(entry.readOnly ? FIXED_COST_READ_ONLY : FIXED_COST);
    }
  });
});

describe("MCP Server eval task 1: find a Note by Tag and read it", () => {
  it("passes a Tag-filtered list and a read of the Note", async () => {
    const { outcome } = await runScripted(task("1"), async (agent) => {
      const list = await agent.call("list_notes", { tag: "keeper" });
      expect(list).toContain("Ottilie's past");
      await agent.call("read_note", { note: short(IDS.keeperNote) });
      return "The keeper is Ottilie Marsh, who has kept the light for thirty-one years.";
    });
    expect(failed(outcome.checks)).toEqual([]);
    expect(outcome.pass).toBe(true);
  });

  it("fails an Agent that reads the Note whose title says keeper", async () => {
    const { checks } = await runScripted(task("1"), async (agent) => {
      await agent.call("read_note", { note: short(IDS.bridgeNote) });
      return "Abel Crane, for nine years.";
    });
    expect(failed(checks)).toEqual([
      "read the tagged Note",
      "answer names the keeper",
      "answer gives the years",
      "answer does not name the distractor",
    ]);
  });
});

describe("MCP Server eval task 2: append a scene to a Chapter", () => {
  it("passes an append that keeps the Chapter byte for byte", async () => {
    const { outcome } = await runScripted(task("2"), async (agent) => {
      await agent.call("get_book", { book: short(IDS.lighthouse) });
      await agent.call("edit_chapter", {
        chapter: short(IDS.storm),
        append: STORM_SCENE.join("\n\n"),
      });
      return "Done.";
    });
    expect(failed(outcome.checks)).toEqual([]);
  });

  it("fails an Agent that writes the Chapter back whole", async () => {
    const { checks } = await runScripted(task("2"), async (agent) => {
      const read = await agent.call("read_chapter", { chapter: short(IDS.storm) });
      const body = read.split("\n").slice(7).join("\n");
      await agent.call("write_chapter", {
        chapter: short(IDS.storm),
        expectedLastEdited: lastEdited(read),
        text: `${body}\n\n${STORM_SCENE.join("\n\n")}`,
      });
      return "Done.";
    });
    expect(failed(checks)).toContain("no whole replace");
  });
});

describe("MCP Server eval task 3: fix a typo with find-and-replace", () => {
  it("passes one find-and-replace that leaves every other byte", async () => {
    const { outcome } = await runScripted(task("3"), async (agent) => {
      await agent.call("get_book", { book: short(IDS.lighthouse) });
      await agent.call("read_chapter", { chapter: short(IDS.arrival) });
      await agent.call("edit_chapter", {
        chapter: short(IDS.arrival),
        find: "the lighhouse door",
        replace: "the lighthouse door",
      });
      return "Fixed.";
    });
    expect(failed(outcome.checks)).toEqual([]);
  });

  it("fails a whole replace that strips the formatting", async () => {
    const { checks } = await runScripted(task("3"), async (agent) => {
      const read = await agent.call("read_chapter", { chapter: short(IDS.arrival) });
      const body = read.split("\n").slice(7).join("\n");
      await agent.call("write_chapter", {
        chapter: short(IDS.arrival),
        expectedLastEdited: lastEdited(read),
        text: body.replace("lighhouse", "lighthouse"),
      });
      return "Fixed.";
    });
    expect(failed(checks)).toEqual([
      "typo fixed, every other byte kept",
      "find-and-replace, not a whole replace",
    ]);
  });
});

describe("MCP Server eval task 4: create a Chapter and move it", () => {
  it("passes a create at the end and a move after Arrival", async () => {
    const { outcome } = await runScripted(task("4"), async (agent) => {
      await agent.call("get_book", { book: short(IDS.lighthouse) });
      const created = await agent.call("write_chapter", {
        book: short(IDS.lighthouse),
        title: "Interlude",
        text: INTERLUDE_TEXT,
      });
      const createdId = /its id is (\S+?)\.?$/.exec(created)?.[1];
      expect(createdId).toBeDefined();
      await agent.call("manage_chapter", { chapter: createdId, position: 2 });
      return "Created and moved.";
    });
    expect(failed(outcome.checks)).toEqual([]);
  });

  it("fails an Agent that creates the Chapter and never moves it", async () => {
    const { checks } = await runScripted(task("4"), async (agent) => {
      await agent.call("write_chapter", {
        book: short(IDS.lighthouse),
        title: "Interlude",
        text: INTERLUDE_TEXT,
      });
      return "Created.";
    });
    expect(failed(checks)).toEqual(["Chapter sits between Arrival and Storm"]);
  });
});

describe("MCP Server eval task 5: a whole replace refused after the author typed", () => {
  /** Reads, replaces (refused: the author typed), re-reads, and writes `final`. */
  async function refusedThenRetried(finalText: (authorText: string) => string) {
    return runScripted(task("5"), async (agent) => {
      await agent.call("get_book", { book: short(IDS.lighthouse) });
      const first = await agent.call("read_chapter", { chapter: short(IDS.lampRoom) });
      const refused = await agent.call("write_chapter", {
        chapter: short(IDS.lampRoom),
        expectedLastEdited: lastEdited(first),
        text: LAMP_ROOM_REWRITE.join("\n\n"),
      });
      expect(refused).toMatch(/changed/i);
      const second = await agent.call("read_chapter", { chapter: short(IDS.lampRoom) });
      expect(second).toContain(AUTHOR_TYPED);
      await agent.call("write_chapter", {
        chapter: short(IDS.lampRoom),
        expectedLastEdited: lastEdited(second),
        text: finalText(AUTHOR_TYPED),
      });
      return "Replaced, keeping your new paragraph.";
    });
  }

  it("passes a recovery that keeps the author's paragraph", async () => {
    const { outcome } = await refusedThenRetried(
      (typed) => `${LAMP_ROOM_REWRITE.join("\n\n")}\n\n${typed}`
    );
    expect(failed(outcome.checks)).toEqual([]);
  });

  it("fails an Agent that is refused and gives up without re-reading", async () => {
    const { checks } = await runScripted(task("5"), async (agent) => {
      const first = await agent.call("read_chapter", { chapter: short(IDS.lampRoom) });
      await agent.call("write_chapter", {
        chapter: short(IDS.lampRoom),
        expectedLastEdited: lastEdited(first),
        text: LAMP_ROOM_REWRITE.join("\n\n"),
      });
      return "The Chapter changed, so I stopped.";
    });
    expect(failed(checks)).toEqual([
      "refused, re-read, then replaced",
      "the new version landed",
      "the old version is gone",
    ]);
  });

  it("fails a recovery that drops the author's paragraph", async () => {
    const { checks } = await refusedThenRetried(() => LAMP_ROOM_REWRITE.join("\n\n"));
    expect(failed(checks)).toEqual(["the author's typing survived"]);
  });
});

describe("MCP Server eval task 6: read-only mode", () => {
  it("passes when only read tools are offered and nothing changes", async () => {
    const { run, outcome } = await runScripted(task("6"), async (agent) => {
      await agent.call("list_books", {});
      return "I cannot: the Maibuk MCP Server is read-only, so it offers no tool to rename a Book.";
    });
    expect(run.toolsOffered.filter((name) => WRITE_TOOLS.includes(name))).toEqual([]);
    expect(failed(outcome.checks)).toEqual([]);
  });

  it("fails when the write tools are offered and the Book is renamed", async () => {
    const writable: EvalTask = { ...task("6"), readOnly: false };
    const { checks } = await runScripted(writable, async (agent) => {
      await agent.call("update_book", { book: short(IDS.saltRoads), title: "Salt and Iron Roads" });
      return "Renamed.";
    });
    expect(failed(checks)).toEqual([
      "only read tools offered",
      "Library unchanged",
      "answer says it cannot write",
    ]);
  });
});
