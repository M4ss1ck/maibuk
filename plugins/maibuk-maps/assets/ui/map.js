// @ts-check
/* The Map Frame's drawing surface (#745, #746, #748, #749, #750, #766). The
   Frame's only host channel is `window.maibuk.port`: the Worker sends the whole
   `scene` on every change and when the Frame connects, and the Frame answers a
   finished Pencil stroke, a finished Pen line, a finished Area Fill outline, an
   Eraser drag, a drawn Shape, a Bucket pour, a dropped Stamp, the Element the
   author picked, and a Select drag that moved one.
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
   * @typedef {"select" | "pencil" | "pen" | "bucket" | "area" | "eraser" | "insert" | ShapeKind} MapTool
   * @typedef {{ d: string, stroke: string | null, strokeWidth: number, dash: string | null, fill: string | null, fillRule?: "evenodd", opacity: number, transform?: string, clip?: string }} LineShape
   * @typedef {{ text: string, x: number, y: number, size: number, fill: string, font?: string, anchor: "start" | "middle" | "end", transform?: string }} TextShape
   * @typedef {LineShape | TextShape} SceneShape
   * @typedef {{ id: string, shapes: SceneShape[], filter: string | null, hidden: boolean, locked: boolean, selected: boolean, movable: boolean }} FrameSceneElement
   * @typedef {{ one: string, other: string }} PenDraftLabel
   * @typedef {{ kind: "scene", widthMm: number, heightMm: number, background: string, elements: FrameSceneElement[], defs: string, tool: MapTool, zoom: number, panX: number, panY: number, penLabel: PenDraftLabel }} FrameSceneMessage
   * @typedef {{ kind: "stroke", points: MapPoint[] }} FrameStrokeMessage
   * @typedef {{ kind: "line", points: MapPoint[], curves: boolean[], closed: boolean }} FrameLineMessage
   * @typedef {{ kind: "area", points: MapPoint[], curves: boolean[], freehand: boolean }} FrameAreaMessage
   * @typedef {{ kind: "erase", points: MapPoint[], radiusMm: number }} FrameEraseMessage
   * @typedef {{ kind: "select", id: string | null }} FrameSelectMessage
   * @typedef {{ kind: "shape", shape: ShapeKind, start: MapPoint, end: MapPoint, constrain: boolean }} FrameShapeMessage
   * @typedef {{ kind: "pour", point: MapPoint }} FramePourMessage
   * @typedef {{ kind: "insert", point: MapPoint }} FrameInsertMessage
   * @typedef {{ kind: "move", id: string, dx: number, dy: number }} FrameMoveMessage
   * @typedef {FrameSceneMessage} WorkerToFrameMessage
   * @typedef {{ pointerId: number, points: MapPoint[] }} Drawing
   * @typedef {{ points: MapPoint[], curves: boolean[] }} PenDraft
   * @typedef {{ pointerId: number, kind: ShapeKind, start: MapPoint, end: MapPoint, constrain: boolean }} ShapeDraft
   * @typedef {{ clientX: number, clientY: number }} ClientPoint
   * @typedef {{ pointerId: number, id: string, press: ClientPoint, client: ClientPoint, travel: MapPoint, constrain: boolean, moved: boolean, offset: MapPoint }} MoveDrag
   * @typedef {{ id: string, offset: MapPoint }} PendingMove
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

  /**
   * How far a Select press must travel before it moves the Element, in screen
   * pixels (#766), so a press with a shaky hand only selects. It is measured
   * on screen, so neither the zoom nor the panel's size changes how far a
   * hand must go.
   */
  const DRAG_THRESHOLD_PX = 4;

  /** A Shape drag is too small to keep when either side is under this, in mm. */
  const MIN_SHAPE_SIZE_MM = 1;

  /** The characters a definitions id may hold, so a scene cannot write an attribute of its own. */
  const FILTER_ID = /^[A-Za-z0-9_-]+$/;

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
  /** The keyboard crosshair, in page millimetres, or null when the Pen, the Bucket, and the Area tool are all inactive. @type {MapPoint | null} */
  let crosshair = null;
  /** Where the pointer last hovered with the Pen, for the draft's preview segment. @type {MapPoint | null} */
  let penPointer = null;
  /** The Eraser drag in progress, or null. @type {Drawing | null} */
  let erasing = null;
  /** The Shape drag in progress, or null. @type {ShapeDraft | null} */
  let shapeDraft = null;
  /** The Select drag in progress, or null. @type {MoveDrag | null} */
  let moveDrag = null;
  /**
   * A finished Select drag the Worker has not answered yet, or null. Its
   * preview stays until the next scene arrives, so the Element never jumps
   * back to its start between the release and the Worker's redraw; the Worker
   * answers every move with a scene, a refused one included. @type {PendingMove | null}
   */
  let pendingMove = null;

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
    if (
      raw === "pencil" ||
      raw === "pen" ||
      raw === "bucket" ||
      raw === "area" ||
      raw === "eraser" ||
      raw === "insert"
    ) {
      return raw;
    }
    if (isShapeKind(raw)) return raw;
    return "select";
  }

  /** A number for SVG, with two decimals at most. @param {number} value @returns {string} */
  function n(value) {
    return String(Math.round(value * 100) / 100);
  }

  /**
   * Whether a shape is text rather than a path.
   * @param {SceneShape} shape
   * @returns {shape is TextShape}
   */
  function isTextShape(shape) {
    return typeof (/** @type {TextShape} */ (shape).text) === "string";
  }

  /**
   * Reads one piece of text, or null when it cannot be drawn: one with no
   * place, no height, or no colour would paint an invisible nothing. The font
   * arrives with the shape, so the Frame draws the face an export does rather
   * than whatever the renderer defaults to.
   * @param {Record<string, unknown>} shape
   * @returns {TextShape | null}
   */
  function readTextShape(shape) {
    if (!isNumber(shape.x) || !isNumber(shape.y)) return null;
    if (!isNumber(shape.size) || shape.size <= 0) return null;
    if (typeof shape.fill !== "string") return null;
    const anchor =
      shape.anchor === "start" || shape.anchor === "middle" || shape.anchor === "end"
        ? shape.anchor
        : "start";
    return {
      text: String(shape.text),
      x: shape.x,
      y: shape.y,
      size: shape.size,
      fill: shape.fill,
      ...(typeof shape.font === "string" && shape.font !== "" ? { font: shape.font } : {}),
      anchor,
      ...(typeof shape.transform === "string" ? { transform: shape.transform } : {}),
    };
  }

  /**
   * Reads one render primitive, or null when it has no path or text to draw. A
   * path without a usable stroke colour is a fill; without a usable fill, a
   * stroke. The Worker sends every path's width, so one without it is malformed,
   * and its `fillRule` only when the fill has to cut holes in itself.
   * @param {unknown} raw
   * @returns {SceneShape | null}
   */
  function readShape(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const shape = /** @type {Record<string, unknown>} */ (raw);
    if (typeof shape.text === "string") return readTextShape(shape);
    if (typeof shape.d !== "string" || shape.d === "") return null;
    if (!isNumber(shape.strokeWidth) || shape.strokeWidth < 0) return null;
    return {
      d: shape.d,
      stroke: typeof shape.stroke === "string" ? shape.stroke : null,
      strokeWidth: shape.strokeWidth,
      dash: typeof shape.dash === "string" ? shape.dash : null,
      fill: typeof shape.fill === "string" ? shape.fill : null,
      ...(shape.fillRule === "evenodd" ? { fillRule: "evenodd" } : {}),
      opacity: isNumber(shape.opacity) ? Math.max(0, Math.min(1, shape.opacity)) : 1,
      ...(typeof shape.transform === "string" ? { transform: shape.transform } : {}),
      // A Clip Path id is only as safe as a definitions id, so it takes the same check.
      ...(typeof shape.clip === "string" && FILTER_ID.test(shape.clip) ? { clip: shape.clip } : {}),
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
   * Reads the SVG definitions the shapes reference, joined into the one
   * `<defs>` body the Frame draws (#750): the Worker writes them exactly as the
   * exported SVG does, so the Frame and the export share one definition of
   * every texture pattern, scatter Clip Path, and Soft Edge filter.
   * @param {unknown} raw
   * @returns {string}
   */
  function readDefs(raw) {
    if (!Array.isArray(raw)) return "";
    return raw.filter((entry) => typeof entry === "string" && entry !== "").join("");
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
        /** @type {SceneShape[]} */
        const shapes = [];
        for (const rawShape of element.shapes) {
          const shape = readShape(rawShape);
          if (shape !== null) shapes.push(shape);
        }
        elements.push({
          id: element.id,
          shapes,
          filter:
            typeof element.filter === "string" && FILTER_ID.test(element.filter)
              ? element.filter
              : null,
          hidden: element.hidden === true,
          locked: element.locked === true,
          selected: element.selected === true,
          // A locked Element never moves, whatever else the scene says.
          movable: element.movable === true && element.locked !== true,
        });
      }
    }

    return {
      kind: "scene",
      widthMm: message.widthMm,
      heightMm: message.heightMm,
      background: typeof message.background === "string" ? message.background : "transparent",
      elements,
      defs: readDefs(message.defs),
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
    // Only the Pen names the surface: the Area tool adds points too, but its
    // outline is not a Pen line, and a Frame with no name beats a wrong one.
    if (penDraft === null || scene === null || scene.tool !== "pen") {
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
    moveDrag = null;
    pendingMove = null;
  }

  /**
   * Keeps the keyboard crosshair at the page centre while the Pen, the Bucket,
   * or the Area tool is active: each aims with it, the Pen and the Area tool to
   * add a point and the Bucket to pour.
   */
  function syncCrosshair() {
    if (
      scene === null ||
      (scene.tool !== "pen" && scene.tool !== "bucket" && scene.tool !== "area")
    ) {
      crosshair = null;
      return;
    }
    if (crosshair === null) crosshair = [scene.widthMm / 2, scene.heightMm / 2];
  }

  /**
   * The paths and text one Element draws, under the Soft Edge filter the scene
   * gave it (#750). The selection outline stays outside the filter, so it keeps
   * its crisp edge while the art fades.
   * @param {FrameSceneElement} element
   * @returns {any}
   */
  function elementArt(element) {
    const { html } = lib;
    const art = [
      ...element.shapes
        .filter((shape) => !isTextShape(shape))
        .map(
          (shape) => html`<path
            class="map-hit"
            d="${shape.d}"
            fill-rule="${shape.fillRule ?? undefined}"
            data-fill="${shape.fill === null ? undefined : "true"}"
            transform="${shape.transform ?? undefined}"
            clip-path="${shape.clip === undefined ? undefined : `url(#${shape.clip})`}"
          />`
        ),
      ...element.shapes.map((shape) =>
        isTextShape(shape)
          ? html`<text
              class="map-line"
              x="${n(shape.x)}"
              y="${n(shape.y)}"
              font-size="${n(shape.size)}"
              font-family="${shape.font ?? undefined}"
              fill="${shape.fill}"
              text-anchor="${shape.anchor}"
              transform="${shape.transform ?? undefined}"
            >
              ${shape.text}
            </text>`
          : html`<path
              class="map-line"
              d="${shape.d}"
              stroke="${shape.stroke ?? "none"}"
              stroke-width="${shape.stroke === null ? undefined : n(shape.strokeWidth)}"
              fill="${shape.fill ?? "none"}"
              fill-rule="${shape.fillRule ?? undefined}"
              stroke-dasharray="${shape.dash ?? undefined}"
              opacity="${shape.opacity === 1 ? undefined : n(shape.opacity)}"
              transform="${shape.transform ?? undefined}"
              clip-path="${shape.clip === undefined ? undefined : `url(#${shape.clip})`}"
            />`
      ),
    ];
    if (element.filter === null) return art;
    return html`<g filter="url(#${element.filter})">${art}</g>`;
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
        ${
          current.defs === ""
            ? null
            : html`<defs
                dangerouslySetInnerHTML=${{ __html: current.defs }}
              />`
        }
        ${current.elements
          .filter((element) => !element.hidden && element.shapes.length > 0)
          .map(
            (element) => html`<g
              key="${element.id}"
              data-element-id="${element.id}"
              data-selected="${element.selected ? "true" : undefined}"
              data-movable="${element.movable ? "true" : undefined}"
              data-dragging="${isDragging(element.id) ? "true" : undefined}"
              transform="${dragTransform(element.id)}"
            >
              ${elementArt(element)}
              ${
                element.selected
                  ? element.shapes
                      .filter((shape) => !isTextShape(shape))
                      .map(
                        (shape) => html`<path
                          class="map-selection"
                          d="${shape.d}"
                          transform="${shape.transform ?? undefined}"
                        />`
                      )
                  : null
              }
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

  /**
   * Whether `id` is the Element a Select drag is moving right now, past its
   * threshold.
   * @param {string} id
   */
  function isDragging(id) {
    return moveDrag !== null && moveDrag.moved && moveDrag.id === id;
  }

  /**
   * The live offset a Select drag draws an Element at, as an SVG translate, or
   * undefined when it sits where the scene put it. A finished drag keeps its
   * offset until the Worker's next scene draws the Element there itself.
   * @param {string} id
   * @returns {string | undefined}
   */
  function dragTransform(id) {
    /** @type {MapPoint | null} */
    let offset = null;
    if (isDragging(id) && moveDrag !== null) offset = moveDrag.offset;
    else if (pendingMove !== null && pendingMove.id === id) offset = pendingMove.offset;
    if (offset === null) return undefined;
    return `translate(${n(offset[0])} ${n(offset[1])})`;
  }

  /**
   * The Select drag's offset, its travel so far with Shift keeping only the
   * longer axis, so the Element slides straight across or down.
   * @param {MoveDrag} drag
   * @returns {MapPoint}
   */
  function dragOffset(drag) {
    const [dx, dy] = drag.travel;
    if (!drag.constrain) return [dx, dy];
    return Math.abs(dx) >= Math.abs(dy) ? [dx, 0] : [0, dy];
  }

  /**
   * Follows the pointer with the Select drag: once the press has travelled
   * past the threshold, the Element moves with it, live, in this Frame only.
   *
   * The drag adds up the pointer's steps, each converted through the screen
   * matrix of the moment, never the start point against the current one: the
   * press selects the Element, the host's panels change height, and the Frame
   * can move under a still pointer mid-drag. A step measured in one matrix
   * follows the pointer; a start and an end measured in two would jump the
   * Element by the layout shift.
   * @param {PointerEvent} event
   */
  function followDrag(event) {
    if (moveDrag === null || scene === null) return;
    const from = pagePoint(moveDrag.client);
    const to = pagePoint(event);
    if (from === null || to === null) return;
    moveDrag.client = { clientX: event.clientX, clientY: event.clientY };
    moveDrag.travel = [moveDrag.travel[0] + to[0] - from[0], moveDrag.travel[1] + to[1] - from[1]];
    moveDrag.constrain = event.shiftKey === true;
    if (!moveDrag.moved) {
      const travelled = Math.hypot(
        event.clientX - moveDrag.press.clientX,
        event.clientY - moveDrag.press.clientY
      );
      if (travelled < DRAG_THRESHOLD_PX) return;
      moveDrag.moved = true;
    }
    moveDrag.offset = dragOffset(moveDrag);
    draw();
  }

  /**
   * Re-applies Shift to the Select drag in progress without waiting for the
   * pointer to move, so pressing or releasing it snaps the preview at once.
   * @param {boolean} constrain
   */
  function constrainDrag(constrain) {
    if (moveDrag === null || !moveDrag.moved || moveDrag.constrain === constrain) return;
    moveDrag.constrain = constrain;
    moveDrag.offset = dragOffset(moveDrag);
    draw();
  }

  /**
   * Ends the Select drag. A drag that moved goes to the Worker as one move,
   * which is one undo step, and its preview holds until the Worker answers; a
   * press that never passed the threshold already selected and sends nothing.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endMove(event, send) {
    if (moveDrag === null || event.pointerId !== moveDrag.pointerId) return;
    const drag = moveDrag;
    moveDrag = null;
    releasePointer(event);
    const [dx, dy] = drag.offset;
    if (send && drag.moved && (dx !== 0 || dy !== 0)) {
      pendingMove = { id: drag.id, offset: drag.offset };
      draw();
      post({ kind: "move", id: drag.id, dx, dy });
      return;
    }
    draw();
  }

  /**
   * Drops the Select drag in progress on Escape: the Element goes back to its
   * start and the Worker never hears of it, so it is no edit at all.
   */
  function cancelMove() {
    if (moveDrag === null) return;
    const pointerId = moveDrag.pointerId;
    moveDrag = null;
    releasePointerId(pointerId);
    draw();
  }

  /** Posts one validated message to the Worker; a missing port drops it. */
  function post(message) {
    if (port === null) return;
    port.postMessage(message);
  }

  /**
   * The pointer's place on the page, in millimetres, through the svg's own
   * screen matrix, so the viewBox, zoom, and pan need no arithmetic here.
   * @param {PointerEvent | MouseEvent | ClientPoint} event
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
    releasePointerId(event.pointerId);
  }

  /** @param {number} pointerId */
  function releasePointerId(pointerId) {
    const svg = svgElement();
    if (svg === null || typeof svg.releasePointerCapture !== "function") return;
    try {
      svg.releasePointerCapture(pointerId);
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

  /**
   * Adds the next keyboard point of an Area Fill outline: starts the outline,
   * appends a point, or closes it when the point lands on the first one.
   * @param {MapPoint} point
   * @param {boolean} curved whether the segment into this point curves
   */
  function addAreaPoint(point, curved) {
    if (penDraft === null) {
      penDraft = { points: [point], curves: [] };
      draw();
      return;
    }
    if (penDraft.points.length >= 3 && near(point, penDraft.points[0])) {
      finishArea();
      return;
    }
    penDraft.points.push(point);
    penDraft.curves.push(curved);
    draw();
  }

  /**
   * Ends the Area Fill outline in progress, always closed: the closing segment
   * is added straight, so the outline has one flag per segment including it. An
   * outline of fewer than three points encloses nothing and is dropped.
   */
  function finishArea() {
    if (penDraft === null) return;
    const draft = penDraft;
    penDraft = null;
    penPointer = null;
    if (draft.points.length >= 3) draft.curves.push(false);
    draw();
    if (draft.points.length < 3) return;
    post({ kind: "area", points: draft.points, curves: draft.curves, freehand: false });
  }

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (scene === null) return;
    // A right or middle mouse button is never a drawing gesture; touch, pen,
    // and the primary button are.
    if (event.pointerType === "mouse" && event.button !== 0) return;

    if (scene.tool === "pencil" || scene.tool === "area") {
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

    // The Bucket pours at the clicked or tapped point in one go: the Worker
    // decides whether it lands in a face, so the Frame only reports the spot.
    if (scene.tool === "bucket") {
      const point = pagePoint(event);
      if (point === null) return;
      event.preventDefault();
      post({ kind: "pour", point });
      return;
    }

    // Insert drops the Stamp the Worker has picked at the clicked or tapped
    // point: the Frame knows no Stamp, so it only reports where one landed.
    if (scene.tool === "insert") {
      const point = pagePoint(event);
      if (point === null) return;
      event.preventDefault();
      post({ kind: "insert", point });
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

    // A second finger while one drag is under way neither picks nor drags.
    if (moveDrag !== null) return;
    const target =
      event.target instanceof Element ? event.target.closest("[data-element-id]") : null;
    const id = target === null ? null : target.getAttribute("data-element-id");
    post({ kind: "select", id });
    // A press on a movable Element may become a drag (#766): it only selects
    // until the pointer travels past the threshold.
    const pressed = id === null ? undefined : scene.elements.find((element) => element.id === id);
    if (pressed === undefined || !pressed.movable) return;
    moveDrag = {
      pointerId: event.pointerId,
      id: pressed.id,
      press: { clientX: event.clientX, clientY: event.clientY },
      client: { clientX: event.clientX, clientY: event.clientY },
      travel: [0, 0],
      constrain: event.shiftKey === true,
      moved: false,
      offset: [0, 0],
    };
    capturePointer(event);
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
    if (moveDrag !== null && event.pointerId === moveDrag.pointerId) {
      followDrag(event);
      return;
    }

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
   * to the Worker; a tap with no movement is dropped. The Pencil's stroke is a
   * Map Line and the Area tool's is a closed Area Fill outline, which the
   * Worker smooths exactly as the Pencil's line.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endStroke(event, send) {
    if (drawing === null || event.pointerId !== drawing.pointerId) return;
    const points = drawing.points;
    const tool = scene === null ? "pencil" : scene.tool;
    drawing = null;
    releasePointer(event);
    draw();
    if (!send || points.length < 2) return;
    if (tool === "area") {
      post({ kind: "area", points, curves: [], freehand: true });
      return;
    }
    post({ kind: "stroke", points });
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
   * The keyboard Pen, Bucket, and Area tool: one crosshair moved by the arrows,
   * Enter adding a Pen or Area point or pouring at the crosshair. Every key
   * either handles is `preventDefault`ed, so the Frame keeps it and the host's
   * Commands never see it (#760); every other key forwards as before.
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
    // Escape cancels a Select drag (#766), and Shift constrains it the moment
    // it goes down; Shift alone still reaches the host, which ignores it.
    if (event.key === "Escape" && moveDrag !== null) {
      event.preventDefault();
      cancelMove();
      return;
    }
    if (event.key === "Shift") constrainDrag(true);
    if (
      scene === null ||
      (scene.tool !== "pen" && scene.tool !== "bucket" && scene.tool !== "area")
    ) {
      return;
    }
    if (crosshair === null) return;
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
      if (scene.tool === "bucket") {
        post({ kind: "pour", point: crosshair });
        return;
      }
      penPointer = null;
      if (scene.tool === "area") {
        addAreaPoint(crosshair, event.shiftKey === true);
        return;
      }
      addPenPoint(crosshair, event.shiftKey === true);
      return;
    }
    // Backspace and Escape belong to the Pen draft and the Area outline, which
    // the Bucket has neither of.
    if (scene.tool !== "pen" && scene.tool !== "area") return;
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
      if (scene.tool === "area") finishArea();
      else finishPen(false);
    }
  }

  /** Lifting Shift frees a constrained Select drag at once. @param {KeyboardEvent} event */
  function onKeyUp(event) {
    if (event.key === "Shift") constrainDrag(false);
  }

  /** @param {MessageEvent} event */
  function onMessage(event) {
    const next = readScene(event.data);
    if (next === null) return;
    const previousTool = scene === null ? null : scene.tool;
    scene = next;
    // Any scene after a release draws the moved Element where the Worker put
    // it, or back at its start when the Worker refused the move.
    pendingMove = null;
    if (next.tool !== previousTool) resetGestures();
    // An Element locked, deleted, or undone away mid-drag stops moving.
    if (moveDrag !== null) {
      const dragged = moveDrag.id;
      if (!next.elements.some((element) => element.id === dragged && element.movable)) {
        cancelMove();
        return;
      }
    }
    syncCrosshair();
    draw();
  }

  function cleanup() {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    if (surface === null) return;
    surface.removeEventListener("pointerdown", onPointerDown);
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("pointerup", onPointerUp);
    surface.removeEventListener("pointercancel", onPointerCancel);
    surface.removeEventListener("lostpointercapture", onLostPointerCapture);
    surface.removeEventListener("dblclick", onDoubleClick);
  }

  /** @param {PointerEvent} event */
  function onPointerUp(event) {
    endStroke(event, true);
    endErase(event, true);
    endShape(event, true);
    endMove(event, true);
  }

  /** @param {PointerEvent} event */
  function onPointerCancel(event) {
    endStroke(event, false);
    endErase(event, false);
    endShape(event, false);
    endMove(event, false);
  }

  /**
   * The engine took a Select drag's capture away with no pointerup (#766): the
   * drag is dropped like a cancel, so the next press is not ignored as a
   * second finger. After a pointerup the drag is already over and this is a
   * no-op.
   * @param {PointerEvent} event
   */
  function onLostPointerCapture(event) {
    endMove(event, false);
  }

  draw();

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  if (surface !== null) {
    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointercancel", onPointerCancel);
    surface.addEventListener("lostpointercapture", onLostPointerCapture);
    surface.addEventListener("dblclick", onDoubleClick);
  }

  if (port !== null) {
    port.onmessage = onMessage;
    port.start();
  }

  if (hooks && typeof hooks.onReady === "function") hooks.onReady(cleanup);
})();
