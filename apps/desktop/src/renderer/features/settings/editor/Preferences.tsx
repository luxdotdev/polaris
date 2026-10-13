/** The Editor preferences group (Paper L4): language preferences, then the Editor's own keys and saving. */
import * as P from "@polaris/protocol";
import { Switch } from "@polaris/ui";
import { currentKeyPlatform, shortcutLabel } from "../../../../shared/chord.ts";
import { commandShortcut, digitChord } from "../../../../shared/keymap.ts";
import type { ReactNode } from "react";
import { Group } from "../ui/parts.tsx";
import { withKey, type SettingsRecord } from "./records.ts";

const vimCaption = () => {
  const kept = (
    ["editor.save", "editor.findFile", "editor.inlineChat", "editor.addToSession"] as const
  )
    .map((id) => commandShortcut(id))
    .join(", ");

  const chip = shortcutLabel(digitChord(0, currentKeyPlatform()) ?? "Ctrl+1");

  return `Normal, insert and visual modes, :w, :q, :wq and :e. ${kept} and ${chip}…9 keep working in every mode.`;
};

type Change = (settings: P.LanguageSettingsPatch) => P.LanguageSettingsPatch;

/** A preference: its name in `body` medium, an optional caption, and its switch. */
export const PreferenceRow = ({
  id,
  title,
  caption,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly caption?: string;
  readonly children: ReactNode;
}) => (
  <div className="px-panel flex items-center gap-4 py-[calc(var(--spacing-gap)+4px)]">
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <label htmlFor={id} className="text-body text-text-strong font-medium">
        {title}
      </label>
      {caption && <span className="text-caption text-text-subtle">{caption}</span>}
    </div>
    {children}
  </div>
);

export interface EditorKeys {
  readonly vim: boolean;
  readonly autosave: boolean;
  readonly onVim: (on: boolean) => void;
  readonly onAutosave: (on: boolean) => void;
  readonly inlineDiagnostics: boolean;
  readonly onInlineDiagnostics: (on: boolean) => void;
}

export const Preferences = ({
  record,
  failed,
  onChange,
  keys,
}: {
  /** The App-scope language settings record; null while it loads. */
  readonly record: SettingsRecord | null;
  readonly failed: boolean;
  readonly onChange: (change: Change) => void;
  readonly keys: EditorKeys;
}) => {
  const settings = record?.settings ?? {};

  return (
    <Group label="Editor preferences">
      <PreferenceRow
        id="editor-format-on-save"
        title="Format on save"
        caption="Each language's formatter, using the project's own config."
      >
        <Switch
          id="editor-format-on-save"
          disabled={record === null}
          checked={settings.formatOnSave ?? true}
          onCheckedChange={(on) => onChange(withKey("formatOnSave", on))}
        />
      </PreferenceRow>
      <PreferenceRow
        id="editor-download-tools"
        title="Download language tools automatically"
        caption="The first time you open a file, Polaris fetches its pinned language server to that host. Interpreters and toolchains stay yours."
      >
        <Switch
          id="editor-download-tools"
          disabled={record === null}
          checked={settings.downloadLanguageToolsAutomatically ?? true}
          onCheckedChange={(on) => onChange(withKey("downloadLanguageToolsAutomatically", on))}
        />
      </PreferenceRow>
      <PreferenceRow id="editor-vim" title="Vim mode" caption={vimCaption()}>
        <Switch id="editor-vim" checked={keys.vim} onCheckedChange={keys.onVim} />
      </PreferenceRow>
      <PreferenceRow
        id="editor-autosave"
        title="Autosave after a short pause"
        caption="Saves a second after you stop typing. Unsaved edits are kept on this Mac either way, and a save never overwrites a newer version on disk."
      >
        <Switch id="editor-autosave" checked={keys.autosave} onCheckedChange={keys.onAutosave} />
      </PreferenceRow>
      <PreferenceRow
        id="editor-inline-diagnostics"
        title="Inline diagnostics"
        caption="Each line's most severe error, warning or info at its end. Squiggles and the hover stay either way."
      >
        <Switch
          id="editor-inline-diagnostics"
          checked={keys.inlineDiagnostics}
          onCheckedChange={keys.onInlineDiagnostics}
        />
      </PreferenceRow>
      {failed && (
        <p role="status" className="px-panel text-caption text-text-subtle py-2">
          Couldn't read or save these language preferences. Try again.
        </p>
      )}
    </Group>
  );
};
