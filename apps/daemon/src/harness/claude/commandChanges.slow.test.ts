/**
 * Script edits through the real hooks, tracker, git and shell (ADR 0117): each command runs
 * in a throwaway repository between the Bash hooks the Agent SDK would call.
 */
import { afterEach, expect, test } from "bun:test";
import type { HookInput, Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { type ItemFileChange, SessionId, TurnId, type TurnItem } from "@polaris/protocol";
import { Predicate } from "effect";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captureCheckpoint } from "../../git/Checkpoints.ts";
import { CommandSnapshots } from "../../git/commandSnapshots.ts";
import { resetSnapshotCaches, snapshotTree } from "../../git/snapshot.ts";
import { HEAVY_GIT_MS, makeRepo } from "../../git/testing.ts";
import type { HarnessEvent } from "../HarnessDriver.ts";
import { applyCommandChangeHooks } from "./commandChanges.ts";
import { ClaudeTranslator } from "./translate.ts";

type Command = Extract<TurnItem, { readonly _tag: "CommandExecution" }>;

const unix = process.platform !== "win32";

const sessionId = SessionId.make("s1");

const turnId = TurnId.make("t1");

afterEach(() => resetSnapshotCaches());

/** A frame or hook input in the SDK's wire shape, from its JSON. */
const wire = <A extends SDKMessage | HookInput>(json: string): A => {
  // SAFETY: every value below is built in the SDK's wire shape.
  const frame = JSON.parse(json) as A;

  return frame;
};

interface BashInput {
  readonly command: string;
  readonly run_in_background?: boolean;
}

const toolUse = (id: string, input: BashInput) =>
  wire<SDKMessage>(
    JSON.stringify({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: `m-${id}`,
        content: [{ type: "tool_use", id, name: "Bash", input }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    })
  );

const toolResult = (id: string) =>
  wire<SDKMessage>(
    JSON.stringify({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "" }] },
      tool_use_result: { stdout: "", stderr: "", interrupted: false },
    })
  );

const sh = async (cwd: string, command: string) => {
  await Bun.spawn(["sh", "-c", command], { cwd, stdout: "ignore", stderr: "ignore" }).exited;
};

interface RunOptions {
  /** Runs while the command does. */
  readonly during?: () => Promise<void>;
  readonly background?: boolean;
  /** The result reaches the translator before the hook after the command has run. */
  readonly resultFirst?: boolean;
  /** The result reaches the translator after that hook returned, before the changes are read. */
  readonly late?: boolean;
  /** With `late`: the Turn ends this way before the snapshot after the command is taken. */
  readonly turnEnds?: "completed" | "interrupted";
}

/** A session in `repo`: `run` takes one Bash call through the hooks and gives its items. */
const sessionIn = (repo: string, options: { readonly budgetMs?: number } = {}) => {
  let snapshots = 0;
  /** While set, snapshots wait for it. */
  let held: PromiseWithResolvers<void> | null = null;

  const tracker = new CommandSnapshots({
    // Patches need the snapshot before the command inside the budget, whatever else runs.
    budgetMs: options.budgetMs ?? 60_000,
    snapshot: async (cwd, signal) => {
      snapshots++;
      await held?.promise;

      return snapshotTree(cwd, signal);
    },
  });

  const sdk: Options = {};
  const translator = new ClaudeTranslator(repo);
  const events: Array<HarnessEvent> = [];
  /** Resolved once a call's changes were handed over, which the hook may not wait for. */
  const delivered = new Map<string, PromiseWithResolvers<void>>();
  translator.beginTurn(turnId);

  applyCommandChangeHooks(
    sdk,
    { cwd: repo, sessionId, readOnly: false },
    {
      trackCommand: (id) => translator.trackCommand(id),
      onCommandChanges: (id, changes) => {
        // After the events are taken, so a waiting `run` reads them.
        queueMicrotask(() => delivered.get(id)?.resolve());

        return translator.onCommandChanges(id, changes);
      },
      commandSignal: () => translator.commandSignal(),
    },
    (completed) => events.push(...completed),
    () => turnId,
    tracker
  );

  const hooks = async (event: "PreToolUse" | "PostToolUse", id: string, input: BashInput) => {
    const hook = wire<HookInput>(
      JSON.stringify({
        hook_event_name: event,
        session_id: "c",
        transcript_path: "",
        cwd: repo,
        tool_name: "Bash",
        tool_use_id: id,
        tool_input: input,
      })
    );

    for (const matcher of sdk.hooks?.[event] ?? [])
      for (const callback of matcher.hooks)
        await callback(hook, id, { signal: new AbortController().signal });
  };

  let calls = 0;

  const run = async (command: string, how: RunOptions = {}): Promise<Array<Command>> => {
    const id = `call-${++calls}`;
    const input = how.background === true ? { command, run_in_background: true } : { command };
    delivered.set(id, Promise.withResolvers());
    events.push(...translator.onMessage(toolUse(id, input)));
    await hooks("PreToolUse", id, input);
    await Promise.all([sh(repo, command), how.during?.()]);

    if (how.resultFirst === true) events.push(...translator.onMessage(toolResult(id)));

    if (how.turnEnds !== undefined) held = Promise.withResolvers();
    await hooks("PostToolUse", id, input);

    // The model's next call isn't held for a large tree's names: they follow the result.
    if (how.late === true) events.push(...translator.onMessage(toolResult(id)));

    if (how.turnEnds !== undefined) {
      translator.endTurn(how.turnEnds);
      translator.beginTurn(TurnId.make("t2"));
      held?.resolve();
    }

    await delivered.get(id)?.promise;

    if (how.resultFirst !== true && how.late !== true)
      events.push(...translator.onMessage(toolResult(id)));

    return events.flatMap((event) =>
      Predicate.isTagged(event, "ItemCompleted") &&
      Predicate.isTagged(event.item, "CommandExecution") &&
      event.item.id === id
        ? [event.item]
        : []
    );
  };

  /** The Turn each completion of a command was sent in. */
  const turns = () =>
    events.flatMap((event) => (Predicate.isTagged(event, "ItemCompleted") ? [event.turnId] : []));

  return { run, turns, snapshots: () => snapshots };
};

const PYTHON_EDIT = `python3 - <<'EOF'
from pathlib import Path
p = Path("src/app.py")
p.write_text(p.read_text().replace("return 1", "return 2"))
EOF`;

const APP = "def answer():\n    return 1\n";

const scriptEdits: ReadonlyArray<{
  readonly name: string;
  readonly command: string;
  readonly needs?: string;
  readonly changes: (repo: string) => ReadonlyArray<ItemFileChange>;
}> = [
  {
    name: "a python heredoc that reads, replaces and writes",
    command: PYTHON_EDIT,
    needs: "python3",
    changes: (repo) => [
      {
        path: join(repo, "src/app.py"),
        kind: "modify",
        patch: {
          diff: "@@ -1,2 +1,2 @@\n def answer():\n-    return 1\n+    return 2\n",
          added: 1,
          removed: 1,
          truncated: false,
        },
      },
    ],
  },
  {
    name: "sed -i, and the backup it leaves",
    command: "sed -i.bak 's/return 1/return 3/' src/app.py",
    changes: (repo) => [
      {
        path: join(repo, "src/app.py"),
        kind: "modify",
        patch: {
          diff: "@@ -1,2 +1,2 @@\n def answer():\n-    return 1\n+    return 3\n",
          added: 1,
          removed: 1,
          truncated: false,
        },
      },
      {
        path: join(repo, "src/app.py.bak"),
        kind: "add",
        patch: {
          diff: "@@ -0,0 +1,2 @@\n+def answer():\n+    return 1\n",
          added: 2,
          removed: 0,
          truncated: false,
        },
      },
    ],
  },
  {
    name: "a redirect into a new file, and an append",
    command: "echo hello > notes.txt && echo more >> README.md",
    changes: (repo) => [
      {
        path: join(repo, "README.md"),
        kind: "modify",
        patch: { diff: "@@ -1 +1,2 @@\n hello\n+more\n", added: 1, removed: 0, truncated: false },
      },
      {
        path: join(repo, "notes.txt"),
        kind: "add",
        patch: { diff: "@@ -0,0 +1 @@\n+hello\n", added: 1, removed: 0, truncated: false },
      },
    ],
  },
  {
    name: "rm",
    command: "rm src/app.py",
    changes: (repo) => [
      {
        path: join(repo, "src/app.py"),
        kind: "delete",
        patch: {
          diff: "@@ -1,2 +0,0 @@\n-def answer():\n-    return 1\n",
          added: 0,
          removed: 2,
          truncated: false,
        },
      },
    ],
  },
];

for (const edit of scriptEdits) {
  const runnable = unix && (edit.needs === undefined || Bun.which(edit.needs) !== null);

  test.skipIf(!runnable)(
    `${edit.name} shows its files and patches on the command`,
    async () => {
      const repo = await makeRepo({ "README.md": "hello\n", "src/app.py": APP });
      const items = await sessionIn(repo).run(edit.command);

      expect(items.map((item) => item.changes)).toEqual([edit.changes(repo)]);
    },
    HEAVY_GIT_MS
  );
}

test.skipIf(!unix)(
  "a read-only command takes no snapshot, even while something else writes",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const session = sessionIn(repo);

    const items = await session.run("git status 2>&1 | head -5 && cat README.md", {
      during: () => sh(repo, "echo other > other.txt"),
    });

    expect(session.snapshots()).toBe(0);
    expect(items.map((item) => "changes" in item)).toEqual([false]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "a background command takes no snapshot: it outlives its call",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const session = sessionIn(repo);
    const items = await session.run("echo late > late.txt", { background: true });

    expect(session.snapshots()).toBe(0);
    expect(items.map((item) => "changes" in item)).toEqual([false]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "what another process writes while the command runs is the command's too, and only then",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const session = sessionIn(repo);
    // Written between commands: no command's.
    writeFileSync(join(repo, "between.txt"), "user\n");

    const items = await session.run("sleep 0.3; echo own > own.txt", {
      during: () => sh(repo, "echo formatter > formatted.txt"),
    });

    expect(items[0]?.changes?.map((change) => [change.path, change.kind])).toEqual([
      [join(repo, "formatted.txt"), "add"],
      [join(repo, "own.txt"), "add"],
    ]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "a result that arrives before the snapshot completes the command again, with its files",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const items = await sessionIn(repo).run("echo x > x.txt", { resultFirst: true });

    expect(items.map((item) => item.changes?.map((change) => change.path))).toEqual([
      undefined,
      [join(repo, "x.txt")],
    ]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "a tree too slow to snapshot gives file names from the Turn's diff, and stops holding commands",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n", "src/app.py": APP });
    // No snapshot fits a budget of 0 ms: every tree is too large.
    const session = sessionIn(repo, { budgetMs: 0 });
    await captureCheckpoint({ cwd: repo, sessionId, turnId, label: "before" });
    // An edit earlier in the Turn (the Edit tool's, say): part of the Turn's diff.
    writeFileSync(join(repo, "edited.txt"), "edit\n");

    const first = await session.run("echo one > one.txt", { late: true });
    const taken = session.snapshots();

    const second = await session.run("sed -i.bak 's/return 1/return 4/' src/app.py", {
      late: true,
    });

    // Each command completes with its result, then again once its names are read.
    expect(first.map((item) => item.changes)).toEqual([
      undefined,
      [
        { path: join(repo, "edited.txt"), kind: "add" },
        { path: join(repo, "one.txt"), kind: "add" },
      ],
    ]);
    expect(second.map((item) => item.changes)).toEqual([
      undefined,
      [
        { path: join(repo, "src/app.py"), kind: "modify" },
        { path: join(repo, "src/app.py.bak"), kind: "add" },
      ],
    ]);
    // The second command wasn't held for a snapshot before it: only the one after.
    expect(session.snapshots() - taken).toBe(1);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "a Turn that ends before its last command's snapshot still gets that command's files, in its own Turn",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const session = sessionIn(repo, { budgetMs: 0 });
    await captureCheckpoint({ cwd: repo, sessionId, turnId, label: "before" });

    const items = await session.run("echo last > last.txt", { late: true, turnEnds: "completed" });

    expect(items.map((item) => item.changes)).toEqual([
      undefined,
      [{ path: join(repo, "last.txt"), kind: "add" }],
    ]);
    // The next Turn has begun: the command completes again in the Turn it ran in.
    expect(session.turns()).toEqual([turnId, turnId]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "an interrupted Turn ends its commands' snapshots: nothing is added to the command",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    const session = sessionIn(repo, { budgetMs: 0 });
    await captureCheckpoint({ cwd: repo, sessionId, turnId, label: "before" });

    const items = await session.run("echo cut > cut.txt", { late: true, turnEnds: "interrupted" });

    expect(items.map((item) => item.changes)).toEqual([undefined]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "a command that writes hundreds of files lists 200, patches 20 and counts the rest",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });
    mkdirSync(join(repo, "out"));

    const items = await sessionIn(repo).run(
      "i=0; while [ $i -lt 230 ]; do echo $i > out/f$i.txt; i=$((i+1)); done"
    );

    const changes = items[0]?.changes ?? [];

    expect(changes.length).toBe(200);
    expect(items[0]?.moreChanges).toBe(30);
    expect(changes.filter((change) => change.patch !== undefined).length).toBe(20);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "a binary file and a file past 1 MiB are names without a patch",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });

    const items = await sessionIn(repo).run(
      "printf 'a\\0b' > image.bin; head -c 1100000 /dev/zero | tr '\\0' 'x' > big.txt"
    );

    expect(items[0]?.changes).toEqual([
      { path: join(repo, "big.txt"), kind: "add" },
      { path: join(repo, "image.bin"), kind: "add" },
    ]);
  },
  HEAVY_GIT_MS
);

test.skipIf(!unix)(
  "when the files are too much to read together, the ones that fit still get patches",
  async () => {
    const repo = await makeRepo({ "README.md": "hello\n" });

    // Five different files of 900 KB pass the 4 MiB read at once; four of them and the small one fit.
    const items = await sessionIn(repo).run(
      "for i in 0 1 2 3 4; do head -c 900000 /dev/zero | tr '\\0' $i > big$i.txt; done; echo hi > small.txt"
    );

    expect(items[0]?.changes?.map((change) => [change.path, change.patch?.added])).toEqual([
      [join(repo, "big0.txt"), 1],
      [join(repo, "big1.txt"), 1],
      [join(repo, "big2.txt"), 1],
      [join(repo, "big3.txt"), 1],
      [join(repo, "big4.txt"), undefined],
      [join(repo, "small.txt"), 1],
    ]);
  },
  HEAVY_GIT_MS
);
