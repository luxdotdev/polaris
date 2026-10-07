/**
 * Go to symbol in workspace (⌘T): the jump menu's card, asking the open file's language
 * servers as you type. ↵ opens the symbol.
 */
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@polaris/ui";
import { useEffect, useState } from "react";
import type { LanguageRow } from "../lsp/state.ts";
import type { LanguageQueries } from "../lsp/queries.ts";
import { editorLanguageQueries } from "../runtime/app.ts";
import { viewOf } from "../runtime/buffers.ts";
import { closeSymbolSearch, useSymbolSearch } from "./store.ts";

const where = (row: LanguageRow) => {
  const file = row.uri === undefined ? "" : decodeURI(row.uri.split("/").pop() ?? "");

  return row.range === undefined ? file : `${file}:${row.range.start.line + 1}`;
};

type Symbols = Pick<LanguageQueries, "lookup" | "navigate">;

const useSymbols = (queries: Symbols | null, key: string, query: string) => {
  const [rows, setRows] = useState<readonly LanguageRow[] | null>(null);

  useEffect(() => {
    if (query.trim() === "") {
      setRows(null);

      return;
    }

    const controller = new AbortController();

    const timer = setTimeout(() => {
      void queries
        ?.lookup(key, "workspaceSymbols", query.trim(), controller.signal)
        .then((found) => {
          if (!controller.signal.aborted) setRows(found.slice(0, 200));
        })
        .catch(() => undefined);
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [queries, key, query]);

  return rows;
};

const Results = ({
  fileKey,
  queries,
}: {
  readonly fileKey: string;
  readonly queries: Symbols | null;
}) => {
  const [query, setQuery] = useState("");
  const rows = useSymbols(queries, fileKey, query);

  const pick = (row: LanguageRow) => {
    closeSymbolSearch();
    void queries?.navigate(fileKey, row).then(() => viewOf(fileKey)?.focus());
  };

  return (
    <>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Go to symbol in workspace"
        aria-label="Symbol name"
      />
      <CommandList aria-label="Symbols">
        <CommandEmpty>{rows === null ? "Type a symbol's name" : "No symbols match"}</CommandEmpty>
        {rows === null || rows.length === 0 ? null : (
          <CommandGroup heading="Symbols">
            {rows.map((row, index) => (
              <CommandItem
                key={`${index}:${row.label}`}
                value={`${index}:${row.label}`}
                data-testid="symbol-item"
                detail={row.detail}
                meta={where(row)}
                onSelect={() => pick(row)}
              >
                {row.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <CommandFooter>
        <span>↑↓ Move</span>
        <span>↵ Open</span>
        <span className="flex-1" />
        <span>esc</span>
      </CommandFooter>
    </>
  );
};

export const SymbolSearch = ({ queries }: { readonly queries?: Symbols }) => {
  const key = useSymbolSearch();

  if (key === null) return null;

  return (
    <CommandDialog
      open
      onOpenChange={(next) => {
        if (!next) closeSymbolSearch();
      }}
      shouldFilter={false}
      title="Go to symbol in workspace"
      description="Find a symbol in this workspace by name"
    >
      <Results fileKey={key} queries={queries ?? editorLanguageQueries} />
    </CommandDialog>
  );
};
