# SQLite WASM over OPFS for the web Library

Research for issue #636, which pins down what ADR 0035 (`docs/adr/0035-web-library-runs-on-official-sqlite-wasm-over-opfs.md`) decides for ticket #637. Research date: 2026-10-23. Every number below was measured by the throwaway prototype in `spike/sqlite-wasm/` (git-excluded, never committed) and its raw output is in `spike/sqlite-wasm/results/*.json`. Maibuk code is cited at `a21de2f0`.

Pinned refs:

| Source | Ref |
| --- | --- |
| `@sqlite.org/sqlite-wasm` | `3.54.1-build1` (`spike/sqlite-wasm/package.json`), SQLite `3.54.1`, source id `2026-10-16 14:45:20 555e07ef` |
| `sql.js` (the engine the web build runs today) | `1.13.0` (`node_modules/sql.js/package.json`) |
| Playwright | `1.64.1`; Chromium `156.0.8078.4`, Firefox `157.0`, WebKit `27.2` |
| MDN, "Origin private file system" and "FileSystemFileHandle: createSyncAccessHandle" | fetched 2026-10-23 |
| MDN browser-compat-data | `api/FileSystemFileHandle.json`, `api/StorageManager.json` at `main`, fetched 2026-10-23 |

---

## Summary

**GO for ADR 0035.** The stock build carries FTS5 with the `trigram` tokenizer and it works, unmodified, in all three engines, in a dedicated Worker, on `opfs-sahpool`, with no COOP/COEP headers and no CDN. The exclusive lock is real and detectable three independent ways. The IndexedDB → OPFS move of a 53 MB sql.js export takes 26 ms to 112 ms in Chromium and 6 ms to 7 ms for a 12 MB Library in Firefox and WebKit, against the 125 ms to 210 ms the current build pays on **every write**. Nothing in the spike disproves a decision in the ADR, and the numbers strengthen it.

Four findings change how ticket #637 must be written rather than whether it happens:

1. **`trigram` cannot serve one- and two-character queries.** `MATCH 'el'` returns 0 rows, `LIKE '%el%'` returns the right rows only by scanning. Spec user story 32 ("a one- or two-letter query to still find matches") therefore cannot be met by the FTS5 index alone; it needs a separate path (title `LIKE`, or a normal tokenizer table) for queries under three characters.
2. **Accents are exact.** `MATCH 'cancion'` finds nothing where `MATCH 'canción'` finds 5. This is the follow-up in spec user story 70, and it is a real gap, not a formatting detail.
3. **The trigram index costs 3.5× the text it indexes** (7.5 MB of text → 26.3 MB of index) and takes 0.4 s to 1.0 s to build per 8 MB. A ten-novel Library's plain-text table plus its trigram index is the disk budget ticket #637 must plan for.
4. **`EXPLAIN QUERY PLAN` does not tell you whether `LIKE` used the trigram index** — it reports `VIRTUAL TABLE INDEX 0:L0` for both a selective pattern and a two-character one. Any test that "proves" acceleration with a query plan proves nothing; it has to be a timing or a row-count test.

## What the prototype is

A static server (`spike/sqlite-wasm/server.mjs`, no COOP/COEP headers), one page, one dedicated module Worker per page (`public/worker.js`) that installs `opfs-sahpool` and holds the only `Db`, and a Playwright driver (`run.mjs`) that runs the same suite in Chromium, Firefox and WebKit and writes every raw result to `results/<browser>-<mode>.json`. Every database call in the suite goes over the Worker boundary, so the timings include message passing.

| Command | What it does |
| --- | --- |
| `node fixtures/gen-fixture.mjs` | Builds the 53 MB (and, with `FIXTURE_BYTES`, the 12 MB) Library fixture with sql.js in Node and `db.export()` |
| `node server.mjs` | Serves `public/`, the `sqlite-wasm` dist files, `sql.js` dist files and the fixtures |
| `node run.mjs` | All browsers, all criteria, writes `results/` |
| `node sizes.mjs` | The shipped-bytes comparison |
| `node summarise.mjs` | Prints the numbers quoted below |

The fixture is realistic: `books`, `chapters` and `notes` with the columns from `src/lib/db/schema.ts`, `chapters.content` holding TipTap document JSON (27 books, 324 chapters, 108 notes, 52 M characters of prose). "Large" is 53 MB; Firefox and WebKit ran the import on the 12 MB fixture (72 chapters) because a 53 MB `ArrayBuffer` plus OPFS write was one of the two ways their content process died in this container (see "Unverified").

WebKit's OPFS is only available in a persistent context in this Playwright build, matching the repo's own note in `e2e/playwright.config.ts` ("WebKit has OPFS only in a persistent context"), so the WebKit suite ran with `launchPersistentContext`; the ephemeral run is reported separately because it is exactly the private-window case.

---

## 1. FTS5 with the `trigram` tokenizer (AC1)

**Pass in all three browsers.** `PRAGMA compile_options` reports `ENABLE_FTS5` and no `ENABLE_FTS4`; `fts5`, `fts5vocab`, `bm25()`, `highlight()` and `snippet()` all work.

Suite, per browser, on a 2,000-row table:

| Probe | Chromium 156 | Firefox 157 | WebKit 27.2 |
| --- | --- | --- | --- |
| `CREATE VIRTUAL TABLE t USING fts5(x, tokenize='trigram')` | ok, 8 ms | ok | ok |
| `WHERE t MATCH 'elena'` (case-insensitive substring) | 5 rows, 1.2 ms | 5 | 5 |
| `WHERE t MATCH '"Elena Madrigal"'` (phrase) | 5 | 5 | 5 |
| `WHERE t MATCH 'canción'` | 5 | 5 | 5 |
| `WHERE t MATCH 'cancion'` (accent dropped) | **0** | **0** | **0** |
| `WHERE t MATCH 'el'` (two characters) | **0**, no error | **0** | **0** |
| `WHERE x LIKE '%elena%'` | 250 | 250 | 250 |
| `WHERE x LIKE '%ELENA%'` | 250 | 250 | 250 |
| `WHERE x LIKE '%el%'` (two characters) | 1000 (scan) | 1000 | 1000 |
| `WHERE x GLOB '*Elena*'` | 250 | 250 | 250 |
| `WHERE x GLOB '*elena*'` (GLOB is case-sensitive) | 0 | 0 | 0 |
| `fts5vocab(t,'row')` term count | 1517 | 1517 | 1517 |
| `highlight()` / `snippet()` / `bm25()` | ok | ok | ok |
| `EXPLAIN QUERY PLAN … MATCH` | `SCAN t VIRTUAL TABLE INDEX 0:M1` | same | same |
| `EXPLAIN QUERY PLAN … LIKE` | `… INDEX 0:L0` | same | same |
| `EXPLAIN QUERY PLAN … GLOB` | `… INDEX 0:G0` | same | same |

`LIKE` and `GLOB` are indexed by the trigram tokenizer, which the plan detail (`L0`, `G0`) shows, but the plan is identical for a pattern the tokenizer cannot serve, so **the plan is not evidence**. The evidence is the timing table below: 20,000 rows of ~415 characters (8.3 M characters), `LIKE '%harbour%'` against a plain `TEXT` table and against the same rows in the trigram table, median of 7 runs, all in one Worker round trip.

| Probe (median ms) | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| Common pattern, plain table | 8.5 | 12 | 8 |
| Common pattern, trigram table | 7.7 | 9 | 7 |
| Pattern that matches nothing, plain | 9.0 | 14 | 9 |
| Pattern that matches nothing, trigram | **0.3** | **0.0** | **0.0** |
| Two-character pattern, plain | 3.3 | 5 | 4 |
| Two-character pattern, trigram | 6.3 | 6 | 6 |
| Trigram index size for 7.5 MB of text | 26.3 MB | 26.3 MB | 26.3 MB |
| Trigram index build, 20,000 rows | 950 ms | 638 ms | 422 ms |
| Row counts, plain vs trigram | equal | equal | equal |

What this means for #637:

- A **selective** pattern is 30× faster through the index on all three engines. A pattern hitting 7,500 of 20,000 rows is dominated by the cost of emitting rows, so trigram buys nothing there — as expected.
- The index is **3.5× the indexed text**. At the spec's "ten novels" scale, a Library's plain-text table plus trigram index is the dominant on-disk cost, and OPFS quota (WebKit held 0.98 GB in an ephemeral context, Chromium and Firefox 10 GB) has to be planned against it. A per-Book or per-kind index is worth considering in #637 if Library text is expected in the hundreds of MB.
- Queries under three characters cannot use the index. The palette must keep a `LIKE`-on-title path (and, for text, either accept a scan on short queries or decline to search text below three characters). This is a product decision for #635/#638, not something #637 can fix in the schema.
- `LIKE` is case-insensitive for ASCII and `GLOB` is not; the palette's Match case switch must therefore map to `GLOB` when case matters and `LIKE` when it does not, on all three engines identically.

## 2. The exclusive lock (AC2)

**Confirmed in all three browsers, with different error names and the same root cause.** The lock is not a lock the VFS takes; it is the browser refusing a second `FileSystemSyncAccessHandle` on the same file, which MDN states plainly: "Creating a `FileSystemSyncAccessHandle` takes an exclusive lock on the file associated with the file handle. This prevents the creation of further `FileSystemSyncAccessHandle`s or `FileSystemWritableFileStream`s for the file until the existing access handle is closed."

What a second tab sees when it opens the same Library, same browser context, first tab holding the pool:

| | Chromium 156 | Firefox 157 | WebKit 27.2 |
| --- | --- | --- | --- |
| `installOpfsSAHPoolVfs` in tab 2 | rejects | rejects | rejects |
| Error name | `NoModificationAllowedError` | `NoModificationAllowedError` | `InvalidStateError` |
| Error message | `Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.` | `No modification allowed` | `The object is in an invalid state.` |
| Stage reported by the prototype | `installOpfsSAHPoolVfs` | `installOpfsSAHPoolVfs` | `installOpfsSAHPoolVfs` |
| `navigator.locks.request('maibuk-library', {ifAvailable:true})` in tab 2 | `busy` | `busy` | `busy` |
| `navigator.locks.query().held` in tab 2 | `["maibuk-library"]` | same | same |
| Raw SAH probe on every pool file (from a Worker) | `NoModificationAllowedError` | same | `InvalidStateError` |
| Tab 1 closed → a new tab opens and reads tab 1's row | ok, `"from tab 1"` | ok | ok |

Two things this pins down for #637:

1. **The pool's files live under `<directory>/.opaque/` with opaque names**, one per pool slot (`initialCapacity: 8` shows as 8 files, the largest being the database). A detection routine cannot look for `library.sqlite3` in OPFS; it has to either try to take a sync access handle on the largest file in that directory or, far simpler, not look at files at all.
2. **`preserveOnInitFailure: true` (new in SQLite 3.54) keeps the failed install from damaging the pool.** The prototype sets it; #637 should too, so a second tab's failed install can never touch the first tab's Library.

Recommended detection, in order:

```ts
// 1. The cheap, exact check, before any SQLite work: a Web Lock held for as
//    long as the Library is open. Works in all three engines, costs nothing,
//    and the holder's tab close releases it automatically.
const probe = await navigator.locks.request("maibuk-library", { ifAvailable: true }, (lock) => lock !== null);
if (!probe) showOpenInAnotherTab();
// 2. Hold it for the session: navigator.locks.request("maibuk-library", () => new Promise(() => {}))
// 3. Belt and braces: if installOpfsSAHPoolVfs still rejects, classify the
//    rejection (NoModificationAllowedError, or WebKit's InvalidStateError with
//    `preserveOnInitFailure`) as "open in another tab" and offer a Retry.
```

The Web Lock is the one to build the UI on: it is per-origin, per-browser-profile, released on tab close and on crash, and `ifAvailable` never queues. The install rejection is the backstop for the case where the pool is held by a context that does not hold the lock (an older build, or a tab from before this change).

A **hand-off** also works: `pauseVfs()` releases the pool's access handles without deleting data, and the next tab's `installOpfsSAHPoolVfs` then succeeds against the same files (measured in all three browsers: tab 2 opened the pool and read tab 1's committed row). That gives #637 a clean reload story — the outgoing page can pause before a hard reload and the incoming one re-acquires — but it is not a substitute for the one-tab rule, because two live tabs would otherwise alternate ownership behind the author's back.

## 3. Private windows (AC3)

Playwright cannot open a real private window in any browser: there is no `incognito`/`private` option, and `--incognito` is not supported. What it can do, and what was measured, is the two states that bracket the question: an **ephemeral** browser context (a profile that is thrown away when the context closes, which is what a private window is from the page's point of view) and a **persistent** profile.

| | Chromium 156 | Firefox 157 | WebKit 27.2 |
| --- | --- | --- | --- |
| OPFS in an ephemeral context | works | works | **`installOpfsSAHPoolVfs` rejects** |
| Error when it does not | — | — | `UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).` |
| `navigator.storage.getDirectory()` | present | present | present (so feature-detecting OPFS is not enough) |
| `FileSystemFileHandle.prototype.createSyncAccessHandle` in the page | absent | absent | absent |
| `createSyncAccessHandle` in a Worker | present | present | present |
| Data survives a reload | yes | yes | yes (persistent context) |
| Data survives a browser restart | yes (persistent profile) | not measured | yes (persistent profile) |
| A fresh ephemeral context sees the previous one's Library | **no** | **no** | **no** (it cannot open at all) |
| `navigator.storage.estimate().quota` | 10 GB | 10 GB | 0.98 GB |
| `navigator.storage.persist()` | `false` | did not settle within 5 s | `false` |

The WebKit row is the important one: OPFS *looks* available (`navigator.storage.getDirectory` exists, a Worker sees `createSyncAccessHandle`), and then the pool fails with a deliberately vague `UnknownError`. So the only reliable feature test is **try to install the VFS and catch the rejection** — never a capability check. This matches the repo's existing behaviour note in `e2e/playwright.config.ts`.

Two more consequences:

- **`navigator.storage.persist()` is not a signal.** It returned `false` in a persistent Chromium profile and in ordinary WebKit, and in Firefox headless it had not settled after 5 s (the prototype bounds it with a race; a production page must too, or startup can hang). The app must not gate anything on it.
- **Detection is one code path for both "private window" and "no OPFS":** attempt `installOpfsSAHPoolVfs`; on any rejection, distinguish "another tab" (see section 2: the error name plus a failing Web Lock probe) from "no usable OPFS" (everything else), and in the second case open `new sqlite3.oo1.DB(":memory:", "c")` and show the "this Library will not be kept" notice. The prototype proves the fallback is complete: an in-memory database created that way answers FTS5 `MATCH` and reports `PRAGMA database_list` as `[{seq:0, name:"main", file:""}]` in all three engines.

Sources for the parts not measured here (a real private window, per browser, is out of Playwright's reach): MDN documents OPFS as "subject to browser storage quota restrictions, just like any other origin-partitioned storage mechanism" and `createSyncAccessHandle` as Worker-only, but neither MDN nor browser-compat-data states per-browser private-mode behaviour, so that stays Unverified below.

## 4. Moving a Library from the IndexedDB blob (AC4)

The prototype follows the intended production sequence exactly: fetch the sql.js-exported bytes (standing in for the copy already in IndexedDB), write them to the same IndexedDB object store the app uses (`maibuk-db-storage` / `database` / `main`), read them back, transfer the `ArrayBuffer` into the Worker, `poolUtil.importDb(name, bytes)`, open the imported file, verify it, and only then delete the IndexedDB copy.

| | Chromium 156, 53 MB | Chromium 156, 53 MB (warm) | Firefox 157, 11.8 MB | WebKit 27.2, 11.8 MB |
| --- | --- | --- | --- | --- |
| Source size | 55,607,296 B | 55,607,296 B | 12,382,208 B | 12,382,208 B |
| IndexedDB put of the source | 188 ms | 111 ms | 63 ms | 99 ms |
| IndexedDB read back | 132 ms | 64 ms | 39 ms | 24 ms |
| `importDb` | **112 ms** (474 MiB/s) | **26 ms** (2,040 MiB/s) | **7 ms** (1,687 MiB/s) | **6 ms** (1,968 MiB/s) |
| Bytes written | 55,607,296 | 55,607,296 | 12,382,208 | 12,382,208 |
| Open the imported database | 0.4 ms | 0.3 ms | 1 ms | <1 ms |
| `PRAGMA quick_check` + row counts | 1,752 ms | 93 ms | 46 ms | 21 ms |
| `PRAGMA quick_check` result | `ok` | `ok` | `ok` | `ok` |
| Chapters read back | 324 | 324 | 72 | 72 |
| IndexedDB copy after verification | `null` | `null` | `null` | `null` |
| sql.js `new SQL.Database(bytes)` (today's open) | 44 ms | 48 ms | 10 ms | 11 ms |
| sql.js `db.export()` | 25 ms | 29 ms | 5 ms | 6 ms |
| **Today's cost of one write** (export + IndexedDB put) | **210 ms** | 125 ms | 52 ms | 73 ms |
| **OPFS cost of one write** | **7.6 ms** | 7.1 ms | 5 ms | 5 ms |
| `poolUtil.exportFile()` (for a backup-sized copy) | 63 ms | 19 ms | 5 ms | 4 ms |

Reading: the move itself is cheap — a 53 MB Library imports in 26 ms to 112 ms, and the same file opens in under a millisecond afterwards. The expensive step in the sequence is **verification**: a `PRAGMA quick_check` over 53 MB is 93 ms warm and 1.75 s cold, and it is the only part of the migration that scales with Library size in a way the author will notice. #637 should do the cheap checks (`PRAGMA quick_check` on a smaller scope, or `integrity_check(1)`, plus the table counts it already has) on a first launch and treat the full check as a background confirmation, keeping the IndexedDB copy until that confirmation passes — "until the first successful OPFS open" in the ADR is satisfiable with the cheap check, and the copy is only a 188 ms write to delete.

The fail-closed path was measured too. With a deliberately invalid source (`importDb` rejects `SQLite3Error: Input does not contain an SQLite3 database header.`) the IndexedDB copy was still intact in all three browsers (55,607,296 B / 12,382,208 B), sql.js opened it and found all 324 / all 72 chapters, and the already-open Library kept answering queries. So the ordering "keep the IndexedDB copy until the OPFS Library is verified" is implementable with the pieces that exist, and the fallback engine is still present in the bundle (it has to be: it is also today's engine until #637 lands).

One caveat the numbers make plain: the old copy plus the new pool means roughly **2× the Library size is on disk during the first launch after the update**. WebKit's 0.98 GB ephemeral quota is the tightest case; a Library above ~500 MB would fail the migration on WebKit rather than on Chromium, and #637 should surface a clear message for a `QuotaExceededError` from `importDb` instead of a generic failure.

## 5. What has to change to cross the Worker boundary (AC5)

Read: `src/lib/platform/web/database.ts`, `src/lib/platform/web/backup.ts`, `src/lib/db/sql-export.ts`, `src/lib/db/sql-export.worker.ts`, `src/lib/db/atomic.ts`, and the call sites in `src/lib/db/index.ts`. `new Worker(` appears in `src/lib/db/sql-export.ts:196`, `src/lib/spellcheck/SpellCheckService.ts:35`, `src/lib/metrics/MetricsService.ts:376`, `src/features/sync/sync-codec.ts:50`, `src/lib/platform/web/dictation/host.ts:16` and `src/features/plugins/sandbox.ts:210`; only the first is on the database path.

The adapter interface (`src/lib/platform/types.ts:13`) is already asynchronous and already returns promises, which is the reason the move is tractable at all:

| Call | Today | After the move | Change |
| --- | --- | --- | --- |
| `execute(sql, params)` | `db.run` on the main thread, then `await persist()` → `db.export()` + IndexedDB put (`database.ts:15-20`, `:52-64`) | `postMessage({op:"exec"})`, await reply; no persist step at all | Same signature; drops `writeChain`/`persist`/`persistToIndexedDB`; durability now comes from OPFS, so the promise resolves after the Worker's statement returns |
| `select(sql, params)` | `prepare`/`step`/`getAsObject` on the main thread (`:23-40`) | `postMessage({op:"select"})`, await rows | Same signature; rows are structured-cloned, which costs 27 ms to 34 ms per 10,000-row result (measured) |
| `executeAtomic(statements)` | `runAtomicSqlJs(this.db, statements)` — synchronous, no interleaving possible (`atomic.ts:44`) | One Worker message carrying the whole array; the Worker runs `BEGIN`/…/`COMMIT` (`atomic.ts` logic moves into the Worker) | Same signature. The atomicity guarantee is now "one message", which is stronger than today's single-threaded assumption: nothing else can run between the statements while the Worker owns the loop |
| `exportData()` | `exportSqlDump(this)` → second Worker (`sql-export.worker.ts`) reads pages **from the main thread** through `adapter.select` (`sql-export.ts:99-190`) | Cannot work as is: the rows live in the DB Worker, so the formatter Worker can no longer pull pages | Either (a) the DB Worker formats the dump itself and posts one `ArrayBuffer`, or (b) the DB Worker streams pages to the formatter Worker. (a) is simpler and the measured cost is low |
| `close()` | persist + `db.close()` | `postMessage({op:"close"})`; `db.close()` releases the file handle | Same signature |
| `loadFromIndexedDB()` / `migrateLegacyStorage()` | main thread, `database.ts:107-159`, `:66-69` | stays on the main thread (IndexedDB is main-thread) but is only read to feed `importDb` | Becomes the one-time migration described in section 4 |
| `WebBackupAdapter` (`backup.ts`) | receives `Uint8Array` SQL dumps from `exportDatabase()` and stores them in IndexedDB, hashing with `crypto.subtle` (`:83-101`) | unchanged: a `Uint8Array` is a `Uint8Array` whichever Worker produced it | None, as long as `exportData()` still resolves an `ArrayBuffer`/`Uint8Array` (transfer it out of the Worker to avoid the copy) |
| `initializeSchema`, `RESET_LIBRARY_TABLES`, version/sync stores | call `execute`/`select`/`executeAtomic` in loops | unchanged call sites, N round trips instead of N in-process calls | 0.03 ms to 0.07 ms per round trip, 13 ms to 36 ms for 500 sequential calls: not a problem, but the schema bootstrap (hundreds of statements) should be one `executeMany` message, not a loop |

Measured message costs, for sizing that last row:

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| 500 sequential `select` round trips | 13.5 ms total (0.03 ms mean, 0.1 ms p95) | 36 ms (0.07 ms) | 24 ms (0.05 ms) |
| One `select` returning 10,000 rows | 27 ms | 34 ms | 30 ms |
| One single-row write | 3.2 ms | 7 ms | 5 ms |

Proposed message API (a shape for #637, not a mandate):

```ts
type DbRequest =
  | { id: number; op: "open"; path: string; mode: "opfs" | "memory" }
  | { id: number; op: "exec"; sql: string; params?: unknown[] }
  | { id: number; op: "execMany"; statements: { sql: string; params?: unknown[] }[] }   // schema, migrations
  | { id: number; op: "select"; sql: string; params?: unknown[]; rowMode?: "object" | "array" }
  | { id: number; op: "atomic"; statements: AtomicStatement[] }
  | { id: number; op: "exportSql"; exportedAt: string; pageSize?: number }              // backup dump
  | { id: number; op: "importDb"; bytes: ArrayBuffer; name: string }                    // one-time migration
  | { id: number; op: "pause" } | { id: number; op: "resume" }                          // hand-off
  | { id: number; op: "close" };

type DbResponse =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: { name: string; message: string; code?: string; atomicIndex?: number } };
```

Two details that matter more than the message names: `error` must carry the SQLite result name (`SQLITE_CONSTRAINT_UNIQUE` and friends), because `src/features/**` branches on it today through thrown errors, and a thrown `Error` does not survive `postMessage` — the Worker has to serialise it and the main thread has to re-throw a real `Error` (with `.name`, `.code`, and `AtomicStatementError`'s `.index`/`.detail` preserved, `atomic.ts:5-22`). And every transferable (`ArrayBuffer` for `exportSql`/`importDb`, and 10,000-row result sets) should use the transfer list, or the 27 ms clone in the table above becomes a copy plus a GC spike.

## 6. Shipped bytes (AC6)

Measured with `gzip` level 9 and `brotli` quality 11 over the files as they sit in `node_modules`, served from the app's own origin:

| File | Raw | gzip | brotli |
| --- | --- | --- | --- |
| `@sqlite.org/sqlite-wasm`: `sqlite3.wasm` | 879,084 | 407,291 | 352,905 |
| `@sqlite.org/sqlite-wasm`: `index.mjs` (JS glue) | 656,872 | 178,750 | 143,883 |
| **sqlite-wasm total (what sahpool in a Worker needs)** | **1,535,956** | **586,041** | **496,788** |
| `sql.js`: `sql-wasm.wasm` | 659,806 | 322,928 | 278,505 |
| `sql.js`: `sql-wasm.js` | 48,788 | 17,455 | 15,333 |
| **sql.js total** | **708,594** | **340,383** | **293,838** |

The official build is **2.17×** sql.js raw, **1.72×** gzipped and **1.69×** brotli'd: +517 KB raw, +246 KB gzipped, +203 KB brotli'd. In practice the difference is smaller than that, because today's web build does not ship `sql-wasm.wasm` at all — `src/lib/platform/web/database.ts:145` loads it from `https://sql.js.org/dist/` — so the comparison is "0 bytes shipped + 660 KB from a third-party CDN" against "496 KB brotli'd from the app's own origin", which is also the ADR's stated reason for serving it rather than fetching it. `sqlite3-opfs-async-proxy.js` (32 KB raw, 9 KB brotli) is **not** needed for the `opfs-sahpool` VFS, and `sqlite3-worker1.mjs` (650 KB) is not needed either: the prototype's own Worker is 362 lines.

## Per-browser summary

| | Chromium 156 | Firefox 157 | WebKit 27.2 |
| --- | --- | --- | --- |
| FTS5 + trigram (AC1) | pass | pass | pass |
| LIKE/GLOB use the index | yes | yes | yes |
| Exclusive lock (AC2) | `NoModificationAllowedError` | `NoModificationAllowedError` | `InvalidStateError` |
| Web Locks detection | yes | yes | yes |
| OPFS usable in an ephemeral context | yes | yes | **no** (`UnknownError`) |
| OPFS usable in a persistent profile | yes | yes | yes |
| 53 MB import | 112 ms cold / 26 ms warm | not run (12 MB: 7 ms) | not run (12 MB: 6 ms) |
| In-memory fallback with FTS5 (AC3) | yes | yes | yes |
| `navigator.storage.persist()` | `false` | no answer in 5 s | `false` |

## Unverified

| Item | Why | What settles it |
| --- | --- | --- |
| A **real** private window in each browser (not an ephemeral Playwright context) | Playwright has no private-mode API in any engine; `--incognito` is unsupported. Ephemeral contexts are the closest equivalent, and WebKit's behaviour there already fails, which suggests private windows are no better. | A manual run of the prototype page in Chrome, Firefox and Safari private windows on a desktop, recording whether `installOpfsSAHPoolVfs` rejects. `spike/sqlite-wasm/public/index.html` works as is on any static host. |
| Firefox's OPFS across a **browser restart** | The Firefox suite ran in ephemeral mode; the persistent-profile restart section only ran for Chromium and WebKit. | `node run.mjs --only firefox --mode persistent`. |
| Firefox and WebKit importing a **53 MB** Library | A 53 MB `ArrayBuffer` plus OPFS write was one of the two ways their content process died in this container (the other was a headless SWGL framebuffer crash, which is why the runner disables WebRendering for Firefox), so they ran the 12 MB fixture. | The same run on a native machine, or `node run.mjs --only firefox` with `FIXTURE_BY_BROWSER` pointed at `library-large.sqlite3`. |
| **Android** Chrome and the Tauri webviews | Android is a first-class Maibuk platform and the ADR's "costs most on Android" argument is about the in-memory index, not about OPFS. Nothing here was measured on Android. | The prototype page on an Android Chrome, and on the Tauri Android webview (which is the system WebView, so Chromium's answer is the expected one; the Android *app* does not use the web build's database adapter at all — `src/lib/platform/index.ts:56` is the web branch). |
| WebKit with a **large** Library against its 0.98 GB quota | Only 12 MB was imported, and the quota was read from `estimate()` rather than hit. | Import a 300 MB fixture in a persistent WebKit context and record whether `importDb` throws `QuotaExceededError`. |
| `importDb`'s **chunked** callback form | The type allows a streaming callback (`SAHPoolUtil.importDb` in `index.d.mts:1114`), which would avoid one full copy of the Library in memory. Not measured. | `worker.js` `importBytes` already accepts `chunkSize`; set it to 4 MB and compare `importMs` and peak memory. |
| **Concurrent writes from two Workers** in one page (the DB Worker plus, say, a search Worker) | Not tested; `opfs-sahpool` is documented as one VFS instance per directory per context. | Install the pool in two Workers of the same page; expect the second to reject the same way a second tab does. |

## Implications for ticket #637 (the migration)

1. **Build the lock UI on `navigator.locks`, not on the OPFS error.** All three engines answer `ifAvailable` with `busy`, and the error names differ (`NoModificationAllowedError` vs `InvalidStateError`), so the error is a backstop and never the primary signal. Hold `"maibuk-library"` for the session, and pass `preserveOnInitFailure: true` to `installOpfsSAHPoolVfs`.
2. **One detection path for "no usable storage".** Attempt the install, catch everything, and fall back to `:memory:` with the "will not be kept" notice. Never test `navigator.storage.getDirectory` or `persist()`: OPFS is present in a WebKit private context and the pool still fails, and `persist()` is `false` in healthy contexts and did not answer within 5 s in Firefox.
3. **The migration sequence is cheap; its verification is not.** `importDb` of 53 MB is 26 ms to 112 ms; `quick_check` is 93 ms to 1.75 s. Verify with the cheap checks, delete the IndexedDB copy then, and run the full `quick_check` in the background. Keep the copy until then, and keep sql.js in the bundle for exactly one release so a failed migration can still open the Library (proven: rejected import, intact copy, sql.js opened 324 chapters).
4. **Expect ~2× the Library on disk on the first launch** (IndexedDB copy + pool), and handle `QuotaExceededError` from `importDb` with a specific message; WebKit's ephemeral quota was 0.98 GB.
5. **Move the atomic load into the Worker as one message.** `runAtomicSqlJs` (`src/lib/db/atomic.ts`) uses sql.js's synchronous API and its guarantee comes from the single thread; over the boundary the guarantee becomes "one message in a FIFO", which is stronger, but the ATTACH/transaction-control validation has to move with it or be duplicated in the Worker. Serialise errors as data: `AtomicStatementError`'s `index` and `detail`, and SQLite's result name, must survive `postMessage`.
6. **`exportData()` must be re-plumbed, not reused.** `sql-export.ts` reads pages through `adapter.select` on the main thread to feed `sql-export.worker.ts`; once the DB lives in a Worker, that pull no longer exists. Format the dump inside the DB Worker (the measured `exportFile` is 19 ms to 63 ms for 53 MB) or stream pages Worker-to-Worker. `WebBackupAdapter` needs no change.
7. **The trigram index is the disk and build cost, not the search.** 3.5× the indexed text, 0.4 s to 1.0 s per 8 MB. Decide the index scope (whole Library vs per Book) and the rebuild strategy in #637/#639 against that, and keep the plain-text table so short queries and snippets do not need the index.
8. **Plan for sub-three-character queries.** The FTS5 `trigram` tokenizer cannot answer them; ticket #638 must define what a 1–2 character query does (title `LIKE` only, or "type one more character").

## Verdict: GO

ADR 0035 proceeds. Every acceptance criterion of #636 is answered with a measured result on all three engines, and no measurement contradicts the ADR:

- FTS5 with `tokenize='trigram'` is in the stock build and works unmodified in Chromium 156, Firefox 157 and WebKit 27.2 (5 of 5 probes pass, plus `fts5vocab`, `bm25`, `highlight` and `snippet`), so the "two query dialects" risk the ADR rejected as an alternative does not materialise: one schema and one query language on every platform.
- The exclusive lock is confirmed and **detectable without relying on a browser-specific error**: Web Locks answers `busy` in all three, the pool install rejects in all three (two different error names, which is exactly why the lock must be the primary signal), a closed tab releases it, and `pauseVfs()` offers a clean hand-off.
- The private-window fallback is proven end to end, including the case that matters most: WebKit's ephemeral context has OPFS present but fails the pool install with an `UnknownError`, so detection must be "try to install and catch". The in-memory fallback keeps FTS5 and is the same code path.
- The IndexedDB → OPFS move of a 53 MB sql.js export works and is fast (26 ms to 112 ms), the IndexedDB copy survives a failed import, and the sql.js fallback still opens it. The ADR's "kept until the first successful OPFS open" is implementable and cheap.
- The Worker boundary is a re-plumbing job, not a rewrite: `DatabaseAdapter` is already async, round trips cost 0.03 ms to 0.07 ms (13 ms to 36 ms for 500 sequential calls), and the only call that changes shape is `exportData()`, whose second Worker currently pulls rows from the main thread.
- Shipped bytes go from 0 (a third-party CDN) to 497 KB brotli'd served from the app's own origin, at a cost that is the ADR's stated reason for the move.

What would have made this a **NO-GO**, for the record: `trigram` missing or broken in any engine (it is not); a lock that could not be detected before opening (it can, twice over); a fallback that lost FTS5 (it does not); an import that could not be verified or that risked the IndexedDB copy (it can, and does not); or a shipped-bytes increase large enough to change the load budget (497 KB brotli'd, against 660 KB fetched from a CDN today).

The one item that stays open and is **not** a reason to stop: queries under three characters and accented queries cannot be answered by the trigram index alone. Those are product decisions for #638/#639, recorded above, and every engine behaves identically, so the web build does not become second class — it becomes as limited as an FTS5 trigram index is everywhere.
