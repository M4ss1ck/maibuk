// The Tutorial's content: eight sections in order, each a list of look-only
// steps. A step points at the element carrying `data-tutorial="<step id>"`;
// labels and classes are never targets, because copy and styling change.
// Each step lists the glossary terms it teaches (the coverage gate).

import { DOWNLOAD_PAGE } from "@/constants";
import { SAMPLE_IDS } from "@/features/tutorial/sample-ids";
import type {
  TutorialPosition,
  TutorialSection,
  TutorialSectionId,
  TutorialStep,
} from "@/features/tutorial/types";

const NOVEL_ROUTE = `/book/${SAMPLE_IDS.novel}`;
const NOTE_ROUTE = `/notes/${SAMPLE_IDS.noteResearch}`;

function step(
  id: string,
  terms: readonly string[],
  extra: Partial<Pick<TutorialStep, "route" | "image" | "link">> = {}
): TutorialStep {
  return {
    id,
    titleKey: `tutorial.steps.${id}.title`,
    bodyKey: `tutorial.steps.${id}.body`,
    terms,
    ...extra,
  };
}

export const TUTORIAL_SECTIONS: readonly TutorialSection[] = [
  {
    id: "books",
    route: "/",
    nameKey: "tutorial.sections.books",
    steps: [
      step("books.gallery", ["Library", "Gallery", "Book", "Last Edited", "Tutorial Library"]),
      step("books.new-book", ["Book", "Author Name", "Genre", "Target Word Count"]),
      step("books.import", ["Import", "Compatibility Report"]),
      step("books.status", ["Book Status", "Archived", "Unarchive"]),
      step("books.nav", ["Note", "Canvas", "Ephemeral"]),
      step("books.metrics", ["Writing Session", "Streak"]),
      step("books.settings", ["Sync"]),
      step("books.remember", ["Reading Position"]),
    ],
  },
  {
    id: "book-editor",
    route: NOVEL_ROUTE,
    nameKey: "tutorial.sections.book-editor",
    steps: [
      step("book-editor.chapters", ["Chapter", "Chapter Type", "Chapter Status", "Last Opened Chapter"]),
      step("book-editor.text", ["Heading", "Scene Break", "Footnote"]),
      step("book-editor.outline", ["Outline"]),
      step("book-editor.toolbar", ["Spell Check", "Word Lookup", "Symbol", "Text Case"]),
      step("book-editor.save-status", ["Save Status", "Edit Session", "Flush"]),
      step("book-editor.book-notes", ["Book Note"]),
      step("book-editor.history", [
        "Version",
        "Checkpoint",
        "Named Version",
        "Version Trigger",
        "Restore",
        "Compare",
      ]),
      step("book-editor.sync", ["Sync", "Push", "Pull", "Conflict", "Sync Log", "Synced Item"]),
      step("book-editor.export", ["Export", "Table of Contents"]),
      step("book-editor.focus", ["Focus Mode", "Bound Shortcut"]),
      step("book-editor.cover", ["Cover"]),
    ],
  },
  {
    id: "cover-designer",
    route: `${NOVEL_ROUTE}/cover`,
    nameKey: "tutorial.sections.cover-designer",
    steps: [
      step("cover-designer.templates", ["Cover Designer", "Cover Template"]),
      step("cover-designer.size", ["Cover Size Preset"]),
      step("cover-designer.export", ["Export"]),
    ],
  },
  {
    id: "notes",
    route: "/notes",
    nameKey: "tutorial.sections.notes",
    steps: [
      step("notes.gallery", ["Note", "Gallery"]),
      step("notes.card", ["Pinned", "Book Note", "Tag", "Item Menu"]),
      step("notes.filters", ["Tag"]),
      step("notes.new", ["Unfiled Note"]),
      step("notes.tree", ["Book Note", "Unfiled Note"], { route: NOTE_ROUTE }),
      step("notes.tags", ["Tag"], { route: NOTE_ROUTE }),
      step("notes.content", ["Heading", "Link"], { route: NOTE_ROUTE }),
      step("notes.backlinks", ["Link", "Backlink"], { route: NOTE_ROUTE }),
    ],
  },
  {
    id: "canvas-gallery",
    route: "/canvas",
    nameKey: "tutorial.sections.canvas-gallery",
    steps: [
      step("canvas-gallery.canvas", ["Canvas", "Pinned"]),
      step("canvas-gallery.new", ["Canvas"]),
    ],
  },
  {
    id: "canvas",
    route: `/canvas/${SAMPLE_IDS.canvas}`,
    nameKey: "tutorial.sections.canvas",
    steps: [
      step("canvas.surface", ["Canvas", "Connection"]),
      step("canvas.text-node", ["Text Node"]),
      step("canvas.note-ref", ["Note Reference", "Missing Note Reference"]),
      step("canvas.pen", ["Drawing"]),
    ],
  },
  {
    id: "ephemeral",
    route: "/ephemeral",
    nameKey: "tutorial.sections.ephemeral",
    steps: [step("ephemeral.editor", ["Ephemeral"]), step("ephemeral.to-note", ["Note"])],
  },
  {
    id: "settings",
    route: "/settings",
    nameKey: "tutorial.sections.settings",
    steps: [
      step("settings.appearance", []),
      step("settings.window", []),
      step("settings.general", []),
      step(
        "settings.sync",
        [
          "Sync Account",
          "Passphrase",
          "Auto Sync",
          "Sync Scope",
          "Sync Direction",
          "Delete",
          "Deletion Review",
        ],
        { link: { href: DOWNLOAD_PAGE, labelKey: "tutorial.steps.settings.sync.link" } }
      ),
      step("settings.backups", [
        "Backup",
        "Backup Trigger",
        "Retention",
        "Restore",
        "Backup Directory",
      ]),
      step("settings.metrics", ["Metrics Category", "Writing Session", "Streak"]),
      step("settings.editor", ["Spell Check", "Custom Dictionary", "Paste Cleanup"]),
      step("settings.advanced", ["Database File", "Reset"]),
      step("settings.tutorial", ["Tutorial"]),
    ],
  },
];

/**
 * Glossary terms no step teaches, each with the reason. With the step terms
 * above this accounts for every term in CONTEXT.md: the coverage gate fails
 * when a new term appears in neither place.
 */
export const TUTORIAL_OUT_OF_SCOPE_TERMS: Readonly<Record<string, string>> = {
  "Sync Base": "internal state a sync compares against; nothing on screen shows it",
  Deferred: "only named in the Sync Log after an automatic run; no control to point at",
  Tombstone: "lives inside the Deletion Review dialog; steps never open dialogs",
  "Deleted Elsewhere": "lives inside the Deletion Review dialog; steps never open dialogs",
  Keep: "a choice inside the Sync Conflict dialog; steps never open dialogs",
  Change: "architecture vocabulary (ADR 0003); never shown to the author",
  Origin: "architecture vocabulary (ADR 0003); never shown to the author",
  "Change Kind": "architecture vocabulary (ADR 0003); never shown to the author",
  "Change Feed": "architecture vocabulary (ADR 0003); never shown to the author",
  "Entity Sync": "architecture vocabulary (ADR 0006); never shown to the author",
};

/** The step the Settings → Tutorial row is anchored to; the whole Tutorial ends there. */
export const TUTORIAL_SETTINGS_ROW_STEP = "settings.tutorial";

export function getSection(id: TutorialSectionId): TutorialSection {
  const section = TUTORIAL_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Unknown Tutorial section: ${id}`);
  return section;
}

export function stepRoute(section: TutorialSection, stepIndex: number): string {
  return section.steps[stepIndex]?.route ?? section.route;
}

/** The sections a run covers: all of them in order, or one when started at a single section. */
export function sectionsForRun(only: TutorialSectionId | null): readonly TutorialSection[] {
  return only ? [getSection(only)] : TUTORIAL_SECTIONS;
}

/** The position after `position` in a run, or null when it is the run's last step. */
export function nextPosition(
  position: TutorialPosition,
  only: TutorialSectionId | null
): TutorialPosition | null {
  const sections = sectionsForRun(only);
  const sectionIndex = sections.findIndex((section) => section.id === position.section);
  const section = sections[sectionIndex];
  if (!section) return null;
  if (position.step + 1 < section.steps.length) {
    return { section: section.id, step: position.step + 1 };
  }
  const following = sections[sectionIndex + 1];
  return following ? { section: following.id, step: 0 } : null;
}

/** The position before `position`; Back crosses into the previous section's last step. */
export function previousPosition(
  position: TutorialPosition,
  only: TutorialSectionId | null
): TutorialPosition | null {
  const sections = sectionsForRun(only);
  const sectionIndex = sections.findIndex((section) => section.id === position.section);
  if (sectionIndex < 0) return null;
  if (position.step > 0) return { section: position.section, step: position.step - 1 };
  const preceding = sections[sectionIndex - 1];
  return preceding ? { section: preceding.id, step: preceding.steps.length - 1 } : null;
}

/** The section whose screen `pathname` is, for "Tutorial for this screen". */
export function sectionForPath(pathname: string): TutorialSectionId {
  if (pathname === "/notes" || pathname.startsWith("/notes/")) return "notes";
  if (pathname === "/canvas") return "canvas-gallery";
  if (pathname.startsWith("/canvas/")) return "canvas";
  if (/^\/book\/[^/]+\/cover$/.test(pathname)) return "cover-designer";
  if (pathname.startsWith("/book/")) return "book-editor";
  if (pathname === "/ephemeral") return "ephemeral";
  if (pathname === "/settings") return "settings";
  return "books";
}

export function totalStepCount(): number {
  return TUTORIAL_SECTIONS.reduce((total, section) => total + section.steps.length, 0);
}
