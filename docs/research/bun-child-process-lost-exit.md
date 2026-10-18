# Bun `node:child_process` loses a child's exit under load (draft upstream report, not filed)

Polaris works around this in the Daemon (ENG-356, ENG-357): `resources/process.ts` runs `ps`
through `Bun.spawn`, and the remaining `node:child_process` callers are bounded or watched
(`resources/lostExit.ts`). Measured on an Apple M2 Max (12 cores), macOS 27.0, with Bun
1.4.3 (the version Polaris pins in `packageManager` and CI) and Bun 1.3.13.

## What happens

Sometimes, `execFile`'s callback never runs. When it doesn't:

- the child is gone: `process.kill(pid, 0)` throws `ESRCH`, so Bun has reaped it;
- `child.exitCode` is `0`, so Bun has recorded the exit;
- the `ChildProcess` never emits `exit` or `close`;
- its stdout never emits `data` (0 bytes), although `ps` wrote a line.

The call never settles. A caller that awaits it hangs forever. `Bun.spawn` under the same
load lost no exits.

## Measurements

The witness is Polaris's FIFO broker model test
(`apps/daemon/src/resources/resources.model.test.ts`), run 120 times in a row beside 24 busy
loops (`bun -e 'for(;;){}'`). That test calls `ps -o stat= -o lstart= -p <pid>` once at a
time, between SQLite writes and Effect fibers. Each `ps` run gets 5 s; a run past its
deadline is killed and counted.

| Bun | How `ps` starts | Test runs | `ps` runs past 5 s |
|---|---|---|---|
| 1.3.13 | `execFile` | 120 | 56 |
| 1.4.3 | `execFile` | 120 | 27 |
| 1.4.3 | `execFile`, instrumented | 40 | 15 (all: pid gone, `exitCode` 0, no `exit`, no `close`, 0 stdout bytes) |
| 1.4.3 | `Bun.spawn` | 120 | 0 |

With the 5 s deadline and retry the test never failed. Without them, ENG-356 saw the test
hang 4 times in 180 runs on Bun 1.3.13.

Every standalone script I tried left **0 calls stuck**, on both versions:

| Script | Calls per version |
|---|---|
| 32–64 parallel `execFile("/bin/ps")` per round, 12–36 busy loops, 1–8 processes at once | 640–7,680 |
| the same, with the main thread blocked 3 ms of every 1 ms, or 200 ms after each round | 640 |
| the same, with 8 `Bun.spawn(["/usr/bin/true"])` children starting and exiting alongside | 1,920 |
| inside `bun test` | 640 |
| one `ps` at a time, 5 ms apart, 24 busy loops | 2,000 |
| the same inside `bun test`, with 20 WAL SQLite inserts between runs | 1,500 |
| 8 parallel runs with `Bun.gc(true)` while they're in flight, 0 or 24 busy loops | 400–800 |

ENG-356 reported 2 of 640 calls stuck with the first script on Bun 1.3.13, on another
machine. So the bug needs something the witness test has and these scripts lack, and I
haven't found what.

## Steps to reproduce (the witness)

1. Check out Polaris at a commit before ENG-357 (one where `resources/process.ts` still
   imports `execFile`), and run `bun install`.
2. In `runPs`, count the deadline misses: inside `kill`, before `child.kill("SIGKILL")`,
   append a line to a log file named by an environment variable.
3. Start 24 busy loops: `for i in $(seq 24); do bun -e 'for(;;){}' & done`.
4. From `apps/daemon`, run `bun test src/resources/resources.model.test.ts` 120 times,
   setting that variable to the log's path.
5. Count the log's lines, then `kill $(jobs -p)`.

To see the state above, also log `process.kill(child.pid, 0)`, `child.exitCode`, whether
`exit` and `close` fired, and stdout's byte count.

## Standalone script (does not reproduce here)

This script is ENG-356's minimal repro. It doesn't reproduce on this machine, but it's
where a reduction would start: `bun lost-exit.ts node 20 32 12` for `execFile`,
`bun lost-exit.ts bun 20 32 12` for `Bun.spawn`.

```ts
import { execFile } from "node:child_process";

const [mode = "node", rounds = "20", parallel = "32", busy = "12"] = process.argv.slice(2);
const STUCK_MS = 10_000;
const args = ["-o", "stat=", "-o", "lstart=", "-p", String(process.pid)];

const burners = Array.from({ length: Number(busy) }, () =>
  Bun.spawn([process.execPath, "-e", "for(;;){}"], { stdout: "ignore", stderr: "ignore" })
);

const viaNode = () =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), STUCK_MS);
    execFile("/bin/ps", args, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

const viaBun = async () => {
  const child = Bun.spawn(["/bin/ps", ...args], { stdout: "pipe", stderr: "ignore" });
  return Promise.race([
    Promise.all([new Response(child.stdout).text(), child.exited]).then(() => true),
    Bun.sleep(STUCK_MS).then(() => false),
  ]);
};

let calls = 0;
let stuck = 0;
for (let round = 0; round < Number(rounds); round++) {
  const done = await Promise.all(
    Array.from({ length: Number(parallel) }, () => (mode === "bun" ? viaBun() : viaNode()))
  );
  calls += done.length;
  stuck += done.filter((ok) => !ok).length;
}
for (const burner of burners) burner.kill(9);
console.log(JSON.stringify({ bun: Bun.version, mode, calls, stuck }));
process.exit(0);
```

## What the report should ask

`ChildProcess` has `exitCode` set, and its pid has been reaped, but `exit` and `close`
never fire and stdout gets no data. Is the exit or the pipe's EOF dropped between the
subprocess's exit and the node-compat `ChildProcess` emitting its events?

## Recheck after a Bun upgrade

Rerun the witness steps with `execFile`. If a version reports 0 misses in 120 runs, the
workarounds can go: the `ps` deadline and retry, `guardExit` on the Agent SDK's child, the
lease wrapper's watch, and the probe's deadline.
