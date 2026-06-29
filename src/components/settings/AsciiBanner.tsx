import { useEffect, useRef } from "react";
import { maibukArt } from "@/assets/ascii/maibuk";
import {
  parseArt,
  cellIntensity,
  randomGlyph,
  hexToRgb,
  FALLBACK_RGB,
  type Grid,
} from "@/components/settings/asciiBanner.helpers";

interface AsciiBannerProps {
  art?: string;
  label?: string;
  /** Theme color (`#rrggbb`) the glyphs settle to. Defaults to brand gold. */
  color?: string;
}

const FONT_STACK = `ui-monospace, SFMono-Regular, monospace`;
const MONO_ASPECT = 0.6;
const LINE_HEIGHT = 1.0;
const RADIUS = 110;
const MAX_PUSH = 7;
const MUTATE_RATE = 0.35;
const MUTATE_INTERVAL_MS = 70;
const LETTER_ALPHA = 0.85;
const FIELD_ALPHA = 0.1;
const ROW_STEP_MS = 150;
const JITTER_MS = 400;
const SETTLE_MS = 450;
const SHOW_FIELD = true;
const ENABLE_DISTORTION = true;

export function AsciiBanner({ art = maibukArt, label = "maibuk", color }: AsciiBannerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const base = color ? hexToRgb(color) : FALLBACK_RGB;

    const grid: Grid = parseArt(art);
    const { rows, cols, cells } = grid;

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointerFine = matchMedia("(pointer:fine)").matches;

    const fieldGlyph: string[][] = cells.map((row) =>
      row.map((ch) => (ch === " " ? randomGlyph() : ch))
    );

    const mutGlyph: string[][] = cells.map((row) => row.map(() => ""));
    let lastMutate = 0;

    const lockAt: number[][] = cells.map((row) => row.map(() => 0));
    let totalDuration = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const delay = r * ROW_STEP_MS + Math.random() * JITTER_MS;
        lockAt[r][c] = delay;
        if (delay > totalDuration) {
          totalDuration = delay;
        }
      }
    }
    totalDuration += SETTLE_MS;

    let cellWidth = 0;
    let fontSize = 0;
    let rowHeight = 0;
    let cssWidth = 0;

    const layout = () => {
      cssWidth = container.clientWidth;
      if (cssWidth === 0) return;

      cellWidth = cssWidth / cols;
      fontSize = cellWidth / MONO_ASPECT;
      ctx.font = `${fontSize}px ${FONT_STACK}`;

      const advance = ctx.measureText("M").width || cellWidth;
      fontSize *= cellWidth / advance;
      rowHeight = fontSize * LINE_HEIGHT;

      const cssHeight = rows * rowHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `${fontSize}px ${FONT_STACK}`;
      ctx.textBaseline = "top";
    };

    const mouse = { x: -9999, y: -9999 };
    let hovering = false;
    let entranceStart: number | null = null;
    let rafId = 0;
    let running = false;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const colorString = (intensity: number, baseAlpha: number) => {
      const r = Math.round(lerp(base.r, 255, intensity * 0.6));
      const g = Math.round(lerp(base.g, 255, intensity * 0.6));
      const b = Math.round(lerp(base.b, 255, intensity * 0.6));
      const a = lerp(baseAlpha, 1, intensity);
      return `rgba(${r},${g},${b},${a})`;
    };

    const clear = () => ctx.clearRect(0, 0, cssWidth, rows * rowHeight);

    const draw = (now: number) => {
      clear();

      const elapsed = entranceStart === null ? Infinity : now - entranceStart;
      const inEntrance = elapsed < totalDuration;
      const entranceComplete = entranceStart !== null && !inEntrance;
      const doMutate = now - lastMutate >= MUTATE_INTERVAL_MS;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const target = cells[r][c];
          const isLetter = target !== " ";
          if (!isLetter && !SHOW_FIELD) continue;

          const x = c * cellWidth;
          const y = r * rowHeight;
          let glyph: string;
          let color: string;
          let ox = 0;
          let oy = 0;

          if (inEntrance && elapsed < lockAt[r][c]) {
            glyph = randomGlyph();
            color = colorString(0, isLetter ? LETTER_ALPHA : FIELD_ALPHA + 0.15);
          } else {
            glyph = isLetter ? target : fieldGlyph[r][c];

            let intensity = 0;
            if (hovering && entranceComplete && !reduceMotion) {
              const cx = x + cellWidth / 2;
              const cy = y + rowHeight / 2;
              const distance = Math.hypot(mouse.x - cx, mouse.y - cy);
              intensity = cellIntensity(distance, RADIUS);

              if (intensity > 0) {
                if (doMutate) {
                  mutGlyph[r][c] = Math.random() < intensity * MUTATE_RATE ? randomGlyph() : "";
                }
                if (mutGlyph[r][c]) glyph = mutGlyph[r][c];

                if (ENABLE_DISTORTION) {
                  const dx = cx - mouse.x;
                  const dy = cy - mouse.y;
                  const length = Math.hypot(dx, dy) || 1;
                  ox = (dx / length) * intensity * MAX_PUSH;
                  oy = (dy / length) * intensity * MAX_PUSH;
                }
              }
            }

            color = colorString(intensity, isLetter ? LETTER_ALPHA : FIELD_ALPHA);
          }

          ctx.fillStyle = color;
          ctx.fillText(glyph, x + ox, y + oy);
        }
      }

      if (doMutate) lastMutate = now;

      if (inEntrance || hovering) {
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

    const drawStatic = () => {
      clear();

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const target = cells[r][c];
          const isLetter = target !== " ";
          if (!isLetter && !SHOW_FIELD) continue;

          const glyph = isLetter ? target : fieldGlyph[r][c];
          ctx.fillStyle = colorString(0, isLetter ? LETTER_ALPHA : FIELD_ALPHA);
          ctx.fillText(glyph, c * cellWidth, r * rowHeight);
        }
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      layout();

      if (reduceMotion) {
        drawStatic();
      } else if (entranceStart === null) {
        clear();
      } else {
        startLoop();
      }
    });

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          intersectionObserver.disconnect();
          if (reduceMotion) {
            drawStatic();
          } else {
            entranceStart = performance.now();
            startLoop();
          }
        }
      },
      { threshold: 0.2 }
    );

    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = event.clientX - rect.left;
      mouse.y = event.clientY - rect.top;
    };

    const onEnter = () => {
      hovering = true;
      if (entranceStart !== null) {
        startLoop();
      }
    };

    const onLeave = () => {
      hovering = false;
    };

    const ready = () => {
      layout();

      if (reduceMotion) {
        drawStatic();
      } else {
        clear();
      }

      intersectionObserver.observe(container);
      resizeObserver.observe(container);

      if (pointerFine && !reduceMotion) {
        container.addEventListener("mousemove", onMove);
        container.addEventListener("mouseenter", onEnter);
        container.addEventListener("mouseleave", onLeave);
      }
    };

    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) {
        ready();
      }
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      intersectionObserver.disconnect();
      resizeObserver.disconnect();
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseenter", onEnter);
      container.removeEventListener("mouseleave", onLeave);
    };
  }, [art, color]);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={label}
      className="w-full select-none"
      style={{ lineHeight: 0 }}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}
