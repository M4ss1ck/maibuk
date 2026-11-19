import { type ComponentType, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { type Node, type NodeProps } from "@xyflow/react";
import { SpinnerIcon } from "@/components/icons";
import { CanvasCardFace } from "@/components/canvas/CanvasCard";
import { BookCardFace } from "@/components/project/BookCard";
import { Button } from "@/components/ui/Button";
import { NoteTagsRow } from "@/components/notes/NoteTagsRow";
import { notePreviewText } from "@/components/notes/notes-list-model";
import { timeAgo } from "@/components/notes/timeAgo";
import { useBookStore } from "@/features/books/store";
import type { Book } from "@/features/books/types";
import type { ChapterReferenceValue } from "@/features/canvas/chapterReferenceSource";
import type { CanvasFlowNodeData } from "@/features/canvas/reactFlowAdapter";
import type { Note } from "@/features/notes";
import {
  CANVAS_REFERENCE_CARD_SIZES,
  CANVAS_REFERENCE_PREVIEW_SIZES,
  type CanvasReferenceCardKind,
  type CanvasReferenceSource,
  canvasReferencePluginName,
  canvasReferenceSourceLabel,
  openCanvasReference,
  useCanvasReferenceResolution,
  useCanvasReferenceSource,
} from "@/features/canvas/references";
import type { Canvas, ReferenceCanvasNode } from "@/features/canvas/types";
import { getKnownCanvasReferencePreview } from "@/features/plugins/contributions-registry";
import { isPluginContributionId } from "@/features/plugins/ids";
import { CanvasNodeHandles } from "@/features/canvas/nodes/CanvasNodeHandles";
import { useCanvasNodeMenu } from "@/features/canvas/nodes/CanvasNodeMenu";
import { useCanvasStore } from "@/features/canvas/store";

type ReferenceFlowNode = Node<CanvasFlowNodeData, "reference">;

interface CanvasReferenceCardBodyProps {
  /** The source's answer; only the card body for its kind knows the shape. */
  value: unknown;
  title: string;
}

/** A Note draws its preview, its Book, and its tags, as its card always has. */
function NoteReferenceCardBody({ value, title }: CanvasReferenceCardBodyProps) {
  const { t, i18n } = useTranslation();
  const books = useBookStore((state) => state.books);
  const note = value as Note;
  const preview = notePreviewText(note.content);
  const bookTitle = note.bookId ? books.find((book) => book.id === note.bookId)?.title : null;
  const dateLabel = timeAgo(note.contentUpdatedAt, i18n?.language ?? "en", t);

  return (
    <>
      <h3 className="line-clamp-2 font-medium text-foreground">{title}</h3>

      {preview && (
        <p className="mt-1 line-clamp-3 min-h-8 text-sm text-muted-foreground">{preview}</p>
      )}

      {bookTitle && (
        <span className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{bookTitle}</span>
        </span>
      )}

      <div className="mt-auto pt-2">
        <NoteTagsRow tags={note.tags} dateLabel={dateLabel} interactiveOverflow={false} />
      </div>
    </>
  );
}

/** A Book draws the Library Book card's face, edge to edge. */
function BookReferenceCardBody({ value }: CanvasReferenceCardBodyProps) {
  return <BookCardFace book={value as Book} fill />;
}

/** A Canvas draws the Gallery Canvas card's face. */
function CanvasReferenceCardBody({ value }: CanvasReferenceCardBodyProps) {
  return <CanvasCardFace canvas={value as Canvas} />;
}

/** A Chapter draws its preview, its Book, and when it was last edited; it has no tags. */
function ChapterReferenceCardBody({ value, title }: CanvasReferenceCardBodyProps) {
  const { t, i18n } = useTranslation();
  const chapter = value as ChapterReferenceValue;
  const preview = chapter.content ? notePreviewText(chapter.content) : "";
  const dateLabel = timeAgo(
    Math.floor(chapter.updatedAt.getTime() / 1000),
    i18n?.language ?? "en",
    t
  );

  return (
    <>
      <h3 className="line-clamp-2 font-medium text-foreground">{title}</h3>

      {preview && (
        <p className="mt-1 line-clamp-3 min-h-8 text-sm text-muted-foreground">{preview}</p>
      )}

      {chapter.bookTitle && (
        <span className="mt-2 inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{chapter.bookTitle}</span>
        </span>
      )}

      <span className="mt-auto pt-2 text-xs text-muted-foreground">{dateLabel}</span>
    </>
  );
}

/** A Generic card draws the Plugin source's title and its one line of subtitle (#836). */
function GenericReferenceCardBody({ value, title }: CanvasReferenceCardBodyProps) {
  const { subtitle } = value as { subtitle?: string };

  return (
    <>
      <h3 className="line-clamp-2 font-medium text-foreground">{title}</h3>

      {subtitle && <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">{subtitle}</p>}
    </>
  );
}

/** What a card kind draws once its source answered: the one place a value is read. */
const CANVAS_REFERENCE_CARD_BODIES: Record<
  CanvasReferenceCardKind,
  ComponentType<CanvasReferenceCardBodyProps>
> = {
  note: NoteReferenceCardBody,
  book: BookReferenceCardBody,
  chapter: ChapterReferenceCardBody,
  canvas: CanvasReferenceCardBody,
  generic: GenericReferenceCardBody,
};

/** A state with nothing to draw beyond its label and, sometimes, one line saying why. */
function ReferenceStateBody({ title, detail }: { title: string; detail?: string }) {
  return (
    <>
      <h3 className="line-clamp-2 font-medium text-foreground">{title}</h3>
      {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
    </>
  );
}

/**
 * The card's image slot (#847): the source's picture edge to edge, or one muted
 * block carrying the source icon, so a card keeps one box either way.
 */
function PreviewImage({
  preview,
  image,
  Icon,
}: {
  preview: "landscape" | "portrait";
  image?: string;
  Icon?: CanvasReferenceSource["icon"];
}) {
  const box = preview === "landscape" ? "h-40 w-full shrink-0" : "min-h-0 w-full flex-1";

  if (image) {
    return (
      <img
        src={image}
        alt=""
        draggable={false}
        data-testid="canvas-reference-image"
        className={`${box} bg-muted ${preview === "landscape" ? "object-contain" : "object-cover"}`}
      />
    );
  }

  return (
    <div
      data-testid="canvas-reference-image-placeholder"
      aria-hidden="true"
      className={`${box} flex items-center justify-center bg-muted`}
    >
      {Icon && <Icon className="size-8 text-muted-foreground" />}
    </div>
  );
}

/** A Generic card names the source it belongs to, above whatever state body it draws. */
function ReferenceSourceHeader({ source }: { source: CanvasReferenceSource }) {
  const { t } = useTranslation();
  const SourceIcon = source.icon;

  return (
    <div className="mb-2 flex min-w-0 items-center gap-1">
      <span aria-hidden="true" className="shrink-0">
        <SourceIcon className="size-4" />
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {canvasReferenceSourceLabel(source, t)}
      </span>
    </div>
  );
}

export function ReferenceNode({ data, selected }: NodeProps<ReferenceFlowNode>) {
  const node = data.node;
  // React Flow only routes a reference here, so the card's hooks run below this.
  if (node.kind !== "reference") return null;
  return <CanvasReferenceCard node={node} data={data} selected={selected ?? false} />;
}

function CanvasReferenceCard({
  node,
  data,
  selected,
}: {
  node: ReferenceCanvasNode;
  data: CanvasFlowNodeData;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The Router keeps this Canvas up until the target's page has rendered, which
  // a dense Canvas drags out. This is the answer to the press in the meantime.
  const [isOpening, setIsOpening] = useState(false);
  const editorReadOnly = useCanvasStore((state) => state.editorReadOnly);
  const interactivityLocked = useCanvasStore((state) => state.interactivityLocked);
  const nodeMenu = useCanvasNodeMenu(node.id, {
    isDisabled: editorReadOnly || interactivityLocked,
  });

  const source = useCanvasReferenceSource(node.source);
  const resolution = useCanvasReferenceResolution(node.source, node.targetId);
  // A Plugin source that declares a preview draws its image; the answer keeps the
  // shape even after the Plugin unregisters, so an Unavailable card holds its box.
  const preview = source
    ? source.preview
    : isPluginContributionId(node.source)
      ? getKnownCanvasReferencePreview(node.source)
      : undefined;
  // A source this app does not know still keeps the box its kind would draw: a
  // Plugin reference is always Generic, anything else borrows the note box.
  const size = preview
    ? CANVAS_REFERENCE_PREVIEW_SIZES[preview]
    : CANVAS_REFERENCE_CARD_SIZES[
        source?.card ?? (isPluginContributionId(node.source) ? "generic" : "note")
      ];
  // The Book card fills its box edge to edge, like the Library Book card.
  const isBookCard = source?.card === "book";
  const storedLabel = node.label || t("canvas.referenceUntitled");
  // An Unavailable reference names the Plugin that owns the source when it is installed here.
  const unavailablePlugin = source ? undefined : canvasReferencePluginName(node.source);
  const unavailableDetail = unavailablePlugin
    ? t("canvas.referenceUnavailablePlugin", { name: unavailablePlugin })
    : t("canvas.referenceUnavailable");
  const CardBody = source ? CANVAS_REFERENCE_CARD_BODIES[source.card] : null;
  const title = resolution?.status === "present" ? resolution.title || storedLabel : storedLabel;
  const canOpen = Boolean(source) && resolution?.status !== "missing";
  // Only a Present answer carries a picture; every other state draws the placeholder.
  const image =
    resolution?.status === "present" ? (resolution.value as { image?: string }).image : undefined;

  return (
    <div
      ref={nodeMenu.anchorRef}
      {...nodeMenu.itemProps}
      style={{ width: size.width, height: size.height }}
      className={`group relative flex flex-col rounded-xl border bg-card text-left text-foreground shadow-sm pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none] ${
        selected ? "border-primary ring-2 ring-primary/20" : "border-border"
      }`}
    >
      <CanvasNodeHandles connectedSides={data.connectedSides} variant="card" selected={selected} />
      {nodeMenu.menu}

      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-xl ${isBookCard || preview ? "" : "p-4 pb-0"}`}
      >
        {source?.card === "generic" && !preview && <ReferenceSourceHeader source={source} />}

        {preview ? (
          <>
            <PreviewImage preview={preview} image={image} Icon={source?.icon} />
            <div className="p-4 pb-0">
              {source && <ReferenceSourceHeader source={source} />}

              {!source ? (
                <ReferenceStateBody title={storedLabel} detail={unavailableDetail} />
              ) : resolution?.status === "missing" ? (
                <ReferenceStateBody title={storedLabel} detail={t("canvas.referenceMissing")} />
              ) : resolution?.status === "present" ? (
                <GenericReferenceCardBody value={resolution.value} title={title} />
              ) : (
                <ReferenceStateBody title={storedLabel} />
              )}
            </div>
          </>
        ) : !source ? (
          <ReferenceStateBody title={storedLabel} detail={unavailableDetail} />
        ) : isBookCard && resolution?.status !== "present" ? (
          <>
            <div aria-hidden="true" className="min-h-0 flex-1 bg-muted" />
            <div className="p-4">
              {resolution?.status === "missing" ? (
                <ReferenceStateBody title={storedLabel} detail={t("canvas.referenceMissing")} />
              ) : (
                <ReferenceStateBody title={storedLabel} />
              )}
            </div>
          </>
        ) : resolution?.status === "missing" ? (
          <ReferenceStateBody title={storedLabel} detail={t("canvas.referenceMissing")} />
        ) : resolution?.status === "present" && CardBody ? (
          <CardBody value={resolution.value} title={title} />
        ) : (
          <ReferenceStateBody title={storedLabel} />
        )}
      </div>

      <div className="p-4 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="nodrag nopan w-full"
          disabled={!canOpen}
          aria-busy={isOpening}
          aria-label={t("canvas.openReferenceNamed", { title })}
          onClick={async () => {
            if (isOpening) return;
            setIsOpening(true);
            const result = await openCanvasReference(node, {
              canvasId: data.canvasId,
              canvasTitle: data.canvasTitle || t("canvas.untitled"),
              navigate,
            });
            if (result !== "opened") setIsOpening(false);
          }}
        >
          {isOpening ? (
            <SpinnerIcon className="size-4 animate-spin" />
          ) : (
            <ExternalLink className="size-4" aria-hidden="true" />
          )}
          {t("canvas.openReference")}
        </Button>
      </div>
    </div>
  );
}
