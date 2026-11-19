/**
 * Sends the three host requests a Plugin answers for one of its Canvas
 * Reference sources: `canvasReference.list`, `canvasReference.resolve`, and
 * `canvasReference.open` (#836). The source answers through the ready Plugin's
 * broker, so a stopped warm-start-capable Plugin is warm-started first, exactly
 * like a Command run from an intent Plugin (`runPluginCommandWarm`). What a
 * source answers is untrusted: the rows and text are capped and a malformed
 * entry is dropped rather than guessed at.
 */

import type {
  CanvasReferenceOpenResult,
  CanvasReferenceResolution,
  CanvasReferenceRow,
} from "@/features/canvas/references";
import type { PluginCanvasReferenceSourceDef } from "@/features/plugins/contributions-registry";
import type { PluginLifecycle } from "@/features/plugins/types";
import {
  PLUGIN_CANVAS_REFERENCE_LIST_REQUEST,
  PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST,
  PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST,
} from "@/plugin-sdk/protocol";

/** How long one Canvas Reference request may take before the Plugin counts as silent. */
export const CANVAS_REFERENCE_REQUEST_TIMEOUT_MS = 5000;

/** The most rows one listing keeps, whatever the Plugin answered. */
export const CANVAS_REFERENCE_MAX_ROWS = 200;

/** The most characters one title or subtitle keeps, whatever the Plugin answered. */
export const CANVAS_REFERENCE_MAX_TEXT = 200;

/**
 * Cuts `text` to the text limit by code point, so an emoji is never split in
 * half; the UI renders the result as plain text.
 */
function capText(text: string): string {
  const chars = Array.from(text);
  return chars.length > CANVAS_REFERENCE_MAX_TEXT
    ? chars.slice(0, CANVAS_REFERENCE_MAX_TEXT).join("")
    : text;
}

/**
 * Starts the Plugin when it is not ready and sends one request to its broker,
 * rejecting when it does not answer within the timeout.
 */
async function requestCanvasReference(
  lifecycle: PluginLifecycle | null,
  def: PluginCanvasReferenceSourceDef,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (lifecycle === null) throw new Error("Canvas References need a running Plugin");
  if (lifecycle.state(def.pluginId)?.status !== "ready") {
    const started = await lifecycle.start(def.pluginId, "warmStart");
    if (!started.ok) throw new Error(`${def.displayName} could not start`);
  }
  const runtime = lifecycle.runtime(def.pluginId);
  if (runtime === null) throw new Error(`${def.displayName} is not running`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${def.displayName} did not answer ${method}`)),
      CANVAS_REFERENCE_REQUEST_TIMEOUT_MS
    );
  });
  try {
    return await Promise.race([
      runtime.broker.request(method, { source: def.localId, ...params }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lists one Plugin source's rows for the picker. Rows without an id or a title
 * are dropped, the text is capped, and the list is cut to the row cap.
 */
export async function listPluginCanvasReferences(
  lifecycle: PluginLifecycle | null,
  def: PluginCanvasReferenceSourceDef,
  query: string
): Promise<CanvasReferenceRow[]> {
  const result = await requestCanvasReference(
    lifecycle,
    def,
    PLUGIN_CANVAS_REFERENCE_LIST_REQUEST,
    {
      query,
    }
  );
  const rows = (result as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) throw new Error(`${def.displayName} answered no rows`);

  const listed: CanvasReferenceRow[] = [];
  for (const row of rows) {
    if (listed.length >= CANVAS_REFERENCE_MAX_ROWS) break;
    if (typeof row !== "object" || row === null) continue;
    const { id, title, subtitle } = row as { id?: unknown; title?: unknown; subtitle?: unknown };
    if (typeof id !== "string" || id.length === 0 || typeof title !== "string") continue;
    listed.push({
      id,
      title: capText(title),
      ...(typeof subtitle === "string" ? { subtitle: capText(subtitle) } : {}),
    });
  }
  return listed;
}

/**
 * Resolves the asked ids against one Plugin source. Only asked ids are kept;
 * a `present` answer keeps its title and subtitle (capped), a `missing` one is
 * kept as missing, and anything else is dropped as unresolved.
 */
export async function resolvePluginCanvasReferences(
  lifecycle: PluginLifecycle | null,
  def: PluginCanvasReferenceSourceDef,
  ids: readonly string[]
): Promise<Record<string, CanvasReferenceResolution>> {
  const result = await requestCanvasReference(
    lifecycle,
    def,
    PLUGIN_CANVAS_REFERENCE_RESOLVE_REQUEST,
    { ids: [...ids] }
  );
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    throw new Error(`${def.displayName} answered no resolutions`);
  }

  const answers: Record<string, CanvasReferenceResolution> = {};
  for (const id of ids) {
    const entry = (result as Record<string, unknown>)[id];
    if (typeof entry !== "object" || entry === null) continue;
    const { status, title, subtitle } = entry as {
      status?: unknown;
      title?: unknown;
      subtitle?: unknown;
    };
    if (status === "missing") {
      answers[id] = { status: "missing" };
      continue;
    }
    if (status !== "present" || typeof title !== "string") continue;
    answers[id] = {
      status: "present",
      title: capText(title),
      value: typeof subtitle === "string" ? { subtitle: capText(subtitle) } : {},
    };
  }
  return answers;
}

/** Opens one Plugin source's target; only `opened` and `missing` are accepted. */
export async function openPluginCanvasReference(
  lifecycle: PluginLifecycle | null,
  def: PluginCanvasReferenceSourceDef,
  id: string
): Promise<CanvasReferenceOpenResult> {
  const result = await requestCanvasReference(
    lifecycle,
    def,
    PLUGIN_CANVAS_REFERENCE_OPEN_REQUEST,
    { id }
  );
  if (result === "opened" || result === "missing") return result;
  throw new Error(`${def.displayName} answered neither opened nor missing`);
}
