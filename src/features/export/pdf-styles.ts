/**
 * PDF styles for @react-pdf/renderer export.
 *
 * Creates a React-PDF StyleSheet configured by PdfExportOptions.
 * All dimensions are in points (1pt ≈ 1/72 inch).
 */
import { StyleSheet } from "@react-pdf/renderer";
import type { PdfExportOptions, PdfMarginPreset } from "./types";
import { PDF_BASE_FONT } from "./types";

const MARGIN_PRESETS: Record<
  PdfMarginPreset,
  { top: number; bottom: number; left: number; right: number }
> = {
  standard: { top: 71, bottom: 71, left: 57, right: 57 },
  wide: { top: 85, bottom: 85, left: 85, right: 85 },
  narrow: { top: 43, bottom: 43, left: 43, right: 43 },
};

export function getMargins(preset: PdfMarginPreset) {
  return MARGIN_PRESETS[preset];
}

export function createPdfStyles(options: PdfExportOptions) {
  const margins = MARGIN_PRESETS[options.margins];
  const fontFamily = PDF_BASE_FONT;
  const baseFontSize = 12;

  return StyleSheet.create({
    // --- Page styles ---
    coverPage: {
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
    },
    contentPage: {
      paddingTop: margins.top,
      paddingBottom: margins.bottom + 24,
      paddingLeft: margins.left,
      paddingRight: margins.right,
      fontFamily,
      fontSize: baseFontSize,
      color: "#000",
    },

    // --- Cover ---
    coverImage: {
      width: "100%",
      height: "100%",
    },
    coverTitle: {
      fontSize: 36,
      fontFamily,
      textAlign: "center",
      marginBottom: 12,
    },
    coverSubtitle: {
      fontSize: 18,
      fontStyle: "italic",
      fontFamily,
      textAlign: "center",
      color: "#555",
      marginBottom: 48,
    },
    coverAuthor: {
      fontSize: 18,
      fontFamily,
      textAlign: "center",
      color: "#333",
      marginTop: 72,
    },

    // --- Table of Contents ---
    tocContainer: {
      marginBottom: 24,
    },
    tocTitle: {
      fontSize: 24,
      fontFamily,
      textAlign: "center",
      marginBottom: 48,
    },
    tocEntry: {
      fontSize: 14,
      fontFamily,
      marginBottom: 8,
    },
    tocLink: {
      color: "#000",
      textDecoration: "none",
    },

    // --- Chapters ---
    chapterContainer: {},
    chapterHeader: {
      textAlign: "center",
      marginBottom: 36,
      paddingTop: 48,
    },
    chapterNumber: {
      fontSize: 14,
      fontFamily,
      letterSpacing: 3,
      color: "#666",
      marginBottom: 8,
      textAlign: "center",
      textTransform: "uppercase",
    },
    chapterTitle: {
      fontSize: 28,
      fontFamily,
      textAlign: "center",
      lineHeight: 1.2,
    },

    // --- Typography ---
    paragraph: {
      marginBottom: 9,
      textAlign: "justify",
      fontFamily,
      fontSize: baseFontSize,
      lineHeight: 1.6,
    },
    heading1: {
      fontSize: 24,
      fontFamily,
      marginTop: 18,
      marginBottom: 6,
      minPresenceAhead: 40,
    },
    heading2: {
      fontSize: 20,
      fontFamily,
      marginTop: 18,
      marginBottom: 6,
      minPresenceAhead: 40,
    },
    heading3: {
      fontSize: 16,
      fontFamily,
      marginTop: 18,
      marginBottom: 6,
      minPresenceAhead: 40,
    },
    heading4: {
      fontSize: 14,
      fontFamily,
      marginTop: 18,
      marginBottom: 6,
      minPresenceAhead: 40,
    },
    heading5: {
      fontSize: 12,
      fontFamily,
      marginTop: 18,
      marginBottom: 6,
      minPresenceAhead: 40,
    },
    heading6: {
      fontSize: 10,
      fontFamily,
      marginTop: 18,
      marginBottom: 6,
      minPresenceAhead: 40,
    },

    // --- Lists ---
    list: {
      marginTop: 12,
      marginBottom: 12,
      paddingLeft: 24,
    },
    listItem: {
      flexDirection: "row",
      marginBottom: 3,
    },
    bullet: {
      width: 18,
      fontSize: baseFontSize,
      fontFamily,
    },
    listItemContent: {
      flex: 1,
      fontSize: baseFontSize,
      fontFamily,
      lineHeight: 1.6,
    },

    // --- Blockquote ---
    blockquote: {
      marginTop: 18,
      marginBottom: 18,
      marginLeft: 24,
      paddingLeft: 12,
      borderLeftWidth: 3,
      borderLeftColor: "#ccc",
    },
    blockquoteText: {
      fontStyle: "italic",
      color: "#333",
      fontSize: baseFontSize,
      fontFamily,
      lineHeight: 1.6,
    },

    // --- Code ---
    codeBlock: {
      backgroundColor: "#f4f4f5",
      borderRadius: 4,
      padding: 10,
      marginTop: 12,
      marginBottom: 12,
    },
    codeBlockText: {
      fontFamily: "Courier",
      fontSize: 10,
      color: "#1e1e1e",
      lineHeight: 1.5,
    },
    codeInline: {
      fontFamily: "Courier",
      fontSize: 10,
      backgroundColor: "#f4f4f5",
    },

    // --- Scene break ---
    sceneBreak: {
      marginTop: 24,
      marginBottom: 24,
      alignItems: "center",
    },
    sceneBreakText: {
      fontSize: 14,
      letterSpacing: 8,
      color: "#666",
      textAlign: "center",
    },

    // --- Images ---
    image: {
      maxWidth: "100%",
      marginTop: 18,
      marginBottom: 18,
    },

    // --- Tables ---
    table: {
      marginTop: 12,
      marginBottom: 12,
      width: "100%",
    },
    tableRow: {
      flexDirection: "row",
    },
    tableCell: {
      flex: 1,
      borderWidth: 1,
      borderColor: "#ccc",
      padding: 6,
    },
    tableCellHeader: {
      flex: 1,
      borderWidth: 1,
      borderColor: "#ccc",
      padding: 6,
      backgroundColor: "#f5f5f5",
    },
    tableCellText: {
      fontSize: baseFontSize,
      fontFamily,
    },

    // --- Endnotes ---
    endnotes: {
      marginTop: 36,
      borderTopWidth: 1,
      borderTopColor: "#ccc",
      paddingTop: 12,
    },
    endnotesTitle: {
      fontSize: 14,
      fontFamily,
      marginBottom: 12,
    },
    endnote: {
      fontSize: 10,
      fontFamily,
      marginBottom: 6,
      lineHeight: 1.5,
    },

    // --- Inline styles ---
    bold: { fontWeight: "bold" },
    italic: { fontStyle: "italic" },
    underline: { textDecoration: "underline" },
    strikethrough: { textDecoration: "line-through" },
    footnoteRef: { fontSize: 8 },
    link: { color: "#000", textDecoration: "none" },

    // --- Page number ---
    pageNumber: {
      position: "absolute",
      bottom: margins.bottom / 2,
      left: 0,
      right: 0,
      textAlign: "center",
      fontSize: 10,
      color: "#666",
      fontFamily,
    },
  });
}

export type PdfStyles = ReturnType<typeof createPdfStyles>;
