import { appendFileSync } from "node:fs";
import { relative } from "node:path";
import { experimental_getRunnerTask, type Reporter, type TestModule } from "vitest/node";
import {
  githubAnnotations,
  summaryMarkdown,
  type TimedTest,
  testsOverBudget,
} from "@/test/support/time-budget-report";

// Reports tests that used more than half their timeout. It never fails the
// run: wall time on a shared runner is noise, and failing on it would be the
// same flake one step earlier. The timeout itself stays the only failure.
interface ReporterIo {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  log?: (line: string) => void;
}

export default class TimeBudgetReporter implements Reporter {
  private readonly env: NodeJS.ProcessEnv;
  private readonly cwd: string;
  private readonly log: (line: string) => void;

  // Vitest constructs a reporter with no arguments; tests pass their own io.
  constructor(io: ReporterIo = {}) {
    this.env = io.env ?? process.env;
    this.cwd = io.cwd ?? process.cwd();
    this.log = io.log ?? console.log;
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>) {
    const tests: TimedTest[] = [];
    for (const module of testModules) {
      const file = relative(this.cwd, module.moduleId);
      for (const test of module.children.allTests()) {
        const duration = test.diagnostic()?.duration;
        if (duration === undefined) continue;
        tests.push({
          file,
          name: test.fullName,
          durationMs: duration,
          timeoutMs: experimental_getRunnerTask(test).timeout,
        });
      }
    }
    const over = testsOverBudget(tests);

    if (this.env.GITHUB_ACTIONS === "true") {
      for (const line of githubAnnotations(over)) this.log(line);
      // The job summary is unreadable through the GitHub API, so the same
      // Markdown goes to the step log, where `gh run view --log` can reach it.
      const summary = summaryMarkdown(over);
      this.log(summary);
      // Written even when every test has room, so the summary shows the check ran.
      const summaryFile = this.env.GITHUB_STEP_SUMMARY;
      if (summaryFile) appendFileSync(summaryFile, summary);
    } else if (over.length > 0) {
      this.log(`\n${summaryMarkdown(over)}`);
    }
  }
}
