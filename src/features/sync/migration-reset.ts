import { getDatabase } from "../../lib/db";

const DONE_FLAG = "maibuk.sync.genericMigrationDone";
const DONE_SETTING_KEY = "sync.genericMigrationDone";
const EVENT_WATERMARK_KEY = "maibuk.metrics.lastEventPullAt";
const TOMBSTONE_WATERMARK_KEY = "maibuk.metrics.lastTombstonePullAt";

interface SettingRow {
  value: string;
}

async function isMarkedDoneInDatabase(
  db: Awaited<ReturnType<typeof getDatabase>>
): Promise<boolean> {
  const rows = await db.select<SettingRow[]>("SELECT value FROM settings WHERE key = ? LIMIT 1", [
    DONE_SETTING_KEY,
  ]);
  return rows[0]?.value === "1";
}

async function markDoneInDatabase(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  await db.execute(
    `INSERT OR REPLACE INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)`,
    [DONE_SETTING_KEY, "1", Math.floor(Date.now() / 1000)]
  );
}

// One-time clean-break migration to the generic `objects` collection. The new
// collection starts empty, so book/note/version sync re-uploads on its own.
// Metrics track upload state via local `pushed_at` columns + pull watermarks,
// so we reset those once to force a full re-push under the new schema.
export async function ensureGenericCollectionMigration(): Promise<void> {
  const db = await getDatabase();
  if (localStorage.getItem(DONE_FLAG) === "1") {
    if (!(await isMarkedDoneInDatabase(db))) {
      await markDoneInDatabase(db);
    }
    return;
  }

  if (await isMarkedDoneInDatabase(db)) {
    localStorage.setItem(DONE_FLAG, "1");
    return;
  }

  await db.execute("UPDATE metrics_events SET pushed_at = NULL");
  await db.execute("UPDATE metrics_event_tombstones SET pushed_at = NULL");

  localStorage.removeItem(EVENT_WATERMARK_KEY);
  localStorage.removeItem(TOMBSTONE_WATERMARK_KEY);
  await markDoneInDatabase(db);
  localStorage.setItem(DONE_FLAG, "1");
}
