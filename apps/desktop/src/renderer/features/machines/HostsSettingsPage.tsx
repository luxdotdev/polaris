/**
 * Settings → Hosts (Paper S4, 7CV-1; DESIGN.md, Settings · Hosts (S4)): the
 * 680px column with the hosts table and "Add a host", the page's one primary
 * button, which opens the add-machine flow inline under the table.
 */
import { Button, PlusIcon } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { emptyHostModel, visibleWorkspaces } from "../../store/hostModel.ts";
import { useApp } from "../../shell/hooks.ts";
import { AddMachine } from "./AddMachine.tsx";
import { call, useMachines, useNow } from "./hooks.tsx";
import { HostDetails } from "./HostDetails.tsx";
import { HostRow, LANES } from "./HostRow.tsx";
import { attentionCard, needsUser } from "./model.ts";
import {
  setDaemonUpdateOverride,
  setKeepDaemonsUpToDate,
  updateDaemon,
} from "./updates/actions.ts";
import { KeepUpToDate, OverrideMenuItems } from "./updates/Controls.tsx";
import { type FailureAction, type UpdateLine, updateLine } from "./updates/model.ts";
import { useUpgradeClock } from "./updates/UpgradeStatus.tsx";
import { UpdateStrip } from "./updates/UpdateStrip.tsx";

const failureAction = (machine: MachineView, line: UpdateLine, action: FailureAction) => {
  if (action === "retry") return updateDaemon(machine.key);

  if (action === "open-ssh") return void call("machines.openSsh", { hostKey: machine.key });
  const detail = line.kind === "failed" ? line.failure.detail : null;

  if (detail !== null) void call("clipboard.write", { text: detail });
};

/** This Mac first, then the remote Hosts in the order they were added. */
const thisMacFirst = (machines: ReadonlyArray<MachineView>) => [
  ...machines.filter((m) => m.alias === null),
  ...machines.filter((m) => m.alias !== null),
];

const Header = () => (
  <div className="h-row px-panel border-hairline bg-surface-sunken flex shrink-0 items-center border-b">
    <span className="text-caption text-text-subtle flex-1">Host</span>
    <span className={`${LANES.daemon} text-caption text-text-subtle`}>Daemon</span>
    <span className={`${LANES.connection} text-caption text-text-subtle`}>Connection</span>
    <span className={LANES.trailing} />
  </div>
);

const Row = ({
  machine,
  now,
  open,
  settings,
  onToggle,
}: {
  readonly machine: MachineView;
  readonly now: number;
  readonly open: boolean;
  readonly settings: boolean;
  readonly onToggle: () => void;
}) => {
  const model = useApp((s) => s.hostModels[machine.key]);
  const workspaces = model === undefined ? null : visibleWorkspaces(model ?? emptyHostModel).length;
  const remote = machine.alias !== null;
  const daemon = machine.daemon;

  const line = updateLine({
    label: machine.label,
    alias: machine.alias,
    connected: machine.status?.state === "connected",
    daemon,
    now,
  });

  // A connection the user must fix is told once, by its own card.
  const shown = line.kind === "failed" && attentionCard(machine) !== null ? null : line;

  return (
    <HostRow
      machine={machine}
      workspaces={workspaces}
      now={now}
      expanded={open}
      onToggle={onToggle}
      onRetry={() => void call("host.retryNow", { hostKey: machine.key })}
      onRemove={remote ? () => void call("machines.remove", { hostKey: machine.key }) : null}
      daemonVersion={daemon?.installedVersion ?? null}
      update={
        shown === null ? null : (
          <UpdateStrip
            line={shown}
            onUpdate={() => updateDaemon(machine.key)}
            onFailureAction={(action) => failureAction(machine, shown, action)}
          />
        )
      }
      menu={
        daemon === null || !daemon.managed ? null : (
          <OverrideMenuItems
            daemon={daemon}
            onChange={(enabled) => setDaemonUpdateOverride(machine.key, enabled)}
          />
        )
      }
    >
      <HostDetails machine={machine} settings={settings} />
    </HostRow>
  );
};

export interface HostsSettingsPageProps {
  /** Open the add-machine flow at once (the first-run "connect a host" row). */
  readonly adding?: boolean;
}

export const HostsSettingsPage = ({ adding = false }: HostsSettingsPageProps) => {
  const machines = useMachines();
  const [adder, setAdder] = useState(adding);

  // "Connect a host" can open this page again while it is showing.
  useEffect(() => {
    if (adding) setAdder(true);
  }, [adding]);
  // Rows the user opened or closed; others follow whether they need the user.
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  // Rows opened because they needed the user stay open after, to show the outcome.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());

  const expiryClock = useUpgradeClock();

  const now = Math.max(
    expiryClock,
    useNow(machines?.some((m) => m.status?.state === "reconnecting") ?? false)
  );

  useEffect(() => {
    const opened = (machines ?? []).filter((m) => needsUser(m)).map((m) => m.key);

    if (opened.every((key) => kept.has(key))) return;
    setKept((current) => new Set([...current, ...opened]));
  }, [machines, kept]);

  const isOpen = (machine: MachineView) =>
    toggled[machine.key] ?? (kept.has(machine.key) || needsUser(machine));

  const toggle = (machine: MachineView) =>
    setToggled((current) => ({ ...current, [machine.key]: !isOpen(machine) }));

  const keep = machines?.find((m) => m.daemon !== null)?.daemon?.keepDaemonsUpToDate ?? null;
  const taken = new Set((machines ?? []).flatMap((m) => (m.alias === null ? [] : [m.alias])));

  return (
    <div
      data-testid="hosts-settings"
      className="gap-tree-row mx-auto flex w-[680px] max-w-full flex-col py-10"
    >
      <div className="flex flex-col gap-1.5">
        <h1 className="text-title text-text-strong">Hosts</h1>
        <p className="text-body text-text-subtle">
          Machines Polaris reaches over SSH, using your ~/.ssh/config. Each runs its own daemon;
          this Mac installs and upgrades them.
        </p>
      </div>
      <div className="border-hairline rounded-card flex flex-col overflow-clip border">
        <Header />
        <ul className="flex flex-col">
          {thisMacFirst(machines ?? []).map((machine) => (
            <Row
              key={machine.key}
              machine={machine}
              now={now}
              open={isOpen(machine)}
              settings={toggled[machine.key] === true}
              onToggle={() => toggle(machine)}
            />
          ))}
        </ul>
        {keep === null ? null : <KeepUpToDate checked={keep} onChange={setKeepDaemonsUpToDate} />}
      </div>
      {adder ? (
        <AddMachine
          taken={taken}
          onCancel={() => setAdder(false)}
          onAdded={(key) => {
            setAdder(false);
            setToggled((current) => ({ ...current, [key]: true }));
          }}
        />
      ) : (
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => setAdder(true)}>
            <PlusIcon size={12} />
            Add a host
          </Button>
          <span className="text-caption text-text-subtle">
            Pick an alias from ~/.ssh/config; the first install asks for your approval.
          </span>
        </div>
      )}
    </div>
  );
};
