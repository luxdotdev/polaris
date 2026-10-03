import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "bun:test";
import { configureEditor, discardBuffer } from "../runtime/buffers.ts";
import { memoryKeyValue, readDraft, writeDraft } from "../model/drafts.ts";
import { RefactorCoordinator } from "./coordinator.ts";
import { memoryGroups } from "./storage.ts";
import { readRefactorState } from "./drafts.ts";
import { fixture } from "./testing.ts";
import type { GroupStore } from "./group.ts";

const deferred = () => {
  let finish = () => {};

  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return { promise, finish: () => finish() };
};

const setup = async (failure = false) => {
  const f = fixture();
  const underlying = memoryGroups();
  const coordinator = new RefactorCoordinator(underlying, f.port, "utf-16");

  const group = await coordinator.accept(
    await coordinator.preview(f.proposal),
    "discard",
    "discard",
    "host"
  );

  const entered = deferred();
  const gate = deferred();
  let lists = 0;

  const groups: GroupStore = {
    ...underlying,
    list: async () => {
      lists++;

      if (lists === 2) {
        entered.finish();
        await gate.promise;

        if (failure) throw new Error("Durable intervention failed");
      }

      return underlying.list();
    },
  };

  const kv = memoryKeyValue();

  configureEditor({
    groups,
    kv,
    files: {
      read: () => Promise.reject(new Error("Closed discard must not read disk")),
      write: () => Promise.reject(new Error("Discard must not save")),
      watch: () => () => {},
    },
    prefs: () => ({ vim: false, autosave: false }),
    canWrite: () => true,
    hostLabel: () => "Fake Host",
    hostHome: () => null,
  });

  return { kv, groups, group, entered, gate };
};

test("actual closed discard preserves grouped text when view lifetime changes during storage wait", async () => {
  const f = await setup();
  let current = true;
  const pending = discardBuffer("host", "/checkout/a", () => current);
  await f.entered.promise;
  current = false;
  f.gate.finish();
  expect(await pending).toBe(false);
  const draft = readDraft(f.kv, "host", "/checkout/a");
  expect(draft?.text).toBe("aλb\r\n");
  expect((await readRefactorState(f.groups, "host", "/checkout/a", draft)).draft?.text).toBe(
    "aλb\r\n"
  );
  expect((await f.groups.get(f.group.id))?.originals[0]?.text).toBe("a😀b\r\n");
});

test("actual closed discard refuses a newer legacy draft even with unchanged view", async () => {
  const f = await setup();
  const pending = discardBuffer("host", "/checkout/a");
  await f.entered.promise;
  writeDraft(f.kv, { hostKey: "host", path: "/checkout/a", text: "newer closed work", base: null });
  f.gate.finish();
  expect(await pending).toBe(false);
  const draft = readDraft(f.kv, "host", "/checkout/a");
  expect(draft?.text).toBe("newer closed work");
  expect((await readRefactorState(f.groups, "host", "/checkout/a", draft)).draft?.text).toBe(
    "newer closed work"
  );
});

test("actual closed discard failure retains grouped projection and original text", async () => {
  const f = await setup(true);
  const pending = discardBuffer("host", "/checkout/a");
  await f.entered.promise;
  f.gate.finish();
  let error = "";

  try {
    await pending;
  } catch (cause) {
    error = String(cause);
  }

  expect(error).toContain("Durable intervention failed");
  expect((await f.groups.get(f.group.id))?.state).toBe("applied");
  expect((await readRefactorState(f.groups, "host", "/checkout/a", null)).draft?.text).toBe(
    "aλb\r\n"
  );
});

test("actual unchanged closed discard drops projection only after storage wait", async () => {
  const f = await setup();
  const pending = discardBuffer("host", "/checkout/a");
  await f.entered.promise;
  expect((await f.groups.get(f.group.id))?.documents[0]?.text).toBe("aλb\r\n");
  f.gate.finish();
  expect(await pending).toBe(true);
  expect((await readRefactorState(f.groups, "host", "/checkout/a", null)).draft).toBeNull();
  expect((await f.groups.get(f.group.id))?.originals[0]?.text).toBe("a😀b\r\n");
});

test("actual open discard surfaces write refusal and retains live newer text", () => {
  const home = mkdtempSync(join(tmpdir(), "m31-r1-discard-test-"));

  const allowed = new Set([
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "TERM",
  ]);

  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key)));

  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--preload",
        fileURLToPath(new URL("../../../../../../../packages/ui/test/setup.ts", import.meta.url)),
        fileURLToPath(new URL("./discard.testing.ts", import.meta.url)),
      ],
      {
        env: {
          ...env,
          POLARIS_HOME: home,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      }
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe("");
    expect(result.stdout.toString()).toContain("safe error surfaced");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
