import { describe, expect, it } from "vitest";
import { isAbsoluteDirectoryPath, isSameDirectory } from "@/features/backup/utils";

describe("isAbsoluteDirectoryPath()", () => {
  it.each(["/mnt/backups", "/", "C:\\Backups", "c:/Backups", "\\\\server\\share\\backups"])(
    "accepts %s",
    (path) => {
      expect(isAbsoluteDirectoryPath(path)).toBe(true);
    }
  );

  it.each(["backups", "~/Backups", "./backups", "C:Backups", "", "\\\\server"])(
    "rejects %s",
    (path) => {
      expect(isAbsoluteDirectoryPath(path)).toBe(false);
    }
  );
});

describe("isSameDirectory()", () => {
  it("ignores a trailing separator", () => {
    expect(isSameDirectory("/home/a/backups/", "/home/a/backups")).toBe(true);
    expect(isSameDirectory("C:\\Backups\\", "C:\\Backups")).toBe(true);
  });

  it("ignores letter case and separator style on Windows only", () => {
    expect(isSameDirectory("C:\\Users\\A\\Backups", "c:/users/a/backups")).toBe(true);
    expect(isSameDirectory("/home/a/Backups", "/home/a/backups")).toBe(false);
  });

  it("keeps a drive or filesystem root intact", () => {
    expect(isSameDirectory("C:\\", "c:/")).toBe(true);
    expect(isSameDirectory("/", "/")).toBe(true);
  });

  it("tells different folders apart", () => {
    expect(isSameDirectory("/home/a/backups", "/home/a/backups-old")).toBe(false);
  });
});
