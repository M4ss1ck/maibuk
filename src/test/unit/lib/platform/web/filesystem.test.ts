import { describe, expect, it } from "vitest";
import { webFileSystem } from "@/lib/platform/web/filesystem";

describe("webFileSystem.readAppConfigTextFile", () => {
  it("returns null: the web build has no app config or app data directory", async () => {
    await expect(webFileSystem.readAppConfigTextFile("seed.json")).resolves.toBeNull();
  });
});
