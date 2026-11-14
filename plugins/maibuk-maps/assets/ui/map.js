// @ts-check
/* The Map Frame's drawing surface (#745, #746, #748, #749, #750, #766, #751,
   #756, #777, #795). The Frame's only host channel is `window.maibuk.port`: the
   Worker sends the whole `scene` on every change and when the Frame connects, an
   uploaded picture's bytes once per asset, and asks it to `rasterize` an export
   SVG, since only this document has a canvas, and to `ingest` one uploaded
   picture, since only it has a DOM. The Frame answers a finished Pencil stroke,
   a finished Pen line, a finished Area Fill outline, an
   Eraser drag, a drawn Shape, a Bucket pour, a dropped Stamp, the Element the
   author picked, a Select drag that moved one, a transform handle drag that
   resized or turned a Stamp or Map Image, a Map Label's bend dragged
   from its handle, one step of a pointer zoom, a finished pointer pan, the encoded picture an
   export asked for, and what one uploaded picture measured.
   Points cross the port in page millimetres, the same space as the page's
   `widthMm`/`heightMm`, so the pointer's own screen pixels are converted
   through the svg's `getScreenCTM`; the surface's own pixel size says how many
   page millimetres a screen pixel spans, so a transform handle keeps its size
   on screen at every zoom (#795).

   The wire shapes mirror `frame-protocol.ts`. Tests inject a point converter, a
   screen scale, and a cleanup seam through `globalThis.__mapTestHooks`;
   production never defines it.

   It is a classic script, not a module: a relative `import` cannot resolve in
   the Frame's opaque origin (docs/plugins/frame-ui.md). Preact and htm arrive
   as `window.htmPreact` from the vendored library beside this file. */

(() => {
  // biome-ignore lint/suspicious/noRedundantUseStrict: the Frame loads this file as a classic script, not a module.
  "use strict";

  /**
   * @typedef {[number, number]} MapPoint
   * @typedef {"ellipse" | "rectangle" | "polygon"} ShapeKind
   * @typedef {"select" | "hand" | "pencil" | "pen" | "bucket" | "area" | "eraser" | "insert" | "text" | ShapeKind} MapTool
   * @typedef {{ d: string, stroke: string | null, strokeWidth: number, dash: string | null, fill: string | null, fillRule?: "evenodd", opacity: number, transform?: string, clip?: string, hitOnly?: true }} LineShape
   * @typedef {{ text: string, x: number, y: number, size: number, fill: string, font?: string, letterSpacing?: number, halo?: { color: string, width: number }, path?: { id: string, d: string }, anchor: "start" | "middle" | "end", transform?: string, placeholder?: true, opacity?: number, lines?: string[], lineHeight?: number, style?: string }} TextShape
   * @typedef {{ kind: "image", assetId: string, x: number, y: number, width: number, height: number, rotation: number, opacity: number, tint?: string, clip?: string }} ImageShape
   * @typedef {LineShape | TextShape | ImageShape} SceneShape
   * @typedef {{ x: number, y: number, rotation: number, width: number, bend: number, text: string, lines: number, sizing: "auto" | "fixed", font: string, fill: string, size: number, letterSpacing: number, lineHeight: number, ascent: number, descent: number }} FrameLabelLayout
   * @typedef {{ label: string, placeholder: string }} LabelEditorStrings
   * @typedef {{ id: string, field: HTMLTextAreaElement, original: string }} LabelEdit
   * @typedef {{ x: number, y: number, width: number, height: number, rotation: number }} FrameTransformBox
   * @typedef {{ box: FrameTransformBox, handles: "corners" | "all" | "label", minSize?: number }} FrameElementTransform
   * @typedef {{ id: string, shapes: SceneShape[], filter: string | null, hidden: boolean, locked: boolean, selected: boolean, movable: boolean, label?: FrameLabelLayout, transform?: FrameElementTransform }} FrameSceneElement
   * @typedef {{ one: string, other: string }} PenDraftLabel
   * @typedef {{ size: string, angle: string, shape: string, label: string }} TransformReadout
   * @typedef {{ kind: "scene", widthMm: number, heightMm: number, background: string, elements: FrameSceneElement[], defs: string, tool: MapTool, zoom: number, panX: number, panY: number, penLabel: PenDraftLabel, readout: TransformReadout, labelEditor: LabelEditorStrings, editLabel?: string }} FrameSceneMessage
   * @typedef {{ kind: "stroke", points: MapPoint[] }} FrameStrokeMessage
   * @typedef {{ kind: "line", points: MapPoint[], curves: boolean[], closed: boolean }} FrameLineMessage
   * @typedef {{ kind: "area", points: MapPoint[], curves: boolean[], freehand: boolean }} FrameAreaMessage
   * @typedef {{ kind: "erase", points: MapPoint[], radiusMm: number }} FrameEraseMessage
   * @typedef {{ kind: "select", id: string | null }} FrameSelectMessage
   * @typedef {{ kind: "shape", shape: ShapeKind, start: MapPoint, end: MapPoint, constrain: boolean }} FrameShapeMessage
   * @typedef {{ kind: "pour", point: MapPoint }} FramePourMessage
   * @typedef {{ kind: "insert", point: MapPoint }} FrameInsertMessage
   * @typedef {{ kind: "move", id: string, dx: number, dy: number }} FrameMoveMessage
   * @typedef {{ kind: "bendLabel", id: string, bend: number }} FrameBendMessage
   * @typedef {{ kind: "zoom", point: MapPoint, factor: number }} FrameZoomMessage
   * @typedef {{ kind: "pan", dx: number, dy: number }} FramePanMessage
   * @typedef {{ kind: "font", family: string, bytes: ArrayBuffer }} FrameFontMessage
   * @typedef {{ kind: "rasterize", requestId: number, svg: string, widthPx: number, heightPx: number, format: "png" | { jpeg: number } }} FrameRasterizeMessage
   * @typedef {{ kind: "rasterized", requestId: number, bytes?: ArrayBuffer, error?: string }} FrameRasterizedMessage
   * @typedef {{ kind: "asset", id: string, mime: string, data: string }} FrameAssetMessage
   * @typedef {{ kind: "ingest-asset", requestId: number, mime: string, data: string }} IngestAssetMessage
   * @typedef {{ kind: "asset-ingested", requestId: number, data: string, width: number, height: number, recolorable: boolean }} AssetIngestedMessage
   * @typedef {{ kind: "ingest-error", requestId: number, reason: "invalid-image" }} IngestErrorMessage
   * @typedef {FrameSceneMessage | FrameFontMessage | FrameRasterizeMessage | FrameAssetMessage | IngestAssetMessage} WorkerToFrameMessage
   * @typedef {{ pointerId: number, points: MapPoint[] }} Drawing
   * @typedef {{ points: MapPoint[], curves: boolean[] }} PenDraft
   * @typedef {{ pointerId: number, kind: ShapeKind, start: MapPoint, end: MapPoint, constrain: boolean }} ShapeDraft
   * @typedef {{ clientX: number, clientY: number }} ClientPoint
   * @typedef {{ pointerId: number, id: string, press: ClientPoint, client: ClientPoint, travel: MapPoint, constrain: boolean, moved: boolean, offset: MapPoint }} MoveDrag
   * @typedef {{ id: string, offset: MapPoint }} PendingMove
   * @typedef {{ pointerId: number, id: string, press: ClientPoint, label: FrameLabelLayout, moved: boolean, bend: number }} BendDrag
   * @typedef {{ id: string, bend: number }} PendingBend
   * @typedef {{ box: FrameTransformBox, handle: string, start: MapPoint, point: MapPoint, aspect?: boolean, fromCentre?: boolean, snap?: boolean, minWidth?: number, minHeight?: number }} TransformGesture
   * @typedef {{ pointerId: number, id: string, handle: string, handles: string, press: ClientPoint, start: MapPoint, point: MapPoint, startBox: FrameTransformBox, box: FrameTransformBox, minSize: number, snap: boolean, moved: boolean }} TransformDrag
   * @typedef {{ id: string, startBox: FrameTransformBox, box: FrameTransformBox, holdArt?: boolean }} PendingTransform
   * @typedef {{ id: string, handle: string }} HoverGrip
   * @typedef {{ pointers: number[], id: string, handles: string, startBox: FrameTransformBox, box: FrameTransformBox, minSize: number, startDistance: number, startAngle: number, startMid: MapPoint, mid: MapPoint, moved: boolean }} PinchDrag
   * @typedef {{ pointerId: number, id: string }} PinchCandidate
   * @typedef {{ pointers: number[], client: ClientPoint, offset: MapPoint }} PanDrag
   * @typedef {{ clientX: number, clientY: number, touch: boolean }} PointerPlace
   * @typedef {{ start: MapPoint, control: MapPoint, apex: MapPoint, end: MapPoint }} BendGeometry
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

  /**
   * A Map Label's bend handle (#751), in page millimetres: the radius of the
   * circle the pointer grips, and the smallest bend that is not snapped back
   * to straight, which mirrors `BEND_SNAP_MM` in `maps.ts`.
   */
  const BEND_HANDLE_RADIUS_MM = 2;
  const BEND_SNAP_MM = 0.5;

  /**
   * A transform handle's size and hit target (#795), in screen pixels: a 9 px
   * square inside a 24 px target is easy to see and, with a mouse, easy to
   * grab. A finger needs more room, so a coarse pointer draws a larger square
   * and gives it a 44 px target. The turn handle is a circle on a stalk above
   * the box's top edge. A grip the pointer rests on grows, so the one a press
   * would take stands out.
   */
  const HANDLE_PX = 9;
  const HANDLE_HIT_PX = 24;
  const TURN_HANDLE_PX = 12;
  const TURN_STALK_PX = 20;
  const COARSE_HANDLE_PX = 13;
  const COARSE_HANDLE_HIT_PX = 44;
  const COARSE_TURN_HANDLE_PX = 18;
  const COARSE_TURN_STALK_PX = 26;
  const HOVER_GROW = 1.4;

  /**
   * How small a box may look on screen before it loses grips (#795), in pixels
   * of its smaller side: under 48 px four grips would bury the art they mark, so
   * only the bottom-right corner stays, and under 20 px only the turn grip does.
   */

  /** The padlock badge a locked Element's box carries (#795), in screen pixels. */
  const LOCK_BADGE_PX = 14;

  /**
   * The readout chip and the Shift turn's tick ring (#795), in screen pixels, so
   * both keep their size at every zoom. The chip sits just down and right of the
   * pointer; its text is drawn at a small size, and each glyph is taken as
   * `CHIP_ADVANCE` of that size because a Frame cannot measure text. The ticks
   * stand a few pixels outside the box's corners.
   */
  const CHIP_FONT_PX = 12;
  const CHIP_PAD_X_PX = 6;
  const CHIP_PAD_Y_PX = 4;
  const CHIP_GAP_PX = 14;
  const CHIP_RADIUS_PX = 3;
  const CHIP_ADVANCE = 0.6;
  const TURN_TICK_PX = 5;
  const TURN_TICK_GAP_PX = 8;

  /**
   * How the handle maths turns and grows a box (#795), mirroring `geometry.ts`
   * so the Frame's preview obeys the rules the Worker writes: a turn within 2°
   * of a right angle sticks to it, Shift snaps to 15° steps, and a side never
   * reaches zero.
   */
  const RIGHT_ANGLE_STICK_DEGREES = 2;
  const TURN_SNAP_DEGREES = 15;
  const MIN_TRANSFORM_SIZE_MM = 0.01;

  /** The turn steps a Shift turn marks, from the box's upright round one circle (#795). */
  const TURN_STEPS = Array.from(
    { length: 360 / TURN_SNAP_DEGREES },
    (_step, index) => index * TURN_SNAP_DEGREES
  );

  /** The cursor the turn handle shows: no browser has a rotate arrow of its own. */
  const TURN_CURSOR = "grab";

  /**
   * The resize cursor a grip takes, by the direction it points on screen, in
   * 45° steps from due east. The box's turn carries a corner's arrow round with
   * it, so a turned Element still shows the cursor a drag would follow.
   */
  const RESIZE_CURSORS = [
    "e-resize",
    "nwse-resize",
    "s-resize",
    "nesw-resize",
    "w-resize",
    "nwse-resize",
    "n-resize",
    "nesw-resize",
  ];

  /** The box's four corners: the handle each names, and its signs from the centre. @type {Array<[string, number, number]>} */
  const CORNER_HANDLES = [
    ["nw", -1, -1],
    ["ne", 1, -1],
    ["se", 1, 1],
    ["sw", -1, 1],
  ];

  /** A Shape's four side midpoints (#796): the handle each names, and its signs from the centre. @type {Array<[string, number, number]>} */
  const SIDE_HANDLES = [
    ["n", 0, -1],
    ["e", 1, 0],
    ["s", 0, 1],
    ["w", -1, 0],
  ];

  /**
   * A Map Label's two side midpoints (#796): the left and the right alone.
   * The top and bottom middles stay empty, so the bend handle at the label's
   * middle never shares its place with a transform grip.
   * @type {Array<[string, number, number]>}
   */
  const LABEL_SIDE_HANDLES = [
    ["e", 1, 0],
    ["w", -1, 0],
  ];

  /**
   * The one corner a small box keeps (#795): the bottom-right, whose drag grows
   * the box away from the top-left.
   */

  /** The characters a definitions id may hold, so a scene cannot write an attribute of its own. */
  const FILTER_ID = /^[A-Za-z0-9_-]+$/;

  /** The size an uploaded picture falls back to, in pixels, when it names none. */
  const DEFAULT_ASSET_SIZE = 100;

  /**
   * How hard one wheel notch zooms (#777): a 100-pixel notch multiplies the
   * zoom by about 1.22, near the 1.25 a zoom Command steps by. The most one
   * event may zoom by is capped, so a fling cannot jump the view.
   */
  const WHEEL_ZOOM_RATE = 0.002;
  const MAX_WHEEL_FACTOR = 2;
  /** What one line of a wheel that counts lines rather than pixels is worth, in pixels. */
  const WHEEL_LINE_PX = 16;
  /** A pan shorter than this on both axes, in page millimetres, is no pan at all. */
  const PAN_EPSILON_MM = 1e-6;

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
  /**
   * The bend handle drag in progress, or null (#751): the label whose curve is
   * being shaped and the bend the pointer asks for right now.
   * @type {BendDrag | null}
   */
  let bendDrag = null;
  /**
   * A finished bend drag the Worker has not answered yet, or null. Its preview
   * stays until the next scene, as a move's does, so the curve never jumps back
   * between the release and the Worker's redraw. @type {PendingBend | null}
   */
  let pendingBend = null;
  /**
   * The transform handle drag in progress, or null (#795): the Element, the
   * handle the pointer grips, where the press landed, and the box the drag asks
   * for right now. The Frame previews the box and the Element's own art while
   * the drag lasts, and tells the Worker once, on release.
   * @type {TransformDrag | null}
   */
  let transformDrag = null;
  /**
   * A finished transform drag the Worker has not answered yet, or null. Its
   * preview stays until the next scene, as a move's does, so the Element never
   * jumps back between the release and the Worker's redraw.
   * @type {PendingTransform | null}
   */
  let pendingTransform = null;
  /**
   * The on-map text box a Map Label is being written in (#800), or null: the
   * label's id, the textarea, and the text it opened with.
   * @type {LabelEdit | null}
   */
  let labelEdit = null;
  /**
   * A label whose committed text the Worker has not answered yet, or null. Its
   * ink stays hidden until the next scene, so the old text never flashes back.
   * @type {string | null}
   */
  let pendingLabelText = null;
  /**
   * The grip the pointer rests on (#795), the Element and handle it names, or
   * null. That grip fills and grows, so the author sees the one a press would
   * take. A touch screen has no hover, so nothing rests and no grip grows.
   * @type {HoverGrip | null}
   */
  let hoverGrip = null;

  /**
   * The pinch-and-twist gesture in progress (#796): the two fingers, the
   * selected Element they size and turn, the box it started from and the one
   * the fingers ask for right now, and the distance, angle, and midpoint the
   * gesture started from. The preview reuses the handle drag's own path, and
   * the Worker hears once, on release. A null `moved` drag never shaped
   * anything, so its release posts nothing.
   * @type {PinchDrag | null}
   */
  let pinchDrag = null;
  /**
   * The first finger of what may become a pinch (#796): its pointer id and the
   * selected, unlocked Element with handles it landed on. The second finger
   * landing turns the pair into a pinch; anything else turns it into a pan.
   * @type {PinchCandidate | null}
   */
  let pinchCandidate = null;

  /**
   * The pan gesture in progress, or null (#777): the pointers it follows,
   * where their average sat when its last step was measured, and how far it
   * has slid the view so far, in page millimetres. The Frame slides its own
   * view while the drag lasts and tells the Worker once, on release: a
   * round-trip per pointermove rebuilt and redrew the whole scene sixty times
   * a second, which a large Map could not keep up with. A pan never draws and
   * never edits, so it holds no draft of its own.
   * @type {PanDrag | null}
   */
  let panDrag = null;
  /**
   * The pans sent to the Worker that no scene has answered yet, oldest first.
   * The view keeps showing them, so a release never snaps back for the one
   * round-trip it takes the Worker's pan to catch up. The Worker answers every
   * pan with a scene whose pan moved, so each such scene settles the oldest.
   * @type {MapPoint[]}
   */
  const unansweredPans = [];
  /** Whether Space is held, which turns every press into a pan (#777). */
  let spacePan = false;
  /**
   * Where each pointer down on the surface sits, by pointer id (#777), so a
   * two-finger pan follows the average of its two fingers, and a finger that
   * lands while a mouse or a stylus is down is not mistaken for one.
   * @type {Map<number, PointerPlace>}
   */
  const pointerClients = new Map();

  /**
   * Every uploaded picture the Worker has sent, as the URLs this document draws
   * its bytes with, keyed by asset id (#756): a `blob:` URL for the live canvas,
   * and the `data:` URI a rasterize request needs, since a browser loads no
   * subresource — `blob:` included — into an SVG it draws as an image, exactly
   * why the export's fonts travel as data URIs. A scene names a picture by id,
   * so its bytes cross the port once instead of on every scene.
   * @type {Map<string, { url: string, dataUri: string }>}
   */
  const assetSources = new Map();

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
      raw === "hand" ||
      raw === "pencil" ||
      raw === "pen" ||
      raw === "bucket" ||
      raw === "area" ||
      raw === "eraser" ||
      raw === "insert" ||
      raw === "text"
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
   * Whether a shape is an uploaded picture rather than a path or text (#756).
   * @param {SceneShape} shape
   * @returns {shape is ImageShape}
   */
  function isImageShape(shape) {
    return /** @type {ImageShape} */ (shape).kind === "image";
  }

  /**
   * Reads the baseline a piece of text follows, or null when it follows none.
   * Its id has to be as safe as a definitions id, because the text names it in
   * an href, and it needs a path lines can follow.
   * @param {unknown} raw
   * @returns {{ id: string, d: string } | null}
   */
  function readTextPath(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const path = /** @type {Record<string, unknown>} */ (raw);
    if (typeof path.id !== "string" || !FILTER_ID.test(path.id)) return null;
    if (typeof path.d !== "string" || path.d === "") return null;
    return { id: path.id, d: path.d };
  }

  /**
   * Reads the halo behind a piece of text, or null when it draws none: no
   * colour or no width is no halo, not an invisible stroke.
   * @param {unknown} raw
   * @returns {{ color: string, width: number } | null}
   */
  function readTextHalo(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const halo = /** @type {Record<string, unknown>} */ (raw);
    if (typeof halo.color !== "string" || halo.color === "") return null;
    if (!isNumber(halo.width) || halo.width <= 0) return null;
    return { color: halo.color, width: halo.width };
  }

  /**
   * Reads one piece of text, or null when it cannot be drawn: one with no
   * place, no height, or no colour would paint an invisible nothing. The font
   * arrives with the shape, so the Frame draws the face an export does rather
   * than whatever the renderer defaults to, and the baseline it follows travels
   * with it too, so a Map Label reads along its own curve.
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
    const path = readTextPath(shape.path);
    const halo = readTextHalo(shape.halo);
    return {
      text: String(shape.text),
      x: shape.x,
      y: shape.y,
      size: shape.size,
      fill: shape.fill,
      ...(typeof shape.font === "string" && shape.font !== "" ? { font: shape.font } : {}),
      ...(isNumber(shape.letterSpacing) ? { letterSpacing: shape.letterSpacing } : {}),
      ...(path === null ? {} : { path }),
      ...(halo === null ? {} : { halo }),
      anchor,
      ...(typeof shape.transform === "string" ? { transform: shape.transform } : {}),
      ...(shape.placeholder === true ? { placeholder: /** @type {const} */ (true) } : {}),
      ...(isNumber(shape.opacity) && shape.opacity >= 0 && shape.opacity < 1
        ? { opacity: shape.opacity }
        : {}),
      // A multi-line Map Label's lines (#800), drawn one under the other.
      ...(Array.isArray(shape.lines) &&
      shape.lines.length > 0 &&
      shape.lines.every((line) => typeof line === "string") &&
      isNumber(shape.lineHeight) &&
      shape.lineHeight > 0
        ? { lines: /** @type {string[]} */ (shape.lines), lineHeight: shape.lineHeight }
        : {}),
      ...(typeof shape.style === "string" && shape.style !== "" ? { style: shape.style } : {}),
    };
  }

  /**
   * Reads one uploaded picture (#756), or null when it cannot be drawn: one of
   * no place, no size, or no asset id would paint an invisible nothing. It
   * carries only the asset's id, so its bytes stay out of every scene message.
   * @param {Record<string, unknown>} shape
   * @returns {ImageShape | null}
   */
  function readImageShape(shape) {
    if (typeof shape.assetId !== "string" || shape.assetId === "") return null;
    if (!isNumber(shape.x) || !isNumber(shape.y)) return null;
    if (!isNumber(shape.width) || shape.width <= 0) return null;
    if (!isNumber(shape.height) || shape.height <= 0) return null;
    return {
      kind: "image",
      assetId: shape.assetId,
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      rotation: isNumber(shape.rotation) ? shape.rotation : 0,
      opacity: isNumber(shape.opacity) ? Math.max(0, Math.min(1, shape.opacity)) : 1,
      ...(typeof shape.tint === "string" && shape.tint !== "" ? { tint: shape.tint } : {}),
      // A Clip Path id is only as safe as a definitions id, so it takes the same check.
      ...(typeof shape.clip === "string" && FILTER_ID.test(shape.clip) ? { clip: shape.clip } : {}),
    };
  }

  /**
   * Reads one render primitive, or null when it has no path, text, or picture to
   * draw. A path without a usable stroke colour is a fill; without a usable fill,
   * a stroke. The Worker sends every path's width, so one without it is malformed,
   * and its `fillRule` only when the fill has to cut holes in itself.
   * @param {unknown} raw
   * @returns {SceneShape | null}
   */
  function readShape(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const shape = /** @type {Record<string, unknown>} */ (raw);
    if (typeof shape.text === "string") return readTextShape(shape);
    if (shape.kind === "image") return readImageShape(shape);
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
      // A hit-only path marks where its Element can be picked; it paints no ink.
      ...(shape.hitOnly === true ? { hitOnly: /** @type {true} */ (true) } : {}),
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
   * Reads the transform drag's readout templates (#795, #796); an unreadable
   * one leaves each empty, which draws no chip instead of falling back to
   * English. A scene from before the Map Label handles takes no label
   * template, so its label drag draws no chip rather than a wrong one.
   * @param {unknown} raw
   * @returns {TransformReadout}
   */
  function readReadout(raw) {
    const readout =
      typeof raw === "object" && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {};
    return {
      size: typeof readout.size === "string" ? readout.size : "",
      angle: typeof readout.angle === "string" ? readout.angle : "",
      shape: typeof readout.shape === "string" ? readout.shape : "",
      label: typeof readout.label === "string" ? readout.label : "",
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
   * Reads a Map Label's baseline fields (#751), or null when it carries none or
   * they are malformed: a handle with no known curve to sit on would be a grip
   * that shapes nothing.
   * @param {unknown} raw
   * @returns {FrameLabelLayout | null}
   */
  function readLabelLayout(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const label = /** @type {Record<string, unknown>} */ (raw);
    if (!isNumber(label.x) || !isNumber(label.y) || !isNumber(label.rotation)) return null;
    if (!isNumber(label.width) || label.width <= 0) return null;
    if (!isNumber(label.bend)) return null;
    // The text box's type (#800): a field the scene leaves out falls back to
    // one plain line, so the bend handle and the box still work.
    const size = isNumber(label.size) && label.size > 0 ? label.size : 1;
    return {
      x: label.x,
      y: label.y,
      rotation: label.rotation,
      width: label.width,
      bend: label.bend,
      text: typeof label.text === "string" ? label.text : "",
      lines: isNumber(label.lines) && label.lines >= 1 ? Math.floor(label.lines) : 1,
      sizing: label.sizing === "auto" ? "auto" : "fixed",
      font: typeof label.font === "string" ? label.font : "",
      fill: typeof label.fill === "string" ? label.fill : "currentColor",
      size,
      letterSpacing: isNumber(label.letterSpacing) ? label.letterSpacing : 0,
      lineHeight:
        isNumber(label.lineHeight) && label.lineHeight > 0 ? label.lineHeight : size * 1.2,
      ascent: isNumber(label.ascent) && label.ascent > 0 ? label.ascent : 0.8,
      descent: isNumber(label.descent) && label.descent >= 0 ? label.descent : 0.2,
    };
  }

  /**
   * Reads the on-map text box's strings (#800); an unreadable one is empty, so
   * the box goes unnamed rather than named in English.
   * @param {unknown} raw
   * @returns {LabelEditorStrings}
   */
  function readLabelEditor(raw) {
    const strings =
      typeof raw === "object" && raw !== null ? /** @type {Record<string, unknown>} */ (raw) : {};
    return {
      label: typeof strings.label === "string" ? strings.label : "",
      placeholder: typeof strings.placeholder === "string" ? strings.placeholder : "",
    };
  }

  /**
   * Reads one rasterize request (#753), or null when it is malformed and must
   * be dropped: a request with no id, no SVG, no positive pixel size, or an
   * unknown format would draw nothing or answer a reply nobody asked for.
   * @param {unknown} data
   * @returns {FrameRasterizeMessage | null}
   */
  function readRasterize(data) {
    if (typeof data !== "object" || data === null) return null;
    const message = /** @type {Record<string, unknown>} */ (data);
    if (message.kind !== "rasterize") return null;
    if (!isNumber(message.requestId)) return null;
    if (typeof message.svg !== "string" || message.svg === "") return null;
    if (!isNumber(message.widthPx) || message.widthPx <= 0) return null;
    if (!isNumber(message.heightPx) || message.heightPx <= 0) return null;
    /** @type {"png" | { jpeg: number }} */
    let format;
    if (message.format === "png") {
      format = "png";
    } else if (typeof message.format === "object" && message.format !== null) {
      const jpeg = /** @type {Record<string, unknown>} */ (message.format).jpeg;
      if (!isNumber(jpeg) || jpeg < 0 || jpeg > 1) return null;
      format = { jpeg };
    } else {
      return null;
    }
    return {
      kind: "rasterize",
      requestId: message.requestId,
      svg: message.svg,
      // A canvas takes whole pixels only.
      widthPx: Math.round(message.widthPx),
      heightPx: Math.round(message.heightPx),
      format,
    };
  }

  /**
   * Reads one asset ingest request (#756), or null when it is malformed and
   * must be dropped: a request with no id, no picture type, or no bytes would
   * answer nobody, or store a picture with nothing in it.
   * @param {unknown} data
   * @returns {IngestAssetMessage | null}
   */
  function readIngestAsset(data) {
    if (typeof data !== "object" || data === null) return null;
    const message = /** @type {Record<string, unknown>} */ (data);
    if (message.kind !== "ingest-asset") return null;
    if (!isNumber(message.requestId)) return null;
    if (typeof message.mime !== "string" || message.mime === "") return null;
    if (typeof message.data !== "string" || message.data === "") return null;
    return {
      kind: "ingest-asset",
      requestId: message.requestId,
      mime: message.mime,
      data: message.data,
    };
  }

  /**
   * Reads the box a selected Element's transform handles sit on (#795), or
   * null when it carries none or is malformed: a handle with no box to sit on
   * would grip nothing, and a handle set this Frame does not know would draw
   * the wrong grips. `minSize` is the smallest size the Worker keeps; a scene
   * without one lets the drag reach the handle maths' own floor.
   * @param {unknown} raw
   * @returns {FrameElementTransform | null}
   */
  function readTransform(raw) {
    if (typeof raw !== "object" || raw === null) return null;
    const transform = /** @type {Record<string, unknown>} */ (raw);
    const handles = transform.handles;
    if (handles !== "corners" && handles !== "all" && handles !== "label") return null;
    if (typeof transform.box !== "object" || transform.box === null) return null;
    const box = /** @type {Record<string, unknown>} */ (transform.box);
    if (!isNumber(box.x) || !isNumber(box.y)) return null;
    if (!isNumber(box.width) || box.width <= 0) return null;
    if (!isNumber(box.height) || box.height <= 0) return null;
    if (!isNumber(box.rotation)) return null;
    return {
      box: { x: box.x, y: box.y, width: box.width, height: box.height, rotation: box.rotation },
      handles,
      ...(isNumber(transform.minSize) && transform.minSize > 0
        ? { minSize: transform.minSize }
        : {}),
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
        /** @type {SceneShape[]} */
        const shapes = [];
        for (const rawShape of element.shapes) {
          const shape = readShape(rawShape);
          if (shape !== null) shapes.push(shape);
        }
        const label = readLabelLayout(element.label);
        const transform = readTransform(element.transform);
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
          ...(label === null ? {} : { label }),
          ...(transform === null ? {} : { transform }),
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
      // The chip's size and angle text arrive the same way (#795).
      readout: readReadout(message.readout),
      labelEditor: readLabelEditor(message.labelEditor),
      ...(typeof message.editLabel === "string" && message.editLabel !== ""
        ? { editLabel: message.editLabel }
        : {}),
    };
  }

  /**
   * How far the Frame's own pans slide the view past the Worker's pan: the
   * drag in progress plus every pan the Worker has not answered yet.
   * @returns {MapPoint}
   */
  function localPan() {
    let x = panDrag === null ? 0 : panDrag.offset[0];
    let y = panDrag === null ? 0 : panDrag.offset[1];
    for (const [dx, dy] of unansweredPans) {
      x += dx;
      y += dy;
    }
    return [x, y];
  }

  /**
   * The page rectangle the view shows, in page millimetres: zoom crops around
   * the page's centre, and pan slides the page under the view.
   * @param {FrameSceneMessage} current
   */
  function viewRect(current) {
    const width = current.widthMm / current.zoom;
    const height = current.heightMm / current.zoom;
    const [slideX, slideY] = localPan();
    return {
      x: (current.widthMm - width) / 2 + current.panX + slideX,
      y: (current.heightMm - height) / 2 + current.panY + slideY,
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
    bendDrag = null;
    pendingBend = null;
    transformDrag = null;
    pendingTransform = null;
    pinchDrag = null;
    pinchCandidate = null;
    // The view a pan already slid stays where it is, so the Worker hears of it.
    commitPan();
    panDrag = null;
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
   * The nodes `shapes` draw, with each run of shapes that share a Clip Path
   * drawn inside one `<g clip-path="url(#…)">` (#750).
   *
   * The Clip Path belongs on the group, never on the shape: SVG applies a Clip
   * Path in the user space of the element that references it, so a scattered
   * Stamp's own `transform` would carry the clip off with the art it should
   * cut, and the Stamp would vanish outside the page. The group has no
   * transform, so the clip keeps the page millimetres `scene.ts` wrote, and
   * cuts whichever Stamp it holds.
   * @param {readonly SceneShape[]} shapes
   * @param {(shape: SceneShape) => any} draw
   * @returns {any[]}
   */
  function clippedArt(shapes, draw) {
    const { html } = lib;
    /** @type {any[]} */
    const nodes = [];
    /** @type {any[]} */
    let run = [];
    /** @type {string | undefined} */
    let clip;
    const flush = () => {
      if (run.length === 0) return;
      if (clip === undefined) nodes.push(...run);
      else nodes.push(html`<g clip-path="url(#${clip})">${run}</g>`);
      run = [];
    };
    for (const shape of shapes) {
      const next = isTextShape(shape) ? undefined : shape.clip;
      if (next !== clip) {
        flush();
        clip = next;
      }
      run.push(draw(shape));
    }
    flush();
    return nodes;
  }

  /**
   * The nodes one piece of text draws (#751): its halo first, when it has one,
   * and then the text itself. Both run along the baseline the shape carries, so
   * a Map Label's halo follows the same curve its ink does, and both sit at the
   * shape's own point when it carries no baseline.
   * @param {TextShape} shape
   * @returns {any[]}
   */
  function textNodes(shape) {
    const { html } = lib;
    const { lines, lineHeight } = shape;
    const content = () => {
      // A multi-line Map Label (#800) draws a tspan per line, each centred on
      // the label's point and one line height below the one before.
      if (lines !== undefined && lineHeight !== undefined) {
        return lines.map(
          (line, index) =>
            html`<tspan x="${n(shape.x)}" y="${n(shape.y + index * lineHeight)}">${line}</tspan>`
        );
      }
      return shape.path === undefined
        ? shape.text
        : html`<textPath href="#${shape.path.id}" startOffset="50%">${shape.text}</textPath>`;
    };
    // A text on a path starts where its textPath's startOffset puts it: Chromium
    // drops the textPath when the same <text> also carries an `x`, lays the run
    // out at the origin, and paints nothing (#751). So only a text drawn at a
    // point writes them.
    const point = shape.path === undefined ? n(shape.x) : undefined;
    const baseline = shape.path === undefined ? n(shape.y) : undefined;
    /** @param {{ color: string, width: number } | undefined} halo */
    const node = (halo) => html`<text
      class="map-line"
      x="${point}"
      y="${baseline}"
      font-size="${n(shape.size)}"
      font-family="${shape.font ?? undefined}"
      letter-spacing="${shape.letterSpacing === undefined ? undefined : n(shape.letterSpacing)}"
      fill="${halo === undefined ? shape.fill : "none"}"
      stroke="${halo === undefined ? undefined : halo.color}"
      stroke-width="${halo === undefined ? undefined : n(halo.width)}"
      stroke-linejoin="${halo === undefined ? undefined : "round"}"
      text-anchor="${shape.anchor}"
      transform="${shape.transform ?? undefined}"
      font-style="${shape.placeholder === true ? "italic" : undefined}"
      opacity="${shape.opacity === undefined ? undefined : n(shape.opacity)}"
      style="${shape.style ?? undefined}"
    >
      ${content()}
    </text>`;
    if (shape.halo === undefined) return [node(undefined)];
    return [node(shape.halo), node(undefined)];
  }

  /**
   * The rectangle one picture covers, as a closed path in page millimetres, so
   * the Frame can pick the Element by the picture's box.
   * @param {ImageShape} shape
   * @returns {string}
   */
  function imagePath(shape) {
    const left = shape.x - shape.width / 2;
    const top = shape.y - shape.height / 2;
    return `M ${n(left)} ${n(top)} L ${n(left + shape.width)} ${n(top)} L ${n(
      left + shape.width
    )} ${n(top + shape.height)} L ${n(left)} ${n(top + shape.height)} Z`;
  }

  /**
   * The turn one picture draws with, about its own centre, or undefined when it
   * stands upright.
   * @param {ImageShape} shape
   * @returns {string | undefined}
   */
  function imageRotation(shape) {
    if (shape.rotation === 0) return undefined;
    return `rotate(${n(shape.rotation)} ${n(shape.x)} ${n(shape.y)})`;
  }

  /**
   * The id a tint filter takes, mirroring `tintFilterId` in `scene.ts`: the
   * colour's own letters and digits, so one colour has one filter.
   * @param {string} color
   * @returns {string}
   */
  function tintFilterId(color) {
    const digits = color.replace(/[^0-9a-zA-Z]/g, "").toLowerCase();
    return `asset-tint-${digits === "" ? "none" : digits}`;
  }

  /**
   * The node one picture draws (#756), or null while the Frame holds no bytes
   * for its id: a picture is sent once and the scene only names it, so an
   * Element whose asset has not arrived yet draws nothing here rather than a
   * broken image. Its tint is a filter the Worker defined, written over the
   * picture's own alpha.
   * @param {ImageShape} shape
   * @returns {any}
   */
  function imageNode(shape) {
    const { html } = lib;
    const source = assetSources.get(shape.assetId);
    if (source === undefined) return null;
    return html`<image
      class="map-image"
      href="${source.url}"
      x="${n(shape.x - shape.width / 2)}"
      y="${n(shape.y - shape.height / 2)}"
      width="${n(shape.width)}"
      height="${n(shape.height)}"
      preserveAspectRatio="xMidYMid meet"
      opacity="${shape.opacity === 1 ? undefined : n(shape.opacity)}"
      transform="${imageRotation(shape)}"
      filter="${shape.tint === undefined ? undefined : `url(#${tintFilterId(shape.tint)})`}"
    />`;
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
      ...clippedArt(
        element.shapes.filter((shape) => !isTextShape(shape)),
        (shape) =>
          isImageShape(shape)
            ? html`<path
              class="map-hit"
              d="${imagePath(shape)}"
              data-fill="true"
              transform="${imageRotation(shape)}"
            />`
            : html`<path
              class="map-hit"
              d="${shape.d}"
              fill-rule="${shape.fillRule ?? undefined}"
              data-fill="${shape.fill === null ? undefined : "true"}"
              transform="${shape.transform ?? undefined}"
            />`
      ),
      // The ink: every path the Element paints, then its text. A hit-only path,
      // such as a Map Label's baseline, is a target and never ink of its own.
      ...clippedArt(
        element.shapes.filter((shape) => isTextShape(shape) || !shape.hitOnly),
        (shape) => {
          if (isTextShape(shape)) return textNodes(shape);
          if (isImageShape(shape)) return imageNode(shape);
          return html`<path
            class="map-line"
            d="${shape.d}"
            stroke="${shape.stroke ?? "none"}"
            stroke-width="${shape.stroke === null ? undefined : n(shape.strokeWidth)}"
            fill="${shape.fill ?? "none"}"
            fill-rule="${shape.fillRule ?? undefined}"
            stroke-dasharray="${shape.dash ?? undefined}"
            opacity="${shape.opacity === 1 ? undefined : n(shape.opacity)}"
            transform="${shape.transform ?? undefined}"
          />`;
        }
      ),
    ];
    if (element.filter === null) return art;
    return html`<g filter="url(#${element.filter})">${art}</g>`;
  }

  /**
   * The shapes a selected Element's highlight traces (#750): the ink it drew,
   * without the Stamps a Fill scatters, which are content painted inside its
   * area rather than the outline that marks it. Shapes that draw the same path,
   * such as a Fill's colour and the texture laid over it, trace one outline. A
   * picture is marked by the box it covers (#756).
   * @param {FrameSceneElement} element
   * @returns {Array<{ d: string, transform?: string }>}
   */
  function highlightShapes(element) {
    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {Array<{ d: string, transform?: string }>} */
    const shapes = [];
    for (const shape of element.shapes) {
      if (isTextShape(shape) || shape.clip !== undefined) continue;
      const traced = isImageShape(shape)
        ? { d: imagePath(shape), transform: imageRotation(shape) }
        : { d: shape.d, ...(shape.transform === undefined ? {} : { transform: shape.transform }) };
      const key = `${traced.transform ?? ""}\n${traced.d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      shapes.push(traced);
    }
    return shapes;
  }

  /**
   * The baseline a label of these fields and this bend draws, mirroring
   * `labelBaselinePath` in `maps.ts`: its chord's two ends, the quadratic's
   * control point, and its apex, the middle of the curve, where the bend handle
   * sits. A quadratic reaches only half way to its control point, so the
   * control sits twice the bend off the chord.
   * @param {FrameLabelLayout} label
   * @param {number} bend
   * @returns {BendGeometry}
   */
  function bendGeometry(label, bend) {
    const angle = (label.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const half = label.width / 2;
    return {
      start: [label.x - half * cos, label.y - half * sin],
      control: [label.x + 2 * bend * sin, label.y - 2 * bend * cos],
      apex: [label.x + bend * sin, label.y - bend * cos],
      end: [label.x + half * cos, label.y + half * sin],
    };
  }

  /**
   * The bend a pointer at `point` asks for, mirroring `bendFromPoint` in
   * `maps.ts`: how far the point sits from the chord toward the label's top, in
   * page millimetres, rounded to a tenth of one, with anything under
   * `BEND_SNAP_MM` snapped straight.
   * @param {FrameLabelLayout} label
   * @param {MapPoint} point
   * @returns {number}
   */
  function bendAt(label, point) {
    const angle = (label.rotation * Math.PI) / 180;
    const dx = point[0] - label.x;
    const dy = point[1] - label.y;
    const bend = dx * Math.sin(angle) - dy * Math.cos(angle);
    const rounded = Math.round(bend * 10) / 10;
    return Math.abs(rounded) < BEND_SNAP_MM ? 0 : rounded;
  }

  /** One quadratic baseline as an SVG path. @param {BendGeometry} geometry @returns {string} */
  function quadraticPath(geometry) {
    const { start, control, end } = geometry;
    return `M ${n(start[0])} ${n(start[1])} Q ${n(control[0])} ${n(control[1])} ${n(end[0])} ${n(
      end[1]
    )}`;
  }

  /**
   * The selected Map Label whose bend handle the Frame shows, or null: one
   * shown, unlocked label, under the Select tool, since every other tool's
   * press draws a new thing rather than shaping the label under it.
   * @returns {FrameSceneElement | null}
   */
  function bendTarget() {
    if (scene === null || scene.tool !== "select") return null;
    const selected = scene.elements.find((element) => element.selected);
    if (selected === undefined || selected.label === undefined) return null;
    if (selected.hidden || selected.locked) return null;
    // Only a one-line label bends (#800), and one being written has no handle.
    if (selected.label.lines > 1 || isEditingLabel(selected.id)) return null;
    return selected;
  }

  /**
   * The bend a label draws with right now: the one a drag in progress previews,
   * or the one the Worker has yet to answer for, else the one the scene holds.
   * @param {FrameSceneElement} element
   * @returns {number}
   */
  function liveBend(element) {
    if (bendDrag !== null && bendDrag.id === element.id) return bendDrag.bend;
    if (pendingBend !== null && pendingBend.id === element.id) return pendingBend.bend;
    return element.label === undefined ? 0 : element.label.bend;
  }

  /**
   * The bend handle a selected Map Label draws (#751): a circle at the apex of
   * its baseline, which the pointer drags to bow or straighten the name. A drag
   * previews the curve it would draw, dashed, so the author sees the shape
   * before the whole drag reaches the Worker as one message.
   *
   * It draws above the transform box (#796), so a press where the handle meets
   * a grip reaches the handle first and still bends.
   * @returns {any}
   */
  function bendOverlay() {
    const target = bendTarget();
    if (target === null || target.label === undefined) return null;
    const { html } = lib;
    const label = target.label;
    const bend = liveBend(target);
    const geometry = bendGeometry(label, bend);
    return html`<g transform="${dragTransform(target.id)}">
      ${
        bend === label.bend
          ? null
          : html`<path class="map-bend-preview" d="${quadraticPath(geometry)}" />`
      }
      <circle
        class="map-bend-handle"
        data-bend-handle="${target.id}"
        cx="${n(geometry.apex[0])}"
        cy="${n(geometry.apex[1])}"
        r="${n(BEND_HANDLE_RADIUS_MM)}"
      />
    </g>`;
  }

  /**
   * How many screen pixels one page millimetre spans right now, or null when
   * this document cannot say (#795): a handle keeps its size on screen by being
   * drawn in as many of those millimetres as its pixel size asks for. The svg
   * fills the surface and fits the page into it with `meet`, so the tighter of
   * the surface's two ratios is the scale every page millimetre is drawn at. It
   * answers before the first draw has put an svg there, which a screen matrix
   * cannot; a document with no layout has neither.
   * @returns {number | null}
   */
  function screenScale() {
    if (hooks && typeof hooks.pxPerMm === "function") {
      const scale = hooks.pxPerMm();
      return isNumber(scale) && scale > 0 ? scale : null;
    }
    if (surface === null || scene === null) return null;
    const view = viewRect(scene);
    const scale = Math.min(surface.clientWidth / view.width, surface.clientHeight / view.height);
    return isNumber(scale) && scale > 0 ? scale : null;
  }

  /** Whether the pointer is a finger's, which needs larger handles (#795). */
  function isCoarsePointer() {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches === true
    );
  }

  /**
   * One handle's sizes in page millimetres at the current screen scale (#795):
   * what it draws, the wider target that catches a press on it, the turn grip's
   * diameter, and the stalk that lifts it off the box's top edge.
   * @param {number} scale
   */
  function handleSizes(scale) {
    const coarse = isCoarsePointer();
    return {
      drawn: (coarse ? COARSE_HANDLE_PX : HANDLE_PX) / scale,
      hit: (coarse ? COARSE_HANDLE_HIT_PX : HANDLE_HIT_PX) / scale,
      turn: (coarse ? COARSE_TURN_HANDLE_PX : TURN_HANDLE_PX) / scale,
      stalk: (coarse ? COARSE_TURN_STALK_PX : TURN_STALK_PX) / scale,
    };
  }

  /**
   * The resize cursor one grip takes (#795): the box's own turn added to the
   * grip's direction, taken to the nearest 45°.
   * @param {number} rotation
   * @param {number} signX
   * @param {number} signY
   * @returns {string}
   */
  function resizeCursor(rotation, signX, signY) {
    const degrees = (Math.atan2(signY, signX) * 180) / Math.PI + rotation;
    const step = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
    return RESIZE_CURSORS[step];
  }

  /**
   * The handle maths (#795), mirrored from `transformBox` in `geometry.ts` so the
   * live preview agrees with what the Worker writes. The parity test in
   * `frame.test.ts` holds the two copies to the same results.
   */

  /** A turn inside one circle, in degrees. */
  function normalizeDegrees(degrees) {
    return ((degrees % 360) + 360) % 360;
  }

  /** The shortest way round from one angle to another, in degrees, between -180 and 180. */
  function turnedBy(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  /** The angle from a centre to a point, in degrees. */
  function angleAt(point, center) {
    return (Math.atan2(point[1] - center[1], point[0] - center[0]) * 180) / Math.PI;
  }

  /**
   * The box a rotate-handle drag asks for: the angle the pointer sweeps about
   * the box's centre added to the turn it already had. With `snap` (Shift) the
   * turn lands on a 15° step; without it, a turn within 2° of a right angle
   * sticks to it. The centre and the size never change.
   * @param {TransformGesture} gesture
   * @returns {FrameTransformBox}
   */
  function turnBox(gesture) {
    const { box } = gesture;
    const center = [box.x, box.y];
    let rotation = normalizeDegrees(
      box.rotation + turnedBy(angleAt(gesture.start, center), angleAt(gesture.point, center))
    );
    if (gesture.snap === true) {
      rotation = normalizeDegrees(Math.round(rotation / TURN_SNAP_DEGREES) * TURN_SNAP_DEGREES);
    } else {
      const right = Math.round(rotation / 90) * 90;
      if (Math.abs(turnedBy(rotation, right)) <= RIGHT_ANGLE_STICK_DEGREES) {
        rotation = normalizeDegrees(right);
      }
    }
    return { ...box, rotation };
  }

  /**
   * The box a corner or side drag asks for. The drag works in the box's own
   * turned frame, so a turned Element's handles move along its sides. A corner
   * anchors the opposite corner, a side the opposite side, and Alt anchors the
   * centre. `aspect` keeps the box's proportions; a side handle always moves one
   * axis. A drag can never reach zero or cross over its anchor: the side it
   * grows stops at `minWidth`/`minHeight` instead of flipping.
   * @param {TransformGesture} gesture
   * @returns {FrameTransformBox}
   */
  function resizeBox(gesture) {
    const { box, handle } = gesture;
    const angle = (box.rotation * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const toLocal = (point) => [
      (point[0] - box.x) * cos + (point[1] - box.y) * sin,
      -(point[0] - box.x) * sin + (point[1] - box.y) * cos,
    ];
    const signX = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
    const signY = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
    const halfWidth = Math.max(MIN_TRANSFORM_SIZE_MM, box.width) / 2;
    const halfHeight = Math.max(MIN_TRANSFORM_SIZE_MM, box.height) / 2;
    const startLocal = toLocal(gesture.start);
    const pointLocal = toLocal(gesture.point);
    // Where the grabbed corner, or the middle of the grabbed side, sits now.
    const grabbed = [signX * halfWidth, signY * halfHeight];
    const reached = [
      grabbed[0] + pointLocal[0] - startLocal[0],
      grabbed[1] + pointLocal[1] - startLocal[1],
    ];
    const minWidth = Math.max(MIN_TRANSFORM_SIZE_MM, gesture.minWidth ?? MIN_TRANSFORM_SIZE_MM);
    const minHeight = Math.max(MIN_TRANSFORM_SIZE_MM, gesture.minHeight ?? MIN_TRANSFORM_SIZE_MM);
    const anchor = [-signX * halfWidth, -signY * halfHeight];
    // An axis no handle grips keeps the size it had.
    let width =
      signX === 0
        ? halfWidth * 2
        : Math.max(
            minWidth,
            gesture.fromCentre === true
              ? 2 * Math.abs(reached[0])
              : signX * (reached[0] - anchor[0])
          );
    let height =
      signY === 0
        ? halfHeight * 2
        : Math.max(
            minHeight,
            gesture.fromCentre === true
              ? 2 * Math.abs(reached[1])
              : signY * (reached[1] - anchor[1])
          );
    if (gesture.aspect === true) {
      // A side scales from the one axis it drags; a corner from whichever grew more.
      const widthScale = width / (halfWidth * 2);
      const heightScale = height / (halfHeight * 2);
      const scale =
        signX === 0 ? heightScale : signY === 0 ? widthScale : Math.max(widthScale, heightScale);
      width = halfWidth * 2 * scale;
      height = halfHeight * 2 * scale;
    }
    const center =
      gesture.fromCentre === true
        ? [0, 0]
        : [anchor[0] + (signX * width) / 2, anchor[1] + (signY * height) / 2];
    return {
      x: box.x + center[0] * cos - center[1] * sin,
      y: box.y + center[0] * sin + center[1] * cos,
      width,
      height,
      rotation: box.rotation,
    };
  }

  /**
   * The box one handle gesture draws (#795): a corner or side resized in the
   * box's own frame, or the whole box turned about its centre.
   * @param {TransformGesture} gesture
   * @returns {FrameTransformBox}
   */
  function transformBox(gesture) {
    if (gesture.handle === "rotate") return turnBox(gesture);
    return resizeBox(gesture);
  }

  /**
   * The selected Element whose transform handles the Frame draws, or null: one
   * the Worker gave a box, shown, under the Select tool, since every other
   * tool's press draws a new thing rather than sizing the one under it.
   * @returns {FrameSceneElement | null}
   */
  function transformTarget() {
    if (scene === null || scene.tool !== "select") return null;
    const selected = scene.elements.find((element) => element.selected);
    if (selected === undefined || selected.transform === undefined || selected.hidden) return null;
    // A label being written shows its text box instead of its grips (#800).
    if (isEditingLabel(selected.id)) return null;
    return selected;
  }

  /**
   * The box the handles sit on for one Element (#795): the live box while its
   * drag runs or its preview holds, and the scene's own box otherwise.
   * @param {FrameSceneElement} target
   * @returns {FrameTransformBox}
   */
  function liveTransformBox(target) {
    if (target.transform === undefined) return { x: 0, y: 0, width: 0, height: 0, rotation: 0 };
    if (transformDrag !== null && transformDrag.id === target.id) return transformDrag.box;
    // A pinch previews through the same box, so its overlay and art follow it.
    if (pinchDrag !== null && pinchDrag.id === target.id) return pinchDrag.box;
    if (pendingTransform !== null && pendingTransform.id === target.id) return pendingTransform.box;
    return target.transform.box;
  }

  /**
   * The padlock badge a locked Element's box carries (#795): a small lock hung
   * on the box's top-left corner, sized from the screen scale so it stays
   * legible at every zoom. It marks the box rather than grips it, so it takes
   * no pointer.
   * @param {number} scale
   * @param {number} x
   * @param {number} y
   * @returns {any}
   */
  function lockBadge(scale, x, y) {
    const { html } = lib;
    const size = LOCK_BADGE_PX / scale;
    const width = size * 0.7;
    const height = size * 0.45;
    const shackle = size * 0.22;
    const top = y + shackle * 0.5;
    return html`<g class="map-transform-lock" data-transform-lock>
      <path
        class="map-transform-lock-shackle"
        d="M ${n(x - shackle)} ${n(top)} A ${n(shackle)} ${n(shackle)} 0 0 1 ${n(x + shackle)} ${n(top)}"
      />
      <rect
        class="map-transform-lock-body"
        x="${n(x - width / 2)}"
        y="${n(top)}"
        width="${n(width)}"
        height="${n(height)}"
        rx="${n(size * 0.08)}"
      />
    </g>`;
  }

  /**
   * The box and handles a selected Stamp's, Map Image's, Shape's, or Map
   * Label's transform draws (#795, #796): its box, turned with the Element, a
   * square grip on each corner, and on each side's middle for a Shape, or on
   * the left and right middles for a Map Label, and a round grip on a stalk
   * above the top edge for turning it. Each grip draws under a bigger invisible
   * target, both sized from the screen scale, so they keep their size on screen
   * at every zoom and grow for a finger.
   *
   * The overlay is drawn over the Elements, so a press on a grip reaches it
   * before the Element's own hit target under it. A locked Element shows its
   * box dashed with a small padlock badge and no grips: it cannot be resized or
   * turned.
   * @returns {any}
   */
  function transformOverlay() {
    const target = transformTarget();
    if (target === null || target.transform === undefined) return null;
    const { html } = lib;
    const box = liveTransformBox(target);
    const scale = screenScale();
    const sizes = scale === null ? null : handleSizes(scale);
    const halfWidth = box.width / 2;
    const halfHeight = box.height / 2;
    const locked = target.locked;
    const hovered = hoverGrip !== null && hoverGrip.id === target.id ? hoverGrip.handle : null;
    // Every handle shows at every zoom, however small the box is on screen; a
    // Frame that cannot measure its screen draws none. A Shape adds its four
    // sides, and a Map Label its left and right sides, never the top or the
    // bottom middle, where its bend handle lives.
    const corners = scale === null ? [] : CORNER_HANDLES;
    const full = sizes !== null && !locked && corners.length > 0;
    const sides = !full
      ? []
      : target.transform.handles === "all"
        ? SIDE_HANDLES
        : target.transform.handles === "label"
          ? LABEL_SIDE_HANDLES
          : [];
    const grips =
      sizes === null || locked
        ? []
        : // Sides first: the corners paint later, so where a finger-sized hit area
          // overlaps a side's, a press on the drawn corner takes the corner.
          [...sides, ...corners].map(([id, signX, signY]) => ({
            id,
            x: signX * halfWidth,
            y: signY * halfHeight,
            // The grip under the pointer grows, so the one a press would take stands out.
            drawn: hovered === id ? sizes.drawn * HOVER_GROW : sizes.drawn,
            hit: sizes.hit,
            // A Map Label's box is often shorter than two finger-sized corners,
            // which would bury its side grips: there a corner reaches no further
            // than 60% of the box's height, so the middle of each side is the
            // side's, which a fixed width is dragged from (#800).
            hitHeight:
              target.transform?.handles === "label" && signY !== 0
                ? Math.min(sizes.hit, box.height * 0.6)
                : sizes.hit,
            cursor: resizeCursor(box.rotation, signX, signY),
            hovered: hovered === id,
          }));
    const turn =
      sizes === null || locked
        ? null
        : {
            y: -halfHeight - sizes.stalk,
            radius: (hovered === "rotate" ? sizes.turn * HOVER_GROW : sizes.turn) / 2,
            hit: sizes.hit / 2,
            hovered: hovered === "rotate",
          };
    const frame = `translate(${n(box.x)} ${n(box.y)})${
      box.rotation === 0 ? "" : ` rotate(${n(box.rotation)})`
    }`;
    return html`<g
      class="map-transform"
      data-transform="${target.id}"
      data-locked="${locked ? "true" : undefined}"
      transform="${frame}"
    >
      <rect
        class="map-transform-box"
        x="${n(-halfWidth)}"
        y="${n(-halfHeight)}"
        width="${n(box.width)}"
        height="${n(box.height)}"
      />
      ${locked && scale !== null ? lockBadge(scale, -halfWidth, -halfHeight) : null}
      ${
        turn === null
          ? null
          : html`<path class="map-transform-stalk" d="M 0 ${n(-halfHeight)} L 0 ${n(turn.y)}" />
        <circle
          class="map-transform-handle"
          data-transform-handle="rotate"
          data-hovered="${turn.hovered ? "true" : undefined}"
          cx="0"
          cy="${n(turn.y)}"
          r="${n(turn.radius)}"
        />
        <circle
          class="map-transform-hit"
          data-transform-handle-hit="rotate"
          cx="0"
          cy="${n(turn.y)}"
          r="${n(turn.hit)}"
          style="cursor: ${TURN_CURSOR}"
        />`
      }
      ${grips.map(
        (grip) => html`<rect
          class="map-transform-handle"
          data-transform-handle="${grip.id}"
          data-hovered="${grip.hovered ? "true" : undefined}"
          x="${n(grip.x - grip.drawn / 2)}"
          y="${n(grip.y - grip.drawn / 2)}"
          width="${n(grip.drawn)}"
          height="${n(grip.drawn)}"
        />`
      )}
      ${grips.map(
        (grip) => html`<rect
          class="map-transform-hit"
          data-transform-handle-hit="${grip.id}"
          x="${n(grip.x - grip.hit / 2)}"
          y="${n(grip.y - grip.hitHeight / 2)}"
          width="${n(grip.hit)}"
          height="${n(grip.hitHeight)}"
          style="cursor: ${grip.cursor}"
        />`
      )}
    </g>`;
  }

  /**
   * The dashed ghost of the box a resize started from (#795), so the author
   * compares the size the Element had with the one the drag asks for. A turn
   * keeps the size it started with, so only a resize draws one, and it goes
   * with the drag when it ends.
   * @returns {any}
   */
  function transformGhost() {
    const start =
      transformDrag !== null && transformDrag.moved && transformDrag.handle !== "rotate"
        ? transformDrag.startBox
        : pinchDrag !== null && pinchDrag.moved
          ? pinchDrag.startBox
          : null;
    if (start === null) return null;
    const startBox = start;
    const { html } = lib;
    const frame = `translate(${n(startBox.x)} ${n(startBox.y)})${
      startBox.rotation === 0 ? "" : ` rotate(${n(startBox.rotation)})`
    }`;
    return html`<rect
      class="map-transform-ghost"
      transform="${frame}"
      x="${n(-startBox.width / 2)}"
      y="${n(-startBox.height / 2)}"
      width="${n(startBox.width)}"
      height="${n(startBox.height)}"
    />`;
  }

  /**
   * The tick ring a Shift turn draws (#795): one tick at every 15° step, so the
   * author sees where the snap will land. It sits a constant few pixels outside
   * the box's corners, and goes with the drag when it ends.
   * @returns {any}
   */
  function transformTicks() {
    if (transformDrag === null || !transformDrag.moved) return null;
    if (transformDrag.handle !== "rotate" || !transformDrag.snap) return null;
    const scale = screenScale();
    if (scale === null) return null;
    const { html } = lib;
    const { box } = transformDrag;
    const outer = Math.hypot(box.width, box.height) / 2 + TURN_TICK_GAP_PX / scale;
    const inner = outer - TURN_TICK_PX / scale;
    return html`<g class="map-transform-ticks">
      ${TURN_STEPS.map((degrees) => {
        // A turn reads clockwise from the box's own upright, so 0° points up.
        const angle = (degrees * Math.PI) / 180;
        const dx = Math.sin(angle);
        const dy = -Math.cos(angle);
        return html`<line
          class="map-transform-tick"
          x1="${n(box.x + inner * dx)}"
          y1="${n(box.y + inner * dy)}"
          x2="${n(box.x + outer * dx)}"
          y2="${n(box.y + outer * dy)}"
        />`;
      })}
    </g>`;
  }

  /** A readout value with one decimal at most, so `50.0 mm` reads `50 mm`. */
  function readoutNumber(value) {
    return String(Math.round(value * 10) / 10);
  }

  /**
   * The chip that reads the drag's size in millimetres, or its angle in
   * degrees, just down and right of the pointer (#795, #796). Its text is the
   * localized template the scene carries: the turn's angle or a Stamp's size
   * with its number filled in, a Shape's width and height, or a Map Label's
   * cap size and width. A scene that carries none, or a Frame that cannot
   * measure its screen, draws no chip rather than a wrong one.
   * @returns {any}
   */
  function transformReadout() {
    // A pinch reads the same chip as a handle drag: it only ever resizes, so
    // it takes the size text at the fingers' midpoint, never the turn's angle.
    const active =
      transformDrag !== null && transformDrag.moved
        ? {
            box: transformDrag.box,
            handles: transformDrag.handles,
            handle: transformDrag.handle,
            point: transformDrag.point,
          }
        : pinchDrag !== null && pinchDrag.moved
          ? {
              box: pinchDrag.box,
              handles: pinchDrag.handles,
              handle: "pinch",
              point: pinchDrag.mid,
            }
          : null;
    if (active === null || scene === null) return null;
    const turning = active.handle === "rotate";
    const shape = active.handles === "all";
    const label = active.handles === "label";
    const template = turning
      ? scene.readout.angle
      : shape
        ? scene.readout.shape
        : label
          ? scene.readout.label
          : scene.readout.size;
    if (template === "") return null;
    const scale = screenScale();
    if (scale === null) return null;
    const { html } = lib;
    const text = template
      .replace("{{value}}", readoutNumber(turning ? active.box.rotation : active.box.width))
      .replace("{{width}}", readoutNumber(active.box.width))
      .replace("{{height}}", readoutNumber(active.box.height))
      .replace("{{size}}", readoutNumber(active.box.height));
    const font = CHIP_FONT_PX / scale;
    const padX = CHIP_PAD_X_PX / scale;
    const padY = CHIP_PAD_Y_PX / scale;
    // The Frame cannot measure a glyph, so a fixed advance keeps the chip's
    // background behind its text; the Frame's body font is a system sans.
    const width = text.length * font * CHIP_ADVANCE + padX * 2;
    const height = font + padY * 2;
    const [x, y] = active.point;
    return html`<g
      class="map-readout"
      transform="translate(${n(x + CHIP_GAP_PX / scale)} ${n(y + CHIP_GAP_PX / scale)})"
    >
      <rect
        class="map-readout-chip"
        width="${n(width)}"
        height="${n(height)}"
        rx="${n(CHIP_RADIUS_PX / scale)}"
      />
      <text class="map-readout-text" x="${n(padX)}" y="${n(padY + font * 0.8)}" font-size="${n(font)}"
        >${text}</text
      >
    </g>`;
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
    // The Element whose box marks it instead of a trace of its ink, if any.
    const outlined = transformTarget();
    lib.render(
      html`<svg
        viewBox="${n(view.x)} ${n(view.y)} ${n(view.width)} ${n(view.height)}"
        preserveAspectRatio="xMidYMid meet"
        data-tool="${current.tool}"
        data-panning="${panDrag === null ? "false" : "true"}"
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
                dangerouslySetInnerHTML=${{ __html: withAssetHrefs(current.defs, liveUrl) }}
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
              data-editing="${isEditingLabel(element.id) ? "true" : undefined}"
              transform="${dragTransform(element.id)}"
            >
              ${elementArt(element)}
              ${
                element.selected && element.id !== outlined?.id
                  ? highlightShapes(element).map(
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
        ${transformGhost()}
        ${transformOverlay()}
        ${bendOverlay()}
        ${transformTicks()}
        ${transformReadout()}
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
    positionLabelEditor();
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
   * A number for an SVG transform's scale, with three decimals at most, as
   * `scene.ts` writes one.
   * @param {number} value
   * @returns {string}
   */
  function n3(value) {
    return String(Math.round(value * 1000) / 1000);
  }

  /**
   * The SVG transform that previews a handle drag on an Element's own group
   * (#795): the start box moved, turned, and scaled onto the live one, on each
   * axis, so a Shape's free resize previews exactly and the art sits inside the
   * box the drag draws.
   * @param {string} id
   * @returns {string | undefined}
   */
  function transformPreview(id) {
    /** @type {{ startBox: FrameTransformBox, box: FrameTransformBox } | null} */
    let preview = null;
    if (transformDrag !== null && transformDrag.id === id) preview = transformDrag;
    else if (pinchDrag !== null && pinchDrag.id === id) preview = pinchDrag;
    else if (pendingTransform !== null && pendingTransform.id === id) preview = pendingTransform;
    if (preview === null) return undefined;
    // A Map Label's side sets the width its text wraps at (#800): the box
    // previews it, and the text keeps its letters until the Worker rewraps it.
    if (holdsArt(preview)) return undefined;
    const { startBox, box } = preview;
    const scaleX = startBox.width === 0 ? 1 : box.width / startBox.width;
    const scaleY = startBox.height === 0 ? 1 : box.height / startBox.height;
    const turn = box.rotation - startBox.rotation;
    const zoom =
      scaleX === scaleY
        ? scaleX === 1
          ? ""
          : ` scale(${n3(scaleX)})`
        : ` scale(${n3(scaleX)} ${n3(scaleY)})`;
    return `translate(${n(box.x)} ${n(box.y)})${
      turn === 0 ? "" : ` rotate(${n(turn)})`
    }${zoom} translate(${n(-startBox.x)} ${n(-startBox.y)})`;
  }

  /**
   * Whether a handle drag previews its box alone, leaving the Element's art
   * where it was: a Map Label's side, which wraps the text instead of
   * stretching it (#800).
   * @param {{ handle?: string, handles?: string, holdArt?: boolean }} preview
   */
  function holdsArt(preview) {
    if (preview.holdArt === true) return true;
    return preview.handles === "label" && LABEL_SIDE_HANDLES.some(([id]) => id === preview.handle);
  }

  /**
   * The cap size a Map Label's handle drag or pinch asks for: its own, scaled
   * as its box's height was (#800), or none for a side, which keeps the size
   * and sets a fixed width instead.
   * @param {string} id
   * @param {string} handle
   * @param {FrameTransformBox} startBox
   * @param {FrameTransformBox} box
   * @returns {{ size?: number }}
   */
  function labelDragSize(id, handle, startBox, box) {
    if (LABEL_SIDE_HANDLES.some(([side]) => side === handle)) return {};
    const element = scene === null ? undefined : scene.elements.find((one) => one.id === id);
    const size = element?.label?.size;
    if (size === undefined || !(startBox.height > 0)) return { size: box.height };
    return { size: (size * box.height) / startBox.height };
  }

  /**
   * The live offset a Select drag draws an Element at, as an SVG translate, or
   * undefined when it sits where the scene put it. A finished drag keeps its
   * offset until the Worker's next scene draws the Element there itself. A
   * handle drag previews the Element in its new box the same way (#795).
   * @param {string} id
   * @returns {string | undefined}
   */
  function dragTransform(id) {
    const preview = transformPreview(id);
    if (preview !== undefined) return preview;
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

  /**
   * Starts a bend drag when the press lands on a Map Label's bend handle
   * (#751), and reports whether it did, so the press neither picks an Element
   * nor starts a move.
   * @param {PointerEvent} event
   * @returns {boolean}
   */
  function startBend(event) {
    const handle =
      event.target instanceof Element ? event.target.closest("[data-bend-handle]") : null;
    if (handle === null || scene === null) return false;
    const id = handle.getAttribute("data-bend-handle");
    const target = id === null ? undefined : scene.elements.find((element) => element.id === id);
    if (target === undefined || target.label === undefined) return false;
    const point = pagePoint(event);
    if (point === null) return false;
    event.preventDefault();
    bendDrag = {
      pointerId: event.pointerId,
      id: target.id,
      press: { clientX: event.clientX, clientY: event.clientY },
      label: target.label,
      // The press alone does not shape the curve: a click on the handle's edge
      // leaves it as it was, and only travel past the drag threshold bends it.
      moved: false,
      bend: target.label.bend,
    };
    capturePointer(event);
    draw();
    return true;
  }

  /**
   * Follows the pointer with the bend drag: once the press has travelled past
   * the Select drag's threshold, the handle and the curve preview the bend the
   * pointer asks for, live, in this Frame only. A press that never travels
   * leaves the bend untouched, so a click on the handle's edge posts nothing.
   * @param {PointerEvent} event
   */
  function followBend(event) {
    if (bendDrag === null) return;
    const point = pagePoint(event);
    if (point === null) return;
    if (!bendDrag.moved) {
      const travelled = Math.hypot(
        event.clientX - bendDrag.press.clientX,
        event.clientY - bendDrag.press.clientY
      );
      if (travelled < DRAG_THRESHOLD_PX) return;
      bendDrag.moved = true;
    }
    bendDrag.bend = bendAt(bendDrag.label, point);
    draw();
  }

  /**
   * Ends the bend drag. A drag that moved the pointer and changed the bend goes
   * to the Worker as one bend message, which is one undo step, and its preview
   * holds until the Worker answers; a press that never passed the threshold, or
   * one that left the curve as it was, sends nothing.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endBend(event, send) {
    if (bendDrag === null || event.pointerId !== bendDrag.pointerId) return;
    const drag = bendDrag;
    bendDrag = null;
    releasePointer(event);
    if (!send || !drag.moved || drag.bend === drag.label.bend) {
      draw();
      return;
    }
    pendingBend = { id: drag.id, bend: drag.bend };
    draw();
    post({ kind: "bendLabel", id: drag.id, bend: drag.bend });
  }

  /** Drops the bend drag in progress, and its preview, without reporting it. */
  function cancelBend() {
    if (bendDrag === null) return;
    const pointerId = bendDrag.pointerId;
    bendDrag = null;
    releasePointerId(pointerId);
    draw();
  }

  /**
   * The grip under the pointer (#795), its Element and handle, or null when the
   * pointer rests on anything else. A press reaches the invisible target, so
   * that is what a hover reports.
   * @param {PointerEvent} event
   * @returns {HoverGrip | null}
   */
  function hoveredGrip(event) {
    const hit =
      event.target instanceof Element ? event.target.closest("[data-transform-handle-hit]") : null;
    const handle = hit === null ? null : hit.getAttribute("data-transform-handle-hit");
    const overlay = hit === null ? null : hit.closest("[data-transform]");
    const id = overlay === null ? null : overlay.getAttribute("data-transform");
    return handle === null || id === null ? null : { id, handle };
  }

  /**
   * Sets the grip under the pointer (#795), redrawing only when it changed, so
   * a pointer crossing the surface does not repaint the Map at every sample.
   * @param {HoverGrip | null} grip
   */
  function setHoverGrip(grip) {
    if (hoverGrip?.id === grip?.id && hoverGrip?.handle === grip?.handle) return;
    hoverGrip = grip;
    draw();
  }

  /**
   * Starts a transform handle drag when the press lands on a grip (#795), and
   * reports whether it did, so the press neither picks an Element nor moves it.
   * A press on the edge of a grip that never travels leaves the box as it was,
   * so a click posts nothing.
   * @param {PointerEvent} event
   * @returns {boolean}
   */
  function startTransform(event) {
    const hit =
      event.target instanceof Element ? event.target.closest("[data-transform-handle-hit]") : null;
    if (hit === null || scene === null) return false;
    const handle = hit.getAttribute("data-transform-handle-hit");
    const overlay = hit.closest("[data-transform]");
    const id = overlay === null ? null : overlay.getAttribute("data-transform");
    if (handle === null || id === null) return false;
    const target = scene.elements.find((element) => element.id === id);
    if (target === undefined || target.transform === undefined || target.locked || target.hidden) {
      return false;
    }
    const point = pagePoint(event);
    if (point === null) return false;
    event.preventDefault();
    transformDrag = {
      pointerId: event.pointerId,
      id: target.id,
      handle,
      handles: target.transform.handles,
      press: { clientX: event.clientX, clientY: event.clientY },
      start: point,
      point,
      startBox: { ...target.transform.box },
      box: { ...target.transform.box },
      // The Worker's own minimum size, so a preview never shows a box it would
      // shrink: a scene without one lets the maths' floor apply.
      minSize: target.transform.minSize ?? MIN_TRANSFORM_SIZE_MM,
      snap: false,
      moved: false,
    };
    capturePointer(event);
    return true;
  }

  /**
   * Follows the pointer with the transform drag: once the press has travelled
   * past the Select drag's threshold, the box, its handles, and the Element's
   * art preview what the pointer asks for, live and in this Frame only. A
   * Stamp's or a Map Image's corner keeps its aspect; a Shape's corner only
   * does with Shift, and its sides move one axis. A Map Label's corner grows
   * its cap size and width together, and its sides move the width alone, all in
   * the label's own turned frame. Alt resizes about the centre, and Shift
   * snaps a turn to 15°.
   * @param {PointerEvent} event
   */
  function followTransform(event) {
    if (transformDrag === null) return;
    const point = pagePoint(event);
    if (point === null) return;
    if (!transformDrag.moved) {
      const travelled = Math.hypot(
        event.clientX - transformDrag.press.clientX,
        event.clientY - transformDrag.press.clientY
      );
      if (travelled < DRAG_THRESHOLD_PX) return;
      transformDrag.moved = true;
    }
    transformDrag.point = point;
    transformDrag.snap = event.shiftKey === true;
    // A Stamp and a Map Image store a width alone, and their aspect carries
    // the height with it, so the Worker's minimum is the width's (#795). A
    // Shape keeps a width and a height of its own, so it takes both (#796). A
    // Map Label's box height is its cap size, so it takes both too, and the
    // corner's uniform growth never previews a cap size below the Worker's own
    // floor, which the scene carries as the handle data's minimum size. Only a
    // corner keeps the aspect: a side moves its one axis alone.
    const shape = transformDrag.handles === "all";
    const label = transformDrag.handles === "label";
    const corner = CORNER_HANDLES.some(([id]) => id === transformDrag.handle);
    transformDrag.box = transformBox({
      box: transformDrag.startBox,
      handle: transformDrag.handle,
      start: transformDrag.start,
      point,
      aspect: shape ? event.shiftKey === true : !label || corner,
      fromCentre: event.altKey === true,
      snap: transformDrag.snap,
      minWidth: transformDrag.minSize,
      ...(shape || label ? { minHeight: transformDrag.minSize } : {}),
    });
    draw();
  }

  /**
   * Ends the transform drag. A drag that moved the box goes to the Worker as
   * one transformElement, which is one undo step, and its preview holds until
   * the Worker answers; a press that never passed the threshold, or one that
   * left the box as it was, sends nothing. A Map Label's drag carries its new
   * cap size, which is the box height the drag previews, so the Worker writes
   * the size the preview showed.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endTransform(event, send) {
    if (transformDrag === null || event.pointerId !== transformDrag.pointerId) return;
    const drag = transformDrag;
    transformDrag = null;
    releasePointer(event);
    if (!send || !drag.moved || sameBox(drag.box, drag.startBox)) {
      draw();
      return;
    }
    pendingTransform = {
      id: drag.id,
      startBox: drag.startBox,
      box: drag.box,
      holdArt: holdsArt(drag),
    };
    draw();
    post({
      kind: "transformElement",
      id: drag.id,
      box: drag.box,
      ...(drag.handles === "label"
        ? labelDragSize(drag.id, drag.handle, drag.startBox, drag.box)
        : {}),
    });
  }

  /** Drops the transform drag in progress, and its preview, without reporting it. */
  function cancelTransform() {
    if (transformDrag === null) return;
    const pointerId = transformDrag.pointerId;
    transformDrag = null;
    releasePointerId(pointerId);
    draw();
  }

  /**
   * Whether two boxes place, size, and turn an Element the same way.
   * @param {FrameTransformBox} one
   * @param {FrameTransformBox} two
   */
  function sameBox(one, two) {
    return (
      one.x === two.x &&
      one.y === two.y &&
      one.width === two.width &&
      one.height === two.height &&
      one.rotation === two.rotation
    );
  }

  /**
   * The selected, unlocked Element with handles the first finger landed on
   * (#796), or null when the press cannot start a pinch: only a press on such
   * an Element may pinch it, under the Select tool whose handles mark it.
   * @param {PointerEvent} event
   * @returns {PinchCandidate | null}
   */
  function pinchElement(event) {
    if (scene === null || scene.tool !== "select") return null;
    const target =
      event.target instanceof Element ? event.target.closest("[data-element-id]") : null;
    const id = target === null ? null : target.getAttribute("data-element-id");
    if (id === null) return null;
    const element = scene.elements.find((candidate) => candidate.id === id);
    if (
      element === undefined ||
      !element.selected ||
      element.locked ||
      element.hidden ||
      element.transform === undefined
    ) {
      return null;
    }
    return { pointerId: event.pointerId, id: element.id };
  }

  /**
   * The box the fingers ask for (#796): the start box grown by the distance
   * change, uniformly, turned by the angle change, and carried with the
   * midpoint, so the Element scales and twists about the pair and follows it.
   * A Map Label grows the same way, so its cap size follows its width. The
   * box never shrinks under the minimum size the scene gave it.
   * @param {FrameTransformBox} startBox
   * @param {MapPoint} startMid
   * @param {number} startDistance
   * @param {number} startAngle
   * @param {number} minSize
   * @param {string} handles
   * @param {MapPoint} mid
   * @param {number} distance
   * @param {number} angle
   * @returns {FrameTransformBox}
   */
  function pinchBox(
    startBox,
    startMid,
    startDistance,
    startAngle,
    minSize,
    handles,
    mid,
    distance,
    angle
  ) {
    const minWidth = Math.max(MIN_TRANSFORM_SIZE_MM, minSize);
    const minHeight =
      handles === "all" || handles === "label"
        ? Math.max(MIN_TRANSFORM_SIZE_MM, minSize)
        : MIN_TRANSFORM_SIZE_MM;
    const scale = startDistance > 1e-6 ? distance / startDistance : 1;
    // One uniform scale for both sides, stopping at the tighter minimum.
    const floor = Math.max(
      minWidth / Math.max(MIN_TRANSFORM_SIZE_MM, startBox.width),
      minHeight / Math.max(MIN_TRANSFORM_SIZE_MM, startBox.height)
    );
    const grown = Math.max(scale, floor);
    const delta = turnedBy(startAngle, angle);
    const radians = (delta * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const dx = startBox.x - startMid[0];
    const dy = startBox.y - startMid[1];
    return {
      x: mid[0] + (dx * cos - dy * sin) * grown,
      y: mid[1] + (dx * sin + dy * cos) * grown,
      width: startBox.width * grown,
      height: startBox.height * grown,
      rotation: normalizeDegrees(startBox.rotation + delta),
    };
  }

  /**
   * Starts the pinch-and-twist gesture (#796) when the second finger lands and
   * the first one waits on a selected, unlocked Element with handles, and
   * reports whether it did. Anything else is still a pan: the gesture under
   * way is dropped without reaching the Worker, as a tool change drops one.
   * @param {PointerEvent} event
   * @param {number[]} fingers
   * @returns {boolean}
   */
  function startPinch(event, fingers) {
    if (pinchCandidate === null || fingers.length !== 2) {
      pinchCandidate = null;
      return false;
    }
    if (!fingers.includes(event.pointerId) || !fingers.includes(pinchCandidate.pointerId)) {
      pinchCandidate = null;
      return false;
    }
    const other = fingers[0] === event.pointerId ? /** @type {number} */ (fingers[1]) : fingers[0];
    if (other !== pinchCandidate.pointerId || scene === null) {
      pinchCandidate = null;
      return false;
    }
    const target = scene.elements.find((element) => element.id === pinchCandidate.id);
    const otherClient = pointerClients.get(other);
    if (
      target === undefined ||
      !target.selected ||
      target.locked ||
      target.hidden ||
      target.transform === undefined ||
      otherClient === undefined ||
      otherClient.touch !== true
    ) {
      pinchCandidate = null;
      return false;
    }
    const first = pagePoint(otherClient);
    const second = pagePoint(event);
    if (first === null || second === null) return false;
    const startDistance = Math.hypot(second[0] - first[0], second[1] - first[1]);
    if (!(startDistance > 1e-6)) return false;
    const candidate = pinchCandidate;
    pinchCandidate = null;
    resetGestures();
    const startMid = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
    pinchDrag = {
      pointers: [candidate.pointerId, event.pointerId],
      id: target.id,
      handles: target.transform.handles,
      startBox: { ...target.transform.box },
      box: { ...target.transform.box },
      // The Worker's own minimum size, so a preview never shows a box it would
      // shrink: a scene without one lets the handle maths' floor apply.
      minSize: target.transform.minSize ?? MIN_TRANSFORM_SIZE_MM,
      startDistance,
      startAngle: (Math.atan2(second[1] - first[1], second[0] - first[0]) * 180) / Math.PI,
      startMid,
      mid: startMid,
      moved: false,
    };
    for (const pointerId of pinchDrag.pointers) capturePointerId(pointerId);
    event.preventDefault();
    draw();
    return true;
  }

  /**
   * Follows the fingers with the pinch (#796): the box the pair asks for
   * previews live, in this Frame only, through the handle drag's own preview.
   * @param {PointerEvent} event
   */
  function followPinch(event) {
    if (pinchDrag === null || !pinchDrag.pointers.includes(event.pointerId)) return;
    const firstClient = pointerClients.get(pinchDrag.pointers[0]);
    const secondClient = pointerClients.get(pinchDrag.pointers[1]);
    if (firstClient === undefined || secondClient === undefined) return;
    const first = pagePoint(firstClient);
    const second = pagePoint(secondClient);
    if (first === null || second === null) return;
    pinchDrag.moved = true;
    pinchDrag.mid = [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
    pinchDrag.box = pinchBox(
      pinchDrag.startBox,
      pinchDrag.startMid,
      pinchDrag.startDistance,
      pinchDrag.startAngle,
      pinchDrag.minSize,
      pinchDrag.handles,
      pinchDrag.mid,
      Math.hypot(second[0] - first[0], second[1] - first[1]),
      (Math.atan2(second[1] - first[1], second[0] - first[0]) * 180) / Math.PI
    );
    event.preventDefault();
    draw();
  }

  /**
   * Ends the pinch. A pinch that moved the box goes to the Worker as one
   * transformElement, which is one undo step, and its preview holds until the
   * Worker answers; lifting the fingers where they landed sends nothing. A Map
   * Label's drag carries its new cap size, which is the box height the pinch
   * previews.
   * @param {PointerEvent} event
   * @param {boolean} send
   */
  function endPinch(event, send) {
    if (pinchDrag === null || !pinchDrag.pointers.includes(event.pointerId)) return;
    const drag = pinchDrag;
    pinchDrag = null;
    for (const pointerId of drag.pointers) releasePointerId(pointerId);
    if (!send || !drag.moved || sameBox(drag.box, drag.startBox)) {
      draw();
      return;
    }
    pendingTransform = { id: drag.id, startBox: drag.startBox, box: drag.box };
    draw();
    post({
      kind: "transformElement",
      id: drag.id,
      box: drag.box,
      ...(drag.handles === "label" ? labelDragSize(drag.id, "pinch", drag.startBox, drag.box) : {}),
    });
  }

  /** Drops the pinch in progress, and its preview, without reporting it. */
  function cancelPinch() {
    if (pinchDrag === null) return;
    const drag = pinchDrag;
    pinchDrag = null;
    for (const pointerId of drag.pointers) releasePointerId(pointerId);
    draw();
  }

  /**
   * The client point a pan measures from: the average of the pointers it
   * follows, so a two-finger drag pans by where the pair went.
   * @param {number[]} pointers
   * @returns {ClientPoint | null}
   */
  function gestureClient(pointers) {
    let x = 0;
    let y = 0;
    let seen = 0;
    for (const id of pointers) {
      const client = pointerClients.get(id);
      if (client === undefined) continue;
      x += client.clientX;
      y += client.clientY;
      seen += 1;
    }
    if (seen === 0) return null;
    return { clientX: x / seen, clientY: y / seen };
  }

  /**
   * Starts a pan (#777), whatever tool is active: Space held, the middle
   * button, or a second finger; with the Hand, any press. A gesture that pans never draws, so a draft
   * under way is dropped without reaching the Worker, as a tool change drops
   * one, and the crosshair comes back when the pan ends.
   * @param {PointerEvent} event
   * @param {number[]} pointers
   */
  function beginPan(event, pointers) {
    resetGestures();
    panDrag = {
      pointers,
      client: gestureClient(pointers) ?? { clientX: event.clientX, clientY: event.clientY },
      offset: [0, 0],
    };
    for (const id of pointers) capturePointerId(id);
    event.preventDefault();
    draw();
  }

  /**
   * Slides the view with the pan (#777): each step is the pointer's, or the
   * finger pair's, travel in page millimetres, measured through the screen
   * matrix of the moment as a Select drag measures its own. The drawing
   * follows the gesture, so the view slides the other way. The step only
   * rewrites the svg's viewBox: nothing else on the drawing changes while it
   * slides, so neither the Worker nor a full redraw is needed until release.
   * @param {PointerEvent} event
   */
  function followPan(event) {
    if (panDrag === null || !panDrag.pointers.includes(event.pointerId)) return;
    const next = gestureClient(panDrag.pointers);
    if (next === null) return;
    const from = pagePoint(panDrag.client);
    const to = pagePoint(next);
    panDrag.client = next;
    if (from === null || to === null) return;
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    panDrag.offset = [panDrag.offset[0] - dx, panDrag.offset[1] - dy];
    showView();
  }

  /** Points the drawn svg at the current view without redrawing what it shows. */
  function showView() {
    if (scene === null || surface === null) return;
    const svg = surface.querySelector("svg");
    if (svg === null) return;
    const view = viewRect(scene);
    svg.setAttribute("viewBox", `${n(view.x)} ${n(view.y)} ${n(view.width)} ${n(view.height)}`);
  }

  /**
   * Sends the Worker what the pan in progress has slid so far, as one pan, and
   * keeps showing it until the Worker's scene carries it. The drag goes on
   * from zero, so a pan committed mid-gesture is never counted twice.
   */
  function commitPan() {
    if (panDrag === null) return;
    const [dx, dy] = panDrag.offset;
    panDrag.offset = [0, 0];
    // A travel too small to move the Worker's pan would never be answered.
    if (Math.abs(dx) < PAN_EPSILON_MM && Math.abs(dy) < PAN_EPSILON_MM) return;
    unansweredPans.push([dx, dy]);
    // An axis the pan did not travel carries a plain zero, never a -0.
    post({ kind: "pan", dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy });
  }

  /**
   * Ends the pan and releases the pointers it followed. Space lifted mid-drag
   * ends it too, so the press stops panning the moment the modifier is gone.
   * @param {PointerEvent | null} event the pointer that ended it, or null for Space
   */
  function endPan(event) {
    if (panDrag === null) return;
    const pointers = panDrag.pointers;
    if (event !== null && !pointers.includes(event.pointerId)) return;
    commitPan();
    panDrag = null;
    for (const id of pointers) releasePointerId(id);
    // The crosshair the pan dropped comes back with the tool it belongs to.
    syncCrosshair();
    draw();
  }

  /**
   * Posts one validated message to the Worker; a missing port drops it. A
   * rasterize reply hands its bytes over as a transfer, so a full-size picture
   * is not copied.
   * @param {unknown} message
   * @param {Transferable[]} [transfer]
   */
  function post(message, transfer) {
    if (port === null) return;
    if (transfer === undefined) port.postMessage(message);
    else port.postMessage(message, transfer);
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
    capturePointerId(event.pointerId);
  }

  /** @param {number} pointerId */
  function capturePointerId(pointerId) {
    const svg = svgElement();
    if (svg === null || typeof svg.setPointerCapture !== "function") return;
    try {
      svg.setPointerCapture(pointerId);
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

  /**
   * Whether `id` is the Map Label the text box is writing, or one whose
   * committed text the Worker has yet to draw (#800).
   * @param {string} id
   */
  function isEditingLabel(id) {
    return (labelEdit !== null && labelEdit.id === id) || pendingLabelText === id;
  }

  /**
   * Opens the on-map text box on one shown, unlocked Map Label (#800): an HTML
   * textarea over the label, in its face, size, spacing, and ink, turned with
   * it, so the author writes where the name sits. Enter starts a new line;
   * Escape, a press on the Map, or focus leaving commits. While it is open no
   * key reaches the editor's Commands. A Frame that cannot take focus (the
   * host holds it) shows no box at all.
   * @param {string} id
   */
  function openLabelEditor(id) {
    if (scene === null) return;
    if (labelEdit !== null) commitLabelEditor();
    const element = scene.elements.find((candidate) => candidate.id === id);
    if (element === undefined || element.label === undefined) return;
    if (element.locked || element.hidden) return;
    const field = document.createElement("textarea");
    field.className = "map-label-editor";
    field.setAttribute("data-label-editor", id);
    if (scene.labelEditor.label !== "") field.setAttribute("aria-label", scene.labelEditor.label);
    field.placeholder = scene.labelEditor.placeholder;
    field.value = element.label.text;
    field.rows = 1;
    field.addEventListener("keydown", onLabelEditorKey);
    field.addEventListener("input", positionLabelEditor);
    field.addEventListener("blur", onLabelEditorBlur);
    window.addEventListener("blur", onLabelEditorBlur);
    document.body.append(field);
    labelEdit = { id, field, original: element.label.text };
    draw();
    // Firefox leaves the Frame's window unfocused after a press the Frame
    // cancels, so the press's own user activation focuses it first; a Frame
    // the host holds focus away from stays unfocused and shows no box.
    if (!document.hasFocus()) window.focus();
    field.focus({ preventScroll: true });
    if (document.activeElement !== field) {
      closeLabelEditor();
      return;
    }
    // A double click opens on the whole name, as a design tool's text box does.
    field.select();
  }

  /**
   * How wide an empty text box's italic prompt runs, in screen pixels. A
   * placeholder adds nothing to a textarea's scroll width, so the prompt is
   * written into the box for the one read, in italic as `::placeholder` draws
   * it, and taken out again; a quarter em more holds the slant the last letter
   * leans past its advance.
   * @param {HTMLTextAreaElement} field
   * @param {number} fontPx
   * @returns {number}
   */
  function promptWidth(field, fontPx) {
    field.value = field.placeholder;
    field.style.fontStyle = "italic";
    const width = field.scrollWidth + fontPx / 4;
    field.style.fontStyle = "";
    field.value = "";
    return width;
  }

  /**
   * Seats the text box over its label (#800): its first line's baseline on
   * the label's point, centred, turned with it, at the screen size the zoom
   * draws it at. An auto box grows with its longest line; a fixed one keeps
   * the label's width and wraps inside it. Both grow down with their lines.
   */
  function positionLabelEditor() {
    if (labelEdit === null || scene === null) return;
    const { field, id } = labelEdit;
    const element = scene.elements.find((candidate) => candidate.id === id);
    const label = element?.label;
    if (label === undefined) return;
    const svg = surface === null ? null : surface.querySelector("svg");
    const matrix =
      svg !== null && typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
    const scale = matrix === null ? (screenScale() ?? 1) : Math.hypot(matrix.a, matrix.b);
    const origin =
      matrix === null
        ? { x: 0, y: 0 }
        : {
            x: matrix.a * label.x + matrix.c * label.y + matrix.e,
            y: matrix.b * label.x + matrix.d * label.y + matrix.f,
          };
    const fontPx = label.size * scale;
    const linePx = label.lineHeight * scale;
    const style = field.style;
    style.fontFamily = label.font === "" ? "serif" : `"${label.font}", serif`;
    style.fontSize = `${fontPx}px`;
    style.lineHeight = `${linePx}px`;
    style.letterSpacing = `${label.letterSpacing * scale}px`;
    style.color = label.fill;
    style.whiteSpace = label.sizing === "auto" ? "pre" : "pre-wrap";
    if (label.sizing === "auto") {
      // The box's own scroll width is its longest line, caret included.
      style.width = "0px";
      const textWidth = field.value === "" ? promptWidth(field, fontPx) : field.scrollWidth;
      style.width = `${Math.max(textWidth, fontPx / 2) + 2}px`;
    } else {
      style.width = `${label.width * scale}px`;
    }
    style.height = "0px";
    const height = Math.max(field.scrollHeight, linePx);
    style.height = `${height}px`;
    const width = field.getBoundingClientRect().width || Number.parseFloat(style.width) || 0;
    // A CSS line box puts its baseline half the leading plus the ascent down.
    const baseline = (linePx - (label.ascent + label.descent) * fontPx) / 2 + label.ascent * fontPx;
    style.left = `${origin.x}px`;
    style.top = `${origin.y}px`;
    style.transform = `rotate(${label.rotation}deg) translate(${-width / 2}px, ${-baseline}px)`;
  }

  /**
   * Keeps every key inside the text box (#800): letters write the label, never
   * the tool Shortcuts, and the host never hears them. Escape, or Ctrl or Cmd
   * with Enter, commits.
   * @param {KeyboardEvent} event
   */
  function onLabelEditorKey(event) {
    event.stopPropagation();
    if (event.key === "Escape" || (event.key === "Enter" && (event.ctrlKey || event.metaKey))) {
      event.preventDefault();
      commitLabelEditor();
      return;
    }
    // Tab commits and still moves focus on: Firefox sends the box no blur when
    // focus leaves the Frame for the host.
    if (event.key === "Tab") commitLabelEditor();
  }

  /**
   * Focus leaving the text box, to the host or by Tab, commits it; so does the
   * Frame's window losing focus, which is all Firefox reports for a press on
   * the host.
   */
  function onLabelEditorBlur() {
    commitLabelEditor();
  }

  /** Takes the text box away, and the listeners it holds. */
  function closeLabelEditor() {
    if (labelEdit === null) return;
    const { field } = labelEdit;
    labelEdit = null;
    field.removeEventListener("keydown", onLabelEditorKey);
    field.removeEventListener("input", positionLabelEditor);
    field.removeEventListener("blur", onLabelEditorBlur);
    window.removeEventListener("blur", onLabelEditorBlur);
    field.remove();
    draw();
  }

  /**
   * Commits the text box (#800): a changed text goes to the Worker as one
   * labelText, which is one undo step, and the label's ink stays hidden until
   * its scene draws the new lines. Focus stays in the Frame, so the next key
   * is a tool Shortcut again.
   */
  function commitLabelEditor() {
    if (labelEdit === null) return;
    const { id, field, original } = labelEdit;
    const text = field.value;
    if (text !== original) pendingLabelText = id;
    closeLabelEditor();
    if (text !== original) post({ kind: "labelText", id, text });
  }

  /** @param {PointerEvent} event */
  function onPointerDown(event) {
    if (scene === null) return;
    // A press on the Map commits the text box first, then does what it does.
    if (labelEdit !== null) commitLabelEditor();
    pointerClients.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY,
      touch: event.pointerType === "touch",
    });
    // A third finger never joins a pinch: the pair owns the gesture.
    if (pinchDrag !== null) return;
    // Space turns any press into a pan (#777), so the author moves the view
    // without leaving the tool they are drawing with.
    if (spacePan) {
      beginPan(event, [event.pointerId]);
      return;
    }
    // The middle button pans too, and never draws.
    if (event.button === 1) {
      beginPan(event, [event.pointerId]);
      return;
    }
    // A right mouse button is never a drawing gesture; touch, pen, and the
    // primary button are.
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A second finger on the glass pans (#777), dropping the draft the first
    // began, so a two-finger drag never draws. When the first finger waits on
    // a selected, unlocked Element with handles, the pair pinches and twists
    // it instead (#796).
    const fingers = [...pointerClients.entries()]
      .filter(([, place]) => place.touch)
      .map(([id]) => id);
    if (event.pointerType === "touch" && fingers.length > 1) {
      if (startPinch(event, fingers)) return;
      beginPan(event, fingers);
      return;
    }
    // The first finger of a possible pinch (#796): what it landed on decides
    // whether the second finger pinches the Element or pans the view.
    if (event.pointerType === "touch" && fingers.length === 1) {
      pinchCandidate = pinchElement(event);
    } else {
      pinchCandidate = null;
    }
    // The Hand pans with the primary button or one finger, and never picks or
    // draws. A second finger then hands the pan to the pair, as above.
    if (scene.tool === "hand") {
      beginPan(event, [event.pointerId]);
      return;
    }

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
    // point, and Text a Map Label: the Frame knows neither, so both tools only
    // report where one landed, and the Worker's own tool decides which.
    if (scene.tool === "insert" || scene.tool === "text") {
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
    if (moveDrag !== null || bendDrag !== null || transformDrag !== null) return;
    // A press on the bend handle shapes the curve (#751) and never picks or
    // moves the label it belongs to, so a bend drag posts no move. It goes
    // before the transform handles, so a press where a Map Label's bend handle
    // meets a grip still bends (#796).
    if (startBend(event)) return;
    // A press on a transform handle belongs to the handle (#795): it never
    // picks the Element under it nor moves it, so a grip press posts nothing.
    if (startTransform(event)) return;
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
   * Zooms around the pointer on a Ctrl or Cmd wheel (#777), which is the wheel a
   * trackpad reports a pinch as. A plain wheel keeps its behavior: the Frame
   * never keeps it from the document.
   * @param {WheelEvent} event
   */
  function onWheel(event) {
    if (scene === null) return;
    if (!event.ctrlKey && !event.metaKey) return;
    // A wheel that counts lines rather than pixels stands for this many each.
    const delta = event.deltaMode === 1 ? event.deltaY * WHEEL_LINE_PX : event.deltaY;
    const zoom = Math.exp(-delta * WHEEL_ZOOM_RATE);
    if (!isNumber(zoom) || zoom === 1) return;
    const point = pagePoint(event);
    if (point === null) return;
    event.preventDefault();
    // A zoom mid-pan zooms around a point of the slid view, so the Worker hears
    // of the slide first.
    commitPan();
    post({
      kind: "zoom",
      point,
      factor: Math.min(MAX_WHEEL_FACTOR, Math.max(1 / MAX_WHEEL_FACTOR, zoom)),
    });
  }

  /**
   * A double click finishes an open Pen line: its second click already landed
   * a duplicate point on the first, so that copy goes before the line ends.
   * With the Select tool, a double click on a shown, unlocked Map Label asks
   * the Worker to put the caret in its Text field (#800).
   * @param {MouseEvent} event
   */
  function onDoubleClick(event) {
    if (scene !== null && scene.tool === "select") {
      // The press's pointer capture retargets a double click to the <svg>, so
      // the point says what was under the pointer; a straight label's bend
      // handle sits on its midpoint and stands for its label.
      const ownerOf = (node) =>
        node instanceof Element ? node.closest("[data-element-id], [data-bend-handle]") : null;
      const hit =
        typeof document.elementFromPoint === "function"
          ? document.elementFromPoint(event.clientX, event.clientY)
          : null;
      const owner = ownerOf(hit) ?? ownerOf(event.target);
      const id =
        owner === null
          ? null
          : (owner.getAttribute("data-element-id") ?? owner.getAttribute("data-bend-handle"));
      const element =
        id === null ? undefined : scene.elements.find((candidate) => candidate.id === id);
      if (
        element !== undefined &&
        element.label !== undefined &&
        !element.locked &&
        !element.hidden
      ) {
        event.preventDefault();
        post({ kind: "editLabel", id: element.id });
      }
      return;
    }
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
    if (pointerClients.has(event.pointerId)) {
      pointerClients.set(event.pointerId, {
        clientX: event.clientX,
        clientY: event.clientY,
        touch: event.pointerType === "touch",
      });
    }

    if (panDrag !== null && panDrag.pointers.includes(event.pointerId)) {
      followPan(event);
      return;
    }

    if (pinchDrag !== null && pinchDrag.pointers.includes(event.pointerId)) {
      followPinch(event);
      return;
    }

    if (bendDrag !== null && event.pointerId === bendDrag.pointerId) {
      followBend(event);
      return;
    }

    if (transformDrag !== null && event.pointerId === transformDrag.pointerId) {
      followTransform(event);
      return;
    }

    if (moveDrag !== null && event.pointerId === moveDrag.pointerId) {
      followDrag(event);
      return;
    }

    // A grip under the pointer fills and grows (#795), so the author sees the
    // one a press would take. A gesture in progress already grips its own.
    if (scene !== null && scene.tool === "select") setHoverGrip(hoveredGrip(event));

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
    // Space turns the pointer into a pan (#777), whatever tool is active: the
    // Frame keeps the key, so the host never acts on it and the tool the
    // author was drawing with is the one that comes back.
    if (event.key === " ") {
      spacePan = true;
      event.preventDefault();
      return;
    }
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
    // Escape cancels a transform handle drag (#795), putting the Element and
    // its box back where the scene had them.
    if (event.key === "Escape" && transformDrag !== null) {
      event.preventDefault();
      cancelTransform();
      return;
    }
    // Escape cancels a pinch (#796) the same way: the Element goes back and
    // the Worker never hears of it.
    if (event.key === "Escape" && pinchDrag !== null) {
      event.preventDefault();
      cancelPinch();
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
    // Lifting Space stops the pan and gives the active tool back (#777).
    if (event.key === " ") {
      spacePan = false;
      endPan(null);
    }
  }

  /**
   * Registers the author's PDF Font the Worker sends (#751) as a FontFace, so a
   * Map Label set to `pdf` draws in the face an export embeds. Where the engine
   * has no FontFace, or refuses the bytes, the label keeps its serif fallback.
   * @param {unknown} data
   * @returns {boolean} whether the message was a font message
   */
  function registerFont(data) {
    if (typeof data !== "object" || data === null) return false;
    const message = /** @type {Record<string, unknown>} */ (data);
    if (message.kind !== "font") return false;
    if (typeof message.family !== "string" || message.family === "") return true;
    const bytes = message.bytes;
    if (!(bytes instanceof ArrayBuffer)) return true;
    if (typeof FontFace !== "function" || document.fonts === undefined) return true;
    try {
      document.fonts.add(new FontFace(message.family, bytes));
    } catch {
      // A face the engine will not take leaves the text in the fallback serif.
    }
    return true;
  }

  /**
   * Loads one image, so a rasterize request can wait for the SVG to draw.
   * @param {string} url
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("the SVG could not be loaded"));
      image.src = url;
    });
  }

  /**
   * Encodes one canvas as a Blob, so the picture crosses the port as bytes.
   * @param {HTMLCanvasElement} canvas
   * @param {string} mime
   * @param {number} [quality]
   * @returns {Promise<Blob>}
   */
  function canvasBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob === null ? reject(new Error("the canvas encoded nothing")) : resolve(blob)),
        mime,
        quality
      );
    });
  }

  /**
   * One `<image>` still naming the picture it draws, as `sceneToSvg` writes it
   * in the drawn markup and in the `<defs>` a Custom Fill's texture pattern
   * lives in, rather than holding its bytes.
   * @type {RegExp}
   */
  const ASSET_IMAGE_TAG = /<image\b[^>]*?\bhref="asset:([^"]*)"[^>]*?\/>/g;

  /**
   * The markup with each picture placeholder pointing at the URL `hrefOf`
   * answers for its asset id (#756). A picture the Frame holds no bytes for
   * loses its whole `<image>`, so it leaves no broken box. The live canvas and
   * the raster trail ask for different URLs, so one swap serves both.
   * @param {string} markup
   * @param {(id: string) => string | undefined} hrefOf
   * @returns {string}
   */
  function withAssetHrefs(markup, hrefOf) {
    return markup.replace(ASSET_IMAGE_TAG, (tag, id) => {
      const href = hrefOf(id);
      return href === undefined ? "" : tag.replace(`href="asset:${id}"`, `href="${href}"`);
    });
  }

  /** The `blob:` URL the live canvas draws one picture with, or undefined. @param {string} id */
  function liveUrl(id) {
    const source = assetSources.get(id);
    return source === undefined ? undefined : source.url;
  }

  /**
   * The `data:` URI the rasterize path draws one picture with, or undefined: an
   * SVG drawn as an image loads no external subresource, so its pictures have
   * to travel inside it as base64, the way its fonts do.
   * @param {string} id
   */
  function rasterUrl(id) {
    const source = assetSources.get(id);
    return source === undefined ? undefined : source.dataUri;
  }

  /**
   * Draws one export SVG into a canvas of the requested pixel size and encodes
   * it (#753). The SVG carries its fonts and its pictures as data URIs and names
   * nothing by an external URL, so nothing here reaches the network; a JPEG gets
   * white paper behind it, since it has no alpha.
   * @param {FrameRasterizeMessage} request
   * @returns {Promise<ArrayBuffer>}
   */
  async function rasterize(request) {
    const canvas = document.createElement("canvas");
    canvas.width = request.widthPx;
    canvas.height = request.heightPx;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("this Frame cannot draw a canvas");
    const svg = withAssetHrefs(request.svg, rasterUrl);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = await loadImage(url);
      if (request.format !== "png") {
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const quality = request.format === "png" ? undefined : request.format.jpeg;
      const blob = await canvasBlob(
        canvas,
        request.format === "png" ? "image/png" : "image/jpeg",
        quality
      );
      return await blob.arrayBuffer();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Answers one rasterize request: the encoded bytes, or an error when the
   * engine refuses the canvas or the image. The bytes are transferred, not
   * copied, so a 3600 px picture costs one buffer.
   * @param {FrameRasterizeMessage} request
   */
  async function answerRasterize(request) {
    try {
      const bytes = await rasterize(request);
      post({ kind: "rasterized", requestId: request.requestId, bytes }, [bytes]);
    } catch {
      post({
        kind: "rasterized",
        requestId: request.requestId,
        error: "the SVG could not be drawn",
      });
    }
  }

  /** Decodes base64 into the bytes it carries. @param {string} data @returns {Uint8Array} */
  function decodeBase64(data) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  /** Encodes bytes as the base64 the Library stores. @param {Uint8Array} bytes @returns {string} */
  function encodeBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }

  /**
   * A length a picture's `width` or `height` names, in pixels, or null when it
   * names a percentage, a physical unit, or nothing this Frame can measure.
   * @param {string | null} value
   * @returns {number | null}
   */
  function readLength(value) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/.exec(value ?? "");
    if (match === null) return null;
    const length = Number(match[1]);
    return length > 0 ? length : null;
  }

  /**
   * The size one sanitized SVG asks for, in pixels: its `viewBox`, which is the
   * picture's own coordinate space and what a scene scales from, else the
   * `width` and `height` it declares, else the fallback size.
   * @param {string} markup
   * @returns {{ width: number, height: number }}
   */
  function svgSize(markup) {
    const fallback = { width: DEFAULT_ASSET_SIZE, height: DEFAULT_ASSET_SIZE };
    const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
    if (root === null) return fallback;
    const box = (root.getAttribute("viewBox") ?? "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      box.length === 4 &&
      box.every((value) => Number.isFinite(value)) &&
      box[2] > 0 &&
      box[3] > 0
    ) {
      return { width: box[2], height: box[3] };
    }
    const width = readLength(root.getAttribute("width"));
    const height = readLength(root.getAttribute("height"));
    if (width === null || height === null) return fallback;
    return { width, height };
  }

  /**
   * Sanitizes one uploaded SVG and measures it (#756). The Library keeps the
   * cleaned markup, never the file the Worker was handed, and `recolorable`
   * says whether its paints are a single colour.
   * @param {string} data base64
   * @returns {{ data: string, width: number, height: number, recolorable: boolean }}
   */
  function ingestSvg(data) {
    const ingest = /** @type {any} */ (window).maibukSvgIngest;
    const text = new TextDecoder().decode(decodeBase64(data));
    const clean = ingest.sanitizeSvg(text, /** @type {any} */ (window).DOMPurify);
    if (clean === null) throw new Error("the SVG is not a picture");
    const size = svgSize(clean.svg);
    return {
      data: encodeBase64(new TextEncoder().encode(clean.svg)),
      width: size.width,
      height: size.height,
      recolorable: clean.recolorable,
    };
  }

  /**
   * Measures one uploaded raster (#756), in the Frame because only its document
   * can decode a picture. A picture's paints are pixels, so it is never
   * recolorable.
   * @param {string} data base64
   * @param {string} mime
   * @returns {Promise<{ data: string, width: number, height: number, recolorable: false }>}
   */
  async function ingestRaster(data, mime) {
    if (typeof createImageBitmap !== "function") {
      throw new Error("this Frame cannot decode a picture");
    }
    const bitmap = await createImageBitmap(new Blob([decodeBase64(data)], { type: mime }));
    try {
      return { data, width: bitmap.width, height: bitmap.height, recolorable: false };
    } finally {
      bitmap.close();
    }
  }

  /**
   * Answers one asset ingest request (#756): what the Library keeps and how big
   * it is, or the one reason an upload was refused. The Worker never sees the
   * uploaded bytes again, so nothing here trusts them.
   * @param {IngestAssetMessage} request
   */
  async function answerIngest(request) {
    try {
      const result =
        request.mime === "image/svg+xml"
          ? ingestSvg(request.data)
          : await ingestRaster(request.data, request.mime);
      post({ kind: "asset-ingested", requestId: request.requestId, ...result });
    } catch {
      post({ kind: "ingest-error", requestId: request.requestId, reason: "invalid-image" });
    }
  }

  /**
   * Keeps one uploaded picture's bytes under the URLs this document draws them
   * with (#756), keyed by asset id: the `blob:` URL the live canvas paints and
   * the `data:` URI a rasterize request carries. A picture the Worker sends
   * again replaces them, revoking the URL it had so its buffer is freed.
   * @param {unknown} data
   * @returns {boolean} whether the message was an asset message
   */
  function keepAsset(data) {
    if (typeof data !== "object" || data === null) return false;
    const message = /** @type {Record<string, unknown>} */ (data);
    if (message.kind !== "asset") return false;
    if (typeof message.id !== "string" || message.id === "") return true;
    if (typeof message.mime !== "string" || message.mime === "") return true;
    if (typeof message.data !== "string" || message.data === "") return true;
    const url = URL.createObjectURL(new Blob([decodeBase64(message.data)], { type: message.mime }));
    const previous = assetSources.get(message.id);
    if (previous !== undefined) URL.revokeObjectURL(previous.url);
    assetSources.set(message.id, {
      url,
      dataUri: `data:${message.mime};base64,${message.data}`,
    });
    return true;
  }

  /** @param {MessageEvent} event */
  function onMessage(event) {
    if (registerFont(event.data)) return;
    if (keepAsset(event.data)) {
      // The Worker sends the scene first and a picture's bytes after the Library
      // read that holds them (#756), so kept bytes repaint the picture they
      // belong to: an upload must not wait for the next pan, select, or edit to
      // appear. A Frame with no scene yet has nothing to draw.
      if (scene !== null) draw();
      return;
    }
    const ingestRequest = readIngestAsset(event.data);
    if (ingestRequest !== null) {
      void answerIngest(ingestRequest);
      return;
    }
    const rasterizeRequest = readRasterize(event.data);
    if (rasterizeRequest !== null) {
      void answerRasterize(rasterizeRequest);
      return;
    }
    const next = readScene(event.data);
    if (next === null) return;
    const previousTool = scene === null ? null : scene.tool;
    // A scene whose pan moved is the Worker's answer to the oldest unanswered
    // pan, which its own pan now carries.
    if (
      scene !== null &&
      unansweredPans.length > 0 &&
      (next.panX !== scene.panX || next.panY !== scene.panY)
    ) {
      unansweredPans.shift();
    }
    scene = next;
    // Any scene after a release draws the moved Element where the Worker put
    // it, or back at its start when the Worker refused the move, and the
    // bent label by the bend the Worker kept, and a transformed Element by the
    // box the Worker kept (#795).
    pendingMove = null;
    pendingBend = null;
    pendingTransform = null;
    pendingLabelText = null;
    if (next.tool !== previousTool) resetGestures();
    // A label locked, hidden, or undone away while written loses its box.
    if (labelEdit !== null) {
      const editing = labelEdit.id;
      const still = next.elements.find((element) => element.id === editing);
      if (still === undefined || still.label === undefined || still.locked || still.hidden) {
        closeLabelEditor();
      }
    }
    // An Element locked, deleted, or undone away mid-drag stops moving.
    if (moveDrag !== null) {
      const dragged = moveDrag.id;
      if (!next.elements.some((element) => element.id === dragged && element.movable)) {
        cancelMove();
        return;
      }
    }
    // A label locked, hidden, or undone away mid-drag stops bending.
    if (bendDrag !== null) {
      const bent = bendDrag.id;
      const bentBy = next.elements.find((element) => element.id === bent);
      if (bentBy === undefined || bentBy.label === undefined || bentBy.locked || bentBy.hidden) {
        cancelBend();
        return;
      }
    }
    // An Element locked, hidden, or undone away mid-drag stops transforming.
    if (transformDrag !== null) {
      const dragged = transformDrag.id;
      const still = next.elements.find((element) => element.id === dragged);
      if (still === undefined || still.transform === undefined || still.locked || still.hidden) {
        cancelTransform();
        return;
      }
    }
    // A pinched Element locked, hidden, or undone away mid-gesture stops too.
    if (pinchDrag !== null) {
      const pinched = pinchDrag.id;
      const still = next.elements.find((element) => element.id === pinched);
      if (still === undefined || still.transform === undefined || still.locked || still.hidden) {
        cancelPinch();
        return;
      }
    }
    syncCrosshair();
    draw();
    // A Text tool click or a Select double click opens the label's text box.
    if (next.editLabel !== undefined) openLabelEditor(next.editLabel);
  }

  function cleanup() {
    closeLabelEditor();
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    for (const source of assetSources.values()) URL.revokeObjectURL(source.url);
    assetSources.clear();
    // A press that slid off the surface is forgotten by its window event, not
    // by the surface's, so that listener goes whatever the surface is.
    window.removeEventListener("pointerup", forgetPointer);
    window.removeEventListener("pointercancel", forgetPointer);
    if (surface === null) return;
    surface.removeEventListener("pointerdown", onPointerDown);
    surface.removeEventListener("pointermove", onPointerMove);
    surface.removeEventListener("pointerup", onPointerUp);
    surface.removeEventListener("pointerleave", onPointerLeave);
    surface.removeEventListener("pointercancel", onPointerCancel);
    surface.removeEventListener("lostpointercapture", onLostPointerCapture);
    surface.removeEventListener("dblclick", onDoubleClick);
    surface.removeEventListener("wheel", onWheel);
  }

  /**
   * A pointer that leaves the Frame (#795) rests on no grip: the surface hears
   * no further moves, so the grip it left would otherwise keep growing.
   */
  function onPointerLeave() {
    setHoverGrip(null);
  }

  /** @param {PointerEvent} event */
  function onPointerUp(event) {
    endPan(event);
    pointerClients.delete(event.pointerId);
    if (pinchCandidate !== null && pinchCandidate.pointerId === event.pointerId) {
      pinchCandidate = null;
    }
    endStroke(event, true);
    endErase(event, true);
    endShape(event, true);
    endMove(event, true);
    endBend(event, true);
    endTransform(event, true);
    endPinch(event, true);
  }

  /** @param {PointerEvent} event */
  function onPointerCancel(event) {
    endPan(event);
    pointerClients.delete(event.pointerId);
    if (pinchCandidate !== null && pinchCandidate.pointerId === event.pointerId) {
      pinchCandidate = null;
    }
    endStroke(event, false);
    endErase(event, false);
    endShape(event, false);
    endMove(event, false);
    endBend(event, false);
    endTransform(event, false);
    endPinch(event, false);
  }

  /**
   * The engine took a Select drag's, a bend drag's, a transform drag's, or a
   * pan's capture away with no pointerup (#766, #751, #795, #777): the gesture
   * is dropped like a cancel, so the next press is not ignored as a second
   * finger. After a pointerup the gesture is already over and this is a no-op.
   * @param {PointerEvent} event
   */
  function onLostPointerCapture(event) {
    pointerClients.delete(event.pointerId);
    endMove(event, false);
    endBend(event, false);
    endTransform(event, false);
    endPinch(event, false);
    endPan(event);
  }

  /**
   * A pointer that lifts or is cancelled anywhere in the Frame is no longer
   * down, even where the surface never hears it: a Bucket, Insert, Text, or Pen press
   * takes no capture, so a finger that slid off the drawing before it lifted
   * would stay counted and turn the next single-finger press into a pan (#777).
   * The surface's own handlers already forget it; deleting twice is harmless.
   * @param {PointerEvent} event
   */
  function forgetPointer(event) {
    // A finger that lifts off the surface ends its pinch there: the surface
    // never hears the release, so the gesture would otherwise never finish.
    if (pinchDrag !== null && pinchDrag.pointers.includes(event.pointerId)) {
      endPinch(event, true);
    }
    pointerClients.delete(event.pointerId);
  }

  draw();

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  if (surface !== null) {
    surface.addEventListener("pointerdown", onPointerDown);
    surface.addEventListener("pointermove", onPointerMove);
    surface.addEventListener("pointerup", onPointerUp);
    surface.addEventListener("pointerleave", onPointerLeave);
    surface.addEventListener("pointercancel", onPointerCancel);
    surface.addEventListener("lostpointercapture", onLostPointerCapture);
    surface.addEventListener("dblclick", onDoubleClick);
    // A pinch arrives as a Ctrl wheel, which the page must not also zoom with,
    // so the listener is not passive (#777).
    surface.addEventListener("wheel", onWheel, { passive: false });
  }

  // A finger that lifts off the surface sends its pointerup to the window
  // alone, so the Frame forgets the pointer here (#777). The bubble phase
  // reaches the window last, after the surface's own handlers ended the press.
  window.addEventListener("pointerup", forgetPointer);
  window.addEventListener("pointercancel", forgetPointer);

  if (port !== null) {
    port.onmessage = onMessage;
    port.start();
  }

  if (hooks && typeof hooks.onReady === "function") hooks.onReady(cleanup);
  // The Frame's handle maths is a mirror of `geometry.ts`, and a test holds the
  // two copies to the same results through this seam (#795).
  if (hooks && typeof hooks.onTransformBox === "function") {
    hooks.onTransformBox(transformBox);
  }
  // A test document may have no canvas, so the rasterize answer is out of reach:
  // this seam hands it the SVG the Frame would draw instead, which is the one
  // fact a test can assert about an export.
  if (hooks && typeof hooks.onAssetSvg === "function") {
    hooks.onAssetSvg((svg) => withAssetHrefs(svg, rasterUrl));
  }
})();
