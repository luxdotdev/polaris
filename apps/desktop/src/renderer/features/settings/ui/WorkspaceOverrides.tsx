/**
 * A list of per-Workspace overrides of a setting (accept branch, Reviewer): one row per
 * overridden Workspace with its control and a remove button, then a picker to add one.
 */
import {
  Button,
  CloseIcon,
  IconButton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polaris/ui";
import { type ReactNode, useMemo, useState } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { type WorkspaceOption, workspaceOptions } from "../model/workspaces.ts";
import { Group } from "./parts.tsx";

export const useWorkspaceOptions = (): ReadonlyArray<WorkspaceOption> => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return useMemo(() => workspaceOptions(hosts, models), [hosts, models]);
};

const AddPicker = ({
  options,
  label,
  onAdd,
}: {
  readonly options: ReadonlyArray<WorkspaceOption>;
  readonly label: string;
  readonly onAdd: (key: string) => void;
}) => (
  <div className="px-panel flex items-center gap-4 py-[calc(var(--spacing-gap)+2px)]">
    <span className="text-caption text-text-subtle flex-1">
      {options.length === 0 ? "Every workspace has its own setting." : label}
    </span>
    {/* Keyed by the count, so it resets to its placeholder after each pick. */}
    <Select key={options.length} value="" onValueChange={onAdd} disabled={options.length === 0}>
      <SelectTrigger aria-label={label} className="text-label h-7 w-[220px]">
        <SelectValue placeholder="Add a workspace…" />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.key} value={o.key}>
            {o.name} · {o.hostLabel}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

export const WorkspaceOverrides = ({
  label,
  keys,
  options,
  control,
  onAdd,
  onRemove,
  addLabel,
}: {
  readonly label: string;
  /** The overridden Workspaces, `hostKey/workspaceId`. */
  readonly keys: ReadonlyArray<string>;
  /** Every Workspace that may be overridden. */
  readonly options: ReadonlyArray<WorkspaceOption>;
  readonly control: (key: string) => ReactNode;
  readonly onAdd: (key: string) => void;
  readonly onRemove: (key: string) => void;
  readonly addLabel: string;
}) => {
  const rows = keys.map((key) => ({ key, option: options.find((o) => o.key === key) }));
  const addable = options.filter((o) => !keys.includes(o.key));

  return (
    <Group label={label}>
      {rows.map(({ key, option }) => (
        <div
          key={key}
          className="px-panel flex items-center gap-3 py-[calc(var(--spacing-gap)+2px)]"
          data-testid="override"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-label font-regular text-text-default truncate">
              {option?.name ?? key}
            </span>
            <span className="text-caption text-text-subtle truncate">
              {option?.hostLabel ?? "Not on any connected host"}
            </span>
          </span>
          {control(key)}
          <IconButton
            label={`Remove the override for ${option?.name ?? key}`}
            icon={<CloseIcon size={14} />}
            onClick={() => onRemove(key)}
          />
        </div>
      ))}
      <AddPicker options={addable} label={addLabel} onAdd={onAdd} />
    </Group>
  );
};

/**
 * The sunken strip that counts a page's Workspace overrides (Paper S5), with their
 * editor inline beneath it (DESIGN.md, Settings: overrides are edited in place).
 */
export const OverrideStrip = ({
  summary,
  detail,
  children,
}: {
  readonly summary: string;
  /** One example, e.g. "warehouse on Linux VM uses lucasdoell instead of lmd-work". */
  readonly detail: string | null;
  /** The inline editor, shown on "Edit overrides". */
  readonly children: ReactNode;
}) => {
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-surface-sunken rounded-card px-panel flex items-center gap-3 py-[calc(var(--spacing-gap)+4px)]">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body text-text-default">{summary}</span>
          {detail === null ? null : (
            <span className="text-caption text-text-subtle truncate">{detail}</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="xs"
          className="text-text-default"
          aria-expanded={editing}
          onClick={() => setEditing(!editing)}
        >
          {editing ? "Done" : "Edit overrides"}
        </Button>
      </div>
      {editing ? children : null}
    </div>
  );
};

/** "1 workspace overrides its owner" / "No workspace overrides its owner". */
export const overrideCount = (n: number, what: string) =>
  n === 0
    ? `No workspace overrides ${what}`
    : `${n} workspace${n === 1 ? " overrides" : "s override"} ${what}`;
