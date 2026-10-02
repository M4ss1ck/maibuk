import { describe, expect, it } from "vitest";

import packageJson from "../../../package.json";

describe("package scripts", () => {
  it("delegates the signed Android release build", () => {
    expect(packageJson.scripts["build:android"]).toBe("bash scripts/build-android-release.sh");
  });

  it("runs the frame-rate lane through its own runner, never playwright directly", () => {
    expect(packageJson.scripts["bench:frames"]).toBe("tsx e2e/run-frames.ts");
  });
});
