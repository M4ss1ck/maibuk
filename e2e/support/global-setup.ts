// The Playwright global setup: writes the WAV/EPUB/image seeds, builds the
// source-built fixture Plugins, and starts the Node-side request recorder the
// @sandbox lane's pass rule reads (issue #446). Playwright uses the returned
// function as the global teardown, so the recorder is closed however the run
// ends.

import { writeEpubFixtures } from "./fixtures/epubs";
import { writeImageFixtures } from "./fixtures/images";
import { buildPluginFixtures } from "./plugin-fixtures-build";
import { startRequestLog } from "./request-log";
import { writeSeedFiles } from "./seed/seeds";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const requestLog = await startRequestLog();
  await Promise.all([
    writeSeedFiles(),
    writeEpubFixtures(),
    writeImageFixtures(),
    // The hostile fixture is built with the recorder's origin injected, so the
    // build follows the server's free port.
    buildPluginFixtures({ origin: requestLog.origin }),
  ]);
  return requestLog.close;
}
