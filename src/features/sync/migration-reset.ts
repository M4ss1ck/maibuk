import { getDatabase } from "../../lib/db";

const DONE_FLAG = "maibuk.sync.genericMigrationDone";
const EVENT_WATERMARK_KEY = "maibuk.metrics.lastEventPullAt";
const TOMBSTONE_WATERMARK_KEY = "maibuk.metrics.lastTombstonePullAt";

// One-time clean-break migration to the generic `objects` collection. The new
// collection starts empty, so book/note/version sync re-uploads on its own.
// Metrics track upload state via local `pushed_at` columns + pull watermarks,
// so we reset those once to force a full re-push under the new schema.
export async function ensureGenericCollectionMigration(): Promise<void> {
  if (localStorage.getItem(DONE_FLAG) === "1") return;

  const db = await getDatabase();
  await db.execute("UPDATE metrics_events SET pushed_at = NULL");
  await db.execute("UPDATE metrics_event_tombstones SET pushed_at = NULL");

  localStorage.removeItem(EVENT_WATERMARK_KEY);
  localStorage.removeItem(TOMBSTONE_WATERMARK_KEY);
  localStorage.setItem(DONE_FLAG, "1");
}
