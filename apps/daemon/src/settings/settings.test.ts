import { afterEach, expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describeSetting, setting, SettingsRpcs, ReviewerSettings } from "@polaris/protocol";
import { Effect, Schema } from "effect";
import { RpcTest } from "effect/rpc";
import { newTempDir, removeTempDir } from "../platform/tempDir.testing.ts";
import { hostSettings, readGroup, writeGroup } from "./index.ts";
import { checkRegistry } from "./registry.ts";
import { settingsRpcHandlersAt } from "./rpc.ts";

const roots: string[] = [];

const fixture = () => {
  const root = newTempDir("host-settings-", { short: true });
  roots.push(root);

  return {
    root,
    path: join(root, "host-settings.json"),
    store: hostSettings(join(root, "host-settings.json")),
  };
};

afterEach(() => {
  for (const root of roots.splice(0)) removeTempDir(root);
});

test("discovery fails for missing descriptions and describes allowed values and defaults", () => {
  expect(() => describeSetting("missing", Schema.String)).toThrow();
  expect(() => checkRegistry()).not.toThrow();

  const schema = setting(Schema.Literals(["simple", "off"]), {
    description: "Visualization level.",
    default: "simple",
  });

  expect(describeSetting("visuals.level", schema)).toMatchObject({
    description: "Visualization level.",
    default: "simple",
    type: { schema: { enum: ["simple", "off"] } },
  });
});

test("all old files migrate once, including partial files, overrides and unknown fields", () => {
  const { root, store, path } = fixture();

  const legacy = {
    "reviewer-settings.json": {
      default: { harness: "codex", model: "custom", effort: null },
      workspaces: {},
      onSessions: false,
      future: { retained: true },
    },
    "constellation-settings.json": {
      defaults: null,
      branchPrefix: "team/",
      transfer: "origin",
      backend: { harness: "codex", model: "custom", effort: "high" },
    },
    "trace-settings.json": { ws: { forwarding: false, autoInstrument: "node" } },
    "attachment-settings.json": { default: { kind: "after-days", days: 19 } },
    "visuals-settings.json": { level: "off" },
    "auto-archive-settings.json": { afterDays: null },
    "idle-compaction-settings.json": { enabled: false, minTokens: 50000 },
    "suggested-replies.json": {
      enabled: true,
      fallback: { harness: "claude", model: "small", effort: null },
    },
  };

  for (const [name, value] of Object.entries(legacy))
    writeFileSync(join(root, name), JSON.stringify(value));
  expect(store.get("reviewer.default").value).toEqual(legacy["reviewer-settings.json"].default);
  expect(store.get("constellation.branchPrefix").value).toBe("team/");
  expect(store.get("traces.workspaces").value).toEqual(legacy["trace-settings.json"]);
  expect(store.get("attachments.default").value).toEqual({ kind: "after-days", days: 19 });
  expect(store.get("visuals.level").value).toBe("off");
  expect(store.get("sessions.autoArchive.afterDays").value).toBeNull();
  expect(store.get("sessions.idleCompaction.minTokens").value).toBe(50000);
  expect(store.get("sessions.suggestedReplies.fallback").value).toEqual(
    legacy["suggested-replies.json"].fallback
  );

  const saved = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ legacy: Schema.Json }))
  )(readFileSync(path, "utf8"));

  expect(saved.legacy).toEqual(legacy);

  if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);

  store.set("visuals.level", "simple");
  writeFileSync(join(root, "visuals-settings.json"), '{"level":"rich"}');
  expect(hostSettings(path).get("visuals.level").value).toBe("simple");
  expect(readGroup(join(root, "reviewer-settings.json"), "reviewer").onPullRequests).toBe(true);
});

test("legacy and generic writes share one model, invalid values never change it", () => {
  const { root, store } = fixture();
  writeGroup(
    join(root, "reviewer-settings.json"),
    "reviewer",
    ReviewerSettings.make({ default: null, workspaces: {}, onSessions: false })
  );
  expect(store.get("reviewer.onSessions").value).toBe(false);
  store.set("reviewer.onSessions", true);
  expect(readGroup(join(root, "reviewer-settings.json"), "reviewer").onSessions).toBe(true);
  expect(() => store.set("reviewer.onSessions", null)).toThrow();
  expect(() => store.set("visuals.level", "loud")).toThrow();
  expect(() => store.set("missing.key", true)).toThrow();
  expect(store.get("visuals.level").value).toBe("rich");
});

test("session defaults are isolated per Host, import once, and leaf keys update the aggregate", () => {
  const a = fixture().store;
  const b = fixture().store;
  const old = { claude: { model: "old-model", effort: "high", permissionMode: "supervised" } };
  a.set("sessions.defaults", old, true);
  a.set("sessions.defaults.claude.model", "host-a");
  a.set("sessions.defaults", old, true);
  b.set("sessions.defaults", old, true);
  expect(a.get("sessions.defaults").value).toEqual({ claude: { ...old.claude, model: "host-a" } });
  expect(b.get("sessions.defaults.claude.model").value).toBe("old-model");
  expect(a.get("sessions.defaults.claude.permissionMode").value).toBe("supervised");
  a.set("sessions.defaults.future-harness.effort", "custom");
  expect(a.list().some((entry) => entry.key === "sessions.defaults.future-harness.model")).toBe(
    true
  );
});

test("settings RPCs list, describe, validate and persist through the real handlers", async () => {
  const { path } = fixture();
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SettingsRpcs);
        const entries = yield* client["settings.list"]({});
        expect(entries.find((entry) => entry.key === "visuals.level")).toMatchObject({
          default: "rich",
          value: "rich",
          description: "How readily agents on this host offer visualizations.",
        });
        const description = yield* client["settings.describe"]({ key: "visuals.level" });
        expect(description.type).toMatchObject({ schema: { enum: ["rich", "simple", "off"] } });
        yield* client["settings.set"]({ key: "visuals.level", value: "off" });
        expect((yield* client["settings.get"]({ key: "visuals.level" })).value).toBe("off");

        const invalid = yield* Effect.result(
          client["settings.set"]({ key: "visuals.level", value: 42 })
        );

        expect(invalid).toHaveProperty("failure._tag", "SettingsError");
        expect((yield* client["settings.get"]({ key: "visuals.level" })).value).toBe("off");
      }).pipe(Effect.provide(settingsRpcHandlersAt(() => path)))
    )
  );
});

test("malformed legacy files and invalid fields keep their original bytes without blocking other settings", () => {
  const { root, store, path } = fixture();
  writeFileSync(join(root, "reviewer-settings.json"), "{broken-json");
  writeFileSync(join(root, "visuals-settings.json"), '{"level":"loud","future":7}');
  writeFileSync(join(root, "attachment-settings.json"), '{"default":{"kind":"never"}}');
  expect(store.get("visuals.level").value).toBe("rich");
  expect(store.get("attachments.default").value).toEqual({ kind: "never" });

  const saved = Schema.decodeUnknownSync(
    Schema.fromJsonString(Schema.Struct({ legacy: Schema.JsonObject }))
  )(readFileSync(path, "utf8"));

  expect(saved.legacy["reviewer-settings.json"]).toBe("{broken-json");
  expect(saved.legacy["visuals-settings.json"]).toEqual({ level: "loud", future: 7 });
});
