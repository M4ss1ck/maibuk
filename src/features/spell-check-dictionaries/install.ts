import type { DownloadedFiles } from "@/lib/verified-download";
import { fetchVerified } from "@/lib/verified-download";
import type { SpellCheckDictionary } from "@/features/spell-check-dictionaries/types";

const AFF = "index.aff";
const DIC = "index.dic";
const MARKER = "pin";

function pin(entry: SpellCheckDictionary): string {
  return `${entry.aff.sha256}:${entry.dic.sha256}`;
}

/**
 * Verifies both files before touching the device: nothing is written when
 * either download is wrong. The marker goes last, so a partial install reads
 * as not installed.
 */
export async function installDictionary(
  entry: SpellCheckDictionary,
  files: DownloadedFiles,
  fetchFile: (url: string) => Promise<Response> = fetch
): Promise<void> {
  const aff = await fetchVerified(entry.aff, fetchFile);
  const dic = await fetchVerified(entry.dic, fetchFile);

  try {
    await files.write(entry.language, AFF, aff);
    await files.write(entry.language, DIC, dic);
    await files.write(entry.language, MARKER, new TextEncoder().encode(pin(entry)));
  } catch (error) {
    await files.remove(entry.language);
    throw error;
  }
}

/** The installed pair, or null when this entry's current pins are not on disk. */
export async function readInstalledDictionary(
  entry: SpellCheckDictionary,
  files: DownloadedFiles
): Promise<{ aff: Uint8Array; dic: Uint8Array } | null> {
  if (!(await isDictionaryInstalled(entry, files))) return null;

  const aff = await files.read(entry.language, AFF);
  const dic = await files.read(entry.language, DIC);
  if (!aff || aff.byteLength !== entry.aff.bytes || !dic || dic.byteLength !== entry.dic.bytes) {
    return null;
  }
  return { aff, dic };
}

export async function isDictionaryInstalled(
  entry: SpellCheckDictionary,
  files: DownloadedFiles
): Promise<boolean> {
  const marker = await files.read(entry.language, MARKER);
  return marker !== null && new TextDecoder().decode(marker) === pin(entry);
}
