import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { connectRpc, socketTransport } from "@polaris/client";
import { LanguageError } from "@polaris/protocol";
import { Effect, Layer, Predicate, Redacted, Stream } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { startServer } from "../../transport/server.ts";
import { DefaultLanguageHostHandlers } from "./defaults.ts";

const hello = (languageProof?: Redacted.Redacted<unknown>) => {
  const input = {
    clientName: "fake-core",
    clientVersion: "0",
    deviceLabel: "fixture",
    capabilities: [],
  };

  return languageProof === undefined ? input : { ...input, languageProof };
};

test("mounted Host core uses transport Host identity and refuses unapproved managed ShellCheck", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(async () => realpath(await mkdtemp("/private/tmp/m31-core-mount-"))),
          (path) => Effect.promise(() => rm(path, { recursive: true, force: true }))
        );

        const store = yield* EventStore;

        const server = yield* startServer({
          root,
          socketPath: join(root, "d.sock"),
          lockPath: join(root, "d.lock"),
          handlers: DefaultLanguageHostHandlers.pipe(
            Layer.provide(Layer.succeed(EventStore)(store))
          ),
        });

        const absent = yield* connectRpc(yield* socketTransport(server.socketPath));

        yield* absent.client.hello(hello());

        const denied = yield* Effect.flip(absent.client["languages.catalog"]({}));

        expect(denied).toBeInstanceOf(LanguageError);

        expect(denied.reason).toBe("not-owner");

        const owned = yield* connectRpc(yield* socketTransport(server.socketPath));

        const reply = yield* owned.client.hello(hello(Redacted.make("e".repeat(64))));

        const catalog = yield* owned.client["languages.catalog"]({});

        const shellcheck = catalog.tools.find((tool) => tool.id === "shellcheck");

        expect(shellcheck?.disposition).toBe("offered");

        expect(shellcheck?.artifacts).toHaveLength(4);

        const facts = yield* owned.client["languages.availability"]({
          toolIds: ["shellcheck"],
          checkout: null,
          phase: "install",
          refresh: true,
        });

        expect(facts).toHaveLength(1);

        expect(facts[0]?.hostId).toBe(reply.host.hostId);

        const fact = facts[0];

        if (fact === undefined || !Predicate.isTagged(fact.preflight, "Blocked"))
          throw new Error("Pending artifact was not blocked");

        expect(Predicate.isTagged(fact.installation, "NotInstalled")).toBe(true);
        expect(fact.preflight.reason).toBe("audit-required");

        const unobserved = yield* Effect.flip(
          owned.client["languages.availability"]({
            toolIds: ["typescript-language-server"],
            checkout: null,
            phase: "install",
            refresh: true,
          })
        );

        expect(unobserved.reason).toBe("not-ready");
        expect(unobserved.message).toBe(
          "Prerequisite observation is unavailable without current request authority"
        );

        const installDenied = yield* Effect.flip(
          owned.client["languages.install"]({
            toolId: "shellcheck",
            version: "0.11.0",
            intent: "manual",
          })
        );

        expect(installDenied.reason).toBe("unsupported-capability");
        expect(installDenied.message).toBe("Independent installation permission is unavailable");

        const foreignCancel = yield* Effect.flip(
          owned.client["languages.install.cancel"]({ jobId: "foreign-job" })
        );

        expect(foreignCancel.reason).toBe("not-owner");

        const rollbackDenied = yield* Effect.flip(
          owned.client["languages.install"]({
            toolId: "shellcheck",
            version: "0.11.0",
            intent: "rollback",
          })
        );

        expect(rollbackDenied.reason).toBe("unsupported-capability");

        const foreignWatch = yield* Effect.flip(
          Stream.runCollect(owned.client["languages.install.watch"]({ jobId: "foreign-job" }))
        );

        expect(foreignWatch.reason).toBe("not-owner");

        yield* Effect.promise(() => access(join(root, "languages")));

        expect(reply.capabilities).not.toContain("languages");
      })
    ).pipe(Effect.provide(EventStore.layerSqlite(":memory:")))
  );
});
