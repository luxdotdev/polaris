/** The row being typed into: a new file or folder's name, or a rename (↵ commits, esc cancels). */
import { cn, FolderIcon } from "@polaris/ui";
import { type CSSProperties, useState } from "react";
import { validName } from "../model/paths.ts";
import { indent } from "./TreeRow.tsx";

export interface DraftRowProps {
  readonly depth: number;
  readonly initial: string;
  readonly folder: boolean;
  readonly label: string;
  readonly style?: CSSProperties;
  readonly onCommit: (name: string) => void;
  readonly onCancel: () => void;
}

/** Selects the name without its extension, as Finder does. */
const selectStem = (input: HTMLInputElement | null) => {
  if (input === null) return;
  const dot = input.value.lastIndexOf(".");

  input.focus();
  input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
};

export const DraftRow = ({
  depth,
  initial,
  folder,
  label,
  style,
  onCommit,
  onCancel,
}: DraftRowProps) => {
  const [name, setName] = useState(initial);
  const bad = name.trim() !== "" && validName(name) === null;

  return (
    <div
      style={{ ...style, paddingLeft: indent(depth) }}
      className="h-tree-row flex items-center gap-1 pr-2"
      data-testid="tree-draft"
    >
      <span className="text-text-faint flex size-4 shrink-0 items-center justify-center">
        {folder ? <FolderIcon size={14} /> : null}
      </span>
      <input
        ref={selectStem}
        aria-label={label}
        aria-invalid={bad}
        value={name}
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();

          if (event.key === "Enter") onCommit(name);
          else if (event.key === "Escape") onCancel();
        }}
        onBlur={() => onCommit(name)}
        className={cn(
          "text-label font-regular bg-bg text-text-strong h-6 min-w-0 flex-1 rounded-control border px-1.5 outline-none",
          bad ? "border-failed" : "border-hairline focus:border-starlight"
        )}
      />
    </div>
  );
};
