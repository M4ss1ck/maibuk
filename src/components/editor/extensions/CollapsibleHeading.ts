import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

interface CollapsibleHeadingOptions {
  collapseLabel: string;
  expandLabel: string;
}

interface CollapsibleHeadingState {
  collapsed: Set<number>;
}

const collapsibleHeadingKey = new PluginKey<CollapsibleHeadingState>("collapsibleHeading");

// Chevron points down when expanded; CSS rotates it when collapsed.
const CHEVRON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>';

/**
 * Lets the reader collapse a heading and the content beneath it (up to the next
 * heading of equal or higher level). Collapse state is view-only: it lives in
 * plugin state and is never written to the saved HTML.
 */
export const CollapsibleHeading = Extension.create<CollapsibleHeadingOptions>({
  name: "collapsibleHeading",

  addOptions() {
    return {
      collapseLabel: "Collapse heading",
      expandLabel: "Expand heading",
    };
  },

  addProseMirrorPlugins() {
    const { collapseLabel, expandLabel } = this.options;

    return [
      new Plugin<CollapsibleHeadingState>({
        key: collapsibleHeadingKey,
        state: {
          init: () => ({ collapsed: new Set<number>() }),
          apply(tr, value) {
            let collapsed = value.collapsed;

            if (tr.docChanged) {
              const remapped = new Set<number>();
              for (const pos of collapsed) {
                const mapped = tr.mapping.map(pos, -1);
                const node = tr.doc.nodeAt(mapped);
                if (node?.type.name === "heading") {
                  remapped.add(mapped);
                }
              }
              collapsed = remapped;
            }

            const meta = tr.getMeta(collapsibleHeadingKey) as { toggle: number } | undefined;
            if (meta && typeof meta.toggle === "number") {
              collapsed = new Set(collapsed);
              if (collapsed.has(meta.toggle)) {
                collapsed.delete(meta.toggle);
              } else {
                collapsed.add(meta.toggle);
              }
            }

            return { collapsed };
          },
        },
        props: {
          decorations(state) {
            const pluginState = collapsibleHeadingKey.getState(state);
            if (!pluginState) return null;
            const { collapsed } = pluginState;

            const children: { type: string; offset: number; size: number; level: number }[] = [];
            state.doc.forEach((node, offset) => {
              children.push({
                type: node.type.name,
                offset,
                size: node.nodeSize,
                level: typeof node.attrs.level === "number" ? node.attrs.level : 0,
              });
            });

            const decorations: Decoration[] = [];
            const hidden = new Set<number>();

            for (let i = 0; i < children.length; i++) {
              const heading = children[i];
              if (heading.type !== "heading") continue;

              const isCollapsed = collapsed.has(heading.offset);

              decorations.push(
                Decoration.node(heading.offset, heading.offset + heading.size, {
                  class: isCollapsed ? "heading-collapsible is-collapsed" : "heading-collapsible",
                }),
                Decoration.widget(
                  heading.offset + 1,
                  (view) => {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "heading-collapse-toggle";
                    button.contentEditable = "false";
                    button.setAttribute("data-collapsed", isCollapsed ? "true" : "false");
                    button.setAttribute("aria-label", isCollapsed ? expandLabel : collapseLabel);
                    button.innerHTML = CHEVRON_SVG;
                    button.addEventListener("mousedown", (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      view.dispatch(
                        view.state.tr.setMeta(collapsibleHeadingKey, {
                          toggle: heading.offset,
                        })
                      );
                    });
                    return button;
                  },
                  { side: -1, key: `heading-toggle-${heading.offset}-${isCollapsed}` }
                )
              );

              if (!isCollapsed) continue;

              for (let j = i + 1; j < children.length; j++) {
                const child = children[j];
                if (child.type === "heading" && child.level <= heading.level) {
                  break;
                }
                if (hidden.has(child.offset)) continue;
                hidden.add(child.offset);
                decorations.push(
                  Decoration.node(child.offset, child.offset + child.size, {
                    class: "heading-section-hidden",
                  })
                );
              }
            }

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
