import { getConfig } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ASYNC_UTIL_TIMEOUT_MS } from "@/test/time-budget";

// The setup file configures Testing Library only under a DOM, so this check
// lives in the dom project; test-time-budget.test.ts runs in Node.
describe("test time budget under jsdom", () => {
  it("gives waitFor and findBy the suite's wait limit", () => {
    expect(getConfig().asyncUtilTimeout).toBe(ASYNC_UTIL_TIMEOUT_MS);
  });
});
