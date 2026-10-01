/**
 * Settings → Sessions' "Accepting work" (ENG-224): where accepted Turns are committed by
 * default (committing to main is first-class), and per-Workspace overrides.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@polaris/ui";
import { ACCEPT_BRANCH_LABELS } from "../../../../shared/acceptBranch.ts";
import type { AcceptBranchMode } from "../../../../shared/contract.ts";
import { setSessionPrefs, useSettings } from "../store.ts";
import { Group, Heading, SettingRow } from "./parts.tsx";
import { useWorkspaceOptions, WorkspaceOverrides } from "./WorkspaceOverrides.tsx";

const MODES: ReadonlyArray<AcceptBranchMode> = ["auto", "current", "create"];

const isMode = (value: string): value is AcceptBranchMode => MODES.some((mode) => mode === value);

const ModeSelect = ({
  id,
  value,
  onChange,
  label,
}: {
  readonly id?: string;
  readonly value: AcceptBranchMode;
  readonly onChange: (mode: AcceptBranchMode) => void;
  readonly label: string;
}) => (
  <Select
    value={value}
    onValueChange={(next) => {
      if (isMode(next)) onChange(next);
    }}
  >
    <SelectTrigger id={id} aria-label={label} className="text-label h-7 w-[264px]">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {MODES.map((mode) => (
        <SelectItem key={mode} value={mode}>
          {ACCEPT_BRANCH_LABELS[mode]}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const without = <V,>(record: Readonly<Record<string, V>>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));

export const AcceptBranch = () => {
  const mode = useSettings((s) => s.sessions.acceptBranch);
  const overrides = useSettings((s) => s.sessions.workspaceAcceptBranch);
  const prefix = useSettings((s) => s.sessions.branchPrefix);
  const options = useWorkspaceOptions().filter((o) => o.isGitRepo);

  const setOverride = (key: string, next: AcceptBranchMode | null) =>
    setSessionPrefs({
      workspaceAcceptBranch:
        next === null ? without(overrides, key) : { ...overrides, [key]: next },
    });

  return (
    <section aria-label="Accepting work" className="flex flex-col gap-3">
      <Heading>Accepting work</Heading>
      <Group>
        <SettingRow
          title="Where accepted turns are committed"
          caption={`New branches are named ${prefix}<session>. A session on its own worktree uses its branch.`}
          htmlFor="accept-branch"
        >
          <ModeSelect
            id="accept-branch"
            label="Where accepted turns are committed"
            value={mode}
            onChange={(next) => setSessionPrefs({ acceptBranch: next })}
          />
        </SettingRow>
      </Group>
      <WorkspaceOverrides
        label="Workspaces that commit differently"
        keys={Object.keys(overrides).toSorted()}
        options={options}
        addLabel="A workspace can commit differently, e.g. straight to main."
        onAdd={(key) => setOverride(key, mode === "current" ? "auto" : "current")}
        onRemove={(key) => setOverride(key, null)}
        control={(key) => (
          <ModeSelect
            label="Where this workspace commits"
            value={overrides[key] ?? mode}
            onChange={(next) => setOverride(key, next)}
          />
        )}
      />
    </section>
  );
};
