import { BaseDirectory, writeTextFile } from "@tauri-apps/plugin-fs";

/** TEMPORARY bench-driver diagnostic: appends a line to the app config dir. */
export async function diag(line: string): Promise<void> {
  try {
    const path = "bench-diag.txt";
    let previous = "";
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      previous = await readTextFile(path, { baseDir: BaseDirectory.AppConfig });
    } catch {
      previous = "";
    }
    await writeTextFile(path, `${previous}${new Date().toISOString()} ${line}\n`, {
      baseDir: BaseDirectory.AppConfig,
    });
  } catch {
    // best effort
  }
}
