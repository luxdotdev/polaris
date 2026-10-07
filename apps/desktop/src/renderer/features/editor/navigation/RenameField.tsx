/**
 * Rename (F2): a one-line field anchored under the symbol, styled like the jump menu's input.
 * ↵ asks the language server; a single answer goes straight to edit acceptance.
 */
import { useState, type KeyboardEvent } from "react";
import type { LanguageQueries } from "../lsp/queries.ts";
import { editorLanguageQueries } from "../runtime/app.ts";
import { viewOf } from "../runtime/buffers.ts";
import { closeRename, useRenameField, type RenameField as Field } from "./store.ts";

type Phase = { readonly kind: "editing" } | { readonly kind: "asking" } | { readonly kind: "none" };

const PHASE_TEXT: Readonly<Record<Phase["kind"], string>> = {
  editing: "↵ Rename",
  asking: "Renaming…",
  none: "Nothing to rename here.",
};

type Lookup = Pick<LanguageQueries, "lookup">;

const Form = ({ field, queries }: { readonly field: Field; readonly queries: Lookup | null }) => {
  const [name, setName] = useState(field.initial);
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });

  const close = () => {
    closeRename();
    viewOf(field.key)?.focus();
  };

  const submit = async () => {
    if (queries === null || name.trim() === "" || name === field.initial) return close();
    setPhase({ kind: "asking" });

    const rows = await queries
      .lookup(field.key, "rename", name.trim(), new AbortController().signal)
      .catch(() => []);

    const runnable = rows.filter((row) => row.run !== undefined);

    if (runnable.length === 0) return setPhase({ kind: "none" });
    close();
    runnable[0]?.run?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Rename symbol"
      data-testid="rename-field"
      className="rounded-row border-hairline bg-surface-raised shadow-float animate-in fade-in-0 fixed z-50 flex w-72 flex-col border duration-160 ease-out"
      style={{ left: field.left, top: field.bottom + 4 }}
    >
      <input
        autoFocus
        aria-label="New name"
        value={name}
        spellCheck={false}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          setName(event.currentTarget.value);
          setPhase({ kind: "editing" });
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (phase.kind !== "asking") closeRename();
        }}
        className="text-code text-text-strong caret-text-strong placeholder:text-text-faint h-9 bg-transparent px-3 font-mono outline-hidden"
      />
      <p className="border-hairline text-caption text-text-subtle flex justify-between border-t px-3 py-1.5">
        <span role="status">{PHASE_TEXT[phase.kind]}</span>
        <span>esc</span>
      </p>
    </div>
  );
};

export const RenameField = ({ queries }: { readonly queries?: Lookup }) => {
  const field = useRenameField();

  return field === null ? null : (
    <Form key={JSON.stringify(field)} field={field} queries={queries ?? editorLanguageQueries} />
  );
};
