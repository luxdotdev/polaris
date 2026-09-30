/**
 * A Host with no Workspaces, and first run (onboarding O2): "Where does your
 * code live?" with the setup card (Paper 57Q-1): add a workspace (the native
 * folder picker on this Mac, a typed path anywhere), connect a host, and start
 * a session, which with no workspace starts in the Host's home directory.
 */
import {
  Button,
  Input,
  PixelFolderIcon,
  PixelServerIcon,
  PixelSparkleIcon,
  SetupCard,
  SetupRow,
  showToast,
} from "@polaris/ui";
import { useEffect, useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { Commands } from "../../../commands.ts";
import { useApp, useSelection, useShellActions } from "../../../shell/hooks.ts";
import { useOnboardingState } from "../../onboarding/index.ts";
import { send } from "../../session/dispatch.ts";
import { useReadyLine } from "../hooks.ts";
import { absolutePath, cleanPath, hostStageLine, stageKicker } from "../model.ts";
import { Stage } from "./Stage.tsx";

const register = (host: HostView, path: string) =>
  send(host.key, Commands.RegisterWorkspace({ path, name: null }), "Couldn't add the workspace");

/** The native folder picker (main process); the stage gives way once the Workspace arrives. */
const pickFolder = async (host: HostView) => {
  const picked = await window.polaris.request("dialog.pickFolder", {});

  if (picked.ok && picked.value.path !== null) await register(host, picked.value.path);
};

/** ⌘O opens the picker while the stage shows this Mac. */
const usePickShortcut = (host: HostView, local: boolean) =>
  useEffect(() => {
    if (!local) return undefined;

    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "o" || !event.metaKey || event.defaultPrevented) return;
      event.preventDefault();
      void pickFolder(host);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [host, local]);

const PathForm = ({ host, onClose }: { readonly host: HostView; readonly onClose: () => void }) => {
  const [path, setPath] = useState("~/");
  const [busy, setBusy] = useState(false);
  const cleaned = cleanPath(path);

  const absolute =
    cleaned === null ? null : absolutePath(cleaned, host.status.host?.homeDir ?? null);

  const connected = host.status.state === "connected";

  const add = () => {
    if (absolute === null) return;
    setBusy(true);
    void register(host, absolute).finally(() => setBusy(false));
  };

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
          if (event.key === "Escape") onClose();
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

const AddWorkspaceRow = ({ host }: { readonly host: HostView }) => {
  const [typing, setTyping] = useState(false);
  const connected = host.status.state === "connected";
  const local = host.alias === null;

  usePickShortcut(host, local && connected && !typing);

  if (typing) return <PathForm host={host} onClose={() => setTyping(false)} />;

  const typePath = (
    <Button
      variant={local ? "ghost" : "primary"}
      disabled={!connected}
      onClick={() => setTyping(true)}
      data-testid="add-workspace"
    >
      {local ? "Type a path" : "Choose folder"}
    </Button>
  );

  return (
    <SetupRow
      icon={<PixelFolderIcon size={20} />}
      title="Add a workspace"
      caption={`A repository on ${host.label}`}
      action={
        local ? (
          <div className="flex shrink-0 items-center gap-1.5">
            {typePath}
            <Button
              variant="primary"
              disabled={!connected}
              onClick={() => void pickFolder(host)}
              data-testid="choose-folder"
            >
              Choose folder <span className="text-micro opacity-60">⌘O</span>
            </Button>
          </div>
        ) : (
          typePath
        )
      }
    />
  );
};

const ConnectHostRow = ({ hostCount }: { readonly hostCount: number }) => {
  const sshHosts = useOnboardingState((s) => s.sshHosts?.length ?? 0);

  const caption =
    hostCount > 1
      ? `${hostCount - 1} more in settings · optional`
      : sshHosts > 0
        ? `${sshHosts} ${sshHosts === 1 ? "host" : "hosts"} in ~/.ssh/config · optional`
        : "Any machine you can reach over SSH · optional";

  // Stub until the add-machine flow (features/machines) lands; then it opens Settings → Hosts.
  const browse = () =>
    showToast({
      source: "starlight",
      icon: <PixelServerIcon size={16} />,
      title: "Adding a host comes with Settings → Hosts",
      message: "Until then, list the host by its ~/.ssh/config alias under hosts in settings.json.",
    });

  return (
    <SetupRow
      icon={<PixelServerIcon size={20} />}
      title="Connect a host"
      caption={caption}
      action={<Button onClick={browse}>Browse hosts</Button>}
    />
  );
};

/** Not locked on a workspace: with none, New session registers the Host's home (onboarding). */
const StartRow = ({ host }: { readonly host: HostView }) => {
  const { startNewSession } = useShellActions();
  const starting = useSelection().pane === "new-session";
  const readyLine = useReadyLine(host);

  if (host.status.host === null) {
    return (
      <SetupRow
        icon={<PixelSparkleIcon size={20} />}
        title="Start a session"
        caption={readyLine}
        locked="Needs a connected host"
      />
    );
  }

  return (
    <SetupRow
      icon={<PixelSparkleIcon size={20} />}
      title="Start a session"
      caption={`${readyLine} · starts in ~`}
      action={
        <Button data-testid="setup-start-session" disabled={starting} onClick={startNewSession}>
          {starting ? "Starting…" : "Start session"}
        </Button>
      }
    />
  );
};

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
        <ConnectHostRow hostCount={hostCount} />
        <StartRow host={host} />
      </SetupCard>
    </Stage>
  );
};
