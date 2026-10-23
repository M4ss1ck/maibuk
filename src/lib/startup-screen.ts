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
