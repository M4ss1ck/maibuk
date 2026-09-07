import { exportDatabase } from "@/lib/db";

export async function generateSqlDump(): Promise<Uint8Array> {
  return await exportDatabase();
}
