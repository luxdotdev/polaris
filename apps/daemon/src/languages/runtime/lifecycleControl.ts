import { LanguageContextEvent, LanguageRuntime, LanguageError } from "@polaris/protocol";
import type { LanguageContextIdentity } from "@polaris/protocol";
import { blockedLaunchReasons } from "./launchAdmission.ts";
import { checkoutKey } from "../trust/index.ts";
import { contextKey } from "./keys.ts";
import type { LifecycleEvent } from "./lifecycle.ts";
import type { OrderedConnection } from "../transport/index.ts";
import type { BrokerOptions, Entry } from "./types.ts";

export function bindLifecycle(ports: {
  options: BrokerOptions;
  entries: Map<string, Entry>;
  keys: Map<string, Entry>;
  active: (entry: Entry, identity: LanguageContextIdentity) => boolean;
  move: (entry: Entry, event: LifecycleEvent) => void;
  state: (entry: Entry, runtime: typeof LanguageRuntime.Type) => void;
  retire: (entry: Entry, reason: "restart", graceful: boolean, preserveDocuments: boolean) => void;
  shutdown: (entry: Entry) => Promise<void>;
  ensureStart: (entry: Entry) => void;
  track: (operation: Promise<void>, teardown: boolean, clientId: string) => void;
  stopWatching: (entry: Entry) => void;
}) {
  const { options, entries, keys, active, move, state, retire, shutdown, ensureStart, track } =
    ports;

  const demanded = (entry: Entry) => entry.documents.open.size > 0;

  const peers = (entry: Entry) =>
    [...entries.values()].filter(
      (other) =>
        checkoutKey(other.facts.checkout) === checkoutKey(entry.facts.checkout) &&
        other.facts.providerId === entry.facts.providerId
    );

  function publishReplacement(entry: Entry, source: LanguageContextIdentity) {
    delete entry.replacementSource;
    entry.events.emit(
      LanguageContextEvent.cases.Replaced.make({
        context: source,
        replacement: entry.identity,
        runtime: entry.runtime,
        ack: entry.documents.ack(),
      })
    );
  }

  const lastServerLine = (entry: Entry) =>
    (
      entry.stderr.trim().split(/\r?\n/).filter(Boolean).at(-1) ??
      entry.logs?.lastLine() ??
      null
    )?.slice(-4096) ?? null;

  function onCrash(entry: Entry, identity: LanguageContextIdentity) {
    if (!active(entry, identity) || !entry.lifecycle.can({ type: "crash", retry: false })) return;
    const lastLogLine = lastServerLine(entry);
    const now = Date.now();
    const recent = entry.crashes.filter((time) => now - time < (options.crashWindowMs ?? 120_000));

    if (recent.length < entry.crashes.length)
      move(entry, { type: "window", attempts: recent.length });
    entry.crashes = recent;
    entry.crashes.push(now);
    entry.attempts = entry.crashes.length;
    const exhausted = entry.attempts >= 3;
    const retry = demanded(entry) && !exhausted;
    move(entry, { type: "crash", retry });
    retire(entry, "restart", false, true);

    if (!retry && !exhausted) move(entry, { type: "stop" });
    const delay = (options.retryMs ?? 250) * 2 ** (entry.attempts - 1);
    entry.runtime = retry
      ? LanguageRuntime.cases.Failed.make({
          message: "Language server failed",
          attempts: entry.attempts,
          retryAt: now + delay,
          failure: { reason: "server-failed", lastLogLine },
        })
      : LanguageRuntime.cases.Stopped.make({
          reason: exhausted ? "crash-budget" : "no-demand",
          failure: { attempts: entry.attempts, stderr: entry.stderr },
        });
    publishReplacement(entry, identity);
    state(entry, entry.runtime);

    if (retry)
      entry.timer = setTimeout(() => {
        entry.timer = undefined;
        move(entry, { type: "retry" });

        if (demanded(entry)) ensureStart(entry);
        else scheduleGrace(entry);
      }, delay);
    else ports.stopWatching(entry);
  }

  function onStartFailure(
    entry: Entry,
    identity: LanguageContextIdentity,
    error: LanguageError | undefined,
    spawned: boolean
  ) {
    if (!active(entry, identity)) return;

    if (!demanded(entry) && error?.reason === "stale-generation") {
      move(entry, { type: "stop" });
      retire(entry, "restart", false, true);
      entry.runtime = LanguageRuntime.cases.Stopped.make({ reason: "no-demand" });
      publishReplacement(entry, identity);
      state(entry, entry.runtime);

      if (entry.interests.size === 0) ports.stopWatching(entry);
      scheduleGrace(entry);
    } else if (error !== undefined && blockedLaunchReasons.has(error.reason)) {
      const lastLogLine = lastServerLine(entry);

      if (spawned) retire(entry, "restart", false, false);
      ports.stopWatching(entry);
      move(entry, { type: "stop" });
      state(
        entry,
        LanguageRuntime.cases.Failed.make({
          message: error.message,
          attempts: entry.attempts,
          retryAt: null,
          failure: { reason: error.reason, lastLogLine },
        })
      );
    } else onCrash(entry, identity);
  }

  function cancelGrace(entry: Entry) {
    for (const other of peers(entry)) {
      if (!other.lifecycle.matches("grace")) continue;
      clearTimeout(other.timer);
      other.timer = undefined;
      move(other, { type: "demand" });
    }
  }

  function scheduleGrace(entry: Entry) {
    const group = peers(entry);

    if (group.some(demanded)) {
      cancelGrace(entry);

      return;
    }

    for (const other of group) armGrace(other);
  }

  function armGrace(entry: Entry) {
    if (
      (entry.lifecycle.matches("stopped") || entry.lifecycle.matches("untrusted")) &&
      entry.interests.size === 0 &&
      entry.connection === undefined &&
      entry.starting === undefined
    ) {
      move(entry, { type: "stop" });
      retire(entry, "restart", false, false);
      ports.stopWatching(entry);
      entries.delete(entry.identity.contextId);
      keys.delete(contextKey(entry.input.clientId, entry.facts));
      entry.events.close();

      return;
    }

    if (entry.timer !== undefined || !entry.lifecycle.can({ type: "empty" })) return;
    move(entry, { type: "empty" });
    entry.timer = setTimeout(() => {
      entry.timer = undefined;

      if (peers(entry).some(demanded)) {
        cancelGrace(entry);

        return;
      }

      move(entry, { type: "grace" });

      if (entry.interests.size === 0) {
        entries.delete(entry.identity.contextId);
        keys.delete(contextKey(entry.input.clientId, entry.facts));
      }

      track(
        shutdown(entry).finally(() => {
          if (entry.interests.size === 0) entry.events.close();
        }),
        true,
        entry.identity.clientId
      );
    }, options.graceMs ?? 600_000);
  }

  return { onCrash, onStartFailure, cancelGrace, scheduleGrace, publishReplacement };
}

export async function shutdownConnection(connection?: OrderedConnection) {
  if (connection === undefined) return;

  try {
    await connection.request("shutdown", {}, 500).result;
    await connection.send({ jsonrpc: "2.0", method: "exit" });
  } catch {
    // Cleanup proceeds after the bounded graceful handshake.
  }
}
