/**
 * Usage and Plan Limits across every Host that reports them (capability
 * `usage`): `usage.query` for the chosen range, and `usage.watch` for Plan
 * Limits (every known one first) and live bucket changes.
 */
import { Match } from "effect";
import { useEffect, useState } from "react";
import { useApp } from "../../../shell/hooks.ts";
import type { Limit } from "../model/planLimits.ts";
import { type Bucket, mergeBuckets, type RangeDays, rangeWindow } from "../model/usage.ts";

type PerHost<A> = Readonly<Record<string, A>>;

const sameWindow = (a: Limit, b: Limit) =>
  a.harness === b.harness && a.kind === b.kind && a.scope === b.scope;

const joinKeys = (keys: ReadonlyArray<string>) => keys.join("\u0000");

const splitKeys = (joined: string) => (joined === "" ? [] : joined.split("\u0000"));

export interface UsageData {
  readonly buckets: ReadonlyArray<Bucket>;
  readonly limits: ReadonlyArray<Limit>;
  /** Hosts that report Usage. */
  readonly hostCount: number;
  /** Still waiting on at least one Host's query. */
  readonly loading: boolean;
}

const useUsageHosts = () =>
  joinKeys(
    useApp((s) => s.hosts)
      .filter((h) => h.status.state === "connected" && h.status.capabilities.includes("usage"))
      .map((h) => h.key)
  );

export const useUsage = (days: RangeDays): UsageData => {
  const hostKeys = useUsageHosts();
  const [buckets, setBuckets] = useState<PerHost<ReadonlyArray<Bucket>>>({});
  const [limits, setLimits] = useState<PerHost<ReadonlyArray<Limit>>>({});
  const [queried, setQueried] = useState<string>("");

  useEffect(() => {
    let live = true;
    const hosts = splitKeys(hostKeys);
    const window_ = rangeWindow(days, Date.now());

    void Promise.all(
      hosts.map((hostKey) =>
        window.polaris
          .request("usage.query", { hostKey, ...window_, harness: null, sessionId: null })
          .then((result) => [hostKey, result.ok ? result.value.buckets : []] as const)
      )
    ).then((entries) => {
      if (!live) return;
      setBuckets(Object.fromEntries(entries));
      setQueried(`${days}|${hostKeys}`);
    });

    return () => {
      live = false;
    };
  }, [days, hostKeys]);

  useEffect(() => {
    const offs = splitKeys(hostKeys).map((hostKey) =>
      window.polaris.subscribe(
        "usage",
        { hostKey },
        {
          items: (items) => {
            for (const item of items) {
              Match.value(item).pipe(
                Match.tagsExhaustive({
                  PlanLimitChanged: ({ limit }) =>
                    setLimits((l) => ({
                      ...l,
                      [hostKey]: [
                        ...(l[hostKey] ?? []).filter((x) => !sameWindow(x, limit)),
                        limit,
                      ],
                    })),
                  UsageChanged: ({ buckets: changed }) =>
                    setBuckets((b) => ({
                      ...b,
                      [hostKey]: mergeBuckets(b[hostKey] ?? [], changed),
                    })),
                })
              );
            }
          },
        }
      )
    );

    return () => {
      for (const off of offs) off();
    };
  }, [hostKeys]);

  const hosts = splitKeys(hostKeys);

  return {
    buckets: hosts.flatMap((h) => buckets[h] ?? []),
    limits: hosts.flatMap((h) => limits[h] ?? []),
    hostCount: hosts.length,
    loading: hosts.length > 0 && queried !== `${days}|${hostKeys}`,
  };
};
