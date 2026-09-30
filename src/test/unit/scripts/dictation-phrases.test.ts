import { describe, expect, it } from "vitest";
import type { DictationLanguage } from "@/features/dictation/types";
import { scoreModel, type Clip } from "@/test/support/dictation-phrase-score";
import { phraseItems } from "@/test/support/dictation-phrase-set";
import {
  CLIP_PAD_SECONDS,
  CLIP_RATE,
  ClipCutter,
  clipFileName,
  cutClip,
  parseClipFileName,
  peak,
  wavBytes,
} from "../../../../scripts/dictation-phrases/clips";
import { renderReport, type ScoredModel } from "../../../../scripts/dictation-phrases/report";

const PUNCTUATES = { casing: true, punctuation: true, streaming: true };

function pcm(samples: number[]): Buffer {
  const buffer = Buffer.alloc(samples.length * 2);
  for (const [i, sample] of samples.entries()) buffer.writeInt16LE(sample, i * 2);
  return buffer;
}

describe("clip files", () => {
  it("writes a 16 kHz 16-bit mono WAV header", () => {
    const wav = wavBytes(pcm([1, -1, 300]));
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(CLIP_RATE);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect(wav.readInt16LE(48)).toBe(300);
  });

  it("cuts between two byte offsets and pads both sides with silence", () => {
    const raw = pcm([10, 20, 30, 40, 50]);
    const clip = cutClip(raw, 2, 7); // an odd end rounds down to a whole sample
    const pad = CLIP_PAD_SECONDS * CLIP_RATE * 2;
    expect(clip.length).toBe(pad * 2 + 4);
    expect(clip.readInt16LE(pad)).toBe(20);
    expect(clip.readInt16LE(pad + 2)).toBe(30);
    expect(peak(clip.subarray(0, pad))).toBe(0);
  });

  it("clamps offsets past the capture", () => {
    const clip = cutClip(pcm([7]), 0, 999);
    expect(clip.length).toBe(CLIP_PAD_SECONDS * CLIP_RATE * 4 + 2);
  });

  it("measures the loudest sample as a share of full scale", () => {
    expect(peak(pcm([0, -16384, 100]))).toBe(0.5);
  });

  it("names takes and reads the names back", () => {
    expect(clipFileName("v-make-bold", 1)).toBe("v-make-bold.wav");
    expect(clipFileName("v-make-bold", 3)).toBe("v-make-bold.t3.wav");
    expect(parseClipFileName("v-make-bold.wav")).toEqual({ id: "v-make-bold", take: 1 });
    expect(parseClipFileName("v-make-bold.t3.wav")).toEqual({ id: "v-make-bold", take: 3 });
    expect(parseClipFileName("notes.txt")).toBeNull();
    expect(parseClipFileName("x.t0.wav")).toBeNull();
  });
});

describe("ClipCutter", () => {
  it("cuts each line where Enter was pressed", () => {
    const cutter = new ClipCutter(2);
    expect(cutter.next(100)).toEqual({ index: 0, start: 0, end: 100 });
    expect(cutter.done).toBe(false);
    expect(cutter.next(250)).toEqual({ index: 1, start: 100, end: 250 });
    expect(cutter.done).toBe(true);
  });

  it("redo drops what was said since the last cut", () => {
    const cutter = new ClipCutter(1);
    cutter.redo(80);
    expect(cutter.next(200)).toEqual({ index: 0, start: 80, end: 200 });
  });

  it("back reopens the previous line from now, and does nothing on the first", () => {
    const cutter = new ClipCutter(3);
    expect(cutter.back(10)).toBeNull();
    cutter.next(100);
    expect(cutter.back(140)).toBe(0);
    expect(cutter.next(300)).toEqual({ index: 0, start: 140, end: 300 });
  });
});

function model(
  tier: "fast" | "accurate",
  clips: Clip[],
  language: DictationLanguage = "en"
): ScoredModel {
  return {
    spec: { id: `moonshine-${tier}-${language}`, tier, languages: [language] },
    clipCount: clips.length,
    score: scoreModel({ language, capabilities: PUNCTUATES, clips }),
  };
}

/** Every clip heard as read, except the prose that fires on its own text. */
function cleanClips(language: DictationLanguage = "en"): Clip[] {
  return phraseItems(language).map((item) => ({
    itemId: item.id,
    finals: [item.kind === "prose" ? "the weather was fine" : item.say],
  }));
}

describe("renderReport()", () => {
  it("passes when Accurate hears everything and no prose runs anything", () => {
    const report = renderReport([model("fast", cleanClips()), model("accurate", cleanClips())]);
    expect(report.failures).toEqual([]);
    expect(report.markdown).toContain(
      `| moonshine-accurate-en | accurate | ${phraseItems("en").length} | 100% | 100% | 100% | 0 (0) | pass |`
    );
    expect(report.markdown).toContain(
      "## en: under the bar on Accurate\n\nReported, not gated: this language is outside the ship bar.\n\nNone."
    );
  });

  it("fails an Accurate model under the bar and lists the phrases", () => {
    const clips = cleanClips("es").map((clip) =>
      clip.itemId.startsWith("v-") ? { ...clip, finals: ["mumble"] } : clip
    );
    const report = renderReport([model("accurate", clips, "es")]);
    expect(report.failures.some((f) => /hit rate \d+% < 80%/.test(f))).toBe(true);
    expect(report.markdown).toContain("| poner negrita | editor.bold | recorded | 0% | mumble |");
  });

  it("reports an English Accurate model under the bar without gating it", () => {
    const clips = cleanClips().map((clip) =>
      clip.itemId.startsWith("v-") ? { ...clip, finals: ["mumble"] } : clip
    );
    const report = renderReport([model("accurate", clips)]);
    expect(report.failures).toEqual([]);
    expect(report.markdown).toContain(
      "Reported, not gated: this language is outside the ship bar."
    );
  });

  it("does not hold a Fast model to the hit-rate bar", () => {
    const clips = cleanClips().map((clip) =>
      clip.itemId.startsWith("v-") ? { ...clip, finals: ["mumble"] } : clip
    );
    expect(renderReport([model("fast", clips)]).failures).toEqual([]);
  });

  it("does not fail a prose sentence that fires on its own text", () => {
    const clips = cleanClips().map((clip) =>
      clip.itemId === "x-use-code" ? { ...clip, finals: ["Use code."] } : clip
    );
    expect(renderReport([model("fast", clips)]).failures).toEqual([]);
  });

  it("fails a prose sentence misheard into an action", () => {
    const clips = cleanClips().map((clip) =>
      clip.itemId === "x-make-it-bold" ? { ...clip, finals: ["Make bold."] } : clip
    );
    expect(renderReport([model("fast", clips)]).failures).toEqual([
      "moonshine-fast-en: 1 misheard prose triggers",
    ]);
  });

  it("fails every model with a misheard prose trigger, and one with missing clips", () => {
    const clips = cleanClips().map((clip) =>
      clip.itemId === "x-make-it-bold" ? { ...clip, finals: ["Make bold."] } : clip
    );
    const report = renderReport([model("fast", clips), model("accurate", cleanClips().slice(1))]);
    expect(report.failures).toEqual([
      "moonshine-fast-en: 1 misheard prose triggers",
      "moonshine-accurate-en: 1 clips missing",
    ]);
    expect(report.markdown).toContain("## Failed bars");
  });
});
