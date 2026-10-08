/** Advanced → custom language servers on the picked Host: stdio servers with argv as an array and private environment. */
import * as P from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { Schema } from "effect";
import { useState } from "react";
import { Group } from "../ui/parts.tsx";
import { EntryRow, Field, FormBlock } from "./fields.tsx";

type Server = typeof P.LanguageCustomServer.Type;

const EMPTY = {
  id: "",
  executable: "",
  argv: "[]",
  environment: "{}",
  rootMarkers: "[]",
  workingDirectory: "",
  filePatterns: "[]",
  documentLanguageId: "",
  initializationOptions: "{}",
  settings: "{}",
};

type Draft = typeof EMPTY;

const draftOf = (s: Server): Draft => ({
  id: s.id,
  executable: s.launch.executable,
  argv: JSON.stringify(s.launch.argv),
  environment: JSON.stringify(s.launch.environment),
  rootMarkers: JSON.stringify(s.rootMarkers),
  workingDirectory: s.workingDirectory ?? "",
  filePatterns: JSON.stringify(s.filePatterns),
  documentLanguageId: s.documentLanguageId,
  initializationOptions: JSON.stringify(s.initializationOptions),
  settings: JSON.stringify(s.settings),
});

const json = (text: string) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(text);

export const parseCustomServer = (draft: Draft): Server =>
  Schema.decodeUnknownSync(P.LanguageCustomServer)({
    id: draft.id,
    launch: {
      executable: draft.executable,
      argv: json(draft.argv),
      environment: json(draft.environment),
    },
    rootMarkers: json(draft.rootMarkers),
    workingDirectory: draft.workingDirectory || null,
    filePatterns: json(draft.filePatterns),
    documentLanguageId: draft.documentLanguageId,
    initializationOptions: json(draft.initializationOptions),
    settings: json(draft.settings),
  });

const FIELDS: ReadonlyArray<{
  readonly key: keyof Draft;
  readonly label: string;
  readonly hint?: string;
  readonly secret?: boolean;
  readonly multiline?: boolean;
}> = [
  { key: "id", label: "Server ID" },
  { key: "executable", label: "Executable on the host" },
  { key: "argv", label: "Arguments", hint: "A JSON array of strings, never a shell command." },
  {
    key: "environment",
    label: "Environment",
    hint: "A JSON object of strings. Values stay private: never shown or logged.",
    secret: true,
  },
  { key: "documentLanguageId", label: "Document language ID" },
  { key: "filePatterns", label: "File patterns", hint: "A JSON array of globs." },
  { key: "rootMarkers", label: "Root markers", hint: "A JSON array of file names." },
  { key: "workingDirectory", label: "Working directory", hint: "Empty uses the project root." },
  { key: "initializationOptions", label: "Initialization options", multiline: true },
  { key: "settings", label: "Server settings", multiline: true },
];

export const CustomServers = ({
  servers,
  disabled,
  onChange,
}: {
  readonly servers: ReadonlyArray<Server>;
  readonly disabled: boolean;
  readonly onChange: (servers: ReadonlyArray<Server>) => void;
}) => {
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");

  const reset = () => {
    setDraft(EMPTY);
    setEditing(null);
    setError("");
  };

  const save = () => {
    try {
      const server = parseCustomServer(draft);

      if (servers.some((s) => s.id === server.id && s.id !== editing)) {
        setError("Another server already uses this ID.");

        return;
      }

      const next = [...servers.filter((s) => s.id !== editing), server];
      Schema.decodeUnknownSync(P.LanguageSettingsPatch)({ customServers: next });
      onChange(next);
      reset();
    } catch {
      setError(
        "Check the ID, the executable path and that each JSON field is the shape its hint names. Values aren't shown here."
      );
    }
  };

  return (
    <Group label="Custom language servers">
      {servers.map((server) => (
        <EntryRow key={server.id} title={server.id} detail={server.launch.executable}>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              setDraft(draftOf(server));
              setEditing(server.id);
              setError("");
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-label={`Remove ${server.id}`}
            onClick={() => onChange(servers.filter((s) => s.id !== server.id))}
          >
            Remove
          </Button>
        </EntryRow>
      ))}
      <FormBlock>
        {FIELDS.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            {...(field.hint === undefined ? {} : { hint: field.hint })}
            secret={field.secret ?? false}
            multiline={field.multiline ?? false}
            value={draft[field.key]}
            disabled={disabled}
            onChange={(value) => setDraft({ ...draft, [field.key]: value })}
          />
        ))}
        {error && (
          <p role="alert" className="text-caption text-text-default">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={disabled} onClick={save}>
            {editing === null ? "Add server" : "Save server"}
          </Button>
          {editing !== null && (
            <Button variant="ghost" onClick={reset}>
              Cancel
            </Button>
          )}
        </div>
      </FormBlock>
    </Group>
  );
};
