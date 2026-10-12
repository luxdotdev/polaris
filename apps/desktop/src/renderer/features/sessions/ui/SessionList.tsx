/**
 * The Workspace's session list in the sidebar (the shell's `SessionList` slot): Pinned, then
 * the sessions, then Reviews (Paper 12); each Lead with its workers nested under it (Paper C1).
 */
import { SectionHeader } from "@polaris/ui";
import { useMemo } from "react";
import { useApp } from "../../../shell/hooks.ts";
import { SessionRow, WorktreeRows } from "../../../shell/sidebar/SessionRow.tsx";
import type { HostModel, SessionEntry } from "../../../store/hostModel.ts";
import {
  lookupIn,
  type SetupLookup,
  setupLookupIn,
  sidebarItems,
  type WorkerLookup,
} from "../model/leadGroups.ts";
import { sectionsOf } from "../model/sections.ts";
import { useConstellations } from "../source.ts";
import { LeadGroup } from "./LeadGroup.tsx";
import { ReviewsGroup, reviewsKey } from "./Reviews.tsx";

export interface SessionListProps {
  readonly hostKey: string;
  readonly model: HostModel;
  /** The Workspace's active sessions, in sidebar order. */
  readonly entries: ReadonlyArray<SessionEntry>;
  readonly now: number;
  /** Folds this list's Reviews group (`workspaceKey`). */
  readonly scope: string;
  /** Under an empty Sessions header: "None in polaris". */
  readonly empty: string;
}

/** Finds a worker's session on whichever Host runs it (`Attempt.hostId`). */
export const useWorkerLookup = (): WorkerLookup => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return useMemo(() => lookupIn(hosts, models), [hosts, models]);
};

/** Finds workers still in worktree setup (no Attempt yet) on every Host. */
export const useSetupLookup = (): SetupLookup => {
  const hosts = useApp((s) => s.hosts);
  const models = useApp((s) => s.hostModels);

  return useMemo(() => setupLookupIn(hosts, models), [hosts, models]);
};

const worktreesBy = (model: HostModel, entry: SessionEntry) =>
  [...model.worktrees.values()].filter((w) => w.createdBySessionId === entry.session.id);

type Item = ReturnType<typeof sidebarItems>["items"][number];

const entryOf = (item: Item) => (item.kind === "lead" ? item.group.lead : item.entry);

const Items = ({
  hostKey,
  model,
  items,
  now,
}: {
  readonly hostKey: string;
  readonly model: HostModel;
  readonly items: ReadonlyArray<Item>;
  readonly now: number;
}) =>
  items.map((item) =>
    item.kind === "lead" ? (
      <LeadGroup key={item.group.key} hostKey={hostKey} group={item.group} now={now} />
    ) : (
      <div key={item.entry.session.id} className="flex flex-col">
        <SessionRow hostKey={hostKey} entry={item.entry} now={now} />
        <WorktreeRows worktrees={worktreesBy(model, item.entry)} />
      </div>
    )
  );

export const SessionList = ({ hostKey, model, entries, now, scope, empty }: SessionListProps) => {
  const views = useConstellations(hostKey);
  const lookup = useWorkerLookup();
  const setups = useSetupLookup();

  const { pinned, sessions, reviews } = useMemo(
    () => sectionsOf(sidebarItems({ hostKey, entries, views, lookup, setups }).items, entryOf),
    [hostKey, entries, views, lookup, setups]
  );

  return (
    <>
      {pinned.length === 0 ? null : (
        <>
          <SectionHeader>Pinned</SectionHeader>
          <Items hostKey={hostKey} model={model} items={pinned} now={now} />
        </>
      )}
      <SectionHeader
        className={pinned.length === 0 ? undefined : "pt-2"}
        empty={sessions.length === 0 ? empty : undefined}
      >
        Sessions
      </SectionHeader>
      <Items hostKey={hostKey} model={model} items={sessions} now={now} />
      <ReviewsGroup foldKey={reviewsKey(scope)} entries={reviews.map(entryOf)}>
        <Items hostKey={hostKey} model={model} items={reviews} now={now} />
      </ReviewsGroup>
    </>
  );
};

/** "2 constellations" for the sidebar footer, or null with none in the Workspace. */
export const useConstellationCount = (hostKey: string | null, workspaceId: string | null) => {
  const views = useConstellations(hostKey);

  return views.filter(
    (v) => v.constellation.workspaceId === workspaceId && v.constellation.state !== "archived"
  ).length;
};
