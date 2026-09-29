// Records the Dictation phrase conformance script (issue #285) in one sitting.
//   pnpm record:dictation-phrases <en|es> [--take N] [--device NAME]
//
// One continuous capture through `arecord`: read the line on screen, press
// Enter, read the next. The Enter presses are the cut points, measured in
// captured bytes, so there is no pause to wait out. Each clip is written as
// vendor/moonshine/phrases/<lang>/<id>.wav the moment Enter is pressed, and a
// rerun skips clips that already exist, so quitting halfway loses nothing.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { emitKeypressEvents } from "node:readline";
import { fileURLToPath } from "node:url";
import type { DictationLanguage } from "@/features/dictation/types";
import { phraseItems, type PhraseItem } from "@/test/support/dictation-phrase-set";
import { CLIP_RATE, SILENT_PEAK, clipFileName, cutClip, peak, wavBytes } from "./clips";

const here = dirname(fileURLToPath(import.meta.url));
const phrasesDir = resolve(here, "../../vendor/moonshine/phrases");

const HINT: Record<PhraseItem["kind"], string> = {
  voice: "command: say it on its own, like a command",
  punctuation: "dictate it as one sentence, saying the punctuation words",
  prose: "say it as ordinary prose",
};

function parseArgs(argv: string[]) {
  const language = argv[0];
  if (language !== "en" && language !== "es") {
    console.error("usage: pnpm record:dictation-phrases <en|es> [--take N] [--device NAME]");
    process.exit(1);
  }
  const option = (name: string) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const take = Number(option("--take") ?? "1");
  if (!Number.isInteger(take) || take < 1) {
    console.error("--take must be a whole number, 1 or more");
    process.exit(1);
  }
  return { language: language as DictationLanguage, take, device: option("--device") };
}

function render(line: string) {
  process.stdout.write(`\r\x1b[2K${line}`);
}

async function main() {
  const { language, take, device } = parseArgs(process.argv.slice(2));
  const dir = join(phrasesDir, language);
  mkdirSync(dir, { recursive: true });
  const all = phraseItems(language);
  const todo = all.filter((item) => !existsSync(join(dir, clipFileName(item.id, take))));
  if (todo.length === 0) {
    console.log(`All ${all.length} ${language} clips of take ${take} exist in ${dir}.`);
    console.log("Delete a clip to record it again, or pass --take 2 for a second take.");
    return;
  }
  if (!process.stdin.isTTY) {
    console.error("run this in a terminal: it reads single key presses");
    process.exit(1);
  }

  console.log(`Recording ${todo.length} of ${all.length} ${language} lines (take ${take}).`);
  console.log("Speak at your normal pace. Keys:");
  console.log("  Enter   save this line, show the next");
  console.log("  r       redo this line (drops what you said since the last Enter)");
  console.log("  b       back: record the previous line again");
  console.log("  q       stop; saved lines stay, a rerun picks up where you left off");
  console.log("\nPress Enter to start the microphone.");

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  await new Promise<void>((done) => {
    const onKey = (_: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === "c") process.exit(130);
      if (key.name === "return") {
        process.stdin.off("keypress", onKey);
        done();
      }
    };
    process.stdin.on("keypress", onKey);
  });

  const args = ["-q", "-f", "S16_LE", "-r", String(CLIP_RATE), "-c", "1", "-t", "raw"];
  args.push("--buffer-time=50000");
  if (device) args.push("-D", device);
  const recorder = spawn("arecord", args, { stdio: ["ignore", "pipe", "inherit"] });
  const chunks: Buffer[] = [];
  let received = 0;
  let level = 0;
  recorder.stdout.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    received += chunk.length;
    level = peak(chunk);
  });
  recorder.on("error", (error) => {
    console.error(`\ncannot start arecord: ${error.message}`);
    process.exit(1);
  });

  let index = 0;
  let segmentStart = 0;
  const saved: string[] = [];
  const show = () => {
    const item = todo[index];
    const meter = "#".repeat(Math.min(20, Math.round(level * 40))).padEnd(20, ".");
    render(
      `[${index + 1}/${todo.length}] mic ${meter}  (${HINT[item.kind]})\n\x1b[2K   \x1b[1m${item.say}\x1b[0m\x1b[1A`
    );
  };
  const meterTimer = setInterval(show, 100);
  show();

  const finish = (message: string) => {
    clearInterval(meterTimer);
    recorder.kill("SIGINT");
    process.stdin.setRawMode(false);
    process.stdout.write("\n\n");
    console.log(message);
    console.log(`${saved.length} clips saved in ${dir}`);
    process.exit(0);
  };

  process.stdin.on("keypress", (_: string, key: { name?: string; ctrl?: boolean }) => {
    if ((key.ctrl && key.name === "c") || key.name === "q") {
      finish("Stopped. Rerun the same command to record the rest.");
      return;
    }
    if (key.name === "r") {
      segmentStart = received;
      return;
    }
    if (key.name === "b") {
      if (index === 0) return;
      index -= 1;
      const previous = todo[index];
      rmSync(join(dir, clipFileName(previous.id, take)), { force: true });
      saved.pop();
      segmentStart = received;
      return;
    }
    if (key.name !== "return") return;
    const raw = Buffer.concat(chunks);
    const item = todo[index];
    const clip = cutClip(raw, segmentStart, received);
    segmentStart = received;
    const file = join(dir, clipFileName(item.id, take));
    writeFileSync(file, wavBytes(clip));
    saved.push(file);
    if (peak(clip) < SILENT_PEAK) {
      process.stdout.write(
        `\n\n  "${item.say}" sounds silent: check the microphone, then press b to redo it.\n\n`
      );
    }
    index += 1;
    if (index === todo.length) finish(`Done: every ${language} line of take ${take} is recorded.`);
  });
}

await main();
