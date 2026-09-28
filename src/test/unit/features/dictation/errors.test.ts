import { describe, expect, it } from "vitest";
import { DictationError, toDictationError } from "@/features/dictation/types";

describe("toDictationError()", () => {
  it("keeps a DictationError as it is", () => {
    const error = new DictationError("model_corrupt", "a.bin");
    expect(toDictationError(error, "download_failed")).toBe(error);
  });

  it("reads a known code off a plain error object, as a native backend rejects", () => {
    const error = toDictationError({ code: "disk_full", message: "no space" }, "download_failed");
    expect(error).toBeInstanceOf(DictationError);
    expect(error.code).toBe("disk_full");
  });

  it("falls back for an unknown code and keeps the cause's message", () => {
    const error = toDictationError({ code: "EACCES" }, "download_failed");
    expect(error.code).toBe("download_failed");
    expect(toDictationError(new TypeError("network"), "engine_crashed").message).toBe(
      "engine_crashed: network"
    );
  });

  it("tolerates a thrown non-object", () => {
    expect(toDictationError(null, "cancelled").code).toBe("cancelled");
    expect(toDictationError("boom", "engine_crashed").message).toBe("engine_crashed: boom");
  });
});
