/**
 * The off-screen jump marker (DESIGN.md "Edit Predictions", EP4a): a pill inside the Editor at
 * its bottom or top right naming the target line, shown only while the jump target is out of view.
 */
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { jumpTarget } from "./decorations.ts";

interface Edge {
  readonly side: "top" | "bottom";
  readonly line: number;
}

class EdgeMarker {
  private readonly node = document.createElement("div");
  private readonly onScroll = () => this.view.requestMeasure(this.measure);
  private readonly measure = {
    read: (view: EditorView) => this.read(view),
    write: (edge: Edge | null) => this.write(edge),
    key: this,
  };
  constructor(private readonly view: EditorView) {
    this.node.className = "cm-ep-edge";
    this.node.style.display = "none";
    this.node.setAttribute("aria-hidden", "true");
    view.dom.append(this.node);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
  }
  update(update: ViewUpdate) {
    if (jumpTarget(update.state) !== null || this.node.style.display !== "none")
      this.view.requestMeasure(this.measure);
  }
  private read(view: EditorView): Edge | null {
    const target = jumpTarget(view.state);

    if (target === null) return null;
    const line = view.state.doc.lineAt(target).number;
    const coords = view.coordsAtPos(target);

    if (coords === null) return { side: target < view.viewport.from ? "top" : "bottom", line };
    const rect = view.scrollDOM.getBoundingClientRect();

    if (coords.top < rect.top) return { side: "top", line };

    if (coords.bottom > rect.bottom) return { side: "bottom", line };

    return null;
  }
  private write(edge: Edge | null) {
    if (edge === null) {
      this.node.style.display = "none";

      return;
    }

    this.node.textContent = `${edge.side === "top" ? "↑" : "↓"} Ln ${edge.line}`;
    this.node.classList.toggle("cm-ep-edge-top", edge.side === "top");
    this.node.style.display = "flex";
  }
  destroy() {
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.node.remove();
  }
}

export const edgeMarker = ViewPlugin.define((view) => new EdgeMarker(view));
