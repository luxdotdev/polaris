import {
  SettingsButton,
  SettingsCard,
  SettingsRow,
  SettingsSelect,
  SettingsWell,
} from "@polaris/ui";
import { useEffect, useState } from "react";
import type { CommandInstallView, CommandLocation } from "../../../shared/commandInstall.ts";
import type { ContributedCommand } from "../../routes/commands.ts";
import { useApp, useCommands, useShellActions } from "../../shell/hooks.ts";
import {
  changeCommandInstall,
  dismissCommandInstall,
  refreshCommandInstall,
  useCommandInstall,
} from "./store.ts";

/** Settings → About, scoped to this Client's machine. */
export const CommandInstallCard = () => {
  const { view, problem, busy } = useCommandInstall();
  useEffect(() => {
    void refreshCommandInstall();
  }, []);

  const [selection, setLocation] = useState<CommandLocation | null>(null);

  const location =
    selection ?? view?.links.find((entry) => entry.state === "installed")?.location ?? "user";

  if (view !== null && !view.supported) return null;

  const link = view?.links.find((entry) => entry.location === location);
  const installed = link?.state === "installed";

  const caption =
    link?.state === "conflict"
      ? `${link.path} belongs to another command; it will be kept`
      : installed
        ? `Installed at ${location === "user" ? "~/.local/bin/polaris" : "/usr/local/bin/polaris"}`
        : "Run polaris from your terminal";

  return (
    <SettingsCard title="Command line" aside="This machine" data-testid="command-install-card">
      <SettingsWell>
        <SettingsRow title="polaris command" caption={caption}>
          <SettingsSelect<CommandLocation>
            label="Command location"
            value={location}
            disabled={busy || view === null}
            options={
              view?.links.map((entry) => ({
                value: entry.location,
                label:
                  entry.location === "user" ? "~/.local/bin" : "/usr/local/bin · administrator",
              })) ?? []
            }
            onChange={setLocation}
          />
          <SettingsButton
            disabled={
              busy ||
              link === undefined ||
              link.state === "conflict" ||
              (!installed && !view?.available)
            }
            onClick={() => void changeCommandInstall(installed ? "uninstall" : "install", location)}
          >
            {busy ? "Changing command…" : installed ? "Uninstall" : "Install"}
          </SettingsButton>
        </SettingsRow>
      </SettingsWell>
      <CommandStatus view={view} location={location} problem={problem} />
    </SettingsCard>
  );
};

const CommandStatus = ({
  view,
  location,
  problem,
}: {
  readonly view: CommandInstallView | null;
  readonly location: CommandLocation;
  readonly problem: string | null;
}) => {
  const link = view?.links.find((entry) => entry.location === location);

  return (
    <div className="px-panel text-caption text-text-subtle flex flex-col gap-1 py-2" role="status">
      {view === null ? <p>Reading command installation…</p> : null}
      {view !== null && !view.available ? (
        <p>Install the local daemon from Settings → Hosts first.</p>
      ) : null}
      {link !== undefined && !link.onPath ? (
        <p>
          Add <code>{location === "user" ? "~/.local/bin" : "/usr/local/bin"}</code> to PATH in your
          shell configuration, then open a new shell. For sh, bash or zsh:{" "}
          <code>
            {location === "system"
              ? 'export PATH="/usr/local/bin:$PATH"'
              : 'export PATH="$HOME/.local/bin:$PATH"'}
          </code>
        </p>
      ) : link?.state === "installed" ? (
        <p>
          Open a new shell and run <code>polaris version</code>.
        </p>
      ) : null}
      {problem === null ? null : <p>{problem}</p>}
    </div>
  );
};

/** Quiet, dismissable setup row after Welcome; commands remain available after dismissal. */
export const CommandInstallSetup = () => {
  const { view, problem, busy } = useCommandInstall();
  const commands = useCommands();
  const { openSettings } = useShellActions();

  const connected = useApp((s) =>
    s.hosts.some((host) => host.key === "local" && host.status.state === "connected")
  );

  useEffect(() => {
    void refreshCommandInstall();
  }, [connected]);

  useEffect(() => {
    if (!view?.supported) return;
    const installed = view.links.filter((link) => link.state === "installed");

    return commands.contribute([
      {
        id: "command.install",
        title: "Install polaris command…",
        palette: {
          group: "app",
          keywords: ["cli", "path", "shell", "terminal", "symlink"],
          detail: "Command line · this machine",
        },
        handler: {
          followUp: () => ({
            title: "Install polaris command",
            note: "Choose a location on this machine",
            choices: view.links.map((link) => ({
              id: link.location,
              title: link.location === "user" ? "~/.local/bin" : "/usr/local/bin",
              detail:
                link.state === "installed"
                  ? "Already installed"
                  : link.state === "conflict"
                    ? "An existing command will be kept"
                    : link.location === "system"
                      ? "Requires administrator authorization"
                      : "For your user",
              disabled: !view.available || link.state !== "absent",
              run: () => {
                openSettings("about");
                void changeCommandInstall("install", link.location);
              },
            })),
          }),
          enabled: () => !busy,
        },
      },
      ...installed.map((link): ContributedCommand => ({
        id: `command.uninstall.${link.location}`,
        title: "Uninstall polaris command",
        palette: {
          group: "app",
          keywords: ["cli", "path", "shell", "remove"],
          detail: link.path,
        },
        handler: {
          run: () => {
            void changeCommandInstall("uninstall", link.location);
            openSettings("about");
          },
          enabled: () => !busy,
        },
      })),
    ]);
  }, [commands, view, busy, openSettings]);

  if (
    !view?.supported ||
    !view.available ||
    view.dismissed ||
    view.links.some((link) => link.state === "installed")
  )
    return null;

  return (
    <section
      aria-label="Command line setup"
      className="px-panel border-hairline flex flex-wrap items-center gap-3 border-b py-2"
    >
      <div className="min-w-0 flex-1">
        <p className="text-body text-text-default">
          Install <code>polaris</code> command
        </p>
        <p className="text-caption text-text-subtle" role="status">
          {problem ?? "Run polaris from your terminal · ~/.local/bin"}
        </p>
      </div>
      <SettingsButton
        disabled={busy}
        onClick={() => {
          openSettings("about");
          void changeCommandInstall("install", "user");
        }}
      >
        Install polaris command
      </SettingsButton>
      <SettingsButton variant="ghost" disabled={busy} onClick={() => void dismissCommandInstall()}>
        Not now
      </SettingsButton>
    </section>
  );
};
