// Image fixtures, built from this source at global setup into
// e2e/.output/fixtures/ (binaries stay out of git). The dot is a real 8x8 PNG:
// the editor, image dialog, and Cover Designer accept it everywhere a file is
// chosen through native UI.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const IMAGE_FIXTURE_DIR = resolve(import.meta.dirname, "../../.output/fixtures");

export const DOT_PNG = "dot.png";

// 8x8 opaque red square.
const DOT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z8Dwn4EIwESMolGFAB0kAgH02W5zAAAAAElFTkSuQmCC";

export async function writeImageFixtures(): Promise<void> {
  await mkdir(IMAGE_FIXTURE_DIR, { recursive: true });
  await writeFile(resolve(IMAGE_FIXTURE_DIR, DOT_PNG), Buffer.from(DOT_PNG_BASE64, "base64"));
}
