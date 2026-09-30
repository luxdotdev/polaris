/**
 * A Host with no Workspaces (and first run): "Where does your code live?"
 * with the setup card (Paper 57Q-1): add a workspace by its path on the Host,
 * connect a host, and start a session once a workspace exists.
 */
import {
  Button,
  Input,
  PixelFolderIcon,
  PixelServerIcon,
  PixelSparkleIcon,
  SetupCard,
  SetupRow,
} from "@polaris/ui";
import { useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { Commands } from "../../../commands.ts";
import { useApp } from "../../../shell/hooks.ts";
import { send } from "../../session/dispatch.ts";
import { useReadyLine } from "../hooks.ts";
import { absolutePath, cleanPath, hostStageLine, stageKicker } from "../model.ts";
import { Stage } from "./Stage.tsx";

const AddWorkspaceRow = ({ host }: { readonly host: HostView }) => {
  const [path, setPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const homeDir = host.status.host?.homeDir ?? null;
  const cleaned = path === null ? null : cleanPath(path);
  const absolute = cleaned === null ? null : absolutePath(cleaned, homeDir);
  const connected = host.status.state === "connected";

  const add = () => {
    if (absolute === null) return;
    setBusy(true);
    void send(
      host.key,
      Commands.RegisterWorkspace({ path: absolute, name: null }),
      "Couldn't add the workspace"
    ).finally(() => setBusy(false));
  };

  if (path === null) {
    return (
      <SetupRow
        icon={<PixelFolderIcon size={20} />}
        title="Add a workspace"
        caption={`A repository on ${host.label}`}
        action={
          <Button
            variant="primary"
            disabled={!connected}
            onClick={() => setPath("~/")}
            data-testid="add-workspace"
          >
            Choose folder
          </Button>
        }
      />
    );
  }

  return (
    <form
      className="flex items-center gap-3.5 px-4 py-3.5"
      onSubmit={(event) => {
        event.preventDefault();
        add();
      }}
    >
      <Input
        autoFocus
        aria-label={`Folder on ${host.label}`}
        value={path}
        onChange={(event) => setPath(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setPath(null);
        }}
        placeholder="~/code/polaris"
        className="text-code-inline flex-1 font-mono"
        data-testid="workspace-path"
      />
      <Button variant="primary" type="submit" disabled={absolute === null || busy || !connected}>
        Add
      </Button>
    </form>
  );
};

const StartRow = ({ host }: { readonly host: HostView }) => (
  <SetupRow
    icon={<PixelSparkleIcon size={20} />}
    title="Start a session"
    caption={useReadyLine(host)}
    locked="Needs a workspace"
  />
);

/** The Host in view, else the local one: a workspace needs a machine to live on. */
const useStageHost = (hostKey: string | null) =>
  useApp((s) => s.hosts.find((h) => h.key === hostKey) ?? s.hosts.find((h) => h.alias === null));

export const HostStage = ({ hostKey }: { readonly hostKey: string | null }) => {
  const host = useStageHost(hostKey);
  const hostCount = useApp((s) => s.hosts.length);

  if (host === undefined) return <Stage kicker="Polaris" title="Where does your code live?" />;

  return (
    <Stage
      kicker={stageKicker(host.label, null)}
      title="Where does your code live?"
      line={hostStageLine(hostCount)}
      testId="host-stage"
    >
      <SetupCard className="shadow-float">
        <AddWorkspaceRow host={host} />
        <SetupRow
          icon={<PixelServerIcon size={20} />}
          title="Connect a host"
          caption={
            hostCount > 1
              ? `${hostCount - 1} more in settings · optional`
              : "Any machine you can reach over SSH · optional"
          }
        />
        <StartRow host={host} />
      </SetupCard>
    </Stage>
  );
};
