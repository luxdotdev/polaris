/**
 * The aggregate Live Activity in the app (docs/adr/0088): started when the app comes to the
 * front with anything working, updated from the feeds while in front, ended once every Host has
 * been idle a while. Its update token is registered with each linked Host, which pushes from then.
 */
import type { RelayIdentity } from "@polaris/protocol/relay/party";
import * as Notifications from "expo-notifications";
import { Match, Option } from "effect";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { PolarisLiveActivity } from "../../modules/polaris-live-activity/index.ts";
import { PolarisPush } from "../../modules/polaris-push/index.ts";
import { useFollowedHosts } from "../home/feed/useFollowedHosts.ts";
import { answerHost, deliverAnswer, unsentNotice } from "../push/deliver.ts";
import type { PushLinkedHost } from "../push/usePush.ts";
import { useHosts } from "../runtime/hosts.tsx";
import { decodeLiveAnswer, type LiveAnswer, liveAnswerId, liveAnswerOf } from "./answer.ts";
import {
  IDLE_END_MS,
  type LiveAction,
  type LiveContent,
  type LiveHost,
  liveAction,
  liveContent,
} from "./content.ts";
import { type LiveDevice, registerLiveActivity } from "./registration.ts";

const native = Platform.OS === "ios" ? PolarisLiveActivity : null;

/** Feed changes are coalesced: one local update at most this often. */
const UPDATE_EVERY_MS = 2_000;

const useForeground = () => {
  const [active, setActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active")
    );

    return () => subscription.remove();
  }, []);

  return active;
};

/** The linked Hosts seen this launch, with their feeds. */
const useLiveHosts = (linked: ReadonlyArray<PushLinkedHost>): ReadonlyArray<LiveHost> => {
  const followed = useFollowedHosts();

  return useMemo(
    () =>
      followed.flatMap(({ connection, status, followed: feed }) => {
        const link = linked.find((host) => host.hostId === connection.hostId);

        if (link === undefined || !feed.seen) return [];

        return [
          {
            hostId: connection.hostId,
            hostAddress: link.hostAddress,
            name: status.host?.hostname ?? connection.name,
            feed: feed.state,
          },
        ];
      }),
    [followed, linked]
  );
};

const perform = (live: NonNullable<typeof native>, action: LiveAction, slices: Slices) =>
  Match.value(action).pipe(
    Match.when("show", () => live.start(slices).then((id) => id !== null)),
    Match.when("update", () =>
      live.update(slices, Math.floor(Date.now() / 1000), false).then(() => true)
    ),
    Match.when("end", () => live.end().then(() => false)),
    Match.orElse(() => Promise.resolve(false))
  );

type Slices = LiveContent["slices"];

/** Unlinked from every Host: the activity has nothing left to show. */
const useEndOnUnlink = (linkedNow: boolean, running: { current: boolean }) => {
  const wasLinked = useRef(false);

  useEffect(() => {
    if (linkedNow) wasLinked.current = true;
    else if (wasLinked.current && native !== null) {
      wasLinked.current = false;
      void native.end().then(() => (running.current = false));
    }
  }, [linkedNow, running]);
};

const useDriver = (hosts: ReadonlyArray<LiveHost>, linkedNow: boolean) => {
  const foreground = useForeground();
  const content = useMemo(() => liveContent(hosts), [hosts]);
  // One may be showing from before this launch: update and end find it, or do nothing.
  const running = useRef(true);
  const idleSince = useRef<number | null>(null);
  const lastRun = useRef(0);
  const [tick, setTick] = useState(0);

  if (content.busy) idleSince.current = null;
  else idleSince.current ??= Date.now();

  useEndOnUnlink(linkedNow, running);

  useEffect(() => {
    if (native === null || !foreground || !linkedNow || hosts.length === 0) return;

    const run = () => {
      lastRun.current = Date.now();
      const action = liveAction(running.current, content.busy, idleSince.current, Date.now());

      void perform(native, action, content.slices).then(
        (showing) => (running.current = showing),
        () => undefined
      );
    };

    const timer = setTimeout(run, Math.max(0, lastRun.current + UPDATE_EVERY_MS - Date.now()));

    // While idle, look again once the idle stretch has run out.
    const recheck =
      idleSince.current === null
        ? null
        : setTimeout(() => setTick((t) => t + 1), idleSince.current + IDLE_END_MS - Date.now());

    return () => {
      clearTimeout(timer);

      if (recheck !== null) clearTimeout(recheck);
    };
  }, [content, foreground, linkedNow, hosts.length, tick]);
};

const useRegistrations = (
  identity: RelayIdentity | null,
  linked: ReadonlyArray<PushLinkedHost>
) => {
  const connections = useHosts();
  const [device, setDevice] = useState<LiveDevice | null>(null);
  // Per Host, the connection epoch and token it was registered with: a change registers again.
  const registered = useRef(new Map<string, string>());

  useEffect(() => {
    if (native === null || identity === null) {
      registered.current.clear();
      setDevice(null);

      return;
    }

    const adopt = (token: string) =>
      void PolarisPush.pushKey().then((pushKey) =>
        setDevice({
          token: token.toLowerCase(),
          environment: PolarisPush.apnsEnvironment(),
          pushKey,
          identity,
        })
      );

    const subscription = native.addListener("pushToken", ({ token }) => adopt(token));
    const known = native.pushToken();

    if (known !== null) adopt(known);

    return () => subscription.remove();
  }, [identity]);

  useEffect(() => {
    if (device === null) return;

    const sync = () => {
      for (const { hostId, hostAddress } of linked) {
        const host = connections.find((h) => h.hostId === hostId);
        const live = host?.live() ?? null;

        if (host === undefined || live === null) continue;
        const key = `${live.epoch}:${device.token}`;

        if (registered.current.get(hostId) === key) continue;
        registered.current.set(hostId, key);
        void registerLiveActivity(host, device, hostAddress).catch(() =>
          registered.current.delete(hostId)
        );
      }
    };

    sync();
    const unsubscribes = connections.map((host) => host.subscribe(sync));

    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [device, connections, linked]);
};

/** Answers from the takeover's Approve, Always here and Deny, as a notification's are sent. */
const useAnswers = (loaded: boolean) => {
  const connections = useHosts();
  const current = useRef(connections);
  current.current = connections;
  const ready = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);

  if (ready.current === null) {
    let resolve = () => {};

    const promise = new Promise<void>((done) => (resolve = done));
    ready.current = { promise, resolve: () => resolve() };
  }

  useEffect(() => {
    if (loaded) ready.current?.resolve();
  }, [loaded]);

  useEffect(() => {
    if (native === null) return;
    const loadedPromise = ready.current?.promise ?? Promise.resolve();

    const send = async (taken: LiveAnswer) => {
      const answer = liveAnswerOf(taken);

      try {
        const hosts = () => current.current.map(answerHost);
        const outcome = await deliverAnswer(loadedPromise, hosts, answer);
        const host = current.current.find((h) => h.hostId === answer.hostId);
        const notice = unsentNotice(outcome, host?.name ?? null);

        if (notice !== null)
          await Notifications.scheduleNotificationAsync({ content: notice, trigger: null });
      } finally {
        native.answered(liveAnswerId(answer));
      }
    };

    const take = () => {
      // One that doesn't parse lets its intent return when its wait runs out.
      for (const taken of native
        .takeAnswers()
        .flatMap((raw) => Option.toArray(decodeLiveAnswer(raw))))
        void send(taken);
    };

    const subscription = native.addListener("answer", take);
    // An intent can launch the app before this listener exists: its answer is waiting.
    take();

    return () => subscription.remove();
  }, []);
};

/**
 * Mount once, under FollowedHostsProvider, with the device's relay identity, its linked Hosts
 * and whether they were loaded from the Keychain yet.
 */
export const useLiveActivity = (
  identity: RelayIdentity | null,
  linked: ReadonlyArray<PushLinkedHost>,
  loaded: boolean
) => {
  const hosts = useLiveHosts(linked);
  useDriver(hosts, identity !== null);
  useRegistrations(identity, linked);
  useAnswers(loaded);
};
