import { expect, test } from "bun:test";
import * as P from "@polaris/protocol";
import { createAppFormatting } from "../formatting/bridge.ts";
import { SaveCoordinator } from "../formatting/index.ts";
import { coordinatorFixture } from "./coordinator.testing.ts";
import type { EditorProviderFixture } from "./fixture.testing.ts";
import { trustStore } from "../trust/store.ts";

const oxfmt = P.LanguageProjectFormatter.make({
  tool: "oxfmt",
  root: "/reuse",
  config: "/reuse/oxfmt.config.mts",
  installed: true,
  ignored: false,
});

/** A real coordinator, its bound formatter, and a save path that writes the buffer to `disk`. */
const opened = async (configure: (service: EditorProviderFixture) => void) => {
  const f = coordinatorFixture("export { };\n");

  configure(f.service);
  const file = f.open("main.ts");
  await f.settled(file);
  const target = { hostKey: "reuse", workspaceId: f.workspaceId, path: file.path };
  const formatting = createAppFormatting(() => f.app);

  for (let count = 0; count < 100 && formatting.canFormat?.(target) !== true; count++)
    await new Promise((resolve) => setTimeout(resolve, 1));

  let disk = "";
  const notices: string[] = [];

  const saver = new SaveCoordinator(
    {
      snapshot: (reason) => ({
        file: target,
        text: file.text(),
        version: 1,
        diskVersion: { mtimeMs: 1, size: 1, hash: "fixture" },
        reason,
      }),
      current: (snapshot) => snapshot.text === file.text(),
      apply: (next) =>
        file.view.dispatch({ changes: { from: 0, to: file.text().length, insert: next } }),
      write: async () => {
        disk = file.text();

        return true;
      },
    },
    { ...formatting, failure: (_file, message) => notices.push(message), timeoutMs: 1000 }
  );

  return { f, file, saver, disk: () => disk, notices, dispose: () => file.lifetime.dispose() };
};

test("trusted: saving runs the project's formatter on the buffer and writes its text", async () => {
  const o = await opened((service) => {
    service.projectFormatter = oxfmt;
  });

  try {
    expect(await o.saver.save("manual")).toBe(true);
    expect(o.disk()).toBe("export {};\n");
    expect(o.f.service.projectFormats).toMatchObject([
      { path: "/reuse/main.ts", version: 1, text: "export { };\n" },
    ]);
    expect(o.notices).toEqual([]);
  } finally {
    o.dispose();
  }
});

test("untrusted: saving leaves formatting alone; Format document explains", async () => {
  const o = await opened((service) => {
    service.projectFormatter = oxfmt;
    service.projectTrusted = false;
  });

  try {
    expect(await o.saver.save("manual")).toBe(true);
    expect(o.disk()).toBe("export { };\n");
    expect(o.notices).toEqual([]);
    expect(
      await o.saver.format().then(
        () => null,
        (error: Error) => error.message
      )
    ).toBe("Formatting uses oxfmt once you trust reuse.");
    expect(o.file.text()).toBe("export { };\n");
  } finally {
    o.dispose();
  }
});

test("ignored by the project: nothing formats, not even the language server", async () => {
  const o = await opened((service) => {
    service.projectFormatter = { ...oxfmt, ignored: true };
  });

  try {
    await o.saver.save("manual");
    expect(o.disk()).toBe("export { };\n");
    expect(o.f.requests).not.toContain("languages.format.project");
    expect(o.f.requests).not.toContain("languages.format");
  } finally {
    o.dispose();
  }
});

test("no project formatter: the project's formatter is never asked", async () => {
  const o = await opened(() => undefined);

  try {
    await o.saver.save("manual");
    expect(o.f.requests).not.toContain("languages.format.project");
  } finally {
    o.dispose();
  }
});

test("a Trust change made elsewhere reaches the popover when it replaces the context", async () => {
  const o = await opened((service) => {
    service.projectFormatter = oxfmt;
  });

  try {
    const trusted = P.LanguageTrustStatus.make({
      trust: P.LanguageTrust.make({
        scope: P.LanguageTrustScope.cases.Workspace.make({
          hostId: o.f.service.hostId,
          workspaceId: o.f.workspaceId,
        }),
        revision: 9,
        trusted: true,
        decision: "trusted",
      }),
      wouldRun: { typescriptVersion: null, typescriptPath: null, native: false, plugins: [] },
      ask: false,
      provider: "project",
    });

    o.f.service.trustStatus = trusted;
    o.f.replace(o.file);

    for (let count = 0; count < 100; count++) {
      if (Object.values(trustStore.getState().statuses).some((s) => s.trust.revision === 9)) break;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    expect(o.f.requests).toContain("languages.trust.inspect");
    expect(Object.values(trustStore.getState().statuses)).toContainEqual(trusted);
  } finally {
    o.dispose();
  }
});
