import * as P from "@polaris/protocol";
import { Button, Switch } from "@polaris/ui";
import { Match } from "effect";
import type { LanguageSettingsSnapshot } from "../../settings/languages/contracts.ts";
import { Choice, FormBlock } from "../../settings/languages/fields.tsx";
import { Group, Heading } from "../../settings/ui/parts.tsx";

export const formatterLabel = (formatter: P.LanguageFormatterSelection) =>
  Match.value(formatter).pipe(
    Match.tag("None", () => "None"),
    Match.tag("Provider", (v) => v.providerId),
    Match.tag("Executable", (v) => `${v.id} · ${v.source} · ${v.launch.executable}`),
    Match.exhaustive
  );

export const LanguagePreferences = ({
  snapshot,
  settings,
  disabled,
  onChange,
}: {
  readonly snapshot: LanguageSettingsSnapshot;
  readonly settings: P.LanguageSettingsPatch;
  readonly disabled: boolean;
  readonly onChange: (settings: P.LanguageSettingsPatch) => void;
}) => {
  const selected = settings.formatter;

  const providerOptions = [
    ...snapshot.providers,
    ...(settings.customServers ?? [])
      .filter((s) => !snapshot.providers.some((p) => p.id === s.id))
      .map((s) => ({ id: s.id, name: `${s.id} · custom stdio server` })),
  ];

  const formatterOptions = [
    ...snapshot.formatters,
    ...(settings.customServers ?? []).map((s) => ({
      key: `custom:${s.id}`,
      name: `${s.id} · custom server formatter`,
      selection: P.LanguageFormatterSelection.cases.Provider.make({ providerId: s.id }),
    })),
  ];

  const formatterKey =
    selected === undefined
      ? "inherit"
      : (formatterOptions.find((f) => JSON.stringify(f.selection) === JSON.stringify(selected))
          ?.key ??
        Match.value(selected).pipe(
          Match.tag("None", () => "none"),
          Match.orElse(() => "unlisted")
        ));

  const choose = (key: string) => {
    const next = { ...settings };

    if (key === "inherit") delete next.formatter;
    else if (key === "none") next.formatter = P.LanguageFormatterSelection.cases.None.make({});
    else {
      const choice = formatterOptions.find((f) => f.key === key);

      if (!choice) return;
      next.formatter = choice.selection;
    }

    onChange(next);
  };

  const providers = settings.providers ?? snapshot.effective.providers;

  return (
    <div className="gap-gap flex flex-col">
      <Heading>Providers and saving</Heading>
      <Group label="Language preferences">
        <FormBlock>
          <label htmlFor="language-format-save" className="text-label">
            Format on save
          </label>
          <Switch
            id="language-format-save"
            disabled={disabled}
            checked={settings.formatOnSave ?? snapshot.effective.formatOnSave}
            onCheckedChange={(value) => onChange({ ...settings, formatOnSave: value })}
          />
          <p className="text-caption text-text-subtle">
            On by default. Formatting respects repository configuration. If formatting fails, the
            editor saves text and explains the failure.
          </p>
          <p className="text-caption">
            {settings.formatOnSave === undefined ? "Inherited" : "Overridden"} · effective
            formatter: {formatterLabel(snapshot.effective.formatter)}
          </p>
          <Choice label="One formatter" value={formatterKey} disabled={disabled} onChange={choose}>
            <option value="inherit">Inherit formatter</option>
            <option value="none">None</option>
            {formatterKey === "unlisted" && (
              <option value="unlisted">
                Configured formatter · {selected && formatterLabel(selected)}
              </option>
            )}
            {formatterOptions.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </Choice>
          <p className="text-caption text-text-subtle">
            Selected providers run in the listed order; one formatter owns saving.
          </p>
          {[...new Set([...providerOptions.map((p) => p.id), ...providers])].map((id) => (
            <label key={id} className="text-label flex min-w-0 items-start gap-2">
              <input
                type="checkbox"
                className="accent-text-strong"
                disabled={disabled}
                checked={providers.includes(id)}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    providers: event.target.checked
                      ? [...providers, id]
                      : providers.filter((p) => p !== id),
                  })
                }
              />
              <span className="break-words">
                {providerOptions.find((p) => p.id === id)?.name ?? `${id} (unavailable provider)`}
              </span>
            </label>
          ))}
          <p className="text-caption break-words">
            Provider order: {providers.join(" → ") || "none"}
          </p>
          <Button
            className="self-start"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              const next = { ...settings };
              delete next.providers;
              delete next.formatter;
              delete next.formatOnSave;
              onChange(next);
            }}
          >
            Inherit provider and save defaults
          </Button>
        </FormBlock>
      </Group>
    </div>
  );
};
