import type { EditorView } from "@codemirror/view";

export interface SaveProofControls {
  readonly run: () => Promise<{
    facts: string[];
    calls: string[];
    disk: string | null;
    watches: number;
  }>;
  readonly edit: (text: string) => Promise<EditorView>;
  readonly save: () => Promise<boolean>;
  readonly enable: (value: boolean) => void;
  readonly cleanup: () => number;
}

declare global {
  interface Window {
    saveProof: SaveProofControls;
  }
}
