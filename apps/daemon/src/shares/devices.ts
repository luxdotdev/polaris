/**
 * The devices of each live Share's person (ADR 0112): while a Share is live, one long-poll to
 * its pinned issuer keeps the list of devices that accepted the Invite, each with a statement
 * the Host verified. A Share that is not live has no poll, so a Host with none asks nobody.
 */
import { DevicesAnswer, fetchDevices, type IssuerDevice } from "./issuer.ts";
import type { Fetch, StatementVerifier, VerifiedStatement } from "./statement.ts";
import type { StoredShare } from "./store.ts";
import type { TeammateDevice } from "./connection.ts";
import type { ShareId } from "@polaris/protocol";
import type { RelayAddress } from "@polaris/protocol/relay";
import { Predicate } from "effect";

export interface PollTiming {
  /** Seconds the issuer may hold a poll (the contract's default and maximum is 60). */
  readonly waitS: number;
  /** The pause after each answer, so an issuer that never holds a poll is not hammered. */
  readonly pauseMs: number;
  /** The first pause after a failure; it doubles up to `retryMaxMs`. */
  readonly retryMs: number;
  readonly retryMaxMs: number;
}

export const POLL_TIMING: PollTiming = {
  waitS: 60,
  pauseMs: 1_000,
  retryMs: 5_000,
  retryMaxMs: 5 * 60_000,
};

interface Entry {
  readonly device: TeammateDevice;
  /** When the newest statement the Host holds for it lapses. */
  expiresAt: number;
}

export interface DeviceTableOptions {
  readonly fetch: Fetch;
  readonly verifier: StatementVerifier;
  readonly now: () => number;
  readonly timing: PollTiming;
  /** The Share's host capability, or null when the Host no longer holds it. */
  readonly capabilityOf: (id: ShareId) => Promise<string | null>;
  /** The issuer's verified word on the Share's person: the Invite was accepted. */
  readonly onStatement: (id: ShareId, statement: VerifiedStatement) => void;
  /** A poll changed the devices: peers to list, sessions to end, a lapse to wait for. */
  readonly onChange: () => void;
  readonly log: (message: string) => void;
}

export interface DeviceTable {
  /** Starts a poll for each Share that became live and ends those of the rest. */
  readonly sync: (live: ReadonlyArray<StoredShare>) => void;
  /** The relay addresses of every device with a statement that has not lapsed. */
  readonly peers: () => ReadonlyArray<RelayAddress>;
  /** The device with this Noise key at this address, while a statement vouches for it. */
  readonly find: (source: RelayAddress, noiseKey: string) => TeammateDevice | null;
  /** The live Shares that list the device. */
  readonly sharesOf: (device: TeammateDevice) => ReadonlyArray<ShareId>;
  /** A newer statement for the device, presented on its own connection. */
  readonly extend: (device: TeammateDevice, expiresAt: number) => void;
  readonly expiryOf: (device: TeammateDevice) => number | null;
  /** When the next statement lapses, or null with no device. */
  readonly nextLapse: () => number | null;
  /** Forgets every device whose statement lapsed. */
  readonly prune: () => void;
  readonly stop: () => void;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }

    const wake = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", wake);
      resolve();
    };

    const timer = setTimeout(wake, ms);
    signal.addEventListener("abort", wake);
  });

export const deviceTable = (options: DeviceTableOptions): DeviceTable => {
  const { now, timing } = options;
  const polls = new Map<ShareId, AbortController>();
  const devices = new Map<ShareId, Map<string, Entry>>();

  const entries = () => [...devices.values()].flatMap((byKey) => [...byKey.values()]);

  const same = (a: TeammateDevice, b: TeammateDevice) =>
    a.noiseKey === b.noiseKey && a.issuer === b.issuer && a.personId === b.personId;

  /** The device as the Share's issuer vouches for it, or null when its statement doesn't. */
  const vouched = async ({ share }: StoredShare, listed: IssuerDevice): Promise<Entry | null> => {
    const refuse = (why: string) => {
      options.log(`refused a device of Share ${share.id}: ${why}`);

      return null;
    };

    if (listed.personId !== share.person.id) return refuse("it belongs to another person");
    const statement = await options.verifier.check(share.issuer, listed.statement);

    if (Predicate.isString(statement)) return refuse(`its statement is ${statement}`);

    if (statement.personId !== share.person.id) return refuse("its statement names another person");

    if (statement.noiseKey !== listed.noiseKey) return refuse("its statement names another device");
    options.onStatement(share.id, statement);

    return {
      device: {
        issuer: share.issuer,
        personId: share.person.id,
        noiseKey: listed.noiseKey,
        relayAddress: listed.relayAddress,
      },
      expiresAt: statement.expiresAt,
    };
  };

  const apply = async (stored: StoredShare, listed: ReadonlyArray<IssuerDevice>) => {
    const next = new Map<string, Entry>();

    for (const device of listed) {
      const entry = await vouched(stored, device);

      if (entry === null) continue;
      // A statement the device presented itself may outlast the issuer's copy.
      const held = devices.get(stored.share.id)?.get(entry.device.noiseKey)?.expiresAt ?? 0;
      entry.expiresAt = Math.max(entry.expiresAt, held);
      next.set(entry.device.noiseKey, entry);
    }

    // A Share that ended while its statements were checked keeps no devices.
    if (!polls.has(stored.share.id)) return;
    devices.set(stored.share.id, next);
    options.onChange();
  };

  const poll = async (stored: StoredShare, signal: AbortSignal) => {
    const { share, inviteId } = stored;
    let etag: string | null = null;
    let retry = timing.retryMs;

    while (!signal.aborted) {
      const capability = await options.capabilityOf(share.id);

      if (capability === null) {
        options.log(`Share ${share.id} has no host capability: its devices can't be read`);

        return;
      }

      const answer = await fetchDevices(options.fetch, {
        issuer: share.issuer,
        inviteId,
        capability,
        etag,
        waitS: timing.waitS,
        signal,
      });

      if (signal.aborted) return;

      const pause = await DevicesAnswer.match(answer, {
        Devices: async ({ devices: listed, etag: tag }) => {
          await apply(stored, listed);
          etag = tag;
          retry = timing.retryMs;

          // Without an ETag the issuer can't hold the next poll: wait as long ourselves.
          return tag === null ? timing.waitS * 1000 : timing.pauseMs;
        },
        Unchanged: async () => {
          retry = timing.retryMs;

          return timing.pauseMs;
        },
        Gone: async () => {
          await apply(stored, []);
          etag = null;

          return timing.retryMaxMs;
        },
        // What the Host holds stands until each statement lapses.
        Unreachable: async () => {
          const wait = retry;
          retry = Math.min(timing.retryMaxMs, retry * 2);

          return wait;
        },
      });

      await sleep(pause, signal);
    }
  };

  const start = (stored: StoredShare) => {
    const controller = new AbortController();
    polls.set(stored.share.id, controller);
    void poll(stored, controller.signal).catch(() =>
      options.log(`the poll of Share ${stored.share.id} stopped`)
    );
  };

  const end = (id: ShareId) => {
    polls.get(id)?.abort();
    polls.delete(id);
    devices.delete(id);
  };

  const valid = (entry: Entry) => entry.expiresAt > now();

  return {
    sync: (live) => {
      const ids = new Set(live.map((stored) => stored.share.id));
      const ended = [...polls.keys()].filter((id) => !ids.has(id));

      ended.forEach(end);
      live.filter((stored) => !polls.has(stored.share.id)).forEach(start);
    },
    peers: () => [
      ...new Set(
        entries()
          .filter(valid)
          .map((entry) => entry.device.relayAddress)
      ),
    ],
    find: (source, noiseKey) =>
      entries().find(
        (entry) =>
          valid(entry) && entry.device.noiseKey === noiseKey && entry.device.relayAddress === source
      )?.device ?? null,
    sharesOf: (device) =>
      [...devices].flatMap(([id, byKey]) => {
        const entry = byKey.get(device.noiseKey);

        return entry !== undefined && valid(entry) && same(entry.device, device) ? [id] : [];
      }),
    extend: (device, expiresAt) => {
      for (const entry of entries())
        if (same(entry.device, device)) entry.expiresAt = Math.max(entry.expiresAt, expiresAt);
    },
    expiryOf: (device) => {
      const held = entries()
        .filter((entry) => valid(entry) && same(entry.device, device))
        .map((entry) => entry.expiresAt);

      return held.length === 0 ? null : Math.max(...held);
    },
    nextLapse: () => {
      const held = entries().map((entry) => entry.expiresAt);

      return held.length === 0 ? null : Math.min(...held);
    },
    prune: () => {
      for (const byKey of devices.values())
        for (const [key, entry] of byKey) if (!valid(entry)) byKey.delete(key);
    },
    stop: () => [...polls.keys()].forEach(end),
  };
};
