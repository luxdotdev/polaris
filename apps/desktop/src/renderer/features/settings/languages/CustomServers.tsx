import * as P from "@polaris/protocol";
import { Button } from "@polaris/ui";
import { Schema } from "effect";
import { useState } from "react";
import { Field, FormBlock } from "./fields.tsx";
import { Group, Heading } from "../ui/parts.tsx";

type Server = typeof P.LanguageCustomServer.Type;

const empty = () => ({
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
});

const draftOf = (s: Server) => ({
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

export const parseCustomServer = (draft: ReturnType<typeof empty>): Server =>
  Schema.decodeUnknownSync(P.LanguageCustomServer)({
    id: draft.id,
    launch: {
      executable: draft.executable,
      argv: Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(draft.argv),
      environment: Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(
        draft.environment
      ),
    },
    rootMarkers: Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(draft.rootMarkers),
    workingDirectory: draft.workingDirectory || null,
    filePatterns: Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(
      draft.filePatterns
    ),
    documentLanguageId: draft.documentLanguageId,
    initializationOptions: Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(
      draft.initializationOptions
    ),
    settings: Schema.decodeUnknownSync(Schema.fromJsonString(P.LanguageJson))(draft.settings),
  });

export const CustomServers = ({
  servers,
  disabled,
  onChange,
}: {
  readonly servers: ReadonlyArray<Server>;
  readonly disabled: boolean;
  readonly onChange: (servers: ReadonlyArray<Server>) => void;
}) => {
  const [draft, setDraft] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const update = (key: keyof typeof draft, value: string) => setDraft({ ...draft, [key]: value });

  const add = () => {
    try {
      const server = parseCustomServer(draft);

      if (servers.some((s) => s.id === server.id && s.id !== editing)) {
        setError("Choose a unique server ID.");

        return;
      }

      const next = [...servers.filter((s) => s.id !== editing), server];
      Schema.decodeUnknownSync(P.LanguageSettingsPatch)({ customServers: next });
      onChange(next);
      setDraft(empty());
      setEditing(null);
      setError("");
    } catch {
      setError(
        "Check required IDs and paths, JSON objects, and JSON string arrays. Environment names must be valid variable names. Values are not included in errors."
      );
    }
  };

  return (
    <div className="gap-gap flex flex-col">
      <Heading>Custom stdio servers</Heading>
      <Group label="Custom servers">
        <FormBlock>
          <p className="text-caption text-text-subtle">
            Runs on the file's host after trust and preflight. Saving configuration does not launch
            a server. Environment values stay private.
          </p>
        </FormBlock>
        {servers.map((server) => (
          <FormBlock key={server.id}>
            <div className="flex min-w-0 flex-wrap gap-2">
              <span className="text-label min-w-0 flex-1 break-all">
                {server.id} · {server.launch.executable}
              </span>
              <Button
                disabled={disabled}
                onClick={() => {
                  setDraft(draftOf(server));
                  setEditing(server.id);
                  setError("");
                }}
              >
                Edit {server.id}
              </Button>
              <Button
                disabled={disabled}
                variant="ghost"
                onClick={() => onChange(servers.filter((s) => s.id !== server.id))}
              >
                Remove {server.id}
              </Button>
            </div>
          </FormBlock>
        ))}
        <FormBlock>
          <Field
            label="Server ID"
            value={draft.id}
            disabled={disabled}
            onChange={(v) => update("id", v)}
          />
          <Field
            label="Executable on host"
            value={draft.executable}
            disabled={disabled}
            onChange={(v) => update("executable", v)}
          />
          <Field
            label="Arguments (JSON string array)"
            value={draft.argv}
            disabled={disabled}
            onChange={(v) => update("argv", v)}
          />
          <Field
            label="Environment (private JSON object)"
            hint="String values; kept out of logs and Host fact rows."
            secret
            value={draft.environment}
            disabled={disabled}
            onChange={(v) => update("environment", v)}
          />
          <Field
            label="Root markers (JSON string array)"
            value={draft.rootMarkers}
            disabled={disabled}
            onChange={(v) => update("rootMarkers", v)}
          />
          <Field
            label="Working directory on host"
            hint="Leave empty to use discovery."
            value={draft.workingDirectory}
            disabled={disabled}
            onChange={(v) => update("workingDirectory", v)}
          />
          <Field
            label="File patterns (JSON string array)"
            value={draft.filePatterns}
            disabled={disabled}
            onChange={(v) => update("filePatterns", v)}
          />
          <Field
            label="Document language ID"
            value={draft.documentLanguageId}
            disabled={disabled}
            onChange={(v) => update("documentLanguageId", v)}
          />
          <Field
            label="Initialization options (JSON object)"
            multiline
            value={draft.initializationOptions}
            disabled={disabled}
            onChange={(v) => update("initializationOptions", v)}
          />
          <Field
            label="Server settings (JSON object)"
            multiline
            value={draft.settings}
            disabled={disabled}
            onChange={(v) => update("settings", v)}
          />
          {error && (
            <p role="alert" className="text-caption">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button disabled={disabled} onClick={add}>
              {editing ? "Apply server changes" : "Add server"}
            </Button>
            {editing && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(null);
                  setDraft(empty());
                  setError("");
                }}
              >
                Cancel server edit
              </Button>
            )}
          </div>
        </FormBlock>
      </Group>
    </div>
  );
};
