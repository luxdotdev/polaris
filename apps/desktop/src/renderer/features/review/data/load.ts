/**
 * Loading a Review's diff: fetch every section, index its files, parse them in batches.
 * Its dependencies are injected so it is tested without IPC or workers; anything it can't
 * handle rejects, and the view turns that into a failed state (`failureOf`), never a blank pane.
 */
import type { FileDiffMetadata } from "@pierre/diffs";
import type { IpcError } from "../../../../shared/api.ts";
import type { ReviewFile, ReviewSection } from "../model/layout.ts";
import { type ReviewScale, scaleOf } from "../model/policy.ts";
import type { DiffSource, SourceSection } from "./source.ts";

export type ReviewDiff =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "failed"; readonly error: IpcError }
  | {
      readonly kind: "ready";
      readonly source: DiffSource;
      readonly sections: ReadonlyArray<ReviewSection>;
      readonly scale: ReviewScale;
      /** Parsed files by `ReviewFile.key`; grows batch by batch. */
      readonly parsed: ReadonlyMap<string, FileDiffMetadata>;
      readonly bytes: ReadonlyMap<string, Uint8Array>;
      readonly size: number;
      /** False while batches are still parsing. */
      readonly complete: boolean;
    };

export interface Fetched {
  readonly section: SourceSection;
  readonly bytes: Uint8Array;
  readonly files: ReadonlyArray<ReviewFile>;
}

export type ParseAll = (
  fetched: ReadonlyArray<Fetched>,
  scale: ReviewScale,
  onParsed: (entries: ReadonlyArray<readonly [string, FileDiffMetadata]>) => void,
  live: () => boolean
) => Promise<void>;

const isError = <A extends object>(value: A | IpcError): value is IpcError => "code" in value;

/** The state a diff that failed for an unexpected reason shows. */
export const failureOf = (cause: unknown): ReviewDiff => ({
  kind: "failed",
  error: {
    code: "ReviewDiffFailed",
    message:
      cause instanceof Error
        ? cause.message
        : `Something went wrong reading the diff (${String(cause)})`,
  },
});

/** What loading a Review's diff needs; injected so the pipeline is tested without IPC. */
export interface LoadDeps {
  readonly fetch: (source: DiffSource) => Promise<ReadonlyArray<Fetched> | IpcError>;
  readonly parse: ParseAll;
  readonly live: () => boolean;
  readonly set: (next: ReviewDiff | ((previous: ReviewDiff) => ReviewDiff)) => void;
}

/** Fetches, indexes and parses a Review's diff; rejects on anything unexpected. */
export const loadReviewDiff = async (source: DiffSource, deps: LoadDeps) => {
  const fetched = await deps.fetch(source);

  if (!deps.live()) return;

  if (isError(fetched)) {
    deps.set({ kind: "failed", error: fetched });

    return;
  }

  const size = fetched.reduce((sum, f) => sum + f.bytes.byteLength, 0);
  const count = fetched.reduce((sum, f) => sum + f.files.length, 0);
  const scale = scaleOf(count, size);

  const sections = fetched.flatMap((f): ReadonlyArray<ReviewSection> =>
    f.files.length === 0 ? [] : [{ id: f.section.id, divider: f.section.divider, files: f.files }]
  );

  const bytes = new Map(fetched.map((f) => [f.section.id, f.bytes]));
  const parsed = new Map<string, FileDiffMetadata>();

  deps.set({ kind: "ready", source, sections, scale, parsed, bytes, size, complete: false });
  await deps.parse(
    fetched,
    scale,
    (entries) => {
      for (const [k, v] of entries) parsed.set(k, v);

      deps.set((d) => (d.kind === "ready" ? { ...d, parsed: new Map(parsed) } : d));
    },
    deps.live
  );

  if (deps.live()) deps.set((d) => (d.kind === "ready" ? { ...d, complete: true } : d));
};
