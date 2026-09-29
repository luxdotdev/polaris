import { useState, type ReactNode } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Command,
  FolderIcon,
  PlusIcon,
  StateIcon,
} from "../src";

function Items() {
  const [query, setQuery] = useState("po");

  return (
    <>
      <CommandInput
        value={query}
        onValueChange={setQuery}
        hint="Sessions, workspaces, hosts, actions"
      />
      <CommandList>
        <CommandEmpty>Nothing matches</CommandEmpty>
        <CommandGroup heading="Sessions">
          <CommandItem
            value="Spike GPUI review screen"
            leading={<StateIcon state="needs-you" harness="codex" size={14} />}
            detail="Mac Studio / polaris"
            meta="Needs you · Codex"
          >
            Spike GPUI review screen
          </CommandItem>
          <CommandItem
            value="Polaris planning"
            leading={<StateIcon state="working" harness="claude" size={14} />}
            detail="Mac Studio / polaris"
            meta="Working · Claude Code"
          >
            Polaris planning
          </CommandItem>
          <CommandItem
            value="Migrate reports to Postgres 17"
            leading={<StateIcon state="failed" harness="codex" size={14} />}
            detail="Linux VM / dcai"
            meta="Failed · Codex"
          >
            Migrate reports to Postgres 17
          </CommandItem>
          <CommandItem
            value="Orchestrator layout prototype"
            leading={<StateIcon state="idle" harness="claude" size={14} />}
            detail="Mac Studio / polaris"
            meta="Idle · Claude Code"
          >
            Orchestrator layout prototype
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Workspaces">
          <CommandItem
            value="polaris workspace"
            leading={<FolderIcon size={14} />}
            detail="Mac Studio · 4 sessions"
            meta="⌃1"
          >
            polaris
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem value="New session in polaris" leading={<PlusIcon size={14} />} meta="⌘N">
            New session in polaris
          </CommandItem>
        </CommandGroup>
      </CommandList>
      <CommandFooter>
        <span>↑↓ Move</span>
        <span>↵ Open</span>
        <span>⌘↵ Open in Review</span>
        <span className="flex-1" />
        <span>esc</span>
      </CommandFooter>
    </>
  );
}

/** Artboard 3's K menu content, inline. */
export function JumpMenu() {
  return (
    <Command shouldFilter={false}>
      <Items />
    </Command>
  );
}

export interface JumpMenuDialogProps {
  readonly trigger?: ReactNode;
  readonly defaultOpen?: boolean;
}

export function JumpMenuDialog({ trigger, defaultOpen = false }: JumpMenuDialogProps) {
  return (
    <CommandDialog defaultOpen={defaultOpen} shouldFilter={false} trigger={trigger}>
      <Items />
    </CommandDialog>
  );
}
