import type { EditorView } from "@codemirror/view";
import type * as P from "@polaris/protocol";
import type { LanguageId } from "../model/language.ts";
import type { EditorFile } from "../api.ts";

/** A buffer retains this interest when its source tab is hidden or a Markdown preview is shown. */
export interface EditorLanguageLifetime {
  readonly selectedLanguage: () => LanguageId | null;
  readonly edited: () => void;
  readonly saved: (version: number, diskVersion: P.FileVersion) => void;
  readonly dispose: () => void;
}

export interface EditorLanguageMount {
  readonly file: EditorFile;
  readonly root: string;
  readonly view: EditorView;
  readonly revision: () => number;
  readonly manual?: LanguageId | null;
}

export interface EditorLanguagePort {
  readonly mount: (input: EditorLanguageMount) => EditorLanguageLifetime;
}

export interface AuthenticatedLanguageIdentity {
  readonly hostId: P.HostId;
  readonly clientId: string;
  readonly connectionEpoch: number;
}

/** Main installs an independent authenticated identity lookup; absent means unavailable. */
export type LanguageIdentityLookup = (hostKey: string) => AuthenticatedLanguageIdentity | null;
