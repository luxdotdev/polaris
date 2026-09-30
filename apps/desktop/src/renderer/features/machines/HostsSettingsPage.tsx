/**
 * Settings → Hosts (Paper S4, 7CV-1; DESIGN.md, Settings · Hosts (S4)): the
 * 680px column with the hosts table and "Add a host", the page's one primary
 * button, which opens the add-machine flow inline under the table.
 */
import { Button, PlusIcon } from "@polaris/ui";
import { useState } from "react";
import type { MachineView } from "../../../shared/api.ts";
import { emptyHostModel, visibleWorkspaces } from "../../store/hostModel.ts";
import { useApp } from "../../shell/hooks.ts";
import { AddMachine } from "./AddMachine.tsx";
import { call, useMachines, useNow } from "./hooks.tsx";
import { HostDetails } from "./HostDetails.tsx";
import { HostRow, LANES } from "./HostRow.tsx";
import { needsUser } from "./model.ts";

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
  onToggle,
}: {
  readonly machine: MachineView;
  readonly now: number;
  readonly open: boolean;
  readonly onToggle: () => void;
}) => {
  const model = useApp((s) => s.hostModels[machine.key]);
  const workspaces = model === undefined ? null : visibleWorkspaces(model ?? emptyHostModel).length;
  const remote = machine.alias !== null;

  return (
    <HostRow
      machine={machine}
      workspaces={workspaces}
      now={now}
      expanded={open}
      onToggle={onToggle}
      onRetry={() => void call("host.retryNow", { hostKey: machine.key })}
      onRemove={remote ? () => void call("machines.remove", { hostKey: machine.key }) : null}
    >
      <HostDetails machine={machine} />
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
  // Rows the user opened or closed; others follow whether they need the user.
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});
  const now = useNow(machines?.some((m) => m.status?.state === "reconnecting") ?? false);

  const isOpen = (machine: MachineView) => toggled[machine.key] ?? needsUser(machine);

  const toggle = (machine: MachineView) =>
    setToggled((current) => ({ ...current, [machine.key]: !isOpen(machine) }));

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
          {(machines ?? []).map((machine) => (
            <Row
              key={machine.key}
              machine={machine}
              now={now}
              open={isOpen(machine)}
              onToggle={() => toggle(machine)}
            />
          ))}
        </ul>
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
            <PlusIcon />
            Add a host
          </Button>
          <span className="text-caption text-text-faint">
            Pick an alias from ~/.ssh/config; the first install asks for your approval.
          </span>
        </div>
      )}
    </div>
  );
};
