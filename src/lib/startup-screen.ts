/**
 * Clears the `data-booting` marker index.html carries until the app is up. The
 * startup screen paints the first frame without a background transition, so the
 * marker suppresses it (`html[data-booting] body{transition:none!important}`);
 * removing it two frames after the first render lets later theme switches
 * animate again.
 */
export function endBooting(): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.removeAttribute("data-booting");
    });
  });
}

/**
 * The inline startup screen's logo entrance as it stood when React took over:
 * how far it had run, and when that was measured. The first `LoadingScreen`
 * picks the delay up from here, so React replaces the screen without the logo
 * popping back to the start of its entrance.
 */
interface StartupCapture {
  /** Milliseconds the entrance had already played. */
  elapsed: number;
  /** `performance.now()` when the capture was taken. */
  at: number;
}

/** An entrance that cannot be read is treated as over: the logo stays put. */
const FINISHED_ENTRANCE_MS = 60_000;

/**
 * How long a capture can still belong to the incoming first screen. Past it,
 * no LoadingScreen is coming (the app may have booted into /embed instead).
 */
const CAPTURE_STALE_MS = 2000;

let capture: StartupCapture | null = null;
let consumed = false;

/** Records where the inline screen's logo entrance had got to. */
export function captureStartupScreen(
  doc: Document = document,
  now: () => number = () => performance.now()
): void {
  const screen = doc.querySelector("#startup-screen");
  if (!screen) return;
  // jsdom, and any engine without the Web Animations API, report nothing here.
  const current = screen.querySelector("svg")?.getAnimations?.()[0]?.currentTime;
  capture = {
    elapsed: typeof current === "number" ? current : FINISHED_ENTRANCE_MS,
    at: now(),
  };
  consumed = false;
}

/**
 * The negative CSS animation delay that resumes the inline entrance, or null
 * when there is nothing to continue or it has already been carried over.
 */
export function startupEntranceDelay(now: () => number = () => performance.now()): string | null {
  if (!capture || consumed) return null;
  const since = now() - capture.at;
  // Past this, no LoadingScreen is coming for this capture, so a later screen
  // animates from the start. Before it, a negative delay resumes the entrance,
  // or holds the end state when the entrance is already over.
  if (since >= CAPTURE_STALE_MS) return null;
  return `-${Math.round(capture.elapsed + since)}ms`;
}

/** Marks the capture used, so a later LoadingScreen animates from the start. */
export function consumeStartupEntrance(): void {
  consumed = true;
}

/** Drops the module state between tests. */
export function resetStartupScreenForTests(): void {
  capture = null;
  consumed = false;
}
