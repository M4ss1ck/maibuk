import { useRef, useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export type CodeMirrorHandle = {
  /** Get current editor content */
  getContent: () => string;
  /** Set editor content, preserving cursor if possible */
  setContent: (html: string) => void;
  /** Format content with Prettier */
  prettify: () => Promise<void>;
  /** Toggle word wrap */
  toggleWrap: () => void;
  /** Get whether word wrap is currently on */
  isWrapped: () => boolean;
  /** Scroll to and highlight a character range */
  highlightRange: (from: number, to: number) => void;
  /** Get the currently selected text (empty string if nothing is selected) */
  getSelection: () => string;
  /** Get current warning count from linter */
  getWarningCount: () => number;
  /** Apply a CodeMirror theme extension */
  setTheme: (themeExtension: Extension) => void;
};

type UseCodeMirrorOptions = {
  initialContent: string;
  onChange: (content: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onSelectionChange?: (hasSelection: boolean) => void;
};

export function useCodeMirror(options: UseCodeMirrorOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [handle, setHandle] = useState<CodeMirrorHandle | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;

    (async () => {
      // Dynamic import — all CM6 code loads here
      const [
        {
          EditorView,
          keymap,
          lineNumbers,
          highlightActiveLineGutter,
          drawSelection,
          highlightSpecialChars,
          rectangularSelection,
          crosshairCursor,
          highlightActiveLine,
        },
        { EditorState, Compartment },
        { defaultKeymap, history, historyKeymap },
        {
          syntaxHighlighting,
          defaultHighlightStyle,
          indentOnInput,
          bracketMatching,
          foldGutter,
          foldKeymap,
        },
        { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap },
        { html },
        { linter, lintGutter, diagnosticCount },
        { searchKeymap, highlightSelectionMatches },
      ] = await Promise.all([
        import("@codemirror/view"),
        import("@codemirror/state"),
        import("@codemirror/commands"),
        import("@codemirror/language"),
        import("@codemirror/autocomplete"),
        import("@codemirror/lang-html"),
        import("@codemirror/lint"),
        import("@codemirror/search"),
      ]);

      if (destroyed) return;

      // Compartments for dynamic reconfiguration
      const wrapCompartment = new Compartment();
      const themeCompartment = new Compartment();
      let isWrapped = true;
      let warningCount = 0;

      // Import validator for HTML linting
      const { createHtmlLinter } = await import("@/components/editor/html-schema-validator");
      const htmlLinter = createHtmlLinter(linter);

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          optionsRef.current.onChange(update.state.doc.toString());
        }
        if (update.focusChanged) {
          if (update.view.hasFocus) {
            optionsRef.current.onFocus();
          } else {
            optionsRef.current.onBlur();
          }
        }
        if (update.selectionSet) {
          optionsRef.current.onSelectionChange?.(!update.state.selection.main.empty);
        }
        warningCount = diagnosticCount(update.state);
      });

      const extensions = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        html(),
        wrapCompartment.of(EditorView.lineWrapping),
        themeCompartment.of([]),
        lintGutter(),
        htmlLinter,
        updateListener,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
        ]),
      ];

      // Try loading Emmet (optional)
      try {
        const emmetMod = await import("@emmetio/codemirror6-plugin");
        // Plugin may export as default or as named `abbreviationTracker`
        const emmetExt = (emmetMod as any).default ?? (emmetMod as any).abbreviationTracker;
        if (typeof emmetExt === "function") {
          extensions.push(emmetExt());
        } else if (emmetExt) {
          extensions.push(emmetExt);
        }
      } catch {
        // Emmet not available — skip silently
      }

      const state = EditorState.create({
        doc: optionsRef.current.initialContent,
        extensions,
      });

      const view = new EditorView({ state, parent: container });
      viewRef.current = view;

      const cmHandle: CodeMirrorHandle = {
        getContent: () => view.state.doc.toString(),

        setContent: (html: string) => {
          const currentContent = view.state.doc.toString();
          if (html === currentContent) return;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: html },
          });
        },

        prettify: async () => {
          const [prettier, htmlPlugin] = await Promise.all([
            import("prettier/standalone"),
            import("prettier/plugins/html"),
          ]);
          const formatted = await prettier.format(view.state.doc.toString(), {
            parser: "html",
            plugins: [htmlPlugin.default ?? htmlPlugin],
            printWidth: 80,
            tabWidth: 2,
            htmlWhitespaceSensitivity: "ignore",
            bracketSameLine: false,
          });
          // Apply as transaction so Ctrl+Z reverts it
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: formatted },
          });
        },

        toggleWrap: () => {
          isWrapped = !isWrapped;
          view.dispatch({
            effects: wrapCompartment.reconfigure(isWrapped ? EditorView.lineWrapping : []),
          });
        },

        isWrapped: () => isWrapped,

        highlightRange: (from: number, to: number) => {
          // Clamp to document bounds
          const docLength = view.state.doc.length;
          const clampedFrom = Math.min(from, docLength);
          const clampedTo = Math.min(to, docLength);

          view.dispatch({
            selection: { anchor: clampedFrom, head: clampedTo },
            scrollIntoView: true,
          });
          view.focus();
        },

        getSelection: () => {
          const { from, to } = view.state.selection.main;
          return view.state.sliceDoc(from, to);
        },

        getWarningCount: () => warningCount,

        setTheme: (themeExtension: Extension) => {
          view.dispatch({
            effects: themeCompartment.reconfigure(themeExtension || []),
          });
        },
      };

      if (!destroyed) {
        setHandle(cmHandle);
        setIsLoading(false);
      }
    })();

    return () => {
      destroyed = true;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, []);

  return { containerRef, isLoading, handle };
}
