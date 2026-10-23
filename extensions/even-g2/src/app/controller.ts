/**
 * Runs the glasses app: feeds Hosts and the session on screen into the state,
 * turns glasses input into moves, carries out their acts through the SDK, and
 * draws every state on the glasses.
 */
import type { HostView, PolarisClient } from "@polaris/sdk";
import type { Glasses } from "../glasses/bridge.ts";
import type { GlassesEvent } from "../glasses/input.ts";
import { rendererFor, RENDER_DELAY_MS } from "../glasses/renderer.ts";
import {
  type Act,
  type AppState,
  initialState,
  onHosts,
  onInput,
  onLastTurn,
  onNotice,
  onTranscript,
  onVoiceFailed,
} from "../model/app.ts";
import { layout } from "../model/layout.ts";
import { DONE, type MenuAction } from "../model/menu.ts";
import type { SessionKey } from "../model/sessions.ts";
import { describeError } from "./errors.ts";
import { describeCause } from "./log.ts";
import { listen, type Listening } from "./voice.ts";

export interface AppOptions {
  readonly glasses: Glasses;
  /** Opens a client for these pairing strings. */
  readonly connect: (pairings: ReadonlyArray<string>) => Promise<PolarisClient>;
  readonly renderDelayMs?: number;
  /** Every Hosts update, for the phone's page. */
  readonly onHosts?: (hosts: ReadonlyArray<HostView>) => void;
  /** A line for the phone's connection log. */
  readonly log?: (line: string) => void;
}

/** How a Host's connection stands, as the log reports it. */
const linkOf = (view: HostView) => {
  if (view.error !== null) return `can't be shown: ${describeCause(view.error)}`;

  return view.connected ? `connected, ${view.sessions.length} agent sessions` : "reconnecting";
};

export interface App {
  /** Replaces the pairings and connects again. */
  readonly pair: (pairings: ReadonlyArray<string>) => Promise<void>;
  /** Drops the connections and opens them again, as after the WebView comes back. */
  readonly reconnect: () => Promise<void>;
  readonly state: () => AppState;
  /** Resolves once the current state is on the glasses. */
  readonly settled: () => Promise<void>;
  readonly close: () => Promise<void>;
}

const keyString = (key: SessionKey) => `${key.hostId}/${key.sessionId}`;

const screenKey = (state: AppState) => (state.screen.kind === "sessions" ? null : state.screen.key);

export const startApp = (options: AppOptions): App => {
  const { glasses } = options;
  const renderer = rendererFor(glasses, options.renderDelayMs ?? RENDER_DELAY_MS);
  const log = options.log ?? (() => undefined);
  const links = new Map<string, string>();
  let state = initialState(false);
  let pairings: ReadonlyArray<string> = [];
  let client: PolarisClient | null = null;
  let generation = 0;
  let detail: { readonly key: string; readonly stop: () => void } | null = null;
  let voice: Listening | null = null;

  const hostName = (hostId: string) =>
    state.hosts.find((host) => host.hostId === hostId)?.hostName ?? "the host";

  const set = (next: AppState) => {
    state = next;
    renderer.show(layout(state));
    followSession();

    if (state.screen.kind !== "voice" && voice !== null) {
      voice.cancel();
      voice = null;
    }
  };

  /** Keeps a feed on the session on screen, for its latest Turn's status. */
  const followSession = () => {
    const key = screenKey(state);
    const wanted = key === null ? null : keyString(key);

    if (detail?.key === wanted) return;
    detail?.stop();
    detail = null;

    if (key === null || wanted === null || client === null) return;

    const feed = client
      .subscribeSession(key.hostId, key.sessionId, { turnLimit: 1 })
      [Symbol.asyncIterator]();

    let live = true;

    detail = {
      key: wanted,
      stop: () => {
        live = false;
        void feed.return?.();
      },
    };

    void (async () => {
      for (let next = await feed.next(); live && next.done !== true; next = await feed.next()) {
        const status = next.value.turns.at(-1)?.turn.status;

        if (status !== undefined) set(onLastTurn(state, key, status));
      }
    })().catch((cause: unknown) => log(`the session feed failed: ${describeCause(cause)}`));
  };

  const notify = (notice: string) => set(onNotice(state, notice));

  const perform = (polaris: PolarisClient, key: SessionKey, action: MenuAction) => {
    const { hostId, sessionId } = key;

    switch (action.kind) {
      case "allow":
        return polaris.respondToApproval(hostId, sessionId, action.requestId, { kind: "allow" });
      case "deny":
        return polaris.respondToApproval(hostId, sessionId, action.requestId, { kind: "deny" });
      case "answer":
        return polaris.respondToApproval(hostId, sessionId, action.requestId, {
          kind: "answer",
          text: action.text,
        });
      case "interrupt":
        return polaris.interrupt(hostId, sessionId);
      case "continue":
        return polaris.continue(hostId, sessionId);
      case "reply":
        return polaris.sendTurn(hostId, sessionId, action.text);
      case "speak":
        return Promise.resolve();
    }
  };

  const attempt = (
    key: SessionKey,
    work: (polaris: PolarisClient) => Promise<void>,
    done: string
  ) => {
    if (client === null) return;
    void work(client).then(
      () => notify(done),
      (cause: unknown) => {
        log(`${done} failed: ${describeCause(cause)}`);
        notify(describeError(cause, hostName(key.hostId)));
      }
    );
  };

  const startListening = (key: SessionKey) => {
    voice?.cancel();

    if (client === null) return;
    voice = listen(glasses, client, key.hostId, {
      heard: (transcript) => set(onTranscript(state, transcript)),
      failed: (cause) => {
        log(`voice failed: ${describeCause(cause)}`);
        set(onVoiceFailed(state, describeError(cause, hostName(key.hostId))));
      },
    });
  };

  const run = (act: Act) => {
    switch (act.kind) {
      case "run":
        if (act.action.kind !== "speak")
          attempt(act.key, (p) => perform(p, act.key, act.action), DONE[act.action.kind]);

        return;
      case "listen":
        return startListening(act.key);
      case "stop-listening":
        return voice?.stop();
      case "cancel-voice":
        voice?.cancel();
        voice = null;

        return;
      case "send-voice": {
        const { key, text, requestId } = act;

        return attempt(
          key,
          (p) =>
            requestId === null
              ? p.sendTurn(key.hostId, key.sessionId, text)
              : p.respondToApproval(key.hostId, key.sessionId, requestId, { kind: "answer", text }),
          requestId === null ? "Sent" : "Answered"
        );
      }

      case "exit":
        void glasses.exit();
    }
  };

  const onEvent = (event: GlassesEvent) => {
    if (event.kind === "audio") return voice?.push(event.pcm);

    if (event.kind === "exited") return void close();
    const [next, act] = onInput(state, event);

    set(next);

    if (act !== null) run(act);
  };

  const unsubscribe = glasses.onEvent(onEvent);

  const disconnect = async () => {
    generation++;
    voice?.cancel();
    voice = null;
    detail?.stop();
    detail = null;
    const old = client;

    client = null;
    await old?.close().catch(() => undefined);
  };

  const watchHosts = async (polaris: PolarisClient, mine: number) => {
    for await (const hosts of polaris.subscribeHosts()) {
      if (mine !== generation) return;

      for (const host of hosts) {
        const link = linkOf(host);

        if (links.get(host.hostId) !== link) log(`${host.hostName}: ${link}`);
        links.set(host.hostId, link);
      }

      set(onHosts(state, hosts));
      options.onHosts?.(hosts);
    }
  };

  /** Resolves once connected (or refused); the Hosts feed runs on. */
  const connect = async () => {
    await disconnect();
    const mine = generation;

    if (pairings.length === 0) return;
    links.clear();
    log(`connecting to ${pairings.length} host${pairings.length === 1 ? "" : "s"}`);

    try {
      const polaris = await options.connect(pairings);

      if (mine !== generation) return void polaris.close();
      client = polaris;
      followSession();
      void watchHosts(polaris, mine).then(
        () => mine === generation && log("the hosts feed ended"),
        (cause: unknown) => {
          log(`the hosts feed failed: ${describeCause(cause)}`);

          if (mine === generation) notify(describeError(cause, "the host"));
        }
      );
    } catch (error) {
      log(`couldn't connect: ${describeCause(error)}`);

      if (mine === generation) notify(describeError(error, "the host"));
    }
  };

  const close = async () => {
    unsubscribe();
    await disconnect();
  };

  set(state);

  return {
    pair: (next) => {
      pairings = next;
      set(initialState(next.length > 0));

      return connect();
    },
    reconnect: () => connect(),
    state: () => state,
    settled: () => renderer.settled(),
    close,
  };
};
