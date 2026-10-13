/**
 * The Languages group (DESIGN.md, Settings: Editor · languages; Paper L4): a row
 * per Language Integration with its state, parts on disclosure and an on/off switch.
 */
import { cn, DisclosureChevron, Switch } from "@polaris/ui";
import { useState } from "react";
import { Group } from "../ui/parts.tsx";
import type { Fact, LanguageRow } from "./model.ts";

const Monogram = ({ text }: { readonly text: string }) => (
  <span
    aria-hidden
    className="bg-fill-selected rounded-control text-text-default flex size-7 shrink-0 items-center justify-center font-mono text-[11px] leading-3 font-semibold"
  >
    {text}
  </span>
);

const FactRow = ({ fact }: { readonly fact: Fact }) => (
  <div className="flex items-center gap-2">
    <dt className="text-caption text-text-faint w-[120px] shrink-0">{fact.label}</dt>
    <dd className="flex min-w-0 items-center gap-2">
      <span className={cn("text-caption text-text-default", fact.mono && "font-mono")}>
        {fact.value}
      </span>
      {fact.note && <span className="text-caption text-text-subtle">{fact.note}</span>}
    </dd>
  </div>
);

/** Fixed lanes: tile, name and state, disclosure, switch; an empty switch slot keeps them aligned. */
export const IntegrationRow = ({
  row,
  enabled,
  onToggle,
  switchable,
}: {
  readonly row: LanguageRow;
  readonly enabled: boolean;
  readonly onToggle: (on: boolean) => void;
  readonly switchable: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const factsId = `language-facts-${row.id}`;

  return (
    <div className="px-panel flex flex-col gap-3 py-[calc(var(--spacing-gap)+4px)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={factsId}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 cursor-default items-center gap-3 text-left"
        >
          <Monogram text={row.monogram} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body text-text-strong font-medium">{row.name}</span>
            <span className="text-caption text-text-subtle">{row.state}</span>
          </span>
          <DisclosureChevron open={open} size={12} className="text-text-subtle" />
        </button>
        <span className="flex w-[26px] shrink-0 justify-end">
          {switchable && (
            <Switch
              aria-label={`${row.name} language tools`}
              checked={enabled}
              onCheckedChange={onToggle}
            />
          )}
        </span>
      </div>
      {open && (
        <dl id={factsId} className="flex flex-col gap-2 pl-10">
          {row.facts.length === 0 ? (
            <p className="text-caption text-text-subtle">No parts reported by this host yet.</p>
          ) : (
            row.facts.map((fact) => <FactRow key={fact.label + fact.value} fact={fact} />)
          )}
        </dl>
      )}
    </div>
  );
};

const MarkdownRow = () => (
  <div className="px-panel flex items-center gap-3 py-[calc(var(--spacing-gap)+4px)]">
    <Monogram text="MD" />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-body text-text-strong font-medium">Markdown</span>
      <span className="text-caption text-text-subtle">
        Highlighting and preview · no language server needed
      </span>
    </span>
    <span className="w-[26px] shrink-0" />
  </div>
);

export const LanguageList = ({
  rows,
  enabled,
  onToggle,
  footLine,
  notice,
}: {
  readonly rows: ReadonlyArray<LanguageRow>;
  readonly enabled: (row: LanguageRow) => boolean;
  readonly onToggle: (row: LanguageRow, on: boolean) => void;
  readonly footLine: string | null;
  /** Shown in place of the rows while the Host's facts load or can't be read. */
  readonly notice: string | null;
}) => (
  <Group label="Languages">
    {notice !== null ? (
      <p role="status" className="px-panel text-caption text-text-subtle py-3">
        {notice}
      </p>
    ) : (
      <>
        {rows.map((row) => (
          <IntegrationRow
            key={row.id}
            row={row}
            enabled={enabled(row)}
            switchable={row.syntaxIds.length > 0}
            onToggle={(on) => onToggle(row, on)}
          />
        ))}
        <MarkdownRow />
        {footLine && (
          <div className="px-panel flex items-center gap-3 py-[calc(var(--spacing-gap)+4px)]">
            <span className="w-7 shrink-0" />
            <span className="text-caption text-text-faint">{footLine}</span>
          </div>
        )}
      </>
    )}
  </Group>
);
