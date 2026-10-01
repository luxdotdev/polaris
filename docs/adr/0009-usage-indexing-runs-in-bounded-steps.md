# Usage indexing runs in bounded steps on the Daemon's thread

The Usage index reads the Harness logs on the Daemon's own thread, in the background. Between steps it yields to the event loop: a step is at most a 256 KiB chunk of one log, or about 4 ms of index writes in one transaction. `usage.query` answers from what is indexed after at most ~250 ms, marked `indexing` while a pass is still running. A pass that takes longer is announced to `usage.watch` and ends with a marker that tells the Client to query again. `usage.watch` alone doesn't index: the first `usage.query` in a Daemon's life does.

## Why

- The first pass over a Host's logs can take a while: 1.6 GB of Claude plus 2.1 GB of Codex logs on the lead's Mac. It used to run as one long job that `usage.query` waited on, and the Desktop's Plan Limit menu (a `usage.watch`) started it. B6 saw the Host's sessions stall while it ran. The `usage-contention` bench over 2.7 GB of synthetic logs measured the original:
  - `usage.query` took 26 s;
  - RPCs took up to 687 ms;
  - session deltas were up to 50 ms late.
- **A Bun Worker was built and measured.** It isolates best (the worst RPC at 12 ms), but a worker loads its own copy of Effect (+39 MiB of footprint), plus 6 MiB for the worker itself. It raised the peak footprint of a build from +29 to +59 MiB, and cost startup CPU on every pass after it idled out. On a Pi 4 that is the wrong trade.
- **Bounded steps on the same thread** gave the same 2.7 GB pass:
  - `usage.query` answers in 280 ms;
  - the worst RPC is 18 ms (p99 11 ms);
  - the worst delta is 13.5 ms;
  - the build footprint peak is +24 MiB.
  - The pass also got twice as fast (13 s instead of 26 s): smaller reads and writes suit the cache.
- **Bucket updates during a long pass were dropped.** Sending the changed buckets mid-pass meant building and encoding thousands of them on the Daemon's thread. That put 70–150 ms stalls back, on the same connection as the session streams. So a long pass ends with a re-query marker instead.

## Consequences

- A pass is slower to finish than one that never yields. A single line longer than a chunk (tens of MB) is still parsed in one go.
- `UsageReport.indexing` and `UsageChanged.indexing` are additive, and default to false for an older Daemon. After a `UsageChanged` with `indexing` false and no buckets, a Client showing Usage queries again.
- A Host whose Usage is never looked at never indexes its logs, even with a Plan Limit feed open.

## Testing

`apps/daemon/src/usage/nonBlocking.test.ts` streams a delta every 10 ms through a first pass over ~220 MB and bounds the longest the session waited between deltas because the Daemon was busy. That wait is measured as the lesser of the wall-clock gap and this process's CPU time in the gap:

- A stall on the Daemon's thread is long in both: 260–490 ms with the pass's yields and write slices removed, loaded or not.
- A loaded machine pausing the process is long in wall time only. On GitHub's 2-core runner the wall-clock gap reached 127 ms (run 36808352850), and locally, with 48 busy loops on 12 cores, 250–340 ms; the CPU time in those gaps stayed at 45–70 ms.
- The process's other threads (GC, I/O) add CPU time without holding anything up, so the CPU time alone runs higher than the wall-clock gap on a quiet machine (55–60 ms against 33–41).

The bound is 150 ms: a shared 2-core CI runner reached 105 ms on the real code, while a stall without the yields measured 255–314 ms. The test used to bound how late each delta arrived, which also missed a stall that began while no delta was in flight (one run in three, with the yields removed); a gap between arrivals catches those.

