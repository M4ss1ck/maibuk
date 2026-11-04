import { computeChecksum } from "@/lib/checksum";

/** One pinned file: where it comes from, how big it is, and its digest. */
export interface PinnedFile {
  url: string;
  bytes: number;
  sha256: string;
}

/** Where downloaded files live; each platform verifies what it reads. */
export interface DownloadedFiles {
  read(id: string, name: string): Promise<Uint8Array | null>;
  write(id: string, name: string, data: Uint8Array): Promise<void>;
  remove(id: string): Promise<void>;
}

export async function fetchVerified(
  file: PinnedFile,
  fetchFile: (url: string) => Promise<Response> = fetch
): Promise<Uint8Array> {
  const response = await fetchFile(file.url);
  if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (data.byteLength !== file.bytes) throw new Error(`${file.url}: size mismatch`);
  if ((await computeChecksum(data)) !== file.sha256) {
    throw new Error(`${file.url}: checksum mismatch`);
  }
  return data;
}
