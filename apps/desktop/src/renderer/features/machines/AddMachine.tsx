/**
 * "Add a host": pick an alias from `~/.ssh/config`, name it, optionally mark
 * it with a colour, and leave agent forwarding off unless needed. Never asks
 * for an IP or a key. Adding probes the Host and asks before installing.
 */
import { Button, cn, Input, Switch } from "@polaris/ui";
import { useEffect, useState } from "react";
import type { SshAliasView } from "../../../shared/api.ts";
import { call } from "./hooks.tsx";

/** Low-chroma marks for telling machines apart; never a signal hue (rule/colour-means-something). */
export const MACHINE_COLOURS: ReadonlyArray<{ readonly name: string; readonly value: string }> = [
  { name: "Slate", value: "#8A93A6" },
  { name: "Sage", value: "#8FA58E" },
  { name: "Sand", value: "#B3A286" },
  { name: "Clay", value: "#B08A80" },
  { name: "Heather", value: "#9C8FB0" },
];

export interface AddMachineProps {
  /** Aliases already added; they aren't offered again. */
  readonly taken: ReadonlySet<string>;
  readonly onAdded: (key: string) => void;
  readonly onCancel: () => void;
}

const where = (alias: SshAliasView) => {
  const host = alias.hostName ?? alias.alias;

  return alias.user === null ? host : `${alias.user}@${host}`;
};

const AliasList = ({
  aliases,
  selected,
  onSelect,
}: {
  readonly aliases: ReadonlyArray<SshAliasView>;
  readonly selected: string | null;
  readonly onSelect: (alias: SshAliasView) => void;
}) => (
  <ul
    role="radiogroup"
    aria-label="Host from ~/.ssh/config"
    className="flex max-h-[220px] flex-col overflow-y-auto"
  >
    {aliases.map((alias) => (
      <li key={alias.alias}>
        <button
          type="button"
          role="radio"
          aria-checked={selected === alias.alias}
          onClick={() => onSelect(alias)}
          className={cn(
            "h-row px-row-x flex w-full cursor-default items-center gap-3 rounded-row text-left",
            selected === alias.alias ? "bg-fill-selected" : "hover:bg-fill-hover"
          )}
        >
          <span className="text-code-inline text-text-strong w-[160px] shrink-0 truncate font-mono">
            {alias.alias}
          </span>
          <span className="text-caption text-text-subtle truncate">{where(alias)}</span>
        </button>
      </li>
    ))}
  </ul>
);

const Swatches = ({
  value,
  onChange,
}: {
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
}) => (
  <div role="radiogroup" aria-label="Colour" className="flex items-center gap-1.5">
    {[{ name: "None", value: null }, ...MACHINE_COLOURS].map((colour) => (
      <button
        key={colour.name}
        type="button"
        role="radio"
        aria-label={colour.name}
        aria-checked={value === colour.value}
        onClick={() => onChange(colour.value)}
        className={cn(
          "flex size-6 cursor-default items-center justify-center rounded-control border",
          value === colour.value ? "border-text-subtle" : "border-transparent hover:border-hairline"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-3 rounded-[3px]",
            colour.value === null && "border-text-faint border border-dashed"
          )}
          style={colour.value === null ? undefined : { background: colour.value }}
        />
      </button>
    ))}
  </div>
);

export const AddMachine = ({ taken, onAdded, onCancel }: AddMachineProps) => {
  const [aliases, setAliases] = useState<ReadonlyArray<SshAliasView> | null>(null);
  const [alias, setAlias] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [colour, setColour] = useState<string | null>(null);
  const [forwardAgent, setForwardAgent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call("machines.sshAliases", {}).then((found) => setAliases(found ?? []));
  }, []);

  const offered = (aliases ?? []).filter((a) => !taken.has(a.alias));

  const add = () => {
    if (alias === null) return;
    setBusy(true);
    void call("machines.add", { alias, label: label.trim() || alias, colour, forwardAgent })
      .then((added) => {
        if (added !== null) onAdded(added.key);
      })
      .finally(() => setBusy(false));
  };

  return (
    <section
      aria-label="Add a host"
      data-testid="add-machine"
      className="border-hairline bg-surface-raised p-panel rounded-card flex flex-col gap-4 border"
    >
      <div className="flex flex-col gap-1">
        <p className="text-heading-sm text-text-strong">Add a host</p>
        <p className="text-caption text-text-subtle">
          Hosts come from ~/.ssh/config, so ssh already knows the address, user and key.
        </p>
      </div>
      {aliases === null ? (
        <p className="text-caption text-text-subtle">Reading ~/.ssh/config…</p>
      ) : offered.length === 0 ? (
        <p className="text-caption text-text-subtle">
          No other hosts in ~/.ssh/config. Add a Host block there, then open this again.
        </p>
      ) : (
        <AliasList
          aliases={offered}
          selected={alias}
          onSelect={(picked) => {
            setAlias(picked.alias);
            setLabel((current) => (current === "" || current === alias ? picked.alias : current));
          }}
        />
      )}
      <div className="flex items-center gap-3">
        <label className="flex flex-1 items-center gap-3">
          <span className="text-label text-text-default w-[72px] shrink-0">Name</span>
          <Input
            value={label}
            placeholder="Mac Studio"
            onChange={(event) => setLabel(event.target.value)}
            className="flex-1"
          />
        </label>
        <Swatches value={colour} onChange={setColour} />
      </div>
      <label className="flex items-center gap-3">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-label text-text-default">Forward ssh-agent</span>
          <span className="text-caption text-text-subtle">
            Off unless agents there need your keys for git.
          </span>
        </span>
        <Switch
          checked={forwardAgent}
          onCheckedChange={setForwardAgent}
          aria-label="Forward ssh-agent"
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={alias === null || busy} onClick={add}>
          Add host
        </Button>
      </div>
    </section>
  );
};
