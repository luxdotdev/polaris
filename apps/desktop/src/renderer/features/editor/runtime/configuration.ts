import type { FormattingPort } from "../formatting/index.ts";
import type { GroupStore } from "../refactors/group.ts";
import type { KeyValue } from "../model/drafts.ts";
import type { SpillStore } from "../model/draftStore.ts";
import type { EditorFiles } from "../files/port.ts";
import type { EditorLanguagePort } from "../lsp/lifecycle.ts";
import type { EditorLanguageCoordinator } from "../lsp/integration.ts";
import type { LanguageQueries } from "../lsp/queries.ts";

export interface EditorPrefs {
  readonly vim: boolean;
  readonly autosave: boolean;
}

export interface EditorConfig {
  readonly languageRuntime?: { coordinator: EditorLanguageCoordinator; queries: LanguageQueries };
  readonly languages?: EditorLanguagePort;
  readonly formatting?: FormattingPort;
  readonly groups?: GroupStore | undefined;
  readonly files: EditorFiles;
  /** Where drafts are kept; null keeps them in memory only. */
  readonly kv: KeyValue | null;
  /** Where big drafts' text goes (IndexedDB in the app). */
  readonly spill?: SpillStore | null;
  readonly prefs: () => EditorPrefs;
  /** The Host's name for messages ("Mac Studio"). */
  readonly hostLabel: (hostKey: string) => string;
  /** The Host's home directory, for `~` in paths; null until it has said. */
  readonly hostHome: (hostKey: string) => string | null;
  /** Whether a Host's Daemon can save (capability `files.write`). */
  readonly canWrite: (hostKey: string) => boolean;
}
