import { buildPluginFixtures } from "../support/plugin-fixtures-build";
import { writeSeedFiles } from "../support/seed/seeds";

// The frame-rate lane needs the seed Libraries and the source-built fixture
// Plugins its Plugin scenarios install (fixture-bench) written before any test
// seeds a device. The recorder origin only reaches the hostile fixture, which no
// frame scenario installs, so the Plugin bench fixture ignores it.
export default async function globalSetup(): Promise<void> {
  await Promise.all([writeSeedFiles(), buildPluginFixtures({ origin: "" })]);
}
