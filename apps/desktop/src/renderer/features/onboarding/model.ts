/**
 * Onboarding's decisions (DESIGN.md, Onboarding): which stage the app opens
 * to, and the lines that say what was found. Pure, so it is unit-tested.
 */
import { harnessEntry, type HostHarnesses, type Workspace } from "@polaris/protocol";
import type { HostView, Plain } from "../../../shared/api.ts";
import type { HostModel } from "../../store/hostModel.ts";

/** "unknown" until the settings arrive, so the welcome never flashes for a returning user. */
export type Welcome = "unknown" | "show" | "seen";

/**
 * - `welcome`: O1, full-bleed, before anything else.
 * - `waiting`: no Host has said what it holds yet; the stage stays an empty scene.
 * - `setup`: O2, no Workspace on any Host.
 * - `shell`: the Orchestrator as usual.
 */
export type Stage = "welcome" | "waiting" | "setup" | "shell";

export interface StageInput {
  readonly welcome: Welcome;
  readonly hosts: ReadonlyArray<HostView>;
  readonly models: Readonly<Record<string, HostModel>>;
}

const shown = (model: HostModel | undefined) =>
  model === undefined ? [] : [...model.workspaces.values()].filter((w) => !w.hidden);

/** Whether a Host's Workspaces are known: synchronized, or painted from the cache. */
const known = (model: HostModel | undefined) =>
  model !== undefined && (model.synchronized || model.fromCache);

export const onboardingStage = ({ welcome, hosts, models }: StageInput): Stage => {
  if (welcome === "show") return "welcome";

  if (hosts.some((h) => shown(models[h.key]).length > 0)) return "shell";

  return hosts.some((h) => known(models[h.key])) ? "setup" : "waiting";
};

/** Whether the Orchestrator's stage is the setup (no Workspace on any Host). */
export const noWorkspaceAnywhere = (input: Omit<StageInput, "welcome">) =>
  onboardingStage({ ...input, welcome: "seen" }) !== "shell";

export type Availability = Plain<HostHarnesses>;

const harnessName = (kind: string) => harnessEntry(kind)?.name ?? kind;

type Reported = Availability["harnesses"][number];

const named = (harnesses: ReadonlyArray<Reported>) =>
  harnesses.map((h) =>
    h.version === null ? harnessName(h.harness) : `${harnessName(h.harness)} ${h.version}`
  );

/** Installed Harnesses with their versions: "Claude Code 2.1.4", in catalogue order. */
export const installedHarnesses = (availability: Availability | null): ReadonlyArray<string> =>
  named((availability?.harnesses ?? []).filter((h) => h.status !== "not-installed"));

/** The installed Harnesses' names alone: "Claude Code". */
export const installedNames = (availability: Availability | null): ReadonlyArray<string> =>
  (availability?.harnesses ?? [])
    .filter((h) => h.status !== "not-installed")
    .map((h) => harnessName(h.harness));

export const hostsLine = (count: number) =>
  count === 1 ? "1 host in ~/.ssh/config" : `${count} hosts in ~/.ssh/config`;

/** O1's footer: "Claude Code 2.1.4 · Codex 0.52.0 · 14 hosts in ~/.ssh/config". */
export const foundLine = (availability: Availability | null, sshHosts: number | null): string => {
  const parts = [...installedHarnesses(availability)];

  if (sshHosts !== null && sshHosts > 0) parts.push(hostsLine(sshHosts));

  return parts.length === 0 ? "No agents yet" : parts.join(" · ");
};

/** "Claude Code 2.1.4 and Codex 0.52.0"; past `max` names, "A, B and 3 more". */
export const listed = (names: ReadonlyArray<string>, max = names.length): string => {
  if (names.length > max) return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;

  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
};

/** O1's line on what Polaris drives: the Harnesses found here, or the catalogue's first two. */
export const drivesLine = (installed: ReadonlyArray<string>, catalogue: ReadonlyArray<string>) => {
  const names = installed.length > 0 ? installed : catalogue;

  return names.length > 2 ? `${names.slice(0, 2).join(", ")} and more` : listed(names);
};

/** The Workspace already registered at a path, shown or hidden. */
export const workspaceAt = (model: HostModel | undefined, path: string): Workspace | undefined =>
  model === undefined ? undefined : [...model.workspaces.values()].find((w) => w.path === path);
