import { writeEpubFixtures } from "./fixtures/epubs";
import { writeImageFixtures } from "./fixtures/images";
import { buildPluginFixtures } from "./plugin-fixtures-build";
import { writeSeedFiles } from "./seed/seeds";

export default async function globalSetup(): Promise<void> {
  await Promise.all([
    writeSeedFiles(),
    writeEpubFixtures(),
    writeImageFixtures(),
    buildPluginFixtures(),
  ]);
}
