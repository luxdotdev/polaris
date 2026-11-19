/**
 * The files a command changed (ADR 0117), under its row once it finishes: "Changed 2 files",
 * then the same rows and previews as an edit. Past eight files the list folds.
 */
import { useState } from "react";
import { chooseCollapse, initialOpen } from "../model/collapse.ts";
import { plural } from "../model/format.ts";
import type { ItemView } from "../model/items.ts";
import { FileChanges } from "./fileEdits/index.ts";
import type { Hue } from "./marks.tsx";

type CommandView = Extract<ItemView, { kind: "command" }>;

/** Files listed before "Show all". */
export const FOLDED_FILES = 8;

const LINK = "text-caption text-text-subtle hover:text-text-default cursor-default px-1 text-left";

export const CommandChanges = ({
  item,
  hue,
  onOpenFile,
  onOpenDiff,
}: {
  readonly item: CommandView;
  readonly hue: Hue;
  readonly onOpenFile?: ((path: string) => void) | undefined;
  readonly onOpenDiff: () => void;
}) => {
  const key = `files:${item.id}`;
  const [open, setOpen] = useState(() => initialOpen(key));
  const changes = item.changes ?? [];
  const more = item.moreChanges ?? 0;

  if (changes.length === 0 || item.live) return null;
  const folds = changes.length > FOLDED_FILES;

  const toggle = () => {
    chooseCollapse(key, !open);
    setOpen(!open);
  };

  return (
    <div className="flex flex-col gap-1" data-testid="command-changes">
      <p className="text-caption text-text-subtle px-1">
        Changed {plural(changes.length + more, "file")}
      </p>
      <FileChanges
        id={item.id}
        changes={folds && !open ? changes.slice(0, FOLDED_FILES) : changes}
        status="completed"
        writing={false}
        hue={hue}
        onOpenFile={onOpenFile}
        onOpenDiff={onOpenDiff}
      />
      {folds ? (
        <button type="button" aria-expanded={open} onClick={toggle} className={LINK}>
          {open ? "Show fewer files" : `Show all ${plural(changes.length, "file")}`}
        </button>
      ) : null}
      {more > 0 && (open || !folds) ? (
        <button type="button" onClick={onOpenDiff} className={LINK}>
          and {more.toLocaleString("en-US")} more in this turn's changes
        </button>
      ) : null}
    </div>
  );
};
