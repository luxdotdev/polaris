import { describe, expect, test } from "bun:test"
import { Effect, Fiber, Queue, Stream } from "effect"
import { classifyExit } from "./failures.ts"
import { makeFeed, type SequenceMark } from "./resume.ts"
import { sshArgv } from "./ssh.ts"

describe("classifyExit", () => {
  const cases: Array<[string, number | null, string, string]> = [
    [
      "host key changed",
      255,
      "@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\nHost key verification failed.",
      "host-key-changed",
    ],
    ["unknown host key", 255, "Host key verification failed.", "host-key-unknown"],
    ["auth", 255, "git@example: Permission denied (publickey).", "auth-failed"],
    ["bad perms", 255, "Bad owner or permissions on /Users/x/.ssh/config", "ssh-config-error"],
    ["no polaris", 127, "bash: line 1: polaris: command not found", "polaris-not-installed"],
    ["no daemon", 69, "polaris bridge: no Daemon is running on this Host", "daemon-not-running"],
    [
      "dns",
      255,
      "ssh: Could not resolve hostname pi: nodename nor servname provided",
      "unreachable",
    ],
    ["refused", 255, "ssh: connect to host pi port 22: Connection refused", "unreachable"],
    ["timeout", 255, "ssh: connect to host pi port 22: Operation timed out", "timeout"],
    ["dropped", 255, "Connection to pi closed by remote host.", "connection-lost"],
  ]
  for (const [name, code, stderr, reason] of cases) {
    test(name, () => {
      expect(classifyExit({ code, signal: null, stderr }).reason).toBe(reason as never)
    })
  }
  test("user-fixable failures are Needs Attention, network ones transient", () => {
    expect(classifyExit({ code: 255, signal: null, stderr: "Permission denied" }).kind).toBe(
      "needs-attention",
    )
    expect(classifyExit({ code: 255, signal: null, stderr: "No route to host" }).kind).toBe(
      "transient",
    )
  })
})

describe("sshArgv", () => {
  test("adds only Polaris's own options and never prompts", () => {
    const argv = sshArgv("studio", { controlDir: "/c" })
    const joined = argv.join(" ")
    expect(argv[0]).toBe("ssh")
    for (const option of [
      "BatchMode=yes",
      "ControlMaster=auto",
      "ControlPath=/c/%C",
      "ControlPersist=10m",
      "Compression=yes",
      "ServerAliveInterval=15",
      "ServerAliveCountMax=3",
      "ForwardAgent=no",
      "ClearAllForwardings=yes",
    ])
      expect(joined).toContain(`-o ${option}`)
    expect(argv.slice(-3)).toEqual(["studio", "polaris", "bridge"])
    expect(joined).not.toMatch(/HostName|IdentityFile|User=|Port=/)
  })

  test("agent forwarding is a per-Host toggle", () => {
    expect(sshArgv("pi", { forwardAgent: true }).join(" ")).toContain("-o ForwardAgent=yes")
  })
})

type Item =
  | { readonly _tag: "Snapshot"; readonly sequence: number }
  | { readonly _tag: "Event"; readonly sequence: number }
  | { readonly _tag: "Synchronized"; readonly sequence: number }

const mark = (item: Item): SequenceMark =>
  item._tag === "Snapshot"
    ? { kind: "snapshot", sequence: item.sequence }
    : item._tag === "Event"
      ? { kind: "event", sequence: item.sequence }
      : { kind: "synchronized", sequence: item.sequence }

class Disconnected {
  readonly _tag = "Disconnected"
}

describe("resumable feed", () => {
  test("resubscribes from the last sequence and drops replayed duplicates", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const opens: Array<number | null> = []
          // Each "connection" replays one event it already sent, then fails as if dropped.
          const scripts: Array<Array<Item>> = [
            [
              { _tag: "Snapshot", sequence: 0 },
              { _tag: "Event", sequence: 1 },
              { _tag: "Event", sequence: 2 },
            ],
            [
              { _tag: "Event", sequence: 2 },
              { _tag: "Event", sequence: 3 },
            ],
            [
              { _tag: "Event", sequence: 3 },
              { _tag: "Event", sequence: 4 },
              { _tag: "Synchronized", sequence: 4 },
            ],
          ]
          let epoch = 0
          const feed = yield* makeFeed<number, Item, Disconnected>({
            source: { next: (min) => Effect.succeed({ epoch: Math.max(min, epoch), client: 0 }) },
            open: (_client, after) => {
              opens.push(after)
              const script = scripts[epoch++]
              if (script === undefined) return Stream.never
              return Stream.concat(Stream.fromIterable(script), Stream.fail(new Disconnected()))
            },
            mark,
            isDisconnect: (e) => e instanceof Disconnected,
            gapless: true,
          })
          const items = yield* feed.stream.pipe(Stream.take(6), Stream.runCollect)
          return { items, opens }
        }),
      ),
    )
    expect(result.items.map((i) => `${i._tag}:${i.sequence}`)).toEqual([
      "Snapshot:0",
      "Event:1",
      "Event:2",
      "Event:3",
      "Event:4",
      "Synchronized:4",
    ])
    expect(result.opens.slice(0, 3)).toEqual([null, 2, 3])
  })

  test("reopens on a gap in a gapless stream, and fails on other errors", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const opens: Array<number | null> = []
          const feed = yield* makeFeed<number, Item, string>({
            source: { next: () => Effect.succeed({ epoch: 1, client: 0 }) },
            open: (_client, after) => {
              opens.push(after)
              return opens.length === 1
                ? Stream.fromIterable<Item>([
                    { _tag: "Snapshot", sequence: 5 },
                    { _tag: "Event", sequence: 7 },
                  ])
                : Stream.fail("NotFound")
            },
            mark,
            isDisconnect: () => false,
            gapless: true,
          })
          const error = yield* feed.stream.pipe(Stream.runDrain, Effect.flip)
          return { error, opens }
        }),
      ),
    )
    expect(result.opens).toEqual([null, 5])
    expect(result.error).toBe("NotFound")
  })

  test("a new subscriber gets the cached snapshot and events first", async () => {
    const items = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const live = yield* Queue.unbounded<Item>()
          const feed = yield* makeFeed<number, Item, never>({
            source: { next: () => Effect.succeed({ epoch: 1, client: 0 }) },
            open: () => Stream.fromQueue(live),
            mark,
            isDisconnect: () => false,
            gapless: true,
          })
          yield* Queue.offerAll(live, [
            { _tag: "Snapshot", sequence: 1 },
            { _tag: "Event", sequence: 2 },
          ])
          yield* feed.stream.pipe(Stream.take(2), Stream.runDrain)
          const second = yield* Effect.forkChild(
            feed.stream.pipe(Stream.take(3), Stream.runCollect),
          )
          yield* Effect.sleep(20)
          yield* Queue.offer(live, { _tag: "Event", sequence: 3 })
          return yield* Fiber.join(second)
        }),
      ),
    )
    expect(items.map((i) => `${i._tag}:${i.sequence}`)).toEqual([
      "Snapshot:1",
      "Event:2",
      "Event:3",
    ])
  })
})
