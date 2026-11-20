import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WorkspaceId } from "@polaris/protocol";
import { McpBinding } from "../binding.ts";
import { Deferred, Effect } from "effect";
import type { DesktopSnapshot } from "@polaris/protocol";
import { newTempDir, removeTempDir } from "../../platform/tempDir.testing.ts";
import { availableConstellationTools } from "../tools/index.ts";
import { fakeCommands, leadBinding, workerBinding } from "../testing.ts";
import { attachInspectionTools } from "./catalog.ts";
import { recentDaemonLogs } from "./logs.ts";

const plainBinding = McpBinding.cases.Plain.make({
  sessionId: leadBinding.sessionId,
  constellationId: leadBinding.constellationId,
  workspaceId: WorkspaceId.make("workspace"),
});

test("Developer Mode adds inspection for every role; switching off removes it and denies cached calls", async () => {
  const commands = fakeCommands().commands;
  let enabled = false;

  attachInspectionTools(commands, {
    enabled: Effect.sync(() => enabled),
    logs: () => Effect.die("off must not read logs"),
    snapshot: () => Effect.succeed({ capturedAt: 1, windows: [] }),
  });

  for (const binding of [plainBinding, leadBinding, workerBinding]) {
    const list = () => availableConstellationTools(binding, commands);
    expect((await list()).map((tool) => tool.name)).not.toContain("desktop_view");
    expect((await list()).map((tool) => tool.name)).toContain("sessions");
    enabled = true;
    const tools = await list();
    expect(tools.map((tool) => tool.name)).toContain("daemon_logs");
    const view = tools.find((tool) => tool.name === "desktop_view")!;
    expect((await view.call({})).content[0]?.text).toContain('"windows": []');
    enabled = false;
    expect((await list()).map((tool) => tool.name)).not.toContain("daemon_logs");
    expect((await view.call({})).isError).toBe(true);
    expect((await tools.find((tool) => tool.name === "daemon_logs")!.call({})).isError).toBe(true);
  }
});

test("daemon_logs reads only recent stdout or stderr lines and scrubs credentials", async () => {
  const root = newTempDir("inspection-logs-");

  try {
    writeFileSync(
      join(root, "daemon.out.log"),
      "old line\nready\ntoken=private-value\nlast line\n"
    );
    writeFileSync(join(root, "daemon.err.log"), "old error\nlatest error\n");
    const commands = fakeCommands().commands;

    attachInspectionTools(commands, {
      enabled: Effect.succeed(true),
      logs: (lines, stream) => recentDaemonLogs(root, lines, stream),
      snapshot: () => Effect.succeed({ capturedAt: 1, windows: [] }),
    });

    const log = (await availableConstellationTools(workerBinding, commands)).find(
      (tool) => tool.name === "daemon_logs"
    )!;

    const result = await log.call({ lines: 2 });

    expect(result.isError).not.toBe(true);
    expect(result.content[0]?.text).toStartWith("token=[redacted]\nlast line\n");
    expect(result.content[0]?.text).not.toContain("private-value");
    expect(result.content[0]?.text).not.toContain("old line");
    expect((await log.call({ lines: 1, stream: "stderr" })).content[0]?.text).toStartWith(
      "latest error\n"
    );
    expect((await log.call({ lines: 201 })).isError).toBe(true);
    expect((await log.call({ path: "/arbitrary/file" })).isError).toBe(true);
  } finally {
    removeTempDir(root);
  }
});

test("log reads cap their suffix and handle missing or empty service logs", async () => {
  const root = newTempDir("inspection-logs-");

  try {
    expect(await Effect.runPromise(recentDaemonLogs(root, 50, "stdout"))).toBe("No log file yet.");
    writeFileSync(join(root, "daemon.out.log"), "");
    expect(await Effect.runPromise(recentDaemonLogs(root, 50, "stdout"))).toBe("No recent lines.");
    writeFileSync(join(root, "daemon.out.log"), "old".repeat(30000) + "\nrecent\n");
    expect(await Effect.runPromise(recentDaemonLogs(root, 50, "stdout"))).toBe("recent");
    writeFileSync(join(root, "daemon.out.log"), "x".repeat(90000) + "\n");
    const clipped = await Effect.runPromise(recentDaemonLogs(root, 1, "stdout"));

    expect(clipped.length).toBe(12000);
    expect(clipped).toEndWith("xxx");
  } finally {
    removeTempDir(root);
  }
});

test("turning Developer Mode off during a snapshot drops the pending result", async () => {
  const commands = fakeCommands().commands;
  let enabled = true;
  const result = Effect.runSync(Deferred.make<DesktopSnapshot>());
  const started = Effect.runSync(Deferred.make<void>());
  attachInspectionTools(commands, {
    enabled: Effect.sync(() => enabled),
    logs: () => Effect.succeed(""),
    snapshot: () => Effect.andThen(Deferred.succeed(started, undefined), Deferred.await(result)),
  });

  const tool = (await availableConstellationTools(workerBinding, commands)).find(
    (tool) => tool.name === "desktop_view"
  )!;

  const pending = tool.call({});
  await Effect.runPromise(Deferred.await(started));
  enabled = false;
  await Effect.runPromise(Deferred.succeed(result, { capturedAt: 999, windows: [] }));
  const answer = await pending;
  expect(answer.isError).toBe(true);
  expect(answer.content[0]?.text).not.toContain("999");
});
