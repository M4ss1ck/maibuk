import type { Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";
import { countWords } from "./word-count";
import type { EventType, MetricEvent, WritingMetricPayload } from "./types";

interface ClassificationContext {
  workId: string | null;
  chapterId: string | null;
  deviceId: string;
  now?: Date;
}

interface Totals {
  removedWords: number;
  removedChars: number;
  addedWords: number;
  addedChars: number;
}

export function classifyTransaction(
  transaction: Transaction,
  context: ClassificationContext,
): MetricEvent[] {
  if (!transaction.docChanged) return [];
  if (transaction.getMeta("metrics:programmatic") === true) return [];

  const totals = transaction.steps.reduce<Totals>(
    (acc, step, index) => {
      if (!(step instanceof ReplaceStep)) return acc;

      const docBefore = transaction.docs[index];
      const removed = docBefore.textBetween(step.from, step.to, " ", " ");
      const inserted = step.slice.content.textBetween(
        0,
        step.slice.content.size,
        " ",
        " ",
      );

      acc.removedWords += countWords(removed);
      acc.removedChars += removed.length;
      acc.addedWords += countWords(inserted);
      acc.addedChars += inserted.length;
      return acc;
    },
    { removedWords: 0, removedChars: 0, addedWords: 0, addedChars: 0 },
  );

  if (totals.removedWords === 0 && totals.addedWords === 0) return [];

  const isPaste =
    transaction.getMeta("metrics:source") === "paste" ||
    transaction.getMeta("paste") === true;
  const isHistory = transaction.getMeta("history$") !== undefined;

  if (isPaste) {
    return [
      ...eventIfWords("writing.pasted", totals.addedWords, totals.addedChars, context),
      ...eventIfWords("writing.deleted", totals.removedWords, totals.removedChars, context),
    ];
  }

  if (isHistory) {
    return [
      ...eventIfWords("writing.typed", totals.addedWords, totals.addedChars, context),
      ...eventIfWords("writing.deleted", totals.removedWords, totals.removedChars, context),
    ];
  }

  return [
    ...eventIfWords("writing.deleted", totals.removedWords, totals.removedChars, context),
    ...eventIfWords("writing.typed", totals.addedWords, totals.addedChars, context),
  ];
}

function eventIfWords(
  eventType: EventType,
  words: number,
  chars: number,
  context: ClassificationContext,
): MetricEvent[] {
  if (words <= 0) return [];
  return [buildEvent(eventType, { words, chars, chapterId: context.chapterId }, context)];
}

function buildEvent(
  eventType: EventType,
  payload: WritingMetricPayload,
  context: ClassificationContext,
): MetricEvent {
  const now = context.now ?? new Date();
  return {
    id: crypto.randomUUID(),
    timestamp: now.toISOString(),
    localDate: formatLocalDate(now),
    tzOffsetMin: -now.getTimezoneOffset(),
    deviceId: context.deviceId,
    eventType,
    workId: context.workId,
    payload,
    schemaVersion: 1,
  };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
