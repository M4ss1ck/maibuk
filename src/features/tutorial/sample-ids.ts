// Ids of the Tutorial Library's sample content. Every one starts with the
// `tutorial-` prefix the write paths refuse outside the Tutorial (ADR 0008).

export const SAMPLE_IDS = {
  novel: "tutorial-book-novel",
  prologue: "tutorial-chapter-prologue",
  part: "tutorial-chapter-part",
  chapterOne: "tutorial-chapter-one",
  chapterTwo: "tutorial-chapter-two",
  completed: "tutorial-book-completed",
  completedChapter: "tutorial-chapter-completed",
  archived: "tutorial-book-archived",
  archivedChapter: "tutorial-chapter-archived",
  noteCharacters: "tutorial-note-characters",
  noteResearch: "tutorial-note-research",
  noteIdeas: "tutorial-note-ideas",
  noteChecklist: "tutorial-note-checklist",
  canvas: "tutorial-canvas-plot",
} as const;
