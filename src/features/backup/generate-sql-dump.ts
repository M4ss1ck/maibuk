import { exportDatabase } from "@/lib/db";

export async function generateSqlDump(): Promise<string> {
  const data = await exportDatabase();
  return new TextDecoder().decode(data);
}
