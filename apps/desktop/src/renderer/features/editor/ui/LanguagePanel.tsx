import { Button } from "@polaris/ui";
import { LANGUAGE_NAMES, LANGUAGES, type LanguageId } from "../model/language.ts";
import { fileKey } from "../model/drafts.ts";
import { editorLanguages, editorLanguageQueries } from "../runtime/app.ts";
import { useLanguage } from "../lsp/state.ts";
import { viewOf } from "../runtime/buffers.ts";

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
    <label className="text-caption text-text-subtle flex w-full items-center justify-between gap-2">
      <span>Language mode</span>
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

/**
 * The results panel under the code (Problems, Definitions, References, Code actions…), opened
 * by the language commands (`navigation/commands.ts`). Language state lives in the pill.
 */
export const LanguagePanel = ({
  hostKey,
  path,
}: {
  readonly hostKey: string;
  readonly path: string;
}) => {
  const key = fileKey(hostKey, path);
  const state = useLanguage(key);

  return (
    <>
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
                    <span className="max-w-[min(100%,72ch)] break-words whitespace-pre-wrap">
                      {row.label}
                    </span>
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
