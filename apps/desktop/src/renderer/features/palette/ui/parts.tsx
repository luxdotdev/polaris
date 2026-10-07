/**
 * The palette card's parts (Paper L5): the "›" field with its ⇧⌘P cap, labelled
 * groups of 34px rows with right-aligned shortcuts, and the key-hint footer.
 * The field owns focus; rows are options of an ARIA listbox it controls.
 */
import { cn, Kbd } from "@polaris/ui";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";

export interface ShownRow {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly shortcut: string;
  readonly ariaKeys: string;
  readonly disabled: boolean;
}

export interface ShownSection {
  readonly key: string;
  /** Null for a follow-up's one unlabelled list. */
  readonly heading: ReactNode;
  readonly rows: ReadonlyArray<ShownRow>;
}

const optionId = (list: string, row: string) => `${list}-${row.replace(/[^\w-]/g, "_")}`;

export interface PaletteRowProps {
  readonly row: ShownRow;
  readonly id: string;
  readonly selected: boolean;
  readonly onHover: () => void;
  readonly onChoose: () => void;
}

export const PaletteRow = ({ row, id, selected, onHover, onChoose }: PaletteRowProps) => (
  <div
    id={id}
    role="option"
    aria-selected={selected}
    aria-disabled={row.disabled || undefined}
    aria-keyshortcuts={row.ariaKeys === "" ? undefined : row.ariaKeys}
    data-testid="palette-row"
    data-command={row.id}
    data-selected={selected}
    onMouseMove={row.disabled ? undefined : onHover}
    onClick={row.disabled ? undefined : onChoose}
    className={cn(
      "rounded-row px-row-x gap-row-x flex h-[calc(var(--spacing-row)+2px)] shrink-0 cursor-default items-center select-none",
      selected ? "bg-fill-selected" : null,
      row.disabled ? "opacity-(--opacity-dimmed)" : null
    )}
  >
    <span
      className={cn(
        "text-body truncate",
        selected ? "text-text-strong" : "text-text-default",
        row.detail === "" ? "flex-1" : "shrink-0"
      )}
    >
      {row.title}
    </span>
    {row.detail === "" ? null : (
      <span className="text-caption text-text-faint min-w-0 flex-1 truncate">{row.detail}</span>
    )}
    {row.shortcut === "" ? null : (
      <span
        aria-hidden
        className={cn("text-caption shrink-0", selected ? "text-text-subtle" : "text-text-faint")}
      >
        {row.shortcut}
      </span>
    )}
  </div>
);

export const PaletteFooter = ({
  hints,
  count,
}: {
  readonly hints: ReadonlyArray<string>;
  readonly count: number | null;
}) => (
  <div className="border-hairline gap-panel px-panel text-caption text-text-faint flex h-9 shrink-0 items-center border-t">
    {hints.map((hint) => (
      <span key={hint}>{hint}</span>
    ))}
    <span className="flex-1" />
    {count === null ? null : (
      <span role="status" data-testid="palette-count">
        {count} {count === 1 ? "command" : "commands"}
      </span>
    )}
  </div>
);

export interface RowListProps {
  readonly query: string;
  readonly onQuery: (query: string) => void;
  readonly placeholder: string;
  readonly label: string;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly selected: string | null;
  readonly sections: ReadonlyArray<ShownSection>;
  /** A follow-up's context line, above its choices. */
  readonly note?: string | undefined;
  readonly onHover: (id: string) => void;
  readonly onChoose: (id: string) => void;
  readonly footer: ReactNode;
}

export const RowList = ({
  query,
  onQuery,
  placeholder,
  label,
  onKeyDown,
  selected,
  sections,
  note,
  onHover,
  onChoose,
  footer,
}: RowListProps) => {
  const list = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const empty = sections.every((s) => s.rows.length === 0);

  // The highlighted row stays in view as ↑↓ and Tab move it.
  useEffect(() => {
    if (selected === null) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(list, selected))}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [list, selected]);

  return (
    <>
      <div className="border-hairline h-session-row px-panel gap-row-x flex shrink-0 items-center border-b">
        <span aria-hidden className="text-heading-sm text-text-subtle font-mono font-medium">
          ›
        </span>
        <input
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls={list}
          aria-autocomplete="list"
          aria-label={label}
          aria-activedescendant={selected === null ? undefined : optionId(list, selected)}
          data-testid="palette-input"
          value={query}
          placeholder={placeholder}
          spellCheck={false}
          onChange={(event) => onQuery(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          className="text-heading-sm text-text-strong caret-starlight placeholder:text-text-faint h-full min-w-0 flex-1 bg-transparent outline-hidden"
        />
        <Kbd aria-hidden>⇧⌘P</Kbd>
      </div>
      {note === undefined ? null : (
        <p className="px-panel pt-gap text-caption text-text-subtle">{note}</p>
      )}
      <div
        ref={listRef}
        id={list}
        role="listbox"
        aria-label={label}
        className="px-gap pt-gap max-h-[420px] overflow-x-hidden overflow-y-auto pb-1"
      >
        {empty ? (
          <p className="px-row-x text-caption text-text-subtle py-3">Nothing matches</p>
        ) : null}
        {sections.map((section) =>
          section.rows.length === 0 ? null : (
            <div
              key={section.key}
              role="group"
              aria-labelledby={section.heading === null ? undefined : `${list}-${section.key}`}
              className="flex flex-col pb-1"
            >
              {section.heading === null ? null : (
                <div
                  id={`${list}-${section.key}`}
                  data-palette-heading
                  className="px-row-x text-caption text-text-faint pt-1 pb-1.5"
                >
                  {section.heading}
                </div>
              )}
              {section.rows.map((row) => (
                <PaletteRow
                  key={row.id}
                  row={row}
                  id={optionId(list, row.id)}
                  selected={row.id === selected}
                  onHover={() => onHover(row.id)}
                  onChoose={() => onChoose(row.id)}
                />
              ))}
            </div>
          )
        )}
      </div>
      {footer}
    </>
  );
};
