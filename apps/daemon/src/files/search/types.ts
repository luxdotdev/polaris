/** One search index over one root (a Workspace or a Worktree). */
export interface PathHit {
  /** Absolute path. */
  readonly path: string;
  /** Higher is better; only comparable within one result list. */
  readonly score: number;
}

export interface GrepHit {
  /** Absolute path. */
  readonly path: string;
  /** 1-based. */
  readonly line: number;
  /** 1-based byte column of the first match on the line. */
  readonly column: number;
  readonly text: string;
}

export interface GrepQuery {
  readonly pattern: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly limit: number;
}

export interface FileChange {
  /** Absolute path; for `renamed`, the destination. */
  readonly path: string;
  readonly kind: "created" | "modified" | "deleted" | "renamed";
}

export interface SearchBackend {
  readonly kind: "fff" | "fallback";
  readonly root: string;
  readonly searchPaths: (query: string, limit: number) => Promise<ReadonlyArray<PathHit>>;
  readonly grep: (query: GrepQuery) => Promise<ReadonlyArray<GrepHit>>;
  /**
   * Subscribes to changes under the root; resolves (once the watcher is live)
   * to the unsubscribe function.
   */
  readonly watch: (onBatch: (changes: ReadonlyArray<FileChange>) => void) => Promise<() => void>;
  readonly dispose: () => void;
}
