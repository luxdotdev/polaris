import * as P from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { Schema } from "effect";
import { useState } from "react";
import { Field, FormBlock } from "./fields.tsx";
import { Group, Heading } from "../ui/parts.tsx";

const jsonFields = [
  [
    "formatter",
    "Configured formatter",
    "Single None, Provider or Executable selection. Executable fields: id, source, launch (executable, argv, environment).",
  ],
  ["associations", "File associations", "Array of language, filenames, extensions and patterns."],
  [
    "executableOverrides",
    "Executable overrides and environment",
    "Object keyed by provider: executable, argv and environment. Values are private.",
  ],
  ["pluginProbeRoots", "Plugin probe roots", "JSON string array of host paths."],
  ["serverSettings", "Provider settings", "JSON object keyed by provider ID."],
  ["yamlSchemas", "YAML schemas", "Array of pattern and uri objects."],
  [
    "sql",
    "SQL dialect and static schema",
    'Object: dialect, staticSchema; execution and accountAccess must be "disabled".',
  ],
] as const;

const JsonSetting = ({
  name,
  label,
  hint,
  settings,
  disabled,
  onChange,
}: {
  readonly name: (typeof jsonFields)[number][0];
  readonly label: string;
  readonly hint: string;
  readonly settings: P.LanguageSettingsPatch;
  readonly disabled: boolean;
  readonly onChange: (settings: P.LanguageSettingsPatch) => void;
}) => {
  const [text, setText] = useState(JSON.stringify(settings[name] ?? null, null, 2));
  const [error, setError] = useState("");

  const apply = () => {
    try {
      const candidate = { ...settings };
      const parsed = Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(text);

      if (parsed === null) delete candidate[name];
      else Object.assign(candidate, { [name]: parsed });
      const valid = Schema.decodeUnknownSync(P.LanguageSettingsPatch)(candidate);
      onChange(valid);
      setError("");
    } catch {
      setError(
        "Invalid configuration. Check the documented fields and limits; values are not included in errors."
      );
    }
  };

  return (
    <FormBlock>
      <Field
        label={label}
        hint={`${hint} Use null to inherit.`}
        multiline={name !== "executableOverrides" && name !== "formatter"}
        secret={name === "executableOverrides" || name === "formatter"}
        disabled={disabled}
        value={text}
        onChange={setText}
      />
      {error && (
        <p role="alert" className="text-caption">
          {error}
        </p>
      )}
      <Button className="self-start" disabled={disabled} onClick={apply}>
        Apply {label.toLowerCase()}
      </Button>
    </FormBlock>
  );
};

export const Advanced = ({
  settings,
  disabled,
  onChange,
}: {
  readonly settings: P.LanguageSettingsPatch;
  readonly disabled: boolean;
  readonly onChange: (settings: P.LanguageSettingsPatch) => void;
}) => (
  <div className="gap-gap flex flex-col">
    <Heading>Paths and file configuration</Heading>
    <Group label="Paths and associations">
      <FormBlock>
        <Field
          label="Interpreter override on host"
          hint="Empty inherits discovery."
          value={settings.interpreter ?? ""}
          disabled={disabled}
          onChange={(value) => onChange({ ...settings, interpreter: value || null })}
        />
        <Field
          label="SDK override on host"
          hint="Empty inherits discovery."
          value={settings.sdk ?? ""}
          disabled={disabled}
          onChange={(value) => onChange({ ...settings, sdk: value || null })}
        />
      </FormBlock>
      {jsonFields.map(([name, label, hint]) => (
        <JsonSetting
          key={name}
          name={name}
          label={label}
          hint={hint}
          settings={settings}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
      <FormBlock>
        <label className="text-label flex gap-2">
          <input
            type="checkbox"
            className="accent-text-strong"
            disabled={disabled}
            checked={settings.schemaNetwork === "allowed"}
            onChange={(event) =>
              onChange({
                ...settings,
                schemaNetwork: event.target.checked ? "allowed" : "disabled",
              })
            }
          />
          Allow schema network access
        </label>
        <p className="text-caption text-text-subtle">
          SQL remains offline editing with no account access or query execution.
        </p>
      </FormBlock>
    </Group>
  </div>
);
