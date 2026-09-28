/**
 * End-to-end smoke test of the whole Daemon, driven like a Client would:
 *
 *   bun --cwd apps/daemon scripts/smoke.ts [codex|claude]
 *
 * Starts `polaris serve` with a throwaway POLARIS_HOME, connects through
 * `polaris bridge` (standing in for `ssh <host> polaris bridge`), registers a
 * temp git repo as a Workspace, runs one tiny real Turn with the chosen
 * Harness, then fetches the Turn's diff from its checkpoints.
 *
 * It uses the Harness's own sign-in, so one tiny Turn is billed to it.
 */
import { spawn } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { makeHostConnection, spawnTransport } from "@polaris/client"
import {
  CommandId,
  type HarnessKind,
  SessionId,
  type SessionStreamItem,
  type WorkspaceId,
} from "@polaris/protocol"
import { Effect, Stream } from "effect"
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts"

const harness = (process.argv[2] ?? "codex") as HarnessKind
const MAIN = join(import.meta.dir, "..", "src", "main.ts")
const home = mkdtempSync("/tmp/pls-")
const repo = mkdtempSync("/tmp/plr-")
const env = { ...process.env, POLARIS_HOME: home }

const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: repo })
sh("git init -q && git config user.email s@x && git config user.name smoke")
writeFileSync(join(repo, "README.md"), "hello\n")
sh("git add -A && git commit -qm init")

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
})
const log = (...a: unknown[]) => console.log("[smoke]", ...a)
let n = 0
const cmd = () => CommandId.make(`smoke-${++n}`)

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second")
  const conn = yield* makeHostConnection({
    key: "smoke",
    name: "Smoke",
    target: { _tag: "Ssh", alias: "unused" },
    identity: {
      name: "polaris-smoke",
      version: "0.0.0",
      deviceLabel: "Smoke test",
      capabilities: [],
    },
    connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
  })
  const s = yield* conn.awaitSession
  log("connected", s.host.hostname, s.host.platform, "capabilities:", s.capabilities.join(", "))

  yield* s.client.dispatch({
    commandId: cmd(),
    command: { _tag: "RegisterWorkspace", path: repo, name: "smoke" },
  })
  const snapshot = yield* s.client.subscribeHost({ afterSequence: null }).pipe(
    Stream.filter((i) => i._tag === "Snapshot"),
    Stream.runHead,
  )
  if (snapshot._tag !== "Some" || snapshot.value._tag !== "Snapshot")
    return yield* Effect.die("no snapshot")
  const workspace = snapshot.value.workspaces[0]
  if (!workspace) return yield* Effect.die("workspace not registered")
  log("workspace", workspace.id, workspace.path)

  const sessionId = SessionId.make(`smoke-${harness}`)
  yield* s.client.dispatch({
    commandId: cmd(),
    command: {
      _tag: "StartSession",
      sessionId,
      workspaceId: workspace.id as WorkspaceId,
      harness,
      placement: { _tag: "InPlace" },
      permissionMode: "full-access",
      model: harness === "claude" ? "haiku" : null,
      prompt:
        "Create a file named ok.txt containing the single word ok, then reply with the word done.",
      attachments: [],
    },
  })
  log("started", harness, "session")

  let turnId: string | null = null
  yield* s.client.subscribeSession({ sessionId, afterSequence: null, turnLimit: null }).pipe(
    Stream.tap((item: SessionStreamItem) =>
      Effect.sync(() => {
        if (item._tag === "Snapshot") {
          log("snapshot: session", item.session.state, `${item.turns.length} turn(s)`)
          turnId = item.turns.at(-1)?.turn.id ?? turnId
        }
        if (item._tag !== "Event") return
        const e = item.envelope.event
        if (e._tag === "SessionStateChanged") log("state →", e.state, e.reason ?? "")
        if (e._tag === "TurnStarted") turnId = e.turn.id
        if (e._tag === "TurnItemCompleted")
          log("item", e.item._tag, JSON.stringify(e.item).slice(0, 140))
        if (e._tag === "CheckpointRecorded") log("checkpoint", e.ref)
        if (e._tag === "ApprovalRequested") log("approval!", e.request.title)
      }),
    ),
    Stream.takeUntil(
      (item) =>
        item._tag === "Event" &&
        item.envelope.event._tag === "SessionStateChanged" &&
        ["idle", "failed", "needs-you"].includes(item.envelope.event.state),
    ),
    Stream.runDrain,
    Effect.timeout("3 minutes"),
  )

  if (turnId) {
    const diff = yield* s.client["git.diff"]({
      cwd: repo,
      spec: { _tag: "Turn", sessionId, turnId: turnId as never },
    })
    const bytes = yield* s.blobs.take(diff.blobId)
    log(`turn diff: ${diff.files} file(s), ${diff.size} bytes`)
    console.log(new TextDecoder().decode(bytes))
  }
  const status = yield* s.client["git.status"]({ cwd: repo })
  log("git status entries:", status.entries.map((e) => e.path).join(", ") || "(clean)")
})

await Effect.runPromise(Effect.scoped(program)).then(
  () => log("OK"),
  (e) => {
    log("FAILED", e)
    process.exitCode = 1
  },
)
daemon.kill("SIGTERM")
await new Promise((r) => daemon.once("exit", r))
// The shared Codex app-server outlives its Daemon by design; stop this throwaway one.
await Effect.runPromise(stopAppServer({ stateFile: defaultStateFile(join(home, "codex.sock")) }))
rmSync(home, { recursive: true, force: true })
rmSync(repo, { recursive: true, force: true })
