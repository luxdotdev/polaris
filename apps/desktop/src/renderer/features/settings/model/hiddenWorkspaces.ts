/**
 * Settings → Sessions' hidden workspaces: each hidden Workspace on every Host with what removing
 * it takes (its agent sessions and constellations) or why it can't be removed yet (docs/adr/0086).
 */
import type { HostView } from "../../../../shared/api.ts";
import type { HostModel } from "../../../store/hostModel.ts";
import type { ConstellationsModel } from "../../constellation/model/types.ts";

export interface HiddenWorkspaceRow {
  /** `hostKey/workspaceId`. */
  readonly key: string;
  readonly hostKey: string;
  readonly hostLabel: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly path: string;
  /** Every agent session in it, archived ones included. */
  readonly sessions: number;
  /** Its agent sessions not archived yet: removal waits for them. */
  readonly unarchived: number;
  readonly constellations: number;
  readonly connected: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** By name, then host, like the other per-Workspace lists in Settings. */
export const hiddenWorkspaceRows = (
  hosts: ReadonlyArray<Pick<HostView, "key" | "label" | "status">>,
  models: Readonly<Record<string, Pick<HostModel, "workspaces" | "sessions">>>,
  constellations: Readonly<Record<string, Pick<ConstellationsModel, "listed">>>
): ReadonlyArray<HiddenWorkspaceRow> =>
  hosts
    .flatMap((host) => {
      const model = models[host.key];
      const listed = [...(constellations[host.key]?.listed.values() ?? [])];
      const sessions = [...(model?.sessions.values() ?? [])].map((entry) => entry.session);

      return [...(model?.workspaces.values() ?? [])].flatMap((w): Array<HiddenWorkspaceRow> => {
        if (!w.hidden) return [];
        const mine = sessions.filter((s) => s.workspaceId === w.id);

        return [
          {
            key: `${host.key}/${w.id}`,
            hostKey: host.key,
            hostLabel: host.label,
            workspaceId: w.id,
            name: w.name,
            path: w.path,
            sessions: mine.length,
            unarchived: mine.filter((s) => s.state !== "archived").length,
            constellations: listed.filter((c) => c.workspaceId === w.id).length,
            connected: host.status.state === "connected",
          },
        ];
      });
    })
    .toSorted((a, b) => a.name.localeCompare(b.name) || a.hostLabel.localeCompare(b.hostLabel));

/** The row's caption: "Linux VM · 14 agent sessions · 2 constellations". */
export const rowCaption = (row: HiddenWorkspaceRow): string =>
  [
    row.hostLabel,
    plural(row.sessions, "agent session"),
    ...(row.constellations === 0 ? [] : [plural(row.constellations, "constellation")]),
  ].join(" · ");

/** Why Remove is off, or null when it can run. */
export const removalBlocked = (row: HiddenWorkspaceRow): string | null => {
  if (!row.connected) return `${row.hostLabel} isn't connected`;

  if (row.unarchived === 0) return null;

  return row.unarchived === 1
    ? "Archive its last agent session to remove it"
    : `Archive its ${row.unarchived} agent sessions to remove it`;
};

/** What the confirmation says Remove does: "Removes 14 agent sessions and 2 constellations. …". */
export const removalConsequence = (row: HiddenWorkspaceRow): string => {
  const parts = [
    ...(row.sessions === 0 ? [] : [plural(row.sessions, "agent session")]),
    ...(row.constellations === 0 ? [] : [plural(row.constellations, "constellation")]),
  ];

  const what = parts.length === 0 ? `${row.name} from Polaris` : parts.join(" and ");

  return `Removes ${what}. The folder stays on disk.`;
};
