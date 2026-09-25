import { writeEpubFixtures } from "./fixtures/epubs";
import { writeSeedFiles } from "./seed/seeds";

export default async function globalSetup(): Promise<void> {
  await Promise.all([writeSeedFiles(), writeEpubFixtures()]);
}
