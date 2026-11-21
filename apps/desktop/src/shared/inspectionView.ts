interface ViewElement {
  readonly childNodes: ArrayLike<{
    readonly nodeType: number;
    readonly textContent: string | null;
  }>;
  readonly children: Iterable<ViewElement>;
  readonly tagName: string;
  matches(selector: string): boolean;
  getAttribute(name: string): string | null;
  getClientRects(): { readonly length: number };
}

interface ViewGlobals {
  readonly document: { readonly body: ViewElement };
  getComputedStyle(element: ViewElement): { readonly display: string; readonly visibility: string };
}

/** Runs in the renderer's isolated world; keep self-contained for executeJavaScript. */
export function inspectionView(this: ViewGlobals): string {
  const lines: string[] = [];
  let visited = 0;
  let length = 0;

  const textOf = (element: ViewElement): string => {
    let text = "";

    for (
      let index = 0;
      index < Math.min(element.childNodes.length, 128) && text.length < 512;
      index++
    ) {
      const node = element.childNodes[index];

      if (node?.nodeType === 3) text += (node.textContent ?? "").slice(0, 512 - text.length);
    }

    return text.replace(/\s+/g, " ").trim();
  };

  const walk = (element: ViewElement, depth: number): void => {
    if (++visited > 5000 || length > 11500 || depth > 40) return;

    if (
      element.matches("script,style,input,textarea,[contenteditable],[hidden],[aria-hidden=true]")
    )
      return;
    const style = this.getComputedStyle(element);

    if (style.display === "none" || style.visibility === "hidden") return;
    const role = element.getAttribute("role");
    const label = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "";

    const directText = textOf(element);

    if (element.getClientRects().length > 0 && (role !== null || label || directText)) {
      const selected = element.getAttribute("aria-selected");
      const line = `${" ".repeat(Math.min(depth, 20))}${role ?? element.tagName.toLowerCase()}${label ? ` [${label.slice(0, 256)}]` : ""}${selected === null ? "" : ` selected=${selected}`}${directText ? `: ${directText.slice(0, 512)}` : ""}`;
      lines.push(line);
      length += line.length + 1;
    }

    for (const child of element.children) {
      if (visited >= 5000 || length > 11500) break;
      walk(child, depth + 1);
    }
  };

  walk(this.document.body, 0);

  if (visited >= 5000 || length > 11500) lines.push("… view truncated.");

  return lines.join("\n").slice(0, 12000);
}
