// The MCP Server Agent eval's fixture Library and its six tasks (#595). Each
// task is a prompt for headless Claude Code, a budget in MCP tokens, and the
// checks that judge the Library afterwards, the wire, and the answer. Every
// check is pure over a `TaskRun`, so `src/test/integration/mcp-eval-tasks.test.ts`
// proves each one passes a scripted good Agent and fails a scripted bad one
// without a paid run.
//
// Budgets are MCP tokens (characters over four), what the MCP Server puts in
// the model's context: definitions and instructions once, then every call's
// arguments and result. They were fixed before the first paid run, from the
// costs measured on this fixture with the scripted Agent: the fixed cost is
// 2,266 (2,174 definitions for 12 tools, 92 instructions) and 731 read-only
// (5 tools); a call costs its result plus its arguments, list_books ~30,
// get_book ~100, list_notes ~27, read_note ~96, read_chapter of Arrival ~315
// as text, a write's answer ~25. Each budget is the fixed cost plus the
// expected path plus room for one orienting or repeated call. The path costs
// rest on the research's response rules (§3.3, §8.3): lists of short lines
// with a cursor, one format a read (text by default), windowed prose, and
// small edits instead of whole-Chapter rewrites; a server that broke one of
// them would spend a task's room. The reasoning sits beside each number and
// in `e2e/README.md`.

/** The fixed MCP cost of a session: every definition and the instructions, read-write. */
export const FIXED_COST = 2_266;

/** The same with only the read tools, the read-only mode. */
export const FIXED_COST_READ_ONLY = 731;

import { countWords } from "@/features/metrics/word-count";
import { htmlToPlainText } from "@/features/plugins/library";
import type { TestLibrary } from "@/features/plugins/types";
import type { CheckResult, ChapterState, TaskRun, ToolCall } from "./report";

const LIGHTHOUSE = "3f2a9c1e-7b40-4d1a-9e55-0c6b8a2f1d01";
const SALT_ROADS = "8d51e0b7-2c9f-4a63-b1d4-5e7f9a0c3b02";

/** The fixture's ids, so tasks and tests name rows without repeating literals. */
export const IDS = {
  lighthouse: LIGHTHOUSE,
  saltRoads: SALT_ROADS,
  arrival: "a41c7e93-5d2b-4f08-8c61-9b3e2d7f4a10",
  storm: "b72e4f15-9a3c-4d6e-a0b8-1c5f7e9d2b20",
  lampRoom: "c93a6d27-1e5b-4b7f-9d02-3e8a6c1f5d30",
  epilogue: "d15b8e39-4f6a-4c8d-b1e3-5a9c2e7f6b40",
  harbour: "e26c9f4a-7b8d-4e9f-c2f4-6b0d3f8a7c50",
  departure: "f37d0a5b-8c9e-4f0a-d3a5-7c1e4a9b8d60",
  keeperNote: "1a8b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c71",
  lampNote: "2b9c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d82",
  reefNote: "3c0d4e5f-6a7b-4c8d-ae9f-1a2b3c4d5e93",
  shipNote: "4d1e5f6a-7b8c-4d9e-bf0a-2b3c4d5e6fa4",
  bridgeNote: "5e2f6a7b-8c9d-4eaf-c01b-3c4d5e6f7ab5",
  ideasNote: "6f3a7b8c-9d0e-4fb0-d12c-4d5e6f7a8bc6",
} as const;

const EDITED = Date.UTC(2026, 9, 1, 9, 30);

function paragraphs(...texts: string[]): string {
  return texts.map((text) => `<p>${text}</p>`).join("");
}

function chapter(id: string, bookId: string, order: number, title: string, html: string) {
  const text = htmlToPlainText(html);
  return {
    id,
    bookId,
    title,
    order,
    parentId: null,
    chapterType: "chapter" as const,
    wordCount: countWords(text),
    status: "draft" as const,
    updatedAt: EDITED,
    content: { html, text },
  };
}

function note(id: string, bookId: string | null, title: string, tags: string[], body: string) {
  const html = `<p>${body}</p>`;
  return {
    id,
    bookId,
    title,
    language: "en",
    tags,
    wordCount: countWords(body),
    updatedAt: EDITED,
    content: { html, text: body },
  };
}

/** The Arrival Chapter: one typo ("lighhouse") among formatted paragraphs. */
export const ARRIVAL_HTML = paragraphs(
  "The supply boat left Ottilie on the north landing an hour before dusk, with two crates of oil, a sack of flour, and a letter she did not open.",
  "She climbed the hundred and twelve steps cut into the rock and stood at last beneath the <em>North Head</em> light, its glass already catching the last of the sun.",
  "The keeper's cottage smelled of salt and old tobacco. Someone had left a kettle on the stove, cold, and a logbook open at a page dated the ninth of November.",
  "She read the final entry twice. <strong>Lamp lit at 4.12. Wind north-east, rising. Heard the bell from the reef.</strong> There was no bell on the reef. There had not been one for forty years.",
  "From the window she could see the whole curve of the bay, the harbour lights of Saltmouth small and yellow on the far shore, and below her the black teeth of the reef where the water turned white.",
  "That night she slept in her coat. Twice she woke to the sound of the lighhouse door swinging in the wind, though she was certain she had barred it.",
  "In the morning the logbook lay closed on the table, and the kettle was warm."
);

/** The Storm Chapter, the end a scene is appended to. */
export const STORM_HTML = paragraphs(
  "The storm came in on the third day, black over the water from the north-east, and by noon the spray was reaching the gallery rail.",
  "Ottilie wound the clockwork every two hours and trimmed the wick by feel when the glass fogged. The tower shook in the gusts like a struck bell.",
  "At dusk she saw a light on the reef where no light should be: low, swinging, the colour of a ship's lantern."
);

/** The Lamp Room Chapter, the one the author edits while the Agent works. */
export const LAMP_ROOM_HTML = paragraphs(
  "The lamp room was the only warm place in the tower.",
  "Ottilie sat with her back to the brass and watched the beam turn."
);

const EPILOGUE_HTML = paragraphs(
  "The light at North Head was automated in 1958. The cottage is a museum now, and the logbook is kept under glass."
);

/** The fixture Library every task starts from, fresh for each task. */
export function evalLibrary(): TestLibrary {
  const book = (id: string, title: string, wordCount: number) => ({
    id,
    title,
    subtitle: null,
    authorName: "M. Reyes",
    genre: "Literary fiction",
    language: "en",
    wordCount,
    targetWordCount: null,
    status: "draft" as const,
    updatedAt: EDITED,
  });
  return {
    books: [book(LIGHTHOUSE, "The Lighthouse Keeper", 612), book(SALT_ROADS, "Salt Roads", 240)],
    chapters: [
      chapter(IDS.arrival, LIGHTHOUSE, 0, "Arrival", ARRIVAL_HTML),
      chapter(IDS.storm, LIGHTHOUSE, 1, "Storm", STORM_HTML),
      chapter(IDS.lampRoom, LIGHTHOUSE, 2, "The Lamp Room", LAMP_ROOM_HTML),
      chapter(IDS.epilogue, LIGHTHOUSE, 3, "Epilogue", EPILOGUE_HTML),
      chapter(
        IDS.harbour,
        SALT_ROADS,
        0,
        "Harbour",
        paragraphs("The harbour at Saltmouth froze for the first time in living memory.")
      ),
      chapter(
        IDS.departure,
        SALT_ROADS,
        1,
        "Departure",
        paragraphs("They left on foot along the coast road, pulling the cart between them.")
      ),
    ],
    notes: [
      note(
        IDS.keeperNote,
        LIGHTHOUSE,
        "Ottilie's past",
        ["keeper", "backstory"],
        "Ottilie Marsh has kept the North Head light for thirty-one years. Her brother Tomas drowned on the reef in the winter of 1911, the year the bell was taken down."
      ),
      note(
        IDS.lampNote,
        LIGHTHOUSE,
        "Lamp mechanics",
        ["research"],
        "A first-order Fresnel lens, paraffin vapour burner, clockwork rotation wound every two hours."
      ),
      note(
        IDS.reefNote,
        LIGHTHOUSE,
        "Reef geography",
        ["research", "setting"],
        "The reef runs half a mile north-east of the Head and is exposed at low spring tides."
      ),
      note(
        IDS.shipNote,
        SALT_ROADS,
        "Ship names",
        ["names"],
        "Margaret Ann, Halcyon, The Second Daughter, Pilgrim."
      ),
      note(
        IDS.bridgeNote,
        SALT_ROADS,
        "The keeper of the toll bridge",
        ["names", "minor-characters"],
        "Abel Crane keeps the toll bridge at Saltmouth and has done for nine years."
      ),
      note(
        IDS.ideasNote,
        null,
        "Title ideas",
        ["ideas"],
        "The Bell on the Reef. North Head. Keeper."
      ),
    ],
  };
}

/** The scene task 2 appends, as the prompt gives it. */
export const STORM_SCENE = [
  "She took the speaking trumpet from its hook and went out onto the gallery.",
  "The wind tore the first shout from her mouth. The second carried, and the lantern on the reef went out.",
];

/** The new Chapter task 4 creates. */
export const INTERLUDE_TEXT =
  "Between storms the island was so quiet that Ottilie could hear the lens turning.";

/** The whole new version task 5 writes over the Lamp Room. */
export const LAMP_ROOM_REWRITE = [
  "The lamp room was the only warm place in the tower, and Ottilie had begun to sleep there.",
  "She sat with her back against the brass housing and counted the beam's turns until the count became a kind of prayer.",
];

/** What the author types into the Lamp Room while the Agent works (task 5). */
export const AUTHOR_TYPED = "Below her the sea worked at the rocks all night.";

/** The Lamp Room as the author leaves it: the stored Chapter plus one new paragraph. */
export const LAMP_ROOM_AFTER_AUTHOR = `${LAMP_ROOM_HTML}<p>${AUTHOR_TYPED}</p>`;

/** The write tools the read-only mode must never offer. */
export const WRITE_TOOLS = [
  "edit_chapter",
  "write_chapter",
  "manage_chapter",
  "update_book",
  "edit_note",
  "write_note",
  "delete_note",
];

/** One eval task: the prompt, the budget, the setup, and the checks. */
export interface EvalTask {
  id: string;
  title: string;
  prompt: string;
  /** MCP tokens the task may spend; see the reasoning beside each task. */
  budget: number;
  /** Starts the Plugin without `library:write`, the read-only mode. */
  readOnly?: boolean;
  /**
   * The author types into this Chapter right after the Agent's first
   * successful read of it, as unsaved editor text the next write flushes.
   */
  authorTypes?: { chapterId: string; html: string };
  check(run: TaskRun): CheckResult[];
}

function check(name: string, ok: boolean, detail: string): CheckResult {
  return { name, ok, detail };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function chapterOf(run: TaskRun, id: string): ChapterState | undefined {
  return run.after.chapters.find((entry) => entry.id === id);
}

function successful(calls: readonly ToolCall[], name: string): ToolCall[] {
  return calls.filter((call) => call.name === name && !call.isError);
}

function writeCalls(calls: readonly ToolCall[]): ToolCall[] {
  return calls.filter((call) => WRITE_TOOLS.includes(call.name) && !call.isError);
}

/** Every Chapter other than `except` holds exactly what it held before the task. */
function othersUntouched(run: TaskRun, except: readonly string[]): CheckResult {
  const changed = run.before.chapters
    .filter((before) => !except.includes(before.id))
    .filter((before) => {
      const after = chapterOf(run, before.id);
      return after === undefined || after.html !== before.html || after.title !== before.title;
    })
    .map((entry) => entry.title);
  return check(
    "no other Chapter changed",
    changed.length === 0,
    changed.length === 0 ? "" : `changed: ${changed.join(", ")}`
  );
}

/** The Library holds exactly what it held before: Books, Chapters, Notes, no Checkpoint. */
function libraryUnchanged(run: TaskRun): CheckResult {
  const writes = writeCalls(run.calls).map((call) => call.name);
  const same = JSON.stringify(run.before) === JSON.stringify(run.after);
  return check(
    "Library unchanged",
    same && writes.length === 0,
    `state ${same ? "same" : "changed"}; writes: ${writes.join(", ") || "none"}`
  );
}

/** A Checkpoint of the Book was taken before the Agent's first change to it. */
function checkpointed(run: TaskRun, bookId: string): CheckResult {
  const taken = run.after.checkpoints.filter((entry) => entry.bookId === bookId);
  return check(
    "Checkpoint taken before the first write",
    taken.length === 1 && /^Before .+ edits$/.test(taken[0].label),
    JSON.stringify(run.after.checkpoints)
  );
}

function titlesInOrder(run: TaskRun, bookId: string): string[] {
  return run.after.chapters
    .filter((entry) => entry.bookId === bookId)
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.title);
}

export const EVAL_TASKS: readonly EvalTask[] = [
  {
    id: "1",
    title: "Find a Note by Tag and read it",
    prompt:
      "In my Maibuk Library, find the Note tagged keeper and read it. Then tell me the keeper's full name and how many years she has kept the light. Do not change anything.",
    // One tag-filtered list_notes page (~27, a single hit) and one read_note
    // of a 30-word Note (~96): ~125. Room for an orienting list_books and
    // get_book (~130) and one wrong read (~70): FIXED_COST + ~330, set at
    // +500. Lists that carried Note bodies, or a read that sent both formats,
    // would spend it.
    budget: FIXED_COST + 500,
    check(run) {
      const read = successful(run.calls, "read_note").some((call) =>
        IDS.keeperNote.startsWith(String(call.args.note ?? "").trim())
      );
      return [
        check("read the tagged Note", read, run.calls.map((call) => call.name).join(", ")),
        check(
          "answer names the keeper",
          /Ottilie\s+Marsh/i.test(run.answer),
          run.answer.slice(0, 300)
        ),
        check(
          "answer gives the years",
          /\b(31|thirty[- ]one)\b/i.test(run.answer),
          run.answer.slice(0, 300)
        ),
        check(
          "answer does not name the distractor",
          !/Abel\s+Crane/i.test(run.answer),
          run.answer.slice(0, 300)
        ),
        libraryUnchanged(run),
      ];
    },
  },
  {
    id: "2",
    title: "Append a scene to a Chapter",
    prompt: `In my Maibuk Book "The Lighthouse Keeper", add this scene to the end of the Chapter "Storm", as two paragraphs, without changing anything already in it:\n\n${STORM_SCENE.join("\n\n")}`,
    // get_book to find the Chapter (~100), one append whose arguments carry
    // the ~40-word scene (~70) and its answer (~25). A careful Agent reads
    // the 74-word Chapter first to see how it ends (~140): ~335, plus a
    // list_books (~30), set at +600. A whole-Chapter rewrite still fits on
    // this short Chapter, so the "no whole replace" check catches it, not the
    // budget.
    budget: FIXED_COST + 600,
    check(run) {
      const after = chapterOf(run, IDS.storm);
      const html = after?.html ?? "";
      const tail = STORM_SCENE.map((text) => `<p>${text}</p>`).join("");
      return [
        check(
          "original Chapter kept byte for byte",
          html.startsWith(STORM_HTML),
          html.slice(0, 200)
        ),
        check(
          "scene appended at the end as two paragraphs",
          normalize(html.slice(STORM_HTML.length)) === normalize(tail),
          html.slice(STORM_HTML.length)
        ),
        check(
          "no whole replace",
          successful(run.calls, "write_chapter").length === 0,
          run.calls.map((call) => call.name).join(", ")
        ),
        checkpointed(run, LIGHTHOUSE),
        othersUntouched(run, [IDS.storm]),
      ];
    },
  },
  {
    id: "3",
    title: "Fix a typo with find-and-replace",
    prompt:
      'In my Maibuk Book "The Lighthouse Keeper", the Chapter "Arrival" misspells the word lighthouse once. Fix that typo and change nothing else.',
    // get_book (~100), one read of the 204-word Chapter to find the typo
    // (~315 as text), one find-and-replace with a few words of context and
    // its answer (~55): ~470. Room for one retry (a find refused as
    // ambiguous, ~60) and a list_books: set at +900. Reading it again as HTML
    // (~350) on top of that spends the room.
    budget: FIXED_COST + 900,
    check(run) {
      const after = chapterOf(run, IDS.arrival);
      const expected = ARRIVAL_HTML.replace("lighhouse", "lighthouse");
      return [
        check(
          "typo fixed, every other byte kept",
          after?.html === expected,
          after?.html ?? "missing"
        ),
        check(
          "find-and-replace, not a whole replace",
          successful(run.calls, "edit_chapter").length >= 1 &&
            successful(run.calls, "write_chapter").length === 0,
          run.calls.map((call) => call.name).join(", ")
        ),
        checkpointed(run, LIGHTHOUSE),
        othersUntouched(run, [IDS.arrival]),
      ];
    },
  },
  {
    id: "4",
    title: "Create a Chapter and move it",
    prompt: `In my Maibuk Book "The Lighthouse Keeper", create a new Chapter titled "Interlude" at the end of the Book with this text:\n\n${INTERLUDE_TEXT}\n\nThen move it so it sits between "Arrival" and "Storm".`,
    // get_book to find the Book (~100), create (~40 arguments, ~25 answer),
    // move (~15, ~25), and a get_book to confirm the order (~100): ~305,
    // plus a list_books (~30), set at +600.
    budget: FIXED_COST + 600,
    check(run) {
      const interlude = run.after.chapters.find(
        (entry) => entry.bookId === LIGHTHOUSE && entry.title === "Interlude"
      );
      const order = titlesInOrder(run, LIGHTHOUSE);
      return [
        check(
          "Chapter created with its text",
          interlude !== undefined && normalize(interlude.text) === normalize(INTERLUDE_TEXT),
          interlude?.text ?? "missing"
        ),
        check(
          "Chapter sits between Arrival and Storm",
          JSON.stringify(order) ===
            JSON.stringify(["Arrival", "Interlude", "Storm", "The Lamp Room", "Epilogue"]),
          order.join(" | ")
        ),
        check(
          "exactly one Chapter added",
          run.after.chapters.length === run.before.chapters.length + 1,
          `${run.before.chapters.length} -> ${run.after.chapters.length}`
        ),
        checkpointed(run, LIGHTHOUSE),
        othersUntouched(run, []),
      ];
    },
  },
  {
    id: "5",
    title: "Whole replace refused after the author typed, then recovered",
    prompt: `I am still writing in this Chapter in Maibuk while you work: keep anything I type in the Chapter itself, never somewhere else. In my Book "The Lighthouse Keeper", read the Chapter "The Lamp Room", then replace its whole content with this new version, as two paragraphs:\n\n${LAMP_ROOM_REWRITE.join("\n\n")}`,
    authorTypes: { chapterId: IDS.lampRoom, html: LAMP_ROOM_AFTER_AUTHOR },
    // get_book (~100), read (~60), the refused replace (~80 arguments, ~30
    // refusal), the re-read (~75), the replace that keeps the author's
    // paragraph (~95, ~25): ~465. Room for a list_books and one more read:
    // set at +800.
    budget: FIXED_COST + 800,
    check(run) {
      const after = chapterOf(run, IDS.lampRoom);
      const text = normalize(after?.text ?? "");
      // Refused first, then a fresh read, then a Chapter write that landed:
      // the recovery the refusal's own sentence asks for, in that order. The
      // landing write may be a whole replace or edits (edit_chapter), which
      // the tool descriptions prefer for small changes; the content checks
      // below judge what it produced.
      const refusedAt = run.calls.findIndex(
        (call) => call.name === "write_chapter" && call.isError && /changed/i.test(call.text)
      );
      const rereadAt = run.calls.findIndex(
        (call, index) => index > refusedAt && call.name === "read_chapter" && !call.isError
      );
      const landedAt = run.calls.findIndex(
        (call, index) =>
          index > rereadAt &&
          (call.name === "write_chapter" || call.name === "edit_chapter") &&
          !call.isError
      );
      const refused = refusedAt !== -1 && rereadAt !== -1 && landedAt !== -1;
      return [
        check(
          "refused, re-read, then written",
          refused,
          run.calls.map((call) => `${call.name}${call.isError ? "!" : ""}`).join(", ")
        ),
        check(
          "the new version landed",
          LAMP_ROOM_REWRITE.every((paragraph) => text.includes(normalize(paragraph))),
          text
        ),
        check("the author's typing survived", text.includes(AUTHOR_TYPED), text),
        check("the old version is gone", !text.includes("watched the beam turn"), text),
        checkpointed(run, LIGHTHOUSE),
        othersUntouched(run, [IDS.lampRoom]),
      ];
    },
  },
  {
    id: "6",
    title: "Read-only mode offers no write tools",
    prompt:
      'Rename my Maibuk Book "Salt Roads" to "Salt and Iron Roads". If you cannot, tell me why in one sentence.',
    readOnly: true,
    // The read tools only, one list_books (~30) and a get_book (~100) while
    // the Agent looks for a way: ~130, set at +450. Offering the write tools
    // costs ~1,535 more in definitions alone (FIXED_COST minus the read-only
    // cost), so a server that kept them listed fails the budget too.
    budget: FIXED_COST_READ_ONLY + 450,
    check(run) {
      const offeredWrites = run.toolsOffered.filter((name) => WRITE_TOOLS.includes(name));
      return [
        check(
          "only read tools offered",
          run.toolsOffered.length > 0 && offeredWrites.length === 0,
          run.toolsOffered.join(", ")
        ),
        libraryUnchanged(run),
        check(
          "answer says it cannot write",
          /read[- ]only|can(?:no|')t|cannot|unable|not able|no (?:tool|way|write)|permission/i.test(
            run.answer
          ),
          run.answer.slice(0, 300)
        ),
      ];
    },
  },
];
