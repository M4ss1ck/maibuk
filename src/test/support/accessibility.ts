import { expect } from "vitest";
import { axe, type AxeMatchers } from "vitest-axe";

export async function expectNoAxeViolations(container: Element): Promise<void> {
  const results = await axe(container);
  (expect(results) as unknown as AxeMatchers).toHaveNoViolations();
}
