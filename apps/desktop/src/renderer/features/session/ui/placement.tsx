/**
 * The new-session page's two small choices: where it runs (the placement
 * phrase in the where line opens a menu) and the permission mode chip.
 */
import type { PermissionMode, Worktree } from "@polaris/protocol";
import {
  ChevronDownIcon,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@polaris/ui";
import type { ReactNode } from "react";
import { PERMISSION_MODES, permissionLabel } from "../model/intent.ts";
import { placementPhrase, type PlacementChoice, sharingPhrase } from "../model/newSession.ts";

export interface WhereLineProps {
  /** The Host, as text or its menu (whereMenus.tsx). */
  readonly hostLabel: ReactNode;
  /** The Workspace's path, as text or its menu. */
  readonly path: ReactNode;
  readonly placement: PlacementChoice;
  readonly worktrees: ReadonlyArray<Worktree>;
  readonly canWorktree: boolean;
  /** The Workspace's checked-out branch, where a new Worktree starts; null if unknown. */
  readonly head: string | null;
  /** Other open sessions already working in the chosen directory. */
  readonly others: number;
  readonly onChange: (placement: PlacementChoice) => void;
}

/** "Runs on Mac Studio in ~/code/polaris, on a new worktree from main.", placement as a menu. */
export const WhereLine = ({
  hostLabel,
  path,
  placement,
  worktrees,
  canWorktree,
  head,
  others,
  onChange,
}: WhereLineProps) => (
  <p className="text-body text-text-default" data-testid="where-line">
    Runs on {hostLabel} in {path},{" "}
    <DropdownMenu>
      <DropdownMenuTrigger
        className="decoration-text-faint cursor-default underline decoration-dotted underline-offset-4"
        data-testid="placement"
      >
        {placementPhrase(placement, head)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center">
        <DropdownMenuItem onSelect={() => onChange({ kind: "in-place" })}>
          In place
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canWorktree}
          onSelect={() => onChange({ kind: "new-worktree", branch: "", base: null })}
        >
          On a new worktree
        </DropdownMenuItem>
        {worktrees.length === 0 ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Existing worktrees</DropdownMenuLabel>
            {worktrees.map((w) => (
              <DropdownMenuItem
                key={w.id}
                onSelect={() => onChange({ kind: "existing", path: w.path, branch: w.branch })}
              >
                <span className="text-code-inline font-mono">{w.branch ?? w.path}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    {sharingPhrase(others)}.
  </p>
);

export const PermissionChip = ({
  value,
  onChange,
}: {
  readonly value: PermissionMode;
  readonly onChange: (mode: PermissionMode) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      className="h-tree-row rounded-control border-text-strong/8 text-caption text-text-subtle hover:bg-fill-hover inline-flex cursor-default items-center gap-1.5 border px-2.5 font-medium"
      data-testid="permission-mode"
    >
      {permissionLabel(value)}
      <ChevronDownIcon size={10} />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuLabel>Permissions</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(next) => {
          const found = PERMISSION_MODES.find((p) => p.mode === next);

          if (found !== undefined) onChange(found.mode);
        }}
      >
        {PERMISSION_MODES.map((p) => (
          <DropdownMenuRadioItem key={p.mode} value={p.mode}>
            <span className="flex flex-col">
              <span>{p.label}</span>
              <span className="text-caption text-text-subtle">{p.detail}</span>
            </span>
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
