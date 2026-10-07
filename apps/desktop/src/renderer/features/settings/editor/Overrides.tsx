/** Advanced → executable overrides on the picked Host: run your own build of a catalog server. */
import * as P from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { Schema } from "effect";
import { useState } from "react";
import { Group } from "../ui/parts.tsx";
import { EntryRow, Field, FormBlock } from "./fields.tsx";

type Overrides = NonNullable<P.LanguageSettingsPatch["executableOverrides"]>;

const EMPTY = { key: "", executable: "", argv: "[]", environment: "{}" };

const json = (text: string) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(text);

export const Overrides = ({
  overrides,
  providers,
  disabled,
  onChange,
}: {
  readonly overrides: Overrides;
  /** The catalog's provider ids, offered as a hint. */
  readonly providers: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly onChange: (overrides: Overrides) => void;
}) => {
  const [draft, setDraft] = useState(EMPTY);
  const [error, setError] = useState("");

  const add = () => {
    try {
      const launch = Schema.decodeUnknownSync(P.LanguageExecutable)({
        executable: draft.executable,
        argv: json(draft.argv),
        environment: json(draft.environment),
      });

      const next = { ...overrides, [draft.key]: launch };

      const valid = Schema.decodeUnknownSync(P.LanguageSettingsPatch)({
        executableOverrides: next,
      });

      onChange(valid.executableOverrides ?? {});
      setDraft(EMPTY);
      setError("");
    } catch {
      setError(
        "Check the provider ID, the executable path and that arguments and environment are JSON. Values aren't shown here."
      );
    }
  };

  const remove = (key: string) => {
    const { [key]: _removed, ...rest } = overrides;
    onChange(rest);
  };

  return (
    <Group label="Executable overrides">
      {Object.entries(overrides).map(([key, launch]) => (
        <EntryRow key={key} title={key} detail={launch.executable}>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove the override for ${key}`}
            onClick={() => remove(key)}
          >
            Remove
          </Button>
        </EntryRow>
      ))}
      <FormBlock>
        <Field
          label="Provider ID"
          {...(providers.length > 0 ? { hint: `One of ${providers.join(", ")}.` } : {})}
          value={draft.key}
          disabled={disabled}
          onChange={(key) => setDraft({ ...draft, key })}
        />
        <Field
          label="Executable on the host"
          value={draft.executable}
          disabled={disabled}
          onChange={(executable) => setDraft({ ...draft, executable })}
        />
        <Field
          label="Arguments"
          hint="A JSON array of strings, never a shell command."
          value={draft.argv}
          disabled={disabled}
          onChange={(argv) => setDraft({ ...draft, argv })}
        />
        <Field
          label="Environment"
          hint="A JSON object of strings. Values stay private: never shown or logged."
          secret
          value={draft.environment}
          disabled={disabled}
          onChange={(environment) => setDraft({ ...draft, environment })}
        />
        {error && (
          <p role="alert" className="text-caption text-text-default">
            {error}
          </p>
        )}
        <Button className="self-start" disabled={disabled} onClick={add}>
          Add override
        </Button>
      </FormBlock>
    </Group>
  );
};
