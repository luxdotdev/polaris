/**
 * Usage and Plan Limits across every Host that reports them (capability
 * `usage`): `usage.query` for the chosen range, priced in main, and
 * `usage.watch` for Plan Limits (every known one first). A Usage change asks
 * that range again after a quiet moment, so estimates stay attached.
 */
import { Match } from "effect";
import { useEffect, useState } from "react";
import type { RequestOutput } from "../../../../shared/api.ts";
import { useApp } from "../../../shell/hooks.ts";
import type { Limit } from "../model/planLimits.ts";
import { type Bucket, type RangeDays, rangeWindow } from "../model/usage.ts";

type PerHost<A> = Readonly<Record<string, A>>;

/** Usage changes while an Agent Session works; re-querying on each would be wasteful. */
const REQUERY_MS = 5_000;

const sameWindow = (a: Limit, b: Limit) =>
  a.harness === b.harness && a.kind === b.kind && a.scope === b.scope;

const joinKeys = (keys: ReadonlyArray<string>) => keys.join("\u0000");

const splitKeys = (joined: string) => (joined === "" ? [] : joined.split("\u0000"));

const priced = (view: RequestOutput<"usage.query">): ReadonlyArray<Bucket> =>
  view.report.buckets.map((bucket, i) => {
    const estimate = view.estimates[i];

    if (estimate === undefined) return bucket;
    const { hour, harness, model, sessionId, tokens, reportedCost, longContext } = bucket;

    return { hour, harness, model, sessionId, tokens, reportedCost, longContext, estimate };
  });

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
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    let live = true;
    const hosts = splitKeys(hostKeys);
    const range = rangeWindow(days, Date.now());

    void Promise.all(
      hosts.map((hostKey) =>
        window.polaris
          .request("usage.query", { hostKey, ...range, harness: null, sessionId: null })
          .then((result) => [hostKey, result.ok ? priced(result.value) : []] as const)
      )
    ).then((entries) => {
      if (!live) return;
      setBuckets(Object.fromEntries(entries));
      setQueried(`${days}|${hostKeys}`);
    });

    return () => {
      live = false;
    };
  }, [days, hostKeys, changes]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const changed = () => {
      timer ??= setTimeout(() => {
        timer = null;
        setChanges((n) => n + 1);
      }, REQUERY_MS);
    };

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
                  UsageChanged: changed,
                })
              );
            }
          },
        }
      )
    );

    return () => {
      if (timer !== null) clearTimeout(timer);

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
