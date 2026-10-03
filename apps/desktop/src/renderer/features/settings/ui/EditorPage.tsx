/**
 * Settings → Editor (spec §3–4): vim keys in the Editor, and saving after a
 * short pause in typing. Both off by default; both stay on this Mac.
 */
import { Button, Switch } from "@polaris/ui";
import { useState } from "react";
import { LanguageIntegrations } from "../languages/Integration.tsx";
import { sectionInfo } from "../model/sections.ts";
import { setSessionPrefs, useSettings } from "../store.ts";
import { Column, Group, PageHeader, SettingRow } from "./parts.tsx";

export const EditorPage = () => {
  const prefs = useSettings((s) => s.sessions);
  const info = sectionInfo("editor");
  const [languages, setLanguages] = useState(false);

  if (languages) return <LanguageIntegrations onBack={() => setLanguages(false)} />;

  return (
    <Column>
      <PageHeader title={info.title} blurb={info.blurb} />
      <Group label="Language integrations">
        <SettingRow
          title="Language integrations"
          caption="Providers, formatting, custom servers, host prerequisites and checkout trust."
        >
          <Button onClick={() => setLanguages(true)}>Configure language integrations</Button>
        </SettingRow>
      </Group>
      <Group label="Keys">
        <SettingRow
          title="Vim mode"
          caption="Normal, insert and visual modes, :w, :q, :wq and :e. ⌘S, ⌘P, ⌘I, ⌘L and ⌃1…9 keep working in every mode."
          htmlFor="editor-vim"
        >
          <Switch
            id="editor-vim"
            checked={prefs.editorVim}
            onCheckedChange={(on) => setSessionPrefs({ editorVim: on })}
          />
        </SettingRow>
      </Group>
      <Group label="Saving">
        <SettingRow
          title="Autosave after a short pause"
          caption="Saves a second after you stop typing. Unsaved edits are kept on this Mac either way, and a save never overwrites a newer version on disk."
          htmlFor="editor-autosave"
        >
          <Switch
            id="editor-autosave"
            checked={prefs.editorAutosave}
            onCheckedChange={(on) => setSessionPrefs({ editorAutosave: on })}
          />
        </SettingRow>
      </Group>
    </Column>
  );
};
