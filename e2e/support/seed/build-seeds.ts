// Builds every named seed Library into database bytes. Loaded in Node through
// Vite's SSR module loader (see seeds.ts) so the app's `@/` imports resolve.
//
// The write paths reach the database through `getDatabase()`. The Tutorial
// Library switch (ADR 0008) is the app's own supported way to point
// `getDatabase()` at an in-memory Library, so each seed switches it on around
// its builder. Nothing here writes SQL itself: schema and rows come from
// `initializeSchema()` and the per-entity write paths.

import initSqlJs from "sql.js";
import { initializeSchema } from "@/lib/db";
import { MemoryDatabaseAdapter } from "@/lib/db/memory-database";
import {
  activateTutorialDatabase,
  deactivateTutorialDatabase,
} from "@/features/tutorial/library-switch";
import { SEED_LIBRARIES, type SeedName } from "./libraries";

export async function buildSeed(name: SeedName): Promise<Uint8Array> {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();
  const adapter = new MemoryDatabaseAdapter(sqlDb);
  await initializeSchema(adapter);
  activateTutorialDatabase(adapter);
  try {
    await SEED_LIBRARIES[name]();
  } finally {
    deactivateTutorialDatabase();
  }
  // The same serialization the web adapter persists to IndexedDB.
  const bytes = sqlDb.export();
  sqlDb.close();
  return bytes;
}

export async function buildAllSeeds(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const name of Object.keys(SEED_LIBRARIES) as SeedName[]) {
    out[name] = await buildSeed(name);
  }
  return out;
}
