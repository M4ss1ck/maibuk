// @ts-check
/* The Map Frame's drawing surface (#745, #746). The Frame's only host channel
   is `window.maibuk.port`: the Worker sends the whole `scene` on every change
   and when the Frame connects, and the Frame answers a finished Pencil stroke,
   a finished Pen line, an Eraser drag, a drawn Shape, and the Element the
   author picked.
   Points cross the port in page millimetres, the same space as the page's
   `widthMm`/`heightMm`, so the pointer's own screen pixels are converted
   through the svg's `getScreenCTM`.

   The wire shapes mirror `frame-protocol.ts`. Tests inject a point converter
   and a cleanup seam through `globalThis.__mapTestHooks`; production never
   defines it.

   It is a classic script, not a module: a relative `import` cannot resolve in
   the Frame's opaque origin (docs/plugins/frame-ui.md). Preact and htm arrive
   as `window.htmPreact` from the vendored library beside this file. */

(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the Frame loads this file as a classic script, not a module.
  "use strict";

  /**
   * @typedef {[number, number]} MapPoint
   * @typedef {"ellipse" | "rectangle" | "polygon"} ShapeKind
   * @typedef {"select" | "pencil" | "pen" | "eraser" | ShapeKind} MapTool
   * @typedef {{ d: string, stroke: string | null, strokeWidth: number, dash: string | null, fill: string | null, opacity: number }} LineShape
   * @typedef {{ id: string, shapes: LineShape[], hidden: boolean, locked: boolean, selected: boolean }} FrameSceneElement
   * @typedef {{ one: string, other: string }} PenDraftLabel
   * @typedef {{ kind: "scene", widthMm: number, heightMm: number, background: string, elements: FrameSceneElement[], tool: MapTool, zoom: number, panX: number, panY: number, penLabel: PenDraftLabel }} FrameSceneMessage
   * @typedef {{ kind: "stroke", points: MapPoint[] }} FrameStrokeMessage
   * @typedef {{ kind: "line", points: MapPoint[], curves: boolean[], closed: boolean }} FrameLineMessage
   * @typedef {{ kind: "erase", points: MapPoint[], radiusMm: number }} FrameEraseMessage
   * @typedef {{ kind: "select", id: string | null }} FrameSelectMessage
   * @typedef {{ kind: "shape", shape: ShapeKind, start: MapPoint, end: MapPoint, constrain: boolean }} FrameShapeMessage
   * @typedef {FrameSceneMessage} WorkerToFrameMessage
   * @typedef {{ pointerId: number, points: MapPoint[] }} Drawing
   * @typedef {{ points: MapPoint[], curves: boolean[] }} PenDraft
   * @typedef {{ pointerId: number, kind: ShapeKind, start: MapPoint, end: MapPoint, constrain: boolean }} ShapeDraft
   */

  const hooks = /** @type {any} */ (globalThis).__mapTestHooks || null;
  const lib = /** @type {any} */ (globalThis).htmPreact || null;
  const surface = document.getElementById("surface");
  const port = /** @type {any} */ (window).maibuk?.port ?? null;

  /** How close two pointer samples must be to count as the same point, in mm. */
  const MIN_POINT_STEP_MM = 0.05;

  /** How close a Pen click must land to the first point to close the line, in mm. */
  const CLOSE_DISTANCE_MM = 2;

  /** How far one keyboard crosshair step moves, in page millimetres. */
  const CROSSHAIR_STEP_MM = 1;
  const CROSSHAIR_FAR_STEP_MM = 10;

  /** How far the Eraser reaches at zoom 1, in page millimetres. */
  const ERASER_RADIUS_MM = 2;

  /** The crosshair's arm length, in page millimetres. */
  const CROSSHAIR_ARM_MM = 1.5;

  /**
   * How many points the Shape preview samples an ellipse at, and how many
   * sides its polygon has: `geometry.ts` draws 64 samples and
   * `DEFAULT_POLYGON_SIDES` sides, and the preview only has to agree with it.
   */
  const PREVIEW_ELLIPSE_SAMPLES = 64;
  const PREVIEW_POLYGON_SIDES = 6;

  /** A Shape drag is too small to keep when either side is under this, in mm. */
  const MIN_SHAPE_SIZE_MM = 1;

  /** The Shape tools, which draw an exact Shape by dragging (#747). */
  const SHAPE_KINDS = ["ellipse", "rectangle", "polygon"];

  /** The preview rectangle's four corners, as their signs from the box's centre. @type {MapPoint[]} */
  const PREVIEW_CORNER_SIGNS = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];

  /** The scene the Worker last sent, or null before the first one. @type {FrameSceneMessage | null} */
  let scene = null;
  /** The stroke in progress, or null. @type {Drawing | null} */
  let drawing = null;
  /** The Pen line in progress, or null. @type {PenDraft | null} */
  let penDraft = null;
  /** The keyboard crosshair, in page millimetres, or null when the Pen is not active. @type {MapPoint | null} */
  let crosshair = null;
  /** Where the pointer last hovered with the Pen, for the draft's preview segment. @type {MapPoint | null} */
  let penPointer = null;
  /** The Eraser drag in progress, or null. @type {Drawing | null} */
  let erasing = null;
  /** The Shape drag in progress, or null. @type {ShapeDraft | null} */
  let shapeDraft = null;

  /** The rendered svg, which Preact keeps across draws. @returns {SVGSVGElement | null} */
  function svgElement() {
    const svg = surface === null ? null : surface.querySelector("svg");
    return svg instanceof SVGSVGElement ? svg : null;
  }

  /** @param {unknown} value @returns {value is number} */
  function isNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  /** @param {unknown} value @returns {value is ShapeKind} */
  function isShapeKind(value) {
    return typeof value === "string" && SHAPE_KINDS.includes(value);
  }

  /**
   * The tool the author picked, or Select when the Worker sent one this Frame
   * does not know: a Frame drawn with a stale tool beats one drawn with none.
   * @param {unknown} raw
   * @returns {MapTool}
   */
  function readTool(raw) {
    if (raw === "pencil" || raw === "pen" || raw === "eraser") return raw;
    if (isShapeKind(raw)) return raw;
    return "select";
  }

  /** A number for SVG, with two decimals at most. @param {number} value @returns {string} */
  function n(value) {
    return String(Math.round(value * 100) / 100);
  }

  /**
   * Reads one render primitive, or null when it has no path to draw. A shape
   * without a usable stroke colour is a fill; without a usable fill, a stroke.
   * The Worker sends every shape's width, so one without it is malformed.
   * @param {unknown} raw
   * @returns {LineShape | null}
   */
  function readShape(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const shape = /** @type {Record<string, unknown>} */ (raw);
    if (typeof shape.d !== "string" || shape.d === "") return null;
    if (!isNumber(shape.strokeWidth) || shape.strokeWidth < 0) return null;
    return {
      d: shape.d,
      stroke: typeof shape.stroke === "string" ? shape.stroke : null,
      strokeWidth: shape.strokeWidth,
      dash: typeof shape.dash === "string" ? shape.dash : null,
      fill: typeof shape.fill === "string" ? shape.fill : null,
      opacity: isNumber(shape.opacity) ? Math.max(0, Math.min(1, shape.opacity)) : 1,
    };
  }

  /**
   * Reads the Pen draft label's two forms; an unreadable one leaves both empty,
   * which keeps the surface unnamed instead of falling back to English.
   * @param {unknown} raw
   * @returns {PenDraftLabel}
   */
  function readLabel(raw) {
    const label =
      typeof raw === "object" && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {};
    return {
      one: typeof label.one === "string" ? label.one : "",
      other: typeof label.other === "string" ? label.other : "",
    };
  }

  /**
   * Reads one scene message, or null when it is malformed and must be dropped.
   * A message needs a positive page size; everything else falls back to a
   * usable default, because a Frame with no picture is worse than one drawn
   * with the previous tool or view.
   * @param {unknown} data
   * @returns {FrameSceneMessage | null}
   */
  function readScene(data) {
    if (typeof data !== "object" || data === null) return null;
    const message = /** @type {Record<string, unknown>} */ (data);
    if (message.kind !== "scene") return null;
    if (!isNumber(message.widthMm) || message.widthMm <= 0) return null;
    if (!isNumber(message.heightMm) || message.heightMm <= 0) return null;

    /** @type {FrameSceneElement[]} */
    const elements = [];
    if (Array.isArray(message.elements)) {
      for (const raw of message.elements) {
        if (typeof raw !== "object" || raw === null) continue;
        const element = /** @type {Record<string, unknown>} */ (raw);
        if (typeof element.id !== "string" || !Array.isArray(element.shapes)) continue;
        /** @type {LineShape[]} */
        const shapes = [];
        for (const rawShape of element.shapes) {
          const shape = readShape(rawShape);
          if (shape !== null) shapes.push(shape);
        }
        elements.push({
          id: element.id,
          shapes,
          hidden: element.hidden === true,
          locked: element.locked === true,
          selected: element.selected === true,
        });
      }
    }

    return {
      kind: "scene",
      widthMm: message.widthMm,
      heightMm: message.heightMm,
      background: typeof message.background === "string" ? message.background : "transparent",
      elements,
      tool: readTool(message.tool),
      zoom: isNumber(message.zoom) && message.zoom > 0 ? message.zoom : 1,
      panX: isNumber(message.panX) ? message.panX : 0,
      panY: isNumber(message.panY) ? message.panY : 0,
      // The Worker sends the label in the app's language; the Frame has no
      // access to the Plugin's catalogs, so it picks the plural form and fills
      // in the count alone.
      penLabel: readLabel(message.penLabel),
    };
  }

  /**
   * The page rectangle the view shows, in page millimetres: zoom crops around
   * the page's centre, and pan slides the page under the view.
   * @param {FrameSceneMessage} current
   */
  function viewRect(current) {
    const width = current.widthMm / current.zoom;
    const height = current.heightMm / current.zoom;
    return {
      x: (current.widthMm - width) / 2 + current.panX,
      y: (current.heightMm - height) / 2 + current.panY,
      width,
      height,
    };
  }

  /**
   * A polyline through `points`, for the live stroke. The Worker answers with
   * the smoothed spline, so this only has to show where the hand went.
   * @param {readonly MapPoint[]} points
   * @returns {string}
   */
  function polyline(points) {
    if (points.length === 0) return "";
    let d = `M ${n(points[0][0])} ${n(points[0][1])}`;
    for (let index = 1; index < points.length; index += 1) {
      d += ` L ${n(points[index][0])} ${n(points[index][1])}`;
    }
    return d;
  }

  /**
   * Whether two page points are within the close distance of each other.
   * @param {MapPoint} a
   * @param {MapPoint} b
   * @returns {boolean}
   */
  function near(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]) <= CLOSE_DISTANCE_MM;
  }

  /**
   * The Pen draft plus the segment to where the next point would land: the
   * pointer when it hovers, the keyboard crosshair otherwise.
   * @returns {string}
   */
  function penDraftPath() {
    if (penDraft === null) return "";
    const points = [...penDraft.points];
    const preview = penPointer ?? crosshair;
    if (preview !== null && !near(preview, points[points.length - 1])) points.push(preview);
    return polyline(points);
  }

  /** The keyboard crosshair: a small plus at the next point's place. */
  function crosshairPath() {
    if (crosshair === null) return "";
    const [x, y] = crosshair;
    return `M ${n(x - CROSSHAIR_ARM_MM)} ${n(y)} L ${n(x + CROSSHAIR_ARM_MM)} ${n(y)} M ${n(
      x
    )} ${n(y - CROSSHAIR_ARM_MM)} L ${n(x)} ${n(y + CROSSHAIR_ARM_MM)}`;
  }

  /**
   * The box a Shape drag makes, mirroring `shapeFromCorners` in `geometry.ts`:
   * the drag's two corners, or with Shift a square on the longer side, growing
   * the way the drag went.
   * @param {MapPoint} start
   * @param {MapPoint} end
   * @param {boolean} constrain
   * @returns {{ cx: number, cy: number, width: number, height: number }}
   */
  function shapeBox(start, end, constrain) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    const width = constrain ? side : Math.abs(dx);
    const height = constrain ? side : Math.abs(dy);
    return {
      cx: constrain ? start[0] + (dx < 0 ? -width : width) / 2 : start[0] + dx / 2,
      cy: constrain ? start[1] + (dy < 0 ? -height : height) / 2 : start[1] + dy / 2,
      width,
      height,
    };
  }

  /**
   * The outline the Shape drag would draw, as one closed path: the ellipse, the
   * rectangle, or a six-sided polygon inscribed in its box, unrotated and with
   * square corners, which is what the Worker's `shapeOutline` starts from. The
   * box maths mirrors `shapeFromCorners`, which the Frame cannot import; the
   * Worker builds the Shape itself, so this only shows where its ink will land.
   * @returns {string}
   */
  function shapePreviewPath() {
    if (shapeDraft === null) return "";
    const { kind, start, end, constrain } = shapeDraft;
    const { cx, cy, width, height } = shapeBox(start, end, constrain);
    if (width <= 0 || height <= 0) return "";
    const radiusX = width / 2;
    const radiusY = height / 2;
    /** @type {MapPoint[]} */
    const points = [];
    if (kind === "rectangle") {
      for (const [signX, signY] of PREVIEW_CORNER_SIGNS) {
        points.push([cx + signX * radiusX, cy + signY * radiusY]);
      }
    } else {
      const sides = kind === "ellipse" ? PREVIEW_ELLIPSE_SAMPLES : PREVIEW_POLYGON_SIDES;
      for (let index = 0; index < sides; index += 1) {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / sides;
        points.push([cx + radiusX * Math.cos(angle), cy + radiusY * Math.sin(angle)]);
      }
    }
    return `${polyline(points)} Z`;
  }

  /**
   * The surface's accessible name while a Pen line is in progress, from the
   * localized label the Worker sends with the scene: the plural form the count
   * selects, with the count filled in. The svg is `aria-hidden`, so this is the
   * only count a screen reader gets. A scene without a label leaves the surface
   * unnamed rather than falling back to English.
   */
  function updateLabel() {
    if (surface === null) return;
    if (penDraft === null || scene === null) {
      surface.removeAttribute("aria-label");
      return;
    }
    const count = penDraft.points.length;
    const label = count === 1 ? scene.penLabel.one : scene.penLabel.other;
    if (label === "") {
      surface.removeAttribute("aria-label");
      return;
    }
    surface.setAttribute("aria-label", label.replace("{{count}}", String(count)));
  }

  /** Drops every gesture in progress and the crosshair, on a tool change. */
  function resetGestures() {
    drawing = null;
    penDraft = null;
    penPointer = null;
    crosshair = null;
    erasing = null;
    shapeDraft = null;
  }

  /** Keeps the keyboard crosshair at the page centre while the Pen is active. */
  function syncCrosshair() {
    if (scene === null || scene.tool !== "pen") {
      crosshair = null;
      return;
    }
    if (crosshair === null) crosshair = [scene.widthMm / 2, scene.heightMm / 2];
  }

  /**
   * Draws the current scene and any live stroke into the Frame. The drawing is
   * `aria-hidden`: a Frame's contents sit outside Maibuk's accessibility gate
   * (`docs/plugins/frame-ui.md`), and the Elements list is the drawing's
   * accessible, keyboard-operated view.
   */
  function draw() {
    if (lib === null || surface === null) return;
    updateLabel();
    const current = scene;
    if (current === null) {
      lib.render(null, surface);
      return;
    }
    const view = viewRect(current);
    const { html } = lib;
    lib.render(
      html`<svg
        viewBox="${n(view.x)} ${n(view.y)} ${n(view.width)} ${n(view.height)}"
        preserveAspectRatio="xMidYMid meet"
        data-tool="${current.tool}"
        aria-hidden="true"
      >
        <rect
          x="0"
          y="0"
          width="${n(current.widthMm)}"
          height="${n(current.heightMm)}"
          fill="${current.background}"
        />
        ${current.elements
          .filter((element) => !element.hidden && element.shapes.length > 0)
          .map(
            (element) => html`<g
              key="${element.id}"
              data-element-id="${element.id}"
              data-selected="${element.selected ? "true" : undefined}"
            >
              ${element.shapes.map(
                (shape) => html`<path
                  class="map-hit"
                  d="${shape.d}"
                  data-fill="${shape.fill === null ? undefined : "true"}"
                />`
              )}
              ${
                element.selected
                  ? element.shapes.map(
                      (shape) => html`<path class="map-selection" d="${shape.d}" />`
                    )
                  : null
              }
              ${element.shapes.map(
                (shape) => html`<path
                  class="map-line"
                  d="${shape.d}"
                  stroke="${shape.stroke ?? "none"}"
                  stroke-width="${shape.stroke === null ? undefined : n(shape.strokeWidth)}"
                  fill="${shape.fill ?? "none"}"
                  stroke-dasharray="${shape.dash ?? undefined}"
                  opacity="${shape.opacity === 1 ? undefined : n(shape.opacity)}"
                />`
              )}
            </g>`
          )}
        ${drawing === null ? null : html`<path class="map-live" d="${polyline(drawing.points)}" />`}
        ${penDraft === null ? null : html`<path class="map-live" d="${penDraftPath()}" />`}
        ${crosshair === null ? null : html`<path class="map-crosshair" d="${crosshairPath()}" />`}
        ${erasing === null ? null : html`<path class="map-live" d="${polyline(erasing.points)}" />`}
        ${
          shapeDraft === null
            ? null
            : html`<path class="map-shape-preview" d="${shapePreviewPath()}" />`
        }
      </svg>`,
      surface
    );
  }

  /** Posts one validated message to the Worker; a missing port drops it. */
  function post(message) {
    if (port === null) return;
    port.postMessage(message);
  }

  /**
   * The pointer's place on the page, in millimetres, through the svg's own
   * screen matrix, so the viewBox, zoom, and pan need no arithmetic here.
   * @param {PointerEvent | MouseEvent} event
   * @returns {MapPoint | null}
   */
  function pagePoint(event) {
    if (hooks && typeof hooks.pagePoint === "function") {
      return hooks.pagePoint(event);
    }
    const svg = svgElement();
    if (svg === null || typeof svg.getScreenCTM !== "function") return null;
    const matrix = svg.getScreenCTM();
    if (matrix === null) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    if (!isNumber(point.x) || !isNumber(point.y)) return null;
    return [point.x, point.y];
  }

  /** Keeps a stroke's pointer events coming while it leaves the svg. */
  function capturePointer(event) {
    const svg = svgElement();
    if (svg === null || typeof svg.setPointerCapture !== "function") return;
    try {
      svg.setPointerCapture(event.pointerId);
    } catch {
      /* An id the engine no longer knows cannot be captured. */
    }
  }

  /** Drops the stroke's capture; a pointer the engine already released throws. */
  function releasePointer(event) {
    const svg = svgElement();
    if (svg === null || typeof svg.releasePointerCapture !== "function") return;
    try {
      svg.releasePointerCapture(event.pointerId);
    } catch {
      /* The pointerup may arrive after the engine dropped the capture. */
    }
  }

  /**
   * Adds the next Pen point: starts the draft, appends a point, or closes the
   * line when the point lands within reach of the first one.
   * @param {MapPoint} point
   * @param {boolean} curved whether the segment into this point curves
   */
  function addPenPoint(point, curved) {
    if (penDraft === null) {
      penDraft = { points: [point], curves: [] };
      draw();
      return;
    }
    if (penDraft.points.length >= 3 && near(point, penDraft.points[0])) {
      finishPen(true);
      return;
    }
    penDraft.points.push(point);
    penDraft.curves.push(curved);
    draw();
  }

  /**
   * Ends the Pen line in progress. A line of two points or more goes to the
   * Worker; a shorter draft is dropped. A closed line adds its closing segment
   * as straight.
   * @param {boolean} closed
   */
  function finishPen(closed) {
    if (penDraft === null) return;
    const draft = penDraft;
    penDraft = null;
    penPointer = null;
    if (closed && draft.points.length >= 2) draft.curves.push(false);
    draw();
    if (draft.points.length < 2) return;
    post({ kind: "line", points: draft.points, curves: draft.curves, closed });
  }

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (scene === null) return;
    // A right or middle mouse button is never a drawing gesture; touch, pen,
    // and the primary button are.
    if (event.pointerType === "mouse" && event.button !== 0) return;

    if (scene.tool === "pencil") {
      if (drawing !== null) return;
      const point = pagePoint(event);
      if (point === null) return;
      drawing = { pointerId: event.pointerId, points: [point] };
      capturePointer(event);
      event.preventDefault();
      draw();
      return;
    }

    if (scene.tool === "pen") {
      const point = pagePoint(event);
      if (point === null) return;
      event.preventDefault();
      penPointer = point;
      addPenPoint(point, event.shiftKey === true);
      return;
    }

    if (scene.tool === "eraser") {
      if (erasing !== null) return;
      const point = pagePoint(event);
      if (point === null) return;
      erasing = { pointerId: event.pointerId, points: [point] };
      capturePointer(event);
      event.preventDefault();
      draw();
      return;
    }

    if (isShapeKind(scene.tool)) {
      if (shapeDraft !== null) return;
      const point = pagePoint(event);
      if (point === null) return;
      shapeDraft = {
        pointerId: event.pointerId,
        kind: scene.tool,
        start: point,
        end: point,
        constrain: event.shiftKey === true,
      };
      capturePointer(event);
      event.preventDefault();
      draw();
      return;
    }

    const target =
      event.target instanceof Element ? event.target.closest("[data-element-id]") : null;
    post({ kind: "select", id: target === null ? null : target.getAttribute("data-element-id") });
  }

  /**
   * A double click finishes an open Pen line. Its second click already landed
   * a duplicate point on the first, so that copy goes before the line ends.
   * @param {MouseEvent} event
   */
  function onDoubleClick(event) {
    if (scene === null || scene.tool !== "pen" || penDraft === null) return;
    event.preventDefault();
    const points = penDraft.points;
    if (points.length >= 2 && near(points[points.length - 1], points[points.length - 2])) {
      penDraft.points.pop();
      penDraft.curves.pop();
    }
    finishPen(false);
  }

  /** @param {PointerEvent} event */
  function onPointerMove(event) {
    if (scene !== null && scene.tool === "pen") {
      const hovered = pagePoint(event);
      if (hovered === null) return;
      penPointer = hovered;
      if (penDraft !== null) draw();
      return;
    }

    if (shapeDraft !== null && event.pointerId === shapeDraft.pointerId) {
      const point = pagePoint(event);
      if (point === null) return;
      shapeDraft.end = point;
      shapeDraft.constrain = event.shiftKey === true;
      draw();
      return;
    }

    if (erasing !== null && event.pointerId === erasing.pointerId) {
      const point = pagePoint(event);
      if (point === null) return;
      const last = erasing.points[erasing.points.length - 1];
      if (
        Math.abs(point[0] - last[0]) < MIN_POINT_STEP_MM &&
        Math.abs(point[1] - last[1]) < MIN_POINT_STEP_MM
      ) {
        return;
      }
      erasing.points.push(point);
      draw();
      return;
    }

    if (drawing === null || event.pointerId !== drawing.pointerId) return;
    const point = pagePoint(event);
    if (point === null) return;
    const last = drawing.points[drawing.points.length - 1];
    if (
      Math.abs(point[0] - last[0]) < MIN_POINT_STEP_MM &&
      Math.abs(point[1] - last[1]) < MIN_POINT_STEP_MM
    ) {
      return;
    }
    drawing.points.push(point);
    draw();
  }

  /**
   * Ends the stroke in progress. A finished stroke of two points or more goes
   * to the Worker; a tap with no movement is dropped.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endStroke(event, send) {
    if (drawing === null || event.pointerId !== drawing.pointerId) return;
    const points = drawing.points;
    drawing = null;
    releasePointer(event);
    draw();
    if (send && points.length >= 2) post({ kind: "stroke", points });
  }

  /**
   * Ends the Eraser drag. A drag of one point or more goes to the Worker as one
   * erase message, with the reach scaled so it stays 2mm on screen at any zoom.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endErase(event, send) {
    if (erasing === null || event.pointerId !== erasing.pointerId) return;
    const points = erasing.points;
    erasing = null;
    releasePointer(event);
    draw();
    if (send && points.length >= 1 && scene !== null) {
      post({ kind: "erase", points, radiusMm: ERASER_RADIUS_MM / scene.zoom });
    }
  }

  /**
   * Ends the Shape drag (#747). A drag the Worker can make a Shape from goes to
   * it as one Shape message, with the Shift the last preview recorded squaring
   * the box; a drag shorter than `MIN_SHAPE_SIZE_MM` on either side draws no
   * Shape at all, exactly as `shapeFromCorners` refuses it.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endShape(event, send) {
    if (shapeDraft === null || event.pointerId !== shapeDraft.pointerId) return;
    const draft = shapeDraft;
    shapeDraft = null;
    releasePointer(event);
    draw();
    // The pointerup's own Shift state is not what the author saw: the draft
    // keeps the one every pointerdown and pointermove recorded, so a Shift
    // released just before the button lifts still squares the stored Shape.
    const constrain = draft.constrain;
    if (!send) return;
    const { width, height } = shapeBox(draft.start, draft.end, constrain);
    if (width < MIN_SHAPE_SIZE_MM || height < MIN_SHAPE_SIZE_MM) return;
    post({
      kind: "shape",
      shape: draft.kind,
      start: draft.start,
      end: draft.end,
      constrain,
    });
  }

  /** Drops the Shape drag in progress, and its preview, without reporting it. */
  function cancelShape() {
    if (shapeDraft === null) return;
    shapeDraft = null;
    draw();
  }

  /** Moves the keyboard crosshair, dropping the pointer preview it replaces. */
  function moveCrosshair(dx, dy) {
    if (crosshair === null) return;
    crosshair = [crosshair[0] + dx, crosshair[1] + dy];
    penPointer = null;
    draw();
  }

  /**
   * The keyboard Pen: a crosshair moved by the arrows and points added with
   * Enter. Every key it handles is `preventDefault`ed, so the Frame keeps it
   * and the host's Commands never see it (#760); every other key forwards as
   * before.
   * @param {KeyboardEvent} event
   */
  function onKeyDown(event) {
    // Escape drops a Shape drag in progress (#747); every key the Frame does
    // not handle forwards to the host as before (#760).
    if (event.key === "Escape" && shapeDraft !== null) {
      event.preventDefault();
      cancelShape();
      return;
    }
    if (scene === null || scene.tool !== "pen" || crosshair === null) return;
    const step = event.shiftKey ? CROSSHAIR_FAR_STEP_MM : CROSSHAIR_STEP_MM;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveCrosshair(-step, 0);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveCrosshair(step, 0);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveCrosshair(0, -step);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveCrosshair(0, step);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      penPointer = null;
      addPenPoint(crosshair, event.shiftKey === true);
      return;
    }
    if (event.key === "Backspace") {
      event.preventDefault();
      if (penDraft === null || penDraft.points.length === 0) return;
      penDraft.points.pop();
      penDraft.curves.pop();
      if (penDraft.points.length === 0) penDraft = null;
      draw();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finishPen(false);
    }
  }

  /** @param {MessageEvent} event */
  function onMessage(event) {
    const next = readScene(event.data);
    if (next === null) return;
    const previousTool = scene === null ? null : scene.tool;
    scene = next;
    if (next.tool !== previousTool) resetGestures();
    syncCrosshair();
    draw();
  }

  function cleanup() {
    document.removeEventListener("keydown", onKeyDown);
    if (surface === null) return;
    surface.removeEventListener("pointerdown", onPointerDown);
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("pointerup", onPointerUp);
    surface.removeEventListener("pointercancel", onPointerCancel);
    surface.removeEventListener("dblclick", onDoubleClick);
  }

  /** @param {PointerEvent} event */
  function onPointerUp(event) {
    endStroke(event, true);
    endErase(event, true);
    endShape(event, true);
  }

  /** @param {PointerEvent} event */
  function onPointerCancel(event) {
    endStroke(event, false);
    endErase(event, false);
    endShape(event, false);
  }

  draw();

  document.addEventListener("keydown", onKeyDown);

  if (surface !== null) {
    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
    surface.addEventListener("dblclick", onDoubleClick);
  }

  if (port !== null) {
    port.onmessage = onMessage;
    port.start();
  }

  if (hooks && typeof hooks.onReady === "function") hooks.onReady(cleanup);
})();
