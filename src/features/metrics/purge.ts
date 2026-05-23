import { getDatabase } from "../../lib/db";
import { getOrCreateDeviceId } from "./device-id";
import { invalidateCache, purgeEventsByPrefix } from "./events-repo";

export async function purgeMetricCategory(eventTypePrefix: string): Promise<number> {
  const db = await getDatabase();
  const deviceId = getOrCreateDeviceId();
  const deletedAt = new Date().toISOString();
  const purged = await purgeEventsByPrefix(db, eventTypePrefix, deviceId, deletedAt);
  await invalidateCache(db, [eventTypePrefix]);
  return purged;
}
