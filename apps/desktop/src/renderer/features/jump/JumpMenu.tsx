/**
 * The K jump menu (Paper AR-0): one field across every Host, to sessions,
 * Workspaces, Worktrees, machines and actions. ↑↓ move, ↵ opens, ⌘↵ opens a
 * session in Review, esc closes. Fills the shell's `JumpMenu` slot.
 */
import {
  BranchIcon,
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  FolderIcon,
  PlusIcon,
} from "@polaris/ui";
import { type KeyboardEvent, useMemo, useState } from "react";
import type { JumpMenuProps } from "../../app/slots.tsx";
import { barHosts } from "../../routes/topBar.ts";
import { SessionGlyph, SummaryGlyph } from "../../shell/glyphs.tsx";
import { useApp, useCommands, useNav, useSelection, useShellActions } from "../../shell/hooks.ts";
import { jumpGroups } from "./groups.ts";
import {
  actionItems,
  hostItems,
  type JumpItem,
  sessionItems,
  workspaceItems,
  worktreeItems,
} from "./items.ts";
import { useRunJump } from "./run.ts";

const Leading = ({ item }: { readonly item: JumpItem }) => {
  const { target } = item;

  if (target.kind === "workspace") return <FolderIcon size={14} className="text-text-subtle" />;

  if (target.kind === "worktree") return <BranchIcon size={14} className="text-text-subtle" />;

  if (target.kind === "command") {
    return target.id === "session.new" ? <PlusIcon size={14} className="text-text-subtle" /> : null;
  }

  if (item.state === null || item.harness === null) return null;

  if (target.kind === "host") {
    return (
      <SummaryGlyph
        summary={{ state: item.state, harness: item.harness, needsYou: 0, sessions: 0 }}
      />
    );
  }

  return <SessionGlyph state={item.state} harness={item.harness} size={14} />;
};

const useSources = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);
  const { topBar, hostKey, workspaceId, sessionId } = useSelection();
  const commands = useCommands();
  const dark = useDark();

  return useMemo(() => {
    const data = { bar: barHosts({ hosts, models }), models, machineBar: topBar !== "workspaces" };
    const model = hostKey === null ? undefined : models[hostKey];

    return {
      sessions: sessionItems(data),
      workspaces: workspaceItems(data),
      worktrees: worktreeItems(data),
      hosts: hostItems(data),
      actions: actionItems({
        workspace: workspaceId === null ? null : (model?.workspaces.get(workspaceId)?.name ?? null),
        session:
          sessionId === null ? null : (model?.sessions.get(sessionId)?.session.title ?? null),
        enabled: commands.enabled,
        nextTheme: dark ? "light" : "dark",
      }),
    };
  }, [hosts, models, topBar, hostKey, workspaceId, sessionId, commands, dark]);
};

/** Whether the window is dark now: the theme setting, or the system's when it follows it. */
const useDark = () => {
  const theme = useApp((s) => s.theme);

  return theme === "system" ? matchMedia("(prefers-color-scheme: dark)").matches : theme === "dark";
};

const Results = ({ onClose }: { readonly onClose: () => void }) => {
  const [query, setQuery] = useState("");
  const sources = useSources();
  const recent = useNav((s) => s.recent);
  const groups = jumpGroups({ query, sources, recent });
  const byId = new Map(groups.flatMap((g) => g.items.map((i) => [i.id, i])));
  const runJump = useRunJump();

  const open = (item: JumpItem, review: boolean) => {
    onClose();
    runJump(item.target, review);
  };

  // ⌘↵ opens the highlighted session in Review; cmdk marks the highlighted row.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" || !event.metaKey) return;
    const highlighted = event.currentTarget.querySelector<HTMLElement>('[data-selected="true"]');
    const item = byId.get(highlighted?.dataset.jumpId ?? "");

    if (item === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    open(item, true);
  };

  return (
    <div onKeyDownCapture={onKeyDownCapture} className="contents">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Jump to a session or workspace"
        hint="Sessions, workspaces, hosts, actions"
        aria-label="Jump to a session, workspace, worktree, machine or action"
      />
      <CommandList aria-label="Results">
        <CommandEmpty>Nothing matches</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.items.map((item) => (
              <CommandItem
                key={item.id}
                value={item.id}
                data-jump-id={item.id}
                data-testid="jump-item"
                leading={<Leading item={item} />}
                detail={item.detail === "" ? undefined : item.detail}
                meta={item.meta === "" ? undefined : item.meta}
                onSelect={() => open(item, false)}
              >
                {item.title}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <CommandFooter>
        <span>↑↓ Move</span>
        <span>↵ Open</span>
        <span>⌘↵ Open in Review</span>
        <span className="flex-1" />
        <span>esc</span>
      </CommandFooter>
    </div>
  );
};

/**
 * Rendered only while open: a closing dialog must not linger through its fade-out
 * as Radix's topmost layer, taking the next overlay's Escape (routes/keyboard.ts).
 */
export const JumpMenu = ({ open, onOpenChange }: JumpMenuProps) => {
  const { setJumpOpen } = useShellActions();

  if (!open) return null;

  return (
    <CommandDialog
      open
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="Jump"
      description="Jump to a session, workspace, worktree, machine or action"
    >
      <Results onClose={() => setJumpOpen(false)} />
    </CommandDialog>
  );
};
