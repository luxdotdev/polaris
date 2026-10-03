import { Button } from "@polaris/ui";
import { useState } from "react";
import { LANGUAGE_NAMES, LANGUAGES, type LanguageId } from "../model/language.ts";
import { fileKey } from "../model/drafts.ts";
import { editorLanguages, editorLanguageQueries } from "../runtime/app.ts";
import { useLanguage } from "../lsp/state.ts";
import type { LanguageCommand } from "../lsp/queries.ts";
import { viewOf } from "../runtime/buffers.ts";

const choices: readonly { readonly id: LanguageCommand; readonly name: string }[] = [
  { id: "definition", name: "Go to definition" },
  { id: "typeDefinition", name: "Go to type definition" },
  { id: "implementation", name: "Go to implementation" },
  { id: "references", name: "Find references" },
  { id: "symbols", name: "Document symbols" },
  { id: "workspaceSymbols", name: "Workspace symbols" },
  { id: "signature", name: "Signature help" },
  { id: "problems", name: "Problems" },
  { id: "actions", name: "Code actions" },
  { id: "rename", name: "Rename symbol" },
];

export const LanguageSelector = ({
  hostKey,
  path,
  language,
}: {
  readonly hostKey: string;
  readonly path: string;
  readonly language: LanguageId;
}) => {
  const key = fileKey(hostKey, path);
  const state = useLanguage(key);

  return (
    <label className="text-caption text-text-subtle flex items-center gap-1">
      <span className="sr-only">File language</span>
      <select
        aria-label="File language"
        title="Choose a language for this open file"
        value={state?.manual ?? "auto"}
        onChange={(event) => {
          const value = event.currentTarget.value;
          const selected = Object.keys(LANGUAGES).find((id) => id === value);
          editorLanguages?.select(key, selected === undefined ? null : languageId(selected));
        }}
        className="bg-bg text-text-default focus-visible:outline-starlight rounded-control max-w-48 focus-visible:outline-2"
      >
        <option value="auto">Auto · {LANGUAGE_NAMES[language]}</option>
        {Object.entries(LANGUAGES).map(([id, value]) => (
          <option key={id} value={id}>
            {value.name}
          </option>
        ))}
      </select>
    </label>
  );
};

const languageId = (id: string): LanguageId => {
  for (const key of Object.keys(LANGUAGES))
    if (key === id) {
      // SAFETY: the value was selected from the typed language metadata keys.
      return key as LanguageId;
    }

  return "plain";
};

export const LanguageTools = ({
  hostKey,
  path,
}: {
  readonly hostKey: string;
  readonly path: string;
}) => {
  const key = fileKey(hostKey, path);
  const state = useLanguage(key);
  const [command, setCommand] = useState<LanguageCommand>("definition");
  const [query, setQuery] = useState("");
  const run = () => void editorLanguageQueries?.run(key, command, query);

  return (
    <>
      <div
        className="border-hairline text-caption text-text-subtle min-h-row gap-gap px-row-x flex shrink-0 items-center border-b"
        role="group"
        aria-label="Language tools"
      >
        <select
          aria-label="Language action"
          value={command}
          className="bg-bg text-text-default focus-visible:outline-starlight rounded-control max-w-48 focus-visible:outline-2"
          onChange={(event) => {
            const choice = choices.find((value) => value.id === event.currentTarget.value);

            if (choice) setCommand(choice.id);
          }}
        >
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
        </select>
        {command === "workspaceSymbols" || command === "rename" ? (
          <input
            aria-label={command === "rename" ? "New symbol name" : "Workspace symbol query"}
            placeholder={command === "rename" ? "New name" : "Symbol name"}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") run();
            }}
            className="bg-bg text-text-default focus-visible:outline-starlight rounded-control min-w-0 border px-2"
          />
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={state?.status !== "ready" || state.busy}
          onClick={run}
        >
          Go
        </Button>
        <Button size="sm" variant="ghost" onClick={() => editorLanguageQueries?.back()}>
          Back
        </Button>
        <span role="status" className="min-w-0 truncate">
          {state?.status === "ready"
            ? state.providers.join(" · ")
            : (state?.fact ?? "Local syntax")}
        </span>
      </div>
      {state?.panel === null || state === undefined ? null : (
        <section
          aria-label={state.panel}
          className="border-hairline bg-surface-raised max-h-64 shrink-0 overflow-auto border-t"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              editorLanguageQueries?.close(key);
              viewOf(key)?.focus();
            }
          }}
        >
          <div className="text-caption text-text-default min-h-row px-row-x flex items-center justify-between">
            <h2>{state.panel}</h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                editorLanguageQueries?.close(key);
                viewOf(key)?.focus();
              }}
            >
              Close
            </Button>
          </div>
          {state.busy ? (
            <p role="status" className="text-caption text-text-subtle px-row-x py-gap">
              Loading…
            </p>
          ) : state.rows.length === 0 ? (
            <p className="text-caption text-text-subtle px-row-x py-gap">
              No results for this document. The provider may not support this feature.
            </p>
          ) : (
            <ul className="text-caption">
              {state.rows.map((row, index) => (
                <li key={index} className="border-hairline border-t">
                  <button
                    type="button"
                    onClick={() => void editorLanguageQueries?.navigate(key, row)}
                    disabled={row.run === undefined && row.range === undefined}
                    className="text-text-default hover:bg-fill-hover focus-visible:outline-starlight px-row-x py-gap flex w-full flex-col items-start gap-1 text-left focus-visible:outline-2"
                  >
                    <span className="max-w-full break-words whitespace-pre-wrap">{row.label}</span>
                    <span className="text-text-subtle max-w-full truncate">{row.detail}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
};
