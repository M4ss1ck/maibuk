// Re-checks a frame-rate lane report against today's budget (issue #372):
//   pnpm exec tsx scripts/frame-bench-budget.ts .bench/frames-chromium.json
// Prints the budget table and exits 1 on any fail, not-measured, refused, or
// missing scenario. `pnpm bench:frames` runs the same check after a run.
import { readFileSync } from "node:fs";
import {
  type FrameBenchReport,
  checkFrameBench,
  formatFrameBench,
} from "@/test/support/frames/bench-report";

const path = process.argv[2];
if (!path) {
  console.error("usage: pnpm exec tsx scripts/frame-bench-budget.ts <frames report.json>");
  process.exit(2);
}
const report = JSON.parse(readFileSync(path, "utf8")) as FrameBenchReport;
const check = checkFrameBench(report);
console.log(formatFrameBench(report, check));
process.exit(check.ok ? 0 : 1);
