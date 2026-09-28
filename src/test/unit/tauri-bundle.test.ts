import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const conf = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
const LIBS = {
  "/usr/lib/maibuk/libmoonshine.so":
    "../vendor/moonshine/linux-x86_64/lib/libmoonshine.so",
  "/usr/lib/maibuk/libonnxruntime.so.1":
    "../vendor/moonshine/linux-x86_64/lib/libonnxruntime.so.1",
};

describe("Linux bundles", () => {
  it.each(["deb", "rpm"])(
    "%s ships the dictation libraries beside each other",
    (kind) => {
      expect(conf.bundle.linux[kind].files).toMatchObject(LIBS);
    },
  );
  it("the AppImage ships them under usr/lib/maibuk", () => {
    expect(conf.bundle.linux.appimage.files).toMatchObject({
      "usr/lib/maibuk/libmoonshine.so": LIBS["/usr/lib/maibuk/libmoonshine.so"],
      "usr/lib/maibuk/libonnxruntime.so.1":
        LIBS["/usr/lib/maibuk/libonnxruntime.so.1"],
    });
  });

  it("the Arch builder copies and installs both libraries", () => {
    const script = readFileSync("scripts/build-arch-package.sh", "utf8");
    for (const name of ["libmoonshine.so", "libonnxruntime.so.1"]) {
      expect(script).toContain(`vendor/moonshine/linux-x86_64/lib/${name}`);
      expect(script).toContain(`/usr/lib/maibuk/${name}`);
    }
  });

  it("the Linux release runner installs ALSA headers before cargo", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    const linux = workflow.split("  build-linux:")[1].split("  build-windows:")[0];
    expect(linux).toContain("libasound2-dev");
  });

  it("passes the native libraries to the Arch release job", () => {
    const workflow = readFileSync(".github/workflows/release.yml", "utf8");
    for (const name of ["libmoonshine.so", "libonnxruntime.so.1"]) {
      expect(workflow).toContain(`vendor/moonshine/linux-x86_64/lib/${name}`);
      expect(workflow).toContain(`./artifacts/vendor/moonshine/linux-x86_64/lib/${name}`);
    }
  });
});
