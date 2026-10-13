/** What the window and the syntax-diff worker say to each other. */
import type { SyntaxPatch, SyntaxToken } from "@polaris/syntax-diff";

export interface SyntaxRequest {
  readonly id: number;
  readonly path: string;
  readonly old: string;
  readonly fresh: string;
  /** Both sides' tokens from the highlighter; absent, the worker's parser tokenizes. */
  readonly tokens: {
    readonly old: ReadonlyArray<SyntaxToken>;
    readonly fresh: ReadonlyArray<SyntaxToken>;
  } | null;
}

export type SyntaxReply =
  | ({ readonly id: number; readonly kind: "ok"; readonly ms: number } & SyntaxPatch)
  | { readonly id: number; readonly kind: "unsupported" }
  | { readonly id: number; readonly kind: "too-complex" }
  | { readonly id: number; readonly kind: "failed"; readonly message: string };
