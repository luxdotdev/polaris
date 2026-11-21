import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { RpcTest } from "effect/rpc";
import { HostSessionDefaults, SettingsRpcs } from "@polaris/protocol";
import { newTempDir, removeTempDir } from "../../../daemon/src/platform/tempDir.testing.ts";
import { settingsRpcHandlersAt } from "../../../daemon/src/settings/rpc.ts";
import { hostSettings } from "../../../daemon/src/settings/index.ts";
import { loadSessionDefaults, migrateSessionDefaults } from "./hostSessionDefaults.ts";

const roots: string[] = [];

const fixture = () => {
  const root = newTempDir("desktop-host-defaults-", { short: true });
  roots.push(root);

  return join(root, "host-settings.json");
};

afterEach(() => {
  for (const root of roots.splice(0)) removeTempDir(root);
});

test("first connect imports the Desktop defaults independently per Host and never overwrites Host changes", async () => {
  const first = fixture();
  const second = fixture();

  const old = Schema.decodeUnknownSync(HostSessionDefaults)({
    claude: { model: "saved-desktop-model", effort: "high", permissionMode: "supervised" },
  });

  const connect = (path: string) =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(SettingsRpcs);
        yield* migrateSessionDefaults(client, old);

        return yield* loadSessionDefaults(client);
      }).pipe(Effect.provide(settingsRpcHandlersAt(() => path)))
    );

  expect((await Effect.runPromise(connect(first))).claude?.model).toBe("saved-desktop-model");
  hostSettings(first).set("sessions.defaults.claude.model", "host-choice");
  expect((await Effect.runPromise(connect(first))).claude?.model).toBe("host-choice");
  expect((await Effect.runPromise(connect(second))).claude?.model).toBe("saved-desktop-model");
  expect(hostSettings(first).get("sessions.defaults.claude.model").value).toBe("host-choice");
});
