import { Extension, type Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface CollapsibleHeadingOptions {
  collapseLabel: string;
  expandLabel: string;
  collapsedHeadings: string[];
}

interface CollapsibleHeadingState {
  collapsed: Set<string>;
}

export const collapsibleHeadingPluginKey = new PluginKey<CollapsibleHeadingState>("collapsibleHeading");

const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

function assignMissingHeadingIds(editor: Editor): void {
  const tr = editor.state.tr;
  let modified = false;

  editor.state.doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.type.name !== "heading") return;
    if (node.attrs.headingId) return;
    tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      headingId: crypto.randomUUID(),
    });
    modified = true;
  });

  if (modified) {
    editor.view.dispatch(tr);
  }
}

export const CollapsibleHeading = Extension.create<CollapsibleHeadingOptions>({
  name: "collapsibleHeading",

  addOptions() {
    return {
      collapseLabel: "Collapse heading",
      expandLabel: "Expand heading",
      collapsedHeadings: [] as string[],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          headingId: {
            default: null,
            parseHTML: (element) => element.getAttribute("data-heading-id") ?? crypto.randomUUID(),
            renderHTML: (attributes) => {
              if (!attributes.headingId) return {};
              return { "data-heading-id": attributes.headingId };
            },
          },
        },
      },
    ];
  },

  onCreate() {
    assignMissingHeadingIds(this.editor);
  },

  addProseMirrorPlugins() {
    const { collapseLabel, expandLabel, collapsedHeadings } = this.options;

    return [
      new Plugin<CollapsibleHeadingState>({
        key: collapsibleHeadingPluginKey,
        state: {
          init: () => ({ collapsed: new Set<string>(collapsedHeadings) }),
          apply(tr, value, _oldState, newState) {
            let collapsed = value.collapsed;

            if (tr.docChanged) {
              const verified = new Set<string>();
              newState.doc.descendants((node) => {
                const id = node.attrs.headingId as string | null;
                if (id && collapsed.has(id)) {
                  verified.add(id);
                }
              });
              collapsed = verified;
            }

            const meta = tr.getMeta(collapsibleHeadingPluginKey) as
              | { toggle: string }
              | { replace: string[] }
              | undefined;
            if (meta) {
              if ("toggle" in meta && typeof meta.toggle === "string") {
                collapsed = new Set(collapsed);
                if (collapsed.has(meta.toggle)) {
                  collapsed.delete(meta.toggle);
                } else {
                  collapsed.add(meta.toggle);
                }
              } else if ("replace" in meta && Array.isArray(meta.replace)) {
                collapsed = new Set(meta.replace);
              }
            }

            return { collapsed };
          },
        },
        appendTransaction(_transactions, _oldState, newState) {
          const tr = newState.tr;
          let modified = false;

          newState.doc.descendants((node, pos) => {
            if (node.type.name !== "heading") return;
            if (node.attrs.headingId) return;
            tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              headingId: crypto.randomUUID(),
            });
            modified = true;
          });

          return modified ? tr : null;
        },
        props: {
          decorations(state) {
            const pluginState = collapsibleHeadingPluginKey.getState(state);
            if (!pluginState) return null;
            const { collapsed } = pluginState;

            const decorations: Decoration[] = [];
            let currentCollapsedLevel: number | null = null;

            state.doc.descendants((node, pos) => {
              if (node.type.name === "heading") {
                const headingId = node.attrs.headingId as string | null;
                if (!headingId) return;

                const level = node.attrs.level as number;
                const isCollapsed = collapsed.has(headingId);

                if (currentCollapsedLevel !== null && level <= currentCollapsedLevel) {
                  currentCollapsedLevel = null;
                } else if (currentCollapsedLevel !== null) {
                  decorations.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                      class: "heading-section-hidden",
                    })
                  );
                  return;
                }

                if (isCollapsed) {
                  currentCollapsedLevel = level;
                }

                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: isCollapsed ? "heading-collapsible is-collapsed" : "heading-collapsible",
                  }),
                  Decoration.widget(
                    pos + 1,
                    (view) => {
                      const button = document.createElement("button");
                      button.type = "button";
                      button.className = "heading-collapse-toggle";
                      button.contentEditable = "false";
                      button.setAttribute("data-collapsed", String(isCollapsed));
                      button.setAttribute("aria-label", isCollapsed ? expandLabel : collapseLabel);
                      button.setAttribute("data-heading-id", headingId);
                      button.innerHTML = CHEVRON_SVG;
                      button.addEventListener("mousedown", (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        view.dispatch(
                          view.state.tr.setMeta(collapsibleHeadingPluginKey, {
                            toggle: headingId,
                          })
                        );
                      });
                      return button;
                    },
                    { side: -1, key: `heading-toggle-${headingId}` }
                  )
                );
                return;
              }

              if (currentCollapsedLevel !== null) {
                decorations.push(
                  Decoration.node(pos, pos + node.nodeSize, {
                    class: "heading-section-hidden",
                  })
                );
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
