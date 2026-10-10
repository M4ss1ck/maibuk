// The tracer fixture's message builder, imported by the entry module so the
// real loader's relative-import path is exercised in every lane.

export function buildNotification(outcome) {
  return { variant: "info", message: `tracer ready; direct fetch: ${outcome}` };
}
