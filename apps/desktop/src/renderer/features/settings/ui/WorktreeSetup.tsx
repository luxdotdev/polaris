import type { WorktreeSetup, Workspace } from "@polaris/protocol";
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@polaris/ui";
import { Data, Predicate } from "effect";
import { hasCapability } from "../../session/hooks.ts";
import { useState } from "react";
import { Commands } from "../../../commands.ts";
import { useApp } from "../../../shell/hooks.ts";
import { send } from "../../session/dispatch.ts";
import { Group } from "./parts.tsx";

const Setup = Data.taggedEnum<WorktreeSetup>();

const WorkspaceSetup = ({
  hostKey,
  workspace,
  connected,
}: {
  readonly hostKey: string;
  readonly workspace: Workspace;
  readonly connected: boolean;
}) => {
  const current = workspace.worktreeSetup;

  const [command, setCommand] = useState(
    current !== null && Predicate.isTagged(current, "Command") ? current.command : ""
  );

  const [mode, setMode] = useState(current?._tag ?? "Auto");
  const [busy, setBusy] = useState(false);

  const save = async (setup: WorktreeSetup | null) => {
    setBusy(true);

    const saved = await send(
      hostKey,
      Commands.SetWorktreeSetup({ workspaceId: workspace.id, setup }),
      "Couldn't save worktree setup"
    );

    if (!saved) setMode(current?._tag ?? "Auto");

    setBusy(false);
  };

  return (
    <div className="px-panel flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <span className="text-label text-text-default min-w-0 flex-1 truncate">
          {workspace.name}
        </span>
        <Select
          value={mode}
          disabled={busy || !connected}
          onValueChange={(value) => {
            if (value === "Auto" || value === "Disabled" || value === "Command") setMode(value);

            if (value === "Auto") void save(null);

            if (value === "Disabled") void save(Setup.Disabled());
          }}
        >
          <SelectTrigger
            className="text-label h-7 w-[180px]"
            aria-label={`Worktree setup for ${workspace.name}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Auto">Detect from lockfile</SelectItem>
            <SelectItem value="Disabled">None</SelectItem>
            <SelectItem value="Command">Custom command</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode !== "Command" ? null : (
        <div className="flex items-center gap-2">
          <Input
            aria-label={`Setup command for ${workspace.name}`}
            className="text-code-inline font-mono"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            disabled={busy || !connected}
          />
          <Button
            size="xs"
            variant="ghost"
            disabled={busy || !connected || command.trim() === ""}
            onClick={() => void save(Setup.Command({ command: command.trim() }))}
          >
            Save
          </Button>
        </div>
      )}
    </div>
  );
};

export const WorktreeSetupSettings = () => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return (
    <Group label="Worker worktree setup">
      <p className="px-panel text-caption text-text-subtle py-2">
        Before a worker's first turn, detect bun, npm, pnpm or uv from its lockfile. Setup runs
        outside the worker cap.
      </p>
      {hosts
        .filter((host) => hasCapability(host, "workspace.setup"))
        .map((host) => (
          <div key={host.key}>
            <p className="px-panel text-caption text-text-faint pt-2">{host.label}</p>
            {[...(models[host.key]?.workspaces.values() ?? [])].map((workspace) => (
              <WorkspaceSetup
                key={`${workspace.id}:${JSON.stringify(workspace.worktreeSetup)}`}
                connected={host.status.state === "connected"}
                hostKey={host.key}
                workspace={workspace}
              />
            ))}
          </div>
        ))}
    </Group>
  );
};
