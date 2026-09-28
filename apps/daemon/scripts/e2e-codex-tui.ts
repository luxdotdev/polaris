/**
 * Hands-on check of Codex live co-attach with the real Daemon and the real
 * `codex` TUI in a PTY. It runs two tiny real Turns on your Codex account:
 *
 *   POLARIS_E2E_CODEX_TUI=1 bun --cwd apps/daemon scripts/e2e-codex-tui.ts
 *
 * 1. `polaris serve` (throwaway POLARIS_HOME), connected through `polaris
 *    bridge`; a temp git repo registered as a Workspace.
 * 2. A supervised Codex session takes one Turn from Polaris ("reply ready").
 * 3. OpenInTerminal; the TUI starts in a PTY with the session's terminal
 *    command (`codex resume <thread> --remote unix://…/codex.sock`).
 * 4. A Turn typed into the TUI runs a command that needs approval. Polaris
 *    must see the Turn and the approval; Polaris answers it; the TUI must
 *    drop its prompt and the Turn must finish, with the approval resolved once.
 *
 * Evidence (event log, raw TUI bytes, de-ANSI'd screen text) goes to
 * `POLARIS_E2E_OUT` (default: a temp dir, printed at the end).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeHostConnection, spawnTransport } from "@polaris/client";
import {
  CommandId,
  RequestId,
  SessionId,
  type SessionStreamItem,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { defaultStateFile, stopAppServer } from "../src/harness/codex/AppServer.ts";

if (process.env.POLARIS_E2E_CODEX_TUI !== "1") {
  console.error("Runs real Codex Turns on your account; set POLARIS_E2E_CODEX_TUI=1 to run it.");
  process.exit(2);
}

const MAIN = join(import.meta.dir, "..", "src", "main.ts");

const home = mkdtempSync("/tmp/pct-");

const repo = mkdtempSync("/tmp/pcr-");

const out = process.env.POLARIS_E2E_OUT ?? mkdtempSync(join(tmpdir(), "polaris-e2e-codex-tui-"));

mkdirSync(out, { recursive: true });

const env = { ...process.env, POLARIS_HOME: home };

const codex = process.env.POLARIS_CODEX || Bun.which("codex");

if (!codex) throw new Error("codex is not on PATH");

const sh = (cmd: string) => Bun.spawnSync(["sh", "-c", cmd], { cwd: repo });

sh("git init -q && git config user.email e2e@x && git config user.name e2e");

writeFileSync(join(repo, "README.md"), "hello\n");

sh("git add -A && git commit -qm init");

const daemon = spawn("bun", [MAIN, "serve", "--foreground"], {
  env,
  stdio: ["ignore", "inherit", "inherit"],
});

const t0 = Date.now();

const log = (...a: unknown[]) =>
  console.log(`[e2e +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

// ── The TUI's screen, as far as a log needs it ─────────────────────────────
let tuiRaw = "";

/** Strips escape sequences; cursor moves become newlines so words don't run together. */
const ESC = "\\u001b";

const BEL = "\\u0007";

const escapes = (pattern: string) => new RegExp(pattern, "g");

const screenText = () =>
  tuiRaw
    .replace(escapes(`${ESC}\\[[0-9;?]*[Hf]`), "\n")
    .replace(escapes(`${ESC}\\[[0-9;?<>=]*[A-Za-z]`), "")
    .replace(escapes(`${ESC}\\][^${BEL}${ESC}]*(${BEL}|${ESC}\\\\)`), "")
    .replace(escapes(`${ESC}[()][A-Za-z0-9]`), "")
    .replace(escapes(`${ESC}[=>78]`), "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n");

const results: Array<{ check: string; ok: boolean; detail?: string }> = [];

const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ check: name, ok, ...(detail === undefined ? {} : { detail }) });
  log(ok ? "PASS" : "FAIL", name, detail ?? "");
};

const until = async (what: string, condition: () => boolean, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() > deadline) {
      log(`timed out waiting for ${what}`);

      return false;
    }

    await Bun.sleep(100);
  }

  return true;
};

let n = 0;

const cmd = () => CommandId.make(`e2e-${++n}`);

const events: Array<{ at: number; event: Record<string, unknown> }> = [];

const eventsOf = (tag: string) => events.filter((e) => e.event._tag === tag);

let state = "unknown";

let cursor: string | null = null;

const program = Effect.gen(function* () {
  yield* Effect.sleep("1 second");

  const conn = yield* makeHostConnection({
    key: "e2e",
    name: "E2E",
    target: { _tag: "Ssh", alias: "unused" },
    identity: { name: "polaris-e2e", version: "0.0.0", deviceLabel: "E2E", capabilities: [] },
    connector: spawnTransport(["bun", MAIN, "bridge"], { env }),
  });

  const s = yield* conn.awaitSession;
  yield* s.client.dispatch({
    commandId: cmd(),
    command: { _tag: "RegisterWorkspace", path: repo, name: "e2e" },
  });

  const snapshot = yield* s.client.subscribeHost({ afterSequence: null }).pipe(
    Stream.filter((i) => i._tag === "Snapshot"),
    Stream.runHead
  );

  if (snapshot._tag !== "Some" || snapshot.value._tag !== "Snapshot")
    return yield* Effect.die("no snapshot");
  const workspace = snapshot.value.workspaces[0]!;

  const sessionId = SessionId.make("e2e-codex-tui");
  yield* s.client.dispatch({
    commandId: cmd(),
    command: {
      _tag: "StartSession",
      sessionId,
      workspaceId: workspace.id as WorkspaceId,
      harness: "codex",
      placement: { _tag: "InPlace" },
      permissionMode: "supervised",
      model: null,
      prompt: "Reply with just the word ready. Do not run commands or edit files.",
      attachments: [],
    },
  });
  log("session started; first Turn from Polaris");

  // Every session event, in the background, for the whole run.
  yield* s.client.subscribeSession({ sessionId, afterSequence: null, turnLimit: null }).pipe(
    Stream.runForEach((item: SessionStreamItem) =>
      Effect.sync(() => {
        if (item._tag === "Snapshot") {
          state = item.session.state;
          cursor = item.session.harnessCursor ?? cursor;

          return;
        }

        if (item._tag !== "Event") return;
        const e = item.envelope.event as unknown as Record<string, unknown>;
        events.push({ at: Date.now() - t0, event: e });

        if (e._tag === "SessionStateChanged") {
          state = e.state as string;
          log("state →", state, e.reason ?? "");
        }

        if (e._tag === "SessionCursorUpdated") cursor = e.harnessCursor as string;

        if (e._tag === "TurnStarted" || e._tag === "TurnEnded") {
          const turn = e.turn as { id: string; status: string; prompt: string };
          log(e._tag, turn.id, turn.status, JSON.stringify(turn.prompt));
        }

        if (e._tag === "ApprovalRequested") log("ApprovalRequested", JSON.stringify(e.request));

        if (e._tag === "ApprovalResolved")
          log("ApprovalResolved", JSON.stringify(e.decision), "by", e.resolvedBy);

        if (e._tag === "TurnItemCompleted") log("item", JSON.stringify(e.item).slice(0, 160));
      })
    ),
    Effect.forkScoped
  );

  yield* Effect.promise(() => until("first Turn idle", () => state === "idle", 120_000));
  check("Polaris Turn completes", state === "idle");
  check("thread id known", cursor !== null, cursor ?? undefined);

  yield* s.client.dispatch({ commandId: cmd(), command: { _tag: "OpenInTerminal", sessionId } });
  yield* Effect.promise(() => until("In Terminal", () => state === "in-terminal", 30_000));
  check("session goes In Terminal", state === "in-terminal");

  // The session's terminal command, plus one flag: never offer the TUI's self-update here
  // (a keystroke meant for the composer once landed on "Update now" and ran npm install -g).
  const argv = [
    codex,
    "-c",
    "check_for_update_on_startup=false",
    "resume",
    cursor!,
    "--remote",
    `unix://${join(home, "codex.sock")}`,
  ];

  log("TUI:", argv.join(" "));

  const tui = Bun.spawn(argv, {
    cwd: repo,
    env: { ...process.env, TERM: "xterm-256color" },
    terminal: {
      cols: 120,
      rows: 40,
      data: (_t, data) => {
        tuiRaw += new TextDecoder().decode(data);
      },
    },
  });

  const type = (text: string) => tui.terminal!.write(text);

  // First run in a fresh directory may ask whether to trust it.
  yield* Effect.promise(() =>
    until("TUI up", () => /trust|ready|›|Ask Codex|To get started/i.test(screenText()), 30_000)
  );
  yield* Effect.sleep("2 seconds");

  if (/Do you trust|trust the (files|contents)/i.test(screenText())) {
    log("TUI asks to trust the directory; accepting");
    type("\r");
    yield* Effect.sleep("2 seconds");
  }

  // Never type into a dialog: stop if the TUI shows anything but its composer.
  if (/Update now|Update available|enter continue/i.test(screenText())) {
    writeFileSync(join(out, "tui-screen.txt"), screenText());

    return yield* Effect.die(
      "the TUI shows a dialog; refusing to type into it (see tui-screen.txt)"
    );
  }

  check("TUI shows the Polaris Turn's reply (same thread)", /ready/i.test(screenText()));

  const turnsBefore = eventsOf("TurnStarted").length;
  type("Run exactly this shell command: touch tui-approval.txt ; then reply with the word done.");
  yield* Effect.sleep("500 millis");
  type("\r");
  log("typed a Turn into the TUI");

  yield* Effect.promise(() =>
    until("Polaris sees the TUI's Turn", () => eventsOf("TurnStarted").length > turnsBefore, 60_000)
  );
  check("Turn started in the TUI appears in Polaris", eventsOf("TurnStarted").length > turnsBefore);

  yield* Effect.promise(() =>
    until("approval in Polaris", () => eventsOf("ApprovalRequested").length > 0, 120_000)
  );
  const requested = eventsOf("ApprovalRequested");
  check("approval shows in Polaris", requested.length > 0);
  yield* Effect.promise(() =>
    until(
      "approval in TUI",
      () => /allow|approve|Would you like|Yes, proceed/i.test(screenText()),
      15_000
    )
  );
  const tuiShowedApproval = /allow|approve|Would you like|Yes, proceed/i.test(screenText());
  check("approval shows in the TUI", tuiShowedApproval);
  writeFileSync(join(out, "tui-screen-at-approval.txt"), screenText());

  if (requested.length > 0) {
    const request = requested[0]!.event.request as { id: string };
    yield* s.client.dispatch({
      commandId: cmd(),
      command: {
        _tag: "RespondToApproval",
        sessionId,
        requestId: RequestId.make(request.id),
        decision: { _tag: "Allow", remember: false },
      },
    });
    log("answered the approval from Polaris");
  }

  yield* Effect.promise(() =>
    until(
      "the TUI's Turn ends",
      () => eventsOf("TurnEnded").length >= 2 || existsSync(join(repo, "tui-approval.txt")),
      120_000
    )
  );
  yield* Effect.sleep("3 seconds");
  check("the approved command ran", existsSync(join(repo, "tui-approval.txt")));
  check(
    "the approval resolved exactly once in Polaris",
    eventsOf("ApprovalResolved").length === 1 && eventsOf("ApprovalRequested").length === 1,
    `requested ${eventsOf("ApprovalRequested").length}, resolved ${eventsOf("ApprovalResolved").length}`
  );
  check("the TUI's Turn ended in Polaris", eventsOf("TurnEnded").length >= 2);
  // The TUI redraws rather than scrolls; after the answer, its last frames show the command
  // as run and no longer the prompt.
  const screen = screenText();
  check(
    "the TUI dropped its approval prompt and shows the command as run",
    ([...screen.matchAll(/Ran\s+touch tui-approval\.txt/g)].at(-1)?.index ?? -1) >
      screen.lastIndexOf("Yes, proceed")
  );
  const foreign = eventsOf("TurnStarted").at(-1)?.event.turn as { prompt: string } | undefined;
  check(
    "Polaris knows what was typed in the TUI (TurnStarted prompt)",
    (foreign?.prompt ?? "") !== "",
    JSON.stringify(foreign?.prompt ?? null)
  );

  tui.kill("SIGTERM");
  yield* s.client.dispatch({
    commandId: cmd(),
    command: { _tag: "ReturnFromTerminal", sessionId },
  });
  yield* Effect.promise(() => until("back from terminal", () => state === "idle", 30_000));
  check("session returns from the terminal to Idle", state === "idle", state);
});

const outcome = await Effect.runPromise(Effect.scoped(program)).then(
  () => null,
  (e) => e
);

if (outcome !== null) {
  log("ERROR", outcome);
  results.push({ check: "script ran to the end", ok: false, detail: String(outcome) });
}

writeFileSync(join(out, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));

writeFileSync(join(out, "tui-raw.log"), tuiRaw);

writeFileSync(join(out, "tui-screen.txt"), screenText());

writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2));

daemon.kill("SIGTERM");

await new Promise((r) => daemon.once("exit", r));

await Effect.runPromise(stopAppServer({ stateFile: defaultStateFile(join(home, "codex.sock")) }));

rmSync(home, { recursive: true, force: true });

rmSync(repo, { recursive: true, force: true });

log(`evidence in ${out}`);

const failed = results.filter((r) => !r.ok);

log(
  failed.length === 0
    ? "ALL PASS"
    : `${failed.length} FAILED: ${failed.map((f) => f.check).join("; ")}`
);

process.exitCode = failed.length === 0 ? 0 : 1;
