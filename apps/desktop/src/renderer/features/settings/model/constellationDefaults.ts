/**
 * Settings → Constellations' defaults on each Host (spec §4, precedence 3): the user's choice per
 * role, kept on this Mac, written into every connected Host's `constellation.defaults` (C1-E)
 * without touching what else the Host keeps there. Pure, so it is tested.
 */
import type { ConstellationSettings, HarnessSelection } from "@polaris/protocol";
import type { ConstellationDefaults, RoleDefault } from "../../../../shared/contract.ts";
import type { Plain } from "../../../store/plain.ts";

export type Selection = Plain<HarnessSelection>;

export type HostDefaults = Plain<ConstellationSettings>;

/** A role's default as the Host stores it: only what the user chose. */
export const selectionOf = (role: RoleDefault): Selection => {
  const withModel: Selection =
    role.model === null ? { harness: role.harness } : { harness: role.harness, model: role.model };

  return role.effort === null ? withModel : { ...withModel, effort: role.effort };
};

const same = (a: Selection | null | undefined, b: Selection) =>
  a != null && a.harness === b.harness && a.model === b.model && a.effort === b.effort;

/** The Host already holds the user's defaults for both roles. */
export const inSync = (host: HostDefaults, user: ConstellationDefaults) =>
  same(host.backend, selectionOf(user.backend)) && same(host.ui, selectionOf(user.ui));

/** The Host's settings with the user's roles written in; its branch prefix, transfer and timings kept. */
export const withUserDefaults = (
  host: HostDefaults,
  user: ConstellationDefaults
): HostDefaults => ({
  ...host,
  backend: selectionOf(user.backend),
  ui: selectionOf(user.ui),
});

/** What Settings says about one Host's copy. */
export type HostSync = "saving" | "saved" | "older-daemon" | "failed";

const names = (labels: ReadonlyArray<string>) =>
  labels.length <= 1
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1) ?? ""}`;

/** Where the defaults are, one sentence per kind: "Saved on Mac Studio and devbox." */
export const syncLines = (
  hosts: ReadonlyArray<{ readonly label: string; readonly sync: HostSync }>
): ReadonlyArray<string> => {
  const of = (sync: HostSync) => hosts.flatMap((h) => (h.sync === sync ? [h.label] : []));

  const [saved, saving, older, failed] = [
    of("saved"),
    of("saving"),
    of("older-daemon"),
    of("failed"),
  ];

  return [
    saved.length === 0 ? null : `Saved on ${names(saved)}.`,
    saving.length === 0 ? null : `Saving on ${names(saving)}…`,
    failed.length === 0
      ? null
      : `Couldn't save on ${names(failed)}; Polaris tries again when it reconnects.`,
    older.length === 0
      ? null
      : `${names(older)} ${older.length === 1 ? "runs a daemon" : "run daemons"} without these defaults; leads there use the built-in ones.`,
  ].filter((line) => line !== null);
};
