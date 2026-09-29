// Clip files for the Dictation phrase conformance lane (issue #285): the pure
// half of the recorder, so the gate lane can test it without a microphone.

export const CLIP_RATE = 16_000;
/** Silence around each clip, so the engine sees a line start and end. */
export const CLIP_PAD_SECONDS = 0.5;
/** A clip whose loudest sample is under this (of full scale) is probably silence. */
export const SILENT_PEAK = 0.02;

/** A 16-bit mono PCM WAV around `pcm` (little-endian samples). */
export function wavBytes(pcm: Buffer, rate = CLIP_RATE): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** The clip between two byte offsets of a raw capture, padded with silence. */
export function cutClip(raw: Buffer, start: number, end: number, rate = CLIP_RATE): Buffer {
  const align = (offset: number) => Math.max(0, Math.min(raw.length, offset - (offset % 2)));
  const body = raw.subarray(align(start), align(end));
  const pad = Buffer.alloc(Math.round(CLIP_PAD_SECONDS * rate) * 2);
  return Buffer.concat([pad, body, pad]);
}

/** Loudest sample of 16-bit PCM, as a share of full scale. */
export function peak(pcm: Buffer): number {
  let max = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) max = Math.max(max, Math.abs(pcm.readInt16LE(i)));
  return max / 32768;
}

/** Take 1 is `<id>.wav`; later takes are `<id>.t<n>.wav`. */
export function clipFileName(id: string, take: number): string {
  return take === 1 ? `${id}.wav` : `${id}.t${take}.wav`;
}

export function parseClipFileName(name: string): { id: string; take: number } | null {
  const match = /^([a-z0-9-]+?)(?:\.t(\d+))?\.wav$/.exec(name);
  if (!match) return null;
  const take = match[2] ? Number(match[2]) : 1;
  return take >= 1 ? { id: match[1], take } : null;
}

export interface Cut {
  index: number;
  start: number;
  end: number;
}

/**
 * Where each line's clip starts and ends in one continuous capture, driven by
 * the reader's keys. Offsets are captured bytes, not wall time, so a clip
 * never drifts from the audio it names.
 */
export class ClipCutter {
  index = 0;
  private start = 0;

  constructor(readonly count: number) {}

  get done(): boolean {
    return this.index >= this.count;
  }

  /** Enter: the current line ends here and the next one starts. */
  next(received: number): Cut {
    const cut = { index: this.index, start: this.start, end: received };
    this.start = received;
    this.index += 1;
    return cut;
  }

  /** r: the current line starts over from here. */
  redo(received: number) {
    this.start = received;
  }

  /** b: the previous line is read again from here; its index, or null on the first line. */
  back(received: number): number | null {
    if (this.index === 0) return null;
    this.index -= 1;
    this.start = received;
    return this.index;
  }
}
