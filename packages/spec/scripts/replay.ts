#!/usr/bin/env bun
/**
 * Trace validation: replay logs the real Engine committed against polaris.qnt.
 *
 *   POLARIS_TRACE_DIR=/tmp/traces bun test apps/daemon/src/verification/engine.model.test.ts
 *   bun packages/spec/scripts/replay.ts /tmp/traces
 *
 * The Engine's model-based test writes, per run, the committed log (abstracted),
 * the commands the Clients sent, and where the Daemon restarted. For each trace
 * this script maps the log to the spec's events, splits it into the decisions
 * that produced it (a Client command, a Harness report, a restart's recovery),
 * and writes a Quint run that replays those decisions through the spec's own
 * actions (`clientSends`, `harnessReports`, `commitBatch`, `publishBatch`,
 * `reactorRuns`, `crash`, `restart`). `quint test` then checks that the spec
 * records exactly the same events, in the same order, and that `safety` holds
 * after every decision. A mismatch means the spec and the code disagree.
 *
 * The mapping is the spec's abstraction (README.md): Starting counts as
 * Working, and events the spec leaves out (checkpoints, cursors, renames,
 * Workspaces) are dropped. Anything it cannot map is reported as an error.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { basename, join } from "node:path"

interface TEvent {
  readonly seq: number
  readonly commandId: string | null
  readonly session: string | null
  readonly tag: string
  readonly what: string
  readonly turnId?: string
  readonly status?: string
  readonly state?: string
  readonly requestId?: string
  readonly reason?: string | null
}

interface TCommand {
  readonly _tag: string
  readonly sessionId?: string
  readonly requestId?: string
}

interface Trace {
  readonly log: ReadonlyArray<TEvent>
  readonly commands: Record<string, { readonly device: string; readonly command: TCommand }>
  readonly restarts: ReadonlyArray<number>
}

interface SpecEvent {
  readonly session: string
  readonly cmd: string
  readonly kind: string
}

interface Unit {
  /** Quint actions, in order. */
  readonly actions: ReadonlyArray<string>
  readonly events: ReadonlyArray<SpecEvent>
  readonly label: string
}

const DROPPED = new Set([
  "SessionCreated",
  "CheckpointRecorded",
  "SessionCursorUpdated",
  "SessionRenamed",
  "SessionPermissionModeChanged",
  "WorkspaceRegistered",
  "WorkspaceUpdated",
  "WorkspaceRemoved",
  "WorktreeDetected",
  "WorktreeRemoved",
])

const SESSIONS = ["s1", "s2"]
const q = (s: string) => JSON.stringify(s)
/** The spec has no Starting: it counts as Working. */
const norm = (state: string) => (state === "starting" ? "working" : state)
const byOf = (e: TEvent) => e.what.split(":")[2]!

const isRecovery = (e: TEvent) =>
  e.commandId === null &&
  ((e.tag === "TurnEnded" && e.status === "interrupted") ||
    (e.tag === "ApprovalWithdrawn" && byOf(e) === "daemon") ||
    (e.tag === "SessionStateChanged" &&
      ((e.state === "needs-you" && e.reason === "interrupted") ||
        (e.state === "dormant" && e.reason === "daemon-restart"))))

export const toUnits = (trace: Trace): { units: Array<Unit>; requests: Map<string, string> } => {
  const state = new Map<string, string>()
  const turns = new Map<string, Set<string>>()
  const requests = new Map<string, string>()
  const stateOf = (s: string) => state.get(s) ?? "dormant"

  /** The spec event for an engine event, updating the tracked state; null if dropped. */
  const map = (e: TEvent, cmd: string, keepSameState: boolean): SpecEvent | null => {
    if (DROPPED.has(e.tag) || e.session === null) return null
    const s = e.session
    const out = (kind: string): SpecEvent => ({ session: s, cmd, kind })
    switch (e.tag) {
      case "TurnStarted": {
        const known = turns.get(s) ?? new Set()
        const continued = known.has(e.turnId!)
        known.add(e.turnId!)
        turns.set(s, known)
        return out(`TurnStarted(${continued})`)
      }
      case "TurnEnded":
        return out(`TurnEnded(${q(e.status!)})`)
      case "TurnItemCompleted":
        return out("ItemCompleted")
      case "SessionStateChanged": {
        const n = norm(e.state!)
        if (!keepSameState && n === stateOf(s)) return null
        state.set(s, n)
        return out(`StateChanged(${q(n)})`)
      }
      case "ApprovalRequested":
        requests.set(e.requestId!, s)
        return out(`ApprovalRequested(${q(e.requestId!)})`)
      case "ApprovalResolved":
        return out(`ApprovalResolved({ req: ${q(e.requestId!)}, by: ${q(byOf(e))} })`)
      case "ApprovalWithdrawn":
        return out(`ApprovalWithdrawn({ req: ${q(e.requestId!)}, by: ${q(byOf(e))} })`)
      default:
        throw new Error(`seq ${e.seq}: no spec event for ${e.tag}`)
    }
  }

  const commit = ["commitBatch", "publishBatch"]
  const units: Array<Unit> = []
  const log = trace.log
  // Each restart's recovery: the recovery-shaped Daemon events right before its point.
  const recoveryOf = new Map<number, number>()
  trace.restarts.forEach((point, r) => {
    for (let i = point - 1; i >= 0 && isRecovery(log[i]!) && !recoveryOf.has(log[i]!.seq); i--) {
      recoveryOf.set(log[i]!.seq, r)
    }
  })
  let nextRestart = 0
  const flushRestarts = (beforeSeq: number) => {
    while (nextRestart < trace.restarts.length && trace.restarts[nextRestart]! < beforeSeq) {
      const r = nextRestart++
      const recovery = log.filter((e) => recoveryOf.get(e.seq) === r)
      const events = recovery.flatMap((e) => map(e, "", true) ?? [])
      // The sessions in the order the engine recovered them, then the ones it left alone.
      const order = [...new Set([...recovery.map((e) => e.session!), ...SESSIONS])]
      units.push({
        actions: ["crash", `restartIn([${order.map(q).join(", ")}])`],
        events,
        label: `restart ${r + 1}`,
      })
    }
  }

  let i = 0
  while (i < log.length) {
    const e = log[i]!
    if (recoveryOf.has(e.seq)) {
      i++
      continue
    }
    flushRestarts(e.seq)
    if (e.commandId !== null) {
      // A Client command: its events are contiguous (checked by the test itself).
      const id = e.commandId
      const block: Array<TEvent> = []
      while (i < log.length && log[i]!.commandId === id) block.push(log[i++]!)
      const sent = trace.commands[id]
      const setup = /^setup-(s\d+)-/.exec(id)
      if (setup !== null) {
        // StartSession: the spec's sessions exist from the start, Dormant; starting one is a SendTurn.
        const s = setup[1]!
        const events = block.flatMap((b) => map(b, id, true) ?? [])
        state.set(s, "working")
        units.push({
          actions: [
            `clientSends("mac", ${q(id)}, SendTurn(${q(s)}))`,
            ...commit,
            `reactorRuns(${q(s)})`,
          ],
          events: [...events, { session: s, cmd: id, kind: 'StateChanged("working")' }],
          label: `${id} StartSession`,
        })
        continue
      }
      const events = block.flatMap((b) => map(b, id, true) ?? [])
      if (events.length === 0) continue // RenameSession, RegisterWorkspace: nothing the spec models
      if (sent === undefined) throw new Error(`seq ${e.seq}: unknown command ${id}`)
      const s = sent.command.sessionId!
      const command =
        sent.command._tag === "SendTurn"
          ? `SendTurn(${q(s)})`
          : sent.command._tag === "Continue"
            ? `Continue(${q(s)})`
            : sent.command._tag === "RespondToApproval"
              ? `Respond({ session: ${q(s)}, req: ${q(sent.command.requestId!)} })`
              : sent.command._tag === "ArchiveSession"
                ? `Archive(${q(s)})`
                : sent.command._tag === "UnarchiveSession"
                  ? `Unarchive(${q(s)})`
                  : null
      if (command === null)
        throw new Error(`seq ${e.seq}: no spec command for ${sent.command._tag}`)
      // A Turn's reactor opens the Harness; Archive's stops it.
      const reacts = ["SendTurn", "Continue", "ArchiveSession"].includes(sent.command._tag)
      units.push({
        actions: [
          `clientSends(${q(sent.device)}, ${q(id)}, ${command})`,
          ...commit,
          ...(reacts ? [`reactorRuns(${q(s)})`] : []),
        ],
        events,
        label: `${id} ${sent.command._tag}`,
      })
      continue
    }
    // Something the Daemon recorded on its own: a Harness report, one decision each.
    if (DROPPED.has(e.tag)) {
      i++
      continue
    }
    const s = e.session!
    const take = (pred: (x: TEvent) => boolean) => {
      // Skip dropped events of the same decision (e.g. the checkpoint before a Turn ends).
      let j = i
      while (j < log.length && log[j]!.commandId === null && DROPPED.has(log[j]!.tag)) j++
      if (j < log.length && log[j]!.commandId === null && log[j]!.session === s && pred(log[j]!)) {
        i = j + 1
        return log[j]!
      }
      return null
    }
    const harness = (report: string, events: Array<TEvent>) => {
      units.push({
        actions: [`harnessReports(${q(s)}, ${report})`, ...commit],
        events: events.flatMap((x) => map(x, "", true) ?? []),
        label: `${s} ${report}`,
      })
    }
    const endsTurnAfter = (from: number) => {
      let j = from
      while (
        j < log.length &&
        log[j]!.commandId === null &&
        log[j]!.session === s &&
        (log[j]!.tag === "ApprovalWithdrawn" || DROPPED.has(log[j]!.tag))
      )
        j++
      return (
        j < log.length &&
        log[j]!.commandId === null &&
        log[j]!.tag === "TurnEnded" &&
        log[j]!.status === "completed"
      )
    }
    if (e.tag === "ApprovalRequested") {
      i++
      const followed = take((x) => x.tag === "SessionStateChanged" && x.state === "needs-you")
      harness(`HRequest(${q(e.requestId!)})`, followed ? [e, followed] : [e])
    } else if (e.tag === "TurnItemCompleted") {
      i++
      harness("HItem", [e])
    } else if (
      (e.tag === "ApprovalWithdrawn" && byOf(e) === "harness" && endsTurnAfter(i)) ||
      (e.tag === "TurnEnded" && e.status === "completed")
    ) {
      const events: Array<TEvent> = []
      while (log[i]!.tag !== "TurnEnded") {
        if (!DROPPED.has(log[i]!.tag)) events.push(log[i]!)
        i++
      }
      events.push(log[i++]!)
      const idle = take((x) => x.tag === "SessionStateChanged" && x.state === "idle")
      if (idle === null) throw new Error(`seq ${e.seq}: a Turn ended without going Idle`)
      harness("HTurnEnded", [...events, idle])
    } else if (e.tag === "ApprovalWithdrawn" && byOf(e) === "harness") {
      i++
      const followed = take((x) => x.tag === "SessionStateChanged" && x.state === "working")
      harness(`HWithdraw(${q(e.requestId!)})`, followed ? [e, followed] : [e])
    } else if (e.tag === "SessionStateChanged" && norm(e.state!) === stateOf(s)) {
      // The reactor moving Starting → Working: no change in the spec's terms.
      i++
    } else {
      throw new Error(`seq ${e.seq}: cannot map ${e.what} (${s}) to a spec decision`)
    }
  }
  flushRestarts(Number.POSITIVE_INFINITY)
  return { units, requests }
}

export const toQuint = (name: string, trace: Trace): string => {
  const { units, requests } = toUnits(trace)
  const cmdIds = new Set<string>()
  for (const unit of units) {
    for (const action of unit.actions) {
      const m = /^clientSends\("[^"]*", "([^"]+)"/.exec(action)
      if (m) cmdIds.add(m[1]!)
    }
  }
  if (cmdIds.size === 0) cmdIds.add("unused")
  if (requests.size === 0) requests.set("unused", "s1")
  const expected: Array<string> = []
  const lines: Array<string> = ["    init"]
  for (const unit of units) {
    for (const event of unit.events) {
      expected.push(
        `{ seq: ${expected.length + 1}, session: ${q(event.session)}, cmd: ${q(event.cmd)}, kind: ${event.kind} }`,
      )
    }
    for (const action of unit.actions) lines.push(`      .then(${action})`)
    lines.push(
      `      // ${unit.label}`,
      `      .expect(log == EXPECTED.slice(0, ${expected.length}) and safety)`,
    )
  }
  return `// Generated by packages/spec/scripts/replay.ts from ${name}. Do not edit.
module ${name} {
  import polaris(
    HOST_FEED_GAPLESS = false,
    ARCHIVE_IGNORES_TURN = false,
    RECORDS_LATE_REQUESTS = false,
    CLIENTS = Set("mac", "phone"),
    SESSION_LIST = ["s1", "s2"],
    CMD_IDS = Set(${[...cmdIds].map(q).join(", ")}),
    REQUESTS = Set(${[...requests.keys()].map(q).join(", ")}),
    REQUEST_SESSION = Map(${[...requests].map(([r, s]) => `${q(r)} -> ${q(s)}`).join(", ")}),
    CAPACITY = 1,
    MAX_LOG = 100000,
    MAX_CRASHES = ${trace.restarts.length + 1},
  ).* from "../polaris"

  pure val EXPECTED: List[Event] = [
    ${expected.join(",\n    ")}
  ]

  run replayTest =
${lines.join("\n")}
}
`
}

if (import.meta.main) {
  const dir = process.argv[2]
  if (dir === undefined) {
    console.error("usage: bun scripts/replay.ts <trace dir>")
    process.exit(2)
  }
  const specDir = join(import.meta.dir, "..")
  const out = join(specDir, ".replay")
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  const quint = join(specDir, "node_modules", ".bin", "quint")
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
  let failed = 0
  let events = 0
  let decisions = 0
  const jobs: Array<{ readonly file: string; readonly name: string; readonly path: string }> = []
  for (const file of files) {
    const trace = JSON.parse(readFileSync(join(dir, file), "utf8")) as Trace
    const name = `replay_${basename(file, ".json").replace(/[^A-Za-z0-9]/g, "_")}`
    try {
      const source = toQuint(name, trace)
      const { units } = toUnits(trace)
      decisions += units.length
      events += units.reduce((n, u) => n + u.events.length, 0)
      const path = join(out, `${name}.qnt`)
      writeFileSync(path, source)
      jobs.push({ file, name, path })
    } catch (error) {
      failed++
      console.error(`✗ ${file}: ${(error as Error).message}`)
    }
  }
  // The TypeScript evaluator: the Rust one hits a recursion limit on long runs.
  const check = async ({ file, name, path }: (typeof jobs)[number]) => {
    const proc = Bun.spawn(
      [quint, "test", path, `--main=${name}`, "--match=replayTest", "--backend=typescript"],
      { cwd: specDir, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) {
      failed++
      console.error(`✗ ${file} (${path})\n${stdout}${stderr}`)
    } else {
      console.log(`✓ ${file}`)
    }
  }
  const parallel = Math.max(1, Math.min(8, navigator.hardwareConcurrency ?? 4))
  for (let i = 0; i < jobs.length; i += parallel) {
    await Promise.all(jobs.slice(i, i + parallel).map(check))
  }
  console.log(
    `${files.length - failed}/${files.length} traces conform (${decisions} decisions, ${events} spec events)`,
  )
  process.exit(failed === 0 && files.length > 0 ? 0 : 1)
}
