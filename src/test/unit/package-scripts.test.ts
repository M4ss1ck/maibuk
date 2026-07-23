import { describe, expect, it } from "vitest";

import packageJson from "../../../package.json";

describe("package scripts", () => {
  it("delegates the signed Android release build", () => {
    expect(packageJson.scripts["build:android"]).toBe("bash scripts/build-android-release.sh");
  });
});
