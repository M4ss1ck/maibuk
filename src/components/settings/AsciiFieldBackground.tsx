import { useEffect, useRef } from "react";
import {
  cellIntensity,
  randomGlyph,
  hexToRgb,
  FALLBACK_RGB,
} from "./asciiBanner.helpers";

interface AsciiFieldBackgroundProps {
  /** Theme color (`#rrggbb`) the glyphs brighten toward. Defaults to brand gold. */
  color?: string;
}

const FONT_STACK = `ui-monospace, SFMono-Regular, monospace`;
const FONT_SIZE = 16;
const MONO_ASPECT = 0.6;
const LINE_HEIGHT = 1.25;
const RADIUS = 120;
const MAX_PUSH = 6;
const MUTATE_RATE = 0.35;
const MUTATE_INTERVAL_MS = 70;
const FIELD_ALPHA = 0.13;
// After the cursor stops moving, hold briefly then ease the shimmer back down
// to the static field over FADE_MS, so it settles instead of snapping off (and
// an idle Settings page still costs nothing once it has faded).
const HOLD_MS = 250;
const FADE_MS = 800;

/**
 * A full-bleed shimmer of random glyphs behind the whole Settings page. Stays
 * pinned to the panel viewport (sticky) while the content scrolls over it, and
 * brightens/distorts near the cursor wherever there's empty space.
 */
export function AsciiFieldBackground({ color }: AsciiFieldBackgroundProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    const scroller = wrapper?.parentElement;
    if (!wrapper || !canvas || !scroller) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const base = color ? hexToRgb(color) : FALLBACK_RGB;
    const reduceMotion = matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const pointerFine = matchMedia("(pointer:fine)").matches;

    const cellWidth = FONT_SIZE * MONO_ASPECT;
    const rowHeight = FONT_SIZE * LINE_HEIGHT;

    let cols = 0;
    let rows = 0;
    let glyphs: string[][] = [];
    let mutGlyph: string[][] = [];
    let lastMutate = 0;
    let cssWidth = 0;
    let cssHeight = 0;

    const mouse = { x: -9999, y: -9999 };
    let lastMove = Number.NEGATIVE_INFINITY;
    let rafId = 0;
    let running = false;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const colorString = (intensity: number) => {
      const r = Math.round(lerp(base.r, 255, intensity * 0.6));
      const g = Math.round(lerp(base.g, 255, intensity * 0.6));
      const b = Math.round(lerp(base.b, 255, intensity * 0.6));
      const a = lerp(FIELD_ALPHA, 1, intensity);
      return `rgba(${r},${g},${b},${a})`;
    };

    const layout = () => {
      cssWidth = scroller.clientWidth;
      cssHeight = scroller.clientHeight;
      if (cssWidth === 0 || cssHeight === 0) return;

      cols = Math.ceil(cssWidth / cellWidth);
      rows = Math.ceil(cssHeight / rowHeight);
      glyphs = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => randomGlyph()),
      );
      mutGlyph = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ""),
      );

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${FONT_SIZE}px ${FONT_STACK}`;
      ctx.textBaseline = "top";
    };

    const drawStatic = () => {
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.fillStyle = colorString(0);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          ctx.fillText(glyphs[r][c], c * cellWidth, r * rowHeight);
        }
      }
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const sinceMove = now - lastMove;
      const influence =
        sinceMove <= HOLD_MS
          ? 1
          : Math.max(0, 1 - (sinceMove - HOLD_MS) / FADE_MS);
      const active = influence > 0;
      const doMutate = now - lastMutate >= MUTATE_INTERVAL_MS;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cellWidth;
          const y = r * rowHeight;
          let glyph = glyphs[r][c];
          let intensity = 0;
          let ox = 0;
          let oy = 0;

          if (active) {
            const cx = x + cellWidth / 2;
            const cy = y + rowHeight / 2;
            const distance = Math.hypot(mouse.x - cx, mouse.y - cy);
            // Scale the cursor falloff by the fade so brightness, distortion
            // and mutation all ease out together.
            intensity = cellIntensity(distance, RADIUS) * influence;

            if (intensity > 0) {
              if (doMutate) {
                mutGlyph[r][c] =
                  Math.random() < intensity * MUTATE_RATE
                    ? randomGlyph()
                    : "";
              }
              if (mutGlyph[r][c]) glyph = mutGlyph[r][c];

              const dx = cx - mouse.x;
              const dy = cy - mouse.y;
              const length = Math.hypot(dx, dy) || 1;
              ox = (dx / length) * intensity * MAX_PUSH;
              oy = (dy / length) * intensity * MAX_PUSH;
            }
          }

          ctx.fillStyle = colorString(intensity);
          ctx.fillText(glyph, x + ox, y + oy);
        }
      }

      if (doMutate) lastMutate = now;

      // Keep animating through the fade; the frame where influence reaches 0
      // has already rendered the plain static field, so we stop there.
      if (active) {
        rafId = requestAnimationFrame(draw);
      } else {
        running = false;
      }
    };

    const startLoop = () => {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(draw);
    };

    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
      // Outside the field: leave `lastMove` frozen so the running loop keeps
      // easing out from where the cursor left.
      if (!inside) return;

      mouse.x = x;
      mouse.y = y;
      lastMove = performance.now();
      startLoop();
    };

    const resizeObserver = new ResizeObserver(() => {
      layout();
      if (!running) drawStatic();
    });

    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      layout();
      drawStatic();
      resizeObserver.observe(scroller);
      if (pointerFine && !reduceMotion) {
        window.addEventListener("mousemove", onMove);
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      window.removeEventListener("mousemove", onMove);
    };
  }, [color]);

  return (
    <div
      ref={wrapperRef}
      aria-hidden="true"
      className="sticky top-0 left-0 z-0 h-0 w-full select-none pointer-events-none"
    >
      <canvas ref={canvasRef} className="absolute top-0 left-0" />
    </div>
  );
}
