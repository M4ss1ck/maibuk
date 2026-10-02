import { writeSeedFiles } from "../support/seed/seeds";

// The frame-rate lane needs only the seed Libraries, not the E2E file fixtures.
export default async function globalSetup(): Promise<void> {
  await writeSeedFiles();
}
