/**
 * O2 First run (DESIGN.md, Onboarding; Paper 57Q-1): the Orchestrator's stage
 * while no Host has a Workspace. Add a workspace (the one primary), connect a
 * host, or start a session right away in the Host's home directory.
 */
import {
  Button,
  Input,
  Kbd,
  PixelFailedIcon,
  PixelFolderIcon,
  PixelServerIcon,
  PixelSparkleIcon,
  Scene,
  SetupCard,
  SetupRow,
  showToast,
  StageHeading,
} from "@polaris/ui";
import { createElement, type FormEvent, useEffect, useState } from "react";
import type { HostView } from "../../../../shared/api.ts";
import { Commands, newCommandId } from "../../../commands.ts";
import { useApp, useSelection, useShellActions } from "../../../shell/hooks.ts";
import { useOnboardingState } from "../hooks.ts";
import { expandHome, hostsLine, listed, readyHarnesses } from "../model.ts";
import { useAvailability } from "./useAvailability.ts";

const ICON = 20;

const toastFailure = (title: string, message: string) =>
  showToast({
    source: "starlight",
    icon: createElement(PixelFailedIcon, { size: 16 }),
    title,
    message,
  });

/** RegisterWorkspace; the stage gives way to the Orchestrator once it arrives. */
const register = async (host: HostView, path: string) => {
  const result = await window.polaris.request("dispatch", {
    hostKey: host.key,
    commandId: newCommandId(),
    command: Commands.RegisterWorkspace({ path, name: null }),
  });

  if (!result.ok) toastFailure("Couldn't add the workspace", result.error.message);
};

const pickAndRegister = async (host: HostView) => {
  const picked = await window.polaris.request("dialog.pickFolder", {});

  if (picked.ok && picked.value.path !== null) await register(host, picked.value.path);
};

const LocalFolder = ({ host }: { readonly host: HostView }) => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "o" || !event.metaKey || event.defaultPrevented) return;
      event.preventDefault();
      void pickAndRegister(host);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [host]);

  return (
    <Button variant="primary" data-testid="choose-folder" onClick={() => pickAndRegister(host)}>
      Choose folder <Kbd className="bg-transparent text-current opacity-60">⌘O</Kbd>
    </Button>
  );
};

const RemotePath = ({ host }: { readonly host: HostView }) => {
  const [path, setPath] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (path.trim() !== "")
      void register(host, expandHome(path, host.status.host?.homeDir ?? null));
  };

  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-2">
      <Input
        aria-label={`Path on ${host.label}`}
        placeholder="~/code/project"
        value={path}
        onChange={(event) => setPath(event.target.value)}
        className="w-44 font-mono"
      />
      <Button type="submit" variant="primary" disabled={path.trim() === ""}>
        Add
      </Button>
    </form>
  );
};

const ConnectHost = () => {
  const sshHosts = useOnboardingState((s) => s.sshHosts);
  const found = sshHosts === null || sshHosts.length === 0 ? null : hostsLine(sshHosts.length);

  return (
    <SetupRow
      icon={<PixelServerIcon size={ICON} />}
      title="Connect a host"
      caption={found === null ? "Any machine you reach over SSH · optional" : `${found} · optional`}
      action={
        <Button
          onClick={() =>
            toastFailure(
              "Adding a host comes with Settings → Hosts",
              "Until then, list the host by its ~/.ssh/config alias under hosts in settings.json."
            )
          }
        >
          Browse hosts
        </Button>
      }
    />
  );
};

const StartSession = ({ host }: { readonly host: HostView }) => {
  const { startNewSession } = useShellActions();
  const starting = useSelection().pane === "new-session";
  const ready = readyHarnesses(useAvailability(host.key));
  const verb = ready.length === 1 ? "is" : "are";

  const caption =
    ready.length === 0
      ? `Starts in your home folder on ${host.label}`
      : `${listed(ready, 2)} ${verb} ready on ${host.label}. Starts in your home folder.`;

  if (host.status.host === null) {
    return (
      <SetupRow
        icon={<PixelSparkleIcon size={ICON} />}
        title="Start a session"
        caption={`Once ${host.label} is connected`}
        locked="Needs a connected host"
      />
    );
  }

  return (
    <SetupRow
      icon={<PixelSparkleIcon size={ICON} />}
      title="Start a session"
      caption={caption}
      action={
        <Button data-testid="setup-start-session" disabled={starting} onClick={startNewSession}>
          {starting ? "Starting…" : "Start session"}
        </Button>
      }
    />
  );
};

export interface SetupStageProps {
  /** The Host the stage sets up; null when no Host is configured at all. */
  readonly hostKey: string | null;
}

export const SetupStage = ({ hostKey }: SetupStageProps) => {
  const host = useApp((s) => s.hosts.find((h) => h.key === hostKey));
  const local = host?.alias === null;

  return (
    <Scene
      data-testid="setup"
      className="flex min-w-0 flex-1 flex-col items-center gap-8 pt-[92px]"
    >
      <StageHeading
        kicker={host === undefined ? "Set up" : `Set up · ${host.label}`}
        title="Where does your code live?"
        line="Add a workspace to start your first session. Remote hosts can come now or later."
      />
      <SetupCard className="shadow-float">
        {host === undefined ? null : (
          <SetupRow
            icon={<PixelFolderIcon size={ICON} />}
            title="Add a workspace"
            caption={local ? `A repository on ${host.label}` : `A path on ${host.label}`}
            action={local ? <LocalFolder host={host} /> : <RemotePath host={host} />}
          />
        )}
        <ConnectHost />
        {host === undefined ? null : <StartSession host={host} />}
      </SetupCard>
    </Scene>
  );
};

/** While no Host has said what it holds: the scene alone, so the setup never flashes. */
export const WaitingStage = () => <Scene data-testid="stage-waiting" className="min-w-0 flex-1" />;
