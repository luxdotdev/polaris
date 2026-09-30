/**
 * Which heavy Markdown plugins a message needs, from its text alone: Shiki
 * for a fenced code block, Mermaid for a `mermaid` fence, KaTeX for `$$` or
 * `\(`/`\[` math. Messages without them never load the plugins.
 */
export interface Needs {
  readonly code: boolean;
  readonly mermaid: boolean;
  readonly math: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/m;

const MERMAID = /^ {0,3}(`{3,}|~{3,})\s*mermaid\b/im;

const MATH = /\$\$|\\\(|\\\[/;

export const needsOf = (text: string): Needs => ({
  code: FENCE.test(text),
  mermaid: MERMAID.test(text),
  math: MATH.test(text),
});
