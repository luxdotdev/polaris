import { useState } from "react";
import {
  Input,
  Kbd,
  SettingsButton,
  SettingsCard,
  SettingsEmpty,
  SettingsPage,
  SettingsRow,
  SettingsWell,
} from "@polaris/ui";
import { currentKeyPlatform, shortcutLabel } from "../../../../shared/chord.ts";
import { clientCopy } from "../../../../shared/clientCopy.ts";
import { defaultKeymapFor, type KeyBinding } from "../../../../shared/keymap.ts";
import {
  resolveKeybindings,
  type KeybindingOverridesValue,
} from "../../../../shared/keybindingResolution.ts";
import { useSettings, setKeybindings } from "../store.ts";
import { Recorder, replaceOverride } from "./Recorder.tsx";

export const KeyboardPage = () => {
  const overrides = useSettings((s) => s.keybindings);
  const [query, setQuery] = useState("");
  const [recording, setRecording] = useState<KeyBinding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const platform = currentKeyPlatform();
  const defaults = defaultKeymapFor(platform);
  const { bindings, conflicts } = resolveKeybindings(defaults, overrides, platform);

  const rows = defaults.filter((b) =>
    `${b.title} ${b.id}`.toLowerCase().includes(query.toLowerCase())
  );

  const save = async (next: KeybindingOverridesValue) => {
    setSaving(true);

    const failure = await setKeybindings(next).finally(() => setSaving(false));
    setError(failure);

    return failure;
  };

  const reset = (id: string) =>
    void save(Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id)));

  return (
    <SettingsPage
      title="Keyboard"
      blurb="Customize shortcuts on this client. Changes apply immediately."
      scope={clientCopy().machine}
    >
      <Input
        aria-label="Find an action"
        placeholder="Find an action…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error !== null && (
        <p role="alert" className="text-caption text-text-default">
          Couldn’t save shortcuts: {error}
        </p>
      )}
      <SettingsCard
        title="Shortcuts"
        aside={`${conflicts.length} conflicts`}
        action={
          <SettingsButton
            disabled={saving || Object.keys(overrides).length === 0}
            onClick={() => void save({})}
          >
            Reset all
          </SettingsButton>
        }
        status="Changes stay on this client · click a shortcut to record a replacement"
      >
        <SettingsWell>
          {rows.length === 0 && <SettingsEmpty>No actions match “{query}”.</SettingsEmpty>}
          {rows.map((action) => {
            const active = bindings.find((b) => b.id === action.id)?.keys ?? [];
            const conflict = conflicts.filter((c) => c.id === action.id);

            const caption =
              conflict.length > 0
                ? `Conflicting: ${conflict.map((c) => `${shortcutLabel(c.key, platform)} is assigned to ${defaults.find((b) => b.id === c.winner)?.title ?? c.winner}`).join("; ")}`
                : action.id;

            return (
              <SettingsRow
                key={action.id}
                title={action.title}
                wrap
                caption={<span title={caption}>{caption}</span>}
                className="flex-wrap"
              >
                <div className="flex flex-wrap justify-end gap-1.5">
                  <SettingsButton
                    variant="ghost"
                    aria-label={`Rebind ${action.title}`}
                    disabled={saving}
                    onClick={() => setRecording(action)}
                  >
                    {active.length === 0
                      ? "Unbound"
                      : active.map((key) => <Kbd key={key}>{shortcutLabel(key, platform)}</Kbd>)}
                  </SettingsButton>
                  <SettingsButton
                    variant="ghost"
                    aria-label={`Unbind ${action.title}`}
                    disabled={saving || active.length === 0}
                    onClick={() => void save(replaceOverride(overrides, action.id, null))}
                  >
                    Unbind
                  </SettingsButton>
                  <SettingsButton
                    variant="quiet"
                    aria-label={`Reset ${action.title}`}
                    disabled={saving || overrides[action.id] === undefined}
                    onClick={() => reset(action.id)}
                  >
                    Reset
                  </SettingsButton>
                </div>
              </SettingsRow>
            );
          })}
        </SettingsWell>
      </SettingsCard>
      {recording !== null && (
        <Recorder
          action={recording}
          overrides={overrides}
          close={() => setRecording(null)}
          save={save}
        />
      )}
    </SettingsPage>
  );
};
