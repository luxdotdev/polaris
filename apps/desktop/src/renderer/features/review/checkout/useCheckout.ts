/**
 * Everything the chip and its menu read for one pull request: its checkouts on every Host
 * (the last used Host's first), the Hosts that could hold one, and GitHub's view of it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { HostView, OpenPull } from "../../../../shared/api.ts";
import type { PullDetailView } from "../../../../shared/github.ts";
import { Commands } from "../../../commands.ts";
import { useApp } from "../../../shell/hooks.ts";
import { usePulls } from "../../pulls/store.ts";
import { send } from "../../session/dispatch.ts";
import { refreshPullDetail, useLoadedPullDetail } from "../data/pullDetail.ts";
import { checkoutsOf } from "../data/source.ts";
import type { Held } from "./actions.ts";
import { chipView, type ChipView, type HostFacts } from "./model/chip.ts";
import {
  type HostChoice,
  hostChoices,
  orderPlaces,
  type Place,
  type PlaceHost,
} from "./model/hosts.ts";
import { pullName } from "./model/watch.ts";
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
}

/** Reconnecting time ticks once a second, only while it shows: an idle chip never wakes. */
const TICK_MS = 1000;

const useTick = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(timer);
  }, [active]);

  return now;
};

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
  const reconnecting = host?.status.state === "reconnecting";
  const now = useTick(reconnecting);

  const held: Held | null =
    chosen === null
      ? null
      : {
          hostKey: chosen.hostKey,
          hostLabel: host?.label ?? chosen.hostKey,
          checkout: chosen.checkout,
        };

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

  return { view, held, choices, detail, nextPlace };
};

const reported = new Map<string, string>();

/** GitHub's head, from the detail this Review already loaded, reaches the Host holding the checkout. */
const useReportHead = (held: Held | null, detail: PullDetailView | null) => {
  const checkoutId = held?.checkout.id;
  const latestHead = held?.checkout.latestHead;
  const state = held?.checkout.state;
  const hostKey = held?.hostKey;

  useEffect(() => {
    if (checkoutId === undefined || hostKey === undefined || detail === null) return;

    if (detail.state !== "open" || detail.headRefOid === latestHead) return;

    if (state === "fetching" || state === "removing") return;

    if (reported.get(checkoutId) === detail.headRefOid) return;
    reported.set(checkoutId, detail.headRefOid);

    void send(
      hostKey,
      Commands.ReportReviewHead({ checkoutId, head: detail.headRefOid, base: detail.baseRefOid }),
      "Couldn’t tell the host about new commits"
    );
  }, [checkoutId, hostKey, latestHead, state, detail]);
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
