import { beforeEach, describe, expect, it } from "vitest";
import { useEphemeralStore } from "@/features/ephemeral";

describe("useEphemeralStore", () => {
  beforeEach(() => {
    useEphemeralStore.getState().reset();
  });

  it("starts empty", () => {
    const state = useEphemeralStore.getState();
    expect(state.content).toBe("");
    expect(state.wordCount).toBe(0);
  });

  it("updates content and word count", () => {
    useEphemeralStore.getState().setContent("<p>hello world</p>");
    useEphemeralStore.getState().setWordCount(2);
    const state = useEphemeralStore.getState();
    expect(state.content).toBe("<p>hello world</p>");
    expect(state.wordCount).toBe(2);
  });

  it("reset clears content and word count", () => {
    useEphemeralStore.getState().setContent("<p>keep nothing</p>");
    useEphemeralStore.getState().setWordCount(2);
    useEphemeralStore.getState().reset();
    const state = useEphemeralStore.getState();
    expect(state.content).toBe("");
    expect(state.wordCount).toBe(0);
  });
});
