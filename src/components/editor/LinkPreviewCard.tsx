import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  BookOpen,
  CircleAlert,
  FileText,
  Globe,
  Hash,
  Link as LinkIcon,
  Mail,
  NotebookPen,
  Unlink,
  type LucideIcon,
} from "lucide-react";
import { LINK_PREVIEW_COVER_PX } from "@/constants";
import type { LinkPreviewData, LinkPreviewSnippet } from "@/features/links/types";

const MAX_ADDRESS_CHARS = 120;

// A cover is exported at print size (megabytes for a 6x9 at 300 DPI), so a
// Link Preview draws it once at thumbnail size and keeps the small copy.
const MAX_COVER_THUMBNAILS = 16;
const thumbnails = new Map<string, Promise<string | null>>();

function draw(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale =
          (LINK_PREVIEW_COVER_PX * (window.devicePixelRatio || 1)) /
          Math.max(image.naturalWidth, image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * Math.min(1, scale)));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * Math.min(1, scale)));
        const context = canvas.getContext("2d");
        if (!context) return resolve(src);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      } catch {
        resolve(src);
      }
    };
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/** A small copy of a Book cover for a Link Preview; null when it cannot load. */
function getCoverThumbnail(src: string): Promise<string | null> {
  const cached = thumbnails.get(src);
  if (cached) return cached;
  const thumbnail = draw(src);
  thumbnails.set(src, thumbnail);
  if (thumbnails.size > MAX_COVER_THUMBNAILS) {
    const oldest = thumbnails.keys().next().value;
    if (oldest !== undefined) thumbnails.delete(oldest);
  }
  return thumbnail;
}

function iconFor(data: LinkPreviewData): LucideIcon {
  switch (data.kind) {
    case "note":
      return NotebookPen;
    case "chapter":
      return FileText;
    case "heading":
    case "noteHeading":
      return Hash;
    case "book":
      return BookOpen;
    case "web":
      return data.scheme === "web" ? Globe : data.scheme === "mail" ? Mail : LinkIcon;
    case "missing":
      return Unlink;
    case "error":
      return CircleAlert;
  }
}

/** Long addresses keep their start and end: the domain and the page. */
function middleTruncate(text: string): string {
  const max = MAX_ADDRESS_CHARS;
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
}

function snippetText(snippet: LinkPreviewSnippet): string {
  const text = new DOMParser().parseFromString(snippet.html, "text/html").body.textContent;
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** The breadcrumb, title, and text a Link Preview shows, as one plain line. */
export function describeLinkPreview(data: LinkPreviewData, t: TFunction): string {
  const announce = (type: string, target: string, text: string) =>
    t("linkPreview.announce", { type, target, text });
  switch (data.kind) {
    case "note":
      return announce(t("editor.linkTargetNote"), data.title, snippetText(data.snippet));
    case "chapter":
      return announce(
        t("editor.linkTargetChapter"),
        `${data.bookTitle} › ${data.chapterTitle}`,
        snippetText(data.snippet)
      );
    case "heading":
      return data.heading
        ? announce(
            t("editor.linkTargetHeading"),
            `${data.bookTitle} › ${data.chapterTitle} › ${data.heading.text}`,
            snippetText(data.heading.snippet)
          )
        : t("deepLink.headingGone");
    case "noteHeading":
      return data.heading
        ? announce(
            t("editor.linkTargetHeading"),
            `${data.noteTitle} › ${data.heading.text}`,
            snippetText(data.heading.snippet)
          )
        : t("deepLink.headingGone");
    case "book":
      return announce(
        t("editor.linkTargetBook"),
        `${data.title}, ${t("linkPreview.byAuthor", { author: data.author })}`,
        data.description ?? ""
      );
    case "web":
      return announce(t("linkPreview.address"), data.href, "");
    case "missing":
      return t("deepLink.resourceGone");
    case "error":
      return t("deepLink.genericError");
  }
}

function Breadcrumb({ items }: { items: string[] }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
      {items.map((item, index) => (
        <span key={`${index}-${item}`} className="flex min-w-0 items-center gap-x-1">
          {index > 0 && <span aria-hidden="true">›</span>}
          <span className="truncate">{item}</span>
        </span>
      ))}
    </div>
  );
}

function Snippet({ snippet }: { snippet: LinkPreviewSnippet }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  // Short paragraphs or a list can outgrow the height cap without being cut.
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    setClipped(!!element && element.scrollHeight > element.clientHeight);
  }, [snippet.html]);
  if (!snippet.html) {
    return <p className="text-xs italic text-muted-foreground">{t("linkPreview.empty")}</p>;
  }
  return (
    <div
      ref={ref}
      data-testid="link-preview-snippet"
      data-truncated={snippet.truncated || clipped ? "true" : "false"}
      className="editor-content link-preview-snippet text-foreground"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: snippet HTML is sanitized with DOMPurify in extractSnippet
      dangerouslySetInnerHTML={{ __html: snippet.html }}
    />
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function CoverThumbnail({ src }: { src: string }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    void getCoverThumbnail(src).then((result) => {
      if (current) setThumbnail(result);
    });
    return () => {
      current = false;
    };
  }, [src]);
  if (!thumbnail) return null;
  return (
    <img
      src={thumbnail}
      alt=""
      className="h-24 w-16 shrink-0 rounded-sm border border-border object-cover"
    />
  );
}

function Address({ data }: { data: Extract<LinkPreviewData, { kind: "web" }> }) {
  const shown = middleTruncate(data.href);
  const at = data.host ? shown.indexOf(data.host) : -1;
  return (
    <p className="line-clamp-2 break-all font-mono text-xs text-foreground">
      {at < 0 || !data.host ? (
        shown
      ) : (
        <>
          <span className="text-muted-foreground">{shown.slice(0, at)}</span>
          <span className="font-semibold">{data.host}</span>
          <span className="text-muted-foreground">{shown.slice(at + data.host.length)}</span>
        </>
      )}
    </p>
  );
}

function Body({ data }: { data: LinkPreviewData }) {
  const { t } = useTranslation();
  switch (data.kind) {
    case "note":
      return (
        <>
          <p className="text-sm font-medium">{data.title}</p>
          <Snippet snippet={data.snippet} />
        </>
      );
    case "chapter":
      return (
        <>
          <Breadcrumb items={[data.bookTitle]} />
          <p className="text-sm font-medium">{data.chapterTitle}</p>
          <Snippet snippet={data.snippet} />
        </>
      );
    case "heading":
    case "noteHeading": {
      const parents =
        data.kind === "heading" ? [data.bookTitle, data.chapterTitle] : [data.noteTitle];
      if (!data.heading) {
        return (
          <>
            <Breadcrumb items={parents} />
            <Notice>{t("deepLink.headingGone")}</Notice>
          </>
        );
      }
      return (
        <>
          <Breadcrumb items={parents} />
          <p className="text-sm font-medium">{data.heading.text}</p>
          <Snippet snippet={data.heading.snippet} />
        </>
      );
    }
    case "book":
      return (
        <div className="flex gap-3">
          {data.coverSrc && <CoverThumbnail src={data.coverSrc} />}
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium">{data.title}</p>
            <p className="text-xs text-muted-foreground">
              {t("linkPreview.byAuthor", { author: data.author })}
            </p>
            {data.description && (
              <p className="line-clamp-4 font-serif text-sm text-foreground">{data.description}</p>
            )}
          </div>
        </div>
      );
    case "web":
      return <Address data={data} />;
    case "missing":
      return <Notice>{t("deepLink.resourceGone")}</Notice>;
    case "error":
      return <Notice>{t("deepLink.genericError")}</Notice>;
  }
}

/** What a Link points to: its type icon, then the target's own preview. */
export function LinkPreviewCard({
  data,
  className = "w-80 max-w-[calc(100vw-2rem)] shadow-lg",
}: {
  data: LinkPreviewData;
  /** Width and elevation; the card floats by default. */
  className?: string;
}) {
  const Icon = iconFor(data);
  return (
    <div
      className={`flex gap-2.5 rounded-lg border border-border bg-card p-3 text-foreground ${className}`}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Body data={data} />
      </div>
    </div>
  );
}
