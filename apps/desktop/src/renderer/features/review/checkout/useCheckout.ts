/**
 * Everything the chip and its menu read for one pull request: its checkouts on every Host
 * (the last used Host's first), the Hosts that could hold one, and GitHub's view of it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { HostView, OpenPull } from "../../../../shared/api.ts";
import type { CompareView, PullDetailView } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import { useApp } from "../../../shell/hooks.ts";
import { usePulls } from "../../pulls/store.ts";
import { send } from "../../session/dispatch.ts";
import { refreshPullDetail, useLoadedPullDetail } from "../data/pullDetail.ts";
import { checkoutsOf } from "../data/source.ts";
import type { Held } from "./actions.ts";
import { type CloneState, type CloneTarget, forgetClone, useClone } from "./clone.ts";
import { chipView, type ChipView, type HostFacts } from "./model/chip.ts";
import {
  type HostChoice,
  hostChoices,
  orderPlaces,
  type Place,
  type PlaceHost,
} from "./model/hosts.ts";
import { pullName } from "./model/watch.ts";
import { useNewCommits } from "./newCommits.ts";
import { type RunCommand, useRun, useRunCommand } from "./run.ts";
import { repoName, useCheckoutMemory } from "./store.ts";

const NO_PLACES: ReadonlyArray<Place> = [];

/** The Workspaces the PR list matched to this pull request's repository. */
export const usePlaces = (pull: OpenPull): ReadonlyArray<Place> =>
  usePulls((s) => {
    const name = repoName(pull.repo);
    const rows = [...(s.list?.requested ?? []), ...(s.list?.mine ?? []), ...(s.list?.other ?? [])];

    return rows.find((r) => r.repo.toLowerCase() === name)?.workspaces ?? NO_PLACES;
  });

const placeHost = (h: HostView): PlaceHost => ({
  key: h.key,
  label: h.label,
  local: h.alias === null,
  state: h.status.state,
  latencyMs: h.status.latencyMs,
});

const hostFacts = (h: HostView): HostFacts => ({
  label: h.label,
  state: h.status.state,
  since: h.status.since,
});

export interface CheckoutModel {
  readonly view: ChipView;
  /** The checkout the chip speaks for; null with none. */
  readonly held: Held | null;
  readonly choices: ReadonlyArray<HostChoice>;
  readonly detail: PullDetailView | null;
  /** The first connected place other than the held checkout's Host. */
  readonly nextPlace: Place | null;
  /** What Run starts in the checkout. */
  readonly command: RunCommand;
  /** The commits an update would bring, once GitHub has compared them. */
  readonly newCommits: CompareView | null;
  /** Connected Hosts "Clone on…" can use, when no Workspace has the repository. */
  readonly cloneTargets: ReadonlyArray<CloneTarget>;
  readonly clone: CloneState | null;
  /** The held checkout's Host's home, for `~/` paths. */
  readonly home: string | null;
}

/** Reconnecting time ticks each second and a run's every 15 s, only while they show. */
const RECONNECTING_TICK_MS = 1000;

const RUNNING_TICK_MS = 15_000;

const useTick = (ms: number | null): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (ms === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), ms);

    return () => clearInterval(timer);
  }, [ms]);

  return now;
};

const cloneTargetsOf = (hosts: ReadonlyArray<HostView>): ReadonlyArray<CloneTarget> =>
  hosts.flatMap((h) =>
    h.status.state === "connected" && h.status.host !== null
      ? [{ hostKey: h.key, label: h.label, homeDir: h.status.host.homeDir }]
      : []
  );

export const useCheckout = (pull: OpenPull): CheckoutModel => {
  const models = useApp((s) => s.hostModels);
  const hosts = useApp((s) => s.hosts);
  const places = usePlaces(pull);
  const repo = repoName(pull.repo);
  const lastHostKey = useCheckoutMemory((s) => s.lastHost[repo] ?? null);
  const removed = useCheckoutMemory((s) => s.removed[pullName(pull)] ?? null);
  const detail = useLoadedPullDetail(pull);

  const found = useMemo(() => checkoutsOf(pull, models), [pull, models]);
  const chosen = found.find((f) => f.hostKey === lastHostKey) ?? found[0] ?? null;
  const host = chosen === null ? undefined : hosts.find((h) => h.key === chosen.hostKey);

  const held: Held | null = useMemo(
    () =>
      chosen === null
        ? null
        : {
            hostKey: chosen.hostKey,
            hostLabel: host?.label ?? chosen.hostKey,
            checkout: chosen.checkout,
          },
    [chosen, host?.label]
  );

  const command = useRunCommand(held);
  const run = useRun(held);
  const newCommits = useNewCommits(held, pull);
  const clone = useClone(pull);
  const reconnecting = host?.status.state === "reconnecting";
  const now = useTick(reconnecting ? RECONNECTING_TICK_MS : run === null ? null : RUNNING_TICK_MS);

  const connected = (key: string) =>
    hosts.some((h) => h.key === key && h.status.state === "connected");

  const nextPlace =
    orderPlaces(places, lastHostKey).find(
      (p) => p.hostKey !== chosen?.hostKey && connected(p.hostKey)
    ) ?? null;

  const labelOf = (key: string | undefined) =>
    key === undefined ? null : (hosts.find((h) => h.key === key)?.label ?? key);

  const view = chipView({
    checkout: chosen?.checkout ?? null,
    host: host === undefined ? null : hostFacts(host),
    places: places.length,
    firstConnected: labelOf(nextPlace?.hostKey),
    firstPlace: labelOf(orderPlaces(places, lastHostKey)[0]?.hostKey),
    removed,
    now,
    command: command.kind === "found" ? command.command : null,
    run,
    fetchingCommits: held?.checkout.head === null ? (newCommits?.total ?? null) : null,
    newCommits:
      newCommits === null || held?.checkout.head === null
        ? null
        : { total: newCommits.total, rewritten: newCommits.status === "diverged" },
    clone,
  });

  const choices = hostChoices({
    places,
    hosts: hosts.map(placeHost),
    workspaceName: (p) => models[p.hostKey]?.workspaces.get(p.workspaceId)?.name ?? null,
    lastHostKey,
    currentHostKey: chosen?.hostKey ?? null,
  });

  useReportHead(held, detail);
  useRefreshOnHead(pull, held?.checkout.head ?? null);

  // Once a cloned folder is a Workspace that holds the repository, the clone is done.
  useEffect(() => {
    if (clone !== null && clone.status === "added" && places.length > 0) forgetClone(pull);
  }, [clone, places.length, pull]);

  return {
    view,
    held,
    choices,
    detail,
    nextPlace,
    command,
    newCommits,
    cloneTargets: cloneTargetsOf(hosts),
    clone,
    home: host?.status.host?.homeDir ?? null,
  };
};

const reported = new Map<string, string>();

/**
 * GitHub's head, from the detail this Review loaded, reaches the Host holding the checkout.
 * Only a newly fetched detail reports: an older one must never undo a head the feed relayed.
 */
const useReportHead = (held: Held | null, detail: PullDetailView | null) => {
  const latest = useRef(held);
  latest.current = held;

  useEffect(() => {
    const current = latest.current;

    if (current === null || detail === null || detail.state !== "open") return;
    const { checkout, hostKey } = current;

    if (detail.headRefOid === checkout.latestHead) return;

    if (checkout.state === "fetching" || checkout.state === "removing") return;

    if (reported.get(checkout.id) === detail.headRefOid) return;
    reported.set(checkout.id, detail.headRefOid);

    void send(
      hostKey,
      Commands.ReportReviewHead({
        checkoutId: checkout.id,
        head: detail.headRefOid,
        base: detail.baseRefOid,
      }),
      "Couldn’t tell the host about new commits"
    );
  }, [detail]);
};

/** After an update, GitHub's Viewed marks are read again: files the new commits touch lose theirs. */
const useRefreshOnHead = (pull: OpenPull, head: string | null) => {
  const { owner, name } = pull.repo;
  const { number } = pull;
  const previous = useRef(head);

  useEffect(() => {
    const before = previous.current;
    previous.current = head;

    if (before !== null && head !== null && before !== head) {
      void refreshPullDetail({ repo: { owner, name }, number });
    }
  }, [head, owner, name, number]);
};
