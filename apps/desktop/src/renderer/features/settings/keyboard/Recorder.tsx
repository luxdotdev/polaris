import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Kbd,
  SettingsButton,
} from "@polaris/ui";
import { hasBridge, polaris } from "../../bridge.ts";
import { currentKeyPlatform, shortcutLabel } from "../../../../shared/chord.ts";
import { bindingUnavailable, recordedBinding } from "../../../../shared/keybindingOverrides.ts";
import { defaultKeymapFor, type KeyBinding } from "../../../../shared/keymap.ts";
import {
  resolveKeybindings,
  type KeybindingOverridesValue,
} from "../../../../shared/keybindingResolution.ts";

export const replaceOverride = (
  overrides: KeybindingOverridesValue,
  id: string,
  value: string | null
): KeybindingOverridesValue => ({
  ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id)),
  [id]: value,
});

export const Recorder = ({
  action,
  overrides,
  close,
  save,
}: {
  readonly action: KeyBinding;
  readonly overrides: KeybindingOverridesValue;
  readonly close: () => void;
  readonly save: (value: KeybindingOverridesValue) => Promise<string | null>;
}) => {
  const recordButton = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const platform = currentKeyPlatform();

  useEffect(() => {
    const toggle = hasBridge() ? polaris().setKeybindingRecording : undefined;
    let mounted = true;
    void (toggle?.(true) ?? Promise.resolve(true))
      .then((ok) => {
        if (!mounted) return;
        setReady(ok);

        if (!ok) setError("Couldn’t start shortcut recording.");
      })
      .catch(() => {
        if (mounted) setError("Couldn’t start shortcut recording.");
      });

    return () => {
      mounted = false;
      void toggle?.(false).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (ready) recordButton.current?.focus();
  }, [ready]);

  const conflicts =
    key === null
      ? []
      : resolveKeybindings(
          defaultKeymapFor(platform),
          replaceOverride(overrides, action.id, key),
          platform
        ).conflicts.filter((c) => c.winner === action.id);

  const commit = async () => {
    if (key === null) return;
    setSaving(true);
    const failure = await save(replaceOverride(overrides, action.id, key));
    setSaving(false);

    if (failure === null) close();
    else setError(failure);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) close();
      }}
    >
      <DialogContent
        data-keybinding-recorder
        aria-describedby="record-description"
        className="p-panel gap-gap w-[440px] max-w-[calc(100%-2rem)]"
      >
        <DialogTitle>Rebind {action.title}</DialogTitle>
        <DialogDescription id="record-description">
          Press a shortcut, then save. Escape cancels.
        </DialogDescription>
        <button
          ref={recordButton}
          type="button"
          disabled={saving || !ready}
          aria-label="Record shortcut"
          className="border-hairline bg-well text-text-strong rounded-control text-body p-panel min-h-16 border"
          onKeyDown={(event) => {
            if (!ready || event.key === "Escape") return;

            // Tab can be recorded while still moving focus to Cancel and Save.
            if (event.key !== "Tab") {
              event.preventDefault();
              event.stopPropagation();
            }

            if (event.repeat || event.nativeEvent.isComposing) return;
            const binding = recordedBinding(event);

            if (binding === null) return;
            const unavailable = bindingUnavailable(binding);
            setError(unavailable);
            setKey(unavailable === null ? binding : null);
          }}
        >
          {key === null ? (
            ready ? (
              "Press shortcut here"
            ) : (
              "Preparing recorder…"
            )
          ) : (
            <Kbd>{shortcutLabel(key)}</Kbd>
          )}
        </button>
        <div aria-live="polite" className="text-caption text-text-subtle">
          {error ??
            (conflicts.length === 0
              ? "One shortcut per action."
              : `Takes this shortcut from ${conflicts.map((c) => defaultKeymapFor(platform).find((b) => b.id === c.id)?.title ?? c.id).join(", ")}. Those actions will show a conflict.`)}
        </div>
        <div className="gap-gap flex justify-end">
          <SettingsButton variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </SettingsButton>
          <SettingsButton
            variant="primary"
            disabled={key === null || saving}
            onClick={() => void commit()}
          >
            {saving ? "Saving…" : "Save shortcut"}
          </SettingsButton>
        </div>
      </DialogContent>
    </Dialog>
  );
};
