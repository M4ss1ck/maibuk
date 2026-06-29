import { getDatabase } from "../../lib/db";
import { getOrCreateDeviceId } from "./device-id";
import { invalidateAllAggregateCaches, purgeEventsByPrefix } from "./events-repo";

export async function purgeMetricCategory(eventTypePrefix: string): Promise<number> {
  const db = await getDatabase();
  const deviceId = getOrCreateDeviceId();
  const deletedAt = new Date().toISOString();
  const purged = await purgeEventsByPrefix(db, eventTypePrefix, deviceId, deletedAt);
  // After a category-wide purge we don't try to enumerate which aggregates
  // were affected — recomputing them all next read is cheap and prevents
  // future aggregate keys from going stale if this list is not updated.
  await invalidateAllAggregateCaches(db);
  return purged;
}
