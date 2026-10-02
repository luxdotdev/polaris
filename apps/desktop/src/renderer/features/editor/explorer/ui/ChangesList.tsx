/** Changes: every changed file in one flat list, name then folder, with its letter. */
import { cn } from "@polaris/ui";
import type { ChangeRow } from "../model/changes.ts";
import { AgentSlot, GitSlot, nameTone } from "./slots.tsx";

export interface ChangesListProps {
  readonly rows: ReadonlyArray<ChangeRow>;
  readonly active: string | null;
  readonly git: "none" | "loading" | "ready";
  readonly onOpen: (path: string, pin: boolean) => void;
}

const Empty = ({ text }: { readonly text: string }) => (
  <p className="text-caption text-text-subtle px-4 py-3" data-testid="changes-empty">
    {text}
  </p>
);

export const ChangesList = ({ rows, active, git, onOpen }: ChangesListProps) => {
  if (git === "none") return <Empty text="This folder isn't a git repository." />;

  if (git === "loading") return null;

  if (rows.length === 0) return <Empty text="No changes since the last commit." />;

  return (
    <ul
      className="min-h-0 flex-1 overflow-y-auto px-2"
      aria-label="Changes"
      data-testid="changes-list"
    >
      {rows.map((row) => {
        const selected = row.path === active;
        const deleted = row.git === "deleted";

        return (
          <li key={row.path}>
            <button
              type="button"
              disabled={deleted}
              data-testid="change-row"
              title={row.folder === "" ? row.name : `${row.folder}/${row.name}`}
              onClick={(event) => onOpen(row.path, event.detail >= 2)}
              className={cn(
                "h-tree-row flex w-full cursor-default items-center gap-2 rounded-[8px] pr-2 pl-2.5 text-left outline-none",
                "focus-visible:ring-starlight focus-visible:ring-2 focus-visible:ring-inset",
                selected ? "bg-fill-selected" : "hover:bg-fill-hover"
              )}
            >
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span
                  className={cn(
                    "text-label font-regular min-w-0 shrink truncate",
                    nameTone(row.git, selected, false),
                    deleted && "line-through"
                  )}
                >
                  {row.name}
                </span>
                <span className="text-caption text-text-subtle min-w-0 shrink-[2] truncate">
                  {row.folder}
                </span>
              </span>
              <AgentSlot agent={row.agent} hand={false} />
              <GitSlot git={row.git} dirty={false} />
            </button>
          </li>
        );
      })}
    </ul>
  );
};
