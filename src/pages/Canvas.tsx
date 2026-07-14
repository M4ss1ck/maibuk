import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type OnSelectionChangeParams,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Network, Redo2, Trash2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { maibukArt } from "@/assets/ascii/maibuk";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useBookStore } from "@/features/books/store";
import { CanvasToolPanel } from "@/features/canvas/CanvasToolPanel";
import { EdgeInspectorCard } from "@/features/canvas/EdgeInspectorCard";
import { NodeColorPanel } from "@/features/canvas/NodeColorPanel";
import { PenSettingsPanel } from "@/features/canvas/PenSettingsPanel";
import { CanvasDrawingLayer } from "@/features/canvas/drawing/CanvasDrawingLayer";
import { DrawingCaptureOverlay } from "@/features/canvas/drawing/DrawingCaptureOverlay";
import { nodeTypes } from "@/features/canvas/nodes";
import { fromConnection, toFlowEdges, toFlowNodes } from "@/features/canvas/reactFlowAdapter";
import { useCanvasStore } from "@/features/canvas/store";
import type { CanvasDoc } from "@/features/canvas/types";
import { useNoteStore } from "@/features/notes";
import { useThemeStore } from "@/features/theme";
import { useShortcuts } from "@/lib/shortcuts";

const AUTOSAVE_DELAY = 800;

function canPersist(state: ReturnType<typeof useCanvasStore.getState>): boolean {
  return Boolean(
    state.current?.id &&
      state.dirty &&
      state.revision > state.savedRevision &&
      !state.docWriteBlocked &&
      !state.editorReadOnly &&
      !state.docLoadError &&
      !state.corruptDocReplacementAllowed
  );
}

function hasMeaningfulViewport(doc: CanvasDoc): boolean {
  return doc.viewport.x !== 0 || doc.viewport.y !== 0 || doc.viewport.zoom !== 1;
}

// One faint MAIBUK figlet per "page", tiled in canvas coordinates so it pans
// and zooms with the surface — giving a sense of scale, like graph paper.
const FIGLET_LINES = maibukArt
  .replace(/\r\n/g, "\n")
  .split("\n")
  .filter((line) => line.trim().length > 0);
const FIGLET_COLS = Math.max(...FIGLET_LINES.map((line) => line.length));
const MONO_ASPECT = 0.6; // monospace glyph advance ÷ font size
const CANVAS_PAGE_SIZE = 1200;
const TILE_INSET = 0.1;

function CanvasBackground() {
  const [translateX, translateY, zoom] = useStore((state) => state.transform);
  const tileWidth = CANVAS_PAGE_SIZE * zoom;
  const pad = tileWidth * TILE_INSET;
  const available = tileWidth - pad * 2;
  const fontSize = available / (FIGLET_COLS * MONO_ASPECT);
  const blockHeight = FIGLET_LINES.length * fontSize;
  // Hug the figlet vertically (even padding all around) so stacked tiles don't
  // leave a tall empty gap the way a square tile would.
  const tileHeight = blockHeight + pad * 2;
  const patternId = "maibuk-canvas-pattern";
  return (
    <svg
      aria-hidden="true"
      className="react-flow__background text-foreground"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "transparent",
        opacity: 0.02,
      }}
    >
      <pattern
        id={patternId}
        x={translateX % tileWidth}
        y={translateY % tileHeight}
        width={tileWidth}
        height={tileHeight}
        patternUnits="userSpaceOnUse"
      >
        <text
          x={pad}
          y={pad}
          fill="currentColor"
          xmlSpace="preserve"
          dominantBaseline="hanging"
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, monospace",
            fontSize,
            whiteSpace: "pre",
          }}
        >
          {FIGLET_LINES.map((line, index) => (
            <tspan key={`figlet-line-${index}`} x={pad} dy={index === 0 ? 0 : fontSize}>
              {line}
            </tspan>
          ))}
        </text>
      </pattern>
      <rect x="0" y="0" width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

function CanvasEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canvasId = "" } = useParams();
  const reactFlow = useReactFlow();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = useCanvasStore((state) => state.current);
  const doc = useCanvasStore((state) => state.doc);
  const loadState = useCanvasStore((state) => state.loadState);
  const saveState = useCanvasStore((state) => state.saveState);
  const docLoadError = useCanvasStore((state) => state.docLoadError);
  const docWriteBlocked = useCanvasStore((state) => state.docWriteBlocked);
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const corruptDocReplacementAllowed = useCanvasStore(
    (state) => state.corruptDocReplacementAllowed
  );
  const dirty = useCanvasStore((state) => state.dirty);
  const revision = useCanvasStore((state) => state.revision);
  const savedRevision = useCanvasStore((state) => state.savedRevision);
  const past = useCanvasStore((state) => state.past);
  const future = useCanvasStore((state) => state.future);
  const selectedNodeId = useCanvasStore((state) => state.selectedNodeId);
  const selectedEdgeId = useCanvasStore((state) => state.selectedEdgeId);
  const toolMode = useCanvasStore((state) => state.toolMode);
  const setToolMode = useCanvasStore((state) => state.setToolMode);
  const interactivityLocked = useCanvasStore((state) => state.interactivityLocked);
  const toggleInteractivityLocked = useCanvasStore((state) => state.toggleInteractivityLocked);
  const loadCanvas = useCanvasStore((state) => state.loadCanvas);
  const closeCanvas = useCanvasStore((state) => state.closeCanvas);
  const persistCanvas = useCanvasStore((state) => state.persistCanvas);
  const replaceCorruptDocWithDefault = useCanvasStore(
    (state) => state.replaceCorruptDocWithDefault
  );
  const addNode = useCanvasStore((state) => state.addNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const updateEdge = useCanvasStore((state) => state.updateEdge);
  const moveNodeLive = useCanvasStore((state) => state.moveNodeLive);
  const beginLiveChange = useCanvasStore((state) => state.beginLiveChange);
  const endLiveChange = useCanvasStore((state) => state.endLiveChange);
  const selectNode = useCanvasStore((state) => state.selectNode);
  const selectEdge = useCanvasStore((state) => state.selectEdge);
  const clearSelection = useCanvasStore((state) => state.clearSelection);
  const deleteSelection = useCanvasStore((state) => state.deleteSelection);
  const setViewport = useCanvasStore((state) => state.setViewport);
  const undo = useCanvasStore((state) => state.undo);
  const redo = useCanvasStore((state) => state.redo);
  const renameCanvas = useCanvasStore((state) => state.renameCanvas);
  const notes = useNoteStore((state) => state.notes);
  const loadNotes = useNoteStore((state) => state.loadNotes);
  const loadBooks = useBookStore((state) => state.loadBooks);
  const theme = useThemeStore((state) => state.theme);
  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [noteQuery, setNoteQuery] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [edgeLabelDraft, setEdgeLabelDraft] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    void loadCanvas(canvasId);
    void loadNotes();
    void loadBooks();
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      const state = useCanvasStore.getState();
      if (state.current?.id === canvasId && canPersist(state)) {
        const snapshotId = state.current.id;
        void state
          .persistCanvas(snapshotId, structuredClone(state.doc), state.revision)
          .finally(() => {
            if (useCanvasStore.getState().current?.id === snapshotId) closeCanvas();
          });
      } else if (state.current?.id === canvasId) {
        closeCanvas();
      }
    };
  }, [canvasId, closeCanvas, loadBooks, loadCanvas, loadNotes]);

  useEffect(() => {
    setTitleDraft(current?.title ?? "");
  }, [current?.id, current?.title]);

  const selectedEdge = doc.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const selectedNode = doc.nodes.find((node) => node.id === selectedNodeId) ?? null;

  useEffect(() => {
    setEdgeLabelDraft(selectedEdge?.label ?? "");
  }, [selectedEdge?.id, selectedEdge?.label]);

  useEffect(() => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (
      !current ||
      !dirty ||
      revision <= savedRevision ||
      docWriteBlocked ||
      editorReadOnly ||
      docLoadError ||
      corruptDocReplacementAllowed
    ) {
      return;
    }
    const snapshot = { canvasId: current.id, doc: structuredClone(doc), revision };
    autosaveTimer.current = setTimeout(() => {
      void persistCanvas(snapshot.canvasId, snapshot.doc, snapshot.revision);
    }, AUTOSAVE_DELAY);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [
    corruptDocReplacementAllowed,
    current,
    dirty,
    doc,
    docLoadError,
    docWriteBlocked,
    editorReadOnly,
    persistCanvas,
    revision,
    savedRevision,
  ]);

  const flowNodes = useMemo(
    () =>
      toFlowNodes(doc.nodes, {
        selectedNodeId,
        canvasId,
        canvasTitle: current?.title ?? "",
        edges: doc.edges,
      }),
    [canvasId, current?.title, doc.nodes, doc.edges, selectedNodeId]
  );
  const flowEdges = useMemo(
    () => toFlowEdges(doc.edges, { selectedEdgeId }),
    [doc.edges, selectedEdgeId]
  );

  const viewportCenter = useCallback(() => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return reactFlow.screenToFlowPosition({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
  }, [reactFlow]);

  const handleAddTextNode = () => {
    addNode({
      id: crypto.randomUUID(),
      kind: "text",
      html: `<p>${t("canvas.newTextNode")}</p>`,
      position: viewportCenter(),
    });
  };

  const handleConnect = useCallback(
    (connection: Connection) => {
      const edge = fromConnection(connection);
      if (edge) addEdge(edge);
    },
    [addEdge]
  );

  const handleConnectStart = useCallback(() => setConnecting(true), []);
  const handleConnectEnd = useCallback(() => setConnecting(false), []);

  const handleNodeChanges = useCallback(
    (changes: NodeChange[]) => {
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          moveNodeLive(change.id, change.position);
        }
      }
    },
    [moveNodeLive]
  );

  const handleNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      if (interactivityLocked) return;
      selectNode(node.id);
    },
    [interactivityLocked, selectNode]
  );

  const handleEdgeClick = useCallback(
    (event: ReactMouseEvent<Element>, edge: Edge) => {
      if (interactivityLocked) return;
      event.stopPropagation();
      selectEdge(edge.id);
    },
    [interactivityLocked, selectEdge]
  );

  const handlePaneClick = useCallback(() => {
    if (interactivityLocked) return;
    clearSelection();
  }, [interactivityLocked, clearSelection]);

  const handleSelectionChange = useCallback(
    ({ nodes }: OnSelectionChangeParams) => {
      if (interactivityLocked) return;
      if (nodes[0]) selectNode(nodes[0].id);
    },
    [interactivityLocked, selectNode]
  );

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      setViewport(viewport);
    },
    [setViewport]
  );

  const noopEdgesChange = useCallback(() => undefined, []);

  useShortcuts(
    [
      { keys: ["ctrl+z", "meta+z"], onTrigger: undo },
      { keys: ["ctrl+shift+z", "meta+shift+z"], onTrigger: redo },
      { keys: ["delete", "backspace"], onTrigger: deleteSelection },
      { keys: "escape", onTrigger: clearSelection },
      { keys: "alt+arrowleft", onTrigger: () => navigate("/canvas") },
      { keys: "v", onTrigger: () => setToolMode("select") },
      { keys: "p", onTrigger: () => setToolMode("pen") },
      { keys: "e", onTrigger: () => setToolMode("eraser") },
      { keys: "t", onTrigger: handleAddTextNode },
      { keys: "n", onTrigger: () => setNotePickerOpen(true) },
      { keys: ["ctrl+=", "meta+=", "ctrl++", "meta++"], onTrigger: () => reactFlow.zoomIn() },
      { keys: ["ctrl+-", "meta+-"], onTrigger: () => reactFlow.zoomOut() },
      { keys: ["shift+1", "shift+!"], onTrigger: () => reactFlow.fitView() },
      { keys: "l", onTrigger: toggleInteractivityLocked },
    ],
    { enabled: loadState === "ready" && !editorReadOnly }
  );

  if (loadState === "loading" || loadState === "idle") {
    return <div className="flex h-dvh items-center justify-center">{t("canvas.loading")}</div>;
  }

  if (loadState === "missing") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <p>{t("canvas.missingCanvas")}</p>
        <Button onClick={() => navigate("/canvas")}>{t("canvas.backToCanvasGallery")}</Button>
      </div>
    );
  }

  if (docLoadError) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-6">
        <div className="max-w-lg rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <Network className="mx-auto mb-4 size-10 text-destructive" aria-hidden="true" />
          <h1 className="text-xl font-semibold">{t("canvas.corruptDocTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("canvas.corruptDocDescription")}</p>
          <div className="mt-6 flex justify-center gap-3">
            <Button variant="secondary" onClick={() => navigate("/canvas")}>
              {t("canvas.backToCanvasGallery")}
            </Button>
            <Button variant="destructive" onClick={() => void replaceCorruptDocWithDefault()}>
              {t("canvas.replaceWithEmptyCanvas")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const saveLabel =
    saveState === "saving"
      ? t("canvas.saving")
      : saveState === "error"
        ? t("canvas.saveError")
        : dirty
          ? t("canvas.unsaved")
          : t("canvas.saved");

  const filteredNotes = notes
    .filter((note) => note.title.toLocaleLowerCase().includes(noteQuery.trim().toLocaleLowerCase()))
    .sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <h1 data-route-heading className="sr-only">
        {current?.title || t("canvas.title")}
      </h1>
      <header className="z-10 flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/canvas")}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t("canvas.backToCanvasGallery")}
        </Button>
        <input
          aria-label={t("canvas.renameCanvas")}
          className="min-w-32 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 font-semibold outline-none focus:border-primary"
          value={titleDraft}
          placeholder={t("canvas.untitled")}
          onChange={(event) => setTitleDraft(event.target.value)}
          onBlur={() =>
            current && titleDraft !== current.title && void renameCanvas(current.id, titleDraft)
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setTitleDraft(current?.title ?? "");
              event.currentTarget.blur();
            }
          }}
        />
        <span className="ml-auto min-w-28 text-right text-xs text-muted-foreground" role="status">
          {saveLabel}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={past.length === 0}
          onClick={undo}
          aria-label={t("canvas.undo")}
        >
          <Undo2 className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={future.length === 0}
          onClick={redo}
          aria-label={t("canvas.redo")}
        >
          <Redo2 className="size-4" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!selectedNodeId && !selectedEdgeId}
          onClick={deleteSelection}
          aria-label={t("canvas.deleteSelection")}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      </header>

      <main ref={surfaceRef} className="relative min-h-0 flex-1">
        <ReactFlow
          colorMode={theme}
          className={connecting ? "canvas-connecting" : undefined}
          style={{ backgroundColor: "transparent" }}
          nodes={flowNodes as Node[]}
          edges={flowEdges as Edge[]}
          nodeTypes={nodeTypes}
          connectionMode={ConnectionMode.Loose}
          onNodesChange={handleNodeChanges}
          onEdgesChange={noopEdgesChange}
          onSelectionChange={handleSelectionChange}
          onNodeClick={handleNodeClick}
          onEdgeClick={handleEdgeClick}
          onPaneClick={handlePaneClick}
          onConnect={handleConnect}
          onConnectStart={handleConnectStart}
          onConnectEnd={handleConnectEnd}
          onNodeDragStart={beginLiveChange}
          onNodeDragStop={endLiveChange}
          onMoveEnd={handleMoveEnd}
          deleteKeyCode={null}
          panOnDrag={!interactivityLocked && toolMode === "select"}
          nodesDraggable={!interactivityLocked && toolMode === "select"}
          elementsSelectable={!interactivityLocked && toolMode === "select"}
          zoomOnScroll={!interactivityLocked}
          zoomOnPinch={!interactivityLocked}
          zoomOnDoubleClick={!interactivityLocked}
          defaultViewport={doc.viewport}
          fitView={!hasMeaningfulViewport(doc) && doc.nodes.length > 0}
        >
          <CanvasBackground />
          <CanvasDrawingLayer />
        </ReactFlow>
        <DrawingCaptureOverlay surfaceRef={surfaceRef} />
        <div className="absolute right-4 top-4 z-20 flex flex-col items-end gap-2">
          <CanvasToolPanel
            onAddText={handleAddTextNode}
            onAddNoteRef={() => setNotePickerOpen(true)}
            onZoomIn={() => reactFlow.zoomIn()}
            onZoomOut={() => reactFlow.zoomOut()}
            onFitView={() => reactFlow.fitView()}
          />
          {toolMode === "pen" && <PenSettingsPanel />}
          {selectedNode?.kind === "text" && <NodeColorPanel />}
        </div>
        {selectedEdge && (
          <EdgeInspectorCard
            edge={selectedEdge}
            labelDraft={edgeLabelDraft}
            onLabelChange={setEdgeLabelDraft}
            onLabelCommit={() => updateEdge(selectedEdge.id, { label: edgeLabelDraft })}
            onDirectedChange={(directed) => updateEdge(selectedEdge.id, { directed })}
            onDelete={deleteSelection}
          />
        )}
      </main>

      <Modal
        isOpen={notePickerOpen}
        onClose={() => setNotePickerOpen(false)}
        title={t("canvas.addNoteRef")}
      >
        <Input
          autoFocus
          value={noteQuery}
          onChange={(event) => setNoteQuery(event.target.value)}
          placeholder={t("canvas.searchNotesPlaceholder")}
        />
        <div className="mt-4 max-h-80 space-y-2 overflow-auto">
          {filteredNotes.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("canvas.noNotes")}</p>
          ) : (
            filteredNotes.map((note) => (
              <Button
                key={note.id}
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  addNode({
                    id: crypto.randomUUID(),
                    kind: "noteRef",
                    noteId: note.id,
                    label: note.title,
                    position: viewportCenter(),
                  });
                  setNotePickerOpen(false);
                  setNoteQuery("");
                }}
              >
                {note.title || t("notes.untitled")}
              </Button>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasEditor />
    </ReactFlowProvider>
  );
}
